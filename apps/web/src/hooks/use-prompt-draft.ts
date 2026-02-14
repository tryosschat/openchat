import { useCallback, useEffect, useRef } from "react";
import { usePromptDraftStore } from "@/stores/prompt-draft";

/**
 * Hook for syncing prompt input with sessionStorage-backed draft persistence.
 *
 * Features:
 * - Debounced saves (300ms) to avoid excessive storage writes
 * - Per-chat drafts (chatId can be null for new chat)
 * - Auto-restores draft on mount
 * - Auto-clears draft on unmount when text is empty
 *
 * Usage:
 * ```tsx
 * const { clearDraft } = usePromptDraft({
 *   chatId,
 *   textInputController,
 * });
 * ```
 */

interface UsePromptDraftOptions {
	/** Chat ID for per-chat drafts. null for new chat/global draft */
	chatId: string | null;
	/** Text input controller from usePromptInputController() */
	textInputController: {
		value: string;
		setInput: (v: string) => void;
	};
}

const DEBOUNCE_MS = 300;

export function usePromptDraft({ chatId, textInputController }: UsePromptDraftOptions) {
	const { getDraft, setDraft, clearDraft: clearStoredDraft } = usePromptDraftStore();

	// Track the timeout for debouncing
	const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Track if we've already restored the draft (to avoid overwriting user input)
	const hasRestoredRef = useRef(false);

	// Restore draft on mount or when chatId changes
	useEffect(() => {
		// Reset restoration flag when chatId changes
		hasRestoredRef.current = false;

		const savedDraft = getDraft(chatId);
		if (savedDraft) {
			hasRestoredRef.current = true;
			textInputController.setInput(savedDraft);
		}

		// Cleanup debounce on unmount
		return () => {
			if (debounceTimeoutRef.current) {
				clearTimeout(debounceTimeoutRef.current);
			}
		};
	}, [chatId, getDraft, textInputController.setInput]);

	// Clear draft (called after successful submit)
	const clearDraft = useCallback(() => {
		// Clear any pending save
		if (debounceTimeoutRef.current) {
			clearTimeout(debounceTimeoutRef.current);
		}
		clearStoredDraft(chatId);
	}, [chatId, clearStoredDraft]);

	// Sync text changes to sessionStorage (debounced)
	// Using chatId and setDraft directly to avoid re-running on saveDraft recreation
	useEffect(() => {
		// Only save after initial restoration
		if (hasRestoredRef.current) {
			// Clear any existing timeout
			if (debounceTimeoutRef.current) {
				clearTimeout(debounceTimeoutRef.current);
			}

			// Schedule a new save
			debounceTimeoutRef.current = setTimeout(() => {
				setDraft(chatId, textInputController.value);
			}, DEBOUNCE_MS);
		}
	}, [textInputController.value, chatId, setDraft]);

	return {
		clearDraft,
	};
}
