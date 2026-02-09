import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { incrementStat, STAT_KEYS } from "./lib/dbStats";
import { rateLimiter } from "./lib/rateLimiter";
import { throwRateLimitError } from "./lib/rateLimitUtils";
import { sanitizeTitle } from "./lib/sanitize";
import { requireAuthUserId, requireAuthUserIdFromAction } from "./lib/auth";
import { decryptSecret } from "./lib/crypto";

const TITLE_MODEL_ID = "google/gemini-2.5-flash-lite";
const TITLE_MAX_LENGTH = 200;
const MAX_FORK_MESSAGE_COPY = 200;

const chatDoc = v.object({
	_id: v.id("chats"),
	_creationTime: v.number(),
	userId: v.id("users"),
	title: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
	lastMessageAt: v.optional(v.number()),
	deletedAt: v.optional(v.number()),
	messageCount: v.optional(v.number()),
	status: v.optional(v.union(v.literal("idle"), v.literal("streaming"))),
	activeStreamId: v.optional(v.string()),
	forkedFromChatId: v.optional(v.id("chats")),
	forkedFromMessageId: v.optional(v.string()),
});

// Optimized chat list response: exclude redundant fields to reduce bandwidth
const chatListItemDoc = v.object({
	_id: v.id("chats"),
	title: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
	lastMessageAt: v.optional(v.number()),
	// Chat status for streaming indicator in sidebar
	status: v.optional(v.string()),
	forkedFromChatId: v.optional(v.id("chats")),
});

// Security configuration: enforce maximum chat list limit
const MAX_CHAT_LIST_LIMIT = 200;
const DEFAULT_CHAT_LIST_LIMIT = 50;

export const list = query({
	args: {
		userId: v.id("users"),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	returns: v.object({
		chats: v.array(chatListItemDoc),
		nextCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// SECURITY: Enforce maximum limit to prevent unbounded queries
		// Even if client requests more, cap at MAX_CHAT_LIST_LIMIT
		let limit = args.limit ?? DEFAULT_CHAT_LIST_LIMIT;

		// Validate and enforce maximum limit
		if (!Number.isFinite(limit) || limit <= 0) {
			limit = DEFAULT_CHAT_LIST_LIMIT;
		} else if (limit > MAX_CHAT_LIST_LIMIT) {
			limit = MAX_CHAT_LIST_LIMIT;
		}

		// PERFORMANCE OPTIMIZATION: Use by_user_not_deleted index to filter soft-deleted chats at index level
		// This is much faster than loading all chats and filtering in JavaScript
		// Index structure: [userId, deletedAt, updatedAt] allows efficient filtering
		const results = await ctx.db
			.query("chats")
			.withIndex("by_user_not_deleted", (q) =>
				q.eq("userId", userId).eq("deletedAt", undefined)
			)
			.order("desc")
			.paginate({
				cursor: args.cursor ?? null,
				numItems: limit,
			});

		// BANDWIDTH OPTIMIZATION: Filter out redundant fields (14% reduction per chat)
		// - userId: All chats belong to querying user (redundant)
		// - _creationTime: Duplicates createdAt field
		// - deletedAt: Always undefined (filtered at index level)
		// - messageCount: Not used in frontend chat list
		return {
			chats: results.page.map(chat => ({
				_id: chat._id,
				title: chat.title,
				createdAt: chat.createdAt,
				updatedAt: chat.updatedAt,
				lastMessageAt: chat.lastMessageAt,
				// Include status for streaming indicator in sidebar
				status: chat.status,
				forkedFromChatId: chat.forkedFromChatId,
			})),
			nextCursor: results.continueCursor ?? null,
		};
	},
});

export const get = query({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.union(chatDoc, v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) return null;
		return chat;
	},
});

export const create = mutation({
	args: {
		userId: v.id("users"),
		title: v.string(),
	},
	returns: v.object({ chatId: v.id("chats") }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const sanitizedTitle = sanitizeTitle(args.title);

		// Simple rate limiting with the package - returns { ok, retryAfter }
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "chatCreate", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("chats created", retryAfter);
		}

		const now = Date.now();
		const chatId = await ctx.db.insert("chats", {
			userId,
			title: sanitizedTitle,
			createdAt: now,
			updatedAt: now,
			lastMessageAt: now,
			messageCount: 0,
			status: "idle",
		});

		await incrementStat(ctx, STAT_KEYS.CHATS_TOTAL);

		return { chatId };
	},
});

