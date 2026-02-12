/**
 * Shared text sanitization utilities for Convex functions
 */

/**
 * Removes control characters from a string, preserving newlines and tabs
 */
function removeControlCharacters(str: string): string {
	// Remove control characters except newlines (\n, \r) and tabs (\t)
	// Matches: \x00-\x08, \x0B (vertical tab), \x0C (form feed), \x0E-\x1F, \x7F (DEL)
	// oxlint-disable-next-line no-control-regex
	return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Sanitizes a title string (for chats, etc.)
 * - Removes control characters
 * - Converts newlines and tabs to single spaces
 * - Collapses multiple spaces into one
 * - Truncates to max length
 *
 * @param title - The title to sanitize
 * @param maxLength - Maximum allowed length (default: 200)
 * @param defaultValue - Default value if empty (default: "New Chat")
 * @returns Sanitized title
 */
export function sanitizeTitle(
	title: string,
	maxLength = 200,
	defaultValue = "New Chat"
): string {
	// Trim whitespace
	let sanitized = title.trim();

	// Remove control characters
	sanitized = removeControlCharacters(sanitized);

	// Convert newlines and tabs to single spaces
	sanitized = sanitized.replace(/[\n\r\t]+/g, " ");

	// Collapse multiple spaces into one
	sanitized = sanitized.replace(/\s+/g, " ");

	sanitized = sanitized.replace(/<[^>]*>/g, "").trim();

	// Truncate to maximum length
	if (sanitized.length > maxLength) {
		sanitized = sanitized.slice(0, maxLength);
	}

	// If empty after sanitization, provide default
	if (sanitized.length === 0) {
		return defaultValue;
	}

	return sanitized;
}

/**
 * Sanitizes text content (for template content, descriptions, etc.)
 * - Removes control characters (preserves newlines and tabs)
 * - Truncates to max length
 *
 * @param text - The text to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized text
 */
export function sanitizeText(text: string, maxLength: number): string {
	let sanitized = text.trim();

	// Remove control characters (except newlines and tabs)
	sanitized = removeControlCharacters(sanitized);

	// Truncate to maximum length
	if (sanitized.length > maxLength) {
		sanitized = sanitized.slice(0, maxLength);
	}

	return sanitized;
}

/**
 * Sanitizes a filename for safe storage
 * - Removes path components
 * - Removes control characters
 * - Replaces dangerous filesystem characters with underscores
 * - Preserves file extension when truncating
 *
 * @param filename - The filename to sanitize
 * @param maxLength - Maximum allowed length (default: 255)
 * @returns Sanitized filename, or "unnamed_file" if empty
 */
export function sanitizeFilename(filename: string, maxLength = 255): string {
	// Remove any path components (handle both forward and backslashes)
	let sanitized = filename.replace(/^.*[/\\]/, "");

	// Remove dangerous characters (null bytes, control chars, extended control chars)
	// oxlint-disable-next-line no-control-regex
	sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

	// Remove or replace potentially dangerous filesystem characters
	sanitized = sanitized.replace(/[<>:"|?*]/g, "_");

	// Trim whitespace
	sanitized = sanitized.trim();

	// Limit length, preserving file extension if possible
	if (sanitized.length > maxLength) {
		const lastDot = sanitized.lastIndexOf(".");
		if (lastDot > 0 && lastDot > maxLength - 10) {
			// Extension is near the end, preserve it
			const ext = sanitized.substring(lastDot);
			const name = sanitized.substring(0, maxLength - ext.length);
			sanitized = name + ext;
		} else {
			sanitized = sanitized.substring(0, maxLength);
		}
	}

	// Ensure we have a valid filename
	if (!sanitized || sanitized === "." || sanitized === "..") {
		sanitized = "unnamed_file";
	}

	return sanitized;
}
