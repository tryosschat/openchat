import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, Clock, Copy, GitFork, Pencil, RotateCcw, Zap, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFavoriteModels } from "@/hooks/use-favorite-models";
import { copyMessageText } from "@/lib/clipboard";
import { useModelStore, useModels } from "@/stores/model";

function useGroupedModels() {
	const { models } = useModels();
	const { favorites } = useFavoriteModels();
	const selectedModelId = useModelStore((s) => s.selectedModelId);

	const favoriteModels = useMemo(() => {
		return models
			.filter((model) => favorites.has(model.id))
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [models, favorites]);

	const providerGroups = useMemo(() => {
		const grouped = new Map<string, Array<(typeof models)[number]>>();
		for (const model of models) {
			if (favorites.has(model.id)) continue;
			const key = model.provider;
			const list = grouped.get(key) ?? [];
			list.push(model);
			grouped.set(key, list);
		}

		return Array.from(grouped.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([provider, providerModels]) => ({
				provider,
				models: providerModels.sort((a, b) => a.name.localeCompare(b.name)),
			}));
	}, [models, favorites]);

	return { favoriteModels, providerGroups, selectedModelId };
}

interface AnalyticsData {
	modelId?: string;
	tokensPerSecond?: number;
	tokenUsage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	timeToFirstTokenMs?: number;
}

interface MessageActionsProps {
	messageId: string;
	content: string;
	isStreaming?: boolean;
	onEdit?: () => void;
	onRetry?: (modelId?: string) => void;
	onFork?: (modelId?: string) => void;
	analytics?: AnalyticsData;
}

function ProviderLogo({ providerId }: { providerId: string }) {
	const [hasError, setHasError] = useState(false);

	if (hasError) {
		return (
			<div className="bg-muted text-muted-foreground flex size-4 items-center justify-center rounded text-[10px] font-semibold uppercase">
				{providerId.charAt(0)}
			</div>
		);
	}

	return (
		<img
			alt={`${providerId} logo`}
			className="size-4 shrink-0 dark:invert"
			height={16}
			src={`https://models.dev/logos/${providerId}.svg`}
			width={16}
			onError={() => setHasError(true)}
		/>
	);
}

function ActionButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground hover:text-foreground cursor-pointer"
						onClick={onClick}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

function CopyButton({ content }: { content: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		const ok = await copyMessageText(content);
		if (ok) {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}, [content]);

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground hover:text-foreground cursor-pointer"
						onClick={handleCopy}
					/>
				}
			>
				{copied ? (
					<Check className="size-3.5 text-green-500" />
				) : (
					<Copy className="size-3.5" />
				)}
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{copied ? "Copied" : "Copy"}
			</TooltipContent>
		</Tooltip>
	);
}

