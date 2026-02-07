/**
 * Explicit list of allowed origins for CORS and trusted auth requests.
 * SECURITY: Do NOT use wildcards here - they would allow any app on the
 * wildcard domain to make trusted cross-origin requests.
 */
const ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"https://osschat.dev",
	"https://www.osschat.dev",
];

/**
 * Get all allowed origins including environment-specific URLs.
 * Additional origins can be configured via environment variables:
 * - SITE_URL: The frontend site URL (e.g., preview deployment URL)
 * - ALLOWED_ORIGINS: Comma-separated list of additional allowed origins
 */
export function getAllowedOrigins(): string[] {
	const origins = [...ALLOWED_ORIGINS];

	// Add SITE_URL if configured (e.g., for preview deployments)
	const siteUrl = process.env.SITE_URL;
	if (siteUrl) {
		origins.push(siteUrl.trim());
	}

	// Add any additional explicitly configured origins
	// Format: comma-separated URLs (e.g., "https://preview-1.up.railway.app,https://preview-2.up.railway.app")
	const additionalOrigins = process.env.ALLOWED_ORIGINS;
	if (additionalOrigins) {
		const parsed = additionalOrigins
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean);
		origins.push(...parsed);
	}

	return origins;
}

/**
 * Check if the given origin is allowed for CORS.
 * Returns the origin if allowed, null otherwise.
 * SECURITY: Only exact matches are allowed - no wildcard support.
 */
export function getCorsOrigin(origin: string | null): string | null {
	if (!origin) return null;
	const allowed = getAllowedOrigins();
	// Only allow exact matches for security
	return allowed.includes(origin) ? origin : null;
}
