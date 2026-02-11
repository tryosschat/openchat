import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { serve } from "@upstash/workflow/tanstack";
import { api } from "@server/convex/_generated/api";
import { createConvexServerClient } from "@/lib/convex-server";
import { workflowClient } from "@/lib/upstash";

type CleanupPayload = {
	retentionDays?: number;
	batchSize?: number;
};

const MAX_CLEANUP_BATCHES = 1_000;

function isLocalWorkflowRequest(request: Request): boolean {
	const hostname = new URL(request.url).hostname;
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseCleanupPayload(raw: unknown): CleanupPayload | null {
	if (!raw || typeof raw !== "object") return null;

	const payload = raw as Record<string, unknown>;
	const parsed: CleanupPayload = {};

	if (payload.retentionDays !== undefined) {
		if (
			typeof payload.retentionDays !== "number" ||
			!Number.isFinite(payload.retentionDays) ||
			payload.retentionDays < 1 ||
			payload.retentionDays > 3650
		) {
			return null;
		}
		parsed.retentionDays = Math.floor(payload.retentionDays);
	}

	if (payload.batchSize !== undefined) {
		if (
			typeof payload.batchSize !== "number" ||
			!Number.isFinite(payload.batchSize) ||
			payload.batchSize < 1 ||
			payload.batchSize > 1_000
		) {
			return null;
		}
		parsed.batchSize = Math.floor(payload.batchSize);
	}

	return parsed;
}

function safeCompare(a: string, b: string): boolean {
	const key = "cleanup-token-compare";
	const hmacA = createHmac("sha256", key).update(a).digest();
	const hmacB = createHmac("sha256", key).update(b).digest();
	return timingSafeEqual(hmacA, hmacB);
}

function hasValidCleanupToken(headers: Headers): boolean {
	const expectedToken = process.env.WORKFLOW_CLEANUP_TOKEN?.trim();
	if (!expectedToken) return false;

	const bearer = headers.get("authorization");
	if (bearer?.startsWith("Bearer ")) {
		return safeCompare(bearer.slice("Bearer ".length).trim(), expectedToken);
	}

	const workflowHeader = headers.get("x-workflow-cleanup-token");
	if (!workflowHeader) return false;
	return safeCompare(workflowHeader.trim(), expectedToken);
}

async function runCleanupInline(payload: CleanupPayload): Promise<{
	success: boolean;
	batches: number;
	totalDeleted: number;
}> {
	const workflowToken = process.env.WORKFLOW_CLEANUP_TOKEN;
	if (!workflowToken) {
		throw new Error("WORKFLOW_CLEANUP_TOKEN is not configured");
	}

	const convexClient = createConvexServerClient();
	const retentionDays = payload.retentionDays ?? 90;
	const batchSize = payload.batchSize ?? 100;

	let batches = 0;
	let totalDeleted = 0;
	let hitBatchLimit = false;

	while (batches < MAX_CLEANUP_BATCHES) {
		batches += 1;
		const preview = await convexClient.action(api.cleanupAction.runCleanupBatchForWorkflow, {
			workflowToken,
			retentionDays,
			batchSize,
			dryRun: true,
		});
		if (preview.deleted <= 0) {
			break;
		}

		const deletedBatch = await convexClient.action(api.cleanupAction.runCleanupBatchForWorkflow, {
			workflowToken,
			retentionDays,
			batchSize,
			dryRun: false,
		});
		totalDeleted += deletedBatch.deleted;

		if (batches >= MAX_CLEANUP_BATCHES) {
			hitBatchLimit = true;
			break;
		}

		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}

	if (hitBatchLimit) {
		throw new Error(`Cleanup exceeded maximum batches (${MAX_CLEANUP_BATCHES})`);
	}

	return {
		success: true,
		batches,
		totalDeleted,
	};
}

const workflow = serve<CleanupPayload>(async (context) => {
	const workflowToken = process.env.WORKFLOW_CLEANUP_TOKEN;
	if (!workflowToken) {
		throw new Error("WORKFLOW_CLEANUP_TOKEN is not configured");
	}

	const convexClient = createConvexServerClient();
	const retentionDays = context.requestPayload.retentionDays ?? 90;
	const batchSize = context.requestPayload.batchSize ?? 100;

	let batches = 0;
	let totalDeleted = 0;
	let hitBatchLimit = false;

	while (batches < MAX_CLEANUP_BATCHES) {
		batches += 1;
		const preview = await context.run(`query-batch-${batches}`, async () => {
			return convexClient.action(api.cleanupAction.runCleanupBatchForWorkflow, {
				workflowToken,
				retentionDays,
				batchSize,
				dryRun: true,
			});
		});

		if (preview.deleted <= 0) {
			break;
		}

		const deletedBatch = await context.run(`delete-batch-${batches}`, async () => {
			return convexClient.action(api.cleanupAction.runCleanupBatchForWorkflow, {
				workflowToken,
				retentionDays,
				batchSize,
				dryRun: false,
			});
		});

		totalDeleted += deletedBatch.deleted;

		if (batches >= MAX_CLEANUP_BATCHES) {
			hitBatchLimit = true;
			break;
		}

		await context.sleep(`sleep-${batches}`, "1s");
	}

	if (hitBatchLimit) {
		throw new Error(`Cleanup exceeded maximum batches (${MAX_CLEANUP_BATCHES})`);
	}

	return context.run("log-completion", async () => {
		return {
			success: true,
			batches,
			totalDeleted,
		};
	});
});

export const Route = createFileRoute("/api/workflow/cleanup")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const isWorkflowCallback = Boolean(request.headers.get("upstash-signature"));
				if (isWorkflowCallback) {
					return workflow.POST({ request });
				}

				if (!hasValidCleanupToken(request.headers)) {
					return json({ error: "Unauthorized — cleanup token required" }, { status: 401 });
				}

				let payloadRaw: unknown;
				try {
					payloadRaw = await request.json();
				} catch {
					return json({ error: "Invalid JSON payload" }, { status: 400 });
				}
				const payload = parseCleanupPayload(payloadRaw);
				if (!payload) {
					return json({ error: "Invalid cleanup payload" }, { status: 400 });
				}

				if (isLocalWorkflowRequest(request)) {
					try {
						const result = await runCleanupInline(payload);
						return json(result, { status: 200 });
					} catch (error) {
						const message = error instanceof Error ? error.message : "Cleanup failed";
						return json({ error: message }, { status: 500 });
					}
				}

				if (!workflowClient) {
					return json(
						{ error: "Workflow queue is not configured (missing QSTASH_TOKEN)" },
						{ status: 500 },
					);
				}

				try {
					const triggerHeaders: Record<string, string> = {
						"Content-Type": "application/json",
					};

					const { workflowRunId } = await workflowClient.trigger({
						url: request.url,
						body: payload,
						headers: triggerHeaders,
					});
					return json({ queued: true, workflowRunId }, { status: 202 });
				} catch (error) {
					const message = error instanceof Error ? error.message : "Failed to queue workflow";
					return json({ error: message }, { status: 500 });
				}
			},
		},
	},
});
