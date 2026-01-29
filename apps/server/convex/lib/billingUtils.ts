export const DAILY_AI_LIMIT_CENTS = 10;
export const FALLBACK_INPUT_COST_PER_MILLION = 1;
export const FALLBACK_OUTPUT_COST_PER_MILLION = 4;

const CJK_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

export type UsagePayload = {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	totalCostUsd?: number;
};

export function getCurrentDateKey(): string {
	return new Date().toISOString().split("T")[0];
}

export function normalizeUsagePayload(usage: Record<string, unknown>): UsagePayload {
	const promptTokens =
		typeof usage.prompt_tokens === "number"
			? usage.prompt_tokens
			: typeof usage.promptTokens === "number"
				? usage.promptTokens
				: undefined;
	const completionTokens =
		typeof usage.completion_tokens === "number"
			? usage.completion_tokens
			: typeof usage.completionTokens === "number"
				? usage.completionTokens
				: undefined;
	const totalTokens =
		typeof usage.total_tokens === "number"
			? usage.total_tokens
			: typeof usage.totalTokens === "number"
				? usage.totalTokens
				: undefined;
	const totalCostUsd =
		typeof usage.total_cost === "number"
			? usage.total_cost
			: typeof usage.totalCost === "number"
				? usage.totalCost
				: typeof usage.cost === "number"
					? usage.cost
					: undefined;

	return { promptTokens, completionTokens, totalTokens, totalCostUsd };
}

export function estimateTokensFromText(text: string): number {
	if (!text) return 0;
	const normalized = text.trim();
	if (!normalized) return 0;

	const wordCount = normalized.split(/\s+/).filter(Boolean).length;
	const charCount = normalized.replace(/\s+/g, "").length;

	if (CJK_CHAR_REGEX.test(normalized)) {
		return Math.max(1, charCount);
	}

	const wordEstimate = wordCount > 0 ? Math.ceil(wordCount * 1.33) : 0;
	const charEstimate = Math.ceil(charCount / 4);
	const estimate = Math.max(wordEstimate, charEstimate);
	return Math.max(1, estimate);
}

export function estimatePromptTokens(messages: Array<{ role: string; content: string }>): number {
	const combined = messages.map((m) => m.content).join(" ");
	return estimateTokensFromText(combined);
}

export function roundCents(cents: number): number {
	if (!Number.isFinite(cents)) return 0;
	return Math.max(0, Math.round(cents * 10000) / 10000);
}

export function calculateUsageCents(
	usage: UsagePayload | null,
	messages: Array<{ role: string; content: string }>,
	outputText: string,
): number | null {
	if (usage?.totalCostUsd !== undefined) {
		if (Number.isFinite(usage.totalCostUsd) && usage.totalCostUsd > 0) {
			return roundCents(usage.totalCostUsd * 100);
		}
	}

	const promptTokens = usage?.promptTokens ?? estimatePromptTokens(messages);
	const completionTokens = usage?.completionTokens ?? estimateTokensFromText(outputText);

	if (promptTokens <= 0 && completionTokens <= 0) {
		return null;
	}

	const totalUsd =
		(promptTokens / 1_000_000) * FALLBACK_INPUT_COST_PER_MILLION +
		(completionTokens / 1_000_000) * FALLBACK_OUTPUT_COST_PER_MILLION;

	return roundCents(totalUsd * 100);
}
