import type { Id } from "./_generated/dataModel";
import { assertOwnsChat } from "./chats";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { incrementStat, STAT_KEYS } from "./lib/dbStats";
import { rateLimiter } from "./lib/rateLimiter";
import { throwRateLimitError } from "./lib/rateLimitUtils";
import { requireAuthUserId } from "./lib/auth";

// Tool invocation validator - DEPRECATED: used for legacy format
const toolInvocationValidator = v.object({
	toolName: v.string(),
	toolCallId: v.string(),
	state: v.string(), // "input-streaming" | "input-available" | "output-available" | "output-error"
	input: v.optional(v.any()),
	output: v.optional(v.any()),
	errorText: v.optional(v.string()),
});

// NEW: Unified chain of thought part validator - preserves stream order
const chainOfThoughtPartValidator = v.object({
	// Part type: "reasoning" for thinking, "tool" for tool calls
	type: v.union(v.literal("reasoning"), v.literal("tool")),
	// Original position in the AI stream (for ordering)
	index: v.number(),
	// For reasoning parts
	text: v.optional(v.string()),
	// For tool parts
	toolName: v.optional(v.string()),
	toolCallId: v.optional(v.string()),
	state: v.optional(v.string()), // "input-streaming" | "input-available" | "output-available" | "output-error"
	input: v.optional(v.any()),
	output: v.optional(v.any()),
	errorText: v.optional(v.string()),
});

// Error metadata validator - for storing AI errors inline in conversation (like T3.chat)
const errorValidator = v.object({
	code: v.string(), // "rate_limit", "auth_error", "model_error", "network_error", "content_filter", "context_length", "unknown"
	message: v.string(),
	details: v.optional(v.string()),
	provider: v.optional(v.string()),
	retryable: v.optional(v.boolean()),
});

// Message type validator
const messageTypeValidator = v.optional(
	v.union(v.literal("text"), v.literal("error"), v.literal("system"))
);

// Return type for list query - excludes redundant fields to reduce bandwidth
const messageDoc = v.object({
	_id: v.id("messages"),
	clientMessageId: v.optional(v.string()),
	role: v.string(),
	content: v.string(),
	modelId: v.optional(v.string()),
	provider: v.optional(v.string()),
	reasoningEffort: v.optional(v.string()),
	webSearchEnabled: v.optional(v.boolean()),
	webSearchUsed: v.optional(v.boolean()),
	webSearchCallCount: v.optional(v.number()),
	toolCallCount: v.optional(v.number()),
	maxSteps: v.optional(v.number()),
	// DEPRECATED: Use chainOfThoughtParts instead
	reasoning: v.optional(v.string()),
	thinkingTimeMs: v.optional(v.number()),
	thinkingTimeSec: v.optional(v.number()),
	reasoningCharCount: v.optional(v.number()),
	reasoningChunkCount: v.optional(v.number()),
	reasoningTokenCount: v.optional(v.number()),
	// REASONING REDACTED: Whether reasoning was requested for this message
	// Used to show "redacted" state when provider doesn't return reasoning data
	reasoningRequested: v.optional(v.boolean()),
	// DEPRECATED: Use chainOfThoughtParts instead
	// Tool invocations that occurred during message generation
	toolInvocations: v.optional(v.array(toolInvocationValidator)),
	// NEW: Unified chain of thought parts - preserves exact stream order
	chainOfThoughtParts: v.optional(v.array(chainOfThoughtPartValidator)),
	// STREAM RECONNECTION: Include status and streamId to support reconnecting to active streams
	status: v.optional(v.string()),
	streamId: v.optional(v.string()),
	attachments: v.optional(
		v.array(
			v.object({
				storageId: v.id("_storage"),
				filename: v.string(),
				contentType: v.string(),
				size: v.number(),
				uploadedAt: v.number(),
				url: v.optional(v.string()),
			})
		)
	),
	// ERROR HANDLING: Error metadata for failed AI responses (displayed inline like T3.chat)
	error: v.optional(errorValidator),
	// Message type: "text" (default), "error", "system"
	messageType: messageTypeValidator,
	createdAt: v.number(),
	deletedAt: v.optional(v.number()),
});

