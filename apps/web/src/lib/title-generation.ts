export type GenerateTitleResponse = {
	queued?: boolean;
	saved?: boolean;
	reason?: string;
	error?: string;
};

export function shouldAttemptAutoTitle({
	existingMessageCount,
	seedText,
}: {
	existingMessageCount: number;
	seedText: string;
}): boolean {
	return existingMessageCount === 0 && seedText.trim().length > 0;
}

export function shouldTriggerAutoTitle({
	startedWithoutChatId,
	existingMessageCount,
	seedText,
}: {
	startedWithoutChatId: boolean;
	existingMessageCount: number;
	seedText: string;
}): boolean {
	const normalizedSeed = seedText.trim();
	if (!normalizedSeed) return false;
	return (
		startedWithoutChatId ||
		shouldAttemptAutoTitle({
			existingMessageCount,
			seedText: normalizedSeed,
		})
	);
}

export function formatTitleGenerationError(payload: GenerateTitleResponse | null): string {
	if (!payload) return "Failed to generate chat name";
	if (payload.error) return payload.error;
	if (payload.reason?.startsWith("llm_status_")) {
		return "The title model request failed. Please try again.";
	}

	switch (payload.reason) {
		case "missing_openrouter_key":
			return "Connect your OpenRouter API key to generate titles with this provider.";
		case "generation_failed":
			return "Could not generate a chat title right now. Try again.";
		case "empty_seed":
			return "Not enough message content to generate a title.";
		case "empty_title":
			return "Model returned an empty title. Try again.";
		default:
			return "Failed to generate chat name";
	}
}
