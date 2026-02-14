import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { incrementStat, decrementStat, STAT_KEYS } from "./lib/dbStats";
import { rateLimiter } from "./lib/rateLimiter";
import { throwRateLimitError } from "./lib/rateLimitUtils";
import { getProfileByUserId, getOrCreateProfile } from "./lib/profiles";
import { components, internal } from "./_generated/api";
import { requireAuthUserId, requireAuthUserIdFromAction } from "./lib/auth";

const EMAIL_LINK_MIGRATION_DEADLINE_MS = Date.parse("2026-06-01T00:00:00.000Z");

// User with profile data (for backwards-compatible responses)
// Includes merged profile data that prefers profile over user during migration
const userWithProfileDoc = v.object({
	_id: v.id("users"),
	_creationTime: v.number(),
	externalId: v.string(),
	email: v.optional(v.string()),
	// Profile fields (merged from profile or user for migration compatibility)
	name: v.optional(v.string()),
	avatarUrl: v.optional(v.string()),
	encryptedOpenRouterKey: v.optional(v.string()),
	fileUploadCount: v.number(),
	aiUsageCents: v.optional(v.number()),
	aiUsageDate: v.optional(v.string()),
	// Ban fields
	banned: v.optional(v.boolean()),
	bannedAt: v.optional(v.number()),
	banReason: v.optional(v.string()),
	banExpiresAt: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
	// Flag to indicate if profile exists (useful for debugging migration)
	hasProfile: v.boolean(),
});

// Public-safe user DTO — excludes encrypted secrets (e.g. encryptedOpenRouterKey).
// Client-facing queries must use this validator instead of userWithProfileDoc.
const publicUserDoc = v.object({
	_id: v.id("users"),
	_creationTime: v.number(),
	externalId: v.string(),
	email: v.optional(v.string()),
	name: v.optional(v.string()),
	avatarUrl: v.optional(v.string()),
	hasOpenRouterKey: v.boolean(),
	fileUploadCount: v.number(),
	aiUsageCents: v.optional(v.number()),
	aiUsageDate: v.optional(v.string()),
	banned: v.optional(v.boolean()),
	bannedAt: v.optional(v.number()),
	banReason: v.optional(v.string()),
	banExpiresAt: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
	hasProfile: v.boolean(),
});

import { DAILY_AI_LIMIT_CENTS, getCurrentDateKey } from "./lib/billingUtils";

