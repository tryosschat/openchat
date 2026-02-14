import { describe, expect, it } from "vitest";
import {
	MANUAL_OVERRIDES,
	buildMatchingMap,
	normalizeSlug,
	type AAModel,
} from "../model_matching";

function createAAModel(slug: string, creatorSlug: string): AAModel {
	return {
		slug,
		model_creator: {
			slug: creatorSlug,
			name: creatorSlug,
		},
		evaluations: {
			artificial_analysis_intelligence_index: 60,
			mmlu_pro: 0.7,
		},
	};
}

describe("normalizeSlug", () => {
	it("normalizes casing and separators", () => {
		expect(normalizeSlug(" Claude_3.5 Sonnet ")).toBe("claude-3-5-sonnet");
	});

	it("strips trailing numeric version suffixes", () => {
		expect(normalizeSlug("gemini-2.0-flash-001")).toBe("gemini-2-0-flash");
		expect(normalizeSlug("deepseek-v3-0324")).toBe("deepseek-v3");
	});
});

describe("buildMatchingMap", () => {
	it.each([
		["claude-3-5-sonnet", "anthropic", "anthropic/claude-3.5-sonnet"],
		["deepseek-v3", "deepseek", "deepseek/deepseek-chat"],
		["llama-3-3-70b", "meta-llama", "meta-llama/llama-3.3-70b-instruct"],
		["gpt-4o", "openai", "openai/gpt-4o"],
		["gemini-2-5-pro", "google", "google/gemini-2.5-pro"],
		["grok-3", "x-ai", "x-ai/grok-3"],
	])("matches manual override for %s", (aaSlug, creatorSlug, expected) => {
		const map = buildMatchingMap(
			[createAAModel(aaSlug, creatorSlug)],
			[expected],
		);
		expect(map.get(aaSlug)).toBe(expected);
	});

	it("matches with normalized fallback when exact slug does not exist", () => {
		const map = buildMatchingMap(
			[createAAModel("gemini-2-0-flash-001", "google")],
			["google/gemini-2.0-flash-001"],
		);
		expect(map.get("gemini-2-0-flash-001")).toBe("google/gemini-2.0-flash-001");
	});

	it("returns no match for unknown models", () => {
		const map = buildMatchingMap(
			[createAAModel("totally-unknown-model", "unknown")],
			["openai/gpt-4o"],
		);
		expect(map.has("totally-unknown-model")).toBe(false);
	});

	it("every manual override resolves when its target is in the id set", () => {
		const allTargetIds = [...new Set(Object.values(MANUAL_OVERRIDES))];
		const aaModels = Object.entries(MANUAL_OVERRIDES).map(([aaSlug, openRouterId]) =>
			createAAModel(aaSlug, openRouterId.split("/")[0] ?? ""),
		);

		const map = buildMatchingMap(aaModels, allTargetIds);

		for (const targetId of allTargetIds) {
			const matched = [...map.values()].includes(targetId);
			expect(matched, `Expected ${targetId} to be matched by at least one override`).toBe(true);
		}
	});

	it("builds an AA slug to OpenRouter id map", () => {
		const aaModels: AAModel[] = [
			createAAModel("claude-3-5-sonnet", "anthropic"),
			createAAModel("gemini 2_5.flash", "google"),
			createAAModel("unlisted-model", "unknown"),
		];

		const openRouterIds = [
			"anthropic/claude-3.5-sonnet",
			"google/gemini-2.5-flash",
			"openai/gpt-4o",
		];

		const map = buildMatchingMap(aaModels, openRouterIds);

		expect(map.get("claude-3-5-sonnet")).toBe("anthropic/claude-3.5-sonnet");
		expect(map.get("gemini 2_5.flash")).toBe("google/gemini-2.5-flash");
		expect(map.has("unlisted-model")).toBe(false);
	});

	it("only matches against the provided OpenRouter ids", () => {
		const aaModels: AAModel[] = [createAAModel("claude-3-5-sonnet", "anthropic")];
		const openRouterIds = ["openai/gpt-4o"];

		const map = buildMatchingMap(aaModels, openRouterIds);

		expect(map.size).toBe(0);
	});
});
