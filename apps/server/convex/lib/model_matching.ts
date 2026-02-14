export interface AAModel {
	slug: string;
	model_creator: {
		slug: string;
		name: string;
	};
	evaluations: Record<string, number | null>;
}

export const MANUAL_OVERRIDES: Record<string, string> = {
	"claude-35-sonnet": "anthropic/claude-3.5-sonnet",
	"claude-35-sonnet-june-24": "anthropic/claude-3.5-sonnet",
	"claude-3-5-sonnet": "anthropic/claude-3.5-sonnet",
	"claude-3-7-sonnet": "anthropic/claude-3.7-sonnet",
	"claude-3-7-sonnet-thinking": "anthropic/claude-3.7-sonnet",
	"claude-3-5-haiku": "anthropic/claude-3.5-haiku",
	"claude-4-sonnet": "anthropic/claude-sonnet-4",
	"claude-4-sonnet-thinking": "anthropic/claude-sonnet-4",
	"claude-sonnet-4": "anthropic/claude-sonnet-4",
	"claude-4-5-sonnet": "anthropic/claude-sonnet-4.5",
	"claude-4-5-sonnet-thinking": "anthropic/claude-sonnet-4.5",
	"claude-4-5-haiku": "anthropic/claude-haiku-4.5",
	"claude-4-5-haiku-reasoning": "anthropic/claude-haiku-4.5",
	"claude-opus-4-5": "anthropic/claude-opus-4.5",
	"claude-opus-4-5-thinking": "anthropic/claude-opus-4.5",
	"claude-opus-4-6": "anthropic/claude-opus-4.6",
	"claude-opus-4-6-adaptive": "anthropic/claude-opus-4.6",
	"claude-4-1-opus": "anthropic/claude-opus-4.1",
	"claude-4-1-opus-thinking": "anthropic/claude-opus-4.1",
	"claude-4-opus": "anthropic/claude-opus-4",
	"claude-4-opus-thinking": "anthropic/claude-opus-4",
	"deepseek-v3": "deepseek/deepseek-chat",
	"deepseek-v3-0324": "deepseek/deepseek-chat-v3.1",
	"deepseek-r1": "deepseek/deepseek-r1",
	"deepseek-r1-0120": "deepseek/deepseek-r1",
	"llama-3-3-instruct-70b": "meta-llama/llama-3.3-70b-instruct",
	"llama-3-3-70b": "meta-llama/llama-3.3-70b-instruct",
	"llama-3-1-instruct-405b": "meta-llama/llama-3.1-405b-instruct",
	"llama-3-1-instruct-70b": "meta-llama/llama-3.1-70b-instruct",
	"llama-3-1-instruct-8b": "meta-llama/llama-3.1-8b-instruct",
	"llama-4-maverick": "meta-llama/llama-4-maverick",
	"llama-4-scout": "meta-llama/llama-4-scout",
	"gpt-4o": "openai/gpt-4o",
	"gpt-4o-mini": "openai/gpt-4o-mini",
	"o3-mini": "openai/o3-mini",
	"o3": "openai/o3",
	"o4-mini": "openai/o4-mini",
	"grok-3": "x-ai/grok-3",
	"grok-4": "x-ai/grok-4",
	"mistral-large-2": "mistralai/mistral-large-2411",
	"mistral-large-2407": "mistralai/mistral-large-2411",
	"mistral-large-2411": "mistralai/mistral-large-2411",
	"mistral-large-3": "mistralai/mistral-large-2512",
	"mistral-medium-3": "mistralai/mistral-medium-3",
	"mistral-medium-3-1": "mistralai/mistral-medium-3.1",
	"mistral-small-3": "mistralai/mistral-small-24b-instruct-2501",
	"mistral-small-3-1": "mistralai/mistral-small-24b-instruct-2501",
	"mistral-small-3-2": "mistralai/mistral-small-24b-instruct-2501",
	"qwen-2-5-72b-instruct": "qwen/qwen-2.5-72b-instruct",
	"gemini-2-5-flash": "google/gemini-2.5-flash",
	"gemini-2-5-pro": "google/gemini-2.5-pro",
	"gemini-2-0-flash": "google/gemini-2.0-flash-001",
	"gemini-3-flash": "google/gemini-3-flash-preview",
	"gemini-3-flash-reasoning": "google/gemini-3-flash-preview",
	"gemini-3-pro": "google/gemini-3-pro-preview",
	"gpt-4-1": "openai/gpt-4.1",
	"gpt-4-1-mini": "openai/gpt-4.1-mini",
};

function normalizeModelId(modelId: string): string {
	const [creatorSlug = "", modelSlug = ""] = modelId.split("/");
	return `${normalizeSlug(creatorSlug)}/${normalizeSlug(modelSlug)}`;
}

function canonicalizeSlug(slug: string): string {
	return slug
		.toLowerCase()
		.trim()
		.replace(/[._\s]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function matchAAtoOpenRouterWithIds(
	aaSlug: string,
	aaCreatorSlug: string,
	openRouterIds: Set<string>,
): string | null {
	const manualOverride = MANUAL_OVERRIDES[canonicalizeSlug(aaSlug)];
	if (manualOverride && openRouterIds.has(manualOverride)) {
		return manualOverride;
	}

	const exactMatch = `${aaCreatorSlug.toLowerCase()}/${aaSlug.toLowerCase()}`;
	if (openRouterIds.has(exactMatch)) {
		return exactMatch;
	}

	const normalizedMatch = `${normalizeSlug(aaCreatorSlug)}/${normalizeSlug(aaSlug)}`;
	for (const openRouterId of openRouterIds) {
		if (normalizeModelId(openRouterId) === normalizedMatch) {
			return openRouterId;
		}
	}

	return null;
}

export function normalizeSlug(slug: string): string {
	const normalized = canonicalizeSlug(slug);
	return normalized.replace(/(?:-\d{3,4})+$/, "");
}

export function buildMatchingMap(
	aaModels: AAModel[],
	openRouterIds: string[],
): Map<string, string> {
	const matchingMap = new Map<string, string>();
	const openRouterIdsSet = new Set(openRouterIds);

	for (const model of aaModels) {
		const matchedOpenRouterId = matchAAtoOpenRouterWithIds(
			model.slug,
			model.model_creator.slug,
			openRouterIdsSet,
		);

		if (matchedOpenRouterId) {
			matchingMap.set(model.slug, matchedOpenRouterId);
		}
	}

	return matchingMap;
}