export const ensure = mutation({
	args: {
		externalId: v.string(),
		email: v.optional(v.string()),
		name: v.optional(v.string()),
		avatarUrl: v.optional(v.string()),
	},
	returns: v.object({ userId: v.id("users") }),
		handler: async (ctx, args) => {
			const identity = await ctx.auth.getUserIdentity();
			if (!identity || identity.subject !== args.externalId) {
				throw new Error("Unauthorized");
			}

		// Rate limit user authentication/creation per external ID
		// NOTE: Using externalId (from Better Auth) is safe because:
		// 1. Better Auth already handles brute-force protection at the auth layer
		// 2. Using a global key causes write conflicts under load (all users
		//    compete for the same rate limit row, causing OCC failures)
		// 3. The externalId is verified by Better Auth before reaching this function
			const { ok, retryAfter } = await rateLimiter.limit(ctx, "userEnsure", {
				key: identity.subject,
			});

		if (!ok) {
			throwRateLimitError("authentication attempts", retryAfter);
		}

		// First, check if user exists by externalId (Better Auth user ID)
		let existing = await ctx.db
			.query("users")
			.withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
			.unique();

		// MIGRATION: Link WorkOS users to Better Auth by email
		// Uses .first() since duplicate emails may exist from prior migrations
<<<<<<< HEAD
		if (!existing && args.email && Date.now() < EMAIL_LINK_MIGRATION_DEADLINE_MS) {
||||||| 54e09ce
		if (!existing && args.email) {
=======
<<<<<<< HEAD
		// SECURITY: Only link if the caller's email is verified to prevent account takeover
		// via unverified email registration (see OSS-37)
		const isEmailVerified = identity.emailVerified ?? false;
		if (!existing && args.email && isEmailVerified && Date.now() < EMAIL_LINK_MIGRATION_DEADLINE_MS) {
||||||| 54e09ce
		if (!existing && args.email) {
=======
		if (!existing && args.email && Date.now() < EMAIL_LINK_MIGRATION_DEADLINE_MS) {
>>>>>>> main
>>>>>>> main
			const existingByEmail = await ctx.db
				.query("users")
				.withIndex("by_email", (q) => q.eq("email", args.email))
				.first();

			if (existingByEmail) {
				// Update externalId to Better Auth user ID (migration from WorkOS)
				await ctx.db.patch(existingByEmail._id, {
					externalId: args.externalId,
					updatedAt: Date.now(),
				});
				existing = existingByEmail;
				console.log(`[Auth Migration] Linked user ${args.email} from WorkOS to Better Auth (email verified)`);
			}
		} else if (!existing && args.email && !isEmailVerified && Date.now() < EMAIL_LINK_MIGRATION_DEADLINE_MS) {
			// Log attempts to link with unverified email for security monitoring
			console.warn(`[Auth Migration] Blocked linking for unverified email ${args.email} (potential account takeover attempt)`);
		}

		const now = Date.now();
		if (existing) {
			// Update user email (auth data stays in users table)
			const needsEmailUpdate = existing.email !== args.email;
			if (needsEmailUpdate) {
				await ctx.db.patch(existing._id, {
					email: args.email ?? undefined,
					updatedAt: now,
				});
			}

			// Ensure profile exists and update profile data (name, avatar)
			const profile = await getProfileByUserId(ctx, existing._id);
			if (profile) {
				// Update existing profile if name/avatar changed
				const needsProfileUpdate =
					profile.name !== args.name || profile.avatarUrl !== args.avatarUrl;
				if (needsProfileUpdate) {
					await ctx.db.patch(profile._id, {
						name: args.name ?? undefined,
						avatarUrl: args.avatarUrl ?? undefined,
						updatedAt: now,
					});
				}
			} else {
				// Create profile for existing user (migration path)
				await ctx.db.insert("profiles", {
					userId: existing._id,
					name: args.name ?? undefined,
					avatarUrl: args.avatarUrl ?? undefined,
					encryptedOpenRouterKey: existing.encryptedOpenRouterKey,
					fileUploadCount: existing.fileUploadCount ?? 0,
					createdAt: now,
					updatedAt: now,
				});
			}

			// Also update user table for backwards compatibility during migration
			const needsUserProfileUpdate =
				existing.name !== args.name || existing.avatarUrl !== args.avatarUrl;
			if (needsUserProfileUpdate) {
				await ctx.db.patch(existing._id, {
					name: args.name ?? undefined,
					avatarUrl: args.avatarUrl ?? undefined,
					updatedAt: now,
				});
			}

			return { userId: existing._id };
		}

		// Create new user
		const userId = await ctx.db.insert("users", {
			externalId: args.externalId,
			email: args.email ?? undefined,
			// Keep profile fields in users table for backwards compatibility
			name: args.name ?? undefined,
			avatarUrl: args.avatarUrl ?? undefined,
			createdAt: now,
			updatedAt: now,
		});

		// Create profile for new user
		await ctx.db.insert("profiles", {
			userId,
			name: args.name ?? undefined,
			avatarUrl: args.avatarUrl ?? undefined,
			fileUploadCount: 0,
			createdAt: now,
			updatedAt: now,
		});

		// PERFORMANCE OPTIMIZATION: Update stats counter when creating user
		await incrementStat(ctx, STAT_KEYS.USERS_TOTAL);

		return { userId };
	},
});

/**
 * Get the current authenticated user from Better Auth.
 * This is the primary way to get the current user in the app.
 */
export const getCurrentAuthUser = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		return {
			_id: identity.subject,
			email: identity.email,
			name: identity.name,
			image: identity.pictureUrl,
		};
	},
});

export const getByExternalId = query({
	args: {
		externalId: v.string(),
	},
	returns: v.union(publicUserDoc, v.null()),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity || identity.subject !== args.externalId) return null;

			const user = await ctx.db
				.query("users")
				.withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
				.unique();

		if (!user) return null;

		// Get profile data (may not exist during migration)
		const profile = await getProfileByUserId(ctx, user._id);

		// Return merged data with migration fallback
		// NOTE: encryptedOpenRouterKey is intentionally excluded from this public query.
		// Use getByExternalIdInternal for server-side access to encrypted secrets.
		return {
			_id: user._id,
			_creationTime: user._creationTime,
			externalId: user.externalId,
			email: user.email,
			// Profile fields: prefer profile data, fall back to user data for migration
			name: profile?.name ?? user.name,
			avatarUrl: profile?.avatarUrl ?? user.avatarUrl,
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
			hasOpenRouterKey: !!(profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey),
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
			fileUploadCount: profile?.fileUploadCount ?? user.fileUploadCount ?? 0,
			aiUsageCents: user.aiUsageCents,
			aiUsageDate: user.aiUsageDate,
			// Ban fields (always from user)
			banned: user.banned,
			bannedAt: user.bannedAt,
			banReason: user.banReason,
			banExpiresAt: user.banExpiresAt,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			hasProfile: profile !== null,
		};
	},
});

