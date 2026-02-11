import { v } from "convex/values";
import { mutation, query, httpAction, internalMutation, internalQuery } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import {
	PersistentTextStreaming,
	StreamIdValidator,
	type StreamId,
} from "@convex-dev/persistent-text-streaming";
import type { Id } from "./_generated/dataModel";
import { redisStreamOps } from "./lib/redisRest";
import { createLogger } from "./lib/logger";
import { requireAuthUserId } from "./lib/auth";
import { getCorsOrigin } from "./lib/origins";
import { decryptSecret } from "./lib/crypto";

// Initialize the persistent text streaming component
export const persistentTextStreaming = new PersistentTextStreaming(
	components.persistentTextStreaming
);

// Re-export StreamId type and validator for use in other files
export { StreamIdValidator, type StreamId };

const logger = createLogger("StreamingLLM");

/**
 * Create a new stream and associate it with a message
 * Called before starting the LLM generation
 */
export const createStream = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		clientMessageId: v.optional(v.string()),
	},
	returns: v.object({
		streamId: StreamIdValidator,
		messageId: v.id("messages"),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Verify user owns the chat
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			throw new Error("Chat not found or access denied");
		}

		// Create the persistent stream
		const streamId = await persistentTextStreaming.createStream(ctx);

		// Create the assistant message with the stream ID
		const now = Date.now();
		const messageId = await ctx.db.insert("messages", {
			chatId: args.chatId,
			clientMessageId: args.clientMessageId,
			role: "assistant",
			content: "", // Will be populated by stream
			status: "streaming",
			streamId: streamId as string,
			createdAt: now,
			userId,
		});

		// Update chat's lastMessageAt
		await ctx.db.patch(args.chatId, {
			lastMessageAt: now,
			updatedAt: now,
		});

		return { streamId, messageId };
	},
});

/**
 * Get the current body/content of a stream
 * Used by useStream hook for database fallback when not driving
 * IMPORTANT: Must return { text, status } format for useStream hook compatibility
 *
 * STREAM RECONNECTION: This query handles the case where a user reloads during streaming.
 * The persistent stream component may have cleared its body, but:
 * 1. The message has content from periodic saves
 * 2. The message status tells us if streaming is still in progress
 * We use the message's status (not "done") to determine the correct streaming state.
 */
export const getStreamBody = internalQuery({
	args: {
		streamId: StreamIdValidator,
	},
	handler: async (ctx, args) => {
		// Get stream body from persistent streaming - returns { text, status }
		const streamBody = await persistentTextStreaming.getStreamBody(ctx, args.streamId as StreamId);

		// Always fetch the message to check its actual status and get reasoning
		const message = await ctx.db
			.query("messages")
			.withIndex("by_stream_id", (q) => q.eq("streamId", args.streamId as string))
			.unique();

		// If stream body has content and is still streaming, return it with reasoning from message
		if (streamBody && typeof streamBody === "object" && streamBody.text) {
			return {
				...streamBody,
				reasoning: message?.reasoning ?? null,
				thinkingTimeMs: message?.thinkingTimeMs ?? null,
			};
		}

		// If stream body is empty but message has content, use message content
		// CRITICAL: Use the message's status, not hardcoded "done"
		// This allows stream reconnection to show content while still detecting streaming
		if (message?.content) {
			// Determine the correct status based on message status
			const status = message.status === "streaming" ? "streaming" : "done";
			return {
				text: message.content,
				status: status as "streaming" | "done",
				reasoning: message.reasoning ?? null,
				thinkingTimeMs: message.thinkingTimeMs ?? null,
			};
		}

		// Fallback: return stream body with null reasoning (may be empty/null)
		return streamBody ? { ...streamBody, reasoning: null, thinkingTimeMs: null } : streamBody;
	},
});

export const getStreamMessage = internalQuery({
	args: {
		messageId: v.id("messages"),
		streamId: v.string(),
	},
	returns: v.union(
		v.object({
			userId: v.id("users"),
		}),
		v.null(),
	),
	handler: async (ctx, args) => {
		const message = await ctx.db.get(args.messageId);
		if (!message || message.streamId !== args.streamId || !message.userId) return null;
		return { userId: message.userId };
	},
});

