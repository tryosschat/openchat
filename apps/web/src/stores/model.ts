/**
 * Model Selection Store - Dynamic model loading from OpenRouter API
 *
 * Fetches ALL 350+ models from OpenRouter API directly.
 * Uses models.dev for provider logos.
 * Groups models by provider/family automatically.
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { useCallback, useEffect, useMemo, useState } from "react";
import { initPricingLookup } from "./provider";
import { analytics } from "@/lib/analytics";

// ============================================================================
// Types
// ============================================================================

/** Raw model data from OpenRouter API */
interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
  };
  architecture?: {
    modality?: string;
  };
  supported_parameters?: Array<string>;
}

export interface Model {
  id: string;
  name: string;
  provider: string; // Provider/company name (e.g., "Anthropic", "Meta Llama")
  modelName: string; // Model/product name for filters (e.g., "Claude", "Llama")
  providerId: string; // Provider slug from model ID (e.g., "meta-llama", "qwen")
  logoId: string; // Logo slug for models.dev (e.g., "llama", "alibaba")
  family?: string; // Model family (e.g., "claude-3.5")
  description?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  pricing?: { input: number; output: number };
  modality?: string;
  reasoning?: boolean;
  toolCall?: boolean;
  isPopular?: boolean;
  isFree?: boolean;
}

// ============================================================================
// Provider mapping for display names and logo IDs
// ============================================================================

const PROVIDER_INFO: Partial<Record<string, { name: string; modelName?: string; logoId: string }>> = {
  openai: { name: "OpenAI", modelName: "GPT", logoId: "openai" },
  anthropic: { name: "Anthropic", modelName: "Claude", logoId: "anthropic" },
  google: { name: "Google", modelName: "Gemini", logoId: "google" },
  "meta-llama": { name: "Meta Llama", modelName: "Llama", logoId: "llama" },
  mistralai: { name: "Mistral", logoId: "mistral" },
  deepseek: { name: "DeepSeek", logoId: "deepseek" },
  "x-ai": { name: "xAI", modelName: "Grok", logoId: "xai" },
  cohere: { name: "Cohere", logoId: "cohere" },
  perplexity: { name: "Perplexity", logoId: "perplexity" },
  qwen: { name: "Qwen", logoId: "alibaba" },
  nvidia: { name: "NVIDIA", logoId: "nvidia" },
  microsoft: { name: "Microsoft", modelName: "Phi", logoId: "azure" },
  amazon: { name: "Amazon", modelName: "Nova", logoId: "amazon-bedrock" },
  ai21: { name: "AI21", logoId: "ai21" },
  together: { name: "Together", logoId: "togetherai" },
  "fireworks-ai": { name: "Fireworks", logoId: "fireworks-ai" },
  groq: { name: "Groq", logoId: "groq" },
  databricks: { name: "Databricks", logoId: "databricks" },
  inflection: { name: "Inflection", logoId: "inflection" },
  nous: { name: "Nous", logoId: "nous" },
  nousresearch: { name: "NousResearch", logoId: "nous" },
  openchat: { name: "OpenChat", logoId: "openchat" },
  teknium: { name: "Teknium", logoId: "teknium" },
  cognitivecomputations: { name: "Cognitive", logoId: "cognitive" },
  neversleep: { name: "NeverSleep", logoId: "neversleep" },
  sao10k: { name: "Sao10k", logoId: "sao10k" },
  thedrummer: { name: "TheDrummer", logoId: "thedrummer" },
  "eva-unit-01": { name: "Eva", logoId: "eva" },
  liquid: { name: "Liquid", logoId: "liquid" },
  "bytedance-seed": { name: "ByteDance", logoId: "bytedance" },
  minimax: { name: "MiniMax", logoId: "minimax" },
  moonshotai: { name: "Moonshot", logoId: "moonshotai" },
  zhipuai: { name: "Zhipu", logoId: "zhipuai" },
  thudm: { name: "THUDM", logoId: "thudm" },
  featherless: { name: "Featherless", logoId: "featherless" },
  infermatic: { name: "Infermatic", logoId: "infermatic" },
  aetherwiing: { name: "AetherWiing", logoId: "aetherwiing" },
  "all-hands": { name: "All Hands", logoId: "all-hands" },
  rekaai: { name: "Reka", logoId: "rekaai" },
  sophosympatheia: { name: "Sophos", logoId: "sophos" },
  undi95: { name: "Undi95", logoId: "undi95" },
  mancer: { name: "Mancer", logoId: "mancer" },
  lynn: { name: "Lynn", logoId: "lynn" },
  pygmalionai: { name: "Pygmalion", logoId: "pygmalionai" },
  jondurbin: { name: "Jon Durbin", logoId: "jondurbin" },
  gryphe: { name: "Gryphe", logoId: "gryphe" },
  arliai: { name: "ArliAI", logoId: "arliai" },
  openrouter: { name: "OpenRouter", logoId: "openrouter" },
  allenai: { name: "Allen AI", logoId: "allenai" },
};

