import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { serve } from "@upstash/workflow/tanstack";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { createConvexServerClient } from "@/lib/convex-server";
import { getAuthUser, getConvexAuthToken, isSameOrigin } from "@/lib/server-auth";
import {
	authRatelimit,
	shouldFailClosedForMissingUpstash,
	workflowClient,
} from "@/lib/upstash";
import { getWorkflowAuthToken, storeWorkflowAuthToken } from "@/lib/workflow-auth-token";

const TITLE_MODEL_ID = "google/gemini-2.5-flash-lite";
const TITLE_MAX_LENGTH = 200;
const OPENROUTER_CALL_TIMEOUT_MS = 30_000;

type TitleLength = "short" | "standard" | "long";
type TitleProvider = "osschat" | "openrouter";

type GenerateTitlePayload = {
	chatId: string;
	userId: string;
	authTokenRef?: string;
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
		authTokenRef: typeof payload.authTokenRef === "string" ? payload.authTokenRef : undefined,
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

function isLocalWorkflowExecutionEnabled(): boolean {
	return process.env.NODE_ENV !== "production";
}

function getWorkflowTriggerHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
	};
}

function hasWorkflowSigningKeysConfigured(): boolean {
	return Boolean(
		process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY,
	);
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

	const authTokenRef = payload.authTokenRef;
	if (!authTokenRef) {
		return { saved: false, reason: "unauthorized" } as const;
	}

	const authToken = await context.run("resolve-auth", async () => {
		return getWorkflowAuthToken(authTokenRef);
	});
	if (!authToken) {
		return { saved: false, reason: "unauthorized" } as const;
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

	if (provider !== "osschat") {
		return { saved: false, reason: "unsupported_provider" } as const;
	}

	const openRouterKey = process.env.OPENROUTER_API_KEY ?? null;
	if (!openRouterKey) {
		return { saved: false, reason: "missing_openrouter_key" } as const;
	}

	const systemPrompt = [
		"Create a specific, useful chat title.",
		"Return only the title in Title Case; no quotes, no trailing punctuation.",
		"Focus on the core topic or task; avoid filler words like and, with, about.",
		TITLE_STYLE_PROMPTS[length],
	].join(" ");

	const llmResponse = await context.run("call-llm", async () => {
		let response: Response;
		try {
			response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${openRouterKey}`,
					"HTTP-Referer": process.env.VITE_CONVEX_SITE_URL || "https://osschat.io",
					"X-Title": "OSSChat",
				},
				body: JSON.stringify({
					model: TITLE_MODEL_ID,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: normalizedSeed },
					],
					temperature: 0.2,
					max_tokens: 32,
				}),
				signal: AbortSignal.timeout(OPENROUTER_CALL_TIMEOUT_MS),
			});
		} catch {
			return { status: 0, body: null };
		}

		let body: { choices?: Array<{ message?: { content?: string } }> } | null = null;
		if (response.ok) {
			try {
				body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
			} catch {
				body = null;
			}
		}

		return { status: response.status, body };
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
					if (!hasWorkflowSigningKeysConfigured()) {
						return json({ error: "Workflow signing not configured" }, { status: 500 });
					}
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

				if (shouldFailClosedForMissingUpstash()) {
					return json({ error: "Service temporarily unavailable" }, { status: 503 });
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

				if (normalizedPayload.provider === "openrouter") {
					try {
						const result = await runGenerateTitleInline(normalizedPayload, authToken);
						if (!result.saved) {
							const status = result.reason === "missing_openrouter_key" ? 400 : 422;
							return json(result, { status });
						}
						return json(result, { status: 200 });
					} catch (error) {
						const message = error instanceof Error ? error.message : "Failed to generate title";
						const status = message === "Unauthorized" ? 401 : 500;
						if (status === 500) {
							console.error("[Workflow][generate-title] Inline generation failed", error);
						}
						return json({ error: status === 500 ? "Internal server error" : message }, { status });
					}
				}

				if (isLocalWorkflowExecutionEnabled()) {
					try {
						const result = await runGenerateTitleInline(normalizedPayload, authToken);
						if (!result.saved) {
							const status = result.reason === "missing_openrouter_key" ? 400 : 422;
							return json(result, { status });
						}
						return json(result, { status: 200 });
					} catch (error) {
						const message = error instanceof Error ? error.message : "Failed to generate title";
						const status = message === "Unauthorized" ? 401 : 500;
						if (status === 500) {
							console.error("[Workflow][generate-title] Local execution failed", error);
						}
						return json({ error: status === 500 ? "Internal server error" : message }, { status });
					}
				}

				if (!workflowClient) {
					return json(
						{ error: "Workflow queue is not configured (missing QSTASH_TOKEN)" },
						{ status: 500 },
					);
				}

				try {
					const authTokenRef = await storeWorkflowAuthToken(authToken);
					if (!authTokenRef) {
						return json(
							{ error: "Workflow auth cache is not configured" },
							{ status: 500 },
						);
					}

					const headers = getWorkflowTriggerHeaders();
					const { workflowRunId } = await workflowClient.trigger({
						url: request.url,
						body: {
							...normalizedPayload,
							authTokenRef,
						},
						headers,
					});
					return json({ queued: true, workflowRunId }, { status: 202 });
				} catch (error) {
					console.error("[Workflow][generate-title] Queue trigger failed", error);
					return json({ error: "Internal server error" }, { status: 500 });
				}
			},
		},
	},
});
