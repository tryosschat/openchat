export type ShortcutCategory = "general" | "navigation" | "chat";

export type ShortcutActionId =
	// General
	| "show-shortcuts"
	| "toggle-sidebar"
	| "go-to-settings"
	| "sign-out"
	// Navigation
	| "new-chat"
	| "go-to-previous-chat"
	| "go-to-next-chat"
	| "delete-chat"
	| "rename-chat"
	// Chat
	| "focus-prompt-toggle"
	| "stop-generation"
	| "copy-last-response"
	| "retry-last-message"
	| "edit-last-message"
	| "toggle-reasoning"
	| "toggle-web-search"
	| "attach-file";

export interface ShortcutDefinition {
	id: ShortcutActionId;
	category: ShortcutCategory;
	label: string;
	description: string;
	defaultBinding: {
		mac: string;
		other: string;
	};
	allowInInput?: boolean;
}

export const SHORTCUT_DEFINITIONS: Array<ShortcutDefinition> = [
	{
		id: "show-shortcuts",
		category: "general",
		label: "View keyboard shortcuts",
		description: "Open the shortcuts panel",
		defaultBinding: { mac: "meta+/", other: "ctrl+/" },
		allowInInput: true,
	},
	{
		id: "toggle-sidebar",
		category: "general",
		label: "Toggle sidebar",
		description: "Show or hide the sidebar",
		defaultBinding: { mac: "meta+b", other: "ctrl+b" },
	},
	{
		id: "go-to-settings",
		category: "general",
		label: "Open settings",
		description: "Go to the settings page",
		defaultBinding: { mac: "meta+,", other: "ctrl+," },
	},
	{
		id: "sign-out",
		category: "general",
		label: "Sign out",
		description: "Log out of your account",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "new-chat",
		category: "navigation",
		label: "New chat",
		description: "Start a new conversation",
		defaultBinding: { mac: "meta+o", other: "ctrl+o" },
	},
	{
		id: "go-to-previous-chat",
		category: "navigation",
		label: "Previous chat",
		description: "Navigate to the previous conversation",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "go-to-next-chat",
		category: "navigation",
		label: "Next chat",
		description: "Navigate to the next conversation",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "delete-chat",
		category: "navigation",
		label: "Delete chat",
		description: "Delete the current conversation",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "rename-chat",
		category: "navigation",
		label: "Rename chat",
		description: "Rename the current conversation",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "focus-prompt-toggle",
		category: "chat",
		label: "Focus prompt",
		description: "Focus or blur the chat input",
		defaultBinding: { mac: "meta+l", other: "ctrl+l" },
		allowInInput: true,
	},
	{
		id: "stop-generation",
		category: "chat",
		label: "Stop generation",
		description: "Stop the current AI response",
		defaultBinding: { mac: "meta+.", other: "ctrl+." },
	},
	{
		id: "copy-last-response",
		category: "chat",
		label: "Copy last response",
		description: "Copy the last assistant message",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "retry-last-message",
		category: "chat",
		label: "Retry last message",
		description: "Regenerate the last AI response",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "edit-last-message",
		category: "chat",
		label: "Edit last message",
		description: "Edit your last sent message",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "toggle-reasoning",
		category: "chat",
		label: "Toggle reasoning",
		description: "Enable or disable extended thinking",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "toggle-web-search",
		category: "chat",
		label: "Toggle web search",
		description: "Enable or disable web search",
		defaultBinding: { mac: "", other: "" },
	},
	{
		id: "attach-file",
		category: "chat",
		label: "Attach file",
		description: "Open the file picker",
		defaultBinding: { mac: "", other: "" },
	},
];

export const SHORTCUT_CATEGORIES: Array<{ id: ShortcutCategory; label: string }> = [
	{ id: "general", label: "General" },
	{ id: "navigation", label: "Navigation" },
	{ id: "chat", label: "Chat" },
];

