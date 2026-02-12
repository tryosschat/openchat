import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { serve } from "@upstash/workflow/tanstack";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { createConvexServerClient } from "@/lib/convex-server";
import { getAuthUser, getConvexAuthToken, isSameOrigin } from "@/lib/server-auth";
import {
	authRatelimit,
	shouldFailClosedForMissingUpstash,
	upstashRedis,
	workflowClient,
} from "@/lib/upstash";
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
	| "delete-files"
	| "delete-chat-read-statuses"
	| "delete-prompt-templates";

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
	];

	let deleted = 0;
	if (directKeys.length > 0) {
		deleted += await upstashRedis.del(...directKeys);
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

function isLocalWorkflowExecutionEnabled(): boolean {
	return process.env.NODE_ENV !== "production";
}

function getWorkflowTriggerHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
	};
}

function getWorkflowCallbackUrl(request: Request): string | null {
	const configuredBase =
		process.env.VITE_APP_URL ||
		(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
	if (!configuredBase) return null;

	const pathname = new URL(request.url).pathname;
	return new URL(pathname, configuredBase).toString();
}

function hasWorkflowSigningKeysConfigured(): boolean {
	return Boolean(
		process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY,
	);
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
	await runBatchStep("delete-chat-read-statuses");
	await runBatchStep("delete-prompt-templates");
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
		console.error("[Workflow][delete-account] Missing auth token reference");
		return EMPTY_DELETE_RESULT;
	}

	const authToken = await context.run("resolve-auth", async () => {
		return getWorkflowAuthToken(authTokenRef);
	});
	if (!authToken) {
		console.error("[Workflow][delete-account] Failed to resolve auth token");
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
	await runBatchStep("delete-chat-read-statuses", "delete-chat-read-statuses");
	await runBatchStep("delete-prompt-templates", "delete-prompt-templates");

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
					if (!hasWorkflowSigningKeysConfigured()) {
						return json({ error: "Workflow signing not configured" }, { status: 500 });
					}
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

				if (shouldFailClosedForMissingUpstash()) {
					return json({ error: "Service temporarily unavailable" }, { status: 503 });
				}

				if (authRatelimit) {
					const rl = await authRatelimit.limit(`delete-account:${authConvexUser._id}`);
					if (!rl.success) {
						const retryAfterSeconds = Math.max(
							1,
							Math.ceil((rl.reset - Date.now()) / 1000),
						);
						return json(
							{ error: "Rate limit exceeded" },
							{ status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
						);
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

				if (isLocalWorkflowExecutionEnabled()) {
					try {
						const result = await runDeleteAccountInline(normalizedPayload, authToken);
						return json(result, { status: 200 });
					} catch (error) {
						const message = error instanceof Error ? error.message : "Failed to delete account";
						const status = message === "Unauthorized" ? 401 : 500;
						if (status === 500) {
							console.error("[Workflow][delete-account] Local execution failed", error);
						}
						return json({ error: status === 500 ? "Internal server error" : message }, { status });
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
					const callbackUrl = getWorkflowCallbackUrl(request);
					if (!callbackUrl) {
						return json({ error: "Workflow callback URL is not configured" }, { status: 500 });
					}

					const triggerHeaders = getWorkflowTriggerHeaders();
					const { workflowRunId } = await workflowClient.trigger({
						url: callbackUrl,
						body: {
							...normalizedPayload,
							authTokenRef,
						},
						headers: triggerHeaders,
					});
					return json({ queued: true, workflowRunId }, { status: 202 });
				} catch (error) {
					console.error("[Workflow][delete-account] Queue trigger failed", error);
					return json({ error: "Internal server error" }, { status: 500 });
				}
			},
		},
	},
});
