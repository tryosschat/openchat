"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

function safeCompare(a: string, b: string, hmacKey: string): boolean {
	const hmacA = createHmac("sha256", hmacKey).update(a).digest();
	const hmacB = createHmac("sha256", hmacKey).update(b).digest();
	return timingSafeEqual(hmacA, hmacB);
}

export const runCleanupBatchForWorkflow = internalAction({
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
		if (!expectedToken || !safeCompare(args.workflowToken, expectedToken, expectedToken)) {
			throw new Error("Unauthorized");
		}

		// Bounds validation — prevent accidental full-purge or oversized batches
		const retentionDays = args.retentionDays ?? 90;
		if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
			throw new Error("retentionDays must be between 1 and 3650");
		}
		const batchSize = args.batchSize ?? 100;
		if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 1000) {
			throw new Error("batchSize must be between 1 and 1000");
		}

		const result = await ctx.runMutation(internal.crons.cleanupSoftDeletedRecords, {
			retentionDays,
			batchSize,
			dryRun: args.dryRun,
		});
		return result;
	},
});
