import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@server/convex/_generated/api";
import { GitForkIcon, PencilIcon, SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar";
import type {MouseEvent} from "react";
import type { Id } from "@server/convex/_generated/dataModel";
import { useAuth } from "@/lib/auth-client";
import { convexClient } from "@/lib/convex";
import { useProviderStore } from "@/stores/provider";
import { useChatTitleStore } from "@/stores/chat-title";
import { useBulkSelectionStore } from "@/stores/bulk-selection";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronRightIcon, MenuIcon, PlusIcon, SidebarIcon } from "@/components/icons";

const CHATS_CACHE_KEY = "openchat-chats-cache";
const CONTEXT_MENU_PADDING = 12;

interface ChatItem {
  _id: Id<"chats">;
  title: string;
  updatedAt: number;
  status?: string;
  forkedFromChatId?: string;
}

// Skeleton for loading chat items
function ChatItemSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2">
      <div className={cn("size-4 rounded bg-sidebar-foreground/10 animate-pulse", delay > 0 && `[animation-delay:${delay}ms]`)} style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined} />
      <div className={cn("h-4 flex-1 rounded bg-sidebar-foreground/10 animate-pulse", delay > 0 && `[animation-delay:${delay}ms]`)} style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined} />
    </div>
  );
}

function groupChatsByTime(chats: Array<ChatItem>, now: number) {
  const today: Array<ChatItem> = [];
  const last7Days: Array<ChatItem> = [];
  const last30Days: Array<ChatItem> = [];
  const older: Array<ChatItem> = [];

  const oneDayMs = 1000 * 60 * 60 * 24;

  for (const chat of chats) {
    const diffDays = Math.floor((now - chat.updatedAt) / oneDayMs);

    if (diffDays === 0) {
      today.push(chat);
    } else if (diffDays < 7) {
      last7Days.push(chat);
    } else if (diffDays < 30) {
      last30Days.push(chat);
    } else {
      older.push(chat);
    }
  }

  return { today, last7Days, last30Days, older };
}

interface ChatGroupProps {
  label: string;
  chats: Array<ChatItem>;
  currentChatId?: string;
  onChatClick: (chatId: string) => void;
  onChatContextMenu: (chatId: string, event: MouseEvent) => void;
  onQuickDelete: (chatId: string, event: React.MouseEvent) => void;
  generatingChatIds: Partial<Record<string, "auto" | "manual">>;
  editingChatId: string | null;
  editValue: string;
  onEditChange: (value: string) => void;
  onStartEdit: (chatId: string, title: string, event: React.MouseEvent) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  selectedChatIds: Set<string>;
  onSelectClick: (chatId: Id<"chats">, shiftKey: boolean) => void;
}

