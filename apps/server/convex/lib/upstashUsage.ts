type PipelineEntry = {
	result?: unknown;
	error?: string;
};

type PipelineResult = Array<PipelineEntry>;
const UPSTASH_PIPELINE_TIMEOUT_MS = 10_000;

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
		signal: AbortSignal.timeout(UPSTASH_PIPELINE_TIMEOUT_MS),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Upstash pipeline failed: ${response.status} ${body}`);
	}

	const json = (await response.json()) as PipelineResult;

	if (!Array.isArray(json)) {
		throw new Error("Upstash pipeline returned invalid response");
	}

	if (json.length !== commands.length) {
		throw new Error("Upstash pipeline returned unexpected command count");
	}

	for (let index = 0; index < json.length; index++) {
		const entry = json[index];
		if (!entry || typeof entry !== "object") {
			throw new Error(`Upstash pipeline returned invalid command result at index ${index}`);
		}
		if (typeof entry.error === "string" && entry.error.length > 0) {
			const commandName = String(commands[index]?.[0] ?? "UNKNOWN");
			throw new Error(
				`Upstash pipeline command failed (${commandName} at index ${index}): ${entry.error}`,
			);
		}
	}

	return json;
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
	const roundedCents = Math.ceil(usageCents);
	if (roundedCents <= 0) return;

	const key = usageCounterKey(userId, dateKey);

	try {
		const expiresAt = getMidnightUtcEpochSeconds(dateKey);
		await executePipeline([
			["INCRBY", key, roundedCents],
			["EXPIREAT", key, expiresAt],
		]);
	} catch (error) {
		if (shouldLogUpstashUsageErrors()) {
			console.warn("[Usage] Upstash INCRBY failed", error);
		}
	}
}

export async function reserveDailyUsageInUpstash(
	userId: string,
	dateKey: string,
	reserveCents: number,
): Promise<number | null> {
	if (!getConfig()) return null;
	if (!Number.isFinite(reserveCents) || reserveCents <= 0) return null;
	const roundedCents = Math.ceil(reserveCents);
	if (roundedCents <= 0) return null;

	const key = usageCounterKey(userId, dateKey);

	try {
		const expiresAt = getMidnightUtcEpochSeconds(dateKey);
		const result = await executePipeline([
			["INCRBY", key, roundedCents],
			["EXPIREAT", key, expiresAt],
		]);
		const total = result?.[0]?.result;
		if (typeof total === "number") return total;
		if (typeof total === "string") {
			const parsed = Number.parseInt(total, 10);
			return Number.isFinite(parsed) ? parsed : null;
		}
		return null;
	} catch (error) {
		if (shouldLogUpstashUsageErrors()) {
			console.warn("[Usage] Upstash reserve failed", error);
		}
		return null;
	}
}

export async function adjustDailyUsageInUpstash(
	userId: string,
	dateKey: string,
	usageCentsDelta: number,
): Promise<void> {
	if (!getConfig()) return;
	if (!Number.isFinite(usageCentsDelta) || usageCentsDelta === 0) return;
	const roundedDelta =
		usageCentsDelta > 0 ? Math.ceil(usageCentsDelta) : -Math.ceil(Math.abs(usageCentsDelta));
	if (roundedDelta === 0) return;

	const key = usageCounterKey(userId, dateKey);

	try {
		const expiresAt = getMidnightUtcEpochSeconds(dateKey);
		await executePipeline([
			["INCRBY", key, roundedDelta],
			["EXPIREAT", key, expiresAt],
		]);
	} catch (error) {
		if (shouldLogUpstashUsageErrors()) {
			console.warn("[Usage] Upstash adjust failed", error);
		}
	}
}
