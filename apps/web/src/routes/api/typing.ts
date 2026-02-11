import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { getAuthUser, getConvexUserId, isSameOrigin } from "@/lib/server-auth";
import { upstashRedis } from "@/lib/upstash";

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

						if (!upstashRedis) {
							return json({ ok: true });
						}

						const key = `chat:${chatId}:typing:${convexUserId}`;
						if (isTyping) {
							await upstashRedis.set(key, "1", { ex: 3 });
						} else {
							await upstashRedis.del(key);
						}
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

					if (!upstashRedis) {
						return json({ users: [] });
					}

					const users = new Set<string>();
					const pattern = `chat:${chatId}:typing:*`;
					let cursor: string | number = "0";
					do {
						const [nextCursor, keys]: [string, Array<string>] = await upstashRedis.scan(cursor, {
							match: pattern,
							count: 100,
						});
						cursor = nextCursor;
						for (const key of keys) {
							const userId = key.split(":").pop();
							if (userId) {
								users.add(userId);
							}
						}
					} while (String(cursor) !== "0");

					return json({ users: [...users] });
				},
			},
		},
});