export const list = query({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.array(messageDoc),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await assertOwnsChat(ctx, args.chatId, userId);
		if (!chat) return [];
		// PERFORMANCE OPTIMIZATION: Use by_chat_not_deleted index to filter soft-deleted messages at index level
		// This is much faster than loading all messages and filtering in JavaScript
		// Index structure: [chatId, deletedAt, createdAt] allows efficient filtering and ordering
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_chat_not_deleted", (q) =>
				q.eq("chatId", args.chatId).eq("deletedAt", undefined)
			)
			.order("asc")
			.collect();

		// PERFORMANCE OPTIMIZATION: Batch fetch file URLs to avoid N+1 queries
		// Collect all unique storage IDs from all message attachments
		const allStorageIds: Id<"_storage">[] = [];
		for (const message of messages) {
			if (message.attachments) {
				for (const attachment of message.attachments) {
					allStorageIds.push(attachment.storageId);
				}
			}
		}

		// Fetch all URLs in a single batch if there are any attachments
		let urlMap = new Map<Id<"_storage">, string | null>();
		if (allStorageIds.length > 0) {
			// Remove duplicates
			const uniqueStorageIds = Array.from(new Set(allStorageIds));

			// Fetch URLs in parallel
			const urlPromises = uniqueStorageIds.map(async (storageId) => {
				try {
					const url = await ctx.storage.getUrl(storageId);
					return { storageId, url };
				} catch {
					return { storageId, url: null };
				}
			});

			const urlResults = await Promise.all(urlPromises);
			for (const { storageId, url } of urlResults) {
				urlMap.set(storageId, url);
			}
		}

		// Attach URLs to message attachments
		const messagesWithUrls = messages.map((message) => {
			if (!message.attachments || message.attachments.length === 0) {
				return message;
			}

			return {
				...message,
				attachments: message.attachments.map((attachment) => ({
					...attachment,
					url: urlMap.get(attachment.storageId) ?? undefined,
				})),
			};
		});

		// PERFORMANCE OPTIMIZATION: Filter out redundant fields to reduce bandwidth
		// Remove fields that are duplicates or not used by the client:
		// - _creationTime: duplicates createdAt
		// - chatId: client already knows it from request context
		// - userId: not used by UI
		// This reduces payload size by ~10% per message
		return messagesWithUrls.map((msg) => ({
			_id: msg._id,
			clientMessageId: msg.clientMessageId,
			role: msg.role,
			content: msg.content,
			modelId: msg.modelId,
			provider: msg.provider,
			reasoningEffort: msg.reasoningEffort,
			webSearchEnabled: msg.webSearchEnabled,
			webSearchUsed: msg.webSearchUsed,
			webSearchCallCount: msg.webSearchCallCount,
			toolCallCount: msg.toolCallCount,
			maxSteps: msg.maxSteps,
			// DEPRECATED: Include for backward compatibility with old messages
			reasoning: msg.reasoning,
			thinkingTimeMs: msg.thinkingTimeMs,
			thinkingTimeSec: msg.thinkingTimeSec,
			reasoningCharCount: msg.reasoningCharCount,
			reasoningChunkCount: msg.reasoningChunkCount,
			reasoningTokenCount: msg.reasoningTokenCount,
			// REASONING REDACTED: Include to detect when reasoning was requested but not returned
			reasoningRequested: msg.reasoningRequested,
			// DEPRECATED: Include for backward compatibility with old messages
			toolInvocations: msg.toolInvocations,
			// NEW: Unified chain of thought parts with preserved order
			chainOfThoughtParts: msg.chainOfThoughtParts,
			// STREAM RECONNECTION: Include status and streamId for reconnecting to active streams on reload
			status: msg.status,
			streamId: msg.streamId,
			attachments: msg.attachments,
			// ERROR HANDLING: Include error metadata for inline error display
			error: msg.error,
			messageType: msg.messageType,
			createdAt: msg.createdAt,
			deletedAt: msg.deletedAt,
		}));
	},
});

export const getFirstUserMessage = query({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await assertOwnsChat(ctx, args.chatId, userId);
		if (!chat) return null;

		const message = await ctx.db
			.query("messages")
			.withIndex("by_chat_not_deleted", (q) =>
				q.eq("chatId", args.chatId).eq("deletedAt", undefined)
			)
			.filter((q) => q.eq(q.field("role"), "user"))
			.order("asc")
			.first();

		return message?.content ?? null;
	},
});

