import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { serve } from "@upstash/workflow/tanstack";
import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { createConvexServerClient } from "@/lib/convex-server";
import { getAuthUser, getConvexAuthToken, isSameOrigin } from "@/lib/server-auth";
import { exportRatelimit, workflowClient } from "@/lib/upstash";

const CONVEX_SITE_URL =
	process.env.VITE_CONVEX_SITE_URL || process.env.CONVEX_SITE_URL;

type ExportFormat = "markdown" | "json";
type ExportChatPayload = {
	chatId: string;
	userId: string;
	format?: ExportFormat;
};

type ChatExportData = {
	chat: {
		_id: string;
		title: string;
		createdAt: number;
		updatedAt: number;
	};
	messages: Array<{
		_id: string;
		role: string;
		content: string;
		createdAt: number;
		reasoning?: string;
		attachments?: Array<{
			filename: string;
			contentType: string;
			size: number;
			uploadedAt: number;
			url?: string;
		}>;
	}>;
};

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

function parseExportPayload(raw: unknown): ExportChatPayload | null {
	if (!raw || typeof raw !== "object") return null;

	const payload = raw as Record<string, unknown>;
	if (typeof payload.chatId !== "string" || payload.chatId.trim().length === 0) {
		return null;
	}
	if (typeof payload.userId !== "string" || payload.userId.trim().length === 0) {
		return null;
	}

	let format: ExportFormat | undefined;
	if (payload.format !== undefined) {
		if (payload.format !== "markdown" && payload.format !== "json") {
			return null;
		}
		format = payload.format;
	}

	return {
		chatId: payload.chatId.trim(),
		userId: payload.userId.trim(),
		format,
	};
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

function formatExportMarkdown(data: ChatExportData): string {
	const lines: string[] = [];
	lines.push(`# ${data.chat.title}`);
	lines.push("");
	lines.push(`- Chat ID: ${data.chat._id}`);
	lines.push(`- Created: ${new Date(data.chat.createdAt).toISOString()}`);
	lines.push(`- Updated: ${new Date(data.chat.updatedAt).toISOString()}`);
	lines.push("");
	lines.push("---");
	lines.push("");

	for (const message of data.messages) {
		const role = message.role === "assistant" ? "Assistant" : "User";
		lines.push(`## ${role} (${new Date(message.createdAt).toISOString()})`);
		lines.push("");
		lines.push(message.content || "_No content_");
		lines.push("");

		if (message.reasoning) {
			lines.push("### Reasoning");
			lines.push("");
			lines.push(message.reasoning);
			lines.push("");
		}

		if (message.attachments && message.attachments.length > 0) {
			lines.push("### Attachments");
			for (const attachment of message.attachments) {
				lines.push(`- ${attachment.filename} (${attachment.contentType}, ${attachment.size} bytes)`);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

async function runExportChatInline(
	payload: ExportChatPayload,
	authToken: string,
): Promise<{ downloadUrl: string; byteLength: number; fileName: string }> {
	const { chatId, userId, format = "markdown" } = payload;
	const convexClient = createConvexServerClient(authToken);
	const chatExportData = await convexClient.query(api.chats.getChatExportData, {
		chatId: chatId as Id<"chats">,
		userId: userId as Id<"users">,
	});
	if (!chatExportData) {
		throw new Error("Chat not found");
	}

	const formattedExport =
		format === "json"
			? JSON.stringify(chatExportData, null, 2)
			: formatExportMarkdown(chatExportData);
	const mimeType = format === "json" ? "application/json" : "text/markdown";
	const base64 = Buffer.from(formattedExport, "utf8").toString("base64");

	return {
		downloadUrl: `data:${mimeType};base64,${base64}`,
		byteLength: Buffer.byteLength(formattedExport, "utf8"),
		fileName: `chat-export-${chatId}.${format === "json" ? "json" : "md"}`,
	};
}

const workflow = serve<ExportChatPayload>(async (context) => {
	const { chatId, userId, format = "markdown" } = context.requestPayload;

	const authToken = await context.run("resolve-auth", async () => {
		return getAuthTokenFromWorkflowHeaders(context.headers);
	});
	if (!authToken) {
		throw new Error("Unauthorized");
	}

	const convexClient = createConvexServerClient(authToken);
	const chatExportData = await context.run("gather-messages", async () => {
		return convexClient.query(api.chats.getChatExportData, {
			chatId: chatId as Id<"chats">,
			userId: userId as Id<"users">,
		});
	});
	if (!chatExportData) {
		throw new Error("Chat not found");
	}

	const formattedExport = await context.run("format-export", async () => {
		if (format === "json") {
			return JSON.stringify(chatExportData, null, 2);
		}
		return formatExportMarkdown(chatExportData);
	});

	const uploadResult = await context.run("upload", async () => {
		const mimeType = format === "json" ? "application/json" : "text/markdown";
		const base64 = Buffer.from(formattedExport, "utf8").toString("base64");
		return {
			downloadUrl: `data:${mimeType};base64,${base64}`,
			byteLength: Buffer.byteLength(formattedExport, "utf8"),
			fileName: `chat-export-${chatId}.${format === "json" ? "json" : "md"}`,
		};
	});

	return context.run("notify", async () => {
		return uploadResult;
	});
});

export const Route = createFileRoute("/api/workflow/export-chat")({
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

				if (exportRatelimit) {
					const rl = await exportRatelimit.limit(`export-chat:${authConvexUser._id}`);
					if (!rl.success) {
						return json({ error: "Rate limit exceeded" }, { status: 429 });
					}
				}

				let payloadRaw: unknown;
				try {
					payloadRaw = await request.json();
				} catch {
					return json({ error: "Invalid JSON payload" }, { status: 400 });
				}
				const payload = parseExportPayload(payloadRaw);
				if (!payload) {
					return json({ error: "Invalid export payload" }, { status: 400 });
				}
				const normalizedPayload: ExportChatPayload = {
					...payload,
					userId: authConvexUser._id,
				};

				if (isLocalWorkflowRequest(request)) {
					try {
						const result = await runExportChatInline(normalizedPayload, authToken);
						return json(result, { status: 200 });
					} catch (error) {
						const message = error instanceof Error ? error.message : "Failed to export chat";
						const status =
							message === "Unauthorized" ? 401 : message === "Chat not found" ? 404 : 500;
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
					const triggerHeaders = getWorkflowTriggerHeaders(request.headers);
					const { workflowRunId } = await workflowClient.trigger({
						url: request.url,
						body: normalizedPayload,
						headers: triggerHeaders,
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
