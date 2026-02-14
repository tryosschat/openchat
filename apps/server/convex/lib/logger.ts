/**
 * Production-safe structured logging utilities for Convex functions
 *
 * This module provides a comprehensive logging system adapted for the Convex environment:
 * - Console logs in Convex are automatically captured and viewable in the dashboard
 * - Supports structured logging with context objects
 * - Auto-hashes PII (user IDs, emails) before logging
 * - Provides environment-aware behavior
 * - Optimized for Convex's logging and monitoring
 *
 * @example
 * ```typescript
 * import { logger, createLogger } from './lib/logger';
 *
 * // In a Convex mutation
 * export const createMessage = mutation({
 *   handler: async (ctx, args) => {
 *     const logger = createLogger('createMessage');
 *     logger.info('Creating message', { chatId: args.chatId });
 *
 *     try {
 *       const messageId = await ctx.db.insert('messages', args);
 *       logger.info('Message created', { messageId });
 *       return messageId;
 *     } catch (error) {
 *       logger.error('Failed to create message', error, { chatId: args.chatId });
 *       throw error;
 *     }
 *   }
 * });
 * ```
 */

/**
 * Log context object - structured data to accompany log messages
 */
export interface LogContext {
	[key: string]: unknown;
}

/**
 * Logger interface - standard logging methods
 */
export interface Logger {
	/**
	 * Debug-level logs
	 * Use for detailed diagnostic information
	 */
	debug(message: string, context?: LogContext): Promise<void>;

	/**
	 * Info-level logs
	 * Use for general informational messages
	 */
	info(message: string, context?: LogContext): Promise<void>;

	/**
	 * Warning-level logs
	 * Use for potentially problematic situations
	 */
	warn(message: string, context?: LogContext): Promise<void>;

	/**
	 * Error-level logs
	 * Use for error conditions and exceptions
	 */
	error(message: string, error: Error | unknown, context?: LogContext): Promise<void>;
}

/**
 * PII (Personally Identifiable Information) fields to hash
 * These fields will be automatically hashed when present in context
 */
const PII_FIELDS = new Set([
	"userId",
	"user_id",
	"email",
	"emailAddress",
	"email_address",
	"phoneNumber",
	"phone_number",
	"ipAddress",
	"ip_address",
	"sessionId",
	"session_id",
]);

/**
 * Cryptographic hash for PII redaction using SHA-256 via Web Crypto API.
 * Returns a truncated hex digest that is irreversible for practical purposes.
 */
async function hashValue(value: string): Promise<string> {
	try {
		const encoded = new TextEncoder().encode(value);
		const buffer = encoded.buffer.slice(
			encoded.byteOffset,
			encoded.byteOffset + encoded.byteLength,
		) as ArrayBuffer;
		const digest = await crypto.subtle.digest("SHA-256", buffer);
		const hashArray = new Uint8Array(digest);
		let hex = "";
		for (const byte of hashArray) {
			hex += byte.toString(16).padStart(2, "0");
		}
		// Return first 16 hex chars (64 bits) — sufficient for log deduplication
		// while remaining irreversible for PII values.
		return hex.substring(0, 16);
	} catch {
		return "hash_error";
	}
}

/**
 * Sanitize context object by hashing PII fields
 * Recursively processes nested objects
 */
async function sanitizeContext(context: LogContext): Promise<LogContext> {
	const sanitized: LogContext = {};

	for (const [key, value] of Object.entries(context)) {
		// Hash PII fields
		if (PII_FIELDS.has(key) && typeof value === "string") {
			sanitized[`${key}Hash`] = await hashValue(value);
			continue;
		}

		// Recursively sanitize nested objects
		if (value && typeof value === "object" && !Array.isArray(value)) {
			sanitized[key] = await sanitizeContext(value as LogContext);
			continue;
		}

		// Keep all other values as-is
		sanitized[key] = value;
	}

	return sanitized;
}

/**
 * Format log message with timestamp, level, and context
 * Convex automatically adds source location, so we don't need to extract it
 */
function formatLogMessage(
	level: string,
	message: string,
	_context?: LogContext,
): string {
	const timestamp = new Date().toISOString();
	return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

/**
 * Format context for logging
 * Always use single-line JSON for Convex dashboard compatibility
 */
function formatContext(context: LogContext): string {
	return JSON.stringify(context);
}

/**
 * Log debug messages
 * Use for detailed diagnostic information that helps during development
 * In Convex, all logs are visible in the dashboard regardless of environment
 */
export async function logDebug(message: string, context?: LogContext): Promise<void> {
	const formattedMessage = formatLogMessage("debug", message, context);

	if (context) {
		const sanitized = await sanitizeContext(context);
		console.debug(formattedMessage, formatContext(sanitized));
	} else {
		console.debug(formattedMessage);
	}
}

/**
 * Log information messages
 * Use for general informational messages about application flow
 */
export async function logInfo(message: string, context?: LogContext): Promise<void> {
	const formattedMessage = formatLogMessage("info", message, context);

	if (context) {
		const sanitized = await sanitizeContext(context);
		console.log(formattedMessage, formatContext(sanitized));
	} else {
		console.log(formattedMessage);
	}
}

/**
 * Log warning messages
 * Use for potentially problematic situations that aren't errors
 */
export async function logWarn(message: string, context?: LogContext): Promise<void> {
	const formattedMessage = formatLogMessage("warn", message, context);

	if (context) {
		const sanitized = await sanitizeContext(context);
		console.warn(formattedMessage, formatContext(sanitized));
	} else {
		console.warn(formattedMessage);
	}
}

/**
 * Log error messages
 * Use for error conditions and exceptions
 *
 * @param message - Error message describing what went wrong
 * @param error - The error object or unknown value
 * @param context - Additional context about the error
 */
export async function logError(
	message: string,
	error?: Error | unknown,
	context?: LogContext
): Promise<void> {
	const formattedMessage = formatLogMessage("error", message, context);

	// Build error context
	const errorContext: LogContext = {
		...context,
		errorMessage: error instanceof Error ? error.message : String(error),
		errorName: error instanceof Error ? error.name : "UnknownError",
	};

	// Add stack trace if available
	if (error instanceof Error && error.stack) {
		errorContext.stack = error.stack;
	}

	const sanitized = await sanitizeContext(errorContext);
	console.error(formattedMessage, formatContext(sanitized));
}

/**
 * Create a logger with a specific context/prefix
 * The context will be prepended to all log messages
 *
 * @param context - Context identifier (e.g., "createChat", "deleteFile")
 * @returns Logger instance with context
 *
 * @example
 * ```typescript
 * const logger = createLogger('createChat');
 * logger.info('Processing request', { userId: 'user_123' });
 * // Output: [2024-01-15T10:30:00.000Z] [INFO] [createChat] Processing request
 * ```
 */
export function createLogger(context: string): Logger {
	return {
		debug: (message: string, logContext?: LogContext) =>
			logDebug(`[${context}] ${message}`, logContext),

		info: (message: string, logContext?: LogContext) =>
			logInfo(`[${context}] ${message}`, logContext),

		warn: (message: string, logContext?: LogContext) =>
			logWarn(`[${context}] ${message}`, logContext),

		error: (message: string, error?: Error | unknown, logContext?: LogContext) =>
			logError(`[${context}] ${message}`, error, logContext),
	};
}

/**
 * Default logger instance
 * Use this for general Convex function logging
 */
export const logger: Logger = {
	debug: logDebug,
	info: logInfo,
	warn: logWarn,
	error: logError,
};