/**
 * Get active streaming message for a chat (for reconnection after page reload)
 * Returns the streamId if there's a message currently streaming
 */
export const getActiveStream = query({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await assertOwnsChat(ctx, args.chatId, userId);
		if (!chat) return null;

		// Find the most recent message with status="streaming"
		const streamingMessage = await ctx.db
			.query("messages")
			.withIndex("by_chat_not_deleted", (q) =>
				q.eq("chatId", args.chatId).eq("deletedAt", undefined)
			)
			.order("desc")
			.filter((q) => q.eq(q.field("status"), "streaming"))
			.first();

		return streamingMessage?.streamId ?? null;
	},
});

export const send = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		userMessage: v.object({
			content: v.string(),
			createdAt: v.optional(v.number()),
			clientMessageId: v.optional(v.string()),
			attachments: v.optional(
				v.array(
					v.object({
						storageId: v.id("_storage"),
						filename: v.string(),
						contentType: v.string(),
						size: v.number(),
						url: v.optional(v.string()),
					})
				)
			),
		}),
		assistantMessage: v.optional(
			v.object({
				content: v.string(),
				createdAt: v.optional(v.number()),
				clientMessageId: v.optional(v.string()),
				modelId: v.optional(v.string()),
				provider: v.optional(v.string()),
				reasoningEffort: v.optional(v.string()),
				webSearchEnabled: v.optional(v.boolean()),
				webSearchUsed: v.optional(v.boolean()),
				webSearchCallCount: v.optional(v.number()),
				toolCallCount: v.optional(v.number()),
				maxSteps: v.optional(v.number()),
				// DEPRECATED: Use chainOfThoughtParts instead
				// Reasoning content from AI SDK message parts (type: 'reasoning')
				reasoning: v.optional(v.string()),
				thinkingTimeMs: v.optional(v.number()),
				thinkingTimeSec: v.optional(v.number()),
				reasoningCharCount: v.optional(v.number()),
				reasoningChunkCount: v.optional(v.number()),
				reasoningTokenCount: v.optional(v.number()),
				reasoningRequested: v.optional(v.boolean()),
				// DEPRECATED: Use chainOfThoughtParts instead
				// Tool invocations that occurred during message generation
				toolInvocations: v.optional(v.array(toolInvocationValidator)),
				// NEW: Unified chain of thought parts - preserves exact stream order
				chainOfThoughtParts: v.optional(v.array(chainOfThoughtPartValidator)),
				// Error metadata for failed responses (displayed inline like T3.chat)
				error: v.optional(errorValidator),
				// Message type: "text" (default), "error" for error messages
				messageType: messageTypeValidator,
			}),
		),
	},
	returns: v.object({
		ok: v.boolean(),
		userMessageId: v.optional(v.id("messages")),
		assistantMessageId: v.optional(v.id("messages")),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit message sending
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "messageSend", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("messages sent", retryAfter);
		}

		const chat = await assertOwnsChat(ctx, args.chatId, userId);
		if (!chat) {
			return { ok: false as const, userMessageId: undefined, assistantMessageId: undefined };
		}

		const userCreatedAt = args.userMessage.createdAt ?? Date.now();
		const userMessageId = await insertOrUpdateMessage(ctx, {
			chatId: args.chatId,
			role: "user",
			content: args.userMessage.content,
			createdAt: userCreatedAt,
			clientMessageId: args.userMessage.clientMessageId,
			status: "completed",
			userId,
			attachments: args.userMessage.attachments?.map(a => ({
				...a,
				uploadedAt: Date.now(),
			})),
		});

		let assistantMessageId: Id<"messages"> | null = null;
		const assistantCreatedAt =
			args.assistantMessage?.createdAt ?? userCreatedAt + 1;
		if (args.assistantMessage) {
			assistantMessageId = await insertOrUpdateMessage(ctx, {
				chatId: args.chatId,
				role: "assistant",
				content: args.assistantMessage.content,
				modelId: args.assistantMessage.modelId,
				provider: args.assistantMessage.provider,
				reasoningEffort: args.assistantMessage.reasoningEffort,
				webSearchEnabled: args.assistantMessage.webSearchEnabled,
				webSearchUsed: args.assistantMessage.webSearchUsed,
				webSearchCallCount: args.assistantMessage.webSearchCallCount,
				toolCallCount: args.assistantMessage.toolCallCount,
				maxSteps: args.assistantMessage.maxSteps,
				reasoning: args.assistantMessage.reasoning,
				thinkingTimeMs: args.assistantMessage.thinkingTimeMs,
				thinkingTimeSec: args.assistantMessage.thinkingTimeSec,
				reasoningCharCount: args.assistantMessage.reasoningCharCount,
				reasoningChunkCount: args.assistantMessage.reasoningChunkCount,
				reasoningTokenCount: args.assistantMessage.reasoningTokenCount,
				reasoningRequested: args.assistantMessage.reasoningRequested,
				toolInvocations: args.assistantMessage.toolInvocations,
				chainOfThoughtParts: args.assistantMessage.chainOfThoughtParts,
				createdAt: assistantCreatedAt,
				clientMessageId: args.assistantMessage.clientMessageId,
				status: "completed",
				userId,
				error: args.assistantMessage.error,
				messageType: args.assistantMessage.messageType,
			});
		}

		await ctx.db.patch(args.chatId, {
			updatedAt: assistantCreatedAt ?? userCreatedAt,
			lastMessageAt: assistantCreatedAt ?? userCreatedAt,
		});

		return {
			ok: true as const,
			userMessageId,
			assistantMessageId: assistantMessageId ?? undefined,
		};
	},
});

