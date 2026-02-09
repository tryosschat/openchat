/**
 * Search Usage Limit Tracking
 *
 * Implements daily search limit tracking (per user).
 * Limits reset at UTC midnight each day.
 *
 * Usage:
 * - Call checkSearchLimit to check if user can perform a search
 * - Call incrementSearchUsage before performing a search (throws if limit reached)
 */

import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireAuthUserId } from "./lib/auth";

// Daily search limit per user (not exposed to clients)
const DAILY_SEARCH_LIMIT = 50;

/**
 * Get current UTC date string in YYYY-MM-DD format
 */
function getCurrentDateKey(): string {
	return new Date().toISOString().split("T")[0];
}

function getNextSearchUsage(
	userDate: string | undefined,
	userCount: number,
) {
	const currentDate = getCurrentDateKey();

	if (userDate !== currentDate) {
		return {
			currentDate,
			newCount: 1,
		};
	}

	if (userCount >= DAILY_SEARCH_LIMIT) {
		throw new Error("Daily search limit reached. Please try again tomorrow.");
	}

	return {
		currentDate,
		newCount: userCount + 1,
	};
}

/**
 * Check if user can perform a search
 * Returns whether the user can search and remaining searches
 */
export const checkSearchLimit = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({
		canSearch: v.boolean(),
		remaining: v.number(),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const user = await ctx.db.get(userId);

		if (!user) {
			// User not found - cannot search
			return { canSearch: false, remaining: 0 };
		}

		const currentDate = getCurrentDateKey();
		const userDate = user.searchUsageDate;
		const userCount = user.searchUsageCount ?? 0;

		// If the date has changed, the count resets
		if (userDate !== currentDate) {
			return { canSearch: true, remaining: DAILY_SEARCH_LIMIT };
		}

		// Same day - check against limit
		const remaining = Math.max(0, DAILY_SEARCH_LIMIT - userCount);
		const canSearch = userCount < DAILY_SEARCH_LIMIT;

		return { canSearch, remaining };
	},
});

/**
 * Get web-search availability for the current deployment + user quota state.
 * This lets the UI disable the toggle when the backend is not configured.
 */
export const getSearchAvailability = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({
		configured: v.boolean(),
		canSearch: v.boolean(),
		remaining: v.number(),
	}),
	handler: async (ctx, args) => {
		const configured = Boolean(process.env.VALYU_API_KEY);
		if (!configured) {
			return {
				configured: false,
				canSearch: false,
				remaining: 0,
			};
		}

		const userId = await requireAuthUserId(ctx, args.userId);
		const user = await ctx.db.get(userId);
		if (!user) {
			return {
				configured: true,
				canSearch: false,
				remaining: 0,
			};
		}

		const currentDate = getCurrentDateKey();
		const userDate = user.searchUsageDate;
		const userCount = user.searchUsageCount ?? 0;
		if (userDate !== currentDate) {
			return {
				configured: true,
				canSearch: true,
				remaining: DAILY_SEARCH_LIMIT,
			};
		}

		const remaining = Math.max(0, DAILY_SEARCH_LIMIT - userCount);
		return {
			configured: true,
			canSearch: userCount < DAILY_SEARCH_LIMIT,
			remaining,
		};
	},
});

/**
 * Increment search usage count and return new count
 * Throws an error if the daily limit has been reached
 *
 * Call this BEFORE performing the search to ensure atomic limit enforcement
 */
export const incrementSearchUsage = mutation({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({
		newCount: v.number(),
		remaining: v.number(),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const user = await ctx.db.get(userId);

		if (!user) {
			throw new Error("User not found");
		}

		const userDate = user.searchUsageDate;
		const userCount = user.searchUsageCount ?? 0;
		const { currentDate, newCount } = getNextSearchUsage(userDate, userCount);

		// Update user with new count and date
		await ctx.db.patch(userId, {
			searchUsageCount: newCount,
			searchUsageDate: currentDate,
			updatedAt: Date.now(),
		});

		const remaining = Math.max(0, DAILY_SEARCH_LIMIT - newCount);

		return { newCount, remaining };
	},
});

/**
 * Internal query for actions/background jobs
 */
export const checkSearchLimitInternal = internalQuery({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({
		canSearch: v.boolean(),
		remaining: v.number(),
	}),
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) return { canSearch: false, remaining: 0 };

		const currentDate = getCurrentDateKey();
		const userDate = user.searchUsageDate;
		const userCount = user.searchUsageCount ?? 0;

		if (userDate !== currentDate) {
			return { canSearch: true, remaining: DAILY_SEARCH_LIMIT };
		}

		const remaining = Math.max(0, DAILY_SEARCH_LIMIT - userCount);
		return { canSearch: userCount < DAILY_SEARCH_LIMIT, remaining };
	},
});

/**
 * Internal mutation for actions/background jobs
 */
export const incrementSearchUsageInternal = internalMutation({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({
		newCount: v.number(),
		remaining: v.number(),
	}),
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) {
			throw new Error("User not found");
		}

		const userDate = user.searchUsageDate;
		const userCount = user.searchUsageCount ?? 0;
		const { currentDate, newCount } = getNextSearchUsage(userDate, userCount);

		await ctx.db.patch(args.userId, {
			searchUsageCount: newCount,
			searchUsageDate: currentDate,
			updatedAt: Date.now(),
		});

		const remaining = Math.max(0, DAILY_SEARCH_LIMIT - newCount);
		return { newCount, remaining };
	},
});
