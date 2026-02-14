import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { redis } from "@/lib/redis";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import {
	getAuthUser,
	getConvexClientForRequest,
	getConvexUserIdReadOnly,
	isSameOrigin,
} from "@/lib/server-auth";

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
					const convexClient = await getConvexClientForRequest(request);
					if (!convexClient) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}
					const convexUserId = await getConvexUserIdReadOnly(authUser, convexClient);
					if (!convexUserId) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}

					const body = await request.json();
					const { chatId, isTyping } = body;

					if (!chatId) {
						return json({ error: "chatId required" }, { status: 400 });
					}

					// Verify user owns the chat before allowing typing status update
					const chat = await convexClient.query(api.chats.get, {
						chatId: chatId as Id<"chats">,
						userId: convexUserId,
					});
					if (!chat) {
						return json({ error: "Forbidden" }, { status: 403 });
					}

					if (!redis.isAvailable()) {
						return json({ ok: true });
					}

					await redis.typing.set(chatId, convexUserId, !!isTyping);
					return json({ ok: true });
				} catch (error) {
					console.error("[Typing API POST] Error:", error);
					return json({ error: "Failed to update typing status" }, { status: 500 });
				}
			},

			GET: async ({ request }) => {
				try {
					if (!isSameOrigin(request)) {
						return json({ error: "Invalid origin" }, { status: 403 });
					}
					const authUser = await getAuthUser(request);
					if (!authUser) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}
					const convexClient = await getConvexClientForRequest(request);
					if (!convexClient) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}
					const convexUserId = await getConvexUserIdReadOnly(authUser, convexClient);
					if (!convexUserId) {
						return json({ error: "Unauthorized" }, { status: 401 });
					}

					const url = new URL(request.url);
					const chatId = url.searchParams.get("chatId");

					if (!chatId) {
						return json({ error: "chatId required" }, { status: 400 });
					}

					// Verify user owns the chat before allowing typing status read
					const chat = await convexClient.query(api.chats.get, {
						chatId: chatId as Id<"chats">,
						userId: convexUserId,
					});
					if (!chat) {
						return json({ error: "Forbidden" }, { status: 403 });
					}

					if (!redis.isAvailable()) {
						return json({ users: [] });
					}

					const users = await redis.typing.getUsers(chatId);
					return json({ users });
				} catch (error) {
					console.error("[Typing API GET] Error:", error);
					return json({ error: "Failed to get typing status" }, { status: 500 });
				}
			},
		},
	},
});