// Popular models - shown at top
const POPULAR_MODEL_IDS = new Set([
  "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3.7-sonnet",
  "anthropic/claude-3.5-haiku",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1",
  "openai/gpt-4.1-mini",
  "openai/o3-mini",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-2.0-flash-001",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-chat-v3.1",
  "deepseek/deepseek-r1",
  "meta-llama/llama-3.3-70b-instruct",
  "x-ai/grok-3",
  "mistralai/mistral-large-2411",
  "qwen/qwen-2.5-72b-instruct",
]);

// Provider priority for sorting
const PROVIDER_PRIORITY = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "meta-llama",
  "x-ai",
  "mistralai",
  "qwen",
  "cohere",
  "perplexity",
];

// ============================================================================
// Cache with localStorage persistence
// ============================================================================

interface ModelCache {
  models: Array<Model> | null;
  timestamp: number;
  loading: boolean;
  error: Error | null;
  promise: Promise<Array<Model>> | null;
}

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
const STORAGE_KEY = "openchat-models-cache";

function loadFromStorage(): { models: Array<Model> | null; timestamp: number } {
  if (typeof window === "undefined") return { models: null, timestamp: 0 };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.models && parsed.timestamp) {
        return { models: parsed.models, timestamp: parsed.timestamp };
      }
    }
  } catch (e) {
    console.warn("Failed to load models from localStorage:", e);
  }
  return { models: null, timestamp: 0 };
}

function saveToStorage(models: Array<Model>, timestamp: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ models, timestamp }));
  } catch (e) {
    console.warn("Failed to save models to localStorage:", e);
  }
}

const stored = loadFromStorage();

let cache: ModelCache = {
  models: stored.models,
  timestamp: stored.timestamp,
  loading: false,
  error: null,
  promise: null,
};

// Cache change listeners
type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================================
// Transform OpenRouter model to our format
// ============================================================================

function extractFamily(id: string, name: string): string | undefined {
  const lower = name.toLowerCase();

  // Common families
  if (lower.includes("claude-3.5")) return "Claude 3.5";
  if (lower.includes("claude-3.7")) return "Claude 3.7";
  if (lower.includes("claude-sonnet-4") || lower.includes("claude sonnet 4")) return "Claude 4";
  if (lower.includes("claude-opus-4") || lower.includes("claude opus 4")) return "Claude 4";
  if (lower.includes("claude-haiku-4") || lower.includes("claude haiku 4")) return "Claude 4";
  if (lower.includes("claude")) return "Claude";

  if (lower.includes("gpt-4o")) return "GPT-4o";
  if (lower.includes("gpt-4.1")) return "GPT-4.1";
  if (lower.includes("gpt-4")) return "GPT-4";
  if (lower.includes("gpt-5")) return "GPT-5";
  if (lower.includes("o1-") || lower.includes("o1 ")) return "o1";
  if (lower.includes("o3-") || lower.includes("o3 ") || id.includes("/o3")) return "o3";
  if (lower.includes("o4-") || lower.includes("o4 ")) return "o4";

  if (lower.includes("gemini-2.5")) return "Gemini 2.5";
  if (lower.includes("gemini-2.0")) return "Gemini 2.0";
  if (lower.includes("gemini-3")) return "Gemini 3";
  if (lower.includes("gemini")) return "Gemini";

  if (lower.includes("llama-3.3")) return "Llama 3.3";
  if (lower.includes("llama-3.2")) return "Llama 3.2";
  if (lower.includes("llama-3.1")) return "Llama 3.1";
  if (lower.includes("llama-4")) return "Llama 4";
  if (lower.includes("llama")) return "Llama";

  if (lower.includes("mistral-large")) return "Mistral Large";
  if (lower.includes("mistral-small")) return "Mistral Small";
  if (lower.includes("mistral-medium")) return "Mistral Medium";
  if (lower.includes("codestral")) return "Codestral";
  if (lower.includes("mixtral")) return "Mixtral";
  if (lower.includes("mistral")) return "Mistral";

  if (lower.includes("deepseek-r1")) return "DeepSeek R1";
  if (lower.includes("deepseek-v3")) return "DeepSeek V3";
  if (lower.includes("deepseek")) return "DeepSeek";

  if (lower.includes("grok-4")) return "Grok 4";
  if (lower.includes("grok-3")) return "Grok 3";
  if (lower.includes("grok")) return "Grok";

  if (lower.includes("qwen-2.5")) return "Qwen 2.5";
  if (lower.includes("qwen-2")) return "Qwen 2";
  if (lower.includes("qwen3")) return "Qwen 3";
  if (lower.includes("qwen")) return "Qwen";

  return undefined;
}

