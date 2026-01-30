/**
 * OpenRouter API Key Store
 *
 * Manages the OpenRouter API key state with persistence to localStorage.
 * Uses Zustand for state management with devtools for debugging.
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import {
  clearOAuthStorage,
  exchangeCodeForKey,
  getStoredCodeVerifier,
  initiateOAuthFlow,
  validateState,
} from "../lib/openrouter-oauth";

// ============================================================================
// Types
// ============================================================================

interface OpenRouterState {
	// State
	apiKey: string | null;
	isLoading: boolean;
	error: string | null;

	// Actions
	setApiKey: (key: string) => Promise<void>;
	clearApiKey: () => Promise<void>;
  initiateLogin: (callbackUrl: string) => Promise<void>;
  handleCallback: (code: string, state: string | null) => Promise<boolean>;
  clearError: () => void;
}

// ============================================================================
// Store
// ============================================================================

export const useOpenRouterStore = create<OpenRouterState>()(
  devtools(
    persist(
      (set) => ({
        // Initial state
        apiKey: null,
        isLoading: false,
        error: null,

        // Set API key directly
		setApiKey: async (key) => {
			set({ isLoading: true, error: null }, false, "openrouter/setApiKey");
			try {
				const response = await fetch("/api/openrouter-key", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ apiKey: key }),
				});
				if (!response.ok) {
					throw new Error("Failed to store API key");
				}
				set({ apiKey: key, isLoading: false, error: null }, false, "openrouter/setApiKey");
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to store API key";
				set({ isLoading: false, error: message }, false, "openrouter/setApiKeyError");
				throw error;
			}
		},

		// Clear API key (logout)
		clearApiKey: async () => {
			set({ isLoading: true, error: null }, false, "openrouter/clearApiKey");
			try {
				const response = await fetch("/api/openrouter-key", { method: "DELETE" });
				if (!response.ok) {
					throw new Error("Failed to remove API key");
				}
				set({ apiKey: null, isLoading: false, error: null }, false, "openrouter/clearApiKey");
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to remove API key";
				set({ isLoading: false, error: message }, false, "openrouter/clearApiKeyError");
				throw error;
			}
		},

        // Initiate OAuth login flow
        initiateLogin: async (callbackUrl) => {
          set({ isLoading: true, error: null }, false, "openrouter/initiateLogin");
          try {
            await initiateOAuthFlow(callbackUrl);
            // Note: This won't resolve as the page will redirect
          } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to initiate login";
            set({ isLoading: false, error: message }, false, "openrouter/initiateLoginError");
          }
        },

        // Handle OAuth callback
        handleCallback: async (code, state) => {
          set({ isLoading: true, error: null }, false, "openrouter/handleCallback");

          try {
            // Validate state to prevent CSRF attacks
            if (!validateState(state)) {
              throw new Error("Invalid state parameter. Please try again.");
            }

            // Get stored code verifier
            const codeVerifier = getStoredCodeVerifier();
            if (!codeVerifier) {
              throw new Error("Missing code verifier. Please restart the login process.");
            }

            // Exchange code for API key
		const apiKey = await exchangeCodeForKey(code, codeVerifier);

            // Clear OAuth storage after successful exchange
            clearOAuthStorage();

		try {
			const response = await fetch("/api/openrouter-key", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ apiKey }),
			});
			if (!response.ok) {
				throw new Error("Failed to store API key");
			}
			set(
				{ apiKey, isLoading: false, error: null },
				false,
				"openrouter/handleCallbackSuccess",
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Authentication failed";
			set({ isLoading: false, error: message }, false, "openrouter/handleCallbackError");
			return false;
		}

		return true;
	} catch (error) {
            const message = error instanceof Error ? error.message : "Authentication failed";
            set({ isLoading: false, error: message }, false, "openrouter/handleCallbackError");
            return false;
          }
        },

        // Clear error state
        clearError: () => set({ error: null }, false, "openrouter/clearError"),
      }),
      {
        name: "openrouter-store",
        // Only persist the API key, not loading/error states
        partialize: (state) => ({ apiKey: state.apiKey }),
      },
    ),
    { name: "openrouter-store" },
  ),
);

// ============================================================================
// Convenience Hook
// ============================================================================

/**
 * Hook for accessing OpenRouter API key state and actions.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { apiKey, initiateLogin, clearApiKey } = useOpenRouterKey();
 *
 *   if (!apiKey) {
 *     return <button onClick={() => initiateLogin("/callback")}>Connect</button>;
 *   }
 *
 *   return <button onClick={clearApiKey}>Disconnect</button>;
 * }
 * ```
 */
export function useOpenRouterKey() {
  return useOpenRouterStore();
}
