import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, GitFork, Pencil, RotateCcw } from "lucide-react";
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

interface MessageActionsProps {
	messageId: string;
	content: string;
	isStreaming?: boolean;
	onEdit?: () => void;
	onRetry?: (modelId?: string) => void;
	onFork?: (modelId?: string) => void;
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
	messageId,
	onRetry,
}: {
	messageId: string;
	onRetry?: (modelId?: string) => void;
}) {
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

	const handleRetry = useCallback(
		(modelId?: string) => {
			if (onRetry) {
				onRetry(modelId);
				return;
			}
			console.log("[message-actions] retry", messageId, modelId ?? "same");
		},
		[messageId, onRetry],
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
	messageId,
	onFork,
}: {
	messageId: string;
	onFork?: (modelId?: string) => void;
}) {
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

	const handleFork = useCallback(
		(modelId?: string) => {
			if (onFork) {
				onFork(modelId);
				return;
			}
			console.log("[message-actions] fork", messageId, modelId ?? "same");
		},
		[messageId, onFork],
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
	messageId,
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
						onEdit ??
						(() => console.log("[message-actions] edit", messageId))
					}
				>
					<Pencil className="size-3.5" />
				</ActionButton>

				<CopyButton content={content} />

				<RetryDropdown messageId={messageId} onRetry={onRetry} />

				<ForkDropdown messageId={messageId} onFork={onFork} />
			</div>
		</TooltipProvider>
	);
}

export function AssistantMessageActions({
	messageId,
	content,
	isStreaming,
	onRetry,
	onFork,
}: MessageActionsProps) {
	if (isStreaming) return null;

	return (
		<TooltipProvider>
			<div className="flex items-center gap-1 py-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
				<CopyButton content={content} />

				<RetryDropdown messageId={messageId} onRetry={onRetry} />

				<ForkDropdown messageId={messageId} onFork={onFork} />
			</div>
		</TooltipProvider>
	);
}