/**
 * Get stream status and content by querying the associated message
 */
export const getStreamStatus = internalQuery({
	args: {
		streamId: v.string(),
	},
	returns: v.object({
		body: v.union(v.string(), v.null()),
		status: v.union(v.literal("streaming"), v.literal("completed"), v.literal("error"), v.null()),
		reasoning: v.optional(v.union(v.string(), v.null())),
		thinkingTimeMs: v.optional(v.union(v.number(), v.null())),
	}),
	handler: async (ctx, args) => {
		// Find the message associated with this stream first
		// We need this to check if stream completed and fall back to message content
		const message = await ctx.db
			.query("messages")
			.withIndex("by_stream_id", (q) => q.eq("streamId", args.streamId))
			.unique();

		// Get the stream body - returns {status, text} object
		const rawBody = await persistentTextStreaming.getStreamBody(ctx, args.streamId as StreamId);

		// Extract text from the StreamBody object
		let body: string | null = null;
		if (rawBody && typeof rawBody === "object" && "text" in rawBody) {
			body = (rawBody as { text: string }).text || null;
		} else if (typeof rawBody === "string") {
			body = rawBody;
		}

		// STREAM RECONNECTION FIX: If stream body is empty but message has content,
		// use the message content. This handles the case where:
		// 1. Stream completed while user was reloading
		// 2. Persistent streaming cleared the body
		// 3. But message.content has the final content
		if (!body && message?.content) {
			body = message.content;
		}

		return {
			body,
			status: (message?.status as "streaming" | "completed" | "error") ?? null,
			reasoning: message?.reasoning ?? null,
			thinkingTimeMs: message?.thinkingTimeMs ?? null,
		};
	},
});

/**
 * Cancel an active stream
 * Called by the client when user clicks stop button
 * The streamLLM action will check for this status and stop streaming
 */
export const cancelStream = mutation({
	args: {
		streamId: v.string(),
		userId: v.id("users"),
	},
	returns: v.object({
		success: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Find the message associated with this stream
		const message = await ctx.db
			.query("messages")
			.withIndex("by_stream_id", (q) => q.eq("streamId", args.streamId))
			.unique();

		if (!message) {
			return { success: false };
		}

		// Verify user owns the message
		if (message.userId !== userId) {
			return { success: false };
		}

		// Only cancel if currently streaming
		if (message.status !== "streaming") {
			return { success: false };
		}

		// Mark as cancelled
		await ctx.db.patch(message._id, {
			status: "cancelled",
		});

		// Also reset the chat status
		const chat = await ctx.db.get(message.chatId);
		if (chat && chat.status === "streaming") {
			await ctx.db.patch(message.chatId, {
				status: "idle",
				updatedAt: Date.now(),
			});
		}

		return { success: true };
	},
});

/**
 * Check if a stream has been cancelled (internal query for streamLLM)
 */
export const isStreamCancelled = internalQuery({
	args: {
		streamId: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const message = await ctx.db
			.query("messages")
			.withIndex("by_stream_id", (q) => q.eq("streamId", args.streamId))
			.unique();

		return message?.status === "cancelled";
	},
});

/**
 * Mark a stream as complete and update the message content
 * Internal mutation - called from HTTP action after streaming completes
 */
export const completeStream = internalMutation({
	args: {
		messageId: v.id("messages"),
		content: v.string(),
		reasoning: v.optional(v.string()),
		thinkingTimeMs: v.optional(v.number()),
		reasoningRequested: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		// Get the message to find the chatId
		const message = await ctx.db.get(args.messageId);

		if (!message) {
			throw new Error("Message not found");
		}

		await ctx.db.patch(args.messageId, {
			content: args.content,
			reasoning: args.reasoning,
			thinkingTimeMs: args.thinkingTimeMs,
			reasoningRequested: args.reasoningRequested,
			status: "completed",
		});

		// Reset chat status to idle when streaming completes
		await ctx.db.patch(message.chatId, {
			status: "idle",
			updatedAt: Date.now(),
		});
	},
});

/**
 * Update message content during streaming (periodic saves)
 * Internal mutation - called from HTTP action during streaming
 */
export const updateStreamContent = internalMutation({
	args: {
		messageId: v.id("messages"),
		content: v.string(),
		reasoning: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.messageId, {
			content: args.content,
			reasoning: args.reasoning,
		});
	},
});

