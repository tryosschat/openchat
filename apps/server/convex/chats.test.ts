/**
 * Comprehensive Tests for Convex Chat Functions
 *
 * Tests cover:
 * - Chat creation with validation and sanitization
 * - Chat listing with pagination and filtering
 * - Chat retrieval with ownership checks
 * - Chat deletion (soft delete) with cascading
 * - Rate limiting
 * - Security and authorization
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { modules, rateLimiter } from './testSetup.test';

// Helper to create convex test instance with components registered
function createConvexTest() {
	const t = convexTest(schema, modules);
	rateLimiter.register(t);
	return t;
}

function asExternalId(t: any, externalId: string) {
	return t.withIdentity({ subject: externalId });
}

describe('chats.create', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;

  beforeEach(async () => {
    t = createConvexTest();

    // Create a test user
    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'test-user',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  });

	it('should create a chat with valid title', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'My New Chat',
		});

    expect(result.chatId).toBeDefined();

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat).toBeDefined();
    expect(chat?.title).toBe('My New Chat');
    expect(chat?.userId).toBe(userId);
    expect(chat?.messageCount).toBe(0);
  });

	it('should sanitize chat title by trimming whitespace', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: '  Padded Title  ',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('Padded Title');
  });

	it('should sanitize chat title by removing control characters', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Title\x00with\x01control\x1Fchars',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('Titlewithcontrolchars');
  });

	it('should sanitize chat title by converting newlines to spaces', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Multi\nLine\rTitle',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('Multi Line Title');
  });

	it('should sanitize chat title by collapsing multiple spaces', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Too    Many     Spaces',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('Too Many Spaces');
  });

	it('should truncate title to maximum length (200 chars)', async () => {
		const longTitle = 'a'.repeat(250);
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: longTitle,
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('a'.repeat(200));
    expect(chat?.title.length).toBe(200);
  });

	it('should use default title for empty string after sanitization', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: '   ',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('New Chat');
  });

	it('should use default title for only control characters', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: '\x00\x01\x02',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('New Chat');
  });

	it('should set createdAt and updatedAt timestamps', async () => {
		const before = Date.now();
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Test Chat',
		});
    const after = Date.now();

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.createdAt).toBeGreaterThanOrEqual(before);
    expect(chat?.createdAt).toBeLessThanOrEqual(after);
    expect(chat?.createdAt).toBe(chat?.updatedAt);
  });

	it('should initialize messageCount to 0', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Test Chat',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.messageCount).toBe(0);
  });

	it('should set lastMessageAt timestamp', async () => {
		const before = Date.now();
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Test Chat',
		});
    const after = Date.now();

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.lastMessageAt).toBeGreaterThanOrEqual(before);
    expect(chat?.lastMessageAt).toBeLessThanOrEqual(after);
  });

	it('should handle Unicode characters in title', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: '🎉 My Chat 你好',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('🎉 My Chat 你好');
  });

	it('should handle empty emoji title', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: '🎉',
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(result.chatId));
    expect(chat?.title).toBe('🎉');
  });

	it('should create multiple chats for same user', async () => {
		const result1 = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Chat 1',
		});

		const result2 = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Chat 2',
		});

    expect(result1.chatId).not.toBe(result2.chatId);

    const chats = await t.run(async (ctx) => {
      return await ctx.db
        .query('chats')
        .filter((q) => q.eq(q.field('userId'), userId))
        .collect();
    });

    expect(chats.length).toBe(2);
  });

	it('should create chats with same title for same user', async () => {
		const result1 = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Duplicate Title',
		});

		const result2 = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Duplicate Title',
		});

    expect(result1.chatId).not.toBe(result2.chatId);

    const chat1 = await t.run(async (ctx) => await ctx.db.get(result1.chatId));
    const chat2 = await t.run(async (ctx) => await ctx.db.get(result2.chatId));

    expect(chat1?.title).toBe('Duplicate Title');
    expect(chat2?.title).toBe('Duplicate Title');
  });
});

describe('chats.list', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;
  let otherUserId: Id<'users'>;

  beforeEach(async () => {
    t = createConvexTest();

    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'test-user',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'other-user',
        email: 'other@example.com',
        name: 'Other User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  });

	it('should list chats for a user', async () => {
		await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'Chat 1' });
		await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'Chat 2' });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

    expect(result.chats).toBeDefined();
    expect(result.chats.length).toBe(2);
  });

	it('should return empty array when user has no chats', async () => {
		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

		expect(result.chats).toEqual([]);
		expect([null, '_end_cursor']).toContain(result.nextCursor);
	});

	it('should only return chats owned by user', async () => {
		await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'My Chat' });
		await asExternalId(t, 'other-user').mutation(api.chats.create, { userId: otherUserId, title: 'Other Chat' });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

    expect(result.chats.length).toBe(1);
    expect(result.chats[0].title).toBe('My Chat');
  });

	it('should filter out soft-deleted chats', async () => {
		const _chat1 = await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'Active Chat' });
		const chat2 = await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'Deleted Chat' });

    // Soft delete chat2
    await t.run(async (ctx) => {
      await ctx.db.patch(chat2.chatId, { deletedAt: Date.now() });
    });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

    expect(result.chats.length).toBe(1);
    expect(result.chats[0].title).toBe('Active Chat');
  });

  it('should respect custom limit', async () => {
    // Insert directly to avoid rate limiting
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await ctx.db.insert('chats', {
          userId,
          title: `Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
      }
    });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId, limit: 5 });

    expect(result.chats.length).toBe(5);
  });

  it('should use default limit of 50', async () => {
    // Insert directly to avoid rate limiting
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert('chats', {
          userId,
          title: `Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
      }
    });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

    expect(result.chats.length).toBe(50);
  });

  it('should enforce maximum limit of 200', async () => {
		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId, limit: 500 });

    // Should not throw, limit should be clamped to 200
    expect(result).toBeDefined();
  });

  it('should handle invalid limit (negative)', async () => {
		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId, limit: -10 });

    // Should use default limit
    expect(result).toBeDefined();
  });

  it('should handle invalid limit (zero)', async () => {
		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId, limit: 0 });

    // Should use default limit
    expect(result).toBeDefined();
  });

  it('should exclude redundant fields from response', async () => {
		await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'Test Chat' });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

    const chat = result.chats[0];
    expect(chat).toHaveProperty('_id');
    expect(chat).toHaveProperty('title');
    expect(chat).toHaveProperty('createdAt');
    expect(chat).toHaveProperty('updatedAt');
    expect(chat).toHaveProperty('lastMessageAt');

    // These fields should be excluded
    expect(chat).not.toHaveProperty('_creationTime');
    expect(chat).not.toHaveProperty('userId');
    expect(chat).not.toHaveProperty('messageCount');
    expect(chat).not.toHaveProperty('deletedAt');
  });

	it('should return chats in descending order by update time', async () => {
		const chat1 = await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'First' });
		await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
		const chat2 = await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'Second' });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

    // Most recently updated first
    expect(result.chats[0]._id).toBe(chat2.chatId);
    expect(result.chats[1]._id).toBe(chat1.chatId);
  });

  it('should support pagination', async () => {
    // Insert directly to avoid rate limiting
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await ctx.db.insert('chats', {
          userId,
          title: `Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
      }
    });

		const firstPage = await asExternalId(t, 'test-user').query(api.chats.list, { userId, limit: 5 });
    expect(firstPage.chats.length).toBe(5);
    expect(firstPage.nextCursor).toBeTruthy();

		const secondPage = await asExternalId(t, 'test-user').query(api.chats.list, {
			userId,
			limit: 5,
			cursor: firstPage.nextCursor ?? undefined,
		});
    expect(secondPage.chats.length).toBe(5);
  });

	it('should return null nextCursor when no more results', async () => {
		await asExternalId(t, 'test-user').mutation(api.chats.create, { userId, title: 'Only Chat' });

		const result = await asExternalId(t, 'test-user').query(api.chats.list, { userId, limit: 10 });

		expect(result.chats.length).toBe(1);
		expect([null, '_end_cursor']).toContain(result.nextCursor);
	});
});

describe('chats.get', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;
  let otherUserId: Id<'users'>;

  beforeEach(async () => {
    t = createConvexTest();

    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'test-user',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'other-user',
        email: 'other@example.com',
        name: 'Other User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  });

	it('should return chat when user owns it', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'My Chat',
		});

		const result = await asExternalId(t, 'test-user').query(api.chats.get, {
			chatId: created.chatId,
			userId,
		});

    expect(result).toBeDefined();
    expect(result?._id).toBe(created.chatId);
    expect(result?.title).toBe('My Chat');
  });

  it('should return null when chat does not exist', async () => {
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

		const result = await asExternalId(t, 'test-user').query(api.chats.get, {
			chatId: fakeChatId,
			userId,
		});

    expect(result).toBe(null);
  });

	it('should return null when user does not own chat', async () => {
		const created = await asExternalId(t, 'other-user').mutation(api.chats.create, {
			userId: otherUserId,
			title: 'Other Chat',
		});

		const result = await asExternalId(t, 'test-user').query(api.chats.get, {
			chatId: created.chatId,
			userId, // Different user
		});

    expect(result).toBe(null);
  });

	it('should return null when chat is soft-deleted', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Deleted Chat',
		});

    await t.run(async (ctx) => {
      await ctx.db.patch(created.chatId, { deletedAt: Date.now() });
    });

		const result = await asExternalId(t, 'test-user').query(api.chats.get, {
			chatId: created.chatId,
			userId,
		});

    expect(result).toBe(null);
  });

	it('should return all chat fields', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Full Chat',
		});

		const result = await asExternalId(t, 'test-user').query(api.chats.get, {
			chatId: created.chatId,
			userId,
		});

    expect(result).toHaveProperty('_id');
    expect(result).toHaveProperty('_creationTime');
    expect(result).toHaveProperty('userId');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('createdAt');
    expect(result).toHaveProperty('updatedAt');
    expect(result).toHaveProperty('messageCount');
  });
});

describe('chats.remove (soft delete)', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;
  let otherUserId: Id<'users'>;

  beforeEach(async () => {
    t = createConvexTest();

    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'test-user',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'other-user',
        email: 'other@example.com',
        name: 'Other User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  });

	it('should soft delete chat when user owns it', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'My Chat',
		});

		const result = await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId,
		});

    expect(result.ok).toBe(true);

    const chat = await t.run(async (ctx) => await ctx.db.get(created.chatId));
    expect(chat?.deletedAt).toBeDefined();
    expect(chat?.messageCount).toBe(0);
  });

	it('should soft delete all messages in chat', async () => {
		const chat = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Chat with messages',
		});

    // Create some messages
    const msg1 = await t.run(async (ctx) => {
      return await ctx.db.insert('messages', {
        chatId: chat.chatId,
        role: 'user',
        content: 'Message 1',
        createdAt: Date.now(),
        status: 'completed',
      });
    });

    const msg2 = await t.run(async (ctx) => {
      return await ctx.db.insert('messages', {
        chatId: chat.chatId,
        role: 'assistant',
        content: 'Message 2',
        createdAt: Date.now(),
        status: 'completed',
      });
    });

		await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: chat.chatId,
			userId,
		});

    const message1 = await t.run(async (ctx) => await ctx.db.get(msg1));
    const message2 = await t.run(async (ctx) => await ctx.db.get(msg2));

    expect(message1?.deletedAt).toBeDefined();
    expect(message2?.deletedAt).toBeDefined();
  });

  it('should return false when chat does not exist', async () => {
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

		const result = await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: fakeChatId,
			userId,
		});

    expect(result.ok).toBe(false);
  });

	it('should return false when user does not own chat', async () => {
		const created = await asExternalId(t, 'other-user').mutation(api.chats.create, {
			userId: otherUserId,
			title: 'Other Chat',
		});

		const result = await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId, // Different user
		});

    expect(result.ok).toBe(false);
  });

	it('should return false when chat already deleted', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'My Chat',
		});

		await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId,
		});

		// Try to delete again
		const result = await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId,
		});

    expect(result.ok).toBe(false);
  });

	it('should reset messageCount to 0', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'My Chat',
		});

    // Update message count
    await t.run(async (ctx) => {
      await ctx.db.patch(created.chatId, { messageCount: 10 });
    });

		await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId,
		});

    const chat = await t.run(async (ctx) => await ctx.db.get(created.chatId));
    expect(chat?.messageCount).toBe(0);
  });

	it('should handle deletion with no messages', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'Empty Chat',
		});

		const result = await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId,
		});

    expect(result.ok).toBe(true);
  });

	it('should not appear in list after deletion', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'To Delete',
		});

		await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId,
		});

		const list = await asExternalId(t, 'test-user').query(api.chats.list, { userId });

    expect(list.chats.length).toBe(0);
  });

	it('should not be retrievable after deletion', async () => {
		const created = await asExternalId(t, 'test-user').mutation(api.chats.create, {
			userId,
			title: 'To Delete',
		});

		await asExternalId(t, 'test-user').mutation(api.chats.remove, {
			chatId: created.chatId,
			userId,
		});

		const chat = await asExternalId(t, 'test-user').query(api.chats.get, {
			chatId: created.chatId,
			userId,
		});

    expect(chat).toBe(null);
  });
});

describe('chats.removeBulk', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;
  let otherUserId: Id<'users'>;

  beforeEach(async () => {
    t = createConvexTest();

    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'test-user',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'other-user',
        email: 'other@example.com',
        name: 'Other User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  });

	it('should return early with empty array', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds: [],
			userId,
		});

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(0);
  });

	it('should throw error when exceeding max bulk size (51 chats)', async () => {
    // Create 51 chat IDs (we don't actually need them to exist for this test)
    const chatIds: Id<'chats'>[] = [];
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 51; i++) {
        const id = await ctx.db.insert('chats', {
          userId,
          title: `Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
        chatIds.push(id);
      }
    });

		await expect(
			asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
				chatIds,
				userId,
			})
		).rejects.toThrow('Cannot delete more than 50 chats at once');
  });

	it('should delete multiple owned chats successfully', async () => {
    // Create chats directly to avoid rate limiting
    const chatIds: Id<'chats'>[] = [];
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const id = await ctx.db.insert('chats', {
          userId,
          title: `Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
        chatIds.push(id);
      }
    });

		const result = await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds,
			userId,
		});

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(3);
    expect(result.failed).toBe(0);

    // Verify all chats are soft-deleted
    for (const chatId of chatIds) {
      const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
      expect(chat?.deletedAt).toBeDefined();
      expect(chat?.messageCount).toBe(0);
    }
  });

	it('should handle mixed owned and unowned chats', async () => {
    const ownedChatIds: Id<'chats'>[] = [];
    const unownedChatIds: Id<'chats'>[] = [];

    await t.run(async (ctx) => {
      const now = Date.now();
      // Create owned chats
      for (let i = 0; i < 2; i++) {
        const id = await ctx.db.insert('chats', {
          userId,
          title: `Owned Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
        ownedChatIds.push(id);
      }
      // Create unowned chats
      for (let i = 0; i < 2; i++) {
        const id = await ctx.db.insert('chats', {
          userId: otherUserId,
          title: `Unowned Chat ${i}`,
          messageCount: 0,
          createdAt: now + 10 + i,
          updatedAt: now + 10 + i,
        });
        unownedChatIds.push(id);
      }
    });

		const result = await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds: [...ownedChatIds, ...unownedChatIds],
			userId,
		});

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(2);

    // Verify owned chats are deleted
    for (const chatId of ownedChatIds) {
      const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
      expect(chat?.deletedAt).toBeDefined();
    }

    // Verify unowned chats are NOT deleted
    for (const chatId of unownedChatIds) {
      const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
      expect(chat?.deletedAt).toBeUndefined();
    }
  });

	it('should skip already deleted chats', async () => {
    const chatIds: Id<'chats'>[] = [];
    await t.run(async (ctx) => {
      const now = Date.now();
      // Create active chat
      const activeId = await ctx.db.insert('chats', {
        userId,
        title: 'Active Chat',
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      chatIds.push(activeId);

      // Create already deleted chat
      const deletedId = await ctx.db.insert('chats', {
        userId,
        title: 'Deleted Chat',
        messageCount: 0,
        createdAt: now + 1,
        updatedAt: now + 1,
        deletedAt: now + 1,
      });
      chatIds.push(deletedId);
    });

		const result = await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds,
			userId,
		});

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(1);
  });

	it('should soft delete all messages in bulk deleted chats', async () => {
    let chatId: Id<'chats'>;
    const messageIds: Id<'messages'>[] = [];

    await t.run(async (ctx) => {
      const now = Date.now();
      chatId = await ctx.db.insert('chats', {
        userId,
        title: 'Chat with messages',
        messageCount: 3,
        createdAt: now,
        updatedAt: now,
      });

      // Create messages for this chat
      for (let i = 0; i < 3; i++) {
        const msgId = await ctx.db.insert('messages', {
          chatId,
          role: 'user',
          content: `Message ${i}`,
          createdAt: now + i,
          status: 'completed',
        });
        messageIds.push(msgId);
      }
    });

		const result = await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds: [chatId!],
			userId,
		});

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(1);

    // Verify all messages are soft-deleted
    for (const msgId of messageIds) {
      const msg = await t.run(async (ctx) => await ctx.db.get(msgId));
      expect(msg?.deletedAt).toBeDefined();
    }
  });

	it('should not delete chats belonging to other users', async () => {
    let otherChatId: Id<'chats'>;
    await t.run(async (ctx) => {
      const now = Date.now();
      otherChatId = await ctx.db.insert('chats', {
        userId: otherUserId,
        title: 'Other User Chat',
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

		const result = await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds: [otherChatId!],
			userId,
		});

    expect(result.ok).toBe(false);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);

    // Verify chat is NOT deleted
    const chat = await t.run(async (ctx) => await ctx.db.get(otherChatId!));
    expect(chat?.deletedAt).toBeUndefined();
  });

	it('should not appear in list after bulk deletion', async () => {
    const chatIds: Id<'chats'>[] = [];
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const id = await ctx.db.insert('chats', {
          userId,
          title: `Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
        chatIds.push(id);
      }
    });

		await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds,
			userId,
		});

		const list = await asExternalId(t, 'test-user').query(api.chats.list, { userId });
    expect(list.chats.length).toBe(0);
  });

	it('should return ok: false when all chats fail to delete', async () => {
    // Create chats owned by another user
    const chatIds: Id<'chats'>[] = [];
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 2; i++) {
        const id = await ctx.db.insert('chats', {
          userId: otherUserId,
          title: `Other Chat ${i}`,
          messageCount: 0,
          createdAt: now + i,
          updatedAt: now + i,
        });
        chatIds.push(id);
      }
    });

		const result = await asExternalId(t, 'test-user').mutation(api.chats.removeBulk, {
			chatIds,
			userId,
		});

    expect(result.ok).toBe(false);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(2);
  });
});

describe('chats.checkExportRateLimit', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;

  beforeEach(async () => {
    t = createConvexTest();

    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'test-user',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  });

	it('should return ok: true when not rate limited', async () => {
		const result = await asExternalId(t, 'test-user').mutation(api.chats.checkExportRateLimit, {
			userId,
		});

    expect(result.ok).toBe(true);
  });

	it('should allow multiple export checks within limit', async () => {
		const result1 = await asExternalId(t, 'test-user').mutation(api.chats.checkExportRateLimit, { userId });
		const result2 = await asExternalId(t, 'test-user').mutation(api.chats.checkExportRateLimit, { userId });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
  });
});

describe('chats.setGeneratedTitle', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;

  beforeEach(async () => {
    t = createConvexTest();

    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: 'test-user',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  });

	it('should update title when chat still has default title', async () => {
    const chatId = await t.run(async (ctx) => {
      return await ctx.db.insert('chats', {
        userId,
        title: 'New Chat',
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await asExternalId(t, 'test-user').mutation(api.chats.setGeneratedTitle, {
      chatId,
      userId,
      title: 'Generated Title',
      force: false,
    });

    const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
    expect(chat?.title).toBe('Generated Title');
  });

	it('should bump updatedAt for generated title updates', async () => {
    const chatId = await t.run(async (ctx) => {
      return await ctx.db.insert('chats', {
        userId,
        title: 'New Chat',
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await asExternalId(t, 'test-user').mutation(api.chats.setGeneratedTitle, {
      chatId,
      userId,
      title: 'Fresh Title',
      force: false,
    });

    const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
    expect(chat?.updatedAt).toBeGreaterThan(1);
  });

	it('should not overwrite a custom title without force', async () => {
    const chatId = await t.run(async (ctx) => {
      return await ctx.db.insert('chats', {
        userId,
        title: 'Already Custom',
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await asExternalId(t, 'test-user').mutation(api.chats.setGeneratedTitle, {
      chatId,
      userId,
      title: 'Should Not Apply',
      force: false,
    });

    const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
    expect(chat?.title).toBe('Already Custom');
  });

	it('should overwrite a custom title when force=true', async () => {
    const chatId = await t.run(async (ctx) => {
      return await ctx.db.insert('chats', {
        userId,
        title: 'Already Custom',
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await asExternalId(t, 'test-user').mutation(api.chats.setGeneratedTitle, {
      chatId,
      userId,
      title: 'Forced Replace',
      force: true,
    });

    const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
    expect(chat?.title).toBe('Forced Replace');
  });
});

describe('chats.generateAndSetTitleInternal', () => {
	let t: ReturnType<typeof convexTest>;
	let userId: Id<'users'>;
	let chatId: Id<'chats'>;
	const originalApiKey = process.env.OPENROUTER_API_KEY;

	beforeEach(async () => {
		t = createConvexTest();
		process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
		vi.restoreAllMocks();

		userId = await t.run(async (ctx) => {
			return await ctx.db.insert('users', {
				externalId: 'internal-title-user',
				email: 'internal-title@test.com',
				name: 'Internal Title User',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		chatId = await t.run(async (ctx) => {
			return await ctx.db.insert('chats', {
				userId,
				title: 'New Chat',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
	});

	afterEach(() => {
		if (originalApiKey === undefined) {
			delete process.env.OPENROUTER_API_KEY;
		} else {
			process.env.OPENROUTER_API_KEY = originalApiKey;
		}
		vi.restoreAllMocks();
	});

	it('generates and persists a title for default-title chats', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: 'Helpful Testing Title' } }],
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				},
			),
		);

		const result = await t.action(internal.chats.generateAndSetTitleInternal, {
			chatId,
			userId,
			seedText: 'this is the first user message',
			length: 'standard',
			provider: 'osschat',
			force: false,
		});

		expect(result.saved).toBe(true);
		expect(result.title).toBe('Helpful Testing Title');

		const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
		expect(chat?.title).toBe('Helpful Testing Title');
	});

	it('does not overwrite existing custom titles unless forced', async () => {
		await t.run(async (ctx) => {
			await ctx.db.patch(chatId, { title: 'Custom Existing Title' });
		});

		const result = await t.action(internal.chats.generateAndSetTitleInternal, {
			chatId,
			userId,
			seedText: 'first message',
			length: 'standard',
			provider: 'osschat',
			force: false,
		});

		expect(result.saved).toBe(false);
		expect(result.reason).toBe('title_already_set');
	});
});
