/**
 * Environment variable validation for Convex backend
 * Convex doesn't support external validation libraries, so we do manual validation
 */

import { createLogger } from "./lib/logger";

const logger = createLogger("EnvValidation");

export interface ConvexEnv {
	// Required
	APP_URL: string;

	// Optional - Configuration
	CONVEX_SITE_URL?: string;

	// Optional - Metadata
	DEPLOYMENT?: string;
	APP_VERSION?: string;

	// Optional - Environment
	NODE_ENV?: "development" | "production" | "test";
}

/**
 * Validates required environment variables for Convex
 */
export function validateConvexEnv(): ConvexEnv {
	const errors: string[] = [];
	const warnings: string[] = [];
	const isProd = process.env.NODE_ENV === "production";

	// Apply development defaults only in non-production environments
	// Handle empty strings explicitly - they should trigger defaults too
	const appUrl = (process.env.APP_URL?.trim() || (!isProd ? "http://localhost:3000" : undefined));

	// Check required variables
	if (!appUrl) {
		if (isProd) {
			errors.push("APP_URL is required");
		} else {
			warnings.push("APP_URL not set, using default: http://localhost:3000");
		}
	} else {
		try {
			new URL(appUrl);
		} catch {
			if (isProd) {
				errors.push("APP_URL must be a valid URL");
			} else {
				warnings.push("APP_URL is not a valid URL, using default");
			}
		}
	}

	// Print warnings
	if (warnings.length > 0 && !isProd) {
		logger.warn("Convex environment warnings detected", {
			warningCount: warnings.length,
			warnings
		});
	}

	// Only throw errors in production or if critical errors exist
	if (errors.length > 0) {
		logger.error("Invalid environment variables for Convex", new Error("Convex environment validation failed"), {
			errorCount: errors.length,
			errors
		});
		throw new Error("Convex environment validation failed");
	}

	return {
		APP_URL: appUrl || "http://localhost:3000",
		CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
		DEPLOYMENT: process.env.DEPLOYMENT,
		APP_VERSION: process.env.APP_VERSION,
		NODE_ENV: process.env.NODE_ENV as "development" | "production" | "test" | undefined,
	};
}

/**
 * Get a required environment variable or throw
 */
export function requireEnv(key: string): string {
	const value = process.env[key]?.trim();
	if (!value) {
		throw new Error(`Environment variable ${key} is required but not set`);
	}
	return value;
}

/**
 * Get an optional environment variable with default
 */
export function getEnv(key: string, defaultValue: string): string {
	const value = process.env[key];
	// Handle empty strings properly - return default if undefined or empty
	return value !== undefined && value !== "" ? value : defaultValue;
}

/**
 * Check if we're in production
 */
export function isProduction(): boolean {
	return process.env.NODE_ENV === "production";
}