export const streamUpsert = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		messageId: v.optional(v.id("messages")),
		clientMessageId: v.optional(v.string()),
		role: v.string(),
		content: v.string(),
		modelId: v.optional(v.string()),
		provider: v.optional(v.string()),
		reasoningEffort: v.optional(v.string()),
		webSearchEnabled: v.optional(v.boolean()),
		webSearchUsed: v.optional(v.boolean()),
		webSearchCallCount: v.optional(v.number()),
		toolCallCount: v.optional(v.number()),
		maxSteps: v.optional(v.number()),
		reasoning: v.optional(v.string()),
		thinkingTimeMs: v.optional(v.number()),
		thinkingTimeSec: v.optional(v.number()),
		reasoningCharCount: v.optional(v.number()),
		reasoningChunkCount: v.optional(v.number()),
		reasoningTokenCount: v.optional(v.number()),
		reasoningRequested: v.optional(v.boolean()),
		toolInvocations: v.optional(v.array(toolInvocationValidator)),
		chainOfThoughtParts: v.optional(v.array(chainOfThoughtPartValidator)),
		createdAt: v.optional(v.number()),
		status: v.optional(v.string()),
		attachments: v.optional(
			v.array(
				v.object({
					storageId: v.id("_storage"),
					filename: v.string(),
					contentType: v.string(),
					size: v.number(),
					uploadedAt: v.number(),
					url: v.optional(v.string()),
				})
			)
		),
	},
	returns: v.object({
		ok: v.boolean(),
		messageId: v.optional(v.id("messages")),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit stream updates (high limit for AI streaming)
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "messageStreamUpsert", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("stream updates", retryAfter);
		}

		const chat = await assertOwnsChat(ctx, args.chatId, userId);
		if (!chat) {
			return { ok: false as const, messageId: undefined };
		}
		const timestamp = args.createdAt ?? Date.now();
		const messageId = await insertOrUpdateMessage(ctx, {
			chatId: args.chatId,
			role: args.role,
			content: args.content,
			modelId: args.modelId,
			provider: args.provider,
			reasoningEffort: args.reasoningEffort,
			webSearchEnabled: args.webSearchEnabled,
			webSearchUsed: args.webSearchUsed,
			webSearchCallCount: args.webSearchCallCount,
			toolCallCount: args.toolCallCount,
			maxSteps: args.maxSteps,
			reasoning: args.reasoning,
			thinkingTimeMs: args.thinkingTimeMs,
			thinkingTimeSec: args.thinkingTimeSec,
			reasoningCharCount: args.reasoningCharCount,
			reasoningChunkCount: args.reasoningChunkCount,
			reasoningTokenCount: args.reasoningTokenCount,
			reasoningRequested: args.reasoningRequested,
			toolInvocations: args.toolInvocations,
			chainOfThoughtParts: args.chainOfThoughtParts,
			createdAt: timestamp,
			status: args.status ?? "streaming",
			clientMessageId: args.clientMessageId,
			overrideId: args.messageId ?? undefined,
			userId,
			attachments: args.attachments,
		});

		if (args.status === "completed" && (args.role === "assistant" || args.role === "user")) {
			const patchTimestamp = args.role === "assistant" ? Date.now() : timestamp;
			await ctx.db.patch(args.chatId, {
				lastMessageAt: patchTimestamp,
				updatedAt: patchTimestamp,
			});
		}

		return { ok: true as const, messageId };
	},
});

