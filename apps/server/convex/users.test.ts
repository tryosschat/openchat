/**
 * Comprehensive Tests for User Functions
 *
 * Tests all user-related operations including:
 * - User creation and authentication
 * - User retrieval by external ID and internal ID
 * - OpenRouter API key management (encrypted)
 * - File upload quota tracking
 * - Rate limiting
 * - Error handling and edge cases
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules, rateLimiter } from "./testSetup.test";

function asExternalId(t: any, externalId: string) {
	return t.withIdentity({ subject: externalId });
}

// Helper to create convex test instance with components registered
function createConvexTest() {
	const t = convexTest(schema, modules);
	rateLimiter.register(t);
	return t;
}

describe("users.ensure", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

		test("should create a new user with all fields", async () => {
			const result = await asExternalId(t, "user_123").mutation(api.users.ensure, {
			externalId: "user_123",
			email: "test@example.com",
			name: "Test User",
			avatarUrl: "https://example.com/avatar.jpg",
		});

		expect(result.userId).toBeDefined();

		// Verify user was created with correct data
		const user = await t.run(async (ctx) => {
			return await ctx.db.get(result.userId);
		});

		expect(user).toMatchObject({
			externalId: "user_123",
			email: "test@example.com",
			name: "Test User",
			avatarUrl: "https://example.com/avatar.jpg",
		});
		expect(user?.createdAt).toBeDefined();
		expect(user?.updatedAt).toBeDefined();
	});

		test("should create a new user with minimal fields", async () => {
			const result = await asExternalId(t, "user_minimal").mutation(api.users.ensure, {
			externalId: "user_minimal",
		});

		expect(result.userId).toBeDefined();

		const user = await t.run(async (ctx) => {
			return await ctx.db.get(result.userId);
		});

		expect(user).toMatchObject({
			externalId: "user_minimal",
		});
		expect(user?.email).toBeUndefined();
		expect(user?.name).toBeUndefined();
		expect(user?.avatarUrl).toBeUndefined();
	});

		test("should return existing user if already exists", async () => {
			const userT = asExternalId(t, "user_existing");
			const result1 = await userT.mutation(api.users.ensure, {
			externalId: "user_existing",
			email: "old@example.com",
			name: "Old Name",
		});
			const result2 = await userT.mutation(api.users.ensure, {
			externalId: "user_existing",
			email: "old@example.com",
			name: "Old Name",
		});

		expect(result1.userId).toBe(result2.userId);

		// Should only have one user
		const users = await t.run(async (ctx) => {
			return await ctx.db.query("users").collect();
		});
		expect(users).toHaveLength(1);
	});

		test("should update user fields if they changed", async () => {
			const userT = asExternalId(t, "user_update");
			const result1 = await userT.mutation(api.users.ensure, {
			externalId: "user_update",
			email: "old@example.com",
			name: "Old Name",
			avatarUrl: "https://example.com/old.jpg",
		});
			const result2 = await userT.mutation(api.users.ensure, {
			externalId: "user_update",
			email: "new@example.com",
			name: "New Name",
			avatarUrl: "https://example.com/new.jpg",
		});

		expect(result1.userId).toBe(result2.userId);

		const user = await t.run(async (ctx) => {
			return await ctx.db.get(result2.userId);
		});

		expect(user).toMatchObject({
			email: "new@example.com",
			name: "New Name",
			avatarUrl: "https://example.com/new.jpg",
		});
	});

		test("should not update if fields are the same", async () => {
			const userT = asExternalId(t, "user_no_update");
			const result1 = await userT.mutation(api.users.ensure, {
			externalId: "user_no_update",
			email: "same@example.com",
			name: "Same Name",
		});

		const user1 = await t.run(async (ctx) => {
			return await ctx.db.get(result1.userId);
		});

		// Small delay to ensure different timestamps if update happened
		await new Promise((resolve) => setTimeout(resolve, 10));

			const result2 = await userT.mutation(api.users.ensure, {
			externalId: "user_no_update",
			email: "same@example.com",
			name: "Same Name",
		});

		const user2 = await t.run(async (ctx) => {
			return await ctx.db.get(result2.userId);
		});

		// updatedAt should not change if no update was needed
		expect(user1?.updatedAt).toBe(user2?.updatedAt);
	});

		test("should increment users_total stat when creating user", async () => {
			await asExternalId(t, "user_stat_1").mutation(api.users.ensure, {
			externalId: "user_stat_1",
		});
			await asExternalId(t, "user_stat_2").mutation(api.users.ensure, {
			externalId: "user_stat_2",
		});

		const stat = await t.run(async (ctx) => {
			return await ctx.db
				.query("dbStats")
				.withIndex("by_key", (q) => q.eq("key", "users_total"))
				.unique();
		});

		expect(stat?.value).toBe(2);
	});

		test("should not increment stat when updating existing user", async () => {
			const userT = asExternalId(t, "user_stat_update");
			await userT.mutation(api.users.ensure, {
			externalId: "user_stat_update",
			email: "old@example.com",
		});
			await userT.mutation(api.users.ensure, {
			externalId: "user_stat_update",
			email: "new@example.com",
		});

		const stat = await t.run(async (ctx) => {
			return await ctx.db
				.query("dbStats")
				.withIndex("by_key", (q) => q.eq("key", "users_total"))
				.unique();
		});

		expect(stat?.value).toBe(1);
	});

		test("should enforce rate limit on user creation", async () => {
			// Rate limit is keyed by identity.subject (externalId). Use the same user
			// repeatedly to exhaust the token bucket.
			const userT = asExternalId(t, "user_rate_limit");

			let rateLimitHit = false;
			for (let i = 0; i < 100; i++) {
				try {
					await userT.mutation(api.users.ensure, {
						externalId: "user_rate_limit",
					});
				} catch (error: any) {
					if (
						error?.message &&
						error.message.includes("Too many authentication attempts")
					) {
						rateLimitHit = true;
						break;
					}
					throw error;
				}
			}

			expect(rateLimitHit).toBe(true);
	});

		test("should handle optional fields correctly", async () => {

		// Create with email only
			const result1 = await asExternalId(t, "user_partial_1").mutation(api.users.ensure, {
			externalId: "user_partial_1",
			email: "email@example.com",
		});

		// Create with name only
			const result2 = await asExternalId(t, "user_partial_2").mutation(api.users.ensure, {
			externalId: "user_partial_2",
			name: "Name Only",
		});

		// Create with avatarUrl only
			const result3 = await asExternalId(t, "user_partial_3").mutation(api.users.ensure, {
			externalId: "user_partial_3",
			avatarUrl: "https://example.com/avatar.jpg",
		});

		const user1 = await t.run(async (ctx) => ctx.db.get(result1.userId));
		const user2 = await t.run(async (ctx) => ctx.db.get(result2.userId));
		const user3 = await t.run(async (ctx) => ctx.db.get(result3.userId));

		expect(user1?.email).toBe("email@example.com");
		expect(user1?.name).toBeUndefined();

		expect(user2?.name).toBe("Name Only");
		expect(user2?.email).toBeUndefined();

		expect(user3?.avatarUrl).toBe("https://example.com/avatar.jpg");
		expect(user3?.email).toBeUndefined();
	});
});

describe("users.getByExternalId", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should get user by external ID", async () => {
		await asExternalId(t, "user_get_1").mutation(api.users.ensure, {
			externalId: "user_get_1",
			email: "get@example.com",
			name: "Get User",
		});
		const user = await asExternalId(t, "user_get_1").query(api.users.getByExternalId, {
			externalId: "user_get_1",
		});

		expect(user).toBeDefined();
		expect(user?.externalId).toBe("user_get_1");
		expect(user?.email).toBe("get@example.com");
		expect(user?.name).toBe("Get User");
	});

	test("should return null for non-existent user", async () => {
		const user = await asExternalId(t, "non_existent_user").query(api.users.getByExternalId, {
			externalId: "non_existent_user",
		});

		expect(user).toBeNull();
	});

	test("should return correct user among multiple users", async () => {
		await asExternalId(t, "user_multi_1").mutation(api.users.ensure, {
			externalId: "user_multi_1",
			name: "User 1",
		});
		await asExternalId(t, "user_multi_2").mutation(api.users.ensure, {
			externalId: "user_multi_2",
			name: "User 2",
		});
		await asExternalId(t, "user_multi_3").mutation(api.users.ensure, {
			externalId: "user_multi_3",
			name: "User 3",
		});
		const user = await asExternalId(t, "user_multi_2").query(api.users.getByExternalId, {
			externalId: "user_multi_2",
		});

		expect(user?.name).toBe("User 2");
	});
});

	describe("users.getById", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should get user by internal ID", async () => {
		const { userId } = await asExternalId(t, "user_get_by_id").mutation(api.users.ensure, {
			externalId: "user_get_by_id",
			email: "getbyid@example.com",
		});
		const user = await asExternalId(t, "user_get_by_id").query(api.users.getById, { userId });

		expect(user).toBeDefined();
		expect(user?._id).toBe(userId);
		expect(user?.email).toBe("getbyid@example.com");
	});

		test("should return null for invalid ID", async () => {

		// Create a valid ID that doesn't exist by creating and deleting a user
		const tempId = await t.run(async (ctx) => {
			return await ctx.db.insert("users", {
				externalId: "temp_user_to_delete",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await t.run(async (ctx) => {
			await ctx.db.delete(tempId);
		});

			// getById is scoped to the authenticated userId; passing a different ID
			// should be rejected.
			await asExternalId(t, "auth_user_for_invalid_id").mutation(api.users.ensure, {
				externalId: "auth_user_for_invalid_id",
			});

			await expect(
				asExternalId(t, "auth_user_for_invalid_id").query(api.users.getById, {
					userId: tempId,
				}),
			).rejects.toThrowError(/Unauthorized/);
	});
});

describe("users.saveOpenRouterKey", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should save encrypted OpenRouter key", async () => {
		const { userId } = await asExternalId(t, "user_save_key").mutation(api.users.ensure, {
			externalId: "user_save_key",
		});
		const result = await asExternalId(t, "user_save_key").mutation(api.users.saveOpenRouterKey, {
			userId,
			encryptedKey: "encrypted_key_data_12345",
		});

		expect(result.success).toBe(true);

		const user = await t.run(async (ctx) => ctx.db.get(userId));
		expect(user?.encryptedOpenRouterKey).toBe("encrypted_key_data_12345");
	});

	test("should update existing key", async () => {
		const userT = asExternalId(t, "user_update_key");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_update_key",
		});
		await userT.mutation(api.users.saveOpenRouterKey, {
			userId,
			encryptedKey: "old_key",
		});
		await userT.mutation(api.users.saveOpenRouterKey, {
			userId,
			encryptedKey: "new_key",
		});

		const user = await t.run(async (ctx) => ctx.db.get(userId));
		expect(user?.encryptedOpenRouterKey).toBe("new_key");
	});

	test("should update updatedAt timestamp", async () => {
		const userT = asExternalId(t, "user_timestamp");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_timestamp",
		});

		const userBefore = await t.run(async (ctx) => ctx.db.get(userId));
		const timestampBefore = userBefore?.updatedAt;

		// Small delay
		await new Promise((resolve) => setTimeout(resolve, 10));

		await userT.mutation(api.users.saveOpenRouterKey, {
			userId,
			encryptedKey: "new_key",
		});

		const userAfter = await t.run(async (ctx) => ctx.db.get(userId));
		expect(userAfter?.updatedAt).toBeGreaterThan(timestampBefore!);
	});

	test("should enforce rate limit on API key saves", async () => {
		const userT = asExternalId(t, "user_rate_limit_key");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_rate_limit_key",
		});

		// Try to save many keys quickly - run sequentially until rate limit hits
		let rateLimitHit = false;
			for (let i = 0; i < 10; i++) {
				try {
					await userT.mutation(api.users.saveOpenRouterKey, {
						userId,
						encryptedKey: `key_${i}`,
					});
				} catch (error: any) {
				if (error.message && error.message.includes("Too many API key updates")) {
					rateLimitHit = true;
					break;
				}
				throw error;
			}
		}

		expect(rateLimitHit).toBe(true);
	});
});

	describe("users.getOpenRouterKey", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should get encrypted OpenRouter key", async () => {
		const userT = asExternalId(t, "user_get_key");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_get_key",
		});
		await userT.mutation(api.users.saveOpenRouterKey, {
			userId,
			encryptedKey: "test_encrypted_key",
		});
		const key = await userT.query(api.users.getOpenRouterKey, { userId });

		expect(key).toBe("test_encrypted_key");
	});

	test("should return null if no key set", async () => {
		const userT = asExternalId(t, "user_no_key");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_no_key",
		});
		const key = await userT.query(api.users.getOpenRouterKey, { userId });

		expect(key).toBeNull();
	});

	test("should reject access for non-existent userId", async () => {

		// Create a valid ID that doesn't exist by creating and deleting a user
		const tempId = await t.run(async (ctx) => {
			return await ctx.db.insert("users", {
				externalId: "temp_user_for_key_test",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		await t.run(async (ctx) => {
			await ctx.db.delete(tempId);
		});

		await asExternalId(t, "auth_user_for_missing_key_user").mutation(api.users.ensure, {
			externalId: "auth_user_for_missing_key_user",
		});

		await expect(
			asExternalId(t, "auth_user_for_missing_key_user").query(
				api.users.getOpenRouterKey,
				{ userId: tempId },
			),
		).rejects.toThrowError(/Unauthorized/);
	});
});

describe("users.removeOpenRouterKey", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should remove OpenRouter key", async () => {
		const userT = asExternalId(t, "user_remove_key");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_remove_key",
		});
		await userT.mutation(api.users.saveOpenRouterKey, {
			userId,
			encryptedKey: "key_to_remove",
		});
		const result = await userT.mutation(api.users.removeOpenRouterKey, {
			userId,
		});

		expect(result.success).toBe(true);

		const user = await t.run(async (ctx) => ctx.db.get(userId));
		expect(user?.encryptedOpenRouterKey).toBeUndefined();
	});

	test("should succeed even if no key exists", async () => {
		const userT = asExternalId(t, "user_remove_no_key");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_remove_no_key",
		});
		const result = await userT.mutation(api.users.removeOpenRouterKey, {
			userId,
		});

		expect(result.success).toBe(true);
	});

	test("should update updatedAt timestamp", async () => {
		const userT = asExternalId(t, "user_remove_timestamp");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_remove_timestamp",
		});
		await userT.mutation(api.users.saveOpenRouterKey, {
			userId,
			encryptedKey: "key",
		});

		const userBefore = await t.run(async (ctx) => ctx.db.get(userId));

		await new Promise((resolve) => setTimeout(resolve, 10));

		await userT.mutation(api.users.removeOpenRouterKey, { userId });

		const userAfter = await t.run(async (ctx) => ctx.db.get(userId));
		expect(userAfter?.updatedAt).toBeGreaterThan(userBefore!.updatedAt);
	});

	test("should enforce rate limit on API key removals", async () => {
		const userT = asExternalId(t, "user_rate_limit_remove");
		const { userId } = await userT.mutation(api.users.ensure, {
			externalId: "user_rate_limit_remove",
		});

		// Try to remove many times quickly - run sequentially until rate limit hits
		let rateLimitHit = false;
			for (let i = 0; i < 10; i++) {
				try {
					await userT.mutation(api.users.removeOpenRouterKey, {
						userId,
					});
				} catch (error: any) {
				if (error.message && error.message.includes("Too many API key removals")) {
					rateLimitHit = true;
					break;
				}
				throw error;
			}
		}

		expect(rateLimitHit).toBe(true);
	});
});

describe("users edge cases and error handling", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should handle special characters in external ID", async () => {
		const externalId = "user_special_!@#$%^&*()";
		const result = await asExternalId(t, externalId).mutation(api.users.ensure, {
			externalId,
		});

		expect(result.userId).toBeDefined();

		const user = await asExternalId(t, externalId).query(api.users.getByExternalId, {
			externalId,
		});

		expect(user).toBeDefined();
	});

	test("should handle very long external IDs", async () => {

		const longId = "user_" + "a".repeat(500);

		const result = await asExternalId(t, longId).mutation(api.users.ensure, {
			externalId: longId,
		});

		expect(result.userId).toBeDefined();
	});

	test("should handle unicode characters in name", async () => {
		const result = await asExternalId(t, "user_unicode").mutation(api.users.ensure, {
			externalId: "user_unicode",
			name: "测试用户 Тест 🚀",
		});

		const user = await t.run(async (ctx) => ctx.db.get(result.userId));
		expect(user?.name).toBe("测试用户 Тест 🚀");
	});

	test("should handle very long email", async () => {

		const longEmail = "very_long_email_" + "a".repeat(200) + "@example.com";

		const result = await asExternalId(t, "user_long_email").mutation(api.users.ensure, {
			externalId: "user_long_email",
			email: longEmail,
		});

		const user = await t.run(async (ctx) => ctx.db.get(result.userId));
		expect(user?.email).toBe(longEmail);
	});

	test("should handle empty string fields correctly", async () => {
		const result = await asExternalId(t, "user_empty").mutation(api.users.ensure, {
			externalId: "user_empty",
			email: "",
			name: "",
		});

		const user = await t.run(async (ctx) => ctx.db.get(result.userId));
		expect(user?.email).toBe("");
		expect(user?.name).toBe("");
	});
});

describe("users file upload quota tracking", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should track file upload count", async () => {
		const { userId } = await asExternalId(t, "user_uploads").mutation(api.users.ensure, {
			externalId: "user_uploads",
		});

		// Manually increment file upload count
		await t.run(async (ctx) => {
			await ctx.db.patch(userId, {
				fileUploadCount: 5,
			});
		});

		const user = await t.run(async (ctx) => ctx.db.get(userId));
		expect(user?.fileUploadCount).toBe(5);
	});

	test("should default to undefined for new users", async () => {
		const { userId } = await asExternalId(t, "user_no_uploads").mutation(api.users.ensure, {
			externalId: "user_no_uploads",
		});

		const user = await t.run(async (ctx) => ctx.db.get(userId));
		expect(user?.fileUploadCount).toBeUndefined();
	});
});

describe("users concurrent operations", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should handle concurrent user creation with same external ID", async () => {
		const userT = asExternalId(t, "user_concurrent");
		// Create same user concurrently
		const [result1, result2] = await Promise.all([
			userT.mutation(api.users.ensure, {
				externalId: "user_concurrent",
				name: "User 1",
			}),
			userT.mutation(api.users.ensure, {
				externalId: "user_concurrent",
				name: "User 2",
			}),
		]);

		// Both should succeed, but might have different user IDs
		// depending on which one was created first
		expect(result1.userId).toBeDefined();
		expect(result2.userId).toBeDefined();

		// Should only have one user in the database
		const users = await t.run(async (ctx) => {
			return await ctx.db
				.query("users")
				.withIndex("by_external_id", (q) =>
					q.eq("externalId", "user_concurrent")
				)
				.collect();
		});

		expect(users).toHaveLength(1);
	});
});
