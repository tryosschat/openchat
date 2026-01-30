import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { rateLimiter } from "./lib/rateLimiter";
import { throwRateLimitError } from "./lib/rateLimitUtils";
import { sanitizeText } from "./lib/sanitize";
import { requireAuthUserId } from "./lib/auth";

// Input sanitization for template fields
const MAX_NAME_LENGTH = 100;
const MAX_COMMAND_LENGTH = 50;
const MAX_TEMPLATE_LENGTH = 10000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 50;

function sanitizeCommand(command: string): string {
	let sanitized = command.trim().toLowerCase();
	// Remove leading slash if present
	if (sanitized.startsWith("/")) {
		sanitized = sanitized.slice(1);
	}
	// Only allow alphanumeric, hyphens, and underscores
	sanitized = sanitized.replace(/[^a-z0-9\-_]/g, "");
	// Truncate to maximum length
	if (sanitized.length > MAX_COMMAND_LENGTH) {
		sanitized = sanitized.slice(0, MAX_COMMAND_LENGTH);
	}
	// Add leading slash back
	return `/${sanitized}`;
}

const promptTemplateDoc = v.object({
	_id: v.id("promptTemplates"),
	_creationTime: v.number(),
	userId: v.id("users"),
	name: v.string(),
	command: v.string(),
	template: v.string(),
	description: v.optional(v.string()),
	category: v.optional(v.string()),
	isPublic: v.optional(v.boolean()),
	isDraft: v.optional(v.boolean()),
	usageCount: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
	deletedAt: v.optional(v.number()),
});

const promptTemplateListItemDoc = v.object({
	_id: v.id("promptTemplates"),
	name: v.string(),
	command: v.string(),
	template: v.string(),
	description: v.optional(v.string()),
	category: v.optional(v.string()),
	isDraft: v.optional(v.boolean()),
	usageCount: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
});

// Security configuration
const MAX_TEMPLATE_LIST_LIMIT = 200;
const DEFAULT_TEMPLATE_LIST_LIMIT = 50;

