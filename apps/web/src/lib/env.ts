/**
 * Type-safe environment variables for TanStack Start
 * Access these via import.meta.env in client code
 */

// Client-side env vars (must be prefixed with VITE_)
export const env = {
  CONVEX_URL: import.meta.env.VITE_CONVEX_URL as string,
  CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL as string,
  POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY,
  POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST,
} as const;

// Validate required env vars
export function validateEnv(): void {
	const errors: Array<string> = [];
	if (!env.CONVEX_URL) {
		errors.push("VITE_CONVEX_URL is required");
	}
	if (!env.CONVEX_SITE_URL) {
		errors.push("VITE_CONVEX_SITE_URL is required");
	}
	if (errors.length > 0) {
		throw new Error(`Missing required environment variables: ${errors.join(", ")}`);
	}
}
