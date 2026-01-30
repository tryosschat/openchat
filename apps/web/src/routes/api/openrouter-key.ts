import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { api } from "@server/convex/_generated/api";
import { encryptSecret } from "@/lib/server-crypto";
import { getAuthUser, getConvexClientForRequest, getConvexUserId, isSameOrigin } from "@/lib/server-auth";

export const Route = createFileRoute("/api/openrouter-key")({
	server: {
		handlers: {
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
