/**
 * Formats Artificial Analysis benchmark scores for display in the model info hover panel.
 */

/**
 * Formats a 0.0-1.0 float as a percentage string.
 * @param value - A decimal value between 0 and 1, or null/undefined
 * @returns Formatted percentage string (e.g., "79%") or "N/A"
 */
export function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "N/A";
	}
	const percent = Math.round(value * 100);
	return `${percent}%`;
}

/**
 * Formats a 0-100 index score as a percentage string.
 * @param value - A score between 0 and 100, or null/undefined
 * @returns Formatted percentage string (e.g., "63%") or "N/A"
 */
export function formatIndex(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "N/A";
	}
	const percent = Math.round(value);
	return `${percent}%`;
}

/**
 * Returns a Tailwind color class for a benchmark score.
 * Uses discrete color buckets: green (≥70), amber (40-69), red (<40), gray (null).
 * @param score - A numeric score or null
 * @returns Tailwind text color class
 */
export function getBenchmarkColor(score: number | null): string {
	if (score === null) {
		return "text-muted-foreground";
	}
	if (score >= 30) {
		return "text-emerald-500";
	}
	if (score >= 15) {
		return "text-amber-500";
	}
	return "text-rose-500";
}

/**
 * Checks if an evaluations object contains at least one numeric benchmark value.
 * @param evaluations - Object with benchmark scores (values can be number, null, or undefined)
 * @returns true if at least one value is a number, false otherwise
 */
export function hasBenchmarkData(
	evaluations: Record<string, number | null | undefined>
): boolean {
	return Object.values(evaluations).some((value) => typeof value === "number");
}