export const fork = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		messageId: v.string(),
	},
	returns: v.object({
		newChatId: v.id("chats"),
		messagesCopied: v.number(),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await assertOwnsChat(ctx, args.chatId, userId);
		if (!chat) {
			throw new Error("Chat not found");
		}

		const { ok, retryAfter } = await rateLimiter.limit(ctx, "messageSend", {
			key: userId,
		});
		if (!ok) {
			throwRateLimitError("messages forked", retryAfter);
		}

		const allMessages = await ctx.db
			.query("messages")
			.withIndex("by_chat_not_deleted", (q) =>
				q.eq("chatId", args.chatId).eq("deletedAt", undefined)
			)
			.order("asc")
			.collect();

		const forkIndex = allMessages.findIndex(
			(message) =>
				String(message._id) === args.messageId ||
				message.clientMessageId === args.messageId,
		);
		if (forkIndex === -1) {
			throw new Error("Fork point message not found");
		}

		const messagesToCopy = allMessages
			.slice(0, forkIndex + 1)
			.slice(-MAX_FORK_MESSAGE_COPY);

		const now = Date.now();
		const newChatId = await ctx.db.insert("chats", {
			userId,
			title: `Fork of ${chat.title}`,
			createdAt: now,
			updatedAt: now,
			lastMessageAt: now,
			messageCount: messagesToCopy.length,
			status: "idle",
			forkedFromChatId: args.chatId,
			forkedFromMessageId: args.messageId,
		});

		for (const message of messagesToCopy) {
			await ctx.db.insert("messages", {
				chatId: newChatId,
				clientMessageId: message.clientMessageId,
				role: message.role,
				content: message.content,
				modelId: message.modelId,
				provider: message.provider,
				reasoningEffort: message.reasoningEffort,
				webSearchEnabled: message.webSearchEnabled,
				webSearchUsed: message.webSearchUsed,
				webSearchCallCount: message.webSearchCallCount,
				toolCallCount: message.toolCallCount,
				maxSteps: message.maxSteps,
				reasoning: message.reasoning,
				thinkingTimeMs: message.thinkingTimeMs,
				thinkingTimeSec: message.thinkingTimeSec,
				reasoningCharCount: message.reasoningCharCount,
				reasoningChunkCount: message.reasoningChunkCount,
				reasoningTokenCount: message.reasoningTokenCount,
				reasoningRequested: message.reasoningRequested,
				toolInvocations: message.toolInvocations,
				chainOfThoughtParts: message.chainOfThoughtParts,
				tokenUsage: message.tokenUsage,
				tokensPerSecond: message.tokensPerSecond,
				timeToFirstTokenMs: message.timeToFirstTokenMs,
				totalDurationMs: message.totalDurationMs,
				attachments: message.attachments,
				error: message.error,
				messageType: message.messageType,
				createdAt: message.createdAt,
				status: "completed",
				userId: message.userId,
			});
		}

		await incrementStat(ctx, STAT_KEYS.CHATS_TOTAL, 1);

		return {
			newChatId,
			messagesCopied: messagesToCopy.length,
		};
	},
});

export const remove = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit chat deletions to prevent abuse
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "chatDelete", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("deletions", retryAfter);
		}

		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			return { ok: false } as const;
		}
		const now = Date.now();

		const messages = await ctx.db
			.query("messages")
			.withIndex("by_chat_not_deleted", (q) =>
				q.eq("chatId", args.chatId).eq("deletedAt", undefined)
			)
			.collect();

		await Promise.all(
			messages.map((message) =>
				ctx.db.patch(message._id, {
					deletedAt: now,
				}),
			),
		);

		await ctx.db.patch(args.chatId, {
			deletedAt: now,
			messageCount: 0,
		});

		await incrementStat(ctx, STAT_KEYS.CHATS_SOFT_DELETED);
		await incrementStat(ctx, STAT_KEYS.MESSAGES_SOFT_DELETED, messages.length);

		return { ok: true } as const;
	},
});

// Maximum number of chats that can be deleted in a single bulk operation
const MAX_BULK_DELETE_SIZE = 50;

