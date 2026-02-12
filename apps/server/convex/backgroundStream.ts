import { stepCountIs, streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { webSearch } from "@valyu/ai-sdk";
import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
	DAILY_AI_LIMIT_CENTS,
	getCurrentDateKey,
	normalizeUsagePayload,
	calculateUsageCents,
} from "./lib/billingUtils";
import type { UsagePayload } from "./lib/billingUtils";
import {
	adjustDailyUsageInUpstash,
	incrementDailyUsageInUpstash,
	reserveDailyUsageInUpstash,
} from "./lib/upstashUsage";
import { requireAuthUserId } from "./lib/auth";
import { decryptSecret } from "./lib/crypto";
import { rateLimiter } from "./lib/rateLimiter";
import { throwRateLimitError } from "./lib/rateLimitUtils";

const chainOfThoughtPartValidator = v.object({
	type: v.union(v.literal("reasoning"), v.literal("tool")),
	index: v.number(),
	text: v.optional(v.string()),
	toolName: v.optional(v.string()),
	toolCallId: v.optional(v.string()),
	state: v.optional(v.string()),
	input: v.optional(v.any()),
	output: v.optional(v.any()),
	errorText: v.optional(v.string()),
});

const streamOptionsValidator = v.object({
	enableReasoning: v.optional(v.boolean()),
	reasoningEffort: v.optional(v.string()),
	enableWebSearch: v.optional(v.boolean()),
	supportsToolCalls: v.optional(v.boolean()),
	maxSteps: v.optional(v.number()),
	dynamicPrompt: v.optional(v.boolean()),
	jonMode: v.optional(v.boolean()),
});

type ChainOfThoughtPart = {
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

const UPDATE_INTERVAL = 5;
const MAX_SEARCH_RESULTS_FOR_MODEL = 5;
const MAX_SEARCH_SNIPPET_CHARS = 1000;
const MAX_SEARCH_CONTEXT_CHARS = 8000;
const MAX_COMBINED_SEARCH_CONTEXT_CHARS = 12000;
const MAX_PREFETCH_SEARCHES = 5;

function usageFromLanguageModelUsage(usage: {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	reasoningTokens?: number;
	outputTokenDetails?: {
		reasoning?: number;
		reasoningTokens?: number;
	};
	raw?: unknown;
}): UsagePayload {
	const normalizedRaw =
		usage.raw && typeof usage.raw === "object"
			? normalizeUsagePayload(usage.raw as Record<string, unknown>)
			: null;

	return {
		promptTokens: usage.inputTokens ?? normalizedRaw?.promptTokens,
		completionTokens: usage.outputTokens ?? normalizedRaw?.completionTokens,
		totalTokens: usage.totalTokens ?? normalizedRaw?.totalTokens,
		totalCostUsd: normalizedRaw?.totalCostUsd,
		reasoningTokens:
			usage.reasoningTokens ??
			usage.outputTokenDetails?.reasoningTokens ??
			usage.outputTokenDetails?.reasoning ??
			normalizedRaw?.reasoningTokens,
	};
}

function parseToolInput(rawInput: string | undefined): unknown {
	if (!rawInput || rawInput.trim().length === 0) return undefined;
	try {
		return JSON.parse(rawInput);
	} catch {
		return rawInput;
	}
}

function isWebSearchToolName(toolName: string | undefined): boolean {
	if (!toolName) return false;
	const normalized = toolName.toLowerCase();
	return normalized === "websearch" || normalized === "web_search";
}

function getLatestUserSeedText(
	messages: Array<{ role: string; content: string }>,
): string | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		const normalized = message.content.trim().slice(0, 300);
		if (normalized.length > 0) {
			return normalized;
		}
	}
	return null;
}

