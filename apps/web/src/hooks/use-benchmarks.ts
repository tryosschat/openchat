import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import { api } from "@server/convex/_generated/api";

// Benchmarks module not yet in generated API — cast via unknown until codegen runs.
const benchmarksApi = (api as unknown as Record<string, Record<string, FunctionReference<"query">>>)
	.benchmarks;

export function useBenchmark(openRouterModelId: string) {
	const benchmark = useQuery(benchmarksApi.getBenchmarkByOpenRouterId, {
		openRouterModelId,
	});
	return {
		benchmark: benchmark ?? null,
		isLoading: benchmark === undefined,
	};
}