export const SHORTCUT_EVENT_TOGGLE_SIDEBAR = "openchat:shortcut-toggle-sidebar";
export const SHORTCUT_EVENT_FOCUS_PROMPT_TOGGLE = "openchat:shortcut-focus-prompt-toggle";
export const SHORTCUT_EVENT_STOP_GENERATION = "openchat:shortcut-stop-generation";
export const SHORTCUT_EVENT_COPY_LAST_RESPONSE = "openchat:shortcut-copy-last-response";
export const SHORTCUT_EVENT_RETRY_LAST_MESSAGE = "openchat:shortcut-retry-last-message";
export const SHORTCUT_EVENT_EDIT_LAST_MESSAGE = "openchat:shortcut-edit-last-message";
export const SHORTCUT_EVENT_TOGGLE_REASONING = "openchat:shortcut-toggle-reasoning";
export const SHORTCUT_EVENT_TOGGLE_WEB_SEARCH = "openchat:shortcut-toggle-web-search";
export const SHORTCUT_EVENT_ATTACH_FILE = "openchat:shortcut-attach-file";
export const SHORTCUT_EVENT_DELETE_CHAT = "openchat:shortcut-delete-chat";
export const SHORTCUT_EVENT_RENAME_CHAT = "openchat:shortcut-rename-chat";
export const SHORTCUT_EVENT_GO_PREVIOUS_CHAT = "openchat:shortcut-go-previous-chat";
export const SHORTCUT_EVENT_GO_NEXT_CHAT = "openchat:shortcut-go-next-chat";

const KEY_ALIASES: Record<string, string> = {
	cmd: "meta",
	command: "meta",
	meta: "meta",
	ctrl: "ctrl",
	control: "ctrl",
	alt: "alt",
	option: "alt",
	shift: "shift",
	esc: "escape",
	return: "enter",
	del: "delete",
	spacebar: "space",
	" ": "space",
};

const DISPLAY_TOKENS: Record<string, { mac: string; other: string }> = {
	meta: { mac: "\u2318", other: "Ctrl" },
	ctrl: { mac: "Ctrl", other: "Ctrl" },
	alt: { mac: "\u2325", other: "Alt" },
	shift: { mac: "\u21E7", other: "Shift" },
	enter: { mac: "\u21A9", other: "Enter" },
	escape: { mac: "Esc", other: "Esc" },
	space: { mac: "Space", other: "Space" },
	arrowup: { mac: "\u2191", other: "\u2191" },
	arrowdown: { mac: "\u2193", other: "\u2193" },
	arrowleft: { mac: "\u2190", other: "\u2190" },
	arrowright: { mac: "\u2192", other: "\u2192" },
	backspace: { mac: "\u232B", other: "Backspace" },
	delete: { mac: "\u2326", other: "Del" },
	tab: { mac: "\u21E5", other: "Tab" },
};

const MODIFIER_ORDER = ["meta", "ctrl", "alt", "shift"];

export const RESERVED_SHORTCUT_BINDINGS = new Set([
	"meta+n",
	"ctrl+n",
	"meta+t",
	"ctrl+t",
	"meta+w",
	"ctrl+w",
	"meta+q",
	"ctrl+r",
	"meta+r",
	"meta+f",
	"ctrl+f",
]);

function normalizeKey(raw: string): string {
	const lowered = raw.trim().toLowerCase();
	if (!lowered) return "";

	if (KEY_ALIASES[lowered]) {
		return KEY_ALIASES[lowered];
	}

	if (lowered === "?") return "/";
	if (lowered === "slash") return "/";
	if (lowered === "period") return ".";

	return lowered;
}

export function normalizeBinding(rawBinding: string): string {
	const tokens = rawBinding
		.split("+")
		.map((token) => normalizeKey(token))
		.filter(Boolean);

	if (tokens.length === 0) return "";

	const unique = Array.from(new Set(tokens));
	const modifiers = MODIFIER_ORDER.filter((modifier) => unique.includes(modifier));
	const primary = unique.find((token) => !MODIFIER_ORDER.includes(token));

	if (!primary) return modifiers.join("+");
	return [...modifiers, primary].join("+");
}

