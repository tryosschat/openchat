interface MessageAnalyticsProps {
	modelId?: string;
	tokensPerSecond?: number;
	tokenUsage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	timeToFirstTokenMs?: number;
	isStreaming?: boolean;
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

function formatTokenCount(count: number): string {
	return count.toLocaleString("en-US");
}

const Dot = () => (
	<span className="text-muted-foreground/30">·</span>
);

export function MessageAnalytics({
	modelId,
	tokensPerSecond,
	tokenUsage,
	timeToFirstTokenMs,
	isStreaming,
}: MessageAnalyticsProps) {
	if (isStreaming) return null;

	const hasAnyData =
		modelId || tokensPerSecond != null || tokenUsage || timeToFirstTokenMs != null;
	if (!hasAnyData) return null;

	const metrics: Array<React.ReactNode> = [];

	if (modelId) {
		metrics.push(
			<span key="model">{formatModelName(modelId)}</span>
		);
	}

	if (tokensPerSecond != null) {
		metrics.push(
			<span key="tps">⚡ {tokensPerSecond.toFixed(1)} tok/s</span>
		);
	}

	if (tokenUsage) {
		metrics.push(
			<span key="tokens">{formatTokenCount(tokenUsage.completionTokens)} tokens</span>
		);
	}

	if (timeToFirstTokenMs != null) {
		metrics.push(
			<span key="ttft">⏱ {(timeToFirstTokenMs / 1000).toFixed(2)}s</span>
		);
	}

	if (metrics.length === 0) return null;

	return (
		<div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 py-0.5 px-1">
			{metrics.map((metric, i) => (
				<span key={i} className="flex items-center gap-1.5">
					{i > 0 && <Dot />}
					{metric}
				</span>
			))}
		</div>
	);
}
