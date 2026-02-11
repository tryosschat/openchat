import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { serve } from "@upstash/workflow/tanstack";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { createConvexServerClient } from "@/lib/convex-server";
import { getAuthUser, getConvexAuthToken, isSameOrigin } from "@/lib/server-auth";
import { authRatelimit, upstashRedis, workflowClient } from "@/lib/upstash";
import { getWorkflowAuthToken, storeWorkflowAuthToken } from "@/lib/workflow-auth-token";

type DeleteAccountPayload = {
	userId?: string;
	externalId?: string;
	authTokenRef?: string;
	batchSize?: number;
};

type DeleteStep =
	| "delete-stream-jobs"
	| "delete-messages"
	| "delete-chats"
	| "delete-files";

const MAX_DELETE_BATCHES = 500;

const EMPTY_DELETE_RESULT = {
	success: false,
	deleted: {
		streamJobs: 0,
		messages: 0,
		chats: 0,
		files: 0,
		redisKeys: 0,
	},
};

function parseDeletePayload(raw: unknown): DeleteAccountPayload | null {
	if (!raw || typeof raw !== "object") return null;

	const payload = raw as Record<string, unknown>;

	const parsed: DeleteAccountPayload = {
		userId: typeof payload.userId === "string" ? payload.userId.trim() : undefined,
		externalId:
			typeof payload.externalId === "string" ? payload.externalId.trim() : undefined,
		authTokenRef: typeof payload.authTokenRef === "string" ? payload.authTokenRef : undefined,
	};

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
	return (
		hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
	);
}

function getWorkflowTriggerHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
	};
}

async function runDeleteAccountInline(
	payload: DeleteAccountPayload,
	authToken: string,
): Promise<{
	success: boolean;
	deleted: { streamJobs: number; messages: number; chats: number; files: number; redisKeys: number };
}> {
	const { userId, externalId, batchSize } = payload;
	if (!userId || !externalId) {
		throw new Error("Invalid delete-account payload");
	}
	const convexClient = createConvexServerClient(authToken);
	const convexUserId = userId as Id<"users">;

	const runBatchStep = async (step: DeleteStep) => {
		let totalDeleted = 0;
		let iteration = 0;

		while (iteration < MAX_DELETE_BATCHES) {
			iteration += 1;
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
	if (!userId || !externalId) {
		return EMPTY_DELETE_RESULT;
	}
	const authTokenRef = context.requestPayload.authTokenRef;
	if (!authTokenRef) {
		return EMPTY_DELETE_RESULT;
	}

	const authToken = await context.run("resolve-auth", async () => {
		return getWorkflowAuthToken(authTokenRef);
	});
	if (!authToken) {
		return EMPTY_DELETE_RESULT;
	}

	const convexClient = createConvexServerClient(authToken);
	const convexUserId = userId as Id<"users">;

	const runBatchStep = async (step: DeleteStep, stepName: string) => {
		let totalDeleted = 0;
		let iteration = 0;

		while (iteration < MAX_DELETE_BATCHES) {
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

				if (!isSameOrigin(request)) {
					return json({ error: "Invalid origin" }, { status: 403 });
				}

				const authToken = await getConvexAuthToken(request);
				if (!authToken) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}
				const authUser = await getAuthUser(request);
				if (!authUser) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}
				const authConvexClient = createConvexServerClient(authToken);
				const authConvexUser = await authConvexClient.query(api.users.getByExternalId, {
					externalId: authUser.id,
				});
				if (!authConvexUser?._id) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}

				if (authRatelimit) {
					const rl = await authRatelimit.limit(`delete-account:${authConvexUser._id}`);
					if (!rl.success) {
						return json({ error: "Rate limit exceeded" }, { status: 429 });
					}
				}

				let payloadRaw: unknown;
				try {
					payloadRaw = await request.json();
				} catch {
					return json({ error: "Invalid JSON payload" }, { status: 400 });
				}
				const payload = parseDeletePayload(payloadRaw);
				if (!payload) {
					return json({ error: "Invalid delete-account payload" }, { status: 400 });
				}
				const normalizedPayload: DeleteAccountPayload = {
					...payload,
					userId: authConvexUser._id,
					externalId: authUser.id,
				};

				if (isLocalWorkflowRequest(request)) {
					try {
						const result = await runDeleteAccountInline(normalizedPayload, authToken);
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
					const authTokenRef = await storeWorkflowAuthToken(authToken);
					if (!authTokenRef) {
						return json(
							{ error: "Workflow auth cache is not configured" },
							{ status: 500 },
						);
					}

					const triggerHeaders = getWorkflowTriggerHeaders();
					const { workflowRunId } = await workflowClient.trigger({
						url: request.url,
						body: {
							...normalizedPayload,
							authTokenRef,
						},
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
