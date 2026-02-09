import { useCallback, useState } from "react";
import { Check, Copy, GitFork, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyMessageText } from "@/lib/clipboard";

interface MessageActionsProps {
	messageId: string;
	content: string;
	isStreaming?: boolean;
	onEdit?: () => void;
	onRetry?: () => void;
	onFork?: () => void;
}

function ActionButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
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

				<ActionButton
					label="Retry"
					onClick={
						onRetry ??
						(() => console.log("[message-actions] retry", messageId))
					}
				>
					<RotateCcw className="size-3.5" />
				</ActionButton>

				<ActionButton
					label="Fork"
					onClick={
						onFork ??
						(() => console.log("[message-actions] fork", messageId))
					}
				>
					<GitFork className="size-3.5" />
				</ActionButton>
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

				<ActionButton
					label="Retry"
					onClick={
						onRetry ??
						(() => console.log("[message-actions] retry", messageId))
					}
				>
					<RotateCcw className="size-3.5" />
				</ActionButton>

				<ActionButton
					label="Fork"
					onClick={
						onFork ??
						(() => console.log("[message-actions] fork", messageId))
					}
				>
					<GitFork className="size-3.5" />
				</ActionButton>
			</div>
		</TooltipProvider>
	);
}
