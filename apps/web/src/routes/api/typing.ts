import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { redis } from "@/lib/redis";
import { getAuthUser, getConvexUserId, isSameOrigin } from "@/lib/server-auth";

export const Route = createFileRoute("/api/typing")({
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
					const convexUserId = await getConvexUserId(authUser, request);
					if (!convexUserId) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}

					const body = await request.json();
					const { chatId, isTyping } = body;

					if (!chatId) {
						return json({ error: "chatId required" }, { status: 400 });
					}

					if (!redis.isAvailable()) {
						return json({ ok: true });
					}

					await redis.typing.set(chatId, convexUserId, !!isTyping);
					return json({ ok: true });
				} catch {
					return json({ error: "Failed to update typing status" }, { status: 500 });
				}
			},

			GET: async ({ request }) => {
				if (!isSameOrigin(request)) {
					return json({ error: "Invalid origin" }, { status: 403 });
				}
				const authUser = await getAuthUser(request);
				if (!authUser) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}
				const url = new URL(request.url);
				const chatId = url.searchParams.get("chatId");

				if (!chatId) {
					return json({ error: "chatId required" }, { status: 400 });
				}

				if (!redis.isAvailable()) {
					return json({ users: [] });
				}

				const users = await redis.typing.getUsers(chatId);
				return json({ users });
			},
		},
	},
});
