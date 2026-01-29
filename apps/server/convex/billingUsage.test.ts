/**
 * Tests for Billing Usage Tracking
 *
 * Tests cover:
 * - Pure billing utility functions (token estimation, cost calculation)
 * - incrementAiUsage mutation (daily tracking, limits, sanity caps)
 * - Daily limit enforcement in startStream
 * - Concurrent stream prevention for osschat users
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules, rateLimiter } from "./testSetup.test";
import {
	estimateTokensFromText,
	calculateUsageCents,
	normalizeUsagePayload,
	roundCents,
	DAILY_AI_LIMIT_CENTS,
} from "./lib/billingUtils";

function createConvexTest() {
	const t = convexTest(schema, modules);
	rateLimiter.register(t);
	return t;
}

// ---------------------------------------------------------------------------
// Pure function tests (no Convex runtime needed)
// ---------------------------------------------------------------------------

describe("estimateTokensFromText", () => {
	test("returns 0 for empty string", () => {
		expect(estimateTokensFromText("")).toBe(0);
	});

	test("returns 0 for whitespace-only string", () => {
		expect(estimateTokensFromText("   \n\t  ")).toBe(0);
	});

	test("estimates English text tokens (word-based)", () => {
		const tokens = estimateTokensFromText("Hello world, this is a test message");
		expect(tokens).toBeGreaterThan(0);
		expect(tokens).toBeLessThan(50);
	});

	test("estimates CJK text tokens (char-based)", () => {
		const tokens = estimateTokensFromText("こんにちは世界");
		expect(tokens).toBe(7);
	});

	test("handles mixed CJK and English text", () => {
		const tokens = estimateTokensFromText("Hello 世界");
		expect(tokens).toBeGreaterThan(0);
	});

	test("always returns at least 1 for non-empty text", () => {
		expect(estimateTokensFromText("a")).toBeGreaterThanOrEqual(1);
	});
});

describe("normalizeUsagePayload", () => {
	test("handles snake_case keys", () => {
		const result = normalizeUsagePayload({
			prompt_tokens: 100,
			completion_tokens: 50,
			total_tokens: 150,
			total_cost: 0.005,
		});
		expect(result).toEqual({
			promptTokens: 100,
			completionTokens: 50,
			totalTokens: 150,
			totalCostUsd: 0.005,
		});
	});

	test("handles camelCase keys", () => {
		const result = normalizeUsagePayload({
			promptTokens: 100,
			completionTokens: 50,
			totalTokens: 150,
			totalCost: 0.005,
		});
		expect(result).toEqual({
			promptTokens: 100,
			completionTokens: 50,
			totalTokens: 150,
			totalCostUsd: 0.005,
		});
	});

	test("handles cost field fallback", () => {
		const result = normalizeUsagePayload({ cost: 0.01 });
		expect(result.totalCostUsd).toBe(0.01);
	});

	test("returns undefined for missing fields", () => {
		const result = normalizeUsagePayload({});
		expect(result.promptTokens).toBeUndefined();
		expect(result.completionTokens).toBeUndefined();
		expect(result.totalTokens).toBeUndefined();
		expect(result.totalCostUsd).toBeUndefined();
	});

	test("ignores non-numeric values", () => {
		const result = normalizeUsagePayload({
			prompt_tokens: "not a number",
			completion_tokens: null,
		});
		expect(result.promptTokens).toBeUndefined();
		expect(result.completionTokens).toBeUndefined();
	});
});

describe("roundCents", () => {
	test("rounds to 4 decimal places", () => {
		expect(roundCents(1.23456789)).toBe(1.2346);
	});

	test("returns 0 for non-finite values", () => {
		expect(roundCents(Number.NaN)).toBe(0);
		expect(roundCents(Number.POSITIVE_INFINITY)).toBe(0);
	});

	test("clamps negative to 0", () => {
		expect(roundCents(-5)).toBe(0);
	});
});

describe("calculateUsageCents", () => {
	test("uses totalCostUsd when available", () => {
		const result = calculateUsageCents(
			{ totalCostUsd: 0.05 },
			[{ role: "user", content: "test" }],
			"response",
		);
		expect(result).toBe(5);
	});

	test("falls back to token-based estimation", () => {
		const result = calculateUsageCents(
			{ promptTokens: 1000, completionTokens: 500 },
			[{ role: "user", content: "test" }],
			"response",
		);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeLessThan(1);
	});

	test("estimates from message text when no usage data", () => {
		const result = calculateUsageCents(
			null,
			[{ role: "user", content: "Hello, how are you?" }],
			"I'm doing well, thank you for asking!",
		);
		expect(result).toBeGreaterThan(0);
	});

	test("returns null when no tokens and no text", () => {
		const result = calculateUsageCents(
			{ promptTokens: 0, completionTokens: 0 },
			[],
			"",
		);
		expect(result).toBeNull();
	});

	test("ignores non-positive totalCostUsd", () => {
		const result = calculateUsageCents(
			{ totalCostUsd: 0, promptTokens: 1000, completionTokens: 500 },
			[{ role: "user", content: "test" }],
			"response",
		);
		expect(result).toBeGreaterThan(0);
	});

	test("ignores NaN totalCostUsd", () => {
		const result = calculateUsageCents(
			{ totalCostUsd: Number.NaN, promptTokens: 1000, completionTokens: 500 },
			[{ role: "user", content: "test" }],
			"response",
		);
		expect(result).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Convex mutation tests
// ---------------------------------------------------------------------------

describe("users.incrementAiUsage", () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<"users">;

	beforeEach(async () => {
		t = createConvexTest();
		const result = await t.mutation(api.users.ensure, {
			externalId: "billing_test_user",
			email: "billing@test.com",
		});
		userId = result.userId;
	});

	test("increments usage for the day", async () => {
		const result = await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 2.5,
		});

		expect(result.usedCents).toBe(2.5);
		expect(result.remainingCents).toBe(DAILY_AI_LIMIT_CENTS - 2.5);
		expect(result.overLimit).toBe(false);
	});

	test("accumulates multiple usage entries", async () => {
		await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 3,
		});

		const result = await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 4,
		});

		expect(result.usedCents).toBe(7);
		expect(result.remainingCents).toBe(3);
		expect(result.overLimit).toBe(false);
	});

	test("flags when already over limit", async () => {
		await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 10,
		});

		const result = await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 1,
		});

		expect(result.usedCents).toBe(11);
		expect(result.remainingCents).toBe(0);
		expect(result.overLimit).toBe(true);
	});

	test("rejects zero or negative usage", async () => {
		const result = await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 0,
		});

		expect(result.usedCents).toBe(0);
		expect(result.remainingCents).toBe(DAILY_AI_LIMIT_CENTS);
		expect(result.overLimit).toBe(false);
	});

	test("rejects suspiciously high usage (sanity cap)", async () => {
		const result = await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 200,
		});

		expect(result.usedCents).toBe(0);
		expect(result.remainingCents).toBe(DAILY_AI_LIMIT_CENTS);
		expect(result.overLimit).toBe(false);

		const user = await t.run(async (ctx) => ctx.db.get(userId));
		expect(user?.aiUsageCents).toBeUndefined();
	});

	test("handles non-existent user gracefully", async () => {
		const tempId = await t.run(async (ctx) => {
			return await ctx.db.insert("users", {
				externalId: "temp_billing",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
		await t.run(async (ctx) => {
			await ctx.db.delete(tempId);
		});

		const result = await t.mutation(internal.users.incrementAiUsage, {
			userId: tempId,
			usageCents: 1,
		});

		expect(result.usedCents).toBe(0);
		expect(result.remainingCents).toBe(DAILY_AI_LIMIT_CENTS);
		expect(result.overLimit).toBe(false);
	});

	test("resets usage on a new day", async () => {
		await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 8,
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(userId, {
				aiUsageDate: "2020-01-01",
				aiUsageCents: 8,
			});
		});

		const result = await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 2,
		});

		expect(result.usedCents).toBe(2);
		expect(result.overLimit).toBe(false);
	});

	test("persists usage fields to the database", async () => {
		await t.mutation(internal.users.incrementAiUsage, {
			userId,
			usageCents: 5,
		});

		const user = await t.run(async (ctx) => ctx.db.get(userId));
		expect(user?.aiUsageCents).toBe(5);
		expect(user?.aiUsageDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("backgroundStream.startStream - daily limit enforcement", () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<"users">;
	let chatId: Id<"chats">;

	beforeEach(async () => {
		t = createConvexTest();
		const result = await t.mutation(api.users.ensure, {
			externalId: "stream_limit_user",
			email: "stream@test.com",
		});
		userId = result.userId;
		const chatResult = await t.mutation(api.chats.create, {
			userId,
			title: "Test Chat",
		});
		chatId = chatResult.chatId;
	});

	test("rejects osschat stream when daily limit is reached", async () => {
		await t.run(async (ctx) => {
			const today = new Date().toISOString().split("T")[0];
			await ctx.db.patch(userId, {
				aiUsageCents: DAILY_AI_LIMIT_CENTS,
				aiUsageDate: today,
			});
		});

		await expect(
			t.mutation(api.backgroundStream.startStream, {
				chatId,
				userId,
				messageId: "msg_1",
				model: "test/model",
				provider: "osschat",
				messages: [{ role: "user", content: "Hello" }],
			}),
		).rejects.toThrow("Daily usage limit reached");
	});

	test("allows osschat stream when under daily limit", async () => {
		const jobId = await t.mutation(api.backgroundStream.startStream, {
			chatId,
			userId,
			messageId: "msg_2",
			model: "test/model",
			provider: "osschat",
			messages: [{ role: "user", content: "Hello" }],
		});

		expect(jobId).toBeDefined();
	});

	test("allows openrouter stream regardless of limit", async () => {
		await t.run(async (ctx) => {
			const today = new Date().toISOString().split("T")[0];
			await ctx.db.patch(userId, {
				aiUsageCents: DAILY_AI_LIMIT_CENTS + 100,
				aiUsageDate: today,
			});
		});

		const jobId = await t.mutation(api.backgroundStream.startStream, {
			chatId,
			userId,
			messageId: "msg_3",
			model: "test/model",
			provider: "openrouter",
			apiKey: "test-key",
			messages: [{ role: "user", content: "Hello" }],
		});

		expect(jobId).toBeDefined();
	});

	test("rejects concurrent osschat streams for same user", async () => {
		await t.mutation(api.backgroundStream.startStream, {
			chatId,
			userId,
			messageId: "msg_4",
			model: "test/model",
			provider: "osschat",
			messages: [{ role: "user", content: "Hello" }],
		});

		const chatResult2 = await t.mutation(api.chats.create, {
			userId,
			title: "Test Chat 2",
		});

		await expect(
			t.mutation(api.backgroundStream.startStream, {
				chatId: chatResult2.chatId,
				userId,
				messageId: "msg_5",
				model: "test/model",
				provider: "osschat",
				messages: [{ role: "user", content: "Another message" }],
			}),
		).rejects.toThrow("Please wait for your current request to finish");
	});

	test("resets daily limit for a new date", async () => {
		await t.run(async (ctx) => {
			await ctx.db.patch(userId, {
				aiUsageCents: 999,
				aiUsageDate: "2020-01-01",
			});
		});

		const jobId = await t.mutation(api.backgroundStream.startStream, {
			chatId,
			userId,
			messageId: "msg_6",
			model: "test/model",
			provider: "osschat",
			messages: [{ role: "user", content: "Hello" }],
		});

		expect(jobId).toBeDefined();
	});
});