export const removeBulk = mutation({
	args: {
		chatIds: v.array(v.id("chats")),
		userId: v.id("users"),
	},
	returns: v.object({
		ok: v.boolean(),
		deleted: v.number(),
		failed: v.number(),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Validate bulk size to prevent abuse
		if (args.chatIds.length === 0) {
			return { ok: true, deleted: 0, failed: 0 };
		}

		if (args.chatIds.length > MAX_BULK_DELETE_SIZE) {
			throw new Error(`Cannot delete more than ${MAX_BULK_DELETE_SIZE} chats at once`);
		}

		// Rate limit: consume one token per chat being deleted
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "chatBulkDelete", {
			key: userId,
			count: args.chatIds.length,
		});

		if (!ok) {
			throwRateLimitError("bulk deletions", retryAfter);
		}

		const now = Date.now();
		let deleted = 0;
		let failed = 0;
		let totalMessages = 0;

		// First pass: validate all chats and collect valid ones
		const validChats: Array<{ chatId: Id<"chats"> }> = [];
		for (const chatId of args.chatIds) {
			const chat = await ctx.db.get(chatId);

			// Skip if chat doesn't exist, doesn't belong to user, or is already deleted
			if (!chat || chat.userId !== userId || chat.deletedAt) {
				failed++;
				continue;
			}

			validChats.push({ chatId });
		}

		// Second pass: fetch all messages for valid chats in parallel
		const messagesByChat = await Promise.all(
			validChats.map(async ({ chatId }) => {
				const messages = await ctx.db
					.query("messages")
					.withIndex("by_chat_not_deleted", (q) =>
						q.eq("chatId", chatId).eq("deletedAt", undefined)
					)
					.collect();
				return { chatId, messages };
			})
		);

		// Third pass: soft-delete all messages and chats
		for (const { chatId, messages } of messagesByChat) {
			// Soft-delete all messages for this chat
			await Promise.all(
				messages.map((message) =>
					ctx.db.patch(message._id, {
						deletedAt: now,
					}),
				),
			);

			// Soft-delete the chat
			await ctx.db.patch(chatId, {
				deletedAt: now,
				messageCount: 0,
			});

			deleted++;
			totalMessages += messages.length;
		}

		// Update stats
		if (deleted > 0) {
			await incrementStat(ctx, STAT_KEYS.CHATS_SOFT_DELETED, deleted);
		}
		if (totalMessages > 0) {
			await incrementStat(ctx, STAT_KEYS.MESSAGES_SOFT_DELETED, totalMessages);
		}

		return { ok: deleted > 0, deleted, failed };
	},
});

export async function assertOwnsChat(
	ctx: MutationCtx | QueryCtx,
	chatId: Id<"chats">,
	userId: Id<"users">,
) {
	const chat = await ctx.db.get(chatId);
	if (!chat || chat.userId !== userId || chat.deletedAt) {
		return null;
	}
	return chat;
}

export const checkExportRateLimit = mutation({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit chat exports to prevent abuse
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "chatExport", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("exports", retryAfter);
		}

		return { ok: true } as const;
	},
});

// ============================================================================
// Chat Read Status Functions
// ============================================================================

/**
 * Mark a chat as read by updating the lastReadAt timestamp.
 * Creates a new record if one doesn't exist, otherwise updates the existing one.
 */
export const markChatAsRead = mutation({
	args: {
		userId: v.id("users"),
		chatId: v.id("chats"),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Verify user owns the chat
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			return { ok: false };
		}

		const now = Date.now();

		// Check if a read status record already exists
		const existing = await ctx.db
			.query("chatReadStatus")
			.withIndex("by_user_chat", (q) =>
				q.eq("userId", userId).eq("chatId", args.chatId)
			)
			.unique();

		if (existing) {
			// Update existing record
			await ctx.db.patch(existing._id, { lastReadAt: now });
		} else {
			// Create new record
			await ctx.db.insert("chatReadStatus", {
				userId,
				chatId: args.chatId,
				lastReadAt: now,
			});
		}

		return { ok: true };
	},
});

/**
 * Get all chat read statuses for a user.
 * Returns a map of chatId -> lastReadAt timestamp.
 */
export const getChatReadStatuses = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.array(
		v.object({
			chatId: v.id("chats"),
			lastReadAt: v.number(),
		})
	),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const statuses = await ctx.db
			.query("chatReadStatus")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();

		return statuses.map((s) => ({
			chatId: s.chatId,
			lastReadAt: s.lastReadAt,
		}));
	},
});