function ChatGroup({
  label,
  chats,
  currentChatId,
  onChatClick,
  onChatContextMenu,
  onQuickDelete,
  generatingChatIds,
  editingChatId,
  editValue,
  onEditChange,
  onStartEdit,
  onEditSubmit,
  onEditCancel,
  selectedChatIds,
  onSelectClick,
}: ChatGroupProps) {
  if (chats.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {chats.map((chat) => {
          const isSelected = selectedChatIds.has(chat._id);
          return (
            <SidebarMenuItem key={chat._id} className="relative">
              <SidebarMenuButton
                isActive={currentChatId === chat._id}
                onClick={(event) => {
                  if (editingChatId === chat._id) return;
                  if (event.shiftKey || selectedChatIds.size > 0) {
                    event.preventDefault();
                    onSelectClick(chat._id, event.shiftKey);
                    return;
                  }
                  onChatClick(chat._id);
                }}
                onContextMenu={(event) => {
                  onChatContextMenu(chat._id, event);
                }}
                className={cn(
                  "pr-8",
                  isSelected && "bg-sidebar-primary/15 border-l-2 border-sidebar-primary"
                )}
               >
                 {generatingChatIds[chat._id] ? (
                  <span className="block h-5 flex-1 rounded bg-sidebar-foreground/10 animate-pulse" />
                ) : editingChatId === chat._id ? (
                  <input
                    className="h-5 w-full bg-transparent text-sm text-sidebar-foreground outline-none"
                    value={editValue}
                    onChange={(event) => onEditChange(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onEditSubmit();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        onEditCancel();
                      }
                    }}
                    onBlur={onEditCancel}
                    autoFocus
                  />
                ) : (
                   <>
                     {chat.forkedFromChatId && (
                       <GitForkIcon className="size-3.5 shrink-0 text-sidebar-foreground/40" />
                     )}
                     <span
                       className="truncate"
                       onMouseDown={(event) => event.stopPropagation()}
                       onDoubleClick={(event) => {
                         onStartEdit(chat._id, chat.title, event);
                       }}
                     >
                       {chat.title}
                     </span>
                   </>
                 )}
              </SidebarMenuButton>
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center opacity-0 transition-opacity group-hover/menu-item:opacity-70 text-sidebar-foreground/60 hover:text-sidebar-foreground/85 z-10"
                onClick={(event) => {
                  if (event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectClick(chat._id, true);
                    return;
                  }
                  onQuickDelete(chat._id, event);
                }}
                aria-label="Delete chat"
              >
                <XIcon className="size-3.5" />
              </button>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function AppSidebar({
  variant = "inset",
  collapsible = "offcanvas",
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth();
  const { open, isMobile, setOpen, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const activeProvider = useProviderStore((s) => s.activeProvider);
  const chatTitleLength = useChatTitleStore((s) => s.length);
  const confirmDelete = useChatTitleStore((s) => s.confirmDelete);
  const generatingChatIds = useChatTitleStore((s) => s.generatingChatIds);
  const setTitleGenerating = useChatTitleStore((s) => s.setGenerating);
  const [contextMenu, setContextMenu] = useState<{
    chatId: string;
    x: number;
    y: number;
  } | null>(null);
  const [deleteChatId, setDeleteChatId] = useState<string | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editOriginal, setEditOriginal] = useState("");
  const contextMenuRef = useRef(contextMenu);
  const contextMenuElementRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  const selectedChatIds = useBulkSelectionStore((s) => s.selectedChatIds);
  const selectChat = useBulkSelectionStore((s) => s.selectChat);
  const selectMultiple = useBulkSelectionStore((s) => s.selectAll);
  const deselectAll = useBulkSelectionStore((s) => s.deselectAll);
  const getSelectedChatIds = useBulkSelectionStore((s) => s.getSelectedChatIds);
  const selectionAnchorRef = useRef<string | null>(null);

  // Get current chat ID from URL if we're on a chat page
  let currentChatId: string | undefined;
  try {
    const params = useParams({ from: "/c/$chatId", shouldThrow: false });
    currentChatId = params?.chatId;
  } catch {
    // Not on a chat page
  }

  // First, get the Convex user by Better Auth external ID
  // Skip if Convex client is not available (prevents SSR errors)
  const convexUser = useQuery(
    api.users.getByExternalId,
    convexClient && user?.id ? { externalId: user.id } : "skip",
  );

  const chatsResult = useQuery(
    api.chats.list,
    convexClient && convexUser?._id ? { userId: convexUser._id } : "skip",
  );

  const cachedChatsRef = useRef<Array<ChatItem> | null>(null);
  
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(CHATS_CACHE_KEY);
      if (stored && !cachedChatsRef.current) {
        cachedChatsRef.current = JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Failed to load chats from sessionStorage:", e);
    }
  }, []);

  useEffect(() => {
    if (chatsResult?.chats && chatsResult.chats.length > 0) {
      cachedChatsRef.current = chatsResult.chats;
      try {
        // Only cache minimal fields needed for sidebar rendering
        const minimal = chatsResult.chats.map(({ _id, title, updatedAt }) => ({ _id, title, updatedAt }));
        sessionStorage.setItem(CHATS_CACHE_KEY, JSON.stringify(minimal));
      } catch (e) {
        console.warn("Failed to save chats to sessionStorage:", e);
      }
    }
  }, [chatsResult?.chats]);

  const chats = chatsResult?.chats ?? cachedChatsRef.current ?? [];
  
  const hasCachedChats = chats.length > 0;
  
  const isLoadingChats = user?.id && !hasCachedChats
    ? convexUser === undefined || chatsResult === undefined
    : false;
    
  const dayKey = new Date().toDateString();
  const grouped = useMemo(() => groupChatsByTime(chats, Date.now()), [chats, dayKey]);
  const flatChatIds = useMemo(
    () => [...grouped.today, ...grouped.last7Days, ...grouped.last30Days, ...grouped.older].map((c) => c._id),
    [grouped],
  );
  const deleteChat = useMemo(
    () => (deleteChatId ? chats.find((chat) => chat._id === deleteChatId) : null),
    [deleteChatId, chats],
  );

  const handleSelectClick = useCallback(
    (chatId: Id<"chats">, shiftKey: boolean) => {
      if (shiftKey) {
        const anchor = selectionAnchorRef.current ?? currentChatId;
        if (anchor) {
          const anchorIdx = flatChatIds.indexOf(anchor as Id<"chats">);
          const targetIdx = flatChatIds.indexOf(chatId);
          if (anchorIdx !== -1 && targetIdx !== -1) {
            const start = Math.min(anchorIdx, targetIdx);
            const end = Math.max(anchorIdx, targetIdx);
            selectMultiple(flatChatIds.slice(start, end + 1));
            selectionAnchorRef.current = anchor;
            return;
          }
        }
      }
      selectChat(chatId);
      selectionAnchorRef.current = chatId;
    },
    [flatChatIds, currentChatId, selectChat, selectMultiple],
  );

  const handleNewChat = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    navigate({ to: "/" });
  };

  const handleChatClick = (chatId: string) => {
    if (isMobile) {
      setOpenMobile(false);
    }
    navigate({ to: "/c/$chatId", params: { chatId } });
  };

  const handleChatContextMenu = (chatId: string, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ chatId, x: event.clientX, y: event.clientY });
  };

  const handleQuickDelete = (chatId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (confirmDelete) {
      setDeleteChatId(chatId);
    } else {
      void handleDeleteChat(chatId);
    }
  };

  const handleRenameFromMenu = () => {
    if (!contextMenu) return;
    const chat = chats.find((item) => item._id === contextMenu.chatId);
    if (!chat) return;
    setContextMenu(null);
    setEditingChatId(chat._id);
    setEditValue(chat.title);
  };

  const handleStartEdit = (chatId: string, title: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setEditingChatId(chatId);
    setEditValue(title);
    setEditOriginal(title);
  };

  const handleCancelEdit = () => {
    setEditingChatId(null);
    setEditValue("");
    setEditOriginal("");
  };

  const handleSubmitEdit = async () => {
    if (!editingChatId || !convexClient || !convexUser?._id) {
      handleCancelEdit();
      return;
    }

    const nextTitle = editValue.trim();
    if (!nextTitle) {
      handleCancelEdit();
      return;
    }
    if (nextTitle === editOriginal.trim()) {
      handleCancelEdit();
      return;
    }

    await convexClient.mutation(api.chats.setTitle, {
      chatId: editingChatId as Id<"chats">,
      userId: convexUser._id,
      title: nextTitle,
      updateUpdatedAt: false,
    });

    handleCancelEdit();
  };

  const handleRegenerateTitle = async (chatId: string) => {
    if (!convexClient || !convexUser?._id) return;

    setContextMenu(null);
    setDeleteChatId(null);
    setTitleGenerating(chatId, true, "manual");
    try {
      const seedText = await convexClient.query(api.messages.getFirstUserMessage, {
        chatId: chatId as Id<"chats">,
        userId: convexUser._id,
      });

      if (!seedText) {
        toast.error("No message available to generate a name.");
        return;
      }

      const generatedTitle = await convexClient.action(api.chats.generateTitle, {
        userId: convexUser._id,
        seedText: seedText.trim().slice(0, 300),
        length: chatTitleLength,
        provider: activeProvider,
      });
      if (!generatedTitle) {
        if (activeProvider === "openrouter") {
          const hasOpenRouterKey = await convexClient.query(api.users.hasOpenRouterKey, {
            userId: convexUser._id,
          });
          if (!hasOpenRouterKey) {
            toast.error("Connect your OpenRouter API key to generate titles with this provider.");
            return;
          }
        }
        toast.error("Could not generate a chat title right now. Try again.");
        return;
      }

      await convexClient.mutation(api.chats.setGeneratedTitle, {
        chatId: chatId as Id<"chats">,
        userId: convexUser._id,
        title: generatedTitle,
        force: true,
      });
    } catch (error) {
      console.warn("[Chat] Title regeneration failed:", error);
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("too many title generations")) {
        toast.error("Too many title generations. Please try again later.");
      } else {
        toast.error("Failed to regenerate chat name");
      }
    } finally {
      setTitleGenerating(chatId, false);
    }
  };

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      if (!convexClient || !convexUser?._id) return;

      setContextMenu(null);
      setDeleteChatId(null);

      try {
        await convexClient.mutation(api.chats.remove, {
          chatId: chatId as Id<"chats">,
          userId: convexUser._id,
        });

        if (currentChatId === chatId) {
          navigate({ to: "/" });
        }
      } catch (error) {
        console.warn("[Chat] Failed to delete chat:", error);
        toast.error("Failed to delete chat");
      }
    },
    [convexClient, convexUser?._id, currentChatId, navigate],
  );

  const handleBulkDelete = useCallback(
    async () => {
      if (!convexClient || !convexUser?._id) return;

      const chatIdsToDelete = getSelectedChatIds();
      if (chatIdsToDelete.length === 0) return;

      setIsBulkDeleting(true);
      setShowBulkDeleteDialog(false);

      try {
        const result = await convexClient.mutation(api.chats.removeBulk, {
          chatIds: chatIdsToDelete,
          userId: convexUser._id,
        });

        if (result.deleted > 0) {
          toast.success(`Deleted ${result.deleted} chat${result.deleted > 1 ? "s" : ""}`);
        }

        if (result.failed > 0) {
          toast.error(`Failed to delete ${result.failed} chat${result.failed > 1 ? "s" : ""}`);
        }

        // Navigate away if current chat was deleted
        if (currentChatId && chatIdsToDelete.includes(currentChatId as Id<"chats">)) {
          navigate({ to: "/" });
        }

        deselectAll();
      } catch (error) {
        console.warn("[Chat] Failed to bulk delete chats:", error);
        if (error instanceof Error && error.name === "RateLimitError") {
          toast.error(error.message);
        } else {
          toast.error("Failed to delete chats");
        }
      } finally {
        setIsBulkDeleting(false);
      }
    },
    [convexClient, convexUser?._id, currentChatId, navigate, getSelectedChatIds, deselectAll],
  );

  useEffect(() => {
    contextMenuRef.current = contextMenu;
  }, [contextMenu]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!contextMenu || !contextMenuElementRef.current) return;
    const rect = contextMenuElementRef.current.getBoundingClientRect();
    const maxX = Math.max(CONTEXT_MENU_PADDING, window.innerWidth - rect.width - CONTEXT_MENU_PADDING);
    const maxY = Math.max(CONTEXT_MENU_PADDING, window.innerHeight - rect.height - CONTEXT_MENU_PADDING);
    const nextX = Math.min(Math.max(contextMenu.x, CONTEXT_MENU_PADDING), maxX);
    const nextY = Math.min(Math.max(contextMenu.y, CONTEXT_MENU_PADDING), maxY);

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
    }
  }, [contextMenu]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleDismiss = () => {
      if (!contextMenuRef.current) return;
      if (!isMountedRef.current) return;
      setContextMenu(null);
      setDeleteChatId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && contextMenuRef.current) {
        if (!isMountedRef.current) return;
        setContextMenu(null);
        setDeleteChatId(null);
      }
      if (event.key === "Escape" && selectedChatIds.size > 0) {
        deselectAll();
      }
    };

    window.addEventListener("click", handleDismiss);
    window.addEventListener("contextmenu", handleDismiss);
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("click", handleDismiss);
      window.removeEventListener("contextmenu", handleDismiss);
      window.removeEventListener("keydown", handleKey);
    };
  }, [deselectAll, selectedChatIds.size]);

  return (
    <>
      {/* Mobile hamburger menu - CSS-based visibility (md:hidden), no JS required */}
      <button
        onClick={() => (isMobile ? setOpenMobile(true) : setOpen(true))}
        className="fixed left-3 top-3 z-50 flex size-11 items-center justify-center rounded-xl bg-sidebar/95 shadow-lg ring-1 ring-sidebar-border/50 backdrop-blur-sm text-sidebar-foreground/70 transition-all duration-200 hover:bg-sidebar hover:text-sidebar-foreground active:scale-95 md:hidden"
        aria-label="Open menu"
      >
        <MenuIcon />
      </button>

      {/* Collapsed floating bar - desktop only, shows when sidebar is closed */}
      <div
        className={cn(
          "fixed left-3 top-3 z-50 flex items-center gap-1 rounded-xl bg-sidebar/95 p-1 shadow-lg ring-1 ring-sidebar-border/50 backdrop-blur-sm",
          "transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "hidden md:flex",
          open ? "pointer-events-none opacity-0 scale-95" : "opacity-100 scale-100",
        )}
      >
        <button
          onClick={() => setOpen(true)}
          className="flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          title="Open sidebar"
        >
          <SidebarIcon />
        </button>
        <button
          onClick={handleNewChat}
          className="flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          title="New Chat"
        >
          <PlusIcon />
        </button>
      </div>

      {/* Main sidebar */}
      <Sidebar variant={variant} collapsible={collapsible} {...props}>
        {/* Header: Toggle button left, Logo centered */}
        <div className="relative flex h-14 shrink-0 items-center justify-center px-3">
          {/* Toggle button - absolute positioned left */}
          <button
            onClick={() => (isMobile ? setOpenMobile(false) : setOpen(false))}
            className="absolute left-3 flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Close sidebar"
          >
            <SidebarIcon />
          </button>

          {/* Logo - centered */}
          <button
            onClick={handleNewChat}
            className="flex items-center transition-opacity hover:opacity-80"
          >
            <span className="text-xl font-bold tracking-tight text-sidebar-foreground">
              oss<span className="text-sidebar-primary">chat</span>
            </span>
          </button>
        </div>

        {/* New Chat Button */}
        <div className="shrink-0 px-3 pb-3">
          <Button onClick={handleNewChat} className="w-full justify-center gap-2" variant="default">
            New Chat
          </Button>
        </div>

        {/* Chat History - scrollable area that takes remaining space */}
        <SidebarContent className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
          {isLoadingChats ? (
            <div className="px-3 py-2 space-y-1">
              <ChatItemSkeleton delay={0} />
              <ChatItemSkeleton delay={75} />
              <ChatItemSkeleton delay={150} />
              <ChatItemSkeleton delay={225} />
            </div>
          ) : chats.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-sidebar-foreground/50">
              No chats yet
            </div>
          ) : (
            <>
              <ChatGroup
                label="Today"
                chats={grouped.today}
                currentChatId={currentChatId}
                onChatClick={handleChatClick}
                onChatContextMenu={handleChatContextMenu}
                onQuickDelete={handleQuickDelete}
                generatingChatIds={generatingChatIds}
                editingChatId={editingChatId}
                editValue={editValue}
                onEditChange={setEditValue}
                onStartEdit={handleStartEdit}
                onEditSubmit={handleSubmitEdit}
                onEditCancel={handleCancelEdit}
                selectedChatIds={selectedChatIds}
                onSelectClick={handleSelectClick}
              />
              <ChatGroup
                label="Last 7 days"
                chats={grouped.last7Days}
                currentChatId={currentChatId}
                onChatClick={handleChatClick}
                onChatContextMenu={handleChatContextMenu}
                onQuickDelete={handleQuickDelete}
                generatingChatIds={generatingChatIds}
                editingChatId={editingChatId}
                editValue={editValue}
                onEditChange={setEditValue}
                onStartEdit={handleStartEdit}
                onEditSubmit={handleSubmitEdit}
                onEditCancel={handleCancelEdit}
                selectedChatIds={selectedChatIds}
                onSelectClick={handleSelectClick}
              />
              <ChatGroup
                label="Last 30 days"
                chats={grouped.last30Days}
                currentChatId={currentChatId}
                onChatClick={handleChatClick}
                onChatContextMenu={handleChatContextMenu}
                onQuickDelete={handleQuickDelete}
                generatingChatIds={generatingChatIds}
                editingChatId={editingChatId}
                editValue={editValue}
                onEditChange={setEditValue}
                onStartEdit={handleStartEdit}
                onEditSubmit={handleSubmitEdit}
                onEditCancel={handleCancelEdit}
                selectedChatIds={selectedChatIds}
                onSelectClick={handleSelectClick}
              />
              <ChatGroup
                label="Older"
                chats={grouped.older}
                currentChatId={currentChatId}
                onChatClick={handleChatClick}
                onChatContextMenu={handleChatContextMenu}
                onQuickDelete={handleQuickDelete}
                generatingChatIds={generatingChatIds}
                editingChatId={editingChatId}
                editValue={editValue}
                onEditChange={setEditValue}
                onStartEdit={handleStartEdit}
                onEditSubmit={handleSubmitEdit}
                onEditCancel={handleCancelEdit}
                selectedChatIds={selectedChatIds}
                onSelectClick={handleSelectClick}
              />
            </>
          )}
        </SidebarContent>

        {selectedChatIds.size > 0 && (
          <div className="shrink-0 border-t border-sidebar-border/50 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-sm text-sidebar-foreground/70">{selectedChatIds.size} selected</span>
            <div className="flex items-center gap-1">
              <Button onClick={deselectAll} variant="ghost" size="sm" className="h-7 px-2 text-xs">Cancel</Button>
              <Button
                onClick={() => {
                  if (confirmDelete) {
                    setShowBulkDeleteDialog(true);
                  } else {
                    void handleBulkDelete();
                  }
                }}
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                disabled={isBulkDeleting}
              >
                <Trash2Icon className="size-3" />
                Delete
              </Button>
            </div>
          </div>
        )}

        {/* Footer with Profile Card - always visible, sticky at bottom */}
        <SidebarFooter className="shrink-0 p-3">
          {user && (
            <button
              onClick={() => {
                if (isMobile) setOpen(false);
                navigate({ to: "/settings" });
              }}
              className="group flex w-full items-center gap-3 rounded-xl bg-sidebar-accent/40 px-3 py-3 transition-all hover:bg-sidebar-accent/70 focus:outline-none"
            >
              {user.image ? (
                <img
                  src={user.image}
                  alt={user.name || "User"}
                  className="size-10 shrink-0 rounded-full ring-2 ring-sidebar-primary/20"
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-base font-semibold text-sidebar-primary-foreground ring-2 ring-sidebar-primary/20">
                  {(user.name || user.email || "U")[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-semibold text-sidebar-foreground">
                  {user.name || "User"}
                </div>
                <div className="truncate text-xs text-sidebar-foreground/50">Settings</div>
              </div>
              <ChevronRightIcon />
            </button>
          )}
        </SidebarFooter>
      </Sidebar>
      {contextMenu && (
        <div
          ref={contextMenuElementRef}
          className="fixed z-50 min-w-[190px] rounded-lg border border-sidebar-border/60 bg-sidebar/95 p-1 shadow-lg backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={() => handleRegenerateTitle(contextMenu.chatId)}
          >
            <SparklesIcon className="size-4" />
            Regenerate name
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={handleRenameFromMenu}
          >
            <PencilIcon className="size-4" />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive/90 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setContextMenu(null);
              if (confirmDelete) {
                setDeleteChatId(contextMenu.chatId);
              } else {
                void handleDeleteChat(contextMenu.chatId);
              }
            }}
          >
            <Trash2Icon className="size-4" />
            Delete chat
          </button>
        </div>
      )}
      <AlertDialog
        open={!!deleteChatId}
        onOpenChange={(isDialogOpen) => {
          if (!isDialogOpen) setDeleteChatId(null);
        }}
      >
        <AlertDialogContent
          size="sm"
          onKeyDown={(event) => {
            if (event.key === "Enter" && deleteChatId) {
              event.preventDefault();
              handleDeleteChat(deleteChatId);
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteChat?.title ?? "this chat"}&rdquo;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteChatId && handleDeleteChat(deleteChatId)}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog
        open={showBulkDeleteDialog}
        onOpenChange={(isDialogOpen) => {
          if (!isDialogOpen) setShowBulkDeleteDialog(false);
        }}
      >
        <AlertDialogContent
          size="sm"
          onKeyDown={(event) => {
            if (event.key === "Enter" && selectedChatIds.size > 0) {
              event.preventDefault();
              void handleBulkDelete();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedChatIds.size} chat{selectedChatIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedChatIds.size} chat{selectedChatIds.size !== 1 ? "s" : ""}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleBulkDelete()}
            >
              Delete {selectedChatIds.size} chat{selectedChatIds.size !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
