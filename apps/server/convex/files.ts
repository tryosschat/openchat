import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { createLogger } from "./lib/logger";
import { rateLimiter } from "./lib/rateLimiter";
import { throwRateLimitError } from "./lib/rateLimitUtils";
import { sanitizeFilename } from "./lib/sanitize";
import { requireAuthUserId } from "./lib/auth";

// Constants & Configuration
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes (default)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_USER_FILES = 150; // Quota per user

const ALLOWED_IMAGE_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"image/bmp",
] as const;

const ALLOWED_DOCUMENT_TYPES = [
	"application/pdf",
	"text/plain",
	"text/markdown",
] as const;

const ALLOWED_AUDIO_TYPES = [
	"audio/mpeg",
	"audio/mp3",
	"audio/wav",
	"audio/ogg",
	"audio/m4a",
	"audio/aac",
	"audio/webm",
] as const;

const ALLOWED_VIDEO_TYPES = [
	"video/mp4",
	"video/mpeg",
	"video/quicktime",
	"video/webm",
	"video/x-msvideo",
	"video/x-ms-wmv",
] as const;

const ALLOWED_TYPES = [
	...ALLOWED_IMAGE_TYPES,
	...ALLOWED_DOCUMENT_TYPES,
	...ALLOWED_AUDIO_TYPES,
	...ALLOWED_VIDEO_TYPES,
] as const;

/**
 * Validates that the file type is allowed.
 * @param contentType - The MIME type of the file
 * @throws Error if the file type is not allowed
 */
function validateFileType(contentType: string): void {
	const normalizedType = contentType.toLowerCase().trim();

	if (!(ALLOWED_TYPES as readonly string[]).includes(normalizedType)) {
		throw new Error(
			`File type "${contentType}" is not allowed. Allowed types: ${ALLOWED_TYPES.join(", ")}`
		);
	}
}

/**
 * Validates that the file size is within limits based on content type.
 * @param size - The file size in bytes
 * @param contentType - The MIME type of the file
 * @throws Error if the file size exceeds limits
 */
