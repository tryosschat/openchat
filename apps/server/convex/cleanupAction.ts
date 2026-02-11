"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

function safeCompare(a: string, b: string): boolean {
	const key = "cleanup-token-compare";
	const hmacA = createHmac("sha256", key).update(a).digest();
	const hmacB = createHmac("sha256", key).update(b).digest();
	return timingSafeEqual(hmacA, hmacB);
}

export const runCleanupBatchForWorkflow = action({
	args: {
		workflowToken: v.string(),
		retentionDays: v.optional(v.number()),
		batchSize: v.optional(v.number()),
		dryRun: v.optional(v.boolean()),
	},
	returns: v.object({
		success: v.boolean(),
		deleted: v.number(),
		dryRun: v.boolean(),
		cutoffDate: v.string(),
	}),
	handler: async (
		ctx,
		args,
	): Promise<{ success: boolean; deleted: number; dryRun: boolean; cutoffDate: string }> => {
		const expectedToken = process.env.WORKFLOW_CLEANUP_TOKEN;
		if (!expectedToken || !safeCompare(args.workflowToken, expectedToken)) {
			throw new Error("Unauthorized");
		}

		const result = await ctx.runMutation(internal.crons.cleanupSoftDeletedRecords, {
			retentionDays: args.retentionDays,
			batchSize: args.batchSize,
			dryRun: args.dryRun,
		});
		return result;
	},
});