function RetryDropdown({
	onRetry,
}: {
	onRetry?: (modelId?: string) => void;
}) {
	const { favoriteModels, providerGroups, selectedModelId } = useGroupedModels();

	const handleRetry = useCallback(
		(modelId?: string) => {
			onRetry?.(modelId);
		},
		[onRetry],
	);

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-xs"
									className="text-muted-foreground hover:text-foreground cursor-pointer"
								/>
							}
						/>
					}
				>
					<RotateCcw className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent side="bottom">Retry</TooltipContent>
			</Tooltip>

			<DropdownMenuContent align="end" className="w-72 p-1" sideOffset={8}>
				<DropdownMenuItem onClick={() => handleRetry()}>
					<RotateCcw className="size-3.5" />
					Retry same
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel className="px-3 py-2 text-[11px] uppercase tracking-wide">
						or switch model
					</DropdownMenuLabel>

						<div className="max-h-72 overflow-y-auto">
						{favoriteModels.length > 0 && (
							<DropdownMenuGroup>
								<DropdownMenuLabel className="px-3 py-1.5 text-[11px]">Favorites</DropdownMenuLabel>
								{favoriteModels.map((model) => (
									<DropdownMenuItem key={model.id} onClick={() => handleRetry(model.id)}>
										<ProviderLogo providerId={model.logoId} />
										<span className="flex-1 truncate">{model.name}</span>
										{selectedModelId === model.id ? <Check className="size-3.5" /> : null}
									</DropdownMenuItem>
								))}
								<DropdownMenuSeparator />
							</DropdownMenuGroup>
						)}

						{providerGroups.map((group) => (
							<DropdownMenuGroup key={group.provider}>
								<DropdownMenuLabel className="px-3 py-1.5 text-[11px]">{group.provider}</DropdownMenuLabel>
								{group.models.map((model) => (
									<DropdownMenuItem key={model.id} onClick={() => handleRetry(model.id)}>
										<ProviderLogo providerId={model.logoId} />
										<span className="flex-1 truncate">{model.name}</span>
										{selectedModelId === model.id ? <Check className="size-3.5" /> : null}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
						))}
					</div>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ForkDropdown({
	onFork,
}: {
	onFork?: (modelId?: string) => void;
}) {
	const { favoriteModels, providerGroups, selectedModelId } = useGroupedModels();

	const handleFork = useCallback(
		(modelId?: string) => {
			onFork?.(modelId);
		},
		[onFork],
	);

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-xs"
									className="text-muted-foreground hover:text-foreground cursor-pointer"
								/>
							}
						/>
					}
				>
					<GitFork className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent side="bottom">Fork</TooltipContent>
			</Tooltip>

			<DropdownMenuContent align="end" className="w-72 p-1" sideOffset={8}>
				<DropdownMenuItem onClick={() => handleFork()}>
					<GitFork className="size-3.5" />
					Branch off
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel className="px-3 py-2 text-[11px] uppercase tracking-wide">
						or switch model
					</DropdownMenuLabel>

					<div className="max-h-72 overflow-y-auto">
						{favoriteModels.length > 0 && (
							<DropdownMenuGroup>
								<DropdownMenuLabel className="px-3 py-1.5 text-[11px]">Favorites</DropdownMenuLabel>
								{favoriteModels.map((model) => (
									<DropdownMenuItem key={model.id} onClick={() => handleFork(model.id)}>
										<ProviderLogo providerId={model.logoId} />
										<span className="flex-1 truncate">{model.name}</span>
										{selectedModelId === model.id ? <Check className="size-3.5" /> : null}
									</DropdownMenuItem>
								))}
								<DropdownMenuSeparator />
							</DropdownMenuGroup>
						)}

						{providerGroups.map((group) => (
							<DropdownMenuGroup key={group.provider}>
								<DropdownMenuLabel className="px-3 py-1.5 text-[11px]">{group.provider}</DropdownMenuLabel>
								{group.models.map((model) => (
									<DropdownMenuItem key={model.id} onClick={() => handleFork(model.id)}>
										<ProviderLogo providerId={model.logoId} />
										<span className="flex-1 truncate">{model.name}</span>
										{selectedModelId === model.id ? <Check className="size-3.5" /> : null}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
						))}
					</div>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function UserMessageActions({
	content,
	isStreaming,
	onEdit,
	onRetry,
	onFork,
}: MessageActionsProps) {
	if (isStreaming) return null;

	return (
		<TooltipProvider>
			<div className="flex items-center justify-end gap-1 py-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
				<ActionButton
					label="Edit"
					onClick={
					onEdit ?? (() => {})
					}
				>
					<Pencil className="size-3.5" />
				</ActionButton>

				<CopyButton content={content} />

			<RetryDropdown onRetry={onRetry} />

			<ForkDropdown onFork={onFork} />
			</div>
		</TooltipProvider>
	);
}

function formatModelName(modelId: string): string {
	const slug = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
	const cleaned = slug
		.replace(/:free$/, "")
		.replace(/:extended$/, "")
		.replace(/-instruct$/, "")
		.replace(/-chat$/, "");
	return cleaned
		.split("-")
		.map((word) => {
			if (/^\d/.test(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1);
		})
		.join(" ");
}

function InlineAnalytics({ analytics }: { analytics?: AnalyticsData }) {
	if (!analytics) return null;

	const { modelId, tokensPerSecond, tokenUsage, timeToFirstTokenMs } = analytics;
	const hasAnyData = modelId || tokensPerSecond != null || tokenUsage || timeToFirstTokenMs != null;
	if (!hasAnyData) return null;

	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground/50 select-none">
			{modelId && (
				<span className="font-medium">{formatModelName(modelId)}</span>
			)}
			{tokensPerSecond != null && (
				<span className="flex items-center gap-1">
					<Zap className="size-3" />
					{tokensPerSecond.toFixed(2)} tok/sec
				</span>
			)}
			{tokenUsage && (
				<span className="flex items-center gap-1">
					<Coins className="size-3" />
					{tokenUsage.completionTokens.toLocaleString("en-US")} tokens
				</span>
			)}
			{timeToFirstTokenMs != null && (
				<span className="flex items-center gap-1">
					<Clock className="size-3" />
					Time-to-First: {(timeToFirstTokenMs / 1000).toFixed(2)} sec
				</span>
			)}
		</div>
	);
}

export function AssistantMessageActions({
	content,
	isStreaming,
	analytics,
	onRetry,
	onFork,
}: MessageActionsProps) {
	if (isStreaming) return null;

	return (
		<TooltipProvider>
			<div className="flex items-center gap-2 py-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
				<div className="flex items-center gap-1">
					<CopyButton content={content} />
				<RetryDropdown onRetry={onRetry} />
				<ForkDropdown onFork={onFork} />
				</div>
				<InlineAnalytics analytics={analytics} />
			</div>
		</TooltipProvider>
	);
}
