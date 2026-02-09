import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@server/convex/_generated/api";
import { toast } from "sonner";
import type { Id } from "@server/convex/_generated/dataModel";
import type { UIMessage } from "ai";
import { useAuth } from "@/lib/auth-client";
import { getModelById, getModelCapabilities, useModelStore, useModels } from "@/stores/model";
import { useProviderStore } from "@/stores/provider";
import { useChatTitleStore } from "@/stores/chat-title";
import { useStreamStore } from "@/stores/stream";
import { analytics } from "@/lib/analytics";

interface ChatFileAttachment {
	type: "file";
	mediaType: string;
	filename?: string;
	url: string;
}

export interface UsePersistentChatOptions {
	chatId?: string;
	onChatCreated?: (chatId: string) => void;
}

export interface UsePersistentChatReturn {
	messages: Array<UIMessage>;
	sendMessage: (message: { text: string; files?: Array<ChatFileAttachment> }) => Promise<void>;
	editMessage: (messageId: string, newContent: string) => Promise<void>;
	retryMessage: (messageId: string, overrideModelId?: string) => Promise<void>;
	forkMessage: (messageId: string, overrideModelId?: string) => Promise<string | undefined>;
	status: "ready" | "submitted" | "streaming" | "error";
	error: Error | undefined;
	stop: () => void;
	isNewChat: boolean;
	isLoadingMessages: boolean;
	isUserLoading: boolean;
	chatId: string | null;
	isResuming: boolean;
	resumedContent: string;
}

interface StreamingState {
	id: string;
	content: string;
	reasoning: string;
	chainHash: string;
}

interface ReasoningPartWithState {
	type: "reasoning";
	text: string;
	state?: "streaming" | "done";
}

type ToolPartState =
	| "input-streaming"
	| "input-available"
	| "output-available"
	| "output-error";

