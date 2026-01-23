/**
 * UI State Store - Sidebar, modals, and UI preferences
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type FilterStyle = "names" | "icons";

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;

  // Command palette
  commandPaletteOpen: boolean;

  // Model selector filter display
  filterStyle: FilterStyle;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setFilterStyle: (style: FilterStyle) => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        sidebarOpen: true,
        sidebarCollapsed: false,
        commandPaletteOpen: false,
        filterStyle: "names" as FilterStyle,

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
      }),
      {
        name: "ui-store",
        partialize: (state) => ({
          sidebarCollapsed: state.sidebarCollapsed,
          filterStyle: state.filterStyle,
        }),
      },
    ),
    { name: "ui-store" },
  ),
);
