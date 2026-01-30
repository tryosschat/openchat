/**
 * Comprehensive Tests for Prompt Template Functions
 *
 * Tests all prompt template operations including:
 * - Template creation with validation and sanitization
 * - Template listing with pagination and filtering
 * - Template retrieval by ID and command
 * - Template updates and auto-save
 * - Template deletion (soft delete)
 * - Usage count tracking
 * - Rate limiting
 * - Input sanitization and security
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { modules, rateLimiter } from "./testSetup.test";

// Helper to create convex test instance with components registered
function createConvexTest() {
	const t = convexTest(schema, modules);
	rateLimiter.register(t);
	return t;
}

function asExternalId(t: ReturnType<typeof convexTest>, externalId: string) {
	return t.withIdentity({ subject: externalId });
}

async function createUser(t: ReturnType<typeof convexTest>, externalId: string) {
	const authed = asExternalId(t, externalId);
	const { userId } = await authed.mutation(api.users.ensure, { externalId });
	return { authed, userId };
}


describe("promptTemplates.create", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should create template with all fields", async () => {
		const externalId = "user_template_1";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Code Review",
			command: "/review",
			template: "Please review this code: $ARGUMENTS",
			description: "Reviews code for best practices",
			category: "coding",
			isDraft: false,
		});

		expect(result.templateId).toBeDefined();

		const template = await t.run(async (ctx) => {
			return await ctx.db.get(result.templateId);
		});

		expect(template).toMatchObject({
			userId,
			name: "Code Review",
			command: "/review",
			template: "Please review this code: $ARGUMENTS",
			description: "Reviews code for best practices",
			category: "coding",
			isDraft: false,
			isPublic: false,
			usageCount: 0,
		});
	});

	test("should create template with minimal fields", async () => {
		const externalId = "user_template_2";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Simple Template",
			command: "/simple",
			template: "Simple template content",
		});

		expect(result.templateId).toBeDefined();

		const template = await t.run(async (ctx) => {
			return await ctx.db.get(result.templateId);
		});

		expect(template?.description).toBeUndefined();
		expect(template?.category).toBeUndefined();
		expect(template?.isDraft).toBe(false);
	});

	test("should sanitize command by removing leading slash", async () => {
		const externalId = "user_template_3";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Test",
			command: "/test-command",
			template: "Test",
		});

		const template = await t.run(async (ctx) => {
			return await ctx.db.get(result.templateId);
		});

		expect(template?.command).toBe("/test-command");
	});

	test("should sanitize command to lowercase and alphanumeric", async () => {
		const externalId = "user_template_4";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Test",
			command: "TEST-Command_123",
			template: "Test",
		});

		const template = await t.run(async (ctx) => {
			return await ctx.db.get(result.templateId);
		});

		expect(template?.command).toBe("/test-command_123");
	});

	test("should reject duplicate command for same user", async () => {
		const externalId = "user_template_5";
		const { authed, userId } = await createUser(t, externalId);

		await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "First Template",
			command: "/duplicate",
			template: "First",
		});

		await expect(
			authed.mutation(api.promptTemplates.create, {
				userId,
				name: "Second Template",
				command: "/duplicate",
				template: "Second",
			})
		).rejects.toThrowError(/already exists/);
	});

	test("should allow same command for different users", async () => {
		const externalId1 = "user_template_6a";
		const externalId2 = "user_template_6b";
		const user1 = await createUser(t, externalId1);
		const user2 = await createUser(t, externalId2);

		const result1 = await user1.authed.mutation(api.promptTemplates.create, {
			userId: user1.userId,
			name: "Template 1",
			command: "/shared",
			template: "Template 1",
		});

		const result2 = await user2.authed.mutation(api.promptTemplates.create, {
			userId: user2.userId,
			name: "Template 2",
			command: "/shared",
			template: "Template 2",
		});

		expect(result1.templateId).toBeDefined();
		expect(result2.templateId).toBeDefined();
		expect(result1.templateId).not.toBe(result2.templateId);
	});

		test("should enforce rate limit on template creation", async () => {
			const externalId = `user_template_rate_${Math.random().toString(36)}`;
			const { authed, userId } = await createUser(t, externalId);

		// Try to create many templates quickly (rate limit is 20/min with 5 burst = 25 total)
		const promises = [];
		for (let i = 0; i < 30; i++) {
			promises.push(
				authed.mutation(api.promptTemplates.create, {
					userId,
					name: `Template ${i}`,
					command: `/cmdrate${i}_${Math.random().toString(36).substring(7)}`,
					template: `Template ${i}`,
				})
			);
		}

			// Use allSettled to drain all in-flight work. Promise.all would reject
			// early and leave other mutations running, which can cause "Unhandled error
			// between tests" in the full suite.
			const results = await Promise.allSettled(promises);
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === "rejected"
			);
			expect(rejected.length).toBeGreaterThan(0);
			expect(
				rejected.some((r) => /Too many templates created/.test(String(r.reason)))
			).toBe(true);
		});

	test("should reject empty name", async () => {
		const externalId = "user_template_7";
		const { authed, userId } = await createUser(t, externalId);

		await expect(
			authed.mutation(api.promptTemplates.create, {
				userId,
				name: "   ",
				command: "/test",
				template: "Test",
			})
		).rejects.toThrowError(/name is required/);
	});

	test("should reject invalid command", async () => {
		const externalId = "user_template_8";
		const { authed, userId } = await createUser(t, externalId);

		await expect(
			authed.mutation(api.promptTemplates.create, {
				userId,
				name: "Test",
				command: "!!!",
				template: "Test",
			})
		).rejects.toThrowError(/Valid command is required/);
	});

	test("should reject empty template content", async () => {
		const externalId = "user_template_9";
		const { authed, userId } = await createUser(t, externalId);

		await expect(
			authed.mutation(api.promptTemplates.create, {
				userId,
				name: "Test",
				command: "/test",
				template: "   ",
			})
		).rejects.toThrowError(/Template content is required/);
	});

	test("should trim and sanitize input fields", async () => {
		const externalId = "user_template_10";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "  Template Name  ",
			command: "  /test  ",
			template: "  Template content  ",
			description: "  Description  ",
			category: "  coding  ",
		});

		const template = await t.run(async (ctx) => {
			return await ctx.db.get(result.templateId);
		});

		expect(template?.name).toBe("Template Name");
		expect(template?.template).toBe("Template content");
		expect(template?.description).toBe("Description");
		expect(template?.category).toBe("coding");
	});
});

describe("promptTemplates.list", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

		test("should list user templates", async () => {
			const externalId = "user_list_1";
			const { authed, userId } = await createUser(t, externalId);

			await authed.mutation(api.promptTemplates.create, {
				userId,
				name: "Template 1",
				command: "/t1",
				template: "Content 1",
			});

			await authed.mutation(api.promptTemplates.create, {
				userId,
				name: "Template 2",
				command: "/t2",
				template: "Content 2",
			});

			const result = await authed.query(api.promptTemplates.list, { userId });

		expect(result.templates).toHaveLength(2);
		expect(result.templates[0].name).toBeDefined();
		expect(result.templates[0].command).toBeDefined();
	});

		test("should not return deleted templates", async () => {
			const externalId = "user_list_2";
			const { authed, userId } = await createUser(t, externalId);

			const { templateId } = await authed.mutation(api.promptTemplates.create, {
				userId,
				name: "To Delete",
				command: "/delete",
				template: "Content",
			});

			await authed.mutation(api.promptTemplates.remove, { templateId, userId });

			const result = await authed.query(api.promptTemplates.list, { userId });

		expect(result.templates).toHaveLength(0);
	});

		test("should filter by category", async () => {
			const externalId = "user_list_3";
			const { authed, userId } = await createUser(t, externalId);

			await authed.mutation(api.promptTemplates.create, {
				userId,
				name: "Coding Template",
				command: "/code",
				template: "Code",
				category: "coding",
			});

			await authed.mutation(api.promptTemplates.create, {
				userId,
				name: "Writing Template",
				command: "/write",
				template: "Write",
				category: "writing",
			});

			const result = await authed.query(api.promptTemplates.list, {
				userId,
				category: "coding",
			});

		expect(result.templates).toHaveLength(1);
		expect(result.templates[0].name).toBe("Coding Template");
	});

		test("should respect pagination limit", async () => {
			const externalId = `user_list_4_pagination_${Math.random().toString(36)}`;
			const { authed, userId } = await createUser(t, externalId);

			// Keep this <= templateCreate burst capacity (5)
			for (let i = 0; i < 4; i++) {
				await authed.mutation(api.promptTemplates.create, {
					userId,
					name: `Template ${i}`,
					command: `/tpag${i}_${Math.random().toString(36).substring(7)}`,
					template: `Content ${i}`,
				});
			}

		// Request limit of 3 to test pagination
			const result = await authed.query(api.promptTemplates.list, {
				userId,
				limit: 3,
			});

		expect(result.templates.length).toBe(3);
		expect(result.nextCursor).toBeDefined(); // Should have more results
	});

		test("should not return templates from other users", async () => {
			const externalId1 = "user_list_5a";
			const externalId2 = "user_list_5b";
			const user1 = await createUser(t, externalId1);
			const user2 = await createUser(t, externalId2);

			await user1.authed.mutation(api.promptTemplates.create, {
				userId: user1.userId,
				name: "User 1 Template",
				command: "/u1",
				template: "Content 1",
			});

			await user2.authed.mutation(api.promptTemplates.create, {
				userId: user2.userId,
				name: "User 2 Template",
				command: "/u2",
				template: "Content 2",
			});

			const result = await user1.authed.query(api.promptTemplates.list, { userId: user1.userId });

		expect(result.templates).toHaveLength(1);
		expect(result.templates[0].name).toBe("User 1 Template");
	});
});

describe("promptTemplates.get", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should get template by ID", async () => {

		const externalId = "user_get_1";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Get Test",
			command: "/get",
			template: "Content",
			description: "Test description",
		});

		const template = await authed.query(api.promptTemplates.get, {
			templateId,
			userId,
		});

		expect(template).toBeDefined();
		expect(template?.name).toBe("Get Test");
		expect(template?.description).toBe("Test description");
	});

	test("should return null for other user's template", async () => {

		const user1 = await createUser(t, "user_get_2a");
		const user2 = await createUser(t, "user_get_2b");

		const { templateId } = await user1.authed.mutation(api.promptTemplates.create, {
			userId: user1.userId,
			name: "Private",
			command: "/private",
			template: "Content",
		});

		const template = await user2.authed.query(api.promptTemplates.get, {
			templateId,
			userId: user2.userId,
		});

		expect(template).toBeNull();
	});

	test("should return null for deleted template", async () => {

		const externalId = "user_get_3";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "To Delete",
			command: "/delete",
			template: "Content",
		});

		await authed.mutation(api.promptTemplates.remove, { templateId, userId });

		const template = await authed.query(api.promptTemplates.get, {
			templateId,
			userId,
		});

		expect(template).toBeNull();
	});
});

describe("promptTemplates.getByCommand", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should get template by command", async () => {

		const externalId = "user_cmd_1";
		const { authed, userId } = await createUser(t, externalId);

		await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Command Test",
			command: "/cmdtest",
			template: "Content",
		});

		const template = await authed.query(api.promptTemplates.getByCommand, {
			userId,
			command: "/cmdtest",
		});

		expect(template).toBeDefined();
		expect(template?.name).toBe("Command Test");
	});

	test("should return null for non-existent command", async () => {

		const externalId = "user_cmd_2";
		const { authed, userId } = await createUser(t, externalId);

		const template = await authed.query(api.promptTemplates.getByCommand, {
			userId,
			command: "/nonexistent",
		});

		expect(template).toBeNull();
	});

});

describe("promptTemplates.update", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should update template fields", async () => {

		const externalId = "user_update_1";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Old Name",
			command: "/old",
			template: "Old Content",
		});

		const result = await authed.mutation(api.promptTemplates.update, {
			templateId,
			userId,
			name: "New Name",
			template: "New Content",
		});

		expect(result.ok).toBe(true);

		const template = await t.run(async (ctx) => ctx.db.get(templateId));
		expect(template?.name).toBe("New Name");
		expect(template?.template).toBe("New Content");
	});

	test("should reject duplicate command when updating", async () => {

		const externalId = "user_update_2";
		const { authed, userId } = await createUser(t, externalId);

		await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Template 1",
			command: "/cmd1",
			template: "Content 1",
		});

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Template 2",
			command: "/cmd2",
			template: "Content 2",
		});

		await expect(
			authed.mutation(api.promptTemplates.update, {
				templateId,
				userId,
				command: "/cmd1",
			})
		).rejects.toThrowError(/already exists/);
	});

	test("should allow updating to same command", async () => {

		const externalId = "user_update_3";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Template",
			command: "/same",
			template: "Content",
		});

		const result = await authed.mutation(api.promptTemplates.update, {
			templateId,
			userId,
			command: "/same",
			name: "Updated Name",
		});

		expect(result.ok).toBe(true);
	});

		test("should enforce rate limit on updates", async () => {

		const externalId = `user_update_rate_${Math.random().toString(36)}`;
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Template",
			command: `/rateupdtest${Math.random().toString(36).substring(7)}`,
			template: "Content",
		});

		// Try many updates quickly (rate limit is 30/min with 10 burst = 40 total)
		const promises = [];
		for (let i = 0; i < 50; i++) {
			promises.push(
				authed.mutation(api.promptTemplates.update, {
					templateId,
					userId,
					name: `Update ${i}`,
				})
			);
		}

			const results = await Promise.allSettled(promises);
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === "rejected"
			);
			expect(rejected.length).toBeGreaterThan(0);
			expect(
				rejected.some((r) => /Too many updates/.test(String(r.reason)))
			).toBe(true);
		});

	test("should return false for other user's template", async () => {

		const user1 = await createUser(t, "user_update_4a");
		const user2 = await createUser(t, "user_update_4b");

		const { templateId } = await user1.authed.mutation(api.promptTemplates.create, {
			userId: user1.userId,
			name: "Template",
			command: "/test",
			template: "Content",
		});

		const result = await user2.authed.mutation(api.promptTemplates.update, {
			templateId,
			userId: user2.userId,
			name: "Hacked",
		});

		expect(result.ok).toBe(false);
	});

});

describe("promptTemplates.autoSave", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should auto-save template changes", async () => {

		const externalId = "user_autosave_1";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Template",
			command: "/auto",
			template: "Content",
		});

		const result = await authed.mutation(api.promptTemplates.autoSave, {
			templateId,
			userId,
			name: "Auto Updated",
			template: "Auto Content",
		});

		expect(result.ok).toBe(true);

		const template = await t.run(async (ctx) => ctx.db.get(templateId));
		expect(template?.name).toBe("Auto Updated");
		expect(template?.template).toBe("Auto Content");
	});

	test("should not enforce rate limiting on auto-save", async () => {

		const externalId = "user_autosave_2";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Template",
			command: "/autorate",
			template: "Content",
		});

		// Should not hit rate limit even with many rapid saves
		for (let i = 0; i < 50; i++) {
			const result = await authed.mutation(api.promptTemplates.autoSave, {
				templateId,
				userId,
				name: `Auto ${i}`,
			});
			expect(result.ok).toBe(true);
		}
	});
});

describe("promptTemplates.remove", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should soft delete template", async () => {

		const externalId = "user_remove_1";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "To Delete",
			command: "/delete",
			template: "Content",
		});

		const result = await authed.mutation(api.promptTemplates.remove, {
			templateId,
			userId,
		});

		expect(result.ok).toBe(true);

		const template = await t.run(async (ctx) => ctx.db.get(templateId));
		expect(template?.deletedAt).toBeDefined();
	});

		test("should enforce rate limit on deletions", async () => {

		const externalId = `user_remove_rate_del_${Math.random().toString(36)}`;
		const { authed, userId } = await createUser(t, externalId);

		// Keep this <= templateCreate burst capacity (5)
		const templateIds = [];
		for (let i = 0; i < 4; i++) {
			const { templateId } = await authed.mutation(api.promptTemplates.create, {
				userId,
				name: `Template Del ${i}`,
				command: `/delrate${i}_${Math.random().toString(36).substring(7)}`,
				template: "Content",
			});
			templateIds.push(templateId);
		}

		// templateDelete burst capacity is 3, so the 4th rapid deletion should fail.
		const promises = templateIds.map((templateId) =>
			authed.mutation(api.promptTemplates.remove, { templateId, userId })
		);

			const results = await Promise.allSettled(promises);
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === "rejected"
			);
			expect(rejected.length).toBeGreaterThan(0);
			expect(
				rejected.some((r) => /Too many deletions/.test(String(r.reason)))
			).toBe(true);
		});

	test("should return false for already deleted template", async () => {

		const externalId = "user_remove_2";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Delete Twice",
			command: "/twice",
			template: "Content",
		});

		await authed.mutation(api.promptTemplates.remove, { templateId, userId });

		const result = await authed.mutation(api.promptTemplates.remove, {
			templateId,
			userId,
		});

		expect(result.ok).toBe(false);
	});

});

describe("promptTemplates.incrementUsage", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should increment usage count", async () => {

		const externalId = "user_usage_1";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Usage Test",
			command: "/usage",
			template: "Content",
		});

		await authed.mutation(api.promptTemplates.incrementUsage, { templateId, userId });

		const template = await t.run(async (ctx) => ctx.db.get(templateId));
		expect(template?.usageCount).toBe(1);
	});

	test("should increment from zero to one", async () => {

		const externalId = "user_usage_2";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Usage Test",
			command: "/usage2",
			template: "Content",
		});

		await authed.mutation(api.promptTemplates.incrementUsage, { templateId, userId });
		await authed.mutation(api.promptTemplates.incrementUsage, { templateId, userId });
		await authed.mutation(api.promptTemplates.incrementUsage, { templateId, userId });

		const template = await t.run(async (ctx) => ctx.db.get(templateId));
		expect(template?.usageCount).toBe(3);
	});

	test("should return false for deleted template", async () => {

		const externalId = "user_usage_3";
		const { authed, userId } = await createUser(t, externalId);

		const { templateId } = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Usage Test",
			command: "/usage3",
			template: "Content",
		});

		await authed.mutation(api.promptTemplates.remove, { templateId, userId });

		const result = await authed.mutation(api.promptTemplates.incrementUsage, {
			templateId,
			userId,
		});

		expect(result.ok).toBe(false);
	});
});

describe("promptTemplates input sanitization", () => {
	let t: ReturnType<typeof convexTest>;

	beforeEach(() => {
		t = createConvexTest();
	});

	test("should remove control characters from template", async () => {

		const externalId = "user_sanitize_1";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "Test\x00Name\x01",
			command: "/test",
			template: "Content\x00with\x01control",
		});

		const template = await t.run(async (ctx) => ctx.db.get(result.templateId));
		expect(template?.name).not.toContain("\x00");
		expect(template?.template).not.toContain("\x00");
	});

	test("should truncate very long fields", async () => {

		const externalId = "user_sanitize_2";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "a".repeat(200),
			command: "/test",
			template: "Content",
		});

		const template = await t.run(async (ctx) => ctx.db.get(result.templateId));
		expect(template?.name.length).toBeLessThanOrEqual(100);
	});

	test("should handle unicode in templates", async () => {

		const externalId = "user_sanitize_3";
		const { authed, userId } = await createUser(t, externalId);

		const result = await authed.mutation(api.promptTemplates.create, {
			userId,
			name: "测试模板 🚀",
			command: "/unicode",
			template: "Content with 中文 and emojis 🎉",
		});

		const template = await t.run(async (ctx) => ctx.db.get(result.templateId));
		expect(template?.name).toBe("测试模板 🚀");
		expect(template?.template).toBe("Content with 中文 and emojis 🎉");
	});
});