export const getByExternalIdInternal = internalQuery({
	args: {
		externalId: v.string(),
	},
	returns: v.union(userWithProfileDoc, v.null()),
	handler: async (ctx, args) => {
		const user = await ctx.db
			.query("users")
			.withIndex("by_external_id", (q) => q.eq("externalId", args.externalId))
			.unique();

		if (!user) return null;

		const profile = await getProfileByUserId(ctx, user._id);

		return {
			_id: user._id,
			_creationTime: user._creationTime,
			externalId: user.externalId,
			email: user.email,
			name: profile?.name ?? user.name,
			avatarUrl: profile?.avatarUrl ?? user.avatarUrl,
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
			fileUploadCount: profile?.fileUploadCount ?? user.fileUploadCount ?? 0,
			aiUsageCents: user.aiUsageCents,
			aiUsageDate: user.aiUsageDate,
			banned: user.banned,
			bannedAt: user.bannedAt,
			banReason: user.banReason,
			banExpiresAt: user.banExpiresAt,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			hasProfile: profile !== null,
		};
	},
});

	export const getById = query({
		args: {
			userId: v.id("users"),
		},
		returns: v.union(publicUserDoc, v.null()),
		handler: async (ctx, args) => {
			const userId = await requireAuthUserId(ctx, args.userId);
			const user = await ctx.db.get(userId);
			if (!user) return null;

		// Get profile data (may not exist during migration)
		const profile = await getProfileByUserId(ctx, user._id);

		// Return merged data with migration fallback
		// NOTE: encryptedOpenRouterKey is intentionally excluded from this public query.
		// Use getOpenRouterKeyInternal for server-side access to encrypted secrets.
		return {
			_id: user._id,
			_creationTime: user._creationTime,
			externalId: user.externalId,
			email: user.email,
			// Profile fields: prefer profile data, fall back to user data for migration
			name: profile?.name ?? user.name,
			avatarUrl: profile?.avatarUrl ?? user.avatarUrl,
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
<<<<<<< HEAD
||||||| 54e09ce
			encryptedOpenRouterKey:
				profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey,
=======
			hasOpenRouterKey: !!(profile?.encryptedOpenRouterKey ?? user.encryptedOpenRouterKey),
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
>>>>>>> main
			fileUploadCount: profile?.fileUploadCount ?? user.fileUploadCount ?? 0,
			aiUsageCents: user.aiUsageCents,
			aiUsageDate: user.aiUsageDate,
			// Ban fields (always from user)
			banned: user.banned,
			bannedAt: user.bannedAt,
			banReason: user.banReason,
			banExpiresAt: user.banExpiresAt,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			hasProfile: profile !== null,
		};
	},
});

// Maximum single-request usage cap to guard against corrupted cost data
const MAX_SINGLE_REQUEST_CENTS = DAILY_AI_LIMIT_CENTS * 10; // 100¢ = $1

