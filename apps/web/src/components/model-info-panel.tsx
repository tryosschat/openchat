import { useState } from "react";
import type { Model } from "@/stores/model";
import { cn } from "@/lib/utils";
import { useBenchmark } from "@/hooks/use-benchmarks";
import { CircularProgress } from "@/components/circular-progress";
import {
	formatPercent,
	hasBenchmarkData,
} from "@/lib/benchmark-formatting";

interface ModelInfoPanelProps {
	model: Model;
	className?: string;
}

function ProviderLogo({
	providerId,
	className,
}: { providerId: string; className?: string }) {
	const [hasError, setHasError] = useState(false);

	if (hasError) {
		return (
			<div
				className={cn(
					"flex items-center justify-center rounded-md bg-muted/80 text-[10px] font-semibold uppercase text-muted-foreground",
					className || "size-4",
				)}
			>
				{providerId.charAt(0)}
			</div>
		);
	}

	return (
		<img
			alt={`${providerId} logo`}
			className={cn("size-4 dark:invert", className)}
			height={32}
			width={32}
			src={`https://models.dev/logos/${providerId}.svg`}
			onError={() => setHasError(true)}
		/>
	);
}

function ThinkingIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("size-3.5", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
			/>
		</svg>
	);
}

function EyeIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("size-3.5", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
			/>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
			/>
		</svg>
	);
}

function ToolIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("size-3.5", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3"
			/>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M3.375 19.5h17.25a1.125 1.125 0 0 0 1.125-1.125V5.625a1.125 1.125 0 0 0-1.125-1.125H3.375a1.125 1.125 0 0 0-1.125 1.125v12.75a1.125 1.125 0 0 0 1.125 1.125Z"
			/>
		</svg>
	);
}

function TrophyIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("size-5", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-4.5A3.375 3.375 0 0019.875 11H21a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25h-1.372c-.516-1.167-1.695-2-3.128-2h-9c-1.433 0-2.612.833-3.128 2H3a2.25 2.25 0 00-2.25 2.25v2.75A2.25 2.25 0 003 11h1.125A3.375 3.375 0 017.5 14.25v4.5"
			/>
		</svg>
	);
}

function BenchmarkCard({
	label,
	indexValue,
	subBenchmarks,
}: {
	label: string;
	indexValue: number | undefined;
	subBenchmarks: { label: string; value: number | undefined }[];
}) {
	return (
		<div className="flex flex-1 flex-col items-center gap-1.5 rounded-lg bg-muted/50 p-2">
			<CircularProgress value={indexValue ?? null} size={36} strokeWidth={3} />
			<span className="text-[11px] font-semibold text-foreground">{label}</span>
			<div className="flex w-full flex-col gap-0.5">
				{subBenchmarks.map((sub) => (
					<div
						key={sub.label}
						className="flex items-center justify-between text-[10px]"
					>
						<span className="text-muted-foreground">{sub.label}</span>
						<span className="font-medium text-foreground">
							{formatPercent(sub.value)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

export function ModelInfoPanel({ model, className }: ModelInfoPanelProps) {
	const { benchmark, isLoading } = useBenchmark(model.id);

	const hasVision = model.modality?.includes("image");
	const hasReasoning = model.reasoning;
	const hasFeatures = hasReasoning || hasVision || model.toolCall || model.isFree;

	const evals = benchmark
		? {
				intelligenceIndex: benchmark.intelligenceIndex,
				codingIndex: benchmark.codingIndex,
				mathIndex: benchmark.mathIndex,
				mmluPro: benchmark.mmluPro,
				gpqa: benchmark.gpqa,
				scicode: benchmark.scicode,
				livecodebench: benchmark.livecodebench,
				math500: benchmark.math500,
				aime: benchmark.aime,
			}
		: null;

	const showBenchmarks = evals !== null && hasBenchmarkData(evals);

	return (
		<div
			className={cn(
				"w-[320px] rounded-xl bg-popover p-3.5 text-popover-foreground shadow-xl ring-1 ring-foreground/5",
				className,
			)}
		>
			<div className="flex items-center gap-2.5">
				<ProviderLogo
					providerId={model.logoId}
					className="size-8 shrink-0 rounded-lg"
				/>
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-sm font-semibold leading-tight">
						{model.name}
					</h3>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{model.provider}
					</p>
				</div>
			</div>

			{hasFeatures && (
				<div className="mt-3 flex flex-wrap items-center gap-1.5">
					{hasVision && (
						<span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-400">
							<EyeIcon className="size-3" />
							Vision
						</span>
					)}
					{hasReasoning && (
						<span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
							<ThinkingIcon className="size-3" />
							Reasoning
						</span>
					)}
					{model.toolCall && (
						<span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-400">
							<ToolIcon className="size-3" />
							Tool Calling
						</span>
					)}
					{model.isFree && (
						<span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
							Free
						</span>
					)}
				</div>
			)}

			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
				<div>
					<span className="text-[11px] text-muted-foreground">Provider</span>
					<p className="text-xs font-medium text-foreground">OpenRouter</p>
				</div>
				<div>
					<span className="text-[11px] text-muted-foreground">Developer</span>
					<p className="text-xs font-medium text-foreground">
						{benchmark?.aaCreatorName ?? model.provider}
					</p>
				</div>
			</div>

			{isLoading ? (
				<div className="mt-3 flex items-center justify-center py-4">
					<div className="size-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground/60" />
				</div>
			) : showBenchmarks && evals ? (
				<div className="mt-3">
					<div className="mb-2 flex items-baseline justify-between">
						<span className="text-xs font-semibold text-foreground">
							Benchmarks
						</span>
						<a
							href="https://artificialanalysis.ai"
							target="_blank"
							rel="noopener noreferrer"
							className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
						>
							via Artificial Analysis ↗
						</a>
					</div>

					<div className="flex gap-2">
						<BenchmarkCard
							label="Intelligence"
							indexValue={evals.intelligenceIndex}
							subBenchmarks={[
								{ label: "MMLU-Pro", value: evals.mmluPro },
								{ label: "GPQA", value: evals.gpqa },
							]}
						/>
						<BenchmarkCard
							label="Coding"
							indexValue={evals.codingIndex}
							subBenchmarks={[
								{ label: "SciCode", value: evals.scicode },
								{ label: "LiveCodeBench", value: evals.livecodebench },
							]}
						/>
						<BenchmarkCard
							label="Math"
							indexValue={evals.mathIndex}
							subBenchmarks={[
								{ label: "MATH-500", value: evals.math500 },
								{ label: "AIME", value: evals.aime },
							]}
						/>
					</div>
				</div>
			) : (
				<div className="mt-3 flex flex-col items-center gap-1 py-3 text-muted-foreground">
					<TrophyIcon className="size-4 opacity-40" />
					<span className="text-xs">
						Benchmarks unavailable for this model
					</span>
				</div>
			)}
		</div>
	);
}
