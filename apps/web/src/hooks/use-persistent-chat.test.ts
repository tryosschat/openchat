import { describe, expect, it } from "vitest";
import {
	formatTitleGenerationError,
	shouldAttemptAutoTitle,
	shouldTriggerAutoTitle,
} from "@/lib/title-generation";

describe("shouldAttemptAutoTitle", () => {
	it("returns true for the first user message with non-empty seed", () => {
		const result = shouldAttemptAutoTitle({
			existingMessageCount: 0,
			seedText: "hello world",
		});

		expect(result).toBe(true);
	});

	it("returns false when chat already has prior messages", () => {
		const result = shouldAttemptAutoTitle({
			existingMessageCount: 1,
			seedText: "hello world",
		});

		expect(result).toBe(false);
	});

	it("returns false when seed text is empty/whitespace", () => {
		const result = shouldAttemptAutoTitle({
			existingMessageCount: 0,
			seedText: "   ",
		});

		expect(result).toBe(false);
	});
});

describe("formatTitleGenerationError", () => {
	it("returns payload error string when present", () => {
		expect(formatTitleGenerationError({ error: "Unauthorized" })).toBe("Unauthorized");
	});

	it("maps known reason codes", () => {
		expect(formatTitleGenerationError({ reason: "missing_openrouter_key" })).toContain(
			"OpenRouter API key",
		);
		expect(formatTitleGenerationError({ reason: "empty_seed" })).toContain(
			"Not enough message content",
		);
		expect(formatTitleGenerationError({ reason: "generation_failed" })).toContain(
			"Could not generate",
		);
	});
});

describe("shouldTriggerAutoTitle", () => {
	it("returns true when started without a chat id", () => {
		expect(
			shouldTriggerAutoTitle({
				startedWithoutChatId: true,
				existingMessageCount: 5,
				seedText: "hello",
			}),
		).toBe(true);
	});

	it("returns false for empty seed text", () => {
		expect(
			shouldTriggerAutoTitle({
				startedWithoutChatId: true,
				existingMessageCount: 0,
				seedText: " ",
			}),
		).toBe(false);
	});
});