export const list = query({
	args: {
		userId: v.id("users"),
		category: v.optional(v.string()),
		cursor: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	returns: v.object({
		templates: v.array(promptTemplateListItemDoc),
		nextCursor: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		let limit = args.limit ?? DEFAULT_TEMPLATE_LIST_LIMIT;

		// Validate and enforce maximum limit
		if (!Number.isFinite(limit) || limit <= 0) {
			limit = DEFAULT_TEMPLATE_LIST_LIMIT;
		} else if (limit > MAX_TEMPLATE_LIST_LIMIT) {
			limit = MAX_TEMPLATE_LIST_LIMIT;
		}

		// Use by_user index to efficiently filter by user and non-deleted templates
		let query = ctx.db
			.query("promptTemplates")
			.withIndex("by_user", (q) =>
				q.eq("userId", userId).eq("deletedAt", undefined)
			)
			.order("desc");

		// Filter by category BEFORE pagination to ensure correct page size
		if (args.category) {
			query = query.filter(q => q.eq(q.field("category"), args.category));
		}

		const results = await query.paginate({
			cursor: args.cursor ?? null,
			numItems: limit,
		});

		const templates = results.page;

		// Return optimized response
		return {
			templates: templates.map(t => ({
				_id: t._id,
				name: t.name,
				command: t.command,
				template: t.template,
				description: t.description,
				category: t.category,
				isDraft: t.isDraft,
				usageCount: t.usageCount,
				createdAt: t.createdAt,
				updatedAt: t.updatedAt,
			})),
			nextCursor: results.continueCursor ?? null,
		};
	},
});

export const get = query({
	args: {
		templateId: v.id("promptTemplates"),
		userId: v.id("users"),
	},
	returns: v.union(promptTemplateDoc, v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const template = await ctx.db.get(args.templateId);
		if (!template || template.userId !== userId || template.deletedAt) {
			return null;
		}
		return template;
	},
});

export const getByCommand = query({
	args: {
		userId: v.id("users"),
		command: v.string(),
	},
	returns: v.union(promptTemplateDoc, v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const templates = await ctx.db
			.query("promptTemplates")
			.withIndex("by_command", (q) =>
				q.eq("userId", userId).eq("command", args.command)
			)
			.filter(q => q.eq(q.field("deletedAt"), undefined))
			.first();

		if (!templates) return null;
		return templates;
	},
});

export const create = mutation({
	args: {
		userId: v.id("users"),
		name: v.string(),
		command: v.string(),
		template: v.string(),
		description: v.optional(v.string()),
		category: v.optional(v.string()),
		isDraft: v.optional(v.boolean()),
	},
	returns: v.object({ templateId: v.id("promptTemplates") }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limiting
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "templateCreate", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("templates created", retryAfter);
		}

		// Sanitize inputs
		const sanitizedName = sanitizeText(args.name, MAX_NAME_LENGTH);
		const sanitizedCommand = sanitizeCommand(args.command);
		const sanitizedTemplate = sanitizeText(args.template, MAX_TEMPLATE_LENGTH);
		const sanitizedDescription = args.description
			? sanitizeText(args.description, MAX_DESCRIPTION_LENGTH)
			: undefined;
		const sanitizedCategory = args.category
			? sanitizeText(args.category, MAX_CATEGORY_LENGTH)
			: undefined;

		// Validate required fields
		if (!sanitizedName || sanitizedName.length === 0) {
			throw new Error("Template name is required");
		}
		if (!sanitizedCommand || sanitizedCommand.length <= 1) {
			throw new Error("Valid command is required");
		}
		if (!sanitizedTemplate || sanitizedTemplate.length === 0) {
			throw new Error("Template content is required");
		}

		// Check for duplicate command
		const existing = await ctx.db
			.query("promptTemplates")
			.withIndex("by_command", (q) =>
				q.eq("userId", userId).eq("command", sanitizedCommand)
			)
			.filter(q => q.eq(q.field("deletedAt"), undefined))
			.first();

		if (existing) {
			throw new Error(`Command ${sanitizedCommand} already exists`);
		}

		const now = Date.now();
		const templateId = await ctx.db.insert("promptTemplates", {
			userId,
			name: sanitizedName,
			command: sanitizedCommand,
			template: sanitizedTemplate,
			description: sanitizedDescription,
			category: sanitizedCategory,
			isPublic: false,
			isDraft: args.isDraft ?? false,
			usageCount: 0,
			createdAt: now,
			updatedAt: now,
		});

		return { templateId };
	},
});

export const update = mutation({
	args: {
		templateId: v.id("promptTemplates"),
		userId: v.id("users"),
		name: v.optional(v.string()),
		command: v.optional(v.string()),
		template: v.optional(v.string()),
		description: v.optional(v.string()),
		category: v.optional(v.string()),
		isDraft: v.optional(v.boolean()),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limiting
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "templateUpdate", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("updates", retryAfter);
		}

		const existing = await ctx.db.get(args.templateId);
		if (!existing || existing.userId !== userId || existing.deletedAt) {
			return { ok: false };
		}

		const updates: Partial<typeof existing> = {
			updatedAt: Date.now(),
		};

		if (args.name !== undefined) {
			updates.name = sanitizeText(args.name, MAX_NAME_LENGTH);
		}
		if (args.command !== undefined) {
			const sanitizedCommand = sanitizeCommand(args.command);
			// Check for duplicate command (excluding current template)
			const duplicate = await ctx.db
				.query("promptTemplates")
				.withIndex("by_command", (q) =>
					q.eq("userId", userId).eq("command", sanitizedCommand)
				)
				.filter(q => q.eq(q.field("deletedAt"), undefined))
				.first();

			if (duplicate && duplicate._id !== args.templateId) {
				throw new Error(`Command ${sanitizedCommand} already exists`);
			}
			updates.command = sanitizedCommand;
		}
		if (args.template !== undefined) {
			updates.template = sanitizeText(args.template, MAX_TEMPLATE_LENGTH);
		}
		if (args.description !== undefined) {
			updates.description = sanitizeText(args.description, MAX_DESCRIPTION_LENGTH);
		}
		if (args.category !== undefined) {
			updates.category = sanitizeText(args.category, MAX_CATEGORY_LENGTH);
		}
		if (args.isDraft !== undefined) {
			updates.isDraft = args.isDraft;
		}

		await ctx.db.patch(args.templateId, updates);
		return { ok: true };
	},
});

// Auto-save mutation for real-time editing (less strict validation, no rate limiting)
export const autoSave = mutation({
	args: {
		templateId: v.id("promptTemplates"),
		userId: v.id("users"),
		name: v.optional(v.string()),
		template: v.optional(v.string()),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const existing = await ctx.db.get(args.templateId);
		if (!existing || existing.userId !== userId || existing.deletedAt) {
			return { ok: false };
		}

		const updates: Partial<typeof existing> = {
			updatedAt: Date.now(),
		};

		if (args.name !== undefined) {
			updates.name = sanitizeText(args.name, MAX_NAME_LENGTH);
		}
		if (args.template !== undefined) {
			updates.template = sanitizeText(args.template, MAX_TEMPLATE_LENGTH);
		}

		await ctx.db.patch(args.templateId, updates);
		return { ok: true };
	},
});

export const remove = mutation({
	args: {
		templateId: v.id("promptTemplates"),
		userId: v.id("users"),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limiting
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "templateDelete", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("deletions", retryAfter);
		}

		const template = await ctx.db.get(args.templateId);
		if (!template || template.userId !== userId || template.deletedAt) {
			return { ok: false };
		}

		// Soft delete
		await ctx.db.patch(args.templateId, {
			deletedAt: Date.now(),
		});

		return { ok: true };
	},
});

export const incrementUsage = mutation({
	args: {
		templateId: v.id("promptTemplates"),
		userId: v.id("users"),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const template = await ctx.db.get(args.templateId);
		if (!template || template.userId !== userId || template.deletedAt) {
			return { ok: false };
		}

		await ctx.db.patch(args.templateId, {
			usageCount: (template.usageCount ?? 0) + 1,
		});

		return { ok: true };
	},
});
