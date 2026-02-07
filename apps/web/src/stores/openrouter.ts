/**
 * OpenRouter API Key Store
 *
 * Manages the OpenRouter API key state in memory only.
 * Uses Zustand for state management with devtools for debugging.
 *
 * SECURITY NOTE: API keys are stored server-side only (encrypted in Convex).
 * The client only tracks whether a key exists (hasApiKey boolean), never the actual key.
 * This prevents XSS attacks from exfiltrating API keys via localStorage.
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
	// Note: We only track whether a key exists, not the actual key value
	// The actual key is stored server-side only for security
	hasApiKey: boolean;
	isLoading: boolean;
	error: string | null;
	isInitialized: boolean;

	// Actions
	setApiKey: (key: string) => Promise<void>;
	clearApiKey: () => Promise<void>;
	initiateLogin: (callbackUrl: string) => Promise<void>;
	handleCallback: (code: string, state: string | null) => Promise<boolean>;
	clearError: () => void;
	loadApiKeyStatus: () => Promise<void>;
}

// ============================================================================
// Store
// ============================================================================

export const useOpenRouterStore = create<OpenRouterState>()(
	devtools(
		(set) => ({
			// Initial state
			hasApiKey: false,
			isLoading: false,
			error: null,
			isInitialized: false,

			// Load API key status from server
			loadApiKeyStatus: async () => {
				try {
					const response = await fetch("/api/openrouter-key", {
						method: "GET",
						credentials: "include",
					});
					if (response.ok) {
						const data = await response.json();
						set(
							{ hasApiKey: data.hasKey, isInitialized: true },
							false,
							"openrouter/loadApiKeyStatus",
						);
					} else {
						// Not authenticated or error - just mark as initialized
						set({ hasApiKey: false, isInitialized: true }, false, "openrouter/loadApiKeyStatusNoAuth");
					}
				} catch {
					// Network error - mark as initialized anyway
					set({ isInitialized: true }, false, "openrouter/loadApiKeyStatusError");
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
					const message =
						error instanceof Error ? error.message : "Failed to store API key";
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
					const message =
						error instanceof Error ? error.message : "Failed to remove API key";
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
					const message =
						error instanceof Error ? error.message : "Failed to initiate login";
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
							{ hasApiKey: true, isLoading: false, error: null },
							false,
							"openrouter/handleCallbackSuccess",
						);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : "Authentication failed";
						set(
							{ isLoading: false, error: message },
							false,
							"openrouter/handleCallbackError",
						);
						return false;
					}

					return true;
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "Authentication failed";
					set(
						{ isLoading: false, error: message },
						false,
						"openrouter/handleCallbackError",
					);
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
 * SECURITY: The actual API key is never stored client-side.
 * Only the `hasApiKey` boolean is tracked to indicate if a key exists server-side.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { hasApiKey, initiateLogin, clearApiKey, loadApiKeyStatus } = useOpenRouterKey();
 *
 *   useEffect(() => {
 *     loadApiKeyStatus();
 *   }, [loadApiKeyStatus]);
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
