import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { Client as WorkflowClient } from "@upstash/workflow";

const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const QSTASH_URL = process.env.QSTASH_URL?.trim();
const QSTASH_TOKEN = process.env.QSTASH_TOKEN?.trim();

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
) {
	if (!upstashRedis) return null;
	return new Ratelimit({
		redis: upstashRedis,
		limiter: Ratelimit.slidingWindow(limit, window),
		prefix,
	});
}

export const chatUserRatelimit = createSlidingWindowRatelimit(30, "60 s", "ratelimit:chat:user");
export const chatIpRatelimit = createSlidingWindowRatelimit(60, "60 s", "ratelimit:chat:ip");
export const chatRatelimit = chatUserRatelimit;
export const uploadRatelimit = createSlidingWindowRatelimit(20, "60 s", "ratelimit:upload:user");
export const exportRatelimit = createSlidingWindowRatelimit(10, "60 s", "ratelimit:export:user");
export const authRatelimit = createSlidingWindowRatelimit(20, "60 s", "ratelimit:auth:user");

export const workflowClient = QSTASH_TOKEN
	? new WorkflowClient({
			baseUrl: QSTASH_URL,
			token: QSTASH_TOKEN,
		})
	: null;

export function isUpstashRedisConfigured(): boolean {
	return upstashRedis !== null;
}

export function isQstashConfigured(): boolean {
	return workflowClient !== null;
}
