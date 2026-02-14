import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildMatchingMap, type AAModel } from "./lib/model_matching";

type AAModelsResponse = {
	data?: AAModel[];
};

type OpenRouterModel = {
	id: string;
};

type OpenRouterModelsResponse = {
	data?: OpenRouterModel[];
};

const benchmarkValidator = v.object({
	openRouterModelId: v.string(),
	aaSlug: v.string(),
	aaCreatorName: v.string(),
	intelligenceIndex: v.optional(v.float64()),
	codingIndex: v.optional(v.float64()),
	mathIndex: v.optional(v.float64()),
	mmluPro: v.optional(v.float64()),
	gpqa: v.optional(v.float64()),
	scicode: v.optional(v.float64()),
	livecodebench: v.optional(v.float64()),
	math500: v.optional(v.float64()),
	aime: v.optional(v.float64()),
});

export const fetchAndStoreBenchmarks = internalAction({
	args: {},
	handler: async (ctx) => {
		const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
		if (!apiKey) {
			console.warn("ARTIFICIAL_ANALYSIS_API_KEY is not set; skipping benchmark refresh");
			return;
		}

		try {
			const openRouterResponse = await fetch("https://openrouter.ai/api/v1/models");
			if (!openRouterResponse.ok) {
				throw new Error(`Failed to fetch OpenRouter models: ${openRouterResponse.status}`);
			}
			const openRouterPayload = (await openRouterResponse.json()) as OpenRouterModelsResponse;
			const openRouterIds = (openRouterPayload.data ?? []).map((m) => m.id);
			console.log(`Fetched ${openRouterIds.length} OpenRouter model IDs`);

			const response = await fetch("https://artificialanalysis.ai/api/v2/data/llms/models", {
				headers: {
					"x-api-key": apiKey,
				},
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch Artificial Analysis models: ${response.status}`);
			}

			const payload = (await response.json()) as AAModelsResponse;
			const aaModels = Array.isArray(payload.data) ? payload.data : [];
			const matchingMap = buildMatchingMap(aaModels, openRouterIds);

			const benchmarks = aaModels.flatMap((model) => {
				const openRouterModelId = matchingMap.get(model.slug);
				if (!openRouterModelId) return [];

				const evaluations = model.evaluations ?? {};

				return [{
					openRouterModelId,
					aaSlug: model.slug,
					aaCreatorName: model.model_creator.name,
				intelligenceIndex: evaluations.artificial_analysis_intelligence_index ?? undefined,
				codingIndex: evaluations.artificial_analysis_coding_index ?? undefined,
				mathIndex: evaluations.artificial_analysis_math_index ?? undefined,
					mmluPro: evaluations.mmlu_pro ?? undefined,
					gpqa: evaluations.gpqa ?? undefined,
					scicode: evaluations.scicode ?? undefined,
					livecodebench: evaluations.livecodebench ?? undefined,
					math500: evaluations.math_500 ?? undefined,
					aime: evaluations.aime ?? undefined,
				}];
			});

			await ctx.runMutation((internal as any).benchmarks.storeBenchmarks, { benchmarks });
		} catch (error) {
			console.error("Failed to refresh Artificial Analysis benchmarks", error);
		}
	},
});

export const storeBenchmarks = internalMutation({
	args: {
		benchmarks: v.array(benchmarkValidator),
	},
	handler: async (ctx, args) => {
		const lastUpdated = Date.now();

		for (const benchmark of args.benchmarks) {
			const existing = await ctx.db
				.query("benchmarks")
				.withIndex("by_openrouter_id", (q) => q.eq("openRouterModelId", benchmark.openRouterModelId))
				.first();

			if (existing) {
				await ctx.db.patch(existing._id, {
					...benchmark,
					lastUpdated,
				});
				continue;
			}

			await ctx.db.insert("benchmarks", {
				...benchmark,
				lastUpdated,
			});
		}
	},
});

export const getBenchmarkByOpenRouterId = query({
	args: {
		openRouterModelId: v.string(),
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("benchmarks")
			.withIndex("by_openrouter_id", (q) => q.eq("openRouterModelId", args.openRouterModelId))
			.first();
	},
});

export const getAllBenchmarks = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query("benchmarks").collect();
	},
});


