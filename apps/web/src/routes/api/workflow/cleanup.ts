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

function isLocalWorkflowRequest(request: Request): boolean {
	const hostname = new URL(request.url).hostname;
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
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

	while (true) {
		batches += 1;
		const preview = await convexClient.action(api.crons.runCleanupBatchForWorkflow, {
			workflowToken,
			retentionDays,
			batchSize,
			dryRun: true,
		});
		if (preview.deleted <= 0) {
			break;
		}

		const deletedBatch = await convexClient.action(api.crons.runCleanupBatchForWorkflow, {
			workflowToken,
			retentionDays,
			batchSize,
			dryRun: false,
		});
		totalDeleted += deletedBatch.deleted;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
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

	while (true) {
		batches += 1;
		const preview = await context.run(`query-batch-${batches}`, async () => {
			return convexClient.action(api.crons.runCleanupBatchForWorkflow, {
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
			return convexClient.action(api.crons.runCleanupBatchForWorkflow, {
				workflowToken,
				retentionDays,
				batchSize,
				dryRun: false,
			});
		});

		totalDeleted += deletedBatch.deleted;
		await context.sleep(`sleep-${batches}`, "1s");
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

				let payload: CleanupPayload;
				try {
					payload = (await request.json()) as CleanupPayload;
				} catch {
					return json({ error: "Invalid JSON payload" }, { status: 400 });
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
					const { workflowRunId } = await workflowClient.trigger({
						url: request.url,
						body: payload,
						headers: {
							"Content-Type": "application/json",
						},
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
