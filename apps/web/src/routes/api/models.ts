import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { upstashRedis } from "@/lib/upstash";

const MODELS_CACHE_KEY = "openchat:models";
const MODELS_CACHE_TTL_SECONDS = 60 * 60 * 4;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

async function fetchModelsFromOpenRouter(): Promise<Response> {
	const response = await fetch(OPENROUTER_MODELS_URL, {
		headers: {
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		return json(
			{ error: `OpenRouter API error: ${response.status}` },
			{ status: response.status },
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
			GET: async () => {
				if (!upstashRedis) {
					return fetchModelsFromOpenRouter();
				}

				try {
					const cached = await upstashRedis.get<string>(MODELS_CACHE_KEY);
					if (cached) {
						return new Response(cached, {
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
