/**
 * Copy text to clipboard using the Clipboard API.
 * Returns true on success, false on failure.
 */
export async function copyMessageText(text: string): Promise<boolean> {
	try {
		if (typeof window === "undefined") return false;
		if (typeof navigator?.clipboard?.writeText !== "function") return false;
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
