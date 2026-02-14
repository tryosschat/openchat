import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";

export type StreamStatus = "idle" | "connecting" | "streaming" | "stopping" | "error" | "resuming";

interface ActiveStream {
  chatId: string;
  messageId: string;
  streamId: string;
  lastEventId: string;
  content: string;
  reasoning: string;
  startedAt: number;
}

interface PendingUserMessage {
  chatId: string;
  messageId: string;
  text: string;
  createdAt: number;
  mode: "auto-send" | "resume-only";
  resumeAt?: number;
}

interface StreamState {
  status: StreamStatus;
  convexStreamId: string | null;
  redisStreamId: string | null;
  error: string | null;

  activeMessageId: string | null;
  content: string;
  reasoning: string;

  activeStream: ActiveStream | null;
  pendingUserMessage: PendingUserMessage | null;

  startStream: (convexStreamId: string, messageId: string) => void;
  setRedisStreamId: (id: string, chatId: string) => void;
  appendContent: (chunk: string) => void;
  appendReasoning: (chunk: string) => void;
  updateLastEventId: (eventId: string) => void;
  completeStream: () => void;
  stopStream: () => void;
  errorStream: (error: string) => void;
  setResuming: () => void;
  reset: () => void;
  setPendingUserMessage: (message: PendingUserMessage) => void;
  consumePendingUserMessage: (chatId: string) => PendingUserMessage | null;
  clearPendingUserMessage: (chatId: string) => void;
  getActiveStreamForChat: (chatId: string) => ActiveStream | null;
}

const initialState = {
  status: "idle" as StreamStatus,
  convexStreamId: null,
  redisStreamId: null,
  error: null,
  activeMessageId: null,
  content: "",
  reasoning: "",
  activeStream: null,
  pendingUserMessage: null,
};

export const useStreamStore = create<StreamState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        startStream: (convexStreamId, messageId) =>
          set(
            {
              status: "connecting",
              convexStreamId,
              activeMessageId: messageId,
              content: "",
              reasoning: "",
              error: null,
            },
            false,
            "stream/start",
          ),

        setRedisStreamId: (id, chatId) =>
          set(
            (state) => ({
              redisStreamId: id,
              status: "streaming",
              activeStream: {
                chatId,
                messageId: state.activeMessageId || "",
                streamId: id,
                lastEventId: "0",
                content: state.content,
                reasoning: state.reasoning,
                startedAt: Date.now(),
              },
            }),
            false,
            "stream/redis",
          ),

        appendContent: (chunk) =>
          set(
            (state) => ({
              content: state.content + chunk,
              activeStream: state.activeStream
                ? { ...state.activeStream, content: state.activeStream.content + chunk }
                : null,
            }),
            false,
            "stream/content",
          ),

        appendReasoning: (chunk) =>
          set(
            (state) => ({
              reasoning: state.reasoning + chunk,
              activeStream: state.activeStream
                ? { ...state.activeStream, reasoning: state.activeStream.reasoning + chunk }
                : null,
            }),
            false,
            "stream/reasoning",
          ),

        updateLastEventId: (eventId) =>
          set(
            (state) => ({
              activeStream: state.activeStream
                ? { ...state.activeStream, lastEventId: eventId }
                : null,
            }),
            false,
            "stream/lastEventId",
          ),

        completeStream: () =>
          set(
            {
              status: "idle",
              convexStreamId: null,
              redisStreamId: null,
              activeMessageId: null,
              activeStream: null,
            },
            false,
            "stream/complete",
          ),

        stopStream: () =>
          set({ status: "stopping", activeStream: null }, false, "stream/stop"),

        errorStream: (error) =>
          set(
            {
              status: "error",
              error,
              convexStreamId: null,
              redisStreamId: null,
              activeStream: null,
            },
            false,
            "stream/error",
          ),

		setResuming: () => set({ status: "resuming" }, false, "stream/resuming"),


		reset: () => set(initialState, false, "stream/reset"),

		setPendingUserMessage: (message) =>
			set({ pendingUserMessage: message }, false, "stream/pending/set"),

		consumePendingUserMessage: (chatId: string) => {
			const pending = get().pendingUserMessage;
			if (pending && pending.chatId === chatId) {
				set({ pendingUserMessage: null }, false, "stream/pending/consume");
				return pending;
			}
			return null;
		},

		clearPendingUserMessage: (chatId: string) => {
			const pending = get().pendingUserMessage;
			if (pending && pending.chatId === chatId) {
				set({ pendingUserMessage: null }, false, "stream/pending/clear");
			}
		},

		getActiveStreamForChat: (chatId: string) => {
			const stream = get().activeStream;
			if (!stream) return null;
			if (stream.chatId !== chatId) return null;
			if (Date.now() - stream.startedAt > 10 * 60 * 1000) {
				set({ activeStream: null }, false, "stream/expired");
				return null;
			}
			return stream;
		},

      }),
		{
			name: "openchat-stream",
			storage: createJSONStorage(() => sessionStorage),
			partialize: (state) => ({
				// Persist only non-sensitive metadata for stream resumption.
				// Sensitive fields (content, reasoning, text) are excluded to
				// prevent exposure via XSS or local profile compromise.
				activeStream: state.activeStream
					? {
							chatId: state.activeStream.chatId,
							messageId: state.activeStream.messageId,
							streamId: state.activeStream.streamId,
							lastEventId: state.activeStream.lastEventId,
							content: "",
							reasoning: "",
							startedAt: state.activeStream.startedAt,
						}
					: null,
				pendingUserMessage: state.pendingUserMessage
					? {
							chatId: state.pendingUserMessage.chatId,
							messageId: state.pendingUserMessage.messageId,
							text: "",
							createdAt: state.pendingUserMessage.createdAt,
							mode: state.pendingUserMessage.mode,
							resumeAt: state.pendingUserMessage.resumeAt,
						}
					: null,
			}),
		},

    ),
    { name: "stream-store" },
  ),
);

export const useIsStreaming = () =>
  useStreamStore(
    (s) => s.status === "streaming" || s.status === "connecting" || s.status === "resuming",
  );

export const useStreamContent = () =>
  useStreamStore((s) => ({ content: s.content, reasoning: s.reasoning }));

export const useStreamError = () => useStreamStore((s) => s.error);

export const useActiveStream = () => useStreamStore((s) => s.activeStream);
