import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import {
	convertToModelMessages,
	generateId,
	stepCountIs,
	streamText,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { webSearch } from "@valyu/ai-sdk";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { getRedisClient, redis } from "@/lib/redis";
import { decryptSecret } from "@/lib/server-crypto";
import { getAuthUser, getConvexClientForRequest, getConvexUserId, isSameOrigin } from "@/lib/server-auth";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const VALYU_API_KEY = process.env.VALYU_API_KEY;
const CHAT_RATE_LIMIT_WINDOW_SECONDS = 60;
const CHAT_RATE_LIMIT_MAX_USER = 30;
const CHAT_RATE_LIMIT_MAX_IP = 60;

/**
 * Controls whether to trust proxy-forwarded headers for client IP extraction.
 * Set to "cloudflare" to trust cf-connecting-ip only
 * Set to "true" or "1" to trust x-forwarded-for and x-real-ip
 * Leave unset or empty to not trust any forwarding headers (direct requests only)
 */
const TRUST_PROXY_FORWARDED = process.env.TRUST_PROXY_FORWARDED;

/**
 * Extracts the client IP address from the request.
 * 
 * SECURITY: This function only honors proxy headers when explicitly configured
 * via TRUST_PROXY_FORWARDED env var. This prevents attackers from spoofing
 * their IP by setting x-forwarded-for headers on direct requests.
 * 
 * @param request - The incoming HTTP request
 * @returns The client IP address or null if it cannot be determined
 */
function getRequestIp(request: Request): string | null {
	// Only trust Cloudflare headers when explicitly configured
	if (TRUST_PROXY_FORWARDED?.toLowerCase() === "cloudflare") {
		const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
		if (cfConnectingIp) {
			return cfConnectingIp;
		}
		// Fall through - no trusted IP available
		return null;
	}

	// Only trust standard proxy headers when explicitly enabled
	if (TRUST_PROXY_FORWARDED?.toLowerCase() === "true" || TRUST_PROXY_FORWARDED === "1") {
		// x-forwarded-for may contain a comma-separated list of IPs
		// The first IP is the original client, subsequent ones are proxies
		const forwardedFor = request.headers.get("x-forwarded-for");
		if (forwardedFor) {
			const firstIp = forwardedFor.split(",")[0]?.trim();
			if (firstIp) {
				return firstIp;
			}
		}

		// x-real-ip is typically set by reverse proxies (nginx, etc.)
		const realIp = request.headers.get("x-real-ip")?.trim();
		if (realIp) {
			return realIp;
		}

		// true-client-ip is used by some CDNs (Akamai, etc.)
		const trueClientIp = request.headers.get("true-client-ip")?.trim();
		if (trueClientIp) {
			return trueClientIp;
		}
	}

	// No trusted forwarding headers configured or available
	// In production behind a proxy, this means IP-based rate limiting will be ineffective
	// but user-based rate limiting (enforced first) will still protect against abuse
	return null;
}

/**
 * Enforces rate limiting on chat requests.
 * 
 * Rate limiting strategy (defense in depth):
 * 1. USER-BASED (primary): Limits requests per authenticated user - cannot be spoofed
 * 2. IP-BASED (secondary): Additional layer when trusted proxy is configured
 * 
 * The user-based limit is always enforced first and is the primary protection.
 * IP-based limiting is only effective when TRUST_PROXY_FORWARDED is properly
 * configured for your deployment environment (e.g., "cloudflare" or "true").
 * 
 * @param request - The incoming HTTP request
 * @param userId - The authenticated user's ID (from session/token, not spoofable)
 * @returns 429 response if rate limited, null otherwise
 */
async function enforceRateLimit(request: Request, userId: string): Promise<Response | null> {
	const redisReady = await redis.ensureConnected();
	if (!redisReady) return null;
	const client = getRedisClient();
	if (!client) return null;

	const ip = getRequestIp(request);
	const userKey = `rate:chat:user:${userId}`;
	const userCount = await client.incr(userKey);
	if (userCount === 1) {
		await client.expire(userKey, CHAT_RATE_LIMIT_WINDOW_SECONDS);
	}
	if (userCount > CHAT_RATE_LIMIT_MAX_USER) {
		return json(
			{ error: "Rate limit exceeded. Please try again shortly." },
			{ status: 429 },
		);
	}

	if (ip) {
		const ipKey = `rate:chat:ip:${ip}`;
		const ipCount = await client.incr(ipKey);
		if (ipCount === 1) {
			await client.expire(ipKey, CHAT_RATE_LIMIT_WINDOW_SECONDS);
		}
		if (ipCount > CHAT_RATE_LIMIT_MAX_IP) {
			return json(
				{ error: "Rate limit exceeded. Please try again shortly." },
				{ status: 429 },
			);
		}
	}

	return null;
}


export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				if (!isSameOrigin(request)) {
					return json({ error: "Invalid origin" }, { status: 403 });
				}
				const authUser = await getAuthUser(request);
				if (!authUser) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}
				const userId = await getConvexUserId(authUser, request);
				if (!userId) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}

				const url = new URL(request.url);
				const chatId = url.searchParams.get("chatId");
				const lastId = url.searchParams.get("lastId") || "0";

				if (!chatId) {
					return json({ error: "chatId is required" }, { status: 400 });
				}

				const redisReady = await redis.ensureConnected();
				if (!redisReady) {
					console.log("[Chat API GET] Redis not available");
					return json({ error: "Redis not configured" }, { status: 503 });
				}

				console.log("[Chat API GET] Reading stream for chat:", chatId);
				const meta = await redis.stream.getMeta(chatId);
				if (!meta) {
					console.log("[Chat API GET] No stream metadata found");
					return new Response(null, { status: 204 });
				}
				if (meta.userId !== userId) {
					return json({ error: "Unauthorized" }, { status: 403 });
				}
				console.log("[Chat API GET] Stream meta:", meta.status);

				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					async start(controller) {
						let currentLastId = lastId;
						let isComplete = false;

						while (!isComplete) {
							const tokens = await redis.stream.read(chatId, currentLastId);

							for (const token of tokens) {
								if (token.type === "done") {
									isComplete = true;
									controller.enqueue(
										encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
									);
									break;
								}

								if (token.type === "error") {
									controller.enqueue(
										encoder.encode(
											`data: ${JSON.stringify({ type: "error", text: token.text })}\n\n`,
										),
									);
									isComplete = true;
									break;
								}

								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ type: token.type, text: token.text, id: token.id })}\n\n`,
									),
								);
								currentLastId = token.id;
							}

							if (!isComplete && tokens.length === 0) {
								const currentMeta = await redis.stream.getMeta(chatId);
								if (currentMeta?.status !== "streaming") {
									isComplete = true;
								} else {
									await new Promise((r) => setTimeout(r, 50));
								}
							}
						}

						controller.close();
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					},
				});
			},

			POST: async ({ request }) => {
				const abortSignal = request.signal;
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

				const rateLimitResponse = await enforceRateLimit(request, convexUserId);
				if (rateLimitResponse) return rateLimitResponse;
				const redisReady = await redis.ensureConnected();
				console.log("[Chat API POST] Redis ready:", redisReady);

				try {
					const body = await request.json();
					const {
						messages,
						model,
						provider = "osschat",
						enableWebSearch = false,
						reasoningEffort,
						maxSteps = 5,
						chatId,
					} = body;

					if (!messages || !Array.isArray(messages)) {
						return json({ error: "messages is required and must be an array" }, { status: 400 });
					}

					if (!model || typeof model !== "string") {
						return json({ error: "model is required and must be a string" }, { status: 400 });
					}

					if (provider === "osschat" && !OPENROUTER_API_KEY) {
						return json(
							{ error: "OSSChat Cloud is not configured on this server" },
							{ status: 500 },
						);
					}

					for (const message of messages) {
						if (!message.role) {
							return json({ error: "Each message must have a role property" }, { status: 400 });
						}
						if (!["user", "assistant", "system"].includes(message.role)) {
							return json(
								{ error: "Message role must be one of: user, assistant, system" },
								{ status: 400 },
							);
						}
						if (!message.parts && !message.content) {
							return json({ error: "Each message must have parts or content" }, { status: 400 });
						}
					}

					let openrouterKey: string | null = null;
					if (provider === "osschat") {
						openrouterKey = OPENROUTER_API_KEY ?? null;
					} else {
						const convexClient = await getConvexClientForRequest(request);
						if (!convexClient) {
							return json({ error: "Unauthorized" }, { status: 401 });
						}
						const encryptedKey = await convexClient.query(api.users.getOpenRouterKey, {
							userId: convexUserId,
						});
						openrouterKey = encryptedKey ? decryptSecret(encryptedKey) : null;
					}
					if (!openrouterKey) {
						return json({ error: "OpenRouter API key not configured" }, { status: 400 });
					}
					const openRouter = createOpenRouter({ apiKey: openrouterKey });
					const aiModel = openRouter(model);

					const modelMessages = await convertToModelMessages(messages);

					const streamOptions: Parameters<typeof streamText>[0] = {
						model: aiModel as Parameters<typeof streamText>[0]["model"],
						messages: modelMessages,
						abortSignal,
					};

					if (enableWebSearch && VALYU_API_KEY) {
						streamOptions.tools = {
							webSearch: webSearch({ apiKey: VALYU_API_KEY }),
						} as any;
					}

					const hasTools = enableWebSearch && VALYU_API_KEY;
					const stepLimit = hasTools ? Math.max(1, Math.min(10, maxSteps)) : 1;
					streamOptions.stopWhen = stepCountIs(stepLimit);

					if (reasoningEffort && reasoningEffort !== "none") {
						const effortValue = reasoningEffort as "low" | "medium" | "high";
						streamOptions.providerOptions = {
							...streamOptions.providerOptions,
							openrouter: {
								reasoning: {
									effort: effortValue,
								},
							},
						};
					}

					const messageId = generateId();
					const streamId = `${chatId}-${messageId}`;

					if (chatId && redisReady) {
						console.log("[Chat API POST] Initializing Redis stream for chat:", chatId);
						await redis.stream.init(chatId, convexUserId, messageId);
					}

					if (chatId) {
						const convexClient = await getConvexClientForRequest(request);
						if (!convexClient) {
							console.error("[Chat API] Convex auth token unavailable");
						} else {
							try {
								console.log("[Chat API] Setting active stream:", streamId);
								await convexClient.mutation(api.chats.setActiveStream, {
									chatId: chatId as Id<"chats">,
									userId: convexUserId,
									streamId,
								});
								console.log("[Chat API] Active stream set successfully");
							} catch (err) {
								console.error("[Chat API] Failed to set active stream:", err);
							}
						}
					}

					const result = streamText(streamOptions);

					const encoder = new TextEncoder();
					let fullContent = "";
					let fullReasoning = "";

					const stream = new ReadableStream({
						async start(controller) {
							const markStreamInterrupted = async () => {
								if (chatId && redisReady) {
									await redis.stream.complete(chatId);
								}
							};
							
							try {
								for await (const part of result.fullStream) {
									if (abortSignal.aborted) {
										console.log("[Chat API POST] Client disconnected, marking stream interrupted");
										await markStreamInterrupted();
										controller.close();
										return;
									}
									
									if (part.type === "text-delta") {
										const text = part.text;
										fullContent += text;

										controller.enqueue(
											encoder.encode(
												`data: ${JSON.stringify({ type: "text", text })}\n\n`,
											),
										);

										if (chatId && redisReady) {
											await redis.stream.append(chatId, text, "text");
										}
									} else if (part.type === "reasoning-delta") {
										const text = (part as { type: "reasoning-delta"; text: string }).text;
										fullReasoning += text;

										controller.enqueue(
											encoder.encode(
												`data: ${JSON.stringify({ type: "reasoning", text })}\n\n`,
											),
										);

										if (chatId && redisReady) {
											await redis.stream.append(chatId, text, "reasoning");
										}
									}
								}

								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ 
											type: "done", 
											content: fullContent, 
											reasoning: fullReasoning,
											messageId,
										})}\n\n`,
									),
								);

								if (chatId && redisReady) {
									await redis.stream.complete(chatId);
									console.log("[Chat API POST] Redis stream completed");
								}

					if (chatId) {
						const convexClient = await getConvexClientForRequest(request);
						if (convexClient) {
							await convexClient.mutation(api.chats.setActiveStream, {
								chatId: chatId as Id<"chats">,
								userId: convexUserId,
								streamId: null,
							});
						}
					}

								controller.close();
							} catch (err) {
								if (err instanceof Error && err.name === "AbortError") {
									console.log("[Chat API POST] Stream aborted, marking stream interrupted");
									await markStreamInterrupted();
									controller.close();
									return;
								}
								
							const errorMessage = "Stream failed";
							console.error("[Chat API] Stream error", err);

								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ type: "error", text: errorMessage })}\n\n`,
									),
								);

								if (chatId && redisReady) {
									await redis.stream.error(chatId, errorMessage);
								}

								controller.close();
							}
						},
					});

					return new Response(stream, {
						headers: {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
							"X-Message-Id": messageId,
						},
					});
				} catch (error) {
					console.error("[Chat API Error]", error);

					if (error instanceof SyntaxError) {
						return json({ error: "Invalid JSON in request body" }, { status: 400 });
					}

					if (error instanceof Error) {
						if (error.message.includes("401") || error.message.includes("Unauthorized")) {
							return json(
								{ error: "Invalid API key. Please check your OpenRouter API key." },
								{ status: 401 },
							);
						}

						if (error.message.includes("429") || error.message.includes("rate limit")) {
							return json(
								{ error: "Rate limit exceeded. Please try again later." },
								{ status: 429 },
							);
						}

						if (error.message.includes("model") || error.message.includes("Model")) {
							return json({ error: "Model error. Please try a different model." }, { status: 400 });
						}
					}

					return json({ error: "Request failed. Please try again." }, { status: 500 });
				}
			},
		},
	},
});
