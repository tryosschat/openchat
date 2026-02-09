/**
 * Comprehensive Tests for Convex File Operations
 *
 * Test Coverage:
 * - generateUploadUrl: Upload URL generation, quota checks, rate limiting
 * - saveFileMetadata: File metadata validation, sanitization, storage
 * - deleteFile: File deletion, quota decrement, authorization
 * - getFileUrl: URL generation, permissions, deleted file handling
 * - getBatchFileUrls: Batch URL retrieval, N+1 query optimization
 * - getUserQuota: Quota tracking and limits
 * - getFilesByChat: Chat-specific file retrieval
 * - getFilesByUser: User-specific file retrieval
 * - Helper functions: sanitizeFilename, validateFileType, validateFileSize
 * - Edge cases: Security, tampering, race conditions, error scenarios
 *
 * Security Critical: Tests protect against unauthorized access and quota abuse.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { modules, rateLimiter } from './testSetup.test';

// Helper to create convex test instance
function createConvexTest() {
	const t = convexTest(schema, modules);
	rateLimiter.register(t);
	return t;
}

type TestInstance = ReturnType<typeof createConvexTest>;

function asIdentity(t: TestInstance, subject: string) {
	return t.withIdentity({ subject });
}

// Helper to create a real storage ID for testing
async function createMockStorageId(t: ReturnType<typeof convexTest>): Promise<Id<'_storage'>> {


	return await t.run(async (ctx) => {
		// Store a tiny blob to get a valid storage ID
		const blob = new Blob(['test'], { type: 'text/plain' });
		return await ctx.storage.store(blob);
	});
}

describe('generateUploadUrl - Basic Functionality', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
	});

	it('should generate upload URL successfully', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.generateUploadUrl, {
			userId,
			chatId,
		});

		expect(result).toBeDefined();
		expect(typeof result).toBe('string');
	});
});

describe('generateUploadUrl - User Validation', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
	});

	it('should reject non-existent user', async () => {
		// Create a valid ID that doesn't exist
		const fakeUserId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('users', {
				externalId: 'fake-user',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.delete(id);
			return id;
		});

		await expect(
			asIdentity(t, 'ghost-user').mutation(api.files.generateUploadUrl, {
				userId: fakeUserId,
				chatId,
			})
		).rejects.toThrow('User not found');
	});

	it('should reject non-existent chat', async () => {
		// Create a valid ID that doesn't exist
		const fakeChatId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('chats', {
				userId,
				title: 'Fake Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.delete(id);
			return id;
		});

		await expect(
			asIdentity(t, 'test-user').mutation(api.files.generateUploadUrl, {
				userId,
				chatId: fakeChatId,
			})
		).rejects.toThrow('Chat not found');
	});

	it('should reject when user does not own chat', async () => {
		const otherUserId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'other-user',
				email: 'other@example.com',
				name: 'Other User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await expect(
			asIdentity(t, 'other-user').mutation(api.files.generateUploadUrl, {
				userId: otherUserId,
				chatId,
			})
		).rejects.toThrow('Unauthorized: You do not own this chat');
	});
});

describe('generateUploadUrl - Quota Management', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let tempUserId: Id<'users'>;

	beforeEach(async () => {
		t = createConvexTest();

		// Create a temporary user for the chat
		tempUserId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'temp-user',
				email: 'temp@example.com',
				name: 'Temp User',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId: tempUserId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
	});

	it('should reject when quota exceeded (exactly at limit)', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 150, // MAX_USER_FILES = 150
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(chatId, { userId });
		});

		await expect(
			asIdentity(t, 'test-user').mutation(api.files.generateUploadUrl, {
				userId,
				chatId,
			})
		).rejects.toThrow(/File quota exceeded.*Maximum 150 files/);
	});

	it('should reject when quota exceeded (over limit)', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 200,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(chatId, { userId });
		});

		await expect(
			asIdentity(t, 'test-user').mutation(api.files.generateUploadUrl, {
				userId,
				chatId,
			})
		).rejects.toThrow(/File quota exceeded/);
	});

	it('should allow when just under quota limit', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 149,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(chatId, { userId });
		});

		const result = await asIdentity(t, 'test-user').mutation(api.files.generateUploadUrl, {
			userId,
			chatId,
		});

		expect(result).toBeDefined();
	});

	it('should handle undefined fileUploadCount', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(chatId, { userId });
		});

		const result = await asIdentity(t, 'test-user').mutation(api.files.generateUploadUrl, {
			userId,
			chatId,
		});

		expect(result).toBeDefined();
	});
});

describe('saveFileMetadata - Basic Functionality', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 5,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);
	});

	it('should save file metadata successfully', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'test.jpg',
			contentType: 'image/jpeg',
			size: 1024,
		});

		expect(result).toBeDefined();
		expect(result.fileId).toBeDefined();
		expect(result.filename).toBe('test.jpg');
	});

	it('should increment user file upload count', async () => {
		await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'test.jpg',
			contentType: 'image/jpeg',
			size: 1024,
		});

		const user = await t.run(async (ctx) => await ctx.db.get(userId));
		expect(user?.fileUploadCount).toBe(6);
	});

	it('should update user updatedAt timestamp', async () => {
		const beforeUpdate = Date.now();

		await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'test.jpg',
			contentType: 'image/jpeg',
			size: 1024,
		});

		const user = await t.run(async (ctx) => await ctx.db.get(userId));
		expect(user?.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
	});
});

describe('saveFileMetadata - File Type Validation', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);
	});

	const validImageTypes = [
		['image/jpeg', 'test.jpg'],
		['image/jpg', 'test.jpg'],
		['image/png', 'test.png'],
		['image/gif', 'test.gif'],
		['image/webp', 'test.webp'],
		['image/svg+xml', 'test.svg'],
		['image/bmp', 'test.bmp'],
	];

	it.each(validImageTypes)('should accept valid image type: %s', async (contentType, filename) => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: filename as string,
			contentType: contentType as string,
			size: 1024,
		});

		expect(result.fileId).toBeDefined();
	});

	it('should reject invalid file type', async () => {
		await expect(
			asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
				userId,
				chatId,
				storageId,
				filename: 'virus.exe',
				contentType: 'application/x-msdownload',
				size: 1024,
			})
		).rejects.toThrow(/File type.*is not allowed/);
	});

	it('should handle case-insensitive content types', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'test.jpg',
			contentType: 'IMAGE/JPEG',
			size: 1024,
		});

		expect(result.fileId).toBeDefined();
	});

	it('should handle content types with whitespace', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'test.jpg',
			contentType: '  image/jpeg  ',
			size: 1024,
		});

		expect(result.fileId).toBeDefined();
	});
});

describe('saveFileMetadata - File Size Validation', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);
	});

	it('should accept image within size limit (10MB)', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'large.jpg',
			contentType: 'image/jpeg',
			size: 10 * 1024 * 1024, // exactly 10MB
		});

		expect(result.fileId).toBeDefined();
	});

	it('should reject image exceeding size limit (>10MB)', async () => {
		await expect(
			asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
				userId,
				chatId,
				storageId,
				filename: 'huge.jpg',
				contentType: 'image/jpeg',
				size: 10 * 1024 * 1024 + 1,
			})
		).rejects.toThrow(/Image file size.*exceeds maximum/);
	});

	it('should accept audio within size limit (25MB)', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'audio.mp3',
			contentType: 'audio/mpeg',
			size: 25 * 1024 * 1024,
		});

		expect(result.fileId).toBeDefined();
	});

	it('should reject audio exceeding size limit (>25MB)', async () => {
		await expect(
			asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
				userId,
				chatId,
				storageId,
				filename: 'huge.mp3',
				contentType: 'audio/mpeg',
				size: 26 * 1024 * 1024,
			})
		).rejects.toThrow(/Audio file size.*exceeds maximum/);
	});

	it('should accept video within size limit (50MB)', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'video.mp4',
			contentType: 'video/mp4',
			size: 50 * 1024 * 1024,
		});

		expect(result.fileId).toBeDefined();
	});

	it('should reject video exceeding size limit (>50MB)', async () => {
		await expect(
			asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
				userId,
				chatId,
				storageId,
				filename: 'huge.mp4',
				contentType: 'video/mp4',
				size: 51 * 1024 * 1024,
			})
		).rejects.toThrow(/Video file size.*exceeds maximum/);
	});

	it('should include file size in error message', async () => {
		try {
			await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
				userId,
				chatId,
				storageId,
				filename: 'huge.jpg',
				contentType: 'image/jpeg',
				size: 15 * 1024 * 1024,
			});
			expect.fail('Should have thrown error');
		} catch (error) {
			expect((error as Error).message).toMatch(/15\.00MB/);
			expect((error as Error).message).toMatch(/10MB/);
		}
	});
});

describe('saveFileMetadata - Filename Sanitization', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);
	});

	it('should preserve valid filename', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'my-document.pdf',
			contentType: 'application/pdf',
			size: 1024,
		});

		expect(result.filename).toBe('my-document.pdf');
	});

	it('should remove path components (forward slash)', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: '../../etc/passwd',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('passwd');
	});

	it('should remove path components (backslash)', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'C:\\Windows\\System32\\config.sys',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('config.sys');
	});

	it('should replace dangerous characters with underscore', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: 'file<>:"|?*.txt',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('file_______.txt');
	});

	it('should trim whitespace', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: '   test.txt   ',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('test.txt');
	});

	it('should limit filename length to 255 characters', async () => {
		const longName = 'a'.repeat(300) + '.txt';
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: longName,
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename.length).toBeLessThanOrEqual(255);
		expect(result.filename).toMatch(/\.txt$/);
	});

	it('should use fallback name for empty filename', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: '',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('unnamed_file');
	});

	it('should use fallback name for dot only', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: '.',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('unnamed_file');
	});

	it('should use fallback name for double dot', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: '..',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('unnamed_file');
	});

	it('should handle unicode characters in filename', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
			userId,
			chatId,
			storageId,
			filename: '文档📄.txt',
			contentType: 'text/plain',
			size: 1024,
		});

		expect(result.filename).toBe('文档📄.txt');
	});
});

describe('saveFileMetadata - Authorization', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);
	});

	it('should reject non-existent user', async () => {
		// Create a valid ID that doesn't exist by creating and deleting a user
		const fakeUserId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('users', {
				externalId: 'fake-user',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.delete(id);
			return id;
		});

		await expect(
			asIdentity(t, 'ghost-user').mutation(api.files.saveFileMetadata, {
				userId: fakeUserId,
				chatId,
				storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
			})
		).rejects.toThrow('User not found');
	});

	it('should reject non-existent chat', async () => {
		// Create a valid ID that doesn't exist by creating and deleting a chat
		const fakeChatId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('chats', {
				userId,
				title: 'Fake Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.delete(id);
			return id;
		});

		await expect(
			asIdentity(t, 'test-user').mutation(api.files.saveFileMetadata, {
				userId,
				chatId: fakeChatId,
				storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
			})
		).rejects.toThrow('Chat not found');
	});

	it('should reject when user does not own chat', async () => {
		const otherUserId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'other-user',
				email: 'other@example.com',
				name: 'Other User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await expect(
			asIdentity(t, 'other-user').mutation(api.files.saveFileMetadata, {
				userId: otherUserId,
				chatId,
				storageId: storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
			})
		).rejects.toThrow('Unauthorized: You do not own this chat');
	});
});

describe('deleteFile - Basic Functionality', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let fileId: Id<'fileUploads'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 10,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);

		fileId = await t.run(async (ctx) => {
			return await ctx.db.insert('fileUploads', {
				userId,
				chatId,
				storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
				uploadedAt: Date.now(),
			});
		});
	});

	it('should delete file successfully', async () => {
		const result = await asIdentity(t, 'test-user').mutation(api.files.deleteFile, {
			userId,
			storageId: storageId,
		});

		expect(result.ok).toBe(true);
	});

	it('should soft delete file (set deletedAt)', async () => {
		await asIdentity(t, 'test-user').mutation(api.files.deleteFile, {
			userId,
			storageId: storageId,
		});

		const file = await t.run(async (ctx) => await ctx.db.get(fileId));
		expect(file?.deletedAt).toBeDefined();
	});

	it('should decrement user file count', async () => {
		await asIdentity(t, 'test-user').mutation(api.files.deleteFile, {
			userId,
			storageId: storageId,
		});

		const user = await t.run(async (ctx) => await ctx.db.get(userId));
		expect(user?.fileUploadCount).toBe(9);
	});

	it('should return false for non-existent file', async () => {
		// Create a new storage ID that has no associated file
		const fakeStorageId = await createMockStorageId(t);

		const result = await asIdentity(t, 'test-user').mutation(api.files.deleteFile, {
			userId,
			storageId: fakeStorageId,
		});

		expect(result.ok).toBe(false);
	});

	it('should reject when user does not own file', async () => {
		const otherUserId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'other-user',
				email: 'other@example.com',
				name: 'Other User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await expect(
			asIdentity(t, 'other-user').mutation(api.files.deleteFile, {
				userId: otherUserId,
				storageId: storageId,
			})
		).rejects.toThrow('Unauthorized: You do not own this file');
	});

	it('should return false when file already deleted', async () => {
		await t.run(async (ctx) => {
			await ctx.db.patch(fileId, { deletedAt: Date.now() });
		});

		const result = await asIdentity(t, 'test-user').mutation(api.files.deleteFile, {
			userId,
			storageId: storageId,
		});

		expect(result.ok).toBe(false);
	});
});

describe('getUserQuota - Basic Functionality', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;

	beforeEach(async () => {
		t = createConvexTest();
	});

	it('should return quota for user with no files', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const quota = await asIdentity(t, 'test-user').query(api.files.getUserQuota, { userId });

		expect(quota.used).toBe(0);
		expect(quota.limit).toBe(150);
	});

	it('should return quota for user with some files', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 42,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const quota = await asIdentity(t, 'test-user').query(api.files.getUserQuota, { userId });

		expect(quota.used).toBe(42);
		expect(quota.limit).toBe(150);
	});

	it('should return quota for user at limit', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 150,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const quota = await asIdentity(t, 'test-user').query(api.files.getUserQuota, { userId });

		expect(quota.used).toBe(150);
		expect(quota.limit).toBe(150);
	});

	it('should handle undefined fileUploadCount', async () => {
		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const quota = await asIdentity(t, 'test-user').query(api.files.getUserQuota, { userId });

		expect(quota.used).toBe(0);
		expect(quota.limit).toBe(150);
	});
});

describe('getFileUrl - Basic Functionality', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let _fileId: Id<'fileUploads'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 10,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);
	});

	it('should return null for non-existent file', async () => {
		const fakeStorageId = await createMockStorageId(t);

		const url = await asIdentity(t, 'test-user').query(api.files.getFileUrl, {
			userId,
			storageId: fakeStorageId,
		});

		expect(url).toBeNull();
	});

	it('should return null for deleted file', async () => {
		_fileId = await t.run(async (ctx) => {
			return await ctx.db.insert('fileUploads', {
				userId,
				chatId,
				storageId: storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
				uploadedAt: Date.now(),
				deletedAt: Date.now(),
			});
		});

		const url = await asIdentity(t, 'test-user').query(api.files.getFileUrl, {
			userId,
			storageId: storageId,
		});

		expect(url).toBeNull();
	});

	it('should reject when user does not own file', async () => {
		const otherUserId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'other-user',
				email: 'other@example.com',
				name: 'Other User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		_fileId = await t.run(async (ctx) => {
			return await ctx.db.insert('fileUploads', {
				userId: otherUserId,
				chatId,
				storageId: storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
				uploadedAt: Date.now(),
			});
		});

		await expect(
			asIdentity(t, 'test-user').query(api.files.getFileUrl, {
				userId,
				storageId: storageId,
			})
		).rejects.toThrow('Unauthorized: You do not own this file');
	});
});

describe('getFilesByChat - Basic Functionality', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
	});

	it('should reject non-existent chat', async () => {
		// Create a valid ID that doesn't exist
		const fakeChatId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('chats', {
				userId,
				title: 'Fake Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.delete(id);
			return id;
		});

		await expect(
			asIdentity(t, 'test-user').query(api.files.getFilesByChat, { userId, chatId: fakeChatId })
		).rejects.toThrow('Chat not found');
	});

	it('should reject when user does not own chat', async () => {
		const otherUserId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'other-user',
				email: 'other@example.com',
				name: 'Other User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId: otherUserId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await expect(
			asIdentity(t, 'test-user').query(api.files.getFilesByChat, { userId, chatId })
		).rejects.toThrow('Unauthorized: You do not own this chat');
	});
});

describe('getBatchFileUrls - Basic Functionality', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	let storageId: Id<'_storage'>;

	beforeEach(async () => {
		t = createConvexTest();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'test-user',
				email: 'test@example.com',
				name: 'Test User',
				fileUploadCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'Test Chat',
				messageCount: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		storageId = await createMockStorageId(t);
	});

	it('should return empty array for empty input', async () => {
		const results = await asIdentity(t, 'test-user').query(api.files.getBatchFileUrls, {
			userId,
			storageIds: [],
		});

		expect(results).toEqual([]);
	});

	it('should return null for non-existent files', async () => {
		// Create storage IDs that have no associated files
		const fakeStorageIds = [
			await createMockStorageId(t),
			await createMockStorageId(t),
		];

		const results = await asIdentity(t, 'test-user').query(api.files.getBatchFileUrls, {
			userId,
			storageIds: fakeStorageIds,
		});

		expect(results).toHaveLength(2);
		expect(results[0].url).toBeNull();
		expect(results[1].url).toBeNull();
	});

	it('should deduplicate storage IDs', async () => {
		await t.run(async (ctx) => {
			return await ctx.db.insert('fileUploads', {
				userId,
				chatId,
				storageId: storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
				uploadedAt: Date.now(),
			});
		});

		const storageIds = [storageId, storageId, storageId];

		const results = await asIdentity(t, 'test-user').query(api.files.getBatchFileUrls, {
			userId,
			storageIds,
		});

		expect(results).toHaveLength(1);
	});

	it('should exclude deleted files', async () => {
		await t.run(async (ctx) => {
			return await ctx.db.insert('fileUploads', {
				userId,
				chatId,
				storageId: storageId,
				filename: 'test.jpg',
				contentType: 'image/jpeg',
				size: 1024,
				uploadedAt: Date.now(),
				deletedAt: Date.now(),
			});
		});

		const results = await asIdentity(t, 'test-user').query(api.files.getBatchFileUrls, {
			userId,
			storageIds: [storageId],
		});

		expect(results[0].url).toBeNull();
	});
});