function validateFileSize(size: number, contentType: string): void {
	const normalizedType = contentType.toLowerCase().trim();

	if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(normalizedType)) {
		if (size > MAX_IMAGE_SIZE) {
			throw new Error(
				`Image file size (${(size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`
			);
		}
	} else if (
		(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(normalizedType)
	) {
		if (size > MAX_DOCUMENT_SIZE) {
			throw new Error(
				`Document file size (${(size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${MAX_DOCUMENT_SIZE / (1024 * 1024)}MB`
			);
		}
	} else if (
		(ALLOWED_AUDIO_TYPES as readonly string[]).includes(normalizedType)
	) {
		if (size > MAX_AUDIO_SIZE) {
			throw new Error(
				`Audio file size (${(size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${MAX_AUDIO_SIZE / (1024 * 1024)}MB`
			);
		}
	} else if (
		(ALLOWED_VIDEO_TYPES as readonly string[]).includes(normalizedType)
	) {
		if (size > MAX_VIDEO_SIZE) {
			throw new Error(
				`Video file size (${(size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${MAX_VIDEO_SIZE / (1024 * 1024)}MB`
			);
		}
	} else {
		if (size > MAX_FILE_SIZE) {
			throw new Error(
				`File size (${(size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
			);
		}
	}
}

// Exported Functions

/**
 * Generates a URL for uploading a file to Convex storage.
 * Checks user ownership of chat, quota limits, and rate limits before allowing upload.
 *
 * @param userId - The ID of the user uploading the file
 * @param chatId - The ID of the chat the file will be associated with
 * @returns An upload URL that can be used to upload the file
 * @throws Error if user doesn't own chat, exceeds quota, or hits rate limit
 */
export const generateUploadUrl = mutation({
	args: {
		userId: v.id("users"),
		chatId: v.id("chats"),
	},
	returns: v.string(),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit upload URL generation
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "fileGenerateUploadUrl", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("upload URL requests", retryAfter);
		}

		// PERFORMANCE OPTIMIZATION: Fetch user and chat in parallel to reduce latency
		// This reduces total wait time from T(user) + T(chat) to max(T(user), T(chat))
		const [user, chat] = await Promise.all([
			ctx.db.get(userId),
			ctx.db.get(args.chatId),
		]);

		// Verify user exists
		if (!user) {
			throw new Error("User not found");
		}

		// Verify the chat exists and belongs to the user
		if (!chat) {
			throw new Error("Chat not found");
		}
		if (chat.userId !== userId) {
			throw new Error("Unauthorized: You do not own this chat");
		}

		// Check if user has exceeded their file quota
		const currentFileCount = user.fileUploadCount || 0;
		if (currentFileCount >= MAX_USER_FILES) {
			throw new Error(
				`File quota exceeded. Maximum ${MAX_USER_FILES} files allowed per user.`
			);
		}

		// Generate and return upload URL
		return await ctx.storage.generateUploadUrl();
	},
});

/**
 * Saves metadata for an uploaded file to the database.
 * Validates file size and type, sanitizes filename, and updates user quota.
 *
 * @param userId - The ID of the user who uploaded the file
 * @param chatId - The ID of the chat the file is associated with
 * @param storageId - The storage ID returned after uploading to Convex storage
 * @param filename - The original filename
 * @param contentType - The MIME type of the file
 * @param size - The file size in bytes
 * @returns Object containing the file ID and sanitized filename
 * @throws Error if validation fails
 */
export const saveFileMetadata = mutation({
	args: {
		userId: v.id("users"),
		chatId: v.id("chats"),
		storageId: v.id("_storage"),
		filename: v.string(),
		contentType: v.string(),
		size: v.number(),
	},
	returns: v.object({
		fileId: v.id("fileUploads"),
		filename: v.string(),
		url: v.union(v.string(), v.null()),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit file metadata saves
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "fileSaveMetadata", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("file uploads", retryAfter);
		}

		// Validate file size
		validateFileSize(args.size, args.contentType);

		// Validate file type
		validateFileType(args.contentType);

		// PERFORMANCE OPTIMIZATION: Fetch user and chat in parallel
		// This eliminates duplicate user lookup (was fetched again after file insert)
		const [user, chat] = await Promise.all([
			ctx.db.get(userId),
			ctx.db.get(args.chatId),
		]);

		// Verify user exists
		if (!user) {
			throw new Error("User not found");
		}

		// Verify the chat exists and belongs to the user
		if (!chat) {
			throw new Error("Chat not found");
		}
		if (chat.userId !== userId) {
			throw new Error("Unauthorized: You do not own this chat");
		}

		// Sanitize the filename
		const sanitizedFilename = sanitizeFilename(args.filename);

		// Insert file metadata into database
		const fileId = await ctx.db.insert("fileUploads", {
			userId,
			chatId: args.chatId,
			storageId: args.storageId,
			filename: sanitizedFilename,
			contentType: args.contentType,
			size: args.size,
			uploadedAt: Date.now(),
		});

		// PERFORMANCE OPTIMIZATION: Use the user object we already fetched
		// This avoids a second database lookup for the same user
		await ctx.db.patch(userId, {
			fileUploadCount: (user.fileUploadCount || 0) + 1,
			updatedAt: Date.now(),
		});

		// Get the storage URL immediately
		const url = await ctx.storage.getUrl(args.storageId);

		return {
			fileId,
			filename: sanitizedFilename,
			url,
		};
	},
});

/**
 * Retrieves a temporary URL to access a stored file.
 * Verifies that the user owns the file before providing access.
 *
 * @param storageId - The storage ID of the file
 * @param userId - The ID of the user requesting access
 * @returns A temporary URL to access the file, or null if not found/unauthorized
 */
export const getFileUrl = query({
	args: {
		storageId: v.id("_storage"),
		userId: v.id("users"),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Find the file by storage ID
		const file = await ctx.db
			.query("fileUploads")
			.withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
			.unique();

		// Verify file exists and user owns it
		if (!file) {
			return null;
		}

		if (file.userId !== userId) {
			throw new Error("Unauthorized: You do not own this file");
		}

		// Check if file has been deleted
		if (file.deletedAt) {
			return null;
		}

		// Generate and return the file URL
		return await ctx.storage.getUrl(args.storageId);
	},
});

/**
 * Batch retrieves temporary URLs for multiple stored files.
 * This is more efficient than calling getFileUrl multiple times (N+1 query optimization).
 * Verifies that the user owns all files before providing access.
 *
 * @param storageIds - Array of storage IDs to fetch URLs for
 * @param userId - The ID of the user requesting access
 * @returns Array of objects with storageId and url (or null if not found/unauthorized/deleted)
 */
export const getBatchFileUrls = query({
	args: {
		storageIds: v.array(v.id("_storage")),
		userId: v.id("users"),
	},
	returns: v.array(
		v.object({
			storageId: v.id("_storage"),
			url: v.union(v.string(), v.null()),
		})
	),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// If no storage IDs provided, return empty array
		if (args.storageIds.length === 0) {
			return [];
		}

		// Remove duplicates
		const uniqueStorageIds = Array.from(new Set(args.storageIds));

		// Fetch all file records in parallel
		const filePromises = uniqueStorageIds.map(async (storageId) => {
			const file = await ctx.db
				.query("fileUploads")
				.withIndex("by_storage", (q) => q.eq("storageId", storageId))
				.unique();
			return { storageId, file };
		});

		const fileResults = await Promise.all(filePromises);

		// Filter to only files that exist, belong to user, and aren't deleted
		const validFiles = fileResults.filter(({ file }) => {
			if (!file) return false;
			if (file.userId !== userId) return false;
			if (file.deletedAt) return false;
			return true;
		});

		// Fetch URLs for valid files in parallel
		const urlPromises = validFiles.map(async ({ storageId }) => {
			try {
				const url = await ctx.storage.getUrl(storageId);
				return { storageId, url };
			} catch {
				// If storage.getUrl fails, return null
				return { storageId, url: null };
			}
		});

		const urlResults = await Promise.all(urlPromises);

		// Create a map for quick lookup
		const urlMap = new Map<Id<"_storage">, string | null>();
		for (const { storageId, url } of urlResults) {
			urlMap.set(storageId, url);
		}

		// Return results in the same order as input, with null for unauthorized/deleted files
		return uniqueStorageIds.map((storageId) => ({
			storageId,
			url: urlMap.get(storageId) ?? null,
		}));
	},
});

/**
 * Deletes a file from both the database and storage.
 * Performs a soft delete in the database and hard delete from storage.
 * Decrements the user's file upload count.
 *
 * @param storageId - The storage ID of the file to delete
 * @param userId - The ID of the user requesting deletion
 * @returns Object indicating success or failure
 */
export const deleteFile = mutation({
	args: {
		storageId: v.id("_storage"),
		userId: v.id("users"),
	},
	returns: v.object({ ok: v.boolean() }),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Rate limit file deletions
		const { ok, retryAfter } = await rateLimiter.limit(ctx, "fileDelete", {
			key: userId,
		});

		if (!ok) {
			throwRateLimitError("file deletions", retryAfter);
		}

		// Find the file by storage ID
		const file = await ctx.db
			.query("fileUploads")
			.withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
			.unique();

		if (!file) {
			return { ok: false };
		}

		// Verify ownership
		if (file.userId !== userId) {
			throw new Error("Unauthorized: You do not own this file");
		}

		// Check if already deleted
		if (file.deletedAt) {
			return { ok: false };
		}

		// Soft delete in database
		await ctx.db.patch(file._id, {
			deletedAt: Date.now(),
		});

		// Hard delete from storage
		try {
			await ctx.storage.delete(args.storageId);
		} catch (error) {
			// Log error but don't fail the operation
			// File might already be deleted from storage
			const logger = createLogger("deleteFile");
			logger.error("Failed to delete file from storage", error, {
				storageId: args.storageId,
				fileId: file._id
			});
		}

		// Decrement user's file upload count
		const user = await ctx.db.get(userId);
		if (user && user.fileUploadCount && user.fileUploadCount > 0) {
			await ctx.db.patch(userId, {
				fileUploadCount: user.fileUploadCount - 1,
				updatedAt: Date.now(),
			});
		}

		return { ok: true };
	},
});

/**
 * Retrieves the current file upload quota for a user.
 *
 * @param userId - The ID of the user
 * @returns Object containing used quota and total limit
 */
export const getUserQuota = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.object({
		used: v.number(),
		limit: v.number(),
	}),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		const user = await ctx.db.get(userId);

		return {
			used: user?.fileUploadCount || 0,
			limit: MAX_USER_FILES,
		};
	},
});

/**
 * Retrieves all non-deleted files for a specific chat.
 *
 * @param chatId - The ID of the chat
 * @param userId - The ID of the user (for authorization)
 * @returns Array of file metadata objects
 */
export const getFilesByChat = query({
	args: {
		chatId: v.id("chats"),
		userId: v.id("users"),
	},
	returns: v.array(
		v.object({
			_id: v.id("fileUploads"),
			_creationTime: v.number(),
			storageId: v.id("_storage"),
			filename: v.string(),
			contentType: v.string(),
			size: v.number(),
			uploadedAt: v.number(),
		})
	),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Verify the chat exists and belongs to the user
		const chat = await ctx.db.get(args.chatId);
		if (!chat) {
			throw new Error("Chat not found");
		}
		if (chat.userId !== userId) {
			throw new Error("Unauthorized: You do not own this chat");
		}

		// Query all non-deleted files for this chat
		const files = await ctx.db
			.query("fileUploads")
			.withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
			.filter((q) => q.eq(q.field("deletedAt"), undefined))
			.order("desc")
			.collect();

		return files.map((file) => ({
			_id: file._id,
			_creationTime: file._creationTime,
			storageId: file.storageId,
			filename: file.filename,
			contentType: file.contentType,
			size: file.size,
			uploadedAt: file.uploadedAt,
		}));
	},
});

/**
 * Retrieves all non-deleted files for a specific user.
 *
 * @param userId - The ID of the user
 * @returns Array of file metadata objects with chat information
 */
export const getFilesByUser = query({
	args: {
		userId: v.id("users"),
	},
	returns: v.array(
		v.object({
			_id: v.id("fileUploads"),
			_creationTime: v.number(),
			chatId: v.id("chats"),
			storageId: v.id("_storage"),
			filename: v.string(),
			contentType: v.string(),
			size: v.number(),
			uploadedAt: v.number(),
		})
	),
	handler: async (ctx, args) => {
		const userId = await requireAuthUserId(ctx, args.userId);
		// Query all non-deleted files for this user
		const files = await ctx.db
			.query("fileUploads")
			.withIndex("by_user_not_deleted", (q) =>
				q.eq("userId", userId).eq("deletedAt", undefined)
			)
			.order("desc")
			.collect();

		return files.map((file) => ({
			_id: file._id,
			_creationTime: file._creationTime,
			chatId: file.chatId,
			storageId: file.storageId,
			filename: file.filename,
			contentType: file.contentType,
			size: file.size,
			uploadedAt: file.uploadedAt,
		}));
	},
});
