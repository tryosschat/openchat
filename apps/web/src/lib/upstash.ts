import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { Client as WorkflowClient } from "@upstash/workflow";

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const QSTASH_URL = process.env.QSTASH_URL?.trim();
const QSTASH_TOKEN = process.env.QSTASH_TOKEN?.trim();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

type RatelimitDecision = {
	success: boolean;
	limit: number;
	remaining: number;
	reset: number;
	pending: Promise<unknown>;
};

type RatelimitLike = {
	limit: (identifier: string) => Promise<RatelimitDecision>;
};

export const upstashRedis =
	UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN
		? new Redis({
				url: UPSTASH_REDIS_REST_URL,
				token: UPSTASH_REDIS_REST_TOKEN,
			})
		: null;

function createSlidingWindowRatelimit(
	limit: number,
	window: `${number} ${"ms" | "s" | "m" | "h" | "d"}`,
	prefix: string,
): RatelimitLike | null {
	if (!upstashRedis) {
		if (!IS_PRODUCTION) return null;
		return {
			limit: async () => ({
				success: false,
				limit: 0,
				remaining: 0,
				reset: Date.now() + 60_000,
				pending: Promise.resolve(),
			}),
		};
	}
	return new Ratelimit({
		redis: upstashRedis,
		limiter: Ratelimit.slidingWindow(limit, window),
		prefix,
	});
}

export const chatUserRatelimit = createSlidingWindowRatelimit(30, "60 s", "ratelimit:chat:user");
export const uploadRatelimit = createSlidingWindowRatelimit(20, "60 s", "ratelimit:upload:user");
export const exportRatelimit = createSlidingWindowRatelimit(10, "60 s", "ratelimit:export:user");
export const authRatelimit = createSlidingWindowRatelimit(20, "60 s", "ratelimit:auth:user");

export const workflowClient = QSTASH_URL && QSTASH_TOKEN
	? new WorkflowClient({
			baseUrl: QSTASH_URL,
			token: QSTASH_TOKEN,
		})
	: null;

if (!upstashRedis) {
	if (IS_PRODUCTION) {
		console.error("[Upstash] Redis not configured in production; rate-limited endpoints fail closed");
	} else {
		console.warn("[Upstash] Redis not configured — rate limiting is disabled");
	}
}

if (!workflowClient && IS_PRODUCTION) {
	console.error("[Upstash] QStash not configured in production");
}

export function isUpstashRedisConfigured(): boolean {
	return upstashRedis !== null;
}

export function isQstashConfigured(): boolean {
	return workflowClient !== null;
}

export function shouldFailClosedForMissingUpstash(): boolean {
	return IS_PRODUCTION && upstashRedis === null;
}