/**
 * Fix stuck streaming messages that never completed
 * This can happen when a stream is interrupted (server crash, timeout, etc.)
 * Marks stuck messages as "error" status to allow UI to recover
 */
export const fixStuckStreamingMessages = mutation({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({
		fixedCount: v.number(),
		fixedMessageIds: v.array(v.id("messages")),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Find all streaming messages for this user
		const streamingMessages = await ctx.db
			.query("messages")
			.withIndex("by_user_status", (q) =>
				q.eq("userId", userId).eq("status", "streaming")
			)
			.collect();

		const fixedIds: Id<"messages">[] = [];

		for (const message of streamingMessages) {
			// Mark as error status - the stream never completed
			await ctx.db.patch(message._id, {
				status: "error",
			});
			fixedIds.push(message._id);

			// Also reset the chat status if it's stuck
			const chat = await ctx.db.get(message.chatId);
			if (chat && chat.status === "streaming") {
				await ctx.db.patch(message.chatId, {
					status: "idle",
					updatedAt: Date.now(),
				});
			}
		}

		return {
			fixedCount: fixedIds.length,
			fixedMessageIds: fixedIds,
		};
	},
});

/**
 * Admin-only: Fix ALL stuck streaming messages across all users
 * Use with caution - should only be run by admins
 */
export const fixAllStuckStreamingMessages = internalMutation({
	args: {},
	returns: v.object({
		fixedCount: v.number(),
	}),
	handler: async (ctx) => {
		// Find all streaming messages
		const streamingMessages = await ctx.db
			.query("messages")
			.filter((q) => q.eq(q.field("status"), "streaming"))
			.collect();

		let fixedCount = 0;

		for (const message of streamingMessages) {
			await ctx.db.patch(message._id, {
				status: "error",
			});
			fixedCount++;

			// Also reset the chat status if stuck
			const chat = await ctx.db.get(message.chatId);
			if (chat && chat.status === "streaming") {
				await ctx.db.patch(message.chatId, {
					status: "idle",
					updatedAt: Date.now(),
				});
			}
		}

		return { fixedCount };
	},
});

/**
 * Admin-only: Soft-delete broken error messages (empty content with error status)
 * These messages were never completed and have no useful content
 */
export const cleanupBrokenErrorMessages = internalMutation({
	args: {},
	returns: v.object({
		deletedCount: v.number(),
	}),
	handler: async (ctx) => {
		// Find all error messages with empty content
		const errorMessages = await ctx.db
			.query("messages")
			.filter((q) => q.eq(q.field("status"), "error"))
			.collect();

		let deletedCount = 0;
		const now = Date.now();

		for (const message of errorMessages) {
			// Only delete if content is empty or very short (broken)
			if (!message.content || message.content.trim().length < 10) {
				await ctx.db.patch(message._id, {
					deletedAt: now,
				});
				deletedCount++;
			}
		}

		return { deletedCount };
	},
});

/**
 * Prepare a chat for streaming - creates user message, stream, and assistant message
 * Called by the client before starting the stream
 */
export const prepareChat = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		userContent: v.string(),
		userMessageId: v.optional(v.string()),
		assistantMessageId: v.optional(v.string()),
	},
	returns: v.object({
		streamId: StreamIdValidator,
		userMessageId: v.id("messages"),
		assistantMessageId: v.id("messages"),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Verify user owns the chat
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			throw new Error("Chat not found or access denied");
		}

		const now = Date.now();

		// Create the user message
		const userMsgId = await ctx.db.insert("messages", {
			chatId: args.chatId,
			clientMessageId: args.userMessageId,
			role: "user",
			content: args.userContent,
			status: "completed",
			createdAt: now,
			userId,
		});

		// Create the persistent stream for assistant response
		const streamId = await persistentTextStreaming.createStream(ctx);

		// Create the assistant message placeholder with the stream ID
		const assistantMsgId = await ctx.db.insert("messages", {
			chatId: args.chatId,
			clientMessageId: args.assistantMessageId,
			role: "assistant",
			content: "", // Will be populated by stream
			status: "streaming",
			streamId: streamId as string,
			createdAt: now + 1, // Slightly after user message
			userId,
		});

		// Update chat's lastMessageAt and set status to streaming
		// This allows the sidebar to show a streaming indicator
		await ctx.db.patch(args.chatId, {
			lastMessageAt: now,
			updatedAt: now,
			status: "streaming",
		});

		return {
			streamId,
			userMessageId: userMsgId,
			assistantMessageId: assistantMsgId,
		};
	},
});

