/**
 * Comprehensive Tests for Convex Message Functions
 *
 * Tests cover:
 * - Message creation and listing
 * - Message updates (streaming)
 * - Attachment handling
 * - Reasoning content storage
 * - Chronological ordering
 * - Security and validation
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { convexTest } from 'convex-test';
import schema from './schema';
import { api } from './_generated/api';
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

describe('messages.list', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;
  let chatId: Id<'chats'>;
  let externalId: string;

  beforeEach(async () => {
    t = createConvexTest();

    externalId = 'test-user';
    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId,
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const chat = await asExternalId(t, externalId).mutation(api.chats.create, {
      userId,
      title: 'Test Chat',
    });
    chatId = chat.chatId;
  });

  it('should list messages for a chat', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        chatId,
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
        status: 'completed',
      });
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });

    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Hello');
  });

  it('should return empty array for chat with no messages', async () => {
    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });

    expect(messages).toEqual([]);
  });

  it('should return empty array when user does not own chat', async () => {
    const otherExternalId = 'other-user';
    const otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: otherExternalId,
        email: 'other@example.com',
        name: 'Other User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const messages = await asExternalId(t, otherExternalId).query(api.messages.list, { chatId, userId: otherUserId });

    expect(messages).toEqual([]);
  });

  it('should filter out soft-deleted messages', async () => {
    const msg1Id = await t.run(async (ctx) => {
      return await ctx.db.insert('messages', {
        chatId,
        role: 'user',
        content: 'Active',
        createdAt: Date.now(),
        status: 'completed',
      });
    });

    const msg2Id = await t.run(async (ctx) => {
      return await ctx.db.insert('messages', {
        chatId,
        role: 'user',
        content: 'Deleted',
        createdAt: Date.now() + 1,
        status: 'completed',
        deletedAt: Date.now(),
      });
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });

    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Active');
  });

  it('should return messages in chronological order', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        chatId,
        role: 'user',
        content: 'First',
        createdAt: 1000,
        status: 'completed',
      });
      await ctx.db.insert('messages', {
        chatId,
        role: 'assistant',
        content: 'Second',
        createdAt: 2000,
        status: 'completed',
      });
      await ctx.db.insert('messages', {
        chatId,
        role: 'user',
        content: 'Third',
        createdAt: 3000,
        status: 'completed',
      });
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });

    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe('First');
    expect(messages[1].content).toBe('Second');
    expect(messages[2].content).toBe('Third');
  });

  it('should exclude redundant fields from response', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        chatId,
        role: 'user',
        content: 'Test',
        createdAt: Date.now(),
        status: 'completed',
        userId,
      });
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });

    const msg = messages[0];
    expect(msg).toHaveProperty('_id');
    expect(msg).toHaveProperty('role');
    expect(msg).toHaveProperty('content');
    expect(msg).toHaveProperty('createdAt');

		// These should be excluded
		expect(msg).not.toHaveProperty('_creationTime');
		expect(msg).not.toHaveProperty('chatId');
		expect(msg).not.toHaveProperty('userId');
		// status is included in the response for streaming/UX purposes
  });

  it('should include reasoning content when present', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        chatId,
        role: 'assistant',
        content: 'Answer',
        reasoning: 'My reasoning',
        thinkingTimeMs: 5000,
        createdAt: Date.now(),
        status: 'completed',
      });
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });

    expect(messages[0].reasoning).toBe('My reasoning');
    expect(messages[0].thinkingTimeMs).toBe(5000);
  });

  it('should include clientMessageId when present', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('messages', {
        chatId,
        clientMessageId: 'client123',
        role: 'user',
        content: 'Test',
        createdAt: Date.now(),
        status: 'completed',
      });
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });

    expect(messages[0].clientMessageId).toBe('client123');
  });
});

describe('messages.send', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;
  let chatId: Id<'chats'>;
  let externalId: string;

  beforeEach(async () => {
    t = createConvexTest();

    externalId = 'test-user';
    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId,
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const chat = await asExternalId(t, externalId).mutation(api.chats.create, {
      userId,
      title: 'Test Chat',
    });
    chatId = chat.chatId;
  });

  it('should send user message', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.send, {
      chatId,
      userId,
      userMessage: {
        content: 'Hello',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.userMessageId).toBeDefined();

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Hello');
    expect(messages[0].role).toBe('user');
  });

  it('should send both user and assistant messages', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.send, {
      chatId,
      userId,
      userMessage: {
        content: 'Hello',
      },
      assistantMessage: {
        content: 'Hi there!',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.userMessageId).toBeDefined();
    expect(result.assistantMessageId).toBeDefined();

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('should return ok: false when user does not own chat', async () => {
    const otherExternalId = 'other-user';
    const otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: otherExternalId,
        email: 'other@example.com',
        name: 'Other User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await asExternalId(t, otherExternalId).mutation(api.messages.send, {
      chatId,
      userId: otherUserId,
      userMessage: {
        content: 'Hello',
      },
    });

    expect(result.ok).toBe(false);
  });

  it('should use custom timestamp when provided', async () => {
    const customTime = 123456789;
    await asExternalId(t, externalId).mutation(api.messages.send, {
      chatId,
      userId,
      userMessage: {
        content: 'Hello',
        createdAt: customTime,
      },
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });
    expect(messages[0].createdAt).toBe(customTime);
  });

  it('should update chat timestamps', async () => {
    const before = Date.now();
    await asExternalId(t, externalId).mutation(api.messages.send, {
      chatId,
      userId,
      userMessage: {
        content: 'Hello',
      },
    });

    const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
    // Check that lastMessageAt was updated (greater than or equal to before)
    // Add small buffer for timing variations
    expect(chat?.lastMessageAt).toBeGreaterThanOrEqual(before);
    expect(chat?.lastMessageAt).toBeLessThanOrEqual(Date.now() + 100);
  });

  it('should store clientMessageId', async () => {
    await asExternalId(t, externalId).mutation(api.messages.send, {
      chatId,
      userId,
      userMessage: {
        content: 'Hello',
        clientMessageId: 'client123',
      },
    });

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });
    expect(messages[0].clientMessageId).toBe('client123');
  });
});

describe('messages.streamUpsert', () => {
  let t: ReturnType<typeof convexTest>;
  let userId: Id<'users'>;
  let chatId: Id<'chats'>;
  let externalId: string;

  beforeEach(async () => {
    t = createConvexTest();

    externalId = 'test-user';
    userId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId,
        email: 'test@example.com',
        name: 'Test User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const chat = await asExternalId(t, externalId).mutation(api.chats.create, {
      userId,
      title: 'Test Chat',
    });
    chatId = chat.chatId;
  });

  it('should create new message', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Streaming...',
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBeDefined();

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Streaming...');
  });

  it('should update existing message', async () => {
    const initial = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Partial...',
    });

    const updated = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      messageId: initial.messageId,
      role: 'assistant',
      content: 'Complete response',
    });

    expect(updated.messageId).toBe(initial.messageId);

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Complete response');
  });

  it('should default status to streaming', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Test',
    });

    const msg = await t.run(async (ctx) => await ctx.db.get(result.messageId!));
    expect(msg?.status).toBe('streaming');
  });

  it('should accept custom status', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Done',
      status: 'completed',
    });

    const msg = await t.run(async (ctx) => await ctx.db.get(result.messageId!));
    expect(msg?.status).toBe('completed');
  });

  it('should store reasoning content', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Answer',
      reasoning: 'My reasoning',
      thinkingTimeMs: 3000,
    });

    const msg = await t.run(async (ctx) => await ctx.db.get(result.messageId!));
    expect(msg?.reasoning).toBe('My reasoning');
    expect(msg?.thinkingTimeMs).toBe(3000);
  });

  it('should reject invalid role', async () => {
    await expect(
      asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
        chatId,
        userId,
        role: 'system',
        content: 'Test',
      })
    ).rejects.toThrow('Invalid message role');
  });

  it('should validate message content length (100KB max)', async () => {
    const largeContent = 'a'.repeat(101 * 1024); // 101KB

    await expect(
      asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
        chatId,
        userId,
        role: 'user',
        content: largeContent,
      })
    ).rejects.toThrow('exceeds maximum length');
  });

  it('should allow content up to 100KB', async () => {
    const maxContent = 'a'.repeat(100 * 1024);

    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'user',
      content: maxContent,
    });

    expect(result.ok).toBe(true);
  });

  it('should enforce max messages per chat limit (10,000)', async () => {
    // Set message count to limit
    await t.run(async (ctx) => {
      await ctx.db.patch(chatId, { messageCount: 10000 });
    });

    await expect(
      asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
        chatId,
        userId,
        role: 'user',
        content: 'Too many',
      })
    ).rejects.toThrow('maximum message limit');
  });

  it('should increment message count on new message', async () => {
    await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'user',
      content: 'Message 1',
    });

    await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Message 2',
    });

    const chat = await t.run(async (ctx) => await ctx.db.get(chatId));
    expect(chat?.messageCount).toBeGreaterThanOrEqual(2);
  });

  it('should not increment count when updating existing message', async () => {
    const initial = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Initial',
    });

    const chatBefore = await t.run(async (ctx) => await ctx.db.get(chatId));
    const countBefore = chatBefore?.messageCount || 0;

    await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      messageId: initial.messageId,
      role: 'assistant',
      content: 'Updated',
    });

    const chatAfter = await t.run(async (ctx) => await ctx.db.get(chatId));
    expect(chatAfter?.messageCount).toBe(countBefore);
  });

  it('should reuse message by clientMessageId', async () => {
    const first = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      clientMessageId: 'client123',
      role: 'user',
      content: 'Original',
    });

    const second = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      clientMessageId: 'client123',
      role: 'user',
      content: 'Updated',
    });

    expect(second.messageId).toBe(first.messageId);

    const messages = await asExternalId(t, externalId).query(api.messages.list, { chatId, userId });
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('Updated');
  });

  it('should handle empty content', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'user',
      content: '',
    });

    expect(result.ok).toBe(true);
  });

  it('should handle whitespace-only content', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'user',
      content: '   \n\t  ',
    });

    expect(result.ok).toBe(true);
  });

  it('should validate content length in bytes not characters', async () => {
    // Unicode character that takes 4 bytes
    const unicodeChar = '𝕳';
    const content = unicodeChar.repeat(26 * 1024); // ~104KB

    await expect(
      asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
        chatId,
        userId,
        role: 'user',
        content,
      })
    ).rejects.toThrow('exceeds maximum length');
  });

  it('should update chat timestamps when status is completed', async () => {
    const before = Date.now();

    await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Done',
      status: 'completed',
    });

    const after = Date.now();
    const chat = await t.run(async (ctx) => await ctx.db.get(chatId));

    expect(chat?.lastMessageAt).toBeGreaterThanOrEqual(before);
    expect(chat?.lastMessageAt).toBeLessThanOrEqual(after);
  });

  it('should return ok: false when user does not own chat', async () => {
    const otherExternalId = 'other-user';
    const otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', {
        externalId: otherExternalId,
        email: 'other@example.com',
        name: 'Other User',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await asExternalId(t, otherExternalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId: otherUserId,
      role: 'assistant',
      content: 'Test',
    });

    expect(result.ok).toBe(false);
  });

  it('should accept user role', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'user',
      content: 'Test',
    });

    expect(result.ok).toBe(true);

    const msg = await t.run(async (ctx) => await ctx.db.get(result.messageId!));
    expect(msg?.role).toBe('user');
  });

  it('should accept assistant role', async () => {
    const result = await asExternalId(t, externalId).mutation(api.messages.streamUpsert, {
      chatId,
      userId,
      role: 'assistant',
      content: 'Test',
    });

    expect(result.ok).toBe(true);

    const msg = await t.run(async (ctx) => await ctx.db.get(result.messageId!));
    expect(msg?.role).toBe('assistant');
  });
});
