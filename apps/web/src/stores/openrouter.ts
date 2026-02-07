/**
 * OpenRouter API Key Store
 *
 * Manages the OpenRouter API key connection state.
 * The actual API key is stored server-side only for security.
 * Uses Zustand for state management with devtools for debugging.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
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
	hasApiKey: boolean;
	isLoading: boolean;
	isInitialized: boolean;
	error: string | null;

	// Actions
	initialize: () => Promise<void>;
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
		(set, get) => ({
			// Initial state
			hasApiKey: false,
			isLoading: false,
			isInitialized: false,
			error: null,

			// Initialize by checking server for existing API key
			initialize: async () => {
				// Skip if already initialized
				if (get().isInitialized) return;

				set({ isLoading: true }, false, "openrouter/initialize");
				try {
					const response = await fetch("/api/openrouter-key");
					if (response.ok) {
						const data = await response.json();
						set(
							{ hasApiKey: data.hasKey, isLoading: false, isInitialized: true },
							false,
							"openrouter/initializeSuccess",
						);
					} else {
						// Not authenticated or error - assume no key
						set(
							{ hasApiKey: false, isLoading: false, isInitialized: true },
							false,
							"openrouter/initializeNoAuth",
						);
					}
				} catch {
					// Network error - assume no key but mark as initialized
					set(
						{ hasApiKey: false, isLoading: false, isInitialized: true },
						false,
						"openrouter/initializeError",
					);
				}
			},

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
					set(
						{ hasApiKey: true, isLoading: false, error: null },
						false,
						"openrouter/setApiKeySuccess",
					);
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
					set(
						{ hasApiKey: false, isLoading: false, error: null },
						false,
						"openrouter/clearApiKeySuccess",
					);
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

					// Store the API key server-side only
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
						{ hasApiKey: true, isLoading: false, error: null },
						false,
						"openrouter/handleCallbackSuccess",
					);
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
 *   const { hasApiKey, initiateLogin, clearApiKey, initialize } = useOpenRouterKey();
 *
 *   // Initialize on mount to check server for existing key
 *   useEffect(() => {
 *     initialize();
 *   }, [initialize]);
 *
 *   if (!hasApiKey) {
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
