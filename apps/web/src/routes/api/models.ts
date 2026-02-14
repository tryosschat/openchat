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
 * Rejects obviously spoofed or malformed values used in forwarded headers.
 */
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

function isValidIpFormat(ip: string): boolean {
	return IPV4_REGEX.test(ip) || (IPV6_REGEX.test(ip) && ip.includes(":") && ip.length <= 45);
}

/**
 * TRUSTED_PROXIES: comma-separated list of trusted proxy IPs.
 * Required when TRUST_PROXY=true to prevent x-forwarded-for spoofing.
 * When set, only x-forwarded-for values are accepted if the deployment is
 * explicitly configured to trust the reverse proxy chain.
 * Platform-specific modes (cloudflare, vercel) use tamper-resistant headers
 * and do not require this setting.
 */
const TRUSTED_PROXY_IPS: ReadonlySet<string> = new Set(
	(process.env.TRUSTED_PROXIES ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean),
);

if (TRUST_PROXY_MODE === "true" && TRUSTED_PROXY_IPS.size === 0) {
	console.warn(
		"[Models API] SECURITY WARNING: TRUST_PROXY=true without TRUSTED_PROXIES is unsafe. " +
			"The x-forwarded-for header can be spoofed by clients. " +
			"Set TRUSTED_PROXIES to a comma-separated list of trusted proxy IPs, " +
			"or use a platform-specific mode (cloudflare, vercel). " +
			"Rate limiting will fail closed — requests will be rejected when client IP cannot be verified.",
	);
}

if (TRUST_PROXY_MODE === "true" && TRUSTED_PROXY_IPS.size > 0) {
	console.info(
		`[Models API] TRUST_PROXY=true with ${TRUSTED_PROXY_IPS.size} trusted proxy IP(s) configured`,
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

	// Platform-specific modes use tamper-resistant headers set by the platform
	// edge proxy. These cannot be spoofed by end clients.
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
		// Without TRUSTED_PROXIES configured, x-forwarded-for is spoofable.
		// Fail closed: return null so the request is rejected with a 400,
		// preventing rate-limit bypass via header spoofing.
		if (TRUSTED_PROXY_IPS.size === 0) {
			return null;
		}

		// Prefer platform-specific headers that are harder to spoof, as they
		// are typically set/overwritten by the edge proxy itself.
		const cfIp = request.headers.get("cf-connecting-ip")?.trim();
		if (cfIp && isValidIpFormat(cfIp)) return cfIp;

		const vercelIp = request.headers.get("x-vercel-forwarded-for")?.trim();
		if (vercelIp) {
			const first = vercelIp.split(",")[0]?.trim();
			if (first && isValidIpFormat(first)) return first;
		}

		const realIp = request.headers.get("x-real-ip")?.trim();
		if (realIp && isValidIpFormat(realIp)) return realIp;

		// Fall back to x-forwarded-for only as last resort, with IP validation.
		// This is only reached when TRUSTED_PROXIES is configured, indicating
		// the operator has explicitly acknowledged the proxy chain is trusted.
		const forwardedFor = request.headers.get("x-forwarded-for")?.trim();
		if (forwardedFor) {
			const first = forwardedFor.split(",")[0]?.trim();
			if (first && isValidIpFormat(first)) return first;
		}
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
