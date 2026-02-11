import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseEnvFile(content: string): Record<string, string> {
	const parsed: Record<string, string> = {};

	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex <= 0) continue;

		const key = trimmed.slice(0, equalsIndex).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

		let value = trimmed.slice(equalsIndex + 1).trim();
		if (
			(value.startsWith("\"") && value.endsWith("\"")) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		parsed[key] = value;
	}

	return parsed;
}

function loadLocalEnvDefaults(): void {
	const envFiles = [
		join(process.cwd(), "apps/web/.env.local"),
		join(process.cwd(), "apps/server/.env.local"),
		join(process.cwd(), ".env.local"),
	];

	for (const filePath of envFiles) {
		if (!existsSync(filePath)) continue;
		const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
		for (const [key, value] of Object.entries(parsed)) {
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
	}
}

async function main() {
	loadLocalEnvDefaults();

	const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
	const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

	if (!url || !token) {
		process.stdout.write(
			"[check-redis] UPSTASH_REDIS_REST_URL/TOKEN not set. Redis-backed features are disabled.\n",
		);
		return;
	}

	try {
		const response = await fetch(`${url}/pipeline`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify([["PING"]]),
			signal: AbortSignal.timeout(5_000),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`HTTP ${response.status} ${body}`);
		}

		const payload = (await response.json()) as Array<{ result?: string }>;
		const result = payload[0]?.result;
		if (result !== "PONG") {
			throw new Error("Redis ping failed");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`Redis is not reachable at ${url}. ${message}\n`);
		process.stderr.write(
			"Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.\n",
		);
		process.exit(1);
	}
}

main();