// Types for the stream request
type StreamRequestBody = {
	streamId: string;
	messageId: string;
	modelId: string;
	apiKey?: string;
	messages: Array<{
		role: string;
		content: string;
	}>;
	provider?: "osschat" | "openrouter";
	reasoningConfig?: {
		enabled: boolean;
		effort?: "low" | "medium" | "high";
		max_tokens?: number;
	};
};

// Redis streaming configuration
const REDIS_TOKEN_BATCH_SIZE = 10; // Flush every 10 tokens
const REDIS_TOKEN_BATCH_INTERVAL_MS = 50; // Or every 50ms

/**
 * HTTP Action for streaming LLM responses
 * This runs on Convex infrastructure and continues even if client disconnects
 *
 * REDIS STREAMING:
 * When Redis is available (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set),
 * tokens are also pushed to Redis for low-latency client streaming via SSE.
 * Client can connect to /api/stream/[redisStreamId] for real-time tokens.
 * The X-Stream-Id header contains the Redis stream ID for client connection.
 */
export const streamLLM = httpAction(async (ctx, request) => {
	const origin = request.headers.get("origin");
	const corsOrigin = getCorsOrigin(origin);
	const withCorsHeaders = (base?: HeadersInit) => {
		const headers = new Headers(base);
		if (corsOrigin) {
			headers.set("Access-Control-Allow-Origin", corsOrigin);
			headers.set("Vary", "Origin");
		}
		return headers;
	};
	// Handle CORS preflight
	if (request.method === "OPTIONS") {
		if (origin && !corsOrigin) {
			return new Response(null, { status: 403 });
		}
		return new Response(null, {
			status: 204,
			headers: withCorsHeaders({
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
				"Access-Control-Max-Age": "86400",
			}),
		});
	}

	try {
		if (origin && !corsOrigin) {
			return new Response(JSON.stringify({ error: "Invalid origin" }), {
				status: 403,
				headers: withCorsHeaders({ "Content-Type": "application/json" }),
			});
		}

		const body = (await request.json()) as StreamRequestBody;
		const { streamId, messageId, modelId, messages, reasoningConfig, provider } = body;

		if (!streamId || !messageId || !modelId || !messages) {
			return new Response(
				JSON.stringify({ error: "Missing required fields" }),
				{
					status: 400,
					headers: withCorsHeaders({ "Content-Type": "application/json" }),
				}
			);
		}

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: withCorsHeaders({ "Content-Type": "application/json" }),
			});
		}

		const user = await ctx.runQuery(internal.users.getByExternalIdInternal, {
			externalId: identity.subject,
		});
		if (!user) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: withCorsHeaders({ "Content-Type": "application/json" }),
			});
		}

		const message = await ctx.runQuery(internal.streaming.getStreamMessage, {
			messageId: messageId as Id<"messages">,
			streamId,
		});
		if (!message || message.userId !== user._id) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 403,
				headers: withCorsHeaders({ "Content-Type": "application/json" }),
			});
		}

		const requestProvider = provider ?? "osschat";
		let apiKey: string | null = null;
		if (requestProvider === "osschat") {
			apiKey = process.env.OPENROUTER_API_KEY ?? null;
		} else {
			const encryptedKey = await ctx.runQuery(api.users.getOpenRouterKey, {
				userId: user._id,
			});
			apiKey = encryptedKey ? await decryptSecret(encryptedKey) : null;
		}
		if (!apiKey) {
			return new Response(JSON.stringify({ error: "API key not configured" }), {
				status: 400,
				headers: withCorsHeaders({ "Content-Type": "application/json" }),
			});
		}

		// Build the OpenRouter request
		const openRouterMessages = messages.map((m) => ({
			role: m.role as "user" | "assistant" | "system",
			content: m.content,
		}));

		// Determine if reasoning is enabled
		// Trust the config - UI only shows reasoning controls for models that support it
		const hasReasoning = reasoningConfig?.enabled;

		let fullContent = "";
		let fullReasoning = "";
		let reasoningStartTime: number | null = null;
		let reasoningEndTime: number | null = null;
		let chunkCount = 0;
		let reasoningChunkCount = 0;
		let isCancelled = false;
		let lastCancellationCheck = Date.now();
		const CHUNKS_PER_UPDATE = 10; // More frequent saves for responsive UI
		const REASONING_CHUNKS_PER_UPDATE = 1; // Real-time streaming: save on every reasoning chunk
		const CANCELLATION_CHECK_INTERVAL_MS = 200; // Check for cancellation every 200ms for faster response

		// Redis streaming state
		const useRedisStreaming = redisStreamOps.isAvailable();
		let redisStreamId: string | null = null;
		let pendingTokenBatch: string[] = [];
		let lastBatchFlush = Date.now();

		// Initialize Redis stream if available
		if (useRedisStreaming) {
			try {
				// Use messageId as restoration ID for client reconnection
				redisStreamId = await redisStreamOps.initializeStream(messageId);
				logger.debug("Redis stream initialized", { redisStreamId, messageId });
			} catch (error) {
				logger.error("Failed to initialize Redis stream, falling back to Convex-only streaming", error);
				redisStreamId = null;
			}
		}

		// Helper to flush token batch to Redis
		const flushTokenBatch = async () => {
			if (pendingTokenBatch.length === 0 || !redisStreamId) return;
			const batch = pendingTokenBatch;
			pendingTokenBatch = [];
			lastBatchFlush = Date.now();
			try {
				await redisStreamOps.appendTokenBatch(redisStreamId, batch);
			} catch (error) {
				logger.error("Failed to append token batch to Redis", error);
				// Don't fail the stream on Redis errors - content is still saved to Convex
			}
		};

		// Generator function for the stream
		// This function runs to completion even if client disconnects
		// Using 'any' for actionCtx to avoid type conflicts between httpAction ctx and stream() expected type
		const generateResponse = async (
			actionCtx: any,
			_request: Request,
			_streamId: StreamId,
			chunkAppender: (chunk: string) => Promise<void>
		) => {
			const openRouterUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";

			const requestBody: Record<string, unknown> = {
				model: modelId,
				messages: openRouterMessages,
				stream: true,
				max_tokens: 4096,
			};

			// Add reasoning config if enabled
			if (hasReasoning && reasoningConfig) {
				requestBody.reasoning = {
					effort: reasoningConfig.effort || "medium",
					...(reasoningConfig.max_tokens && { max_tokens: reasoningConfig.max_tokens }),
				};
			}

			const response = await fetch(openRouterUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					"HTTP-Referer": process.env.CONVEX_SITE_URL || "https://openchat.dev",
					"X-Title": "OpenChat",
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				// Mark Redis stream as errored if initialized
				if (redisStreamId) {
					try {
						await redisStreamOps.errorStream(redisStreamId, `OpenRouter error: ${response.status}`);
					} catch (e) {
						logger.error("Failed to mark Redis stream as errored", e);
					}
				}
				throw new Error(`OpenRouter error: ${response.status} - ${errorText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body");
			}

			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				// Check for cancellation periodically (every CANCELLATION_CHECK_INTERVAL_MS)
				const now = Date.now();
				if (now - lastCancellationCheck >= CANCELLATION_CHECK_INTERVAL_MS) {
					lastCancellationCheck = now;
					const cancelled = await actionCtx.runQuery(internal.streaming.isStreamCancelled, {
						streamId: streamId,
					});
					if (cancelled) {
						isCancelled = true;
						logger.debug("Stream cancelled by user", { streamId });
						// Close the reader to stop receiving data
						await reader.cancel();
						break;
					}
				}

				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const data = line.slice(6);
					if (data === "[DONE]") continue;

					try {
						const parsed = JSON.parse(data);
						const delta = parsed.choices?.[0]?.delta;

						if (delta?.content) {
							fullContent += delta.content;
							await chunkAppender(delta.content);

							// Redis streaming: batch tokens for efficient network usage
							if (redisStreamId) {
								pendingTokenBatch.push(delta.content);
								const now = Date.now();
								// Flush batch when size threshold reached or time interval elapsed (with non-empty check)
								if (
									pendingTokenBatch.length >= REDIS_TOKEN_BATCH_SIZE ||
									(pendingTokenBatch.length > 0 && now - lastBatchFlush >= REDIS_TOKEN_BATCH_INTERVAL_MS)
								) {
									try {
										await flushTokenBatch();
									} catch (error) {
										logger.error("Failed to flush token batch", error);
										// Don't rethrow - continue streaming
									}
								}
							}

							// Always do periodic database saves for reliable streaming
							// This ensures content is persisted regardless of Redis status
							chunkCount++;
							if (chunkCount % CHUNKS_PER_UPDATE === 0) {
								await actionCtx.runMutation(internal.streaming.updateStreamContent, {
									messageId: messageId as Id<"messages">,
									content: fullContent,
									reasoning: fullReasoning.length > 0 ? fullReasoning : undefined,
								});
							}
						}

						// Handle reasoning content from OpenRouter
						// OpenRouter returns reasoning in different formats depending on model:
						// - delta.reasoning_details: array of objects - type varies by provider:
						//   - Anthropic: { type: "reasoning.text", text: "..." }
						//   - Others: { type: "text", text: "..." }
						// - delta.reasoning: string format (some providers)
						// - choice.reasoning_details: array at choice level (non-streaming)
						let reasoningChunk: string | null = null;

						// Check for reasoning_details array (OpenRouter's primary format)
						if (delta?.reasoning_details && Array.isArray(delta.reasoning_details)) {
							// Extract text from reasoning_details array
							// Handle multiple type formats: "text", "reasoning.text", "reasoning", etc.
							reasoningChunk = delta.reasoning_details
								.filter((item: { type?: string; text?: string }) => {
									// Accept any type that contains "text" or "reasoning" and has text content
									const itemType = item.type?.toLowerCase() || "";
									const hasValidType = itemType.includes("text") || itemType.includes("reasoning") || itemType === "";
									return hasValidType && item.text;
								})
								.map((item: { type?: string; text?: string }) => item.text)
								.join("");
						}
						// Fallback: check for reasoning string
						else if (delta?.reasoning && typeof delta.reasoning === "string") {
							reasoningChunk = delta.reasoning;
						}

						if (reasoningChunk) {
							if (!reasoningStartTime) {
								reasoningStartTime = Date.now();
							}
							fullReasoning += reasoningChunk;
							reasoningEndTime = Date.now();

							// Also stream reasoning to Redis with prefix
							if (redisStreamId) {
								pendingTokenBatch.push(`[reasoning]${reasoningChunk}`);
								const now = Date.now();
								// Flush batch when size threshold reached or time interval elapsed (with non-empty check)
								if (
									pendingTokenBatch.length >= REDIS_TOKEN_BATCH_SIZE ||
									(pendingTokenBatch.length > 0 && now - lastBatchFlush >= REDIS_TOKEN_BATCH_INTERVAL_MS)
								) {
									try {
										await flushTokenBatch();
									} catch (error) {
										logger.error("Failed to flush token batch", error);
										// Don't rethrow - continue streaming
									}
								}
							}

							// CRITICAL: Also save reasoning to DB for getStreamBody query
							// Reasoning comes before content, so we need frequent saves here
							// to enable real-time reasoning display via Convex queries
							reasoningChunkCount++;
							if (reasoningChunkCount % REASONING_CHUNKS_PER_UPDATE === 0) {
								await actionCtx.runMutation(internal.streaming.updateStreamContent, {
									messageId: messageId as Id<"messages">,
									content: fullContent,
									reasoning: fullReasoning,
								});
							}
						}
					} catch (parseError) {
						// Log JSON parse errors for debugging OpenRouter protocol issues
						logger.warn("Failed to parse streaming chunk", {
							data: data.slice(0, 200), // Truncate for logging
							error: parseError instanceof Error ? parseError.message : String(parseError),
						});
					}
				}
			}

			// Flush any remaining tokens to Redis
			if (redisStreamId) {
				try {
					await flushTokenBatch();
				} catch (error) {
					logger.error("Failed to flush final token batch", error);
					// Don't rethrow - continue to finalize stream
				}
			}

			// Calculate thinking time
			const thinkingTimeMs = reasoningStartTime && reasoningEndTime
				? reasoningEndTime - reasoningStartTime
				: undefined;

			// Finalize Redis stream
			if (redisStreamId) {
				try {
					const totalTokens = fullContent.split(/\s+/).length; // Simple word-based estimate
					await redisStreamOps.finalizeStream(redisStreamId, fullContent, totalTokens);
					logger.debug("Redis stream finalized", { redisStreamId, totalTokens });
				} catch (error) {
					logger.error("Failed to finalize Redis stream", error);
					// Don't fail - Convex write is the source of truth
				}
			}

			// CRITICAL: Update the message record with final content
			// This runs even if the client disconnects - ensuring content is saved
			// Skip if cancelled - the cancelStream mutation already set the status
			if (isCancelled) {
				// Just save the partial content, status is already "cancelled"
				await actionCtx.runMutation(internal.streaming.updateStreamContent, {
					messageId: messageId as Id<"messages">,
					content: fullContent,
					reasoning: fullReasoning.length > 0 ? fullReasoning : undefined,
				});
				logger.debug("Stream cancelled, saved partial content", {
					streamId,
					contentLength: fullContent.length,
					reasoningLength: fullReasoning.length
				});
				return;
			}

			await actionCtx.runMutation(internal.streaming.completeStream, {
				messageId: messageId as Id<"messages">,
				content: fullContent,
				reasoning: fullReasoning.length > 0 ? fullReasoning : undefined,
				thinkingTimeMs,
				reasoningRequested: hasReasoning,
			});
		};

		// Use the persistent streaming component
		// Type assertion needed because httpAction ctx is GenericActionCtx<any>
		// but stream() expects GenericActionCtx<GenericDataModel>
		const streamResponse = await persistentTextStreaming.stream(
			ctx as Parameters<typeof persistentTextStreaming.stream>[0],
			request,
			streamId as StreamId,
			generateResponse
		);

		// Add CORS headers
		const headers = new Headers(streamResponse.headers);
		if (corsOrigin) {
			headers.set("Access-Control-Allow-Origin", corsOrigin);
			headers.set("Vary", "Origin");
		}

		// Add Redis stream ID header for client SSE connection
		if (redisStreamId) {
			headers.set("X-Stream-Id", redisStreamId);
			headers.set("Access-Control-Expose-Headers", "X-Stream-Id");
		}

		return new Response(streamResponse.body, {
			status: streamResponse.status,
			headers,
		});
	} catch (error) {
		logger.error("Stream error", error);
		return new Response(
			JSON.stringify({
				error: "Stream failed",
			}),
			{
				status: 500,
				headers: withCorsHeaders({ "Content-Type": "application/json" }),
			}
		);
	}
});
