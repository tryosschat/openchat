/**
 * Test Setup for Convex Tests
 *
 * This file provides a module loader for convex-test that works with Bun.
 * Since Bun doesn't support import.meta.glob, we need to manually create lazy loaders.
 *
 * NOTE: @convex-dev/rate-limiter/test uses import.meta.glob which doesn't work in Bun,
 * so we provide a compatible implementation here.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Create modules object that convex-test expects (lazy-loaded functions)
export const modules = {
  './auth.config.ts': () => import('./auth.config'),
  './backgroundStream.ts': () => import('./backgroundStream'),
  './chats.ts': () => import('./chats'),
  './crons.ts': () => import('./crons'),
  './files.ts': () => import('./files'),
  './http.ts': () => import('./http'),
  './messages.ts': () => import('./messages'),
  './migrations.ts': () => import('./migrations'),
  './previewSeed.ts': () => import('./previewSeed'),
  './promptTemplates.ts': () => import('./promptTemplates'),
  './schema.ts': () => import('./schema'),
  './users.ts': () => import('./users'),
  './lib/batchFileUrls.ts': () => import('./lib/batchFileUrls'),
  './lib/billingUtils.ts': () => import('./lib/billingUtils'),
  './lib/dbStats.ts': () => import('./lib/dbStats'),
  './lib/logger.ts': () => import('./lib/logger'),
  './lib/rateLimiter.ts': () => import('./lib/rateLimiter'),
  './config/constants.ts': () => import('./config/constants'),
  './_generated/api.ts': () => import('./_generated/api'),
  './_generated/server.ts': () => import('./_generated/server'),
};

// Rate limiter component schema (manually defined since @convex-dev/rate-limiter doesn't export it properly)
const rateLimiterComponentSchema = defineSchema({
    rateLimits: defineTable({
        name: v.string(),
        key: v.optional(v.string()), // undefined is singleton
        shard: v.number(), // 0 is singleton
        value: v.number(), // can go negative if capacity is reserved ahead of time
        ts: v.number(),
    }).index("name", ["name", "key", "shard"]),
});

// Rate limiter component modules (using proper package imports)
// Import directly from the package without hardcoded paths
const rateLimiterComponentModules = {
	// Bun respects package "exports" and blocks deep imports.
	// Use relative file imports into node_modules to load component modules.
	'./internal.ts': () => import('../../../node_modules/@convex-dev/rate-limiter/dist/component/internal.js'),
	'./lib.ts': () => import('../../../node_modules/@convex-dev/rate-limiter/dist/component/lib.js'),
	'./schema.ts': () => import('../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js'),
	'./_generated/api.ts': () => import('../../../node_modules/@convex-dev/rate-limiter/dist/component/_generated/api.js'),
	'./_generated/server.ts': () => import('../../../node_modules/@convex-dev/rate-limiter/dist/component/_generated/server.js'),
};

/**
 * Rate limiter test helper (Bun-compatible version of @convex-dev/rate-limiter/test)
 * This replaces the Vite-specific import.meta.glob with manual imports
 */
export const rateLimiter = {
  schema: rateLimiterComponentSchema,
  modules: rateLimiterComponentModules,
	register: (
		t: any,
		name: string = "rateLimiter",
	) => {
		t.registerComponent(name, rateLimiterComponentSchema, rateLimiterComponentModules);
	},
};

// Also export these for backwards compatibility
export { rateLimiterComponentSchema, rateLimiterComponentModules };
