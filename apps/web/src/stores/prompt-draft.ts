import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";

/**
 * Store for persisting prompt drafts across page reloads.
 *
 * Non-annoying approach:
 * - Drafts are saved per-chat (or "global" for new chat input)
 * - Drafts are automatically cleared when a message is sent
 * - Old drafts are cleaned up after 7 days to prevent localStorage bloat
 */

const DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GLOBAL_DRAFT_KEY = "__global__";

interface PromptDraft {
	text: string;
	updatedAt: number;
}

interface PromptDraftState {
	drafts: Record<string, PromptDraft>;
	setDraft: (chatId: string | null, text: string) => void;
	getDraft: (chatId: string | null) => string;
	clearDraft: (chatId: string | null) => void;
	clearAllDrafts: () => void;
	cleanupExpiredDrafts: () => void;
}

export const usePromptDraftStore = create<PromptDraftState>()(
	devtools(
		persist(
			(set, get) => ({
				drafts: {},

				setDraft: (chatId, text) => {
					const key = chatId ?? GLOBAL_DRAFT_KEY;

					// Don't persist empty drafts - just clear them
					if (!text.trim()) {
						set(
							(state) => {
								const { [key]: _, ...rest } = state.drafts;
								return { drafts: rest };
							},
							false,
							"prompt-draft/clear",
						);
						return;
					}

					set(
						(state) => ({
							drafts: {
								...state.drafts,
								[key]: {
									text,
									updatedAt: Date.now(),
								},
							},
						}),
						false,
						"prompt-draft/set",
					);
				},

				getDraft: (chatId) => {
					const key = chatId ?? GLOBAL_DRAFT_KEY;
					const draft = get().drafts[key] as PromptDraft | undefined;

					if (!draft) {
						return "";
					}

					// Don't return expired drafts
					if (Date.now() - draft.updatedAt < DRAFT_EXPIRY_MS) {
						return draft.text;
					}

					return "";
				},

				clearDraft: (chatId) => {
					const key = chatId ?? GLOBAL_DRAFT_KEY;
					set(
						(state) => {
							const { [key]: _, ...rest } = state.drafts;
							return { drafts: rest };
						},
						false,
						"prompt-draft/clear",
					);
				},

				clearAllDrafts: () => {
					set({ drafts: {} }, false, "prompt-draft/clear-all");
				},

				cleanupExpiredDrafts: () => {
					const now = Date.now();
					set(
						(state) => {
							const cleaned: Record<string, PromptDraft> = {};
							for (const [key, draft] of Object.entries(state.drafts)) {
								if (now - draft.updatedAt < DRAFT_EXPIRY_MS) {
									cleaned[key] = draft;
								}
							}
							return { drafts: cleaned };
						},
						false,
						"prompt-draft/cleanup",
					);
				},
			}),
			{
				name: "openchat-prompt-drafts",
				storage: createJSONStorage(() => localStorage),
			},
		),
		{ name: "prompt-draft-store" },
	),
);

// Run cleanup on store initialization
if (typeof window !== "undefined") {
	// Delay cleanup to avoid blocking initial render
	setTimeout(() => {
		usePromptDraftStore.getState().cleanupExpiredDrafts();
	}, 5000);
}
