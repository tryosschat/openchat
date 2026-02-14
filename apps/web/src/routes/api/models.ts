import { Ratelimit } from "@upstash/ratelimit";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { shouldFailClosedForMissingUpstash, upstashRedis } from "@/lib/upstash";

const MODELS_CACHE_KEY = "openchat:models";
const MODELS_CACHE_TTL_SECONDS = 60 * 60 * 4;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;
const TRUST_PROXY_MODE = process.env.TRUST_PROXY?.trim().toLowerCase();

/**
 * Basic IPv4/IPv6 format validation.
 * Rejects obviously spoofed or malformed values used in proxy headers.
 */
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

function isValidIpFormat(ip: string): boolean {
	return IPV4_REGEX.test(ip) || (IPV6_REGEX.test(ip) && ip.includes(":") && ip.length <= 45);
}

if (TRUST_PROXY_MODE === "true") {
	console.warn(
		"[Models API] TRUST_PROXY=true is INSECURE: the x-forwarded-for header is user-controlled " +
		"and will NOT be used for rate limiting. Only platform-specific headers " +
		"(cf-connecting-ip, x-vercel-forwarded-for, x-real-ip) are trusted in this mode. " +
		"Prefer TRUST_PROXY=cloudflare or TRUST_PROXY=vercel for production deployments.",
	);
}

if (!TRUST_PROXY_MODE) {
	console.warn("[Models API] TRUST_PROXY is unset; models endpoint will reject requests when IP is unavailable");
}

if (
	TRUST_PROXY_MODE &&
	TRUST_PROXY_MODE !== "cloudflare" &&
	TRUST_PROXY_MODE !== "vercel" &&
	TRUST_PROXY_MODE !== "true"
) {
	console.warn("[Models API] Unrecognized TRUST_PROXY value; models endpoint will reject requests when IP is unavailable");
}

const modelsIpRatelimit = upstashRedis
	? new Ratelimit({
			redis: upstashRedis,
			limiter: Ratelimit.slidingWindow(30, "60 s"),
			prefix: "ratelimit:models:ip",
		})
	: null;

async function fetchModelsFromOpenRouter(): Promise<Response> {
	try {
		const response = await fetch(OPENROUTER_MODELS_URL, {
			headers: {
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			return json(
				{ error: "Upstream service error" },
				{ status: 502 },
			);
		}

		const payload = await response.text();

		if (upstashRedis) {
			try {
				await upstashRedis.set(MODELS_CACHE_KEY, payload, {
					ex: MODELS_CACHE_TTL_SECONDS,
				});
			} catch (error) {
				console.warn("[Models API] Failed to write cache:", error);
			}
		}

		return new Response(payload, {
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		console.warn("[Models API] OpenRouter fetch failed:", error);
		return json({ error: "Upstream service unavailable" }, { status: 502 });
	}
}

function getClientIp(request: Request): string | null {
	if (!TRUST_PROXY_MODE) {
		return null;
	}

	if (TRUST_PROXY_MODE === "cloudflare") {
		const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
		if (cfConnectingIp && isValidIpFormat(cfConnectingIp)) return cfConnectingIp;
		return null;
	}

	if (TRUST_PROXY_MODE === "vercel") {
		const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for")?.trim();
		if (vercelForwardedFor) {
			const first = vercelForwardedFor.split(",")[0]?.trim();
			if (first && isValidIpFormat(first)) return first;
		}
		return null;
	}

	if (TRUST_PROXY_MODE === "true") {
		// Only trust platform-specific headers that are set/overwritten by
		// the edge proxy itself and cannot be spoofed by end clients.
		// SECURITY FIX: Do NOT fall back to x-forwarded-for, as it is
		// user-controlled and allows rate-limit bypass via header spoofing.

		const cfIp = request.headers.get("cf-connecting-ip")?.trim();
		if (cfIp && isValidIpFormat(cfIp)) return cfIp;

		const vercelIp = request.headers.get("x-vercel-forwarded-for")?.trim();
		if (vercelIp) {
			const first = vercelIp.split(",")[0]?.trim();
			if (first && isValidIpFormat(first)) return first;
		}

		const realIp = request.headers.get("x-real-ip")?.trim();
		if (realIp && isValidIpFormat(realIp)) return realIp;

		// x-forwarded-for is intentionally NOT used here because it is
		// trivially spoofable by clients. If no platform-specific header is
		// present, return null so the request is rejected (fail closed),
		// preventing rate-limit bypass via header spoofing.
		return null;
	}

	return null;
}

export const Route = createFileRoute("/api/models")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				if (shouldFailClosedForMissingUpstash()) {
					return json({ error: "Service temporarily unavailable" }, { status: 503 });
				}

				if (modelsIpRatelimit) {
					const ip = getClientIp(request);
					if (!ip) {
						return json(
							{ error: "Unable to determine client IP for rate limiting" },
							{ status: 400 },
						);
					}
					const rl = await modelsIpRatelimit.limit(ip);
					if (!rl.success) {
						const retryAfterSeconds = Math.max(
							1,
							Math.ceil((rl.reset - Date.now()) / 1000),
						);
						return json(
							{ error: "Rate limit exceeded" },
							{
								status: 429,
								headers: {
									"Retry-After": String(retryAfterSeconds),
								},
							},
						);
					}
				}

				if (!upstashRedis) {
					return fetchModelsFromOpenRouter();
				}

				try {
					const cached = await upstashRedis.get<string | Record<string, unknown>>(MODELS_CACHE_KEY);
					if (cached) {
						const body = typeof cached === "string" ? cached : JSON.stringify(cached);
						return new Response(body, {
							status: 200,
							headers: {
								"Content-Type": "application/json",
								"Cache-Control": "no-store",
							},
						});
					}
				} catch (error) {
					console.warn("[Models API] Failed to read cache:", error);
				}

				return fetchModelsFromOpenRouter();
			},
		},
	},
});
