import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { api } from "@server/convex/_generated/api";
import { encryptSecret } from "@/lib/server-crypto";
import { getAuthUser, getConvexClientForRequest, getConvexUserId, getConvexUserIdReadOnly, isSameOrigin } from "@/lib/server-auth";
import { authRatelimit } from "@/lib/upstash";

export const Route = createFileRoute("/api/openrouter-key")({
	server: {
		handlers: {
			/**
			 * GET: Check if user has an OpenRouter API key stored
			 * Returns { hasKey: boolean } - never exposes the actual key to the client
			 *
			 * Uses read-only lookup to avoid side-effects (user creation) in GET requests.
			 */
			GET: async ({ request }) => {
				try {
					if (!isSameOrigin(request)) {
						return json({ error: "Invalid origin" }, { status: 403 });
					}
					const authUser = await getAuthUser(request);
					if (!authUser) {
						return json({ hasKey: false });
					}

					const convexClient = await getConvexClientForRequest(request);
					if (!convexClient) {
						return json({ hasKey: false });
					}

					const convexUserId = await getConvexUserIdReadOnly(authUser, convexClient);
					if (!convexUserId) {
						return json({ hasKey: false });
					}

					const hasKey = await convexClient.query(api.users.hasOpenRouterKey, {
						userId: convexUserId,
					});

					return json({ hasKey });
				} catch (error) {
					console.error("[OpenRouterKey] Failed to check key status", error);
					return json({ hasKey: false });
				}
			},

			POST: async ({ request }) => {
				try {
					if (!isSameOrigin(request)) {
						return json({ error: "Invalid origin" }, { status: 403 });
					}
					const authUser = await getAuthUser(request);
					if (!authUser) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}

					const body = await request.json();
					const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
					if (!apiKey) {
						return json({ error: "apiKey is required" }, { status: 400 });
					}

					const convexUserId = await getConvexUserId(authUser, request);
					if (!convexUserId) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}
					if (authRatelimit) {
						const rate = await authRatelimit.limit(`openrouter-key:post:${convexUserId}`);
						if (!rate.success) {
							const retryAfterSeconds = Math.max(
								1,
								Math.ceil((rate.reset - Date.now()) / 1000),
							);
							return json(
								{ error: "Too many key update attempts. Please try again shortly." },
								{ status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
							);
						}
					}

					const convexClient = await getConvexClientForRequest(request);
					if (!convexClient) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}

					const encryptedKey = encryptSecret(apiKey);
					await convexClient.mutation(api.users.saveOpenRouterKey, {
						userId: convexUserId,
						encryptedKey,
					});

					return json({ ok: true });
				} catch (error) {
					console.error("[OpenRouterKey] Failed to store key", error);
					return json({ error: "Failed to store API key" }, { status: 500 });
				}
			},

			DELETE: async ({ request }) => {
				try {
					if (!isSameOrigin(request)) {
						return json({ error: "Invalid origin" }, { status: 403 });
					}
					const authUser = await getAuthUser(request);
					if (!authUser) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}

					const convexUserId = await getConvexUserId(authUser, request);
					if (!convexUserId) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}
					if (authRatelimit) {
						const rate = await authRatelimit.limit(`openrouter-key:delete:${convexUserId}`);
						if (!rate.success) {
							const retryAfterSeconds = Math.max(
								1,
								Math.ceil((rate.reset - Date.now()) / 1000),
							);
							return json(
								{ error: "Too many key deletion attempts. Please try again shortly." },
								{ status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
							);
						}
					}

					const convexClient = await getConvexClientForRequest(request);
					if (!convexClient) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}

					await convexClient.mutation(api.users.removeOpenRouterKey, {
						userId: convexUserId,
					});

					return json({ ok: true });
				} catch (error) {
					console.error("[OpenRouterKey] Failed to remove key", error);
					return json({ error: "Failed to remove API key" }, { status: 500 });
				}
			},
		},
	},
});
