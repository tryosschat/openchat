/**
 * Provider Store - Manages active AI provider selection and usage limits
 *
 * Users can choose between:
 * 1. OSSChat Cloud - Free with daily limits (10¢/day)
 * 2. OpenRouter - Bring your own API key
 *
 * Also tracks web search usage (20 searches/day via Valyu)
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { analytics } from "@/lib/analytics";

// Provider types - both use OpenRouter, just different API keys
export type ProviderType = "osschat" | "openrouter";

// Import model cache to get pricing dynamically
// We use dynamic import to avoid circular dependencies
let getModelPricing: ((modelId: string) => { input: number; output: number } | undefined) | null =
  null;

// Initialize the pricing lookup (called from model store)
export function initPricingLookup(
  lookup: (modelId: string) => { input: number; output: number } | undefined,
) {
  getModelPricing = lookup;
}

/**
 * Calculate cost in cents for a given model and token usage
 * Uses live pricing from OpenRouter API (fetched in model store)
 */
export function calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  // Try to get live pricing from model cache
  const pricing = getModelPricing?.(modelId);

  if (pricing) {
    // Pricing from OpenRouter is already in USD per 1M tokens
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return (inputCost + outputCost) * 100; // Return in cents
  }

  // Fallback: estimate based on typical pricing ($1/1M input, $4/1M output)
  const fallbackInputCost = (inputTokens / 1_000_000) * 1;
  const fallbackOutputCost = (outputTokens / 1_000_000) * 4;
  return (fallbackInputCost + fallbackOutputCost) * 100;
}

interface ProviderState {
  // Active provider
  activeProvider: ProviderType;

  // AI usage tracking (for OSSChat Cloud)
  dailyUsageCents: number;
  lastResetDate: string; // ISO date string

  // Search usage tracking (for Valyu web search)
  dailySearchCount: number;
  lastSearchResetDate: string; // ISO date string

  // Web search toggle
  webSearchEnabled: boolean;

  // Actions
  setActiveProvider: (provider: ProviderType) => void;
  addUsage: (cents: number) => void;
  addSearchUsage: () => void;
  resetDailyUsage: () => void;
  syncUsage: (cents: number, date: string) => void;
  toggleWebSearch: () => void;
  setWebSearchEnabled: (enabled: boolean) => void;

  // Computed
  remainingBudgetCents: () => number;
  remainingSearches: () => number;
  isOverLimit: () => boolean;
  isSearchLimitReached: () => boolean;
}

// Daily limits
export const DAILY_LIMIT_CENTS = 10;
export const DAILY_SEARCH_LIMIT = 20;

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

export const useProviderStore = create<ProviderState>()(
  devtools(
    persist(
      (set, get) => ({
        // Default to OSSChat Cloud (free tier)
        activeProvider: "osschat",

        // AI usage tracking
        dailyUsageCents: 0,
        lastResetDate: getTodayDate(),

        // Search usage tracking
        dailySearchCount: 0,
        lastSearchResetDate: getTodayDate(),

        // Web search toggle
        webSearchEnabled: false,

        setActiveProvider: (provider) =>
          set({ activeProvider: provider }, false, "provider/setActive"),

        addUsage: (cents) => {
          const state = get();
          const today = getTodayDate();

          // Reset if it's a new day
          if (state.lastResetDate !== today) {
            set(
              {
                dailyUsageCents: cents,
                lastResetDate: today,
              },
              false,
              "provider/addUsage/newDay",
            );
          } else {
            set(
              {
                dailyUsageCents: state.dailyUsageCents + cents,
              },
              false,
              "provider/addUsage",
            );
          }
        },

        addSearchUsage: () => {
          const state = get();
          const today = getTodayDate();

          // Reset if it's a new day
          if (state.lastSearchResetDate !== today) {
            set(
              {
                dailySearchCount: 1,
                lastSearchResetDate: today,
              },
              false,
              "provider/addSearch/newDay",
            );
          } else {
            set(
              {
                dailySearchCount: state.dailySearchCount + 1,
              },
              false,
              "provider/addSearch",
            );
          }
        },

        toggleWebSearch: () => {
          const state = get();
          if (!state.webSearchEnabled && state.isSearchLimitReached()) {
            return;
          }
          const newValue = !state.webSearchEnabled;
          analytics.searchToggled(newValue);
          set({ webSearchEnabled: newValue }, false, "provider/toggleWebSearch");
        },

        setWebSearchEnabled: (enabled) => {
          const state = get();
          if (enabled && state.isSearchLimitReached()) {
            return;
          }
          analytics.searchToggled(enabled);
          set({ webSearchEnabled: enabled }, false, "provider/setWebSearch");
        },

        resetDailyUsage: () =>
          set(
            {
              dailyUsageCents: 0,
              lastResetDate: getTodayDate(),
              dailySearchCount: 0,
              lastSearchResetDate: getTodayDate(),
            },
            false,
            "provider/resetDaily",
          ),
        syncUsage: (cents, date) =>
          set(
            {
              dailyUsageCents: Math.max(0, cents),
              lastResetDate: date,
            },
            false,
            "provider/syncUsage",
          ),

        remainingBudgetCents: () => {
          const state = get();
          const today = getTodayDate();

          // If it's a new day, budget is full
          if (state.lastResetDate !== today) {
            return DAILY_LIMIT_CENTS;
          }

          return Math.max(0, DAILY_LIMIT_CENTS - state.dailyUsageCents);
        },

        remainingSearches: () => {
          const state = get();
          const today = getTodayDate();

          // If it's a new day, searches are full
          if (state.lastSearchResetDate !== today) {
            return DAILY_SEARCH_LIMIT;
          }

          return Math.max(0, DAILY_SEARCH_LIMIT - state.dailySearchCount);
        },

        isOverLimit: () => {
          return get().remainingBudgetCents() <= 0;
        },

        isSearchLimitReached: () => {
          return get().remainingSearches() <= 0;
        },
      }),
      {
        name: "provider-store",
        partialize: (state) => ({
          activeProvider: state.activeProvider,
          dailyUsageCents: state.dailyUsageCents,
          lastResetDate: state.lastResetDate,
          dailySearchCount: state.dailySearchCount,
          lastSearchResetDate: state.lastSearchResetDate,
          // Persist web search toggle so it survives page reloads
          webSearchEnabled: state.webSearchEnabled,
        }),
      },
    ),
    { name: "provider-store" },
  ),
);

/**
 * Hook to check if user can use OSSChat Cloud
 */
export function useCanUseOSSChat(): boolean {
  const activeProvider = useProviderStore((s) => s.activeProvider);
  const isOverLimit = useProviderStore((s) => s.isOverLimit());

  return activeProvider === "osschat" && !isOverLimit;
}

/**
 * Hook for web search functionality
 */
export function useWebSearch() {
  const enabled = useProviderStore((s) => s.webSearchEnabled);
  const toggle = useProviderStore((s) => s.toggleWebSearch);
  const remainingSearches = useProviderStore((s) => s.remainingSearches());
  const isLimitReached = useProviderStore((s) => s.isSearchLimitReached());
  const addSearchUsage = useProviderStore((s) => s.addSearchUsage);

  return {
    enabled,
    toggle,
    remainingSearches,
    isLimitReached,
    addSearchUsage,
  };
}