// ============================================================================
// Chat Title Update Function
// ============================================================================

const TITLE_STYLE_PROMPTS: Record<"short" | "standard" | "long", string> = {
	short: "Use 2-4 words.",
	standard: "Use 4-6 words.",
	long: "Use 7-10 words.",
};

export const generateTitle = action({
	args: {
		userId: v.id("users"),
		seedText: v.string(),
		length: v.union(v.literal("short"), v.literal("standard"), v.literal("long")),
		provider: v.union(v.literal("osschat"), v.literal("openrouter")),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (_ctx, args) => {
		const userId = await requireAuthUserIdFromAction(_ctx, args.userId);
		await _ctx.runMutation(internal.chats.enforceTitleRateLimit, {
			userId,
		});

		const seedText = args.seedText.trim();
		if (!seedText) return null;

		let openRouterKey: string | null = null;
		if (args.provider === "osschat") {
			openRouterKey = process.env.OPENROUTER_API_KEY ?? null;
		} else {
			const encryptedKey = await _ctx.runQuery(internal.users.getOpenRouterKeyInternal, {
				userId,
			});
			openRouterKey = encryptedKey ? await decryptSecret(encryptedKey) : null;
		}
		if (!openRouterKey) return null;

		const systemPrompt = [
			"Create a specific, useful chat title.",
			"Return only the title in Title Case; no quotes, no trailing punctuation.",
			"Focus on the core topic or task; avoid filler words like 'and', 'with', 'about'.",
			TITLE_STYLE_PROMPTS[args.length],
		].join(" ");

		try {
			const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${openRouterKey}`,
					"HTTP-Referer": process.env.CONVEX_SITE_URL || "https://osschat.io",
					"X-Title": "OSSChat",
				},
				body: JSON.stringify({
					model: TITLE_MODEL_ID,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: seedText },
					],
					temperature: 0.2,
					max_tokens: 32,
				}),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				console.warn("[Chat Title] OpenRouter error:", response.status, errorBody);
				return null;
			}

			const data = (await response.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			const content = data.choices?.[0]?.message?.content;
			if (!content) return null;

			let title = content.trim();
			if (
				(title.startsWith("\"") && title.endsWith("\"")) ||
				(title.startsWith("'") && title.endsWith("'"))
			) {
				title = title.slice(1, -1).trim();
			}

			const sanitizedTitle = sanitizeTitle(title, TITLE_MAX_LENGTH);
			return sanitizedTitle || null;
		} catch (error) {
			console.warn("[Chat Title] Failed to generate title:", error);
			return null;
		}
	},
});

export const enforceTitleRateLimit = internalMutation({
	args: {
		userId: v.id("users"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "chatTitleGenerate", {
			key: args.userId,
		});

		if (!ok) {
			throwRateLimitError("title generations", retryAfter);
		}

		return null;
	},
});

/**
 * Update a chat's title if it's still the default "New Chat" or empty.
 * Used to automatically generate titles from the first user message.
 */
export const updateTitle = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		title: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			return null;
		}

		if (chat.title === "New Chat" || !chat.title) {
			const sanitizedTitle = sanitizeTitle(args.title, TITLE_MAX_LENGTH);
			await ctx.db.patch(args.chatId, {
				title: sanitizedTitle,
				updatedAt: Date.now(),
			});
		}

		return null;
	},
});

/**
 * Force set a chat title (used for manual regeneration).
 */
export const setTitle = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		title: v.string(),
		updateUpdatedAt: v.optional(v.boolean()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			return null;
		}

		const sanitizedTitle = sanitizeTitle(args.title, TITLE_MAX_LENGTH);
		const shouldUpdateTimestamp = args.updateUpdatedAt ?? true;
		await ctx.db.patch(args.chatId, {
			title: sanitizedTitle,
			updatedAt: shouldUpdateTimestamp ? Date.now() : chat.updatedAt,
		});

		return null;
	},
});

export const setActiveStream = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		streamId: v.union(v.string(), v.null()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			return null;
		}

		await ctx.db.patch(args.chatId, {
			activeStreamId: args.streamId ?? undefined,
			status: args.streamId ? "streaming" : "idle",
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const getActiveStream = query({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId || chat.deletedAt) {
			return null;
		}
		return chat.activeStreamId ?? null;
	},
});
