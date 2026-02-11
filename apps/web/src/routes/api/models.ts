import { Ratelimit } from "@upstash/ratelimit";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { upstashRedis } from "@/lib/upstash";

const MODELS_CACHE_KEY = "openchat:models";
const MODELS_CACHE_TTL_SECONDS = 60 * 60 * 4;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;

const modelsIpRatelimit = upstashRedis
	? new Ratelimit({
			redis: upstashRedis,
			limiter: Ratelimit.slidingWindow(30, "60 s"),
			prefix: "ratelimit:models:ip",
		})
	: null;

async function fetchModelsFromOpenRouter(): Promise<Response> {
	let response: globalThis.Response;
	try {
		response = await fetch(OPENROUTER_MODELS_URL, {
			headers: {
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		console.warn("[Models API] OpenRouter fetch failed:", error);
		return json({ error: "Upstream service unavailable" }, { status: 502 });
	}

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
			"X-Models-Cache": "MISS",
		},
	});
}

export const Route = createFileRoute("/api/models")({
	server: {
		handlers: {
		GET: async ({ request }) => {
			if (modelsIpRatelimit) {
				const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
				const rl = await modelsIpRatelimit.limit(ip);
				if (!rl.success) {
					return json({ error: "Rate limit exceeded" }, { status: 429 });
				}
			}

			if (!upstashRedis) {
				return fetchModelsFromOpenRouter();
			}

				try {
					const cached = await upstashRedis.get<string | Record<string, unknown>>(MODELS_CACHE_KEY);
					if (cached) {
						const body =
							typeof cached === "string" ? cached : JSON.stringify(cached);
						return new Response(body, {
							status: 200,
							headers: {
								"Content-Type": "application/json",
								"Cache-Control": "no-store",
								"X-Models-Cache": "HIT",
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
