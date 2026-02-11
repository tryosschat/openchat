type PipelineResult = Array<{ result: unknown }>;

function getConfig(): { url: string; token: string } | null {
	const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
	const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
	if (!url || !token) return null;
	return { url, token };
}

function shouldLogUpstashUsageErrors(): boolean {
	return process.env.LOG_UPSTASH_USAGE_ERRORS === "true";
}

function usageCounterKey(userId: string, dateKey: string): string {
	return `openchat:usage:${userId}:${dateKey}`;
}

function getMidnightUtcEpochSeconds(dateKey: string): number {
	const [year, month, day] = dateKey.split("-").map((segment) => Number.parseInt(segment, 10));
	const expiresAtMs = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
	if (!Number.isFinite(expiresAtMs)) {
		throw new Error(`Invalid dateKey: ${dateKey}`);
	}
	return Math.floor(expiresAtMs / 1000);
}

async function executePipeline(commands: Array<Array<string | number>>): Promise<PipelineResult | null> {
	const config = getConfig();
	if (!config) return null;

	const response = await fetch(`${config.url}/pipeline`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(commands),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Upstash pipeline failed: ${response.status} ${body}`);
	}

	return (await response.json()) as PipelineResult;
}

export async function getDailyUsageFromUpstash(
	userId: string,
	dateKey: string,
): Promise<number | null> {
	if (!getConfig()) return null;

	try {
		const key = usageCounterKey(userId, dateKey);
		const result = await executePipeline([["GET", key]]);
		const raw = result?.[0]?.result;
		if (raw === null || raw === undefined) return null;
		if (typeof raw === "number") return raw;
		if (typeof raw === "string") {
			const parsed = Number.parseInt(raw, 10);
			return Number.isFinite(parsed) ? parsed : null;
		}
		return null;
	} catch (error) {
		if (shouldLogUpstashUsageErrors()) {
			console.warn("[Usage] Upstash GET failed", error);
		}
		return null;
	}
}

export async function incrementDailyUsageInUpstash(
	userId: string,
	dateKey: string,
	usageCents: number,
): Promise<void> {
	if (!getConfig()) return;
	if (!Number.isFinite(usageCents) || usageCents <= 0) return;

	const key = usageCounterKey(userId, dateKey);
	const expiresAt = getMidnightUtcEpochSeconds(dateKey);

	try {
		await executePipeline([
			["INCRBY", key, Math.floor(usageCents)],
			["EXPIREAT", key, expiresAt],
		]);
	} catch (error) {
		if (shouldLogUpstashUsageErrors()) {
			console.warn("[Usage] Upstash INCRBY failed", error);
		}
	}
}