export const incrementAiUsage = internalMutation({
	args: {
		userId: v.id("users"),
		usageCents: v.number(),
	},
	returns: v.object({
		usedCents: v.number(),
		remainingCents: v.number(),
		overLimit: v.boolean(),
	}),
	handler: async (ctx, args) => {
		if (args.usageCents <= 0) {
			return {
				usedCents: 0,
				remainingCents: DAILY_AI_LIMIT_CENTS,
				overLimit: false,
			};
		}

		// Sanity cap: reject suspiciously high usage values
		if (args.usageCents > MAX_SINGLE_REQUEST_CENTS) {
			console.error(
				`[Usage] Rejected suspiciously high usage: ${args.usageCents}¢ for user ${args.userId}`,
			);
			return {
				usedCents: 0,
				remainingCents: DAILY_AI_LIMIT_CENTS,
				overLimit: false,
			};
		}

		const user = await ctx.db.get(args.userId);
		if (!user) {
			console.warn(
				`[Usage] User not found for usage recording: ${args.userId}, usage: ${args.usageCents}¢`,
			);
			return {
				usedCents: 0,
				remainingCents: DAILY_AI_LIMIT_CENTS,
				overLimit: false,
			};
		}

		const currentDate = getCurrentDateKey();
		const previousCents =
			user.aiUsageDate === currentDate ? (user.aiUsageCents ?? 0) : 0;

		// Second line of defense: if already over limit, still record but flag it
		const alreadyOverLimit = previousCents >= DAILY_AI_LIMIT_CENTS;

		const nextCents = Math.max(0, previousCents + args.usageCents);

		await ctx.db.patch(args.userId, {
			aiUsageCents: nextCents,
			aiUsageDate: currentDate,
			updatedAt: Date.now(),
		});

		return {
			usedCents: nextCents,
			remainingCents: Math.max(0, DAILY_AI_LIMIT_CENTS - nextCents),
			overLimit: alreadyOverLimit,
		};
	},
});

export const saveOpenRouterKey = mutation({
	args: {
		userId: v.id("users"),
		encryptedKey: v.string(),
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit API key saves
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "userSaveApiKey", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("API key updates", retryAfter);
		}

		const now = Date.now();

		// Update profile (primary location for API key)
		const profile = await getOrCreateProfile(ctx, userId);
		await ctx.db.patch(profile._id, {
			encryptedOpenRouterKey: args.encryptedKey,
			updatedAt: now,
		});

		// Also update user table for backwards compatibility during migration
		await ctx.db.patch(userId, {
			encryptedOpenRouterKey: args.encryptedKey,
			updatedAt: now,
		});

		return { success: true };
	},
});

export const getOpenRouterKey = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Try profile first (primary location)
		const profile = await getProfileByUserId(ctx, userId);
		if (profile?.encryptedOpenRouterKey) {
			return profile.encryptedOpenRouterKey;
		}

		// Fall back to user table during migration
		const user = await ctx.db.get(userId);
		return user?.encryptedOpenRouterKey ?? null;
	},
});

/**
 * Check if a user has an OpenRouter API key stored (returns boolean, not the actual key).
 * This is used by the client to determine if the user has connected their OpenRouter account.
 */
export const hasOpenRouterKey = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Try profile first (primary location)
		const profile = await getProfileByUserId(ctx, userId);
		if (profile?.encryptedOpenRouterKey) {
			return true;
		}

		// Fall back to user table during migration
		const user = await ctx.db.get(userId);
		return !!user?.encryptedOpenRouterKey;
	},
});

export const getOpenRouterKeyInternal = internalQuery({
	args: {
		userId: v.id("users"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const profile = await getProfileByUserId(ctx, args.userId);
		if (profile?.encryptedOpenRouterKey) {
			return profile.encryptedOpenRouterKey;
		}

		const user = await ctx.db.get(args.userId);
		return user?.encryptedOpenRouterKey ?? null;
	},
});

export const removeOpenRouterKey = mutation({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit API key removals
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "userRemoveApiKey", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("API key removals", retryAfter);
		}

		const now = Date.now();

		// Remove from profile (primary location)
		const profile = await getProfileByUserId(ctx, userId);
		if (profile) {
			await ctx.db.patch(profile._id, {
				encryptedOpenRouterKey: undefined,
				updatedAt: now,
			});
		}

		// Also remove from user table for backwards compatibility during migration
		await ctx.db.patch(userId, {
			encryptedOpenRouterKey: undefined,
			updatedAt: now,
		});

		return { success: true };
	},
});

export const getFavoriteModels = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.union(v.array(v.string()), v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const profile = await getProfileByUserId(ctx, userId);
		// Return null if favorites have never been set (allows frontend to apply defaults)
		// Return [] if user explicitly cleared all favorites
		if (!profile) return null;
		return profile.favoriteModels ?? null;
	},
});

