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

function BrainIcon({ className }: { className?: string }) {
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
				d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-3.75 5.25m0 0l-3.75-3.75m3.75 3.75V21m-7.5-1.25l3.75-5.25m0 0L8 10.75m3.75 3.75H3"
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

function WrenchIcon({ className }: { className?: string }) {
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
				d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 1 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
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
		<div className="flex flex-1 flex-col items-center gap-2 rounded-xl bg-muted/50 p-3">
			<CircularProgress value={indexValue ?? null} size={44} strokeWidth={3} />
			<span className="text-xs font-semibold text-foreground">{label}</span>
			<div className="flex w-full flex-col gap-1">
				{subBenchmarks.map((sub) => (
					<div
						key={sub.label}
						className="flex items-center justify-between text-xs"
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
				"w-[300px] rounded-2xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/5",
				className,
			)}
		>
			<div className="flex items-start gap-3">
				<ProviderLogo
					providerId={model.logoId}
					className="size-8 shrink-0 rounded-lg"
				/>
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-base font-semibold leading-tight">
						{model.name}
					</h3>
					{model.description && (
						<p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
							{model.description}
						</p>
					)}
				</div>
			</div>

			<div className="mt-3 flex items-center gap-1.5">
				{hasReasoning && (
					<span
						className="flex size-6 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500"
						title="Reasoning capable"
					>
						<BrainIcon className="size-3.5" />
					</span>
				)}
				{hasVision && (
					<span
						className="flex size-6 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500"
						title="Vision capable"
					>
						<EyeIcon className="size-3.5" />
					</span>
				)}
				{model.toolCall && (
					<span
						className="flex size-6 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500"
						title="Tool use capable"
					>
						<WrenchIcon className="size-3.5" />
					</span>
				)}
				{model.isFree && (
					<span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-500">
						Free
					</span>
				)}
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
				<div>
					<span className="text-muted-foreground">Provider</span>
					<p className="font-medium text-foreground">{model.provider}</p>
				</div>
				<div>
					<span className="text-muted-foreground">Developer</span>
					<p className="font-medium text-foreground">
						{benchmark?.aaCreatorName ?? model.provider}
					</p>
				</div>
			</div>

			{isLoading ? (
				<div className="mt-4 flex items-center justify-center py-6">
					<div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground/60" />
				</div>
			) : showBenchmarks && evals ? (
				<div className="mt-4">
					<div className="mb-2 flex items-baseline justify-between">
						<span className="text-xs font-semibold text-foreground">
							Benchmark Performance
						</span>
						<a
							href="https://artificialanalysis.ai"
							target="_blank"
							rel="noopener noreferrer"
							className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
						>
							Data by Artificial Analysis ↗
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
				<div className="mt-4 flex flex-col items-center gap-1.5 py-4 text-muted-foreground">
					<TrophyIcon className="size-5 opacity-40" />
					<span className="text-xs">
						Benchmarks unavailable for this model
					</span>
				</div>
			)}
		</div>
	);
}