function transformModel(raw: OpenRouterModel): Model {
  const id = raw.id;
  const providerSlug = id.split("/")[0] || "unknown";
  const info = PROVIDER_INFO[providerSlug] || {
    name: providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1).replace(/-/g, " "),
    logoId: providerSlug,
  };

  const inputPrice = parseFloat(raw.pricing?.prompt || "0") * 1_000_000;
  const outputPrice = parseFloat(raw.pricing?.completion || "0") * 1_000_000;
  const isFree = id.endsWith(":free") || (inputPrice === 0 && outputPrice === 0);

  const supportsTools = raw.supported_parameters
    ? raw.supported_parameters.includes("tools") ||
      raw.supported_parameters.includes("tool_choice")
    : false;
  const supportsReasoning =
    raw.supported_parameters?.includes("reasoning") ||
    raw.supported_parameters?.includes("include_reasoning") ||
    id.includes("-r1") ||
    id.includes("/o1") ||
    id.includes("/o3");

  return {
    id,
    name: raw.name || id,
    provider: info.name,
    modelName: info.modelName || info.name,
    providerId: providerSlug,
    logoId: info.logoId,
    family: extractFamily(id, raw.name || ""),
    description: raw.description,
    contextLength: raw.context_length,
    maxOutputTokens: raw.top_provider?.max_completion_tokens,
    pricing: { input: inputPrice, output: outputPrice },
    modality: raw.architecture?.modality,
    reasoning: supportsReasoning,
    toolCall: supportsTools,
    isPopular: POPULAR_MODEL_IDS.has(id),
    isFree,
  };
}

// ============================================================================
// Fetch ALL models from OpenRouter
// ============================================================================