interface ConvexChainOfThoughtPart {
	type: "reasoning" | "tool";
	index: number;
	text?: string;
	toolName?: string;
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

function isReasoningPart(part: unknown): part is ReasoningPartWithState {
	return (
		typeof part === "object" &&
		part !== null &&
		"type" in part &&
		(part as { type: string }).type === "reasoning"
	);
}

function hasStreamingState(part: unknown): boolean {
	return isReasoningPart(part) && part.state === "streaming";
}

function getReasoningText(part: unknown): string | undefined {
	return isReasoningPart(part) ? part.text : undefined;
}

const TITLE_GENERATION_RETRY_DELAY_MS = 1500;

function sanitizeToolName(toolName: string | undefined): string {
	if (!toolName || toolName.trim().length === 0) return "tool";
	return toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeToolState(
	state: string | undefined,
	isStreaming: boolean,
): ToolPartState {
	if (
		state === "input-streaming" ||
		state === "input-available" ||
		state === "output-available" ||
		state === "output-error"
	) {
		return state;
	}
	return isStreaming ? "input-streaming" : "input-available";
}

function normalizeMessageParts({
	content,
	reasoning,
	reasoningRequested = false,
	chainOfThoughtParts,
	isStreaming = false,
}: {
	content: string;
	reasoning?: string;
	reasoningRequested?: boolean;
	chainOfThoughtParts?: Array<ConvexChainOfThoughtPart>;
	isStreaming?: boolean;
}): UIMessage["parts"] {
	const parts: UIMessage["parts"] = [];
	const orderedChainParts = [...(chainOfThoughtParts ?? [])].sort((a, b) => a.index - b.index);

	if (orderedChainParts.length > 0) {
		for (const chainPart of orderedChainParts) {
				if (chainPart.type === "reasoning") {
					if (!reasoningRequested) continue;
					const reasoningText = chainPart.text ?? "";
					if (!reasoningText && !isStreaming) continue;
				const reasoningPart: ReasoningPartWithState = {
					type: "reasoning",
					text: reasoningText,
					state: chainPart.state === "streaming" ? "streaming" : "done",
				};
				parts.push(reasoningPart as UIMessage["parts"][number]);
				continue;
			}

			const toolName = sanitizeToolName(chainPart.toolName);
			const toolPart = {
				type: `tool-${toolName}`,
				toolCallId:
					chainPart.toolCallId ?? `${toolName}-${chainPart.index}`,
				state: normalizeToolState(chainPart.state, isStreaming),
				input: chainPart.input,
				output: chainPart.output,
				errorText: chainPart.errorText,
			};
			parts.push(toolPart as UIMessage["parts"][number]);
		}
	} else if (reasoningRequested) {
		const reasoningPart: ReasoningPartWithState = {
			type: "reasoning",
			text: reasoning ?? "",
			state: isStreaming ? "streaming" : "done",
		};
		parts.push(reasoningPart as UIMessage["parts"][number]);
	}

	parts.push({
		type: "text",
		text: content,
		state: isStreaming ? "streaming" : "done",
	});

	return parts;
}

function normalizeStreamingReasoningState(
	parts: UIMessage["parts"],
	reasoningRequested: boolean,
): UIMessage["parts"] {
	const normalizedParts = parts
		.map((part) => {
			if (part.type === "reasoning" && part.state === "streaming") {
				return { ...part, state: "done" as const };
			}
			return part;
		});

	if (reasoningRequested) {
		return normalizedParts;
	}

	return normalizedParts.filter(
		(part) => !(part.type === "reasoning" && !getReasoningText(part)),
	);
}

function convexMessageToUIMessage(msg: {
	_id: string;
	clientMessageId?: string;
	role: string;
	content: string;
	reasoning?: string;
	chainOfThoughtParts?: Array<ConvexChainOfThoughtPart>;
	status?: string;
	thinkingTimeSec?: number;
	reasoningRequested?: boolean;
	reasoningTokenCount?: number;
	modelId?: string;
	provider?: string;
	reasoningEffort?: string;
	webSearchEnabled?: boolean;
	webSearchUsed?: boolean;
	webSearchCallCount?: number;
	toolCallCount?: number;
	maxSteps?: number;
	createdAt: number;
}): UIMessage {
	return {
		id: msg.clientMessageId || msg._id,
		role: msg.role as "user" | "assistant",
		metadata: {
			serverMessageId: msg._id,
			clientMessageId: msg.clientMessageId,
			thinkingTimeSec: msg.thinkingTimeSec,
			reasoningRequested: msg.reasoningRequested,
			reasoningTokenCount: msg.reasoningTokenCount,
			modelId: msg.modelId,
			provider: msg.provider,
			reasoningEffort: msg.reasoningEffort,
			webSearchEnabled: msg.webSearchEnabled,
			webSearchUsed: msg.webSearchUsed,
			webSearchCallCount: msg.webSearchCallCount,
			toolCallCount: msg.toolCallCount,
			maxSteps: msg.maxSteps,
			resumedFromActiveStream: msg.status === "streaming",
		},
		parts: normalizeMessageParts({
			content: msg.content,
			reasoning: msg.reasoning,
			reasoningRequested: msg.reasoningRequested,
			chainOfThoughtParts: msg.chainOfThoughtParts,
			isStreaming: msg.status === "streaming",
		}),
	};
}

export function usePersistentChat({
	chatId,
	onChatCreated,
}: UsePersistentChatOptions): UsePersistentChatReturn {
	const isMountedRef = useRef(true);
	const { user } = useAuth();
	const { models } = useModels();
	const activeProvider = useProviderStore((s) => s.activeProvider);
	const webSearchEnabled = useProviderStore((s) => s.webSearchEnabled);
	const chatTitleLength = useChatTitleStore((s) => s.length);
	const setTitleGenerating = useChatTitleStore((s) => s.setGenerating);

	const [messages, setMessages] = useState<Array<UIMessage>>([]);
	const [status, setStatus] = useState<"ready" | "submitted" | "streaming" | "error">("ready");
	const [error, setError] = useState<Error | undefined>(undefined);
	const [currentChatId, setCurrentChatId] = useState<string | null>(chatId ?? null);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	const chatIdRef = useRef<string | null>(chatId ?? null);
	const streamingRef = useRef<StreamingState | null>(null);

	const onChatCreatedRef = useRef(onChatCreated);
	useEffect(() => {
		onChatCreatedRef.current = onChatCreated;
	}, [onChatCreated]);

	useEffect(() => {
		if (chatId) {
			chatIdRef.current = chatId;
			setCurrentChatId(chatId);
		}
	}, [chatId]);

	const convexUser = useQuery(
		api.users.getByExternalId,
		user?.id ? { externalId: user.id } : "skip",
	);
	const convexUserId = convexUser?._id;

	const messagesResult = useQuery(
		api.messages.list,
		chatId && convexUserId ? { chatId: chatId as Id<"chats">, userId: convexUserId } : "skip",
	);

	const activeStreamJob = useQuery(
		api.backgroundStream.getActiveStreamJob,
		chatId && convexUserId ? { chatId: chatId as Id<"chats">, userId: convexUserId } : "skip",
	);

	const createChat = useMutation(api.chats.create);
	const sendMessages = useMutation(api.messages.send);
	const editAndRegenerate = useMutation(api.messages.editAndRegenerate);
	const retryMessageMut = useMutation(api.messages.retryMessage);
	const forkChatMut = useMutation(api.chats.fork);
	const updateTitle = useMutation(api.chats.updateTitle);
	const generateTitle = useAction(api.chats.generateTitle);
	const startBackgroundStream = useMutation(api.backgroundStream.startStream);
	const cleanupStaleJobs = useMutation(api.backgroundStream.cleanupStaleJobs);

	const isNewChat = !chatId;

	useEffect(() => {
		if (!messagesResult || status === "streaming" || status === "submitted") return;
		
		setMessages((prevMessages) => {
			const convexMessages = messagesResult.map(convexMessageToUIMessage);
			
			if (prevMessages.length === 0) {
				return convexMessages;
			}
			
			const lastPrev = prevMessages[prevMessages.length - 1];
			const isLastPrevStreaming = lastPrev.id.startsWith("resume-") || 
				(lastPrev.role === "assistant" && !messagesResult.find(m => m._id === lastPrev.id));
			
			if (isLastPrevStreaming && convexMessages.length > 0) {
				const lastConvex = convexMessages[convexMessages.length - 1];
				if (lastConvex.role === "assistant") {
					return [
						...convexMessages.slice(0, -1),
						{ ...lastConvex, id: lastPrev.id }
					];
				}
			}
			
			return convexMessages;
		});
	}, [messagesResult, status]);

	useEffect(() => {
		if (!activeStreamJob) {
			if (status === "streaming" || status === "submitted") {
				if (streamingRef.current) {
					const streamId = streamingRef.current.id;
					setMessages((prev) => {
						const idx = prev.findIndex((m) => m.id === streamId);
						if (idx < 0) return prev;
						const msg = prev[idx];
						const hasStreamingReasoning = msg.parts.some(
							(p) => hasStreamingState(p)
						);
						if (!hasStreamingReasoning) return prev;
						const metadata = msg.metadata as { reasoningRequested?: unknown } | undefined;
						const reasoningRequested = metadata?.reasoningRequested === true;
						const parts = normalizeStreamingReasoningState(msg.parts, reasoningRequested);
						const updated = [...prev];
						updated[idx] = { ...updated[idx], parts };
						return updated;
					});
				}
				setStatus("ready");
				streamingRef.current = null;
				useStreamStore.getState().completeStream();
			}
			return;
		}

		if (activeStreamJob.status === "completed" || activeStreamJob.status === "error") {
			if (status === "streaming") {
				setStatus("ready");
				streamingRef.current = null;
				useStreamStore.getState().completeStream();
			}
			return;
		}

		const streamId = activeStreamJob.messageId;
		const jobContent = activeStreamJob.content || "";
		const jobReasoning = activeStreamJob.reasoning || "";
		const jobReasoningRequested =
			activeStreamJob.reasoningRequested === true ||
			activeStreamJob.options?.enableReasoning === true;
		const jobChainParts =
			(activeStreamJob.chainOfThoughtParts as Array<ConvexChainOfThoughtPart> | undefined) ?? [];
		const jobChainHash = JSON.stringify(jobChainParts);
		const isJobRunning = true;

		if (status !== "streaming" && status !== "submitted") {
			setStatus("streaming");
			useStreamStore.getState().setResuming();
		}

		if (!streamingRef.current || streamingRef.current.id !== streamId) {
			streamingRef.current = {
				id: streamId,
				content: jobContent,
				reasoning: jobReasoning,
				chainHash: jobChainHash,
			};

			setMessages((prev) => {
				if (prev.find(m => m.id === streamId)) return prev;
				const parts = normalizeMessageParts({
					content: jobContent,
					reasoning: jobReasoning,
					reasoningRequested: jobReasoningRequested,
					chainOfThoughtParts: jobChainParts,
					isStreaming: isJobRunning,
				});
				return [
					...prev,
					{
						id: streamId,
						role: "assistant" as const,
						parts,
						metadata: {
							thinkingTimeSec: activeStreamJob.thinkingTimeSec,
							reasoningRequested: jobReasoningRequested,
							reasoningTokenCount: activeStreamJob.reasoningTokenCount,
							modelId: activeStreamJob.model,
							provider: activeStreamJob.provider,
							reasoningEffort: activeStreamJob.options?.reasoningEffort,
							webSearchEnabled: activeStreamJob.options?.enableWebSearch,
							webSearchUsed: activeStreamJob.webSearchUsed,
							webSearchCallCount: activeStreamJob.webSearchCallCount,
							toolCallCount: activeStreamJob.toolCallCount,
							resumedFromActiveStream: true,
						},
					},
				];
			});
		} else if (
			streamingRef.current.content !== jobContent ||
			streamingRef.current.reasoning !== jobReasoning ||
			streamingRef.current.chainHash !== jobChainHash
		) {
			streamingRef.current.content = jobContent;
			streamingRef.current.reasoning = jobReasoning;
			streamingRef.current.chainHash = jobChainHash;

			setMessages((prev) => {
				const idx = prev.findIndex((m) => m.id === streamId);
				if (idx < 0) return prev;
				const parts = normalizeMessageParts({
					content: jobContent,
					reasoning: jobReasoning,
					reasoningRequested: jobReasoningRequested,
					chainOfThoughtParts: jobChainParts,
					isStreaming: isJobRunning,
				});
				const previousHash = JSON.stringify(prev[idx].parts);
				const nextHash = JSON.stringify(parts);
				if (previousHash === nextHash) return prev;

				const updated = [...prev];
					updated[idx] = {
						...updated[idx],
						parts,
						metadata: {
								thinkingTimeSec: activeStreamJob.thinkingTimeSec,
								reasoningRequested: jobReasoningRequested,
								reasoningTokenCount: activeStreamJob.reasoningTokenCount,
							modelId: activeStreamJob.model,
							provider: activeStreamJob.provider,
							reasoningEffort: activeStreamJob.options?.reasoningEffort,
							webSearchEnabled: activeStreamJob.options?.enableWebSearch,
							webSearchUsed: activeStreamJob.webSearchUsed,
							webSearchCallCount: activeStreamJob.webSearchCallCount,
							toolCallCount: activeStreamJob.toolCallCount,
							resumedFromActiveStream: true,
						},
					};
					return updated;
			});
		}
	}, [activeStreamJob, status]);



	const isUserLoading = !!(user?.id && convexUser === undefined);

	const handleSendMessage = useCallback(
		async (message: { text: string; files?: Array<ChatFileAttachment> }) => {
			if (!convexUserId) {
				if (isUserLoading) {
					toast.error("Please wait", { description: "Setting up your account." });
				} else if (!user?.id) {
					toast.error("Sign in required");
				} else {
					toast.error("Account sync failed");
				}
				return;
			}

			if (!message.text.trim()) return;

			const providerState = useProviderStore.getState();
			const modelState = useModelStore.getState();
			const runtimeModelId = modelState.selectedModelId;
			const runtimeReasoningEnabled = modelState.reasoningEnabled;
			const runtimeReasoningEffort = runtimeReasoningEnabled ? "medium" : "none";
			const runtimeModel = getModelById(models, runtimeModelId);
			const runtimeSupportsToolCalls = getModelCapabilities(
				runtimeModelId,
				runtimeModel,
			).supportsTools;
			if (providerState.activeProvider === "osschat" && providerState.isOverLimit()) {
				toast.error("Daily limit reached", { description: "Add your OpenRouter API key to continue." });
				return;
			}

			let targetChatId = chatIdRef.current;

			if (!targetChatId) {
				try {
					const result = await createChat({ userId: convexUserId, title: "New Chat" });
					targetChatId = result.chatId;
					chatIdRef.current = targetChatId;
					setCurrentChatId(targetChatId);
					analytics.chatCreated();
					onChatCreatedRef.current?.(targetChatId);
			} catch {
				toast.error("Failed to create chat");
				return;
			}
			}

			const userMsgId = crypto.randomUUID();
			const assistantMsgId = crypto.randomUUID();
			const userCreatedAt = Date.now();

			setMessages((prev) => [
				...prev,
				{ id: userMsgId, role: "user", parts: [{ type: "text", text: message.text }] },
			]);
			setStatus("submitted");
			setError(undefined);
			analytics.messageSent(runtimeModelId);

			sendMessages({
				chatId: targetChatId as Id<"chats">,
				userId: convexUserId,
				userMessage: { content: message.text, clientMessageId: userMsgId, createdAt: userCreatedAt },
			}).catch(() => {
				toast.error("Message may not be saved", {
					description: "We could not persist your message. Please resend if it is missing after refresh.",
				});
			});

			try {
				await cleanupStaleJobs({ userId: convexUserId }).catch(() => {});

				const allMsgs = messages.map((m) => {
					const textPart = m.parts.find((p): p is { type: "text"; text: string } => p.type === "text");
					return { role: m.role, content: textPart?.text || "" };
				});
				allMsgs.push({ role: "user", content: message.text });

				await startBackgroundStream({
					chatId: targetChatId as Id<"chats">,
					userId: convexUserId,
					messageId: assistantMsgId,
					model: runtimeModelId,
					provider: activeProvider,
					messages: allMsgs,
						options: {
							enableReasoning: runtimeReasoningEnabled,
							reasoningEffort: runtimeReasoningEffort,
							enableWebSearch: webSearchEnabled,
							supportsToolCalls: runtimeSupportsToolCalls,
						},
					});

				setStatus("streaming");
				streamingRef.current = { id: assistantMsgId, content: "", reasoning: "", chainHash: "[]" };

				const initialParts: UIMessage["parts"] = [];
				if (runtimeReasoningEffort !== "none") {
					const reasoningPart: ReasoningPartWithState = { type: "reasoning", text: "", state: "streaming" };
				initialParts.push(reasoningPart as UIMessage["parts"][number]);
				}
				initialParts.push({ type: "text", text: "", state: "streaming" });

				setMessages((prev) => [
					...prev,
					{
						id: assistantMsgId,
						role: "assistant",
						parts: initialParts,
						metadata: {
							reasoningRequested: runtimeReasoningEffort !== "none",
							modelId: runtimeModelId,
							provider: activeProvider,
							reasoningEffort: runtimeReasoningEffort,
							webSearchEnabled,
							resumedFromActiveStream: false,
						},
					},
				]);

				if (!chatId) {
					const seedText = message.text.trim().slice(0, 300);
					if (seedText) {
						void (async () => {
							if (!targetChatId) return;

							const attemptGenerate = async () => {
								try {
									const generatedTitle = await generateTitle({
										userId: convexUserId,
										seedText,
										length: chatTitleLength,
										provider: activeProvider,
									});

									if (generatedTitle) {
										await updateTitle({
											chatId: targetChatId as Id<"chats">,
											userId: convexUserId,
											title: generatedTitle,
										});
										return { status: "success" } as const;
									}
									return { status: "empty" } as const;
								} catch (err) {
								const parsedError = err instanceof Error ? err : new Error(String(err));
								return {
									status: "error",
									message: parsedError.message,
									name: parsedError.name,
									} as const;
								}
							};

							if (isMountedRef.current) {
								setTitleGenerating(targetChatId, true, "auto");
							}
							try {
								const result = await attemptGenerate();
								if (result.status === "error") {
									const isRateLimit = result.name === "RateLimitError";
									if (!isRateLimit) {
										await new Promise((resolve) =>
											setTimeout(resolve, TITLE_GENERATION_RETRY_DELAY_MS)
										);
										const retryResult = await attemptGenerate();
										if (retryResult.status === "error") {
											if (isMountedRef.current) {
												toast.error("Failed to generate chat name");
											}
										}
									} else {
										if (isMountedRef.current) {
											toast.error(result.message || "Rate limit reached. Try again later.");
										}
									}
								}
							} finally {
								if (isMountedRef.current) {
									setTitleGenerating(targetChatId, false);
								}
							}
						})();
					}
				}
			} catch (err) {
				const parsedError = err instanceof Error ? err : new Error("Unknown error");
				setError(parsedError);
				setStatus("error");
				const errorMessage = parsedError.message.toLowerCase();
				if (errorMessage.includes("search") && errorMessage.includes("limit")) {
					toast.error("Search limit reached", {
						description: "You've used your daily web searches. Limit resets tomorrow.",
					});
				} else if (errorMessage.includes("web search") && errorMessage.includes("unavailable")) {
					toast.error("Web search unavailable", {
						description: "Web search is temporarily unavailable. Try again shortly.",
					});
				} else if (
					errorMessage.includes("stream already in progress") ||
					errorMessage.includes("current request")
				) {
					toast.error("Response still in progress", {
						description: "Wait for the current response to finish, then send again.",
					});
				} else if (errorMessage.includes("daily") && errorMessage.includes("limit")) {
					toast.error("Daily limit reached", {
						description: "Add your OpenRouter API key to continue.",
					});
				} else {
					toast.error("Failed to send message", {
						description: parsedError.message,
					});
				}
			}
		},
			[
				convexUserId, isUserLoading, user?.id, chatId, messages, models,
				activeProvider, webSearchEnabled, chatTitleLength,
				setTitleGenerating, createChat, sendMessages, updateTitle, generateTitle, startBackgroundStream,
				cleanupStaleJobs,
			],
		);

	const editMessage = useCallback(
		async (messageId: string, newContent: string) => {
			if (!convexUserId || !chatIdRef.current) return;

			const trimmedContent = newContent.trim();
			if (!trimmedContent) return;

			const providerState = useProviderStore.getState();
			const modelState = useModelStore.getState();
			const runtimeModelId = modelState.selectedModelId;
			const runtimeReasoningEnabled = modelState.reasoningEnabled;
			const runtimeReasoningEffort = runtimeReasoningEnabled ? "medium" : "none";
			const runtimeModel = getModelById(models, runtimeModelId);
			const runtimeSupportsToolCalls = getModelCapabilities(
				runtimeModelId,
				runtimeModel,
			).supportsTools;

			if (providerState.activeProvider === "osschat" && providerState.isOverLimit()) {
				toast.error("Daily limit reached", { description: "Add your OpenRouter API key to continue." });
				return;
			}

			const targetChatId = chatIdRef.current as Id<"chats">;
			const editedMessageDoc = messagesResult?.find(
				(msg) => msg._id === messageId || msg.clientMessageId === messageId,
			);

			if (!editedMessageDoc) {
				toast.error("Could not edit message", {
					description: "Message is not synced yet. Please try again in a second.",
				});
				return;
			}

			setError(undefined);
			setStatus("submitted");

			try {
				await editAndRegenerate({
					chatId: targetChatId,
					userId: convexUserId,
					messageId: editedMessageDoc._id,
					newContent: trimmedContent,
				});

				streamingRef.current = null;
				useStreamStore.getState().completeStream();

				const editedIndex = messages.findIndex((m) => {
					if (m.id === messageId) return true;
					const metadata = m.metadata as { serverMessageId?: unknown; clientMessageId?: unknown } | undefined;
					return (
						metadata?.serverMessageId === editedMessageDoc._id ||
						metadata?.clientMessageId === messageId
					);
				});

				if (editedIndex < 0) {
					throw new Error("Edited message not found in local state");
				}

				const keptMessages = messages
					.slice(0, editedIndex + 1)
					.map((m, index) => {
						if (index !== editedIndex) return m;
						const metadata = m.metadata as { reasoningRequested?: unknown } | undefined;
						return {
							...m,
							parts: normalizeMessageParts({
								content: trimmedContent,
								reasoningRequested: metadata?.reasoningRequested === true,
								isStreaming: false,
							}),
						};
					});

				setMessages(keptMessages);

				await cleanupStaleJobs({ userId: convexUserId }).catch(() => {});

				const assistantMsgId = crypto.randomUUID();
				const allMsgs = keptMessages
					.filter((m) => m.role === "user" || m.role === "assistant")
					.map((m) => {
						const textPart = m.parts.find((p): p is { type: "text"; text: string } => p.type === "text");
						return { role: m.role, content: textPart?.text || "" };
					});

				await startBackgroundStream({
					chatId: targetChatId,
					userId: convexUserId,
					messageId: assistantMsgId,
					model: runtimeModelId,
					provider: activeProvider,
					messages: allMsgs,
					options: {
						enableReasoning: runtimeReasoningEnabled,
						reasoningEffort: runtimeReasoningEffort,
						enableWebSearch: webSearchEnabled,
						supportsToolCalls: runtimeSupportsToolCalls,
					},
				});

				const initialParts: UIMessage["parts"] = [];
				if (runtimeReasoningEffort !== "none") {
					const reasoningPart: ReasoningPartWithState = { type: "reasoning", text: "", state: "streaming" };
					initialParts.push(reasoningPart as UIMessage["parts"][number]);
				}
				initialParts.push({ type: "text", text: "", state: "streaming" });

				setMessages((prev) => [
					...prev,
					{
						id: assistantMsgId,
						role: "assistant",
						parts: initialParts,
						metadata: {
							reasoningRequested: runtimeReasoningEffort !== "none",
							modelId: runtimeModelId,
							provider: activeProvider,
							reasoningEffort: runtimeReasoningEffort,
							webSearchEnabled,
							resumedFromActiveStream: false,
						},
					},
				]);

				setStatus("streaming");
				streamingRef.current = { id: assistantMsgId, content: "", reasoning: "", chainHash: "[]" };
			} catch (err) {
				const parsedError = err instanceof Error ? err : new Error("Unknown error");
				setError(parsedError);
				setStatus("error");
				toast.error("Failed to edit message", {
					description: parsedError.message,
				});
			}
		},
		[
			convexUserId,
			messages,
			messagesResult,
			models,
			activeProvider,
			webSearchEnabled,
			editAndRegenerate,
			startBackgroundStream,
			cleanupStaleJobs,
		],
	);

	const retryMessage = useCallback(
		async (messageId: string, overrideModelId?: string) => {
			if (!convexUserId || !chatIdRef.current) return;

			const providerState = useProviderStore.getState();
			const modelState = useModelStore.getState();
			const runtimeModelId = overrideModelId || modelState.selectedModelId;
			const runtimeReasoningEnabled = modelState.reasoningEnabled;
			const runtimeReasoningEffort = runtimeReasoningEnabled ? "medium" : "none";
			const runtimeModel = getModelById(models, runtimeModelId);
			const runtimeSupportsToolCalls = getModelCapabilities(
				runtimeModelId,
				runtimeModel,
			).supportsTools;

			if (providerState.activeProvider === "osschat" && providerState.isOverLimit()) {
				toast.error("Daily limit reached", { description: "Add your OpenRouter API key to continue." });
				return;
			}

			const targetChatId = chatIdRef.current as Id<"chats">;
			const retriedMessageDoc = messagesResult?.find(
				(msg) => msg._id === messageId || msg.clientMessageId === messageId,
			);

			if (!retriedMessageDoc) {
				toast.error("Could not retry message", {
					description: "Message is not synced yet. Please try again in a second.",
				});
				return;
			}

			setError(undefined);
			setStatus("submitted");

			try {
				const result = await retryMessageMut({
					chatId: targetChatId,
					userId: convexUserId,
					messageId: retriedMessageDoc._id,
				});

				streamingRef.current = null;
				useStreamStore.getState().completeStream();

				const retriedIndex = messages.findIndex((m) => {
					if (m.id === messageId) return true;
					const metadata = m.metadata as { serverMessageId?: unknown; clientMessageId?: unknown } | undefined;
					return (
						metadata?.serverMessageId === retriedMessageDoc._id ||
						metadata?.clientMessageId === messageId
					);
				});

				if (retriedIndex < 0) {
					throw new Error("Retried message not found in local state");
				}

				const keptMessages = messages.slice(0, retriedIndex + 1).map((m, index) => {
					if (index !== retriedIndex) return m;
					const metadata = m.metadata as { reasoningRequested?: unknown } | undefined;
					return {
						...m,
						parts: normalizeMessageParts({
							content: result.userContent,
							reasoningRequested: metadata?.reasoningRequested === true,
							isStreaming: false,
						}),
					};
				});

				setMessages(keptMessages);

				await cleanupStaleJobs({ userId: convexUserId }).catch(() => {});

				const assistantMsgId = crypto.randomUUID();
				const allMsgs = keptMessages
					.filter((m) => m.role === "user" || m.role === "assistant")
					.map((m) => {
						const textPart = m.parts.find((p): p is { type: "text"; text: string } => p.type === "text");
						return { role: m.role, content: textPart?.text || "" };
					});

				await startBackgroundStream({
					chatId: targetChatId,
					userId: convexUserId,
					messageId: assistantMsgId,
					model: runtimeModelId,
					provider: activeProvider,
					messages: allMsgs,
					options: {
						enableReasoning: runtimeReasoningEnabled,
						reasoningEffort: runtimeReasoningEffort,
						enableWebSearch: webSearchEnabled,
						supportsToolCalls: runtimeSupportsToolCalls,
					},
				});

				const initialParts: UIMessage["parts"] = [];
				if (runtimeReasoningEffort !== "none") {
					const reasoningPart: ReasoningPartWithState = { type: "reasoning", text: "", state: "streaming" };
					initialParts.push(reasoningPart as UIMessage["parts"][number]);
				}
				initialParts.push({ type: "text", text: "", state: "streaming" });

				setMessages((prev) => [
					...prev,
					{
						id: assistantMsgId,
						role: "assistant",
						parts: initialParts,
						metadata: {
							reasoningRequested: runtimeReasoningEffort !== "none",
							modelId: runtimeModelId,
							provider: activeProvider,
							reasoningEffort: runtimeReasoningEffort,
							webSearchEnabled,
							resumedFromActiveStream: false,
						},
					},
				]);

				setStatus("streaming");
				streamingRef.current = { id: assistantMsgId, content: "", reasoning: "", chainHash: "[]" };
			} catch (err) {
				const parsedError = err instanceof Error ? err : new Error("Unknown error");
				setError(parsedError);
				setStatus("error");
				toast.error("Failed to retry message", {
					description: parsedError.message,
				});
			}
		},
		[
			convexUserId,
			messages,
			messagesResult,
			models,
			activeProvider,
			webSearchEnabled,
			retryMessageMut,
			startBackgroundStream,
			cleanupStaleJobs,
		],
	);

	const forkMessage = useCallback(
		async (messageId: string, overrideModelId?: string) => {
			if (!convexUserId || !chatIdRef.current) return undefined;

			const providerState = useProviderStore.getState();
			const modelState = useModelStore.getState();
			const runtimeModelId = overrideModelId || modelState.selectedModelId;
			const runtimeReasoningEnabled = modelState.reasoningEnabled;
			const runtimeReasoningEffort = runtimeReasoningEnabled ? "medium" : "none";
			const runtimeModel = getModelById(models, runtimeModelId);
			const runtimeSupportsToolCalls = getModelCapabilities(
				runtimeModelId,
				runtimeModel,
			).supportsTools;

			if (providerState.activeProvider === "osschat" && providerState.isOverLimit()) {
				toast.error("Daily limit reached", {
					description: "Add your OpenRouter API key to continue.",
				});
				return undefined;
			}

			const forkIdx = messages.findIndex((message) => {
				if (message.id === messageId) return true;
				const metadata = message.metadata as
					| { serverMessageId?: unknown; clientMessageId?: unknown }
					| undefined;
				return (
					metadata?.serverMessageId === messageId ||
					metadata?.clientMessageId === messageId
				);
			});

			if (forkIdx < 0) {
				toast.error("Could not branch off", {
					description: "Message is not synced yet. Please try again in a second.",
				});
				return undefined;
			}

			const msgsUpToFork = messages
				.slice(0, forkIdx + 1)
				.filter((message) => message.role === "user" || message.role === "assistant")
				.map((message) => {
					const textPart = message.parts.find(
						(part): part is { type: "text"; text: string } => part.type === "text",
					);
					return { role: message.role, content: textPart?.text || "" };
				});

			try {
				const { newChatId } = await forkChatMut({
					chatId: chatIdRef.current as Id<"chats">,
					userId: convexUserId,
					messageId,
				});

				await cleanupStaleJobs({ userId: convexUserId }).catch(() => {});

				const assistantMsgId = crypto.randomUUID();
				await startBackgroundStream({
					chatId: newChatId,
					userId: convexUserId,
					messageId: assistantMsgId,
					model: runtimeModelId,
					provider: activeProvider,
					messages: msgsUpToFork,
					options: {
						enableReasoning: runtimeReasoningEnabled,
						reasoningEffort: runtimeReasoningEffort,
						enableWebSearch: webSearchEnabled,
						supportsToolCalls: runtimeSupportsToolCalls,
					},
				});

				return newChatId;
			} catch (err) {
				const parsedError = err instanceof Error ? err : new Error("Unknown error");
				toast.error("Failed to branch off", {
					description: parsedError.message,
				});
				return undefined;
			}
		},
		[
			convexUserId,
			messages,
			models,
			activeProvider,
			webSearchEnabled,
			forkChatMut,
			cleanupStaleJobs,
			startBackgroundStream,
		],
	);

	const stop = useCallback(() => {
		setStatus("ready");
		streamingRef.current = null;
		useStreamStore.getState().completeStream();
	}, []);

	return {
		messages,
		sendMessage: handleSendMessage,
		editMessage,
		retryMessage,
		forkMessage,
		status,
		error,
		stop,
		isNewChat,
		isLoadingMessages: chatId ? messagesResult === undefined : false,
		isUserLoading,
		chatId: currentChatId,
		isResuming: status === "streaming" && !!activeStreamJob,
		resumedContent: streamingRef.current?.content || "",
	};
}