const MAX_MESSAGE_CONTENT_LENGTH = 100 * 1024; // 100KB

// SECURITY: Maximum messages per chat to prevent DoS and database bloat
const MAX_MESSAGES_PER_CHAT = 10_000;

// SECURITY: Allowed message roles (reject any other values)
const ALLOWED_ROLES = ["user", "assistant"] as const;
type MessageRole = typeof ALLOWED_ROLES[number];

function validateRole(role: string): MessageRole {
	if (!ALLOWED_ROLES.includes(role as MessageRole)) {
		throw new Error(
			`Invalid message role: "${role}". Only "user" and "assistant" are allowed.`,
		);
	}
	return role as MessageRole;
}

// Type for tool invocation data (DEPRECATED)
type ToolInvocationData = {
	toolName: string;
	toolCallId: string;
	state: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
};

// NEW: Type for chain of thought part
type ChainOfThoughtPartData = {
	type: "reasoning" | "tool";
	index: number;
	text?: string;
	toolName?: string;
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
};

// Type for error metadata
type ErrorData = {
	code: string;
	message: string;
	details?: string;
	provider?: string;
	retryable?: boolean;
};

// Type for message type
type MessageType = "text" | "error" | "system";

async function insertOrUpdateMessage(
	ctx: MutationCtx,
	args: {
		chatId: Id<"chats">;
		role: string;
		content: string;
		modelId?: string | null;
		provider?: string | null;
		reasoningEffort?: string | null;
		webSearchEnabled?: boolean | null;
		webSearchUsed?: boolean | null;
		webSearchCallCount?: number | null;
		toolCallCount?: number | null;
		maxSteps?: number | null;
		reasoning?: string | null;
		thinkingTimeMs?: number | null;
		thinkingTimeSec?: number | null;
		reasoningCharCount?: number | null;
		reasoningChunkCount?: number | null;
		reasoningTokenCount?: number | null;
		reasoningRequested?: boolean | null;
		toolInvocations?: ToolInvocationData[] | null;
		// NEW: Unified chain of thought parts
		chainOfThoughtParts?: ChainOfThoughtPartData[] | null;
		createdAt: number;
		status: string;
		clientMessageId?: string | null;
		overrideId?: Id<"messages">;
		userId?: Id<"users">;
		attachments?: Array<{
			storageId: Id<"_storage">;
			filename: string;
			contentType: string;
			size: number;
			uploadedAt: number;
		}>;
		// Error metadata for failed AI responses
		error?: ErrorData | null;
		// Message type: "text", "error", "system"
		messageType?: MessageType | null;
	},
) {
	// SECURITY: Validate role is exactly "user" or "assistant"
	const validatedRole = validateRole(args.role);

	// Validate message content length (100KB max) - count actual bytes, not string length
	const contentBytes = new TextEncoder().encode(args.content).length;
	if (contentBytes > MAX_MESSAGE_CONTENT_LENGTH) {
		throw new Error(
			`Message content exceeds maximum length of ${MAX_MESSAGE_CONTENT_LENGTH} bytes`,
		);
	}
	let targetId = args.overrideId;
	if (!targetId && args.clientMessageId) {
		const existing = await ctx.db
			.query("messages")
			.withIndex("by_client_id", (q) =>
				q.eq("chatId", args.chatId).eq("clientMessageId", args.clientMessageId!),
			)
			.unique();
		// Only reuse the message if it hasn't been soft-deleted
		if (existing && !existing.deletedAt) {
			targetId = existing._id;
		}
	}

	// SECURITY: Check message count limit before inserting new message
	// Only check if we're creating a new message (not updating existing)
	if (!targetId) {
		// PERFORMANCE OPTIMIZATION: Use messageCount field from chat document instead of counting
		// This avoids expensive query that loads all messages just to count them
		// Before: O(n) query loading all messages, After: O(1) field lookup
		// RACE CONDITION FIX: Fetch chat once and reuse for both check and increment
		const chat = await ctx.db.get(args.chatId);
		const messageCount = chat?.messageCount ?? 0;

		if (messageCount >= MAX_MESSAGES_PER_CHAT) {
			throw new Error(
				`Chat has reached maximum message limit of ${MAX_MESSAGES_PER_CHAT}. Please create a new chat.`,
			);
		}

		targetId = await ctx.db.insert("messages", {
			chatId: args.chatId,
			clientMessageId: args.clientMessageId ?? undefined,
			role: validatedRole,
			content: args.content,
			modelId: args.modelId ?? undefined,
			provider: args.provider ?? undefined,
			reasoningEffort: args.reasoningEffort ?? undefined,
			webSearchEnabled: args.webSearchEnabled ?? undefined,
			webSearchUsed: args.webSearchUsed ?? undefined,
			webSearchCallCount: args.webSearchCallCount ?? undefined,
			toolCallCount: args.toolCallCount ?? undefined,
			maxSteps: args.maxSteps ?? undefined,
			reasoning: args.reasoning ?? undefined,
			thinkingTimeMs: args.thinkingTimeMs ?? undefined,
			thinkingTimeSec: args.thinkingTimeSec ?? undefined,
			reasoningCharCount: args.reasoningCharCount ?? undefined,
			reasoningChunkCount: args.reasoningChunkCount ?? undefined,
			reasoningTokenCount: args.reasoningTokenCount ?? undefined,
			reasoningRequested: args.reasoningRequested ?? undefined,
			toolInvocations: args.toolInvocations ?? undefined,
			chainOfThoughtParts: args.chainOfThoughtParts ?? undefined,
			createdAt: args.createdAt,
			status: args.status,
			userId: args.userId ?? undefined,
			attachments: args.attachments ?? undefined,
			error: args.error ?? undefined,
			messageType: args.messageType ?? undefined,
		});

		// PERFORMANCE OPTIMIZATION: Increment messageCount when creating new message
		// Reuse the chat we already fetched to avoid redundant db.get() call
		if (chat) {
			await ctx.db.patch(args.chatId, {
				messageCount: messageCount + 1,
			});
		}

		// PERFORMANCE OPTIMIZATION: Update global stats counter
		await incrementStat(ctx, STAT_KEYS.MESSAGES_TOTAL);
	} else {
		await ctx.db.patch(targetId, {
			clientMessageId: args.clientMessageId ?? undefined,
			role: validatedRole,
			content: args.content,
			modelId: args.modelId ?? undefined,
			provider: args.provider ?? undefined,
			reasoningEffort: args.reasoningEffort ?? undefined,
			webSearchEnabled: args.webSearchEnabled ?? undefined,
			webSearchUsed: args.webSearchUsed ?? undefined,
			webSearchCallCount: args.webSearchCallCount ?? undefined,
			toolCallCount: args.toolCallCount ?? undefined,
			maxSteps: args.maxSteps ?? undefined,
			reasoning: args.reasoning ?? undefined,
			thinkingTimeMs: args.thinkingTimeMs ?? undefined,
			thinkingTimeSec: args.thinkingTimeSec ?? undefined,
			reasoningCharCount: args.reasoningCharCount ?? undefined,
			reasoningChunkCount: args.reasoningChunkCount ?? undefined,
			reasoningTokenCount: args.reasoningTokenCount ?? undefined,
			reasoningRequested: args.reasoningRequested ?? undefined,
			toolInvocations: args.toolInvocations ?? undefined,
			chainOfThoughtParts: args.chainOfThoughtParts ?? undefined,
			createdAt: args.createdAt,
			status: args.status,
			userId: args.userId ?? undefined,
			attachments: args.attachments ?? undefined,
			error: args.error ?? undefined,
			messageType: args.messageType ?? undefined,
		});
	}
	return targetId;
}
