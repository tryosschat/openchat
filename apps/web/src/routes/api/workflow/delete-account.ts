import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { serve } from "@upstash/workflow/tanstack";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { createConvexServerClient } from "@/lib/convex-server";
import { upstashRedis, workflowClient } from "@/lib/upstash";

const CONVEX_SITE_URL =
	process.env.VITE_CONVEX_SITE_URL || process.env.CONVEX_SITE_URL;

type DeleteAccountPayload = {
	userId: string;
	externalId: string;
	batchSize?: number;
};

type DeleteStep =
	| "delete-stream-jobs"
	| "delete-messages"
	| "delete-chats"
	| "delete-files";

async function getAuthTokenFromWorkflowHeaders(headers: Headers): Promise<string | null> {
	if (!CONVEX_SITE_URL) return null;

	const cookie = headers.get("cookie");
	if (!cookie) return null;

	const response = await fetch(`${CONVEX_SITE_URL}/api/auth/convex/token`, {
		headers: { cookie },
	});
	if (!response.ok) return null;

	const data = (await response.json()) as { token?: string } | null;
	return data?.token ?? null;
}

async function clearRedisUserKeys(userId: string): Promise<number> {
	if (!upstashRedis) return 0;

	const directKeys = [
		`user:${userId}:unread`,
		`presence:${userId}`,
		`rate:chat:user:${userId}`,
	];
	const patternKeys = [
		`chat:*:typing:${userId}`,
		`openchat:usage:${userId}:*`,
		`ratelimit:*:${userId}`,
	];

	let deleted = 0;
	for (const key of directKeys) {
		deleted += await upstashRedis.del(key);
	}

	for (const pattern of patternKeys) {
		let cursor: string | number = "0";
		do {
			const [nextCursor, keys]: [string, Array<string>] = await upstashRedis.scan(cursor, {
				match: pattern,
				count: 100,
			});
			cursor = nextCursor;
			if (keys.length > 0) {
				deleted += await upstashRedis.del(...keys);
			}
		} while (String(cursor) !== "0");
	}

	return deleted;
}

function isLocalWorkflowRequest(request: Request): boolean {
	const hostname = new URL(request.url).hostname;
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getWorkflowTriggerHeaders(headers: Headers): Record<string, string> {
	const triggerHeaders: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const cookie = headers.get("cookie");
	if (cookie) {
		triggerHeaders.cookie = cookie;
	}
	return triggerHeaders;
}

async function runDeleteAccountInline(
	payload: DeleteAccountPayload,
	headers: Headers,
): Promise<{
	success: boolean;
	deleted: { streamJobs: number; messages: number; chats: number; files: number; redisKeys: number };
}> {
	const { userId, externalId, batchSize } = payload;
	const authToken = await getAuthTokenFromWorkflowHeaders(headers);
	if (!authToken) {
		throw new Error("Unauthorized");
	}

	const convexClient = createConvexServerClient(authToken);
	const convexUserId = userId as Id<"users">;

	const runBatchStep = async (step: DeleteStep) => {
		let totalDeleted = 0;

		while (true) {
			const result = await convexClient.action(api.users.deleteAccountWorkflowStep, {
				userId: convexUserId,
				externalId,
				step,
				batchSize,
			});

			totalDeleted += result.deleted;
			if (!result.hasMore) {
				break;
			}
		}

		return totalDeleted;
	};

	const deletedStreamJobs = await runBatchStep("delete-stream-jobs");
	const deletedMessages = await runBatchStep("delete-messages");
	const deletedChats = await runBatchStep("delete-chats");
	const deletedFiles = await runBatchStep("delete-files");
	const deleteUserResult = await convexClient.action(api.users.deleteAccountWorkflowStep, {
		userId: convexUserId,
		externalId,
		step: "delete-user",
	});
	const deletedRedisKeys = await clearRedisUserKeys(userId);

	return {
		success: deleteUserResult.success === true,
		deleted: {
			streamJobs: deletedStreamJobs,
			messages: deletedMessages,
			chats: deletedChats,
			files: deletedFiles,
			redisKeys: deletedRedisKeys,
		},
	};
}

const workflow = serve<DeleteAccountPayload>(async (context) => {
	const { userId, externalId, batchSize } = context.requestPayload;
	const authToken = await context.run("resolve-auth", async () => {
		return getAuthTokenFromWorkflowHeaders(context.headers);
	});
	if (!authToken) {
		throw new Error("Unauthorized");
	}

	const convexClient = createConvexServerClient(authToken);
	const convexUserId = userId as Id<"users">;

	const runBatchStep = async (step: DeleteStep, stepName: string) => {
		let totalDeleted = 0;
		let iteration = 0;

		while (true) {
			iteration += 1;
			const result = await context.run(`${stepName}-${iteration}`, async () => {
				return convexClient.action(api.users.deleteAccountWorkflowStep, {
					userId: convexUserId,
					externalId,
					step,
					batchSize,
				});
			});

			totalDeleted += result.deleted;
			if (!result.hasMore) {
				break;
			}
		}

		return totalDeleted;
	};

	const deletedStreamJobs = await runBatchStep("delete-stream-jobs", "delete-stream-jobs");
	const deletedMessages = await runBatchStep("delete-messages", "delete-messages");
	const deletedChats = await runBatchStep("delete-chats", "delete-chats");
	const deletedFiles = await runBatchStep("delete-files", "delete-files");

	const deleteUserResult = await context.run("delete-user", async () => {
		return convexClient.action(api.users.deleteAccountWorkflowStep, {
			userId: convexUserId,
			externalId,
			step: "delete-user",
		});
	});

	const deletedRedisKeys = await context.run("cleanup-redis", async () => {
		return clearRedisUserKeys(userId);
	});

	return {
		success: deleteUserResult.success === true,
		deleted: {
			streamJobs: deletedStreamJobs,
			messages: deletedMessages,
			chats: deletedChats,
			files: deletedFiles,
			redisKeys: deletedRedisKeys,
		},
	};
});

export const Route = createFileRoute("/api/workflow/delete-account")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const isWorkflowCallback = Boolean(request.headers.get("upstash-signature"));
				if (isWorkflowCallback) {
					return workflow.POST({ request });
				}

				let payload: DeleteAccountPayload;
				try {
					payload = (await request.json()) as DeleteAccountPayload;
				} catch {
					return json({ error: "Invalid JSON payload" }, { status: 400 });
				}

				if (isLocalWorkflowRequest(request)) {
					try {
						const result = await runDeleteAccountInline(payload, request.headers);
						return json(result, { status: 200 });
					} catch (error) {
						const message = error instanceof Error ? error.message : "Failed to delete account";
						const status = message === "Unauthorized" ? 401 : 500;
						return json({ error: message }, { status });
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
						headers: getWorkflowTriggerHeaders(request.headers),
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