export const toggleFavoriteModel = mutation({
	args: {
		userId: v.id("users"),
		modelId: v.string(),
	},
	returns: v.object({ isFavorite: v.boolean(), favorites: v.array(v.string()) }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const profile = await getOrCreateProfile(ctx, userId);
		const currentFavorites = profile.favoriteModels ?? [];
		const isFavorite = currentFavorites.includes(args.modelId);
		
		const newFavorites = isFavorite
			? currentFavorites.filter((id) => id !== args.modelId)
			: [...currentFavorites, args.modelId];

		await ctx.db.patch(profile._id, {
			favoriteModels: newFavorites,
			updatedAt: Date.now(),
		});

		return { isFavorite: !isFavorite, favorites: newFavorites };
	},
});

export const setFavoriteModels = mutation({
	args: {
		userId: v.id("users"),
		modelIds: v.array(v.string()),
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const profile = await getOrCreateProfile(ctx, userId);

		await ctx.db.patch(profile._id, {
			favoriteModels: args.modelIds,
			updatedAt: Date.now(),
		});

		return { success: true };
	},
});

export const updateName = mutation({
	args: {
		userId: v.id("users"),
		name: v.string(),
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Validate name (1-100 chars, no excessive whitespace)
		const trimmedName = args.name.trim();
		if (trimmedName.length === 0 || trimmedName.length > 100) {
			throw new Error("Name must be between 1 and 100 characters");
		}

		const now = Date.now();

		// Update profile (primary location for name)
		const profile = await getOrCreateProfile(ctx, userId);
		await ctx.db.patch(profile._id, {
			name: trimmedName,
			updatedAt: now,
		});

		// Also update user table for backwards compatibility during migration
		await ctx.db.patch(userId, {
			name: trimmedName,
			updatedAt: now,
		});

		return { success: true };
	},
});

const DELETE_BATCH_SIZE_DEFAULT = 100;
const DELETE_BATCH_SIZE_MAX = 500;
const MAX_DELETE_BATCH_LOOPS = 1_000;

function normalizeBatchSize(value?: number): number {
	if (!value || !Number.isFinite(value) || value <= 0) {
		return DELETE_BATCH_SIZE_DEFAULT;
	}
	return Math.min(Math.floor(value), DELETE_BATCH_SIZE_MAX);
}

const deletionBatchResult = v.object({
	deleted: v.number(),
	hasMore: v.boolean(),
});

export const deleteUserStreamJobs = internalMutation({
	args: {
		userId: v.id("users"),
		batchSize: v.optional(v.number()),
	},
	returns: deletionBatchResult,
	handler: async (ctx, args) => {
		const batchSize = normalizeBatchSize(args.batchSize);
		const streamJobs = await ctx.db
			.query("streamJobs")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.take(batchSize);

		for (const job of streamJobs) {
			await ctx.db.delete(job._id);
		}

		return {
			deleted: streamJobs.length,
			hasMore: streamJobs.length === batchSize,
		};
	},
});

export const deleteUserMessages = internalMutation({
	args: {
		userId: v.id("users"),
		batchSize: v.optional(v.number()),
	},
	returns: deletionBatchResult,
	handler: async (ctx, args) => {
		const batchSize = normalizeBatchSize(args.batchSize);
		const messages = await ctx.db
			.query("messages")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.take(batchSize);

		for (const message of messages) {
			await ctx.db.delete(message._id);
		}

		return {
			deleted: messages.length,
			hasMore: messages.length === batchSize,
		};
	},
});

export const deleteUserChats = internalMutation({
	args: {
		userId: v.id("users"),
		batchSize: v.optional(v.number()),
	},
	returns: deletionBatchResult,
	handler: async (ctx, args) => {
		const batchSize = normalizeBatchSize(args.batchSize);
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.take(batchSize);

		for (const chat of chats) {
			await ctx.db.delete(chat._id);
		}

		return {
			deleted: chats.length,
			hasMore: chats.length === batchSize,
		};
	},
});

