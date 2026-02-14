import { describe, expect, it } from "vitest";
import {
	formatPercent,
	formatIndex,
	getBenchmarkColor,
	hasBenchmarkData,
} from "@/lib/benchmark-formatting";

describe("formatPercent", () => {
	it("formats 0.791 as 79%", () => {
		expect(formatPercent(0.791)).toBe("79%");
	});

	it("formats 0.5 as 50%", () => {
		expect(formatPercent(0.5)).toBe("50%");
	});

	it("formats 0.999 as 100%", () => {
		expect(formatPercent(0.999)).toBe("100%");
	});

	it("formats 0 as 0%", () => {
		expect(formatPercent(0)).toBe("0%");
	});

	it("returns N/A for null", () => {
		expect(formatPercent(null)).toBe("N/A");
	});

	it("returns N/A for undefined", () => {
		expect(formatPercent(undefined)).toBe("N/A");
	});
});

describe("formatIndex", () => {
	it("formats 62.9 as 63%", () => {
		expect(formatIndex(62.9)).toBe("63%");
	});

	it("formats 100 as 100%", () => {
		expect(formatIndex(100)).toBe("100%");
	});

	it("formats 0 as 0%", () => {
		expect(formatIndex(0)).toBe("0%");
	});

	it("formats 50.4 as 50%", () => {
		expect(formatIndex(50.4)).toBe("50%");
	});

	it("returns N/A for null", () => {
		expect(formatIndex(null)).toBe("N/A");
	});

	it("returns N/A for undefined", () => {
		expect(formatIndex(undefined)).toBe("N/A");
	});
});

describe("getBenchmarkColor", () => {
	it("returns green class for high score (85)", () => {
		const color = getBenchmarkColor(85);
		expect(color).toContain("emerald");
	});

	it("returns green class for score at threshold (70)", () => {
		const color = getBenchmarkColor(70);
		expect(color).toContain("emerald");
	});

	it("returns amber class for mid score (50)", () => {
		const color = getBenchmarkColor(50);
		expect(color).toContain("amber");
	});

	it("returns amber class for score at lower threshold (40)", () => {
		const color = getBenchmarkColor(40);
		expect(color).toContain("amber");
	});

	it("returns red class for low score (20)", () => {
		const color = getBenchmarkColor(20);
		expect(color).toContain("red");
	});

	it("returns red class for score below 40", () => {
		const color = getBenchmarkColor(39);
		expect(color).toContain("red");
	});

	it("returns muted class for null", () => {
		const color = getBenchmarkColor(null);
		expect(color).toContain("muted");
	});
});

describe("hasBenchmarkData", () => {
	it("returns true when at least one value is a number", () => {
		const evaluations = {
			artificial_analysis_intelligence_index: 62.9,
			mmlu_pro: null,
		};
		expect(hasBenchmarkData(evaluations)).toBe(true);
	});

	it("returns true when all values are numbers", () => {
		const evaluations = {
			artificial_analysis_intelligence_index: 62.9,
			mmlu_pro: 0.791,
			gpqa: 0.748,
		};
		expect(hasBenchmarkData(evaluations)).toBe(true);
	});

	it("returns false when all values are null", () => {
		const evaluations = {
			artificial_analysis_intelligence_index: null,
			mmlu_pro: null,
		};
		expect(hasBenchmarkData(evaluations)).toBe(false);
	});

	it("returns false when all values are undefined", () => {
		const evaluations = {
			artificial_analysis_intelligence_index: undefined,
			mmlu_pro: undefined,
		};
		expect(hasBenchmarkData(evaluations)).toBe(false);
	});

	it("returns false for empty object", () => {
		const evaluations = {};
		expect(hasBenchmarkData(evaluations)).toBe(false);
	});

	it("returns true when mixed null and numbers", () => {
		const evaluations = {
			artificial_analysis_intelligence_index: 62.9,
			mmlu_pro: null,
			gpqa: undefined,
		};
		expect(hasBenchmarkData(evaluations)).toBe(true);
	});
});
