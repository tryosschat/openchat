import { useEffect, useMemo } from "react";
import type { NavigateFn } from "@tanstack/react-router";
import {
	type ShortcutActionId,
	type ShortcutDefinition,
	eventToBinding,
	getEffectiveBindingsMap,
	isEditableElement,
	isMacPlatform,
	SHORTCUT_EVENT_FOCUS_PROMPT_TOGGLE,
	SHORTCUT_EVENT_STOP_GENERATION,
	SHORTCUT_EVENT_TOGGLE_SIDEBAR,
	SHORTCUT_EVENT_COPY_LAST_RESPONSE,
	SHORTCUT_EVENT_RETRY_LAST_MESSAGE,
	SHORTCUT_EVENT_EDIT_LAST_MESSAGE,
	SHORTCUT_EVENT_TOGGLE_REASONING,
	SHORTCUT_EVENT_TOGGLE_WEB_SEARCH,
	SHORTCUT_EVENT_ATTACH_FILE,
	SHORTCUT_EVENT_DELETE_CHAT,
	SHORTCUT_EVENT_RENAME_CHAT,
	SHORTCUT_EVENT_GO_PREVIOUS_CHAT,
	SHORTCUT_EVENT_GO_NEXT_CHAT,
} from "@/lib/shortcuts";
import { useUIStore } from "@/stores/ui";
import { useShortcutsStore } from "@/stores/shortcuts";
import { signOut } from "@/lib/auth-client";

interface UseGlobalShortcutsOptions {
	navigate: NavigateFn;
	isAuthenticated: boolean;
	pathname: string;
}

function isChatRoute(pathname: string): boolean {
	return pathname === "/" || pathname.startsWith("/c/");
}

const CHAT_ONLY_SHORTCUTS = new Set<ShortcutActionId>([
	"focus-prompt-toggle",
	"stop-generation",
	"copy-last-response",
	"retry-last-message",
	"edit-last-message",
	"toggle-reasoning",
	"toggle-web-search",
	"attach-file",
	"delete-chat",
	"rename-chat",
	"go-to-previous-chat",
	"go-to-next-chat",
]);

function closeAllOverlays() {
	useUIStore.getState().setCommandPaletteOpen(false);
	useShortcutsStore.getState().setShortcutsDialogOpen(false);
}

function runShortcutAction(id: ShortcutActionId, navigate: NavigateFn) {
	const shortcuts = useShortcutsStore.getState();

	switch (id) {
		case "show-shortcuts": {
			const wasOpen = shortcuts.shortcutsDialogOpen;
			closeAllOverlays();
			if (!wasOpen) shortcuts.setShortcutsDialogOpen(true);
			return;
		}
		case "new-chat":
			closeAllOverlays();
			navigate({ to: "/" });
			return;
		case "go-to-settings":
			closeAllOverlays();
			navigate({ to: "/settings" });
			return;
		case "sign-out":
			closeAllOverlays();
			void signOut();
			return;
		case "toggle-sidebar":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_TOGGLE_SIDEBAR));
			return;
		case "focus-prompt-toggle":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_FOCUS_PROMPT_TOGGLE));
			return;
		case "stop-generation":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_STOP_GENERATION));
			return;
		case "copy-last-response":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_COPY_LAST_RESPONSE));
			return;
		case "retry-last-message":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_RETRY_LAST_MESSAGE));
			return;
		case "edit-last-message":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_EDIT_LAST_MESSAGE));
			return;
		case "toggle-reasoning":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_TOGGLE_REASONING));
			return;
		case "toggle-web-search":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_TOGGLE_WEB_SEARCH));
			return;
		case "attach-file":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_ATTACH_FILE));
			return;
		case "delete-chat":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_DELETE_CHAT));
			return;
		case "rename-chat":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_RENAME_CHAT));
			return;
		case "go-to-previous-chat":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_GO_PREVIOUS_CHAT));
			return;
		case "go-to-next-chat":
			window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT_GO_NEXT_CHAT));
			return;
		default: {
			const _exhaustiveCheck: never = id;
			return _exhaustiveCheck;
		}
	}
}

export function useGlobalShortcuts({ navigate, isAuthenticated, pathname }: UseGlobalShortcutsOptions) {
	const bindings = useShortcutsStore((state) => state.bindings);
	const isMac = useMemo(() => isMacPlatform(), []);
	const onChatRoute = isChatRoute(pathname);

	useEffect(() => {
		const bindingMap = getEffectiveBindingsMap(bindings, isMac);

		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || event.repeat || event.isComposing) return;

			const currentBinding = eventToBinding(event);
			if (!currentBinding) return;

			const matched: ShortcutDefinition | undefined = bindingMap.get(currentBinding);
			if (!matched) return;

			if (!isAuthenticated) return;
			if (!onChatRoute && CHAT_ONLY_SHORTCUTS.has(matched.id)) return;
			if (isEditableElement(event.target) && !matched.allowInInput) return;

			event.preventDefault();
			runShortcutAction(matched.id, navigate);
		}

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [bindings, isAuthenticated, isMac, navigate, onChatRoute]);
}
