import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CircleHelpIcon, SearchIcon, SettingsIcon, XIcon } from "lucide-react";
import {
	SHORTCUT_CATEGORIES,
	SHORTCUT_DEFINITIONS,
	bindingToTokens,
	getEffectiveBinding,
	isMacPlatform,
} from "@/lib/shortcuts";
import { useShortcutsStore } from "@/stores/shortcuts";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

function ShortcutKeys({ tokens }: { tokens: Array<string> }) {
	if (tokens.length === 0) {
		return <span className="text-xs text-muted-foreground/60 italic">Not set</span>;
	}

	return (
		<span className="flex items-center gap-0.5">
			{tokens.map((token, index) => (
				<kbd
					key={`${token}-${index}`}
					className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/60 bg-muted/50 px-1.5 font-mono text-[11px] font-medium text-muted-foreground"
				>
					{token}
				</kbd>
			))}
		</span>
	);
}

export function ShortcutsDialog({ showHelpButton }: { showHelpButton: boolean }) {
	const shortcutsDialogOpen = useShortcutsStore((s) => s.shortcutsDialogOpen);
	const setShortcutsDialogOpen = useShortcutsStore((s) => s.setShortcutsDialogOpen);
	const bindings = useShortcutsStore((s) => s.bindings);
	const navigate = useNavigate();
	const [search, setSearch] = useState("");

	// Reset search when dialog opens
	useEffect(() => {
		if (shortcutsDialogOpen) {
			setSearch("");
		}
	}, [shortcutsDialogOpen]);

	const isMac = useMemo(() => isMacPlatform(), []);

	const filteredGroups = useMemo(() => {
		const query = search.toLowerCase().trim();

		return SHORTCUT_CATEGORIES.map((category) => {
			const items = SHORTCUT_DEFINITIONS.filter(
				(shortcut) => shortcut.category === category.id,
			)
				.map((shortcut) => {
					const binding = getEffectiveBinding(shortcut, bindings, isMac);
					return {
						id: shortcut.id,
						label: shortcut.label,
						description: shortcut.description,
						tokens: bindingToTokens(binding, isMac),
					};
				})
				.filter((shortcut) => {
					if (!query) return true;
					return (
						shortcut.label.toLowerCase().includes(query) ||
						shortcut.description.toLowerCase().includes(query)
					);
				});

			return { category, items };
		}).filter((group) => group.items.length > 0);
	}, [bindings, isMac, search]);

	return (
		<>
			{showHelpButton && (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="outline"
								size="icon-sm"
								className="fixed right-4 bottom-4 z-40 rounded-full border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-xs hover:text-foreground"
								onClick={() => setShortcutsDialogOpen(true)}
								aria-label="Open keyboard shortcuts"
							/>
						}
					>
						<CircleHelpIcon className="size-4" />
					</TooltipTrigger>
					<TooltipContent side="left" sideOffset={8}>
						Keyboard shortcuts
					</TooltipContent>
				</Tooltip>
			)}

			<Sheet open={shortcutsDialogOpen} onOpenChange={setShortcutsDialogOpen}>
				<SheetContent
					side="right"
					showCloseButton={false}
					className="sm:max-w-md gap-0 p-0 flex flex-col"
				>
					{/* Header */}
					<SheetHeader className="flex-row items-center justify-between gap-2 border-b border-border/50 px-5 py-4">
						<SheetTitle className="text-sm font-semibold tracking-tight">
							Keyboard shortcuts
						</SheetTitle>
						<SheetClose
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									className="text-muted-foreground hover:text-foreground -mr-1"
								/>
							}
						>
							<XIcon className="size-4" />
							<span className="sr-only">Close</span>
						</SheetClose>
					</SheetHeader>

					{/* Search */}
					<div className="border-b border-border/50 px-5 py-3">
						<div className="relative">
							<SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
							<input
								type="text"
								placeholder="Search shortcuts…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="h-8 w-full rounded-md border border-border/50 bg-muted/30 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-border focus:bg-muted/50 transition-colors"
							/>
						</div>
					</div>

					{/* Shortcut list */}
					<div className="flex-1 overflow-y-auto">
						{filteredGroups.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-16 text-muted-foreground/60">
								<SearchIcon className="mb-2 size-5" />
								<p className="text-sm">No shortcuts found</p>
							</div>
						) : (
							<div className="py-2">
								{filteredGroups.map((group) => (
									<section key={group.category.id}>
										<h3 className="px-5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
											{group.category.label}
										</h3>
										<div>
											{group.items.map((shortcut) => (
												<div
													key={shortcut.id}
													className="flex items-center justify-between gap-4 px-5 py-1.5 hover:bg-muted/30 transition-colors"
												>
													<span className="truncate text-sm text-foreground/90">
														{shortcut.label}
													</span>
													<ShortcutKeys tokens={shortcut.tokens} />
												</div>
											))}
										</div>
									</section>
								))}
							</div>
						)}
					</div>

					{/* Footer */}
					<div className="border-t border-border/50 px-5 py-3">
						<button
							type="button"
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
							onClick={() => {
								setShortcutsDialogOpen(false);
								navigate({ to: "/settings" });
							}}
						>
							<SettingsIcon className="size-3.5" />
							Edit shortcuts
						</button>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