function truncateText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, Math.max(0, maxChars - 1))}...`;
}

function compactWebSearchOutput(output: unknown): unknown {
	if (!output || typeof output !== "object") return output;
	const raw = output as Record<string, unknown>;
	const rawResults = Array.isArray(raw.results) ? raw.results : null;
	if (!rawResults) return output;

	const compactResults = rawResults
		.slice(0, MAX_SEARCH_RESULTS_FOR_MODEL)
		.map((item) => {
			if (!item || typeof item !== "object") return null;
			const result = item as Record<string, unknown>;
			const title = typeof result.title === "string" ? result.title : undefined;
			const url = typeof result.url === "string" ? result.url : undefined;
			const description =
				typeof result.description === "string"
					? result.description
					: typeof result.content === "string"
						? result.content
						: undefined;
			const snippet = description
				? truncateText(description.replace(/\s+/g, " ").trim(), MAX_SEARCH_SNIPPET_CHARS)
				: undefined;
			return {
				title,
				url,
				snippet,
				source: typeof result.source === "string" ? result.source : undefined,
				publicationDate:
					typeof result.publication_date === "string"
						? result.publication_date
						: undefined,
			};
		})
		.filter((value): value is NonNullable<typeof value> => value !== null);

	return {
		success: raw.success === true,
		query: typeof raw.query === "string" ? raw.query : undefined,
		results: compactResults,
	};
}

function searchOutputToContext(output: unknown): string {
	if (!output || typeof output !== "object") return "";
	const raw = output as Record<string, unknown>;
	const query = typeof raw.query === "string" ? raw.query : "";
	const results = Array.isArray(raw.results) ? raw.results : [];
	const lines: string[] = [];

	if (query) {
		lines.push(`Query: ${query}`);
	}

	let rank = 1;
	for (const item of results) {
		if (!item || typeof item !== "object") continue;
		const result = item as Record<string, unknown>;
		const title = typeof result.title === "string" ? result.title : "Untitled";
		const url = typeof result.url === "string" ? result.url : "";
		const snippet = typeof result.snippet === "string" ? result.snippet : "";
		lines.push(`${rank}. ${title}${url ? ` (${url})` : ""}`);
		if (snippet) {
			lines.push(`   ${truncateText(snippet.replace(/\s+/g, " ").trim(), 400)}`);
		}
		rank++;
	}

	return truncateText(lines.join("\n"), MAX_SEARCH_CONTEXT_CHARS);
}

function extractRequestedSearchCount(userMessage: string): number {
	const lower = userMessage.toLowerCase();
	const numeric = lower.match(/\b(\d{1,2})\s*(?:x\s*)?search(?:es)?\b/);
	if (numeric) {
		const parsed = Number.parseInt(numeric[1] ?? "1", 10);
		if (Number.isFinite(parsed) && parsed > 0) {
			return Math.min(MAX_PREFETCH_SEARCHES, parsed);
		}
	}

	const wordMap: Record<string, number> = {
		one: 1,
		two: 2,
		three: 3,
		four: 4,
		five: 5,
	};
	for (const [word, value] of Object.entries(wordMap)) {
		if (new RegExp(`\\b${word}\\s+search(?:es)?\\b`, "i").test(lower)) {
			return value;
		}
	}

	return 1;
}

function normalizeSearchPrompt(userMessage: string): string {
	const stripped = userMessage
		.replace(/\bsearch(?:\s+the)?\s+web\b/gi, " ")
		.replace(/\b(?:please|can you|could you|hey|assistant)\b/gi, " ")
		.replace(/\b(?:do|run|make)\s+\d+\s+search(?:es)?\b/gi, " ")
		.replace(/\b(?:do|run|make)\s+(?:one|two|three|four|five)\s+search(?:es)?\b/gi, " ")
		.replace(/\b(?:with|using)\s+\d+\s+search(?:es)?\b/gi, " ")
		.replace(/\b(?:with|using)\s+(?:one|two|three|four|five)\s+search(?:es)?\b/gi, " ")
		.replace(/\bsearch(?:es)?\b/gi, " ")
		.replace(/\b(?:do|perform|run)\s+multiple\s+search(?:es)?\b/gi, " ")
		.replace(/\s+/g, " ")
		.replace(/\b(?:and|or|then)\s*$/i, "")
		.replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, "")
		.trim();

	if (stripped.length > 0) return stripped;
	return userMessage.replace(/\s+/g, " ").trim();
}

function buildSearchQueries(userMessage: string, count: number): string[] {
	const base = normalizeSearchPrompt(userMessage);
	const candidates: string[] = [];
	const seen = new Set<string>();
	const push = (value: string) => {
		const query = value.replace(/\s+/g, " ").trim();
		if (!query) return;
		const key = query.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push(query);
	};

	push(base);
	const splitSegments = base
		.split(/\band\b|,|;/gi)
		.map((segment) => segment.trim())
		.filter((segment) => segment.length >= 4);
	for (const segment of splitSegments) {
		push(`${segment} overview`);
	}

	const fallbackVariants = [
		base,
		`${base} overview`,
		`${base} latest research`,
		`${base} expert guide`,
		`${base} facts and examples`,
		`${base} statistics`,
		`${base} best sources`,
	];
	for (const variant of fallbackVariants) {
		push(variant);
	}

	const targetCount = Math.max(1, Math.min(count, MAX_PREFETCH_SEARCHES));
	if (candidates.length < targetCount) {
		for (let i = candidates.length; i < targetCount; i++) {
			push(`${base} topic ${i + 1}`);
		}
	}

	return candidates.slice(0, targetCount);
}

export const startStream = mutation({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
		messageId: v.string(),
		model: v.string(),
		provider: v.string(),
		messages: v.array(v.object({
			role: v.string(),
			content: v.string(),
		})),
		options: v.optional(streamOptionsValidator),
	},
	returns: v.id("streamJobs"),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "messageSend", {
			key: userId,
		});
		if (!ok) {
			throwRateLimitError("streams started", retryAfter);
		}

		const chat = await ctx.db.get(args.chatId);
		if (!chat || chat.userId !== userId) {
			throw new Error("Chat not found or unauthorized");
		}

		if (args.provider === "osschat") {
			const user = await ctx.db.get(userId);
			if (!user) {
				throw new Error("User not found");
			}
		}

		const existingActiveStream = await ctx.db
			.query("streamJobs")
			.withIndex("by_chat", (q) =>
				q.eq("chatId", args.chatId).eq("status", "running")
			)
			.first();

		if (existingActiveStream) {
			const STREAM_STALE_MS = 2 * 60 * 1000;
			const isStale = Date.now() - existingActiveStream.createdAt > STREAM_STALE_MS;
			if (!isStale) {
				throw new Error("Stream already in progress for this chat");
			}
			await ctx.db.patch(existingActiveStream._id, {
				status: "error",
				error: "Auto-cleaned stale running stream",
				completedAt: Date.now(),
			});
			await ctx.db.patch(args.chatId, {
				activeStreamId: undefined,
				status: "idle",
				updatedAt: Date.now(),
			});
		}

		const jobId = await ctx.db.insert("streamJobs", {
			chatId: args.chatId,
			userId,
			messageId: args.messageId,
			status: "pending",
			model: args.model,
			provider: args.provider,
			messages: args.messages,
			options: args.options,
			content: "",
			createdAt: Date.now(),
		});

		await ctx.db.patch(args.chatId, {
			activeStreamId: `job-${jobId}`,
			status: "streaming",
			updatedAt: Date.now(),
		});

		await ctx.scheduler.runAfter(0, internal.backgroundStream.executeStream, {
			jobId,
		});

		const shouldGenerateAutoTitle =
			(chat.title === "New Chat" || !chat.title) &&
			(chat.messageCount ?? 0) <= 1;
		const seedText = shouldGenerateAutoTitle ? getLatestUserSeedText(args.messages) : null;
		if (seedText) {
			await ctx.scheduler.runAfter(0, internal.chats.generateAndSetTitleInternal, {
				chatId: args.chatId,
				userId,
				seedText,
				length: "standard",
				provider: args.provider === "openrouter" ? "openrouter" : "osschat",
				force: false,
			});
		}

		return jobId;
	},
});

export const getStreamJob = query({
	args: {
		jobId: v.id("streamJobs"),
		userId: v.id("users"),
	},
	returns: v.union(
		v.object({
			_id: v.id("streamJobs"),
			status: v.string(),
			model: v.string(),
			provider: v.string(),
			options: v.optional(streamOptionsValidator),
			content: v.string(),
			reasoning: v.optional(v.string()),
			chainOfThoughtParts: v.optional(v.array(chainOfThoughtPartValidator)),
			thinkingTimeMs: v.optional(v.number()),
			thinkingTimeSec: v.optional(v.number()),
				reasoningCharCount: v.optional(v.number()),
				reasoningChunkCount: v.optional(v.number()),
				reasoningTokenCount: v.optional(v.number()),
				reasoningRequested: v.optional(v.boolean()),
			webSearchUsed: v.optional(v.boolean()),
			webSearchCallCount: v.optional(v.number()),
			toolCallCount: v.optional(v.number()),
			error: v.optional(v.string()),
			messageId: v.string(),
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const job = await ctx.db.get(args.jobId);
		if (!job || job.userId !== userId) return null;

		return {
			_id: job._id,
			status: job.status,
			model: job.model,
			provider: job.provider,
			options: job.options,
			content: job.content,
			reasoning: job.reasoning,
			chainOfThoughtParts: job.chainOfThoughtParts,
			thinkingTimeMs: job.thinkingTimeMs,
			thinkingTimeSec: job.thinkingTimeSec,
				reasoningCharCount: job.reasoningCharCount,
				reasoningChunkCount: job.reasoningChunkCount,
				reasoningTokenCount: job.reasoningTokenCount,
				reasoningRequested: job.reasoningRequested,
			webSearchUsed: job.webSearchUsed,
			webSearchCallCount: job.webSearchCallCount,
			toolCallCount: job.toolCallCount,
			error: job.error,
			messageId: job.messageId,
		};
	},
});

export const getActiveStreamJob = query({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.union(
		v.object({
			_id: v.id("streamJobs"),
			status: v.string(),
			model: v.string(),
			provider: v.string(),
			options: v.optional(streamOptionsValidator),
			content: v.string(),
			reasoning: v.optional(v.string()),
			chainOfThoughtParts: v.optional(v.array(chainOfThoughtPartValidator)),
			thinkingTimeMs: v.optional(v.number()),
			thinkingTimeSec: v.optional(v.number()),
				reasoningCharCount: v.optional(v.number()),
				reasoningChunkCount: v.optional(v.number()),
				reasoningTokenCount: v.optional(v.number()),
				reasoningRequested: v.optional(v.boolean()),
			webSearchUsed: v.optional(v.boolean()),
			webSearchCallCount: v.optional(v.number()),
			toolCallCount: v.optional(v.number()),
			error: v.optional(v.string()),
			messageId: v.string(),
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const jobs = await ctx.db
			.query("streamJobs")
			.withIndex("by_chat", (q) =>
				q.eq("chatId", args.chatId).eq("status", "running")
			)
			.first();

		if (!jobs || jobs.userId !== userId) {
			const pending = await ctx.db
				.query("streamJobs")
				.withIndex("by_chat", (q) =>
					q.eq("chatId", args.chatId).eq("status", "pending")
				)
				.first();

			if (!pending || pending.userId !== userId) return null;

			return {
				_id: pending._id,
				status: pending.status,
				model: pending.model,
				provider: pending.provider,
				options: pending.options,
				content: pending.content,
				reasoning: pending.reasoning,
				chainOfThoughtParts: pending.chainOfThoughtParts,
				thinkingTimeMs: pending.thinkingTimeMs,
				thinkingTimeSec: pending.thinkingTimeSec,
					reasoningCharCount: pending.reasoningCharCount,
					reasoningChunkCount: pending.reasoningChunkCount,
					reasoningTokenCount: pending.reasoningTokenCount,
					reasoningRequested: pending.reasoningRequested,
				webSearchUsed: pending.webSearchUsed,
				webSearchCallCount: pending.webSearchCallCount,
				toolCallCount: pending.toolCallCount,
				error: pending.error,
				messageId: pending.messageId,
			};
		}

		return {
			_id: jobs._id,
			status: jobs.status,
			model: jobs.model,
			provider: jobs.provider,
			options: jobs.options,
			content: jobs.content,
			reasoning: jobs.reasoning,
			chainOfThoughtParts: jobs.chainOfThoughtParts,
			thinkingTimeMs: jobs.thinkingTimeMs,
			thinkingTimeSec: jobs.thinkingTimeSec,
				reasoningCharCount: jobs.reasoningCharCount,
				reasoningChunkCount: jobs.reasoningChunkCount,
				reasoningTokenCount: jobs.reasoningTokenCount,
				reasoningRequested: jobs.reasoningRequested,
			webSearchUsed: jobs.webSearchUsed,
			webSearchCallCount: jobs.webSearchCallCount,
			toolCallCount: jobs.toolCallCount,
			error: jobs.error,
			messageId: jobs.messageId,
		};
	},
});

export const updateStreamContent = internalMutation({
	args: {
		jobId: v.id("streamJobs"),
		content: v.string(),
		reasoning: v.optional(v.string()),
		chainOfThoughtParts: v.optional(v.array(chainOfThoughtPartValidator)),
		thinkingTimeMs: v.optional(v.number()),
		thinkingTimeSec: v.optional(v.number()),
			reasoningCharCount: v.optional(v.number()),
			reasoningChunkCount: v.optional(v.number()),
			reasoningTokenCount: v.optional(v.number()),
			reasoningRequested: v.optional(v.boolean()),
		webSearchUsed: v.optional(v.boolean()),
		webSearchCallCount: v.optional(v.number()),
		toolCallCount: v.optional(v.number()),
		status: v.optional(v.union(
			v.literal("pending"),
			v.literal("running"),
			v.literal("completed"),
			v.literal("error")
		)),
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) return;

		const updates: Record<string, unknown> = {
			content: args.content,
		};

		if (args.reasoning !== undefined) {
			updates.reasoning = args.reasoning;
		}
		if (args.chainOfThoughtParts !== undefined) {
			updates.chainOfThoughtParts = args.chainOfThoughtParts;
		}
		if (args.thinkingTimeMs !== undefined) {
			updates.thinkingTimeMs = args.thinkingTimeMs;
		}
		if (args.thinkingTimeSec !== undefined) {
			updates.thinkingTimeSec = args.thinkingTimeSec;
		}
		if (args.reasoningCharCount !== undefined) {
			updates.reasoningCharCount = args.reasoningCharCount;
		}
		if (args.reasoningChunkCount !== undefined) {
			updates.reasoningChunkCount = args.reasoningChunkCount;
		}
		if (args.reasoningTokenCount !== undefined) {
			updates.reasoningTokenCount = args.reasoningTokenCount;
		}
		if (args.reasoningRequested !== undefined) {
			updates.reasoningRequested = args.reasoningRequested;
		}
		if (args.webSearchUsed !== undefined) {
			updates.webSearchUsed = args.webSearchUsed;
		}
		if (args.webSearchCallCount !== undefined) {
			updates.webSearchCallCount = args.webSearchCallCount;
		}
		if (args.toolCallCount !== undefined) {
			updates.toolCallCount = args.toolCallCount;
		}
		if (args.status !== undefined) {
			updates.status = args.status;
			if (args.status === "running" && !job.startedAt) {
				updates.startedAt = Date.now();
			}
			if (args.status === "completed" || args.status === "error") {
				updates.completedAt = Date.now();
			}
		}
		if (args.error !== undefined) {
			updates.error = args.error;
		}

		await ctx.db.patch(args.jobId, updates);
	},
});

export const completeStream = internalMutation({
	args: {
		jobId: v.id("streamJobs"),
		content: v.string(),
		reasoning: v.optional(v.string()),
		chainOfThoughtParts: v.optional(v.array(chainOfThoughtPartValidator)),
		thinkingTimeMs: v.optional(v.number()),
		thinkingTimeSec: v.optional(v.number()),
			reasoningCharCount: v.optional(v.number()),
			reasoningChunkCount: v.optional(v.number()),
			reasoningTokenCount: v.optional(v.number()),
			reasoningRequested: v.optional(v.boolean()),
		webSearchUsed: v.optional(v.boolean()),
		webSearchCallCount: v.optional(v.number()),
		toolCallCount: v.optional(v.number()),
		tokensPerSecond: v.optional(v.number()),
		timeToFirstTokenMs: v.optional(v.number()),
		totalDurationMs: v.optional(v.number()),
		tokenUsage: v.optional(v.object({
			promptTokens: v.number(),
			completionTokens: v.number(),
			totalTokens: v.number(),
		})),
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) return;

		const derivedToolParts = (args.chainOfThoughtParts ?? []).filter(
			(part) => part.type === "tool",
		);
		const derivedWebSearchCallCount = derivedToolParts.filter((part) =>
			isWebSearchToolName(part.toolName),
		).length;
		const toolCallCount = args.toolCallCount ?? derivedToolParts.length;
		const webSearchCallCount = args.webSearchCallCount ?? derivedWebSearchCallCount;
		const webSearchUsed = args.webSearchUsed ?? webSearchCallCount > 0;
		const reasoningEffort = job.options?.reasoningEffort;
		const webSearchEnabled = Boolean(job.options?.enableWebSearch);
		const maxSteps = job.options?.maxSteps;

		await ctx.db.patch(args.jobId, {
			status: "completed",
			content: args.content,
			reasoning: args.reasoning,
			chainOfThoughtParts: args.chainOfThoughtParts,
			thinkingTimeMs: args.thinkingTimeMs,
			thinkingTimeSec: args.thinkingTimeSec,
			reasoningCharCount: args.reasoningCharCount,
			reasoningChunkCount: args.reasoningChunkCount,
			reasoningTokenCount: args.reasoningTokenCount,
			reasoningRequested: args.reasoningRequested,
			webSearchUsed,
			webSearchCallCount,
			toolCallCount,
			completedAt: Date.now(),
		});

		await ctx.db.patch(job.chatId, {
			activeStreamId: undefined,
			status: "idle",
			updatedAt: Date.now(),
		});

		const existingMessage = await ctx.db
			.query("messages")
			.withIndex("by_client_id", (q) =>
				q.eq("chatId", job.chatId).eq("clientMessageId", job.messageId)
			)
			.first();

		if (!existingMessage) {
			await ctx.db.insert("messages", {
				chatId: job.chatId,
				clientMessageId: job.messageId,
				role: "assistant",
				content: args.content,
				modelId: job.model,
				provider: job.provider,
				reasoningEffort,
				webSearchEnabled,
				webSearchUsed,
				webSearchCallCount,
				toolCallCount,
				maxSteps,
				reasoning: args.reasoning,
				thinkingTimeMs: args.thinkingTimeMs,
				thinkingTimeSec: args.thinkingTimeSec,
					reasoningCharCount: args.reasoningCharCount,
					reasoningChunkCount: args.reasoningChunkCount,
					reasoningTokenCount: args.reasoningTokenCount,
					reasoningRequested: args.reasoningRequested,
				chainOfThoughtParts: args.chainOfThoughtParts,
				tokensPerSecond: args.tokensPerSecond,
				timeToFirstTokenMs: args.timeToFirstTokenMs,
				totalDurationMs: args.totalDurationMs,
				tokenUsage: args.tokenUsage,
				messageMetadata: {
					modelId: job.model,
					provider: job.provider,
					reasoningEffort,
					maxSteps,
					webSearchEnabled,
				},
				status: "completed",
				userId: job.userId,
				createdAt: Date.now(),
			});
		} else {
			await ctx.db.patch(existingMessage._id, {
				content: args.content,
				modelId: job.model,
				provider: job.provider,
				reasoningEffort,
				webSearchEnabled,
				webSearchUsed,
				webSearchCallCount,
				toolCallCount,
				maxSteps,
				reasoning: args.reasoning,
				thinkingTimeMs: args.thinkingTimeMs,
				thinkingTimeSec: args.thinkingTimeSec,
					reasoningCharCount: args.reasoningCharCount,
					reasoningChunkCount: args.reasoningChunkCount,
					reasoningTokenCount: args.reasoningTokenCount,
					reasoningRequested: args.reasoningRequested,
				chainOfThoughtParts: args.chainOfThoughtParts,
				tokensPerSecond: args.tokensPerSecond,
				timeToFirstTokenMs: args.timeToFirstTokenMs,
				totalDurationMs: args.totalDurationMs,
				tokenUsage: args.tokenUsage,
				messageMetadata: {
					modelId: job.model,
					provider: job.provider,
					reasoningEffort,
					maxSteps,
					webSearchEnabled,
				},
				status: "completed",
			});
		}
	},
});

export const failStream = internalMutation({
	args: {
		jobId: v.id("streamJobs"),
		error: v.string(),
		partialContent: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) return;

		await ctx.db.patch(args.jobId, {
			status: "error",
			error: args.error,
			content: args.partialContent || job.content,
			completedAt: Date.now(),
		});

		await ctx.db.patch(job.chatId, {
			activeStreamId: undefined,
			status: "idle",
			updatedAt: Date.now(),
		});
	},
});

export const executeStream = internalAction({
	args: {
		jobId: v.id("streamJobs"),
	},
	handler: async (ctx, args) => {
		const job = await ctx.runQuery(internal.backgroundStream.getJobInternal, {
			jobId: args.jobId,
		});

		if (!job) {
			return;
		}

		let reservedUsageCents = 0;
		let reservedDateKey: string | null = null;

		if (job.provider === "osschat") {
			const currentDate = getCurrentDateKey();
			const reservedTotal = await reserveDailyUsageInUpstash(job.userId, currentDate, 1);
			if (reservedTotal !== null) {
				reservedUsageCents = 1;
				reservedDateKey = currentDate;
				if (reservedTotal > DAILY_AI_LIMIT_CENTS) {
					await adjustDailyUsageInUpstash(job.userId, currentDate, -reservedUsageCents);
					await ctx.runMutation(internal.backgroundStream.failStream, {
						jobId: args.jobId,
						error: "Daily usage limit reached. Connect your OpenRouter account to continue.",
					});
					return;
				}
			} else {
				await ctx.runMutation(internal.backgroundStream.failStream, {
					jobId: args.jobId,
					error: "Usage tracking temporarily unavailable. Please retry shortly.",
				});
				return;
			}
		}

		await ctx.runMutation(internal.backgroundStream.updateStreamContent, {
			jobId: args.jobId,
			content: "",
			status: "running",
			chainOfThoughtParts: [],
		});

		const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
		const VALYU_API_KEY = process.env.VALYU_API_KEY;

		let apiKey: string | null = null;
		if (job.provider === "osschat") {
			apiKey = OPENROUTER_API_KEY ?? null;
		} else {
			const encryptedKey = await ctx.runQuery(internal.users.getOpenRouterKeyInternal, {
				userId: job.userId,
			});
			apiKey = encryptedKey ? await decryptSecret(encryptedKey) : null;
		}

		if (!apiKey) {
			await ctx.runMutation(internal.backgroundStream.failStream, {
				jobId: args.jobId,
				error: "No API key available",
			});
			return;
		}

		const reasoningRequested =
			job.options?.enableReasoning === true ||
			(job.options?.enableReasoning === undefined &&
				Boolean(job.options?.reasoningEffort && job.options.reasoningEffort !== "none"));
		const chainOfThoughtParts: ChainOfThoughtPart[] = [];
		const reasoningPartById = new Map<string, number>();
		const toolPartById = new Map<string, number>();
		const toolInputBufferById = new Map<string, string>();

		let partOrder = 0;
		let fullContent = "";
		let fullReasoning = "";
		let reasoningChunkCount = 0;
		let reasoningStartTime: number | null = null;
		let reasoningEndTime: number | null = null;
		let streamCompletedTime: number | null = null;
		let firstTextDeltaTime: number | null = null;
		let pendingUpdateCounter = 0;
		let usageSummary: UsagePayload | null = null;

		const upsertReasoningPart = (id: string): ChainOfThoughtPart => {
			const existingIndex = reasoningPartById.get(id);
			if (existingIndex !== undefined) {
				return chainOfThoughtParts[existingIndex]!;
			}

			const newPart: ChainOfThoughtPart = {
				type: "reasoning",
				index: partOrder++,
				text: "",
				state: "streaming",
			};
			const arrayIndex = chainOfThoughtParts.push(newPart) - 1;
			reasoningPartById.set(id, arrayIndex);
			return newPart;
		};

		const upsertToolPart = (toolCallId: string, toolName?: string): ChainOfThoughtPart => {
			const existingIndex = toolPartById.get(toolCallId);
			if (existingIndex !== undefined) {
				const existing = chainOfThoughtParts[existingIndex]!;
				if (toolName) existing.toolName = toolName;
				return existing;
			}

			const newPart: ChainOfThoughtPart = {
				type: "tool",
				index: partOrder++,
				toolCallId,
				toolName,
				state: "input-streaming",
			};
			const arrayIndex = chainOfThoughtParts.push(newPart) - 1;
			toolPartById.set(toolCallId, arrayIndex);
			return newPart;
		};

		const getThinkingTimeMs = () => {
			if (!reasoningStartTime) return undefined;
			const end = reasoningEndTime ?? streamCompletedTime ?? Date.now();
			return Math.max(0, end - reasoningStartTime);
		};

		const latestUserMessage =
			[...job.messages]
				.reverse()
				.find((message: { role: string; content: string }) => message.role === "user")
				?.content ?? "";

		const addWebSearchSystemInstruction = (messages: Array<{ role: "user" | "assistant" | "system"; content: string }>) => {
			const instruction =
				"You can use the `webSearch` tool for real-time web information. If the user asks for web search, current events, latest updates, or asks to look something up, call `webSearch` before answering and cite what you found.";
			return [
				{ role: "system" as const, content: instruction },
				...messages,
			];
		};

		let webSearchMode: "none" | "tool" | "unavailable" = "none";

		const getFinalMessages = (
			messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
			webSearchEnabled: boolean,
		) => {
			if (!webSearchEnabled) return messages;
			return addWebSearchSystemInstruction(messages);
		};

			const getThinkingTimeSec = () => {
				const ms = getThinkingTimeMs();
				if (ms === undefined) return undefined;
				if (ms === 0) return 0;
				return Math.max(1, Math.ceil(ms / 1000));
			};

			const getReasoningTokenCount = () => {
				if (!usageSummary) return reasoningRequested ? 0 : undefined;
				if (typeof usageSummary.reasoningTokens === "number") {
					return usageSummary.reasoningTokens;
				}
				return reasoningRequested ? 0 : undefined;
			};

		const getToolMetrics = () => {
			const toolParts = chainOfThoughtParts.filter((part) => part.type === "tool");
			const toolBasedWebSearchCallCount = toolParts.filter((part) =>
				isWebSearchToolName(part.toolName) && part.state === "output-available",
			).length;
			const webSearchCallCount = toolBasedWebSearchCallCount;
			return {
				toolCallCount: toolParts.length,
				webSearchCallCount,
				webSearchUsed: webSearchCallCount > 0,
			};
		};
		const getPersistableChainOfThoughtParts = () => {
			const persistedParts = reasoningRequested
				? chainOfThoughtParts
				: chainOfThoughtParts.filter((part) => part.type !== "reasoning");
			return persistedParts.length > 0 ? persistedParts : undefined;
		};

		const persistProgress = async (force = false) => {
			if (!force && pendingUpdateCounter < UPDATE_INTERVAL) {
				return;
			}
			pendingUpdateCounter = 0;
			const toolMetrics = getToolMetrics();

			await ctx.runMutation(internal.backgroundStream.updateStreamContent, {
				jobId: args.jobId,
				content: fullContent,
				reasoning: reasoningRequested ? fullReasoning || undefined : undefined,
				chainOfThoughtParts: getPersistableChainOfThoughtParts(),
				thinkingTimeMs: getThinkingTimeMs(),
				thinkingTimeSec: getThinkingTimeSec(),
					reasoningCharCount: reasoningRequested ? fullReasoning.length : undefined,
					reasoningChunkCount: reasoningRequested ? reasoningChunkCount : undefined,
					reasoningTokenCount: getReasoningTokenCount(),
					reasoningRequested,
					webSearchUsed: toolMetrics.webSearchUsed,
					webSearchCallCount: toolMetrics.webSearchCallCount,
				toolCallCount: toolMetrics.toolCallCount,
			});
		};

		try {
			const timeoutMs = 5 * 60 * 1000;
			const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

				const openRouter = createOpenRouter({ apiKey });
				const aiModel = openRouter(job.model);

			const streamOptions: Parameters<typeof streamText>[0] = {
				model: aiModel as Parameters<typeof streamText>[0]["model"],
				messages: job.messages.map((message: { role: string; content: string }) => ({
					role: message.role as "user" | "assistant" | "system",
					content: message.content,
				})),
				abortSignal: controller.signal,
			};

			const baseOpenRouterOptions =
				(streamOptions.providerOptions?.openrouter as Record<string, unknown> | undefined) ?? {};
			const baseProviderRouting =
				typeof baseOpenRouterOptions.provider === "object" &&
				baseOpenRouterOptions.provider !== null
					? (baseOpenRouterOptions.provider as Record<string, unknown>)
					: {};
			const baseUsageOptions =
				typeof baseOpenRouterOptions.usage === "object" &&
				baseOpenRouterOptions.usage !== null
					? (baseOpenRouterOptions.usage as Record<string, unknown>)
					: {};
			const openRouterOptions: Record<string, unknown> = {
				...baseOpenRouterOptions,
				provider: {
					...baseProviderRouting,
					require_parameters: true,
				},
				usage: {
					...baseUsageOptions,
					include: true,
				},
			};

			if (reasoningRequested) {
				const effort = job.options?.reasoningEffort as "low" | "medium" | "high" | undefined;
				const selectedEffort = effort ?? "medium";
				const isAlwaysReasoning = /deepseek.*r1/i.test(job.model);
				const isAnthropicOrGemini = /^(anthropic|google)\//i.test(job.model);
				const effortToMaxTokens: Record<string, number> = {
					low: 4096,
					medium: 10000,
					high: 20000,
				};
				const reasoningConfig: Record<string, unknown> = { exclude: false };

				// OpenRouter supports effort="none|low|medium|high". When reasoning is requested,
				// pass a concrete effort for models that allow it. Models that always reason (e.g. R1)
				// ignore effort controls, so we only request visible reasoning content.
				// IMPORTANT: OpenRouter rejects payloads that include both `effort` and `max_tokens`.
				// We send exactly one of them.
				if (!isAlwaysReasoning && !isAnthropicOrGemini) {
					reasoningConfig.effort = selectedEffort;
				}

				if (isAnthropicOrGemini) {
					const budgetTokens = effortToMaxTokens[selectedEffort] || 10000;
					reasoningConfig.max_tokens = budgetTokens;
					streamOptions.maxOutputTokens = budgetTokens + 8192;
				} else {
					streamOptions.maxOutputTokens = streamOptions.maxOutputTokens ?? 16384;
				}

				openRouterOptions.reasoning = reasoningConfig;
			} else {
				// Explicitly disable reasoning on models that support effort controls.
				openRouterOptions.include_reasoning = false;
				openRouterOptions.reasoning = {
					exclude: true,
				};
			}

			streamOptions.providerOptions = {
				...streamOptions.providerOptions,
				openrouter: openRouterOptions as Record<string, any>,
			};

			const webSearchRequested = Boolean(job.options?.enableWebSearch);
			const supportsToolCalls = job.options?.supportsToolCalls !== false;
			let webSearchUnavailableReason: string | null = null;
			let availableSearches = 0;

			if (webSearchRequested) {
				const searchLimit = await ctx.runQuery(internal.search.checkSearchLimitInternal, {
					userId: job.userId,
				});
				availableSearches = searchLimit.remaining;
				if (!searchLimit.canSearch) {
					webSearchMode = "unavailable";
					webSearchUnavailableReason = "Daily search limit reached. Please try again tomorrow.";
				} else if (supportsToolCalls && VALYU_API_KEY) {
					webSearchMode = "tool";
				} else {
					webSearchMode = "unavailable";
					webSearchUnavailableReason = !VALYU_API_KEY
						? "Web search is not configured on the server."
						: "This model does not support tool calls required for web search.";
				}
			}

			if (webSearchMode === "unavailable") {
					const unavailableToolPart = upsertToolPart(
						`web-search-unavailable-${Date.now()}`,
						"webSearch",
					);
					unavailableToolPart.state = "output-error";
					unavailableToolPart.errorText = webSearchUnavailableReason ?? "Web search is unavailable.";
					pendingUpdateCounter++;
					streamOptions.messages = [
						{
							role: "system",
							content:
								"Web search is unavailable for this request. Do not claim live web access; answer using existing knowledge only.",
						},
						...(streamOptions.messages as Array<{ role: "user" | "assistant" | "system"; content: string }>),
					];
			}

			if (webSearchMode === "tool") {
				const valyuWebSearch = webSearch({
					apiKey: VALYU_API_KEY!,
					searchType: "web",
					maxNumResults: MAX_SEARCH_RESULTS_FOR_MODEL,
				});
				const requestedSearchCount = extractRequestedSearchCount(latestUserMessage);
				const targetSearchCount = Math.max(
					1,
					Math.min(requestedSearchCount, availableSearches || 1, MAX_PREFETCH_SEARCHES),
				);
				const searchQueries = buildSearchQueries(latestUserMessage, targetSearchCount);
				const contextChunks: string[] = [];
				let remainingContextChars = MAX_COMBINED_SEARCH_CONTEXT_CHARS;
				const execute = (valyuWebSearch as { execute?: (...args: unknown[]) => Promise<unknown> }).execute;
				if (!execute) {
					throw new Error("Valyu webSearch tool is missing execute()");
				}

				for (let index = 0; index < searchQueries.length; index++) {
					const searchQuery = searchQueries[index]!;
					const toolCallId = `web-search-${Date.now()}-${index}`;
					const toolPart = upsertToolPart(toolCallId, "webSearch");
					toolPart.input = { query: searchQuery };
					toolPart.state = "input-available";
					pendingUpdateCounter++;

						try {
						// Increment FIRST — this mutation is serializable in Convex,
						// so it will throw if the limit is already reached.
						// This prevents the TOCTOU race condition where two concurrent
						// requests could both pass the initial check and exceed the limit.
						await ctx.runMutation(internal.search.incrementSearchUsageInternal, {
							userId: job.userId,
						});

						const rawOutput = await execute({ query: searchQuery });
						const compactOutput = compactWebSearchOutput(rawOutput);
						toolPart.output = compactOutput;
						toolPart.state = "output-available";
						pendingUpdateCounter++;

						const searchContext = searchOutputToContext(compactOutput);
						if (searchContext) {
							const chunk = `Search ${index + 1}: ${searchQuery}\n${searchContext}`;
							if (remainingContextChars > 0) {
								const trimmedChunk =
									chunk.length > remainingContextChars
										? `${chunk.slice(0, Math.max(0, remainingContextChars - 1))}...`
										: chunk;
								contextChunks.push(trimmedChunk);
								remainingContextChars -= trimmedChunk.length;
							}
						}
					} catch (error) {
						const errorText =
							error instanceof Error ? error.message : "Web search failed";
						// If increment threw due to limit, stop searching
						if (errorText.includes("Daily search limit reached")) {
							toolPart.errorText = "Daily search limit reached";
							toolPart.state = "output-error";
							pendingUpdateCounter++;
							await persistProgress(true);
							break;
						}
						toolPart.errorText = errorText;
						toolPart.state = "output-error";
						pendingUpdateCounter++;
					}

					await persistProgress(true);
				}

				if (contextChunks.length > 0) {
					streamOptions.messages = [
						{
							role: "system",
							content:
								"Use the following web search results for up-to-date facts. Cite source URLs in your answer when making factual claims.",
						},
						{
							role: "system",
							content: `Web search results:\n${contextChunks.join("\n\n")}`,
						},
						...(getFinalMessages(
							streamOptions.messages as Array<{ role: "user" | "assistant" | "system"; content: string }>,
							false,
						)),
					];
				}
			}
				const configuredMaxSteps =
					typeof job.options?.maxSteps === "number"
						&& Number.isFinite(job.options.maxSteps)
						&& job.options.maxSteps > 0
						? Math.floor(job.options.maxSteps)
						: undefined;
				const stepLimit = Math.max(1, Math.min(configuredMaxSteps ?? 1, 10));
				streamOptions.stopWhen = stepCountIs(stepLimit);

			const result = streamText(streamOptions);

			for await (const part of result.fullStream) {
				switch (part.type) {
				case "text-delta": {
					if (firstTextDeltaTime === null) {
						firstTextDeltaTime = Date.now();
					}
					fullContent += part.text;
					pendingUpdateCounter++;
					break;
				}
					case "reasoning-start": {
						if (!reasoningRequested) break;
						const reasoningPart = upsertReasoningPart(part.id);
						reasoningPart.state = "streaming";
						pendingUpdateCounter++;
						break;
					}
					case "reasoning-delta": {
						if (!reasoningRequested) break;
						const reasoningPart = upsertReasoningPart(part.id);
						reasoningPart.text = `${reasoningPart.text ?? ""}${part.text}`;
						reasoningPart.state = "streaming";
						fullReasoning += part.text;
						reasoningChunkCount++;
						if (!reasoningStartTime) reasoningStartTime = Date.now();
						reasoningEndTime = Date.now();
						pendingUpdateCounter++;
						break;
					}
					case "reasoning-end": {
						if (!reasoningRequested) break;
						const reasoningPart = upsertReasoningPart(part.id);
						reasoningPart.state = "done";
						pendingUpdateCounter++;
						break;
					}
					case "tool-input-start": {
						const toolPart = upsertToolPart(part.id, part.toolName);
						toolPart.state = "input-streaming";
						toolInputBufferById.set(part.id, "");
						pendingUpdateCounter++;
						break;
					}
					case "tool-input-delta": {
						const toolPart = upsertToolPart(part.id);
						const prev = toolInputBufferById.get(part.id) ?? "";
						const next = `${prev}${part.delta}`;
						toolInputBufferById.set(part.id, next);
						toolPart.input = next;
						toolPart.state = "input-streaming";
						pendingUpdateCounter++;
						break;
					}
					case "tool-input-end": {
						const toolPart = upsertToolPart(part.id);
						const parsedInput = parseToolInput(toolInputBufferById.get(part.id));
						if (parsedInput !== undefined) {
							toolPart.input = parsedInput;
						}
						if (toolPart.state !== "output-available" && toolPart.state !== "output-error") {
							toolPart.state = "input-available";
						}
						pendingUpdateCounter++;
						break;
					}
					case "tool-call": {
						const toolPart = upsertToolPart(part.toolCallId, part.toolName);
						toolPart.toolName = part.toolName;
						toolPart.toolCallId = part.toolCallId;
						toolPart.input = part.input;
						if (toolPart.state !== "output-available") {
							toolPart.state = "input-available";
						}
						pendingUpdateCounter++;
						break;
					}
					case "tool-result": {
						const toolPart = upsertToolPart(part.toolCallId, part.toolName);
						toolPart.toolName = part.toolName;
						toolPart.toolCallId = part.toolCallId;
						toolPart.input = toolPart.input ?? parseToolInput(toolInputBufferById.get(part.toolCallId));
						toolPart.output = part.output;
						toolPart.state = "output-available";
						pendingUpdateCounter++;
						break;
					}
						case "tool-error": {
							const toolPart = upsertToolPart(part.toolCallId, part.toolName);
							toolPart.toolName = part.toolName;
							toolPart.toolCallId = part.toolCallId;
							toolPart.input = toolPart.input ?? parseToolInput(toolInputBufferById.get(part.toolCallId));
							const errorText =
								part.error instanceof Error
									? part.error.message
									: typeof part.error === "string"
										? part.error
										: "Tool execution failed";
							toolPart.errorText = errorText;
							toolPart.state = "output-error";
							pendingUpdateCounter++;
							break;
						}
					case "finish-step": {
						usageSummary = usageFromLanguageModelUsage({
							inputTokens: part.usage.inputTokens,
							outputTokens: part.usage.outputTokens,
							totalTokens: part.usage.totalTokens,
							reasoningTokens: part.usage.reasoningTokens,
							outputTokenDetails: part.usage.outputTokenDetails,
							raw: part.usage.raw,
						});
						break;
					}
					default:
						break;
				}

				await persistProgress();
			}

			streamCompletedTime = Date.now();
			for (const chainPart of chainOfThoughtParts) {
				if (chainPart.type === "reasoning" && chainPart.state === "streaming") {
					chainPart.state = "done";
				}
			}
			await persistProgress(true);

			const totalUsage = await result.totalUsage;
			if (totalUsage) {
				usageSummary = usageFromLanguageModelUsage({
					inputTokens: totalUsage.inputTokens,
					outputTokens: totalUsage.outputTokens,
					totalTokens: totalUsage.totalTokens,
					reasoningTokens: totalUsage.reasoningTokens,
					outputTokenDetails: totalUsage.outputTokenDetails,
					raw: totalUsage.raw,
				});
			}

			clearTimeout(timeoutId);

			// Compute analytics for message persistence
			const totalDurationMs = streamCompletedTime - job.createdAt;
			const timeToFirstTokenMs = firstTextDeltaTime
				? firstTextDeltaTime - job.createdAt
				: undefined;
			const completionTokens = usageSummary?.completionTokens ?? 0;
			const tokensPerSecond =
				totalDurationMs > 0 && completionTokens > 0
					? Math.round((completionTokens / (totalDurationMs / 1000)) * 100) / 100
					: undefined;

			if (job.provider === "osschat") {
				const usageCents = calculateUsageCents(
					usageSummary,
					job.messages,
					fullContent,
				);
				if (usageCents && usageCents > 0) {
					for (let attempt = 0; attempt < 2; attempt++) {
						try {
							await ctx.runMutation(internal.users.incrementAiUsage, {
								userId: job.userId,
								usageCents,
							});
							break;
						} catch {
							if (attempt === 1) break;
						}
					}

					if (reservedDateKey && reservedUsageCents > 0) {
						const adjustment = Math.ceil(usageCents) - reservedUsageCents;
						if (adjustment !== 0) {
							await adjustDailyUsageInUpstash(job.userId, reservedDateKey, adjustment);
						}
						reservedUsageCents = 0;
						reservedDateKey = null;
					} else {
						await incrementDailyUsageInUpstash(
							job.userId,
							getCurrentDateKey(),
							usageCents,
						);
					}
				} else if (reservedDateKey && reservedUsageCents > 0) {
					await adjustDailyUsageInUpstash(job.userId, reservedDateKey, -reservedUsageCents);
					reservedUsageCents = 0;
					reservedDateKey = null;
				}
			}

			const thinkingTimeMs = getThinkingTimeMs();
			const thinkingTimeSec = getThinkingTimeSec();
			const toolMetrics = getToolMetrics();

			await ctx.runMutation(internal.backgroundStream.completeStream, {
				jobId: args.jobId,
				content: fullContent,
				reasoning: reasoningRequested ? fullReasoning || undefined : undefined,
				chainOfThoughtParts: getPersistableChainOfThoughtParts(),
				thinkingTimeMs,
				thinkingTimeSec,
				reasoningCharCount: reasoningRequested ? fullReasoning.length : undefined,
				reasoningChunkCount: reasoningRequested ? reasoningChunkCount : undefined,
				reasoningTokenCount: getReasoningTokenCount(),
				reasoningRequested,
				webSearchUsed: toolMetrics.webSearchUsed,
				webSearchCallCount: toolMetrics.webSearchCallCount,
				toolCallCount: toolMetrics.toolCallCount,
				tokensPerSecond,
				timeToFirstTokenMs,
				totalDurationMs,
				tokenUsage: usageSummary
					? {
							promptTokens: usageSummary.promptTokens ?? 0,
							completionTokens: usageSummary.completionTokens ?? 0,
							totalTokens: usageSummary.totalTokens ?? 0,
						}
					: undefined,
			});
		} catch (error) {
			if (reservedDateKey && reservedUsageCents > 0) {
				try {
					await adjustDailyUsageInUpstash(job.userId, reservedDateKey, -reservedUsageCents);
				} catch (adjustError) {
					console.warn("[Usage] Upstash refund adjustment failed", adjustError);
				}
			}
			await ctx.runMutation(internal.backgroundStream.failStream, {
				jobId: args.jobId,
				error: "An error occurred while processing your request.",
				partialContent: fullContent,
			});
		}
	},
});

export const getPersistedDailyUsageForDateInternal = internalQuery({
	args: {
		userId: v.id("users"),
		dateKey: v.string(),
	},
	returns: v.number(),
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user || user.aiUsageDate !== args.dateKey) {
			return 0;
		}
		return user.aiUsageCents ?? 0;
	},
});

export const getJobInternal = internalQuery({
	args: {
		jobId: v.id("streamJobs"),
	},
	handler: async (ctx, args) => {
		return await ctx.db.get(args.jobId);
	},
});

export const cleanupStaleJobs = mutation({
	args: {
		userId: v.id("users"),
	},
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const staleJobs = await ctx.db
			.query("streamJobs")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.filter((q) =>
				q.or(
					q.eq(q.field("status"), "running"),
					q.eq(q.field("status"), "pending")
				)
			)
			.collect();

		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		let cleaned = 0;

		for (const job of staleJobs) {
			if (job.createdAt < fiveMinutesAgo) {
				await ctx.db.patch(job._id, {
					status: "error",
					error: "Cleaned up stale job",
					completedAt: Date.now(),
				});
				cleaned++;
			}
		}

		return { cleaned, total: staleJobs.length };
	},
});
