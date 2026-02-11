import { upstashRedis } from "@/lib/upstash";

const WORKFLOW_AUTH_TOKEN_PREFIX = "workflow:auth-token";
const WORKFLOW_AUTH_TOKEN_TTL_SECONDS = 60 * 60;

function createWorkflowAuthTokenKey(): string {
	return `${WORKFLOW_AUTH_TOKEN_PREFIX}:${crypto.randomUUID()}`;
}

export async function storeWorkflowAuthToken(authToken: string): Promise<string | null> {
	if (!upstashRedis) return null;
	const key = createWorkflowAuthTokenKey();
	await upstashRedis.set(key, authToken, {
		ex: WORKFLOW_AUTH_TOKEN_TTL_SECONDS,
	});
	return key;
}

export async function getWorkflowAuthToken(key: string): Promise<string | null> {
	if (!upstashRedis) return null;
	const value = await upstashRedis.get<string>(key);
	if (typeof value !== "string" || value.length === 0) {
		return null;
	}
	return value;
}