export function getDefaultShortcutBinding(shortcut: ShortcutDefinition, isMac: boolean): string {
	const raw = isMac ? shortcut.defaultBinding.mac : shortcut.defaultBinding.other;
	if (!raw) return "";
	return normalizeBinding(raw);
}

export function getEffectiveBinding(
	shortcut: ShortcutDefinition,
	overrides: Partial<Record<ShortcutActionId, string>>,
	isMac: boolean,
): string {
	const override = overrides[shortcut.id];
	if (override) return normalizeBinding(override);
	return getDefaultShortcutBinding(shortcut, isMac);
}

export function getShortcutById(id: ShortcutActionId): ShortcutDefinition | undefined {
	return SHORTCUT_DEFINITIONS.find((shortcut) => shortcut.id === id);
}

export function getEffectiveBindingsMap(
	overrides: Partial<Record<ShortcutActionId, string>>,
	isMac: boolean,
): Map<string, ShortcutDefinition> {
	const map = new Map<string, ShortcutDefinition>();

	for (const shortcut of SHORTCUT_DEFINITIONS) {
		const binding = getEffectiveBinding(shortcut, overrides, isMac);
		if (binding) {
			map.set(binding, shortcut);
		}
	}

	return map;
}

export function getConflictingShortcutIds(
	targetId: ShortcutActionId,
	binding: string,
	overrides: Partial<Record<ShortcutActionId, string>>,
	isMac: boolean,
): Array<ShortcutActionId> {
	const normalized = normalizeBinding(binding);
	if (!normalized) return [];

	const conflicts: Array<ShortcutActionId> = [];

	for (const shortcut of SHORTCUT_DEFINITIONS) {
		if (shortcut.id === targetId) continue;
		const effective = getEffectiveBinding(shortcut, overrides, isMac);
		if (effective === normalized) {
			conflicts.push(shortcut.id);
		}
	}

	return conflicts;
}

export function eventToBinding(event: KeyboardEvent): string {
	const tokens: Array<string> = [];

	if (event.metaKey) tokens.push("meta");
	if (event.ctrlKey) tokens.push("ctrl");
	if (event.altKey) tokens.push("alt");
	if (event.shiftKey) tokens.push("shift");

	let key = normalizeKey(event.key);
	if (event.code === "Slash") {
		key = "/";
	}

	if (!key || MODIFIER_ORDER.includes(key)) {
		return normalizeBinding(tokens.join("+"));
	}

	tokens.push(key);
	return normalizeBinding(tokens.join("+"));
}

export function bindingHasModifier(binding: string): boolean {
	const normalized = normalizeBinding(binding);
	if (!normalized) return false;
	return normalized.split("+").some((token) => MODIFIER_ORDER.includes(token));
}

export function bindingToTokens(binding: string, isMac: boolean): Array<string> {
	const normalized = normalizeBinding(binding);
	if (!normalized) return [];

	return normalized.split("+").map((token) => {
		const mapped = DISPLAY_TOKENS[token];
		if (mapped) {
			return isMac ? mapped.mac : mapped.other;
		}

		if (token.length === 1) {
			return token.toUpperCase();
		}

		return token[0].toUpperCase() + token.slice(1);
	});
}

export function isEditableElement(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;

	if (target.closest("[contenteditable='true']")) return true;

	const tag = target.tagName.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;

	return false;
}

export function isReservedShortcutBinding(binding: string): boolean {
	return RESERVED_SHORTCUT_BINDINGS.has(normalizeBinding(binding));
}

export function isMacPlatform(): boolean {
	if (typeof window === "undefined") return false;
	return window.navigator.platform.toLowerCase().includes("mac");
}
