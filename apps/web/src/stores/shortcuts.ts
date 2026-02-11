import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { ShortcutActionId } from "@/lib/shortcuts";
import { normalizeBinding } from "@/lib/shortcuts";

interface ShortcutsState {
	bindings: Partial<Record<ShortcutActionId, string>>;
	shortcutsDialogOpen: boolean;
	setBinding: (id: ShortcutActionId, binding: string) => void;
	resetBinding: (id: ShortcutActionId) => void;
	resetAllBindings: () => void;
	setShortcutsDialogOpen: (open: boolean) => void;
}

export const useShortcutsStore = create<ShortcutsState>()(
	devtools(
		persist(
			(set) => ({
				bindings: {},
				shortcutsDialogOpen: false,

				setBinding: (id, binding) => {
					const normalized = normalizeBinding(binding);
					if (!normalized) return;
					set(
						(state) => ({
							bindings: {
								...state.bindings,
								[id]: normalized,
							},
						}),
						false,
						"shortcuts/setBinding",
					);
				},

				resetBinding: (id) =>
					set(
						(state) => {
							const next = { ...state.bindings };
							delete next[id];
							return { bindings: next };
						},
						false,
						"shortcuts/resetBinding",
					),

				resetAllBindings: () => set({ bindings: {} }, false, "shortcuts/resetAllBindings"),

				setShortcutsDialogOpen: (open) =>
					set({ shortcutsDialogOpen: open }, false, "shortcuts/setDialogOpen"),
			}),
			{
				name: "shortcuts-store",
				partialize: (state) => ({
					bindings: state.bindings,
				}),
			},
		),
		{ name: "shortcuts-store" },
	),
);
