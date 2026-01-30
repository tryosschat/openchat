import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@server/convex/_generated/api";
import { toast } from "sonner";
import type { Id } from "@server/convex/_generated/dataModel";
import type { UIMessage } from "ai";
import { useAuth } from "@/lib/auth-client";
import { useModelStore } from "@/stores/model";
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
}

interface ReasoningPartWithState {
	type: "reasoning";
	text: string;
	state?: "streaming" | "done";
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

function convexMessageToUIMessage(msg: {
	_id: string;
	clientMessageId?: string;
	role: string;
	content: string;
	reasoning?: string;
	createdAt: number;
}): UIMessage {
	const parts: UIMessage["parts"] = [];

	if (msg.reasoning) {
		parts.push({ type: "reasoning", text: msg.reasoning });
	}

	if (msg.content) {
		parts.push({ type: "text", text: msg.content });
	}

	return {
		id: msg.clientMessageId || msg._id,
		role: msg.role as "user" | "assistant",
		parts,
	};
}

export function usePersistentChat({
	chatId,
	onChatCreated,
}: UsePersistentChatOptions): UsePersistentChatReturn {
	const isMountedRef = useRef(true);
	const { user } = useAuth();
	const { selectedModelId, reasoningEffort, maxSteps } = useModelStore();
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
	const updateTitle = useMutation(api.chats.updateTitle);
	const generateTitle = useAction(api.chats.generateTitle);
	const startBackgroundStream = useMutation(api.backgroundStream.startStream);

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
						const parts = msg.parts
							.map((p) =>
								p.type === "reasoning"
									? { ...p, state: "done" as const }
									: p
							)
							.filter((p) => !(p.type === "reasoning" && !getReasoningText(p)));
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

		if (status !== "streaming" && status !== "submitted") {
			console.log("[BackgroundStream] Detected running stream job, resuming UI...");
			setStatus("streaming");
			useStreamStore.getState().setResuming();
		}

		if (!streamingRef.current || streamingRef.current.id !== streamId) {
			streamingRef.current = { id: streamId, content: jobContent, reasoning: jobReasoning };

			setMessages((prev) => {
				if (prev.find(m => m.id === streamId)) return prev;
				const parts: UIMessage["parts"] = [];
				if (jobReasoning) {
					parts.push({ type: "reasoning", text: jobReasoning, state: "streaming" } as ReasoningPartWithState as UIMessage["parts"][number]);
				}
				parts.push({ type: "text" as const, text: jobContent });
				return [
					...prev,
					{ id: streamId, role: "assistant" as const, parts },
				];
			});
		} else if (
			streamingRef.current.content !== jobContent ||
			streamingRef.current.reasoning !== jobReasoning
		) {
			streamingRef.current.content = jobContent;
			streamingRef.current.reasoning = jobReasoning;

			setMessages((prev) => {
				const idx = prev.findIndex((m) => m.id === streamId);
				if (idx < 0) return prev;

					const currentText = prev[idx].parts.find(p => p.type === "text");
					const currentReasoning = prev[idx].parts.find(p => p.type === "reasoning");
				const textSame = currentText && "text" in currentText && currentText.text === jobContent;
				const reasoningSame = currentReasoning && getReasoningText(currentReasoning) === jobReasoning;
				if (textSame && (reasoningSame || (!jobReasoning && !currentReasoning))) {
					return prev;
				}

				const isJobRunning = activeStreamJob.status === "running";
				const parts: UIMessage["parts"] = [];
				if (jobReasoning) {
					const reasoningPart: ReasoningPartWithState = { type: "reasoning", text: jobReasoning, state: isJobRunning ? "streaming" : "done" };
				parts.push(reasoningPart as UIMessage["parts"][number]);
				}
				parts.push({ type: "text", text: jobContent });

				const updated = [...prev];
				updated[idx] = { ...updated[idx], parts };
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
				} catch (e) {
					console.error("Failed to create chat:", e);
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
			analytics.messageSent(selectedModelId);

			sendMessages({
				chatId: targetChatId as Id<"chats">,
				userId: convexUserId,
				userMessage: { content: message.text, clientMessageId: userMsgId, createdAt: userCreatedAt },
			}).catch(console.error);

			try {
				const allMsgs = messages.map((m) => {
					const textPart = m.parts.find((p): p is { type: "text"; text: string } => p.type === "text");
					return { role: m.role, content: textPart?.text || "" };
				});
				allMsgs.push({ role: "user", content: message.text });

				await startBackgroundStream({
					chatId: targetChatId as Id<"chats">,
					userId: convexUserId,
					messageId: assistantMsgId,
					model: selectedModelId,
					provider: activeProvider,
					messages: allMsgs,
					options: {
						reasoningEffort,
						enableWebSearch: webSearchEnabled,
						maxSteps,
					},
				});

				setStatus("streaming");
				streamingRef.current = { id: assistantMsgId, content: "", reasoning: "" };

				const initialParts: UIMessage["parts"] = [];
				if (reasoningEffort !== "none") {
					const reasoningPart: ReasoningPartWithState = { type: "reasoning", text: "", state: "streaming" };
				initialParts.push(reasoningPart as UIMessage["parts"][number]);
				}
				initialParts.push({ type: "text", text: "" });

				setMessages((prev) => [
					...prev,
					{ id: assistantMsgId, role: "assistant", parts: initialParts },
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
									console.warn("[Chat] Title generation failed:", err);
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
				console.error("[Chat] Error:", err);
				const parsedError = err instanceof Error ? err : new Error("Unknown error");
				setError(parsedError);
				setStatus("error");
				const errorMessage = parsedError.message.toLowerCase();
				if (errorMessage.includes("daily") && errorMessage.includes("limit")) {
					toast.error("Daily limit reached", {
						description: "Add your OpenRouter API key to continue.",
					});
				} else {
					toast.error("Failed to send message");
				}
			}
		},
		[
			convexUserId, isUserLoading, user?.id, chatId, messages, selectedModelId,
			activeProvider, webSearchEnabled, reasoningEffort, maxSteps, chatTitleLength,
			setTitleGenerating, createChat, sendMessages, updateTitle, generateTitle, startBackgroundStream,
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