export const deleteUserFiles = internalMutation({
	args: {
		userId: v.id("users"),
		batchSize: v.optional(v.number()),
	},
	returns: deletionBatchResult,
	handler: async (ctx, args) => {
		const batchSize = normalizeBatchSize(args.batchSize);
		const files = await ctx.db
			.query("fileUploads")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.take(batchSize);

		for (const file of files) {
			try {
				await ctx.storage.delete(file.storageId);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				if (!message.toLowerCase().includes("not found")) {
					console.error("Unexpected error deleting storage file:", file.storageId, message);
				}
			}
			await ctx.db.delete(file._id);
		}

		return {
			deleted: files.length,
			hasMore: files.length === batchSize,
		};
	},
});

export const deleteUserChatReadStatuses = internalMutation({
	args: {
		userId: v.id("users"),
		batchSize: v.optional(v.number()),
	},
	returns: deletionBatchResult,
	handler: async (ctx, args) => {
		const batchSize = normalizeBatchSize(args.batchSize);
		const statuses = await ctx.db
			.query("chatReadStatus")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.take(batchSize);

		for (const status of statuses) {
			await ctx.db.delete(status._id);
		}

		return {
			deleted: statuses.length,
			hasMore: statuses.length === batchSize,
		};
	},
});

export const deleteUserPromptTemplates = internalMutation({
	args: {
		userId: v.id("users"),
		batchSize: v.optional(v.number()),
	},
	returns: deletionBatchResult,
	handler: async (ctx, args) => {
		const batchSize = normalizeBatchSize(args.batchSize);
		const templates = await ctx.db
			.query("promptTemplates")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.take(batchSize);

		for (const template of templates) {
			await ctx.db.delete(template._id);
		}

		return {
			deleted: templates.length,
			hasMore: templates.length === batchSize,
		};
	},
});

export const deleteUserRecord = internalMutation({
	args: {
		userId: v.id("users"),
		externalId: v.string(),
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user || user.externalId !== args.externalId) {
			return { success: false };
		}

		await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
			input: {
				model: "session",
				where: [{ field: "userId", operator: "eq", value: args.externalId }],
			},
			paginationOpts: { cursor: null, numItems: 1000 },
		});

		await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
			input: {
				model: "account",
				where: [{ field: "userId", operator: "eq", value: args.externalId }],
			},
			paginationOpts: { cursor: null, numItems: 100 },
		});

		await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
			input: {
				model: "user",
				where: [{ field: "_id", operator: "eq", value: args.externalId }],
			},
			paginationOpts: { cursor: null, numItems: 1 },
		});

		// chatReadStatuses and promptTemplates are now deleted in separate
		// workflow steps (delete-chat-read-statuses / delete-prompt-templates)
		// via deleteAccountWorkflowStep, ensuring each batch runs in its own
		// transaction and avoids hitting Convex per-transaction write limits.

		const profile = await ctx.db
			.query("profiles")
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.unique();
		if (profile) {
			await ctx.db.delete(profile._id);
		}

		await ctx.db.delete(args.userId);
		await decrementStat(ctx, STAT_KEYS.USERS_TOTAL);

		return { success: true };
	},
});

export const deleteAccountWorkflowStep = action({
	args: {
		userId: v.id("users"),
		externalId: v.string(),
		step: v.union(
			v.literal("delete-stream-jobs"),
			v.literal("delete-messages"),
			v.literal("delete-chats"),
			v.literal("delete-files"),
			v.literal("delete-chat-read-statuses"),
			v.literal("delete-prompt-templates"),
			v.literal("delete-user"),
		),
		batchSize: v.optional(v.number()),
	},
	returns: v.object({
		deleted: v.number(),
		hasMore: v.boolean(),
		success: v.optional(v.boolean()),
	}),
	handler: async (
		ctx,
		args,
	): Promise<{ deleted: number; hasMore: boolean; success?: boolean }> => {
		const userId = await requireAuthUserIdFromAction(ctx, args.userId);

		switch (args.step) {
			case "delete-stream-jobs":
				return await ctx.runMutation(internal.users.deleteUserStreamJobs, {
					userId,
					batchSize: args.batchSize,
				});
			case "delete-messages":
				return await ctx.runMutation(internal.users.deleteUserMessages, {
					userId,
					batchSize: args.batchSize,
				});
			case "delete-chats":
				return await ctx.runMutation(internal.users.deleteUserChats, {
					userId,
					batchSize: args.batchSize,
				});
			case "delete-files":
				return await ctx.runMutation(internal.users.deleteUserFiles, {
					userId,
					batchSize: args.batchSize,
				});
			case "delete-chat-read-statuses":
				return await ctx.runMutation(internal.users.deleteUserChatReadStatuses, {
					userId,
				});
			case "delete-prompt-templates":
				return await ctx.runMutation(internal.users.deleteUserPromptTemplates, {
					userId,
				});
			case "delete-user": {
				const result: { success: boolean } = await ctx.runMutation(
					internal.users.deleteUserRecord,
					{
						userId,
						externalId: args.externalId,
					},
				);
				return {
					deleted: result.success ? 1 : 0,
					hasMore: false,
					success: result.success,
				};
			}
		}
	},
});

