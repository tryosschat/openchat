import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Note: Authentication is handled by Better Auth (stored in Convex via betterAuth component)
export default defineSchema({
	users: defineTable({
		externalId: v.string(),
		email: v.optional(v.string()),
		// NOTE: Profile fields below are kept for backwards compatibility during migration
		// They will be removed after profiles table migration is complete
		name: v.optional(v.string()),
		avatarUrl: v.optional(v.string()),
		encryptedOpenRouterKey: v.optional(v.string()),
		// File upload quota tracking
		fileUploadCount: v.optional(v.number()),
		// Daily search usage tracking
		searchUsageCount: v.optional(v.number()),
		searchUsageDate: v.optional(v.string()), // "YYYY-MM-DD" format (UTC)
		// Daily AI usage tracking (cents, UTC date)
		aiUsageCents: v.optional(v.number()),
		aiUsageDate: v.optional(v.string()), // "YYYY-MM-DD" format (UTC)
		// Admin ban status (for manual bans)
		banned: v.optional(v.boolean()),
		bannedAt: v.optional(v.number()),
		banReason: v.optional(v.string()),
		banExpiresAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_external_id", ["externalId"])
		.index("by_email", ["email"])
		.index("by_banned", ["banned"]),

	// Profile data separated from auth data (T3Chat pattern)
	// This allows lean users table for auth + profiles for app-specific data
	profiles: defineTable({
		userId: v.id("users"), // FK to users table
		name: v.optional(v.string()),
		avatarUrl: v.optional(v.string()),
		encryptedOpenRouterKey: v.optional(v.string()),
		fileUploadCount: v.optional(v.number()),
		favoriteModels: v.optional(v.array(v.string())),
		preferences: v.optional(
			v.object({
				theme: v.optional(v.string()),
			})
		),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_user", ["userId"]),
	chats: defineTable({
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
	})
		.index("by_user", ["userId", "updatedAt"])
		.index("by_user_created", ["userId", "createdAt"])
		.index("by_user_last_message", ["userId", "lastMessageAt"])
		.index("by_user_not_deleted", ["userId", "deletedAt", "updatedAt"])
		.index("by_user_title", ["userId", "title"]),
	messages: defineTable({
		chatId: v.id("chats"),
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
		toolInvocations: v.optional(
			v.array(
				v.object({
					toolName: v.string(),
					toolCallId: v.string(),
					state: v.string(),
					input: v.optional(v.any()),
					output: v.optional(v.any()),
					errorText: v.optional(v.string()),
				})
			)
		),
		chainOfThoughtParts: v.optional(
			v.array(
				v.object({
					type: v.union(v.literal("reasoning"), v.literal("tool")),
					index: v.number(),
					text: v.optional(v.string()),
					toolName: v.optional(v.string()),
					toolCallId: v.optional(v.string()),
					state: v.optional(v.string()),
					input: v.optional(v.any()),
					output: v.optional(v.any()),
					errorText: v.optional(v.string()),
				})
			)
		),
		tokenUsage: v.optional(
			v.object({
				promptTokens: v.number(),
				completionTokens: v.number(),
				totalTokens: v.number(),
			})
		),
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
		error: v.optional(
			v.object({
				code: v.string(),
				message: v.string(),
				details: v.optional(v.string()),
				provider: v.optional(v.string()),
				retryable: v.optional(v.boolean()),
			})
		),
		messageType: v.optional(
			v.union(v.literal("text"), v.literal("error"), v.literal("system"))
		),
		createdAt: v.number(),
		status: v.optional(v.string()),
		userId: v.optional(v.id("users")),
		deletedAt: v.optional(v.number()),
		tokensPerSecond: v.optional(v.number()),
		timeToFirstTokenMs: v.optional(v.number()),
		totalDurationMs: v.optional(v.number()),
		streamId: v.optional(v.string()),
		// Legacy field — present on some existing documents but no longer written.
		// Kept so schema validation passes for old rows.
		messageMetadata: v.optional(
			v.object({
				modelId: v.optional(v.string()),
				provider: v.optional(v.string()),
				reasoningEffort: v.optional(v.string()),
				maxSteps: v.optional(v.number()),
				webSearchEnabled: v.optional(v.boolean()),
			})
		),
	})
		.index("by_chat", ["chatId", "createdAt"])
		.index("by_client_id", ["chatId", "clientMessageId"])
		.index("by_user", ["userId"])
		.index("by_user_status", ["userId", "status", "createdAt"])
		.index("by_chat_not_deleted", ["chatId", "deletedAt", "createdAt"])
		.index("by_user_created", ["userId", "createdAt"])
		.index("by_stream_id", ["streamId"])
		.index("by_chat_status", ["chatId", "status", "deletedAt"]),
	fileUploads: defineTable({
		userId: v.id("users"),
		chatId: v.id("chats"),
		storageId: v.id("_storage"),
		filename: v.string(),
		contentType: v.string(),
		size: v.number(),
		uploadedAt: v.number(),
		deletedAt: v.optional(v.number()),
	})
		.index("by_user", ["userId", "uploadedAt"])
		.index("by_chat", ["chatId", "uploadedAt"])
		.index("by_storage", ["storageId"])
		.index("by_user_not_deleted", ["userId", "deletedAt", "uploadedAt"]),
	// PERFORMANCE OPTIMIZATION: Database statistics table for efficient monitoring
	// Stores aggregated counts to avoid expensive full-table scans
	dbStats: defineTable({
		// Unique key for each stat (e.g., "chats_total", "chats_soft_deleted", etc.)
		key: v.string(),
		// Numeric value of the stat
		value: v.number(),
		// Timestamp of last update
		updatedAt: v.number(),
		// Optional metadata for the stat
		metadata: v.optional(v.object({
			description: v.optional(v.string()),
			category: v.optional(v.string()),
		})),
	})
		.index("by_key", ["key"]),
	promptTemplates: defineTable({
		userId: v.id("users"),
		// User-friendly name for the template (e.g., "Code Review", "Bug Fix")
		name: v.string(),
		// Command to trigger template (e.g., "/review", "/fix")
		command: v.string(),
		// Template content with argument placeholders ($ARGUMENTS, $1, $2, etc.)
		template: v.string(),
		// Optional description of what the template does
		description: v.optional(v.string()),
		// Category for organization (e.g., "coding", "writing", "analysis")
		category: v.optional(v.string()),
		// Whether template is shared publicly (future feature)
		isPublic: v.optional(v.boolean()),
		// Draft status - templates can be saved as drafts before publishing
		isDraft: v.optional(v.boolean()),
		// Usage tracking
		usageCount: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
		deletedAt: v.optional(v.number()),
	})
		.index("by_user", ["userId", "deletedAt", "updatedAt"])
		.index("by_command", ["userId", "command"])
		.index("by_category", ["userId", "category", "deletedAt"])
		.index("by_public", ["isPublic", "deletedAt"])
		.index("by_draft", ["userId", "isDraft", "deletedAt"]),
	// Track when users last read each chat (for unread indicators)
	// This persists across sessions/devices, unlike localStorage
	chatReadStatus: defineTable({
		userId: v.id("users"),
		chatId: v.id("chats"),
		lastReadAt: v.number(), // timestamp when user last viewed this chat
	})
		.index("by_user", ["userId"])
		.index("by_user_chat", ["userId", "chatId"]),

	// Background streaming jobs - allows AI generation to continue even if client disconnects
	streamJobs: defineTable({
		chatId: v.id("chats"),
		userId: v.id("users"),
		messageId: v.string(),
		status: v.union(
			v.literal("pending"),
			v.literal("running"),
			v.literal("completed"),
			v.literal("error")
		),
		model: v.string(),
		provider: v.string(),
		messages: v.array(v.object({
			role: v.string(),
			content: v.string(),
		})),
		options: v.optional(v.object({
			enableReasoning: v.optional(v.boolean()),
			reasoningEffort: v.optional(v.string()),
			enableWebSearch: v.optional(v.boolean()),
			supportsToolCalls: v.optional(v.boolean()),
			maxSteps: v.optional(v.number()),
		})),
		content: v.string(),
		reasoning: v.optional(v.string()),
		thinkingTimeMs: v.optional(v.number()),
		thinkingTimeSec: v.optional(v.number()),
		reasoningCharCount: v.optional(v.number()),
		reasoningChunkCount: v.optional(v.number()),
		reasoningTokenCount: v.optional(v.number()),
		reasoningRequested: v.optional(v.boolean()),
		webSearchUsed: v.optional(v.boolean()),
		webSearchCallCount: v.optional(v.number()),
		toolCallCount: v.optional(v.number()),
		chainOfThoughtParts: v.optional(
			v.array(
				v.object({
					type: v.union(v.literal("reasoning"), v.literal("tool")),
					index: v.number(),
					text: v.optional(v.string()),
					toolName: v.optional(v.string()),
					toolCallId: v.optional(v.string()),
					state: v.optional(v.string()),
					input: v.optional(v.any()),
					output: v.optional(v.any()),
					errorText: v.optional(v.string()),
				})
			)
		),
		error: v.optional(v.string()),
		tokenCount: v.optional(v.number()),
		startedAt: v.optional(v.number()),
		completedAt: v.optional(v.number()),
		createdAt: v.number(),
	})
		.index("by_chat", ["chatId", "status"])
		.index("by_user", ["userId", "status"])
		.index("by_status", ["status", "createdAt"]),
});
