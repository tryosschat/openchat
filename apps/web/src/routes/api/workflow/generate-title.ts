import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { serve } from "@upstash/workflow/tanstack";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { createConvexServerClient } from "@/lib/convex-server";
import { decryptSecret } from "@/lib/server-crypto";
import { getAuthUser, getConvexAuthToken, isSameOrigin } from "@/lib/server-auth";
import { authRatelimit, workflowClient } from "@/lib/upstash";

const CONVEX_SITE_URL =
	process.env.VITE_CONVEX_SITE_URL || process.env.CONVEX_SITE_URL;

const TITLE_MODEL_ID = "google/gemini-2.5-flash-lite";
const TITLE_MAX_LENGTH = 200;

type TitleLength = "short" | "standard" | "long";
type TitleProvider = "osschat" | "openrouter";

type GenerateTitlePayload = {
	chatId: string;
	userId: string;
	seedText?: string;
	length: TitleLength;
	provider: TitleProvider;
	mode?: "auto" | "manual";
};

function parseGenerateTitlePayload(raw: unknown): GenerateTitlePayload | null {
	if (!raw || typeof raw !== "object") return null;

	const payload = raw as Record<string, unknown>;
	if (typeof payload.chatId !== "string" || payload.chatId.trim().length === 0) {
		return null;
	}
	if (typeof payload.userId !== "string" || payload.userId.trim().length === 0) {
		return null;
	}
	if (
		payload.length !== "short" &&
		payload.length !== "standard" &&
		payload.length !== "long"
	) {
		return null;
	}
	if (payload.provider !== "osschat" && payload.provider !== "openrouter") {
		return null;
	}
	if (
		payload.mode !== undefined &&
		payload.mode !== "auto" &&
		payload.mode !== "manual"
	) {
		return null;
	}
	if (
		payload.seedText !== undefined &&
		typeof payload.seedText !== "string"
	) {
		return null;
	}

	return {
		chatId: payload.chatId.trim(),
		userId: payload.userId.trim(),
		seedText: payload.seedText,
		length: payload.length,
		provider: payload.provider,
		mode: payload.mode,
	};
}

const TITLE_STYLE_PROMPTS: Record<TitleLength, string> = {
	short: "Use 2-4 words.",
	standard: "Use 4-6 words.",
	long: "Use 7-10 words.",
};

function sanitizeGeneratedTitle(input: string): string {
	let title = input.trim();
	if (
		(title.startsWith("\"") && title.endsWith("\"")) ||
		(title.startsWith("'") && title.endsWith("'"))
	) {
		title = title.slice(1, -1).trim();
	}

	title = title.replace(/\s+/g, " ").replace(/[.?!]+$/, "").trim();
	if (!title) return "";
	return title.slice(0, TITLE_MAX_LENGTH);
}

async function getAuthTokenFromWorkflowHeaders(headers: Headers): Promise<string | null> {
	if (!CONVEX_SITE_URL) return null;

	const cookie = headers.get("cookie");
	if (!cookie) return null;

	const response = await fetch(`${CONVEX_SITE_URL}/api/auth/convex/token`, {
		headers: { cookie },
	});
	if (!response.ok) return null;

	const data = (await response.json()) as { token?: string } | null;
	return data?.token ?? null;
}

