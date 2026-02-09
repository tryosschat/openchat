/**
 * Bulk Selection Store - Manages multi-select state for chat list
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Id } from "@server/convex/_generated/dataModel";

interface BulkSelectionState {
	// Whether bulk selection mode is active
	isSelectionMode: boolean;

	// Set of selected chat IDs
	selectedChatIds: Set<string>;

	// Actions
	enterSelectionMode: () => void;
	exitSelectionMode: () => void;
	toggleSelectionMode: () => void;
	toggleChatSelection: (chatId: Id<"chats">) => void;
	selectChat: (chatId: Id<"chats">) => void;
	deselectChat: (chatId: Id<"chats">) => void;
	selectAll: (chatIds: Array<Id<"chats">>) => void;
	deselectAll: () => void;
	getSelectedChatIds: () => Array<Id<"chats">>;
}

export const useBulkSelectionStore = create<BulkSelectionState>()(
	devtools(
		(set, get) => ({
			isSelectionMode: false,
			selectedChatIds: new Set<string>(),

			enterSelectionMode: () =>
				set({ isSelectionMode: true }, false, "bulkSelection/enterSelectionMode"),

			exitSelectionMode: () =>
				set(
					{ isSelectionMode: false, selectedChatIds: new Set<string>() },
					false,
					"bulkSelection/exitSelectionMode"
				),

			toggleSelectionMode: () =>
				set(
					(state) => ({
						isSelectionMode: !state.isSelectionMode,
						// Clear selections when exiting selection mode
						selectedChatIds: state.isSelectionMode ? new Set<string>() : state.selectedChatIds,
					}),
					false,
					"bulkSelection/toggleSelectionMode"
				),

			toggleChatSelection: (chatId) =>
				set(
					(state) => {
						const next = new Set(state.selectedChatIds);
						if (next.has(chatId)) {
							next.delete(chatId);
						} else {
							next.add(chatId);
						}
						return { selectedChatIds: next };
					},
					false,
					"bulkSelection/toggleChatSelection"
				),

			selectChat: (chatId) =>
				set(
					(state) => {
						const next = new Set(state.selectedChatIds);
						next.add(chatId);
						return { selectedChatIds: next };
					},
					false,
					"bulkSelection/selectChat"
				),

			deselectChat: (chatId) =>
				set(
					(state) => {
						const next = new Set(state.selectedChatIds);
						next.delete(chatId);
						return { selectedChatIds: next };
					},
					false,
					"bulkSelection/deselectChat"
				),

			selectAll: (chatIds) =>
				set(
					(state) => ({
						selectedChatIds: new Set([...state.selectedChatIds, ...chatIds]),
					}),
					false,
					"bulkSelection/selectAll"
				),

			deselectAll: () =>
				set({ selectedChatIds: new Set<string>() }, false, "bulkSelection/deselectAll"),

			getSelectedChatIds: () => Array.from(get().selectedChatIds) as Array<Id<"chats">>,
		}),
		{ name: "bulk-selection-store" }
	)
);
