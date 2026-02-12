import { upstashRedis } from "@/lib/upstash";
import { decryptSecret, encryptSecret } from "@/lib/server-crypto";

const WORKFLOW_AUTH_TOKEN_PREFIX = "workflow:auth-token";
const WORKFLOW_AUTH_TOKEN_TTL_SECONDS = 60 * 5;

function createWorkflowAuthTokenKey(): string {
	return `${WORKFLOW_AUTH_TOKEN_PREFIX}:${crypto.randomUUID()}`;
}

export async function storeWorkflowAuthToken(authToken: string): Promise<string | null> {
	if (!upstashRedis) return null;
	if (authToken.trim().length === 0) return null;
	const key = createWorkflowAuthTokenKey();
	const encrypted = encryptSecret(authToken);
	await upstashRedis.set(key, encrypted, {
		ex: WORKFLOW_AUTH_TOKEN_TTL_SECONDS,
	});
	return key;
}

export async function getWorkflowAuthToken(key: string): Promise<string | null> {
	if (!upstashRedis) return null;
	if (!key.startsWith(`${WORKFLOW_AUTH_TOKEN_PREFIX}:`)) {
		return null;
	}
	const value = await upstashRedis.getdel<string>(key);
	if (typeof value !== "string" || value.length === 0) {
		return null;
	}
	try {
		const token = decryptSecret(value);
		return token.trim().length > 0 ? token : null;
	} catch {
		return null;
	}
}
