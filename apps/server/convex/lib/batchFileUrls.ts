import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Batch fetches file URLs for multiple storage IDs.
 * This is a utility function to avoid N+1 queries when loading file URLs.
 *
 * @param ctx - The query context
 * @param storageIds - Array of storage IDs to fetch URLs for
 * @returns Map of storage ID to URL (or null if file not found/deleted)
 */
export async function getBatchFileUrls(
	ctx: QueryCtx,
	storageIds: Id<"_storage">[]
): Promise<Map<Id<"_storage">, string | null>> {
	const urlMap = new Map<Id<"_storage">, string | null>();

	// If no storage IDs provided, return empty map
	if (storageIds.length === 0) {
		return urlMap;
	}

	// Remove duplicates by converting to Set and back to Array
	const uniqueStorageIds = Array.from(new Set(storageIds));

	// Fetch all URLs in parallel using Promise.all
	// This is much faster than sequential fetches
	const urlPromises = uniqueStorageIds.map(async (storageId) => {
		try {
			const url = await ctx.storage.getUrl(storageId);
			return { storageId, url };
		} catch {
			// If storage.getUrl fails (e.g., file deleted), return null
			return { storageId, url: null };
		}
	});

	const results = await Promise.all(urlPromises);

	// Build the map from results
	for (const { storageId, url } of results) {
		urlMap.set(storageId, url);
	}

	return urlMap;
}
