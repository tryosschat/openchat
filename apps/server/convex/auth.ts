import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import { betterAuth } from "better-auth";
import { oAuthProxy } from "better-auth/plugins";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";

import { getAllowedOrigins } from "./lib/origins";

/**
 * Redact sensitive tokens from auth URLs for safe logging.
 * Strips query string parameters (which contain one-time tokens) and replaces
 * them with a redacted placeholder. Only the origin + pathname are preserved.
 */
function redactAuthUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}?token=***`;
	} catch {
		return "[invalid-url]";
	}
}

/**
 * Production Convex site URL - used for OAuth callbacks.
 * All OAuth flows (including from preview environments) route through production.
 */
const PRODUCTION_CONVEX_SITE_URL = process.env.PRODUCTION_CONVEX_SITE_URL;

/**
 * Better Auth component client for Convex integration.
 * Provides adapter for database operations and helper methods.
 */
export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Create Better Auth instance with GitHub OAuth only.
 * This is called for each request to get a fresh auth instance with context.
 * 
 * IMPORTANT: authConfig and the convex plugin must be created inside this function
 * because CONVEX_SITE_URL is not available at module load time in Convex.
 */
export const createAuth = (
	ctx: GenericCtx<DataModel>,
	{ optionsOnly } = { optionsOnly: false }
) => {
	// Get URLs at runtime - CONVEX_SITE_URL is the base for OAuth callbacks
	const convexSiteUrl = process.env.CONVEX_SITE_URL;
	if (!convexSiteUrl) {
		throw new Error("CONVEX_SITE_URL environment variable is not set");
	}
	const siteUrl = process.env.SITE_URL || "http://localhost:3000";

	// Detect if this is a preview environment (explicit opt-in only)
	// Dev cloud deployments with their own OAuth apps should NOT use oAuthProxy
	const isPreview = process.env.DEPLOYMENT_TYPE === "preview";

	// Build authConfig at runtime when CONVEX_SITE_URL is available
	const authConfig = {
		providers: [getAuthConfigProvider()],
	};

	// Build plugins array - add oAuthProxy for preview environments
	const plugins = [
		// Required for Convex compatibility - pass authConfig for JWT configuration
		convex({ authConfig }),
		// Enable cross-domain auth for frontend on different domain (localhost:3000 -> convex.site)
		crossDomain({ siteUrl }),
	];

	// Add oAuthProxy plugin for preview environments
	// This routes OAuth callbacks through production and redirects back to preview
	if (isPreview) {
		if (!PRODUCTION_CONVEX_SITE_URL) {
			throw new Error("PRODUCTION_CONVEX_SITE_URL environment variable is not set");
		}
		plugins.push(
			oAuthProxy({
				productionURL: PRODUCTION_CONVEX_SITE_URL,
				currentURL: convexSiteUrl,
			}) as unknown as typeof plugins[number]
		);
	}

	const trustedOrigins = [
		PRODUCTION_CONVEX_SITE_URL,
		convexSiteUrl,
		siteUrl,
		...getAllowedOrigins(),
	].filter((origin): origin is string => Boolean(origin));

	const auth = betterAuth({
		// Disable logging when createAuth is called just to generate options
		logger: {
			disabled: optionsOnly,
		},
		// Use Convex site URL as baseURL so OAuth callbacks work correctly
		baseURL: convexSiteUrl,
		database: authComponent.adapter(ctx),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
			maxPasswordLength: 128,
			// SECURITY: Require verified email to prevent account takeover via
			// unverified email registration exploiting email-based migration linking (OSS-37)
			requireEmailVerification: true,
			sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
				// TODO: integrate with email provider (e.g., Resend, SendGrid)
				// SECURITY: Never log full URL — it contains a one-time token (OSS-64)
				console.log(`[Auth] Password reset requested for ${user.email}: ${redactAuthUrl(url)}`);
			},
		},
		emailVerification: {
			sendOnSignUp: true,
			sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
				// TODO: integrate with email provider (e.g., Resend, SendGrid)
				// SECURITY: Never log full URL — it contains a one-time token (OSS-64)
				console.log(`[Auth] Verification email for ${user.email}: ${redactAuthUrl(url)}`);
			},
		},
		socialProviders: {
			// Only include GitHub OAuth if credentials are configured
			// (avoids throwing during Convex module analysis when env vars aren't set yet)
			...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
				? {
						github: {
							clientId: process.env.GITHUB_CLIENT_ID,
							clientSecret: process.env.GITHUB_CLIENT_SECRET,
							// Use current environment's URL for OAuth callbacks
							redirectURI: `${convexSiteUrl}/api/auth/callback/github`,
						},
					}
				: {}),
			// Only include Vercel OAuth if credentials are configured
			...(process.env.VERCEL_CLIENT_ID && process.env.VERCEL_CLIENT_SECRET
				? {
						vercel: {
							clientId: process.env.VERCEL_CLIENT_ID,
							clientSecret: process.env.VERCEL_CLIENT_SECRET,
							// Use current environment's URL for OAuth callbacks
							redirectURI: `${convexSiteUrl}/api/auth/callback/vercel`,
							// Request email and profile scopes
							scope: ["openid", "email", "profile"],
						},
					}
				: {}),
		},
	// Trust explicitly configured origins (no wildcards for security)
	trustedOrigins,
		plugins,
	});
	
	return auth;
};

/**
 * Get the currently authenticated user from Better Auth.
 * Returns null if not authenticated.
 */
export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx as unknown as GenericCtx<DataModel>);
	},
});