/**
 * @deprecated Use deleteAccountWorkflowStep (action) instead.
 * This mutation runs all deletes in a single transaction, which can hit
 * Convex per-transaction write limits for users with large amounts of data.
 * The workflow-based approach (deleteAccountWorkflowStep) isolates each
 * deletion step into its own transaction.
 */
export const deleteAccount = mutation({
	args: {
		userId: v.id("users"),
		externalId: v.string(),
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity || identity.subject !== args.externalId) {
			throw new Error("User not found or unauthorized");
		}
		// Verify user exists and externalId matches (authorization check)
		const user = await ctx.db.get(userId);
		if (!user || user.externalId !== identity.subject) {
			throw new Error("User not found or unauthorized");
		}

		// 1. Delete Better Auth sessions (invalidates all user sessions across devices)
		// The externalId is the Better Auth user ID
		await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
			input: {
				model: "session",
				where: [{ field: "userId", operator: "eq", value: identity.subject }],
			},
			paginationOpts: { cursor: null, numItems: 1000 },
		});

		// 2. Delete Better Auth accounts (OAuth provider links)
		await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
			input: {
				model: "account",
				where: [{ field: "userId", operator: "eq", value: identity.subject }],
			},
			paginationOpts: { cursor: null, numItems: 100 },
		});

		// 3. Delete Better Auth user record
		await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
			input: {
				model: "user",
				where: [{ field: "_id", operator: "eq", value: identity.subject }],
			},
			paginationOpts: { cursor: null, numItems: 1 },
		});

		// 4. Delete streamJobs
		for (let batch = 0; batch < MAX_DELETE_BATCH_LOOPS; batch++) {
			const result = await ctx.runMutation(internal.users.deleteUserStreamJobs, {
				userId,
			});
			if (!result.hasMore) break;
		}

		// 5. Delete chatReadStatus
		for (let batch = 0; batch < MAX_DELETE_BATCH_LOOPS; batch++) {
			const result = await ctx.runMutation(internal.users.deleteUserChatReadStatuses, {
				userId,
			});
			if (!result.hasMore) break;
		}

		// 6. Delete fileUploads AND storage blobs
		for (let batch = 0; batch < MAX_DELETE_BATCH_LOOPS; batch++) {
			const result = await ctx.runMutation(internal.users.deleteUserFiles, {
				userId,
			});
			if (!result.hasMore) break;
		}

		// 7. Delete messages (all messages for all user's chats)
		for (let batch = 0; batch < MAX_DELETE_BATCH_LOOPS; batch++) {
			const result = await ctx.runMutation(internal.users.deleteUserMessages, {
				userId,
			});
			if (!result.hasMore) break;
		}

		// 8. Delete chats
		for (let batch = 0; batch < MAX_DELETE_BATCH_LOOPS; batch++) {
			const result = await ctx.runMutation(internal.users.deleteUserChats, {
				userId,
			});
			if (!result.hasMore) break;
		}

		// 9. Delete promptTemplates
		for (let batch = 0; batch < MAX_DELETE_BATCH_LOOPS; batch++) {
			const result = await ctx.runMutation(internal.users.deleteUserPromptTemplates, {
				userId,
			});
			if (!result.hasMore) break;
		}

		// 10. Delete profile
		const profile = await ctx.db
			.query("profiles")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.unique();
		if (profile) {
			await ctx.db.delete(profile._id);
		}

		// 11. Delete user record last
		await ctx.db.delete(userId);

		// 12. Update stats
		await decrementStat(ctx, STAT_KEYS.USERS_TOTAL);

		return { success: true };
	},
});
