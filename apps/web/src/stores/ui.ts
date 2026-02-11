/**
 * UI State Store - Sidebar, modals, and UI preferences
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type FilterStyle = "company" | "model";

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;

  // Command palette
  commandPaletteOpen: boolean;

  // Model selector filter display
  filterStyle: FilterStyle;
  jonMode: boolean;
  dynamicPrompt: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setFilterStyle: (style: FilterStyle) => void;
  setJonMode: (enabled: boolean) => void;
  setDynamicPrompt: (enabled: boolean) => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        sidebarOpen: true,
        sidebarCollapsed: false,
        commandPaletteOpen: false,
        filterStyle: "model" as FilterStyle,
        jonMode: false,
        dynamicPrompt: true,

        toggleSidebar: () =>
          set((s) => ({ sidebarOpen: !s.sidebarOpen }), false, "ui/toggleSidebar"),

        setSidebarOpen: (open) => set({ sidebarOpen: open }, false, "ui/setSidebarOpen"),

        setSidebarCollapsed: (collapsed) =>
          set({ sidebarCollapsed: collapsed }, false, "ui/setSidebarCollapsed"),

        toggleCommandPalette: () =>
          set(
            (s) => ({ commandPaletteOpen: !s.commandPaletteOpen }),
            false,
            "ui/toggleCommandPalette",
          ),

        setCommandPaletteOpen: (open) =>
          set({ commandPaletteOpen: open }, false, "ui/setCommandPaletteOpen"),

        setFilterStyle: (style) =>
          set({ filterStyle: style }, false, "ui/setFilterStyle"),

        setJonMode: (enabled) =>
          set({ jonMode: enabled }, false, "ui/setJonMode"),

        setDynamicPrompt: (enabled) =>
          set({ dynamicPrompt: enabled }, false, "ui/setDynamicPrompt"),
      }),
      {
        name: "ui-store",
        partialize: (state) => ({
          sidebarCollapsed: state.sidebarCollapsed,
          filterStyle: state.filterStyle,
          jonMode: state.jonMode,
          dynamicPrompt: state.dynamicPrompt,
        }),
      },
    ),
    { name: "ui-store" },
  ),
);