async function fetchAllModels(): Promise<Array<Model>> {
  // Return cached if fresh
  if (cache.models && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.models;
  }

  // Dedupe concurrent requests
  if (cache.promise) return cache.promise;

  cache.loading = true;
  cache.error = null;
  notifyListeners();

  cache.promise = (async () => {
    try {
      const response = await fetch("/api/models", {
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Models API error: ${response.status}`);
      }

      const data = await response.json();
      const rawModels = data.data || [];

      // Transform all models
      const models: Array<Model> = (rawModels as Array<OpenRouterModel>)
        .filter((m): m is OpenRouterModel & { id: string } => !!m.id && typeof m.id === "string")
        .map(transformModel)
        // Sort: Popular first, then by provider priority, then alphabetically
        .sort((a: Model, b: Model) => {
          // Popular first
          if (a.isPopular && !b.isPopular) return -1;
          if (!a.isPopular && b.isPopular) return 1;

          // Provider priority
          const aSlug = a.id.split("/")[0];
          const bSlug = b.id.split("/")[0];
          const aPriority = PROVIDER_PRIORITY.indexOf(aSlug);
          const bPriority = PROVIDER_PRIORITY.indexOf(bSlug);
          const aP = aPriority === -1 ? 999 : aPriority;
          const bP = bPriority === -1 ? 999 : bPriority;
          if (aP !== bP) return aP - bP;

          // Alphabetically by name
          return a.name.localeCompare(b.name);
        });

      cache.models = models;
      cache.timestamp = Date.now();
      cache.error = null;

      saveToStorage(models, cache.timestamp);

      initPricingLookup((modelId: string) => {
        const model = models.find((m) => m.id === modelId);
        return model?.pricing;
      });

      return models;
    } catch (e) {
      cache.error = e instanceof Error ? e : new Error("Failed to fetch models");
      throw cache.error;
    } finally {
      cache.loading = false;
      cache.promise = null;
      notifyListeners();
    }
  })();

  return cache.promise;
}

// Clear cache and refetch
export function clearModelCache() {
  cache = {
    models: null,
    timestamp: 0,
    loading: false,
    error: null,
    promise: null,
  };
  notifyListeners();
}

// Reload models (clear cache + fetch)
export async function reloadModels(): Promise<Array<Model>> {
  clearModelCache();
  return fetchAllModels();
}

// ============================================================================
// Fallback models
// ============================================================================

function getFallbackModels(): Array<Model> {
  return [
    {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "Anthropic",
      modelName: "Claude",
      providerId: "anthropic",
      logoId: "anthropic",
      family: "Claude 3.5",
      isPopular: true,
    },
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      provider: "OpenAI",
      modelName: "GPT",
      providerId: "openai",
      logoId: "openai",
      family: "GPT-4o",
      isPopular: true,
    },
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o Mini",
      provider: "OpenAI",
      modelName: "GPT",
      providerId: "openai",
      logoId: "openai",
      family: "GPT-4o",
      isPopular: true,
    },
    {
      id: "google/gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      provider: "Google",
      modelName: "Gemini",
      providerId: "google",
      logoId: "google",
      family: "Gemini 2.5",
      isPopular: true,
    },
    {
      id: "deepseek/deepseek-chat",
      name: "DeepSeek Chat",
      provider: "DeepSeek",
      modelName: "DeepSeek",
      providerId: "deepseek",
      logoId: "deepseek",
      family: "DeepSeek",
      isPopular: true,
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct",
      name: "Llama 3.3 70B",
      provider: "Meta Llama",
      modelName: "Llama",
      providerId: "meta-llama",
      logoId: "llama",
      family: "Llama 3.3",
      isPopular: true,
    },
  ];
}

export const fallbackModels = getFallbackModels();

// ============================================================================
// Reasoning Effort Types
// ============================================================================

export type ReasoningEffort = "none" | "low" | "medium" | "high";

// ============================================================================
// Dynamic Model Capabilities (API-driven, no hardcoded model lists)
// ============================================================================

export interface ModelCapabilities {
  supportsReasoning: boolean;
  supportsEffortLevels: boolean;
  alwaysReasons: boolean;
  supportsTools: boolean;
}

export function getModelCapabilities(modelId: string, model?: Model | null): ModelCapabilities {
  const supportsReasoning = model?.reasoning === true;
  const alwaysReasons = /deepseek.*r1/i.test(modelId);
  const supportsEffort = supportsReasoning && !alwaysReasons;
  const supportsTools = model?.toolCall === true;

  return {
    supportsReasoning,
    supportsEffortLevels: supportsEffort,
    alwaysReasons,
    supportsTools,
  };
}

// ============================================================================
// Zustand Store
// ============================================================================

interface ModelState {
  selectedModelId: string;
  setSelectedModel: (modelId: string) => void;
  favorites: Set<string>;
  toggleFavorite: (modelId: string) => boolean;
  isFavorite: (modelId: string) => boolean;
  // Reasoning control (boolean toggle in UI; effort retained for backend compatibility)
  reasoningEnabled: boolean;
  setReasoningEnabled: (enabled: boolean) => void;
  toggleReasoning: () => void;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (effort: ReasoningEffort) => void;
}

export const useModelStore = create<ModelState>()(
  devtools(
    persist(
      (set, get) => ({
        selectedModelId: "anthropic/claude-3.5-sonnet",

        setSelectedModel: (modelId) => {
          analytics.modelSwitched(modelId);
          set({ selectedModelId: modelId }, false, "model/select");
        },

        favorites: new Set<string>(),

        toggleFavorite: (modelId) => {
          const isFav = get().favorites.has(modelId);
          set(
            (state) => {
              const newFavs = new Set(state.favorites);
              if (isFav) newFavs.delete(modelId);
              else newFavs.add(modelId);
              return { favorites: newFavs };
            },
            false,
            "model/toggleFavorite",
          );
          return !isFav;
        },

        isFavorite: (modelId) => get().favorites.has(modelId),

        // Reasoning toggle - default off
        reasoningEnabled: false,

        setReasoningEnabled: (enabled) => {
          analytics.thinkingModeChanged(enabled ? "enabled" : "disabled");
          set(
            {
              reasoningEnabled: enabled,
              reasoningEffort: enabled ? "medium" : "none",
            },
            false,
            "model/reasoningEnabled",
          );
        },

        toggleReasoning: () => {
          const enabled = !get().reasoningEnabled;
          analytics.thinkingModeChanged(enabled ? "enabled" : "disabled");
          set(
            {
              reasoningEnabled: enabled,
              reasoningEffort: enabled ? "medium" : "none",
            },
            false,
            "model/toggleReasoning",
          );
        },

        // Reasoning effort is retained for backend payload compatibility.
        reasoningEffort: "none" as ReasoningEffort,

        setReasoningEffort: (effort) => {
          analytics.thinkingModeChanged(effort);
          set(
            {
              reasoningEffort: effort,
              reasoningEnabled: effort !== "none",
            },
            false,
            "model/reasoningEffort",
          );
        },
      }),
      {
        name: "model-store",
        partialize: (state) => ({
          selectedModelId: state.selectedModelId,
          favorites: Array.from(state.favorites),
          reasoningEnabled: state.reasoningEnabled,
          reasoningEffort: state.reasoningEffort,
        }),
        merge: (persisted, current) => {
          const data = persisted as {
            selectedModelId?: string;
            favorites?: Array<string>;
            reasoningEnabled?: boolean;
            reasoningEffort?: ReasoningEffort;
          };

          const mergedEffort = data.reasoningEffort ?? current.reasoningEffort;
          const mergedEnabled = data.reasoningEnabled ?? (mergedEffort !== "none");

          return {
            ...current,
            selectedModelId: data.selectedModelId ?? current.selectedModelId,
            favorites: new Set(data.favorites ?? []),
            reasoningEnabled: mergedEnabled,
            reasoningEffort: mergedEnabled ? mergedEffort : "none",
          };
        },
      },
    ),
    { name: "model-store" },
  ),
);

// ============================================================================
// React Hook - Load ALL models
// ============================================================================

export function useModels() {
  const [models, setModels] = useState<Array<Model>>(() => cache.models || getFallbackModels());
  const [isLoading, setIsLoading] = useState(() => cache.loading || !cache.models);
  const [error, setError] = useState<Error | null>(() => cache.error);
  const [, forceUpdate] = useState(0);

  // Subscribe to cache changes
  useEffect(() => {
    return subscribe(() => forceUpdate((n) => n + 1));
  }, []);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (cache.models && Date.now() - cache.timestamp < CACHE_TTL) {
        setModels(cache.models);
        setIsLoading(false);
        setError(null);
        return;
      }

      setIsLoading(true);

      try {
        const fetched = await fetchAllModels();
        if (!cancelled) {
          setModels(fetched);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error("Failed"));
          setModels(getFallbackModels());
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload function
  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await reloadModels();
      setModels(fetched);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const modelsByProvider = useMemo(() => {
    const groups: Record<string, Array<Model>> = {};
    for (const model of models) {
      (groups[model.provider] ??= []).push(model);
    }
    return groups;
  }, [models]);

  const modelsByFamily = useMemo(() => {
    const groups: Record<string, Array<Model>> = {};
    for (const model of models) {
      const key = model.family || model.provider;
      (groups[key] ??= []).push(model);
    }
    return groups;
  }, [models]);

  // Get providers sorted
  const providers = useMemo(() => {
    return Object.keys(modelsByProvider).sort((a, b) => {
      const aModels = modelsByProvider[a];
      const bModels = modelsByProvider[b];
      const aHasPopular = aModels.some((m) => m.isPopular);
      const bHasPopular = bModels.some((m) => m.isPopular);
      if (aHasPopular && !bHasPopular) return -1;
      if (!aHasPopular && bHasPopular) return 1;
      return bModels.length - aModels.length;
    });
  }, [modelsByProvider]);

  // Get families sorted
  const families = useMemo(() => {
    return Object.keys(modelsByFamily).sort((a, b) => {
      const aModels = modelsByFamily[a];
      const bModels = modelsByFamily[b];
      const aHasPopular = aModels.some((m) => m.isPopular);
      const bHasPopular = bModels.some((m) => m.isPopular);
      if (aHasPopular && !bHasPopular) return -1;
      if (!aHasPopular && bHasPopular) return 1;
      return bModels.length - aModels.length;
    });
  }, [modelsByFamily]);

  const popularModels = useMemo(() => models.filter((m) => m.isPopular), [models]);

  return {
    models,
    modelsByProvider,
    modelsByFamily,
    providers,
    families,
    popularModels,
    isLoading,
    error,
    reload,
    totalCount: models.length,
  };
}

// ============================================================================
// Helpers
// ============================================================================

export function getModelById(modelList: Array<Model>, id: string): Model | undefined {
  return modelList.find((m) => m.id === id);
}

export function prefetchModels() {
  fetchAllModels().catch(() => {});
}

// Get cache status
export function getCacheStatus() {
  return {
    hasData: !!cache.models,
    modelCount: cache.models?.length || 0,
    timestamp: cache.timestamp,
    age: cache.timestamp ? Date.now() - cache.timestamp : null,
    isStale: cache.timestamp ? Date.now() - cache.timestamp > CACHE_TTL : true,
    isLoading: cache.loading,
  };
}