function isLocalWorkflowRequest(request: Request): boolean {
	const hostname = new URL(request.url).hostname;
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getWorkflowTriggerHeaders(headers: Headers): Record<string, string> {
	const triggerHeaders: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const cookie = headers.get("cookie");
	if (cookie) {
		triggerHeaders.cookie = cookie;
	}
	return triggerHeaders;
}

async function runGenerateTitleInline(
	payload: GenerateTitlePayload,
	authToken: string,
): Promise<{ saved: boolean; title?: string; reason?: string }> {
	const { chatId, userId, seedText = "", length, provider, mode = "auto" } = payload;
	const convexClient = createConvexServerClient(authToken);
	const convexUserId = userId as Id<"users">;
	const convexChatId = chatId as Id<"chats">;

	const candidate = seedText.trim().slice(0, 300);
	const firstUserMessage = candidate
		? null
		: await convexClient.query(api.messages.getFirstUserMessage, {
				chatId: convexChatId,
				userId: convexUserId,
			});
	const normalizedSeed = candidate || firstUserMessage?.trim().slice(0, 300) || "";
	if (!normalizedSeed) {
		return { saved: false, reason: "empty_seed" };
	}

	const generatedTitle = await convexClient.action(api.chats.generateTitle, {
		userId: convexUserId,
		seedText: normalizedSeed,
		length,
		provider,
	});
	if (!generatedTitle) {
		if (provider === "openrouter") {
			const hasKey = await convexClient.query(api.users.hasOpenRouterKey, {
				userId: convexUserId,
			});
			if (!hasKey) {
				return { saved: false, reason: "missing_openrouter_key" };
			}
		}
		return { saved: false, reason: "generation_failed" };
	}

	const sanitizedTitle = sanitizeGeneratedTitle(generatedTitle);
	if (!sanitizedTitle) {
		return { saved: false, reason: "empty_title" };
	}

	await convexClient.mutation(api.chats.setGeneratedTitle, {
		chatId: convexChatId,
		userId: convexUserId,
		title: sanitizedTitle,
		force: mode === "manual",
	});

	return {
		saved: true,
		title: sanitizedTitle,
	};
}

const workflow = serve<GenerateTitlePayload>(async (context) => {
	const payload = await context.run("load-payload", async () => {
		const parsed = parseGenerateTitlePayload(context.requestPayload);
		if (!parsed) {
			throw new Error("Invalid payload");
		}
		return parsed;
	});
	const {
		chatId,
		userId,
		seedText = "",
		length,
		provider,
		mode = "auto",
	} = payload;

	const authToken = await context.run("resolve-auth", async () => {
		return getAuthTokenFromWorkflowHeaders(context.headers);
	});
	if (!authToken) {
		throw new Error("Unauthorized");
	}

	const convexClient = createConvexServerClient(authToken);
	const convexUserId = userId as Id<"users">;
	const convexChatId = chatId as Id<"chats">;

	const normalizedSeed = await context.run("get-messages", async () => {
		const candidate = seedText.trim().slice(0, 300);
		if (candidate) return candidate;
		const firstUserMessage = await convexClient.query(api.messages.getFirstUserMessage, {
			chatId: convexChatId,
			userId: convexUserId,
		});
		return firstUserMessage?.trim().slice(0, 300) ?? "";
	});
	if (!normalizedSeed) {
		return { saved: false, reason: "empty_seed" } as const;
	}

	const openRouterKey = await context.run("resolve-openrouter-key", async () => {
		if (provider === "osschat") {
			return process.env.OPENROUTER_API_KEY ?? null;
		}

		const encryptedKey = await convexClient.query(api.users.getOpenRouterKey, {
			userId: convexUserId,
		});
		return encryptedKey ? decryptSecret(encryptedKey) : null;
	});
	if (!openRouterKey) {
		return { saved: false, reason: "missing_openrouter_key" } as const;
	}

	const systemPrompt = [
		"Create a specific, useful chat title.",
		"Return only the title in Title Case; no quotes, no trailing punctuation.",
		"Focus on the core topic or task; avoid filler words like and, with, about.",
		TITLE_STYLE_PROMPTS[length],
	].join(" ");

	const llmResponse = await context.call<{
		choices?: Array<{ message?: { content?: string } }>;
	}>("call-llm", {
		url: "https://openrouter.ai/api/v1/chat/completions",
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${openRouterKey}`,
			"HTTP-Referer": process.env.VITE_CONVEX_SITE_URL || "https://osschat.io",
			"X-Title": "OSSChat",
		},
		body: {
			model: TITLE_MODEL_ID,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: normalizedSeed },
			],
			temperature: 0.2,
			max_tokens: 32,
		},
		retries: 2,
		timeout: "30s",
	});
	if (llmResponse.status < 200 || llmResponse.status >= 300) {
		return {
			saved: false,
			reason: `llm_status_${llmResponse.status}`,
		} as const;
	}

	const rawTitle = llmResponse.body?.choices?.[0]?.message?.content ?? "";
	const sanitizedTitle = sanitizeGeneratedTitle(rawTitle);
	if (!sanitizedTitle) {
		return { saved: false, reason: "empty_title" } as const;
	}

	await context.run("save-title", async () => {
		await convexClient.mutation(api.chats.setGeneratedTitle, {
			chatId: convexChatId,
			userId: convexUserId,
			title: sanitizedTitle,
			force: mode === "manual",
		});
	});

	return {
		saved: true,
		title: sanitizedTitle,
	};
});

export const Route = createFileRoute("/api/workflow/generate-title")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const isWorkflowCallback = Boolean(request.headers.get("upstash-signature"));
				if (isWorkflowCallback) {
					return workflow.POST({ request });
				}

				if (!isSameOrigin(request)) {
					return json({ error: "Invalid origin" }, { status: 403 });
				}

				let payloadRaw: unknown;
				try {
					payloadRaw = await request.json();
				} catch {
					return json({ error: "Invalid JSON payload" }, { status: 400 });
				}
				const payload = parseGenerateTitlePayload(payloadRaw);
				if (!payload) {
					return json({ error: "Invalid title payload" }, { status: 400 });
				}

				const authToken = await getConvexAuthToken(request);
				if (!authToken) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}
				const authUser = await getAuthUser(request);
				if (!authUser) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}
				const authConvexClient = createConvexServerClient(authToken);
				const authConvexUser = await authConvexClient.query(api.users.getByExternalId, {
					externalId: authUser.id,
				});
				if (!authConvexUser?._id) {
					return json({ error: "Unauthorized" }, { status: 401 });
				}

				if (authRatelimit) {
					const rl = await authRatelimit.limit(`generate-title:${authConvexUser._id}`);
					if (!rl.success) {
						return json({ error: "Rate limit exceeded" }, { status: 429 });
					}
				}

				const normalizedPayload: GenerateTitlePayload = {
					...payload,
					userId: authConvexUser._id,
				};

				if (isLocalWorkflowRequest(request)) {
					try {
						const result = await runGenerateTitleInline(normalizedPayload, authToken);
						if (!result.saved) {
							const status = result.reason === "missing_openrouter_key" ? 400 : 409;
							return json(result, { status });
						}
						return json(result, { status: 200 });
					} catch (error) {
						const message = error instanceof Error ? error.message : "Failed to generate title";
						const status = message === "Unauthorized" ? 401 : 500;
						return json({ error: message }, { status });
					}
				}

				if (!workflowClient) {
					return json(
						{ error: "Workflow queue is not configured (missing QSTASH_TOKEN)" },
						{ status: 500 },
					);
				}

				try {
					const headers = getWorkflowTriggerHeaders(request.headers);
					const { workflowRunId } = await workflowClient.trigger({
						url: request.url,
						body: normalizedPayload,
						headers,
					});
					return json({ queued: true, workflowRunId }, { status: 202 });
				} catch (error) {
					const message = error instanceof Error ? error.message : "Failed to queue workflow";
					return json({ error: message }, { status: 500 });
				}
			},
		},
	},
});
