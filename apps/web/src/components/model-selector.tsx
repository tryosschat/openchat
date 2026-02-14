import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { Model } from "@/stores/model";
import { cn } from "@/lib/utils";
import { getModelById, useModelStore, useModels } from "@/stores/model";
import { useFavoriteModels } from "@/hooks/use-favorite-models";
import { useUIStore } from "@/stores/ui";
import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import { ModelInfoPanel } from "@/components/model-info-panel";

import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ProviderLogo({ providerId, className }: { providerId: string; className?: string }) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md bg-muted/80 text-[10px] font-semibold uppercase text-muted-foreground",
          className || "size-4",
        )}
      >
        {providerId.charAt(0)}
      </div>
    );
  }

  return (
    <img
      alt={`${providerId} logo`}
      className={cn("size-4 dark:invert", className)}
      height={16}
      width={16}
      src={`https://models.dev/logos/${providerId}.svg`}
      onError={() => setHasError(true)}
    />
  );
}

function ThinkingIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function ToolIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.375 19.5h17.25a1.125 1.125 0 0 0 1.125-1.125V5.625a1.125 1.125 0 0 0-1.125-1.125H3.375a1.125 1.125 0 0 0-1.125 1.125v12.75a1.125 1.125 0 0 0 1.125 1.125Z"
      />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6" />
      <circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
}

function ModelItem({
  model,
  isSelected,
  isHighlighted,
  isFavorite,
  onSelect,
  onHover,
  onInfoClick,
  onInfoHover,
  onInfoClear,
  onToggleFavorite,
  dataIndex,
}: {
  model: Model;
  isSelected: boolean;
  isHighlighted: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onHover: () => void;
  onInfoClick: (e: React.MouseEvent) => void;
  onInfoHover: () => void;
  onInfoClear: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
  dataIndex: number;
}) {
  const hasVision = model.modality?.includes("image");
  const hasReasoning = model.reasoning;

  return (
    <div
      data-index={dataIndex}
      onClick={onSelect}
      onMouseEnter={() => { onHover(); onInfoClear(); }}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      role="option"
      tabIndex={0}
      aria-selected={isSelected}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left outline-none transition-all duration-150 ease-out",
        isHighlighted && !isSelected && "bg-accent/60",
        !isHighlighted && !isSelected && "hover:bg-accent/40 active:bg-accent/60",
        isSelected && "bg-accent/40",
      )}
    >
      <ProviderLogo providerId={model.logoId} className="size-6 shrink-0" />

      <span className={cn(
        "min-w-0 flex-1 truncate text-sm font-semibold leading-tight tracking-tight transition-colors duration-150",
        isSelected ? "text-foreground" : "text-foreground/90 group-hover:text-foreground",
      )}>
        {model.name}
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(e);
          }}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
            isFavorite
              ? "text-amber-400 hover:text-amber-300"
              : "text-muted-foreground/20 hover:text-amber-400 opacity-0 group-hover:opacity-100",
          )}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <StarIcon filled={isFavorite} className="size-4" />
        </button>

        {model.isFree && (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wide text-emerald-500">
            Free
          </span>
        )}

        {hasVision && (
          <Tooltip>
            <TooltipTrigger render={<span />} className="flex size-6 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
              <EyeIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6} positionerClassName="z-[10000]">Vision</TooltipContent>
          </Tooltip>
        )}
        {hasReasoning && (
          <Tooltip>
            <TooltipTrigger render={<span />} className="flex size-6 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
              <ThinkingIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6} positionerClassName="z-[10000]">Reasoning</TooltipContent>
          </Tooltip>
        )}
        {model.toolCall && (
          <Tooltip>
            <TooltipTrigger render={<span />} className="flex size-6 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <ToolIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6} positionerClassName="z-[10000]">Tool Use</TooltipContent>
          </Tooltip>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onInfoClick(e);
          }}
          onMouseEnter={(e) => {
            e.stopPropagation();
            onInfoHover();
          }}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground/40 transition-all duration-150 hover:text-foreground hover:bg-accent/80"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

interface ModelSelectorProps {
  value: string;
  onValueChange: (modelId: string) => void;
  onInfoOpen?: (model: Model) => void;
  className?: string;
  disabled?: boolean;
}

export function ModelSelector({
  value,
  onValueChange,
  onInfoOpen,
  className,
  disabled = false,
}: ModelSelectorProps) {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, openAbove: false });
  const [hasEverOpened, setHasEverOpened] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hoveredInfoModel, setHoveredInfoModel] = useState<Model | null>(null);

  const infoHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showInfoPanel = useCallback((model: Model) => {
    if (infoHoverTimerRef.current) clearTimeout(infoHoverTimerRef.current);
    infoHoverTimerRef.current = setTimeout(() => setHoveredInfoModel(model), 250);
  }, []);

  const hideInfoPanel = useCallback(() => {
    if (infoHoverTimerRef.current) clearTimeout(infoHoverTimerRef.current);
    infoHoverTimerRef.current = null;
    setHoveredInfoModel(null);
  }, []);

  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  const open = visible;

  const { models, isLoading } = useModels();
  const { favorites, toggleFavorite, isFavorite, addDefaults, missingDefaultsCount } = useFavoriteModels();
  const filterStyle = useUIStore((s) => s.filterStyle);

  const deferredQuery = useDeferredValue(query);
  const isSearching = deferredQuery.trim().length > 0;

  const selectedModel = useMemo(() => getModelById(models, value), [models, value]);

  const uniqueProviders = useMemo(() => {
    const providerMap = new Map<string, { id: string; name: string; modelName: string; logoId: string; count: number }>();
    for (const model of models) {
      const existing = providerMap.get(model.providerId);
      if (existing) {
        existing.count++;
      } else {
        providerMap.set(model.providerId, {
          id: model.providerId,
          name: model.provider,
          modelName: model.modelName,
          logoId: model.logoId,
          count: 1,
        });
      }
    }
    return Array.from(providerMap.values()).sort((a, b) => b.count - a.count);
  }, [models]);

  const filteredModels = useMemo(() => {
    if (deferredQuery.trim()) {
      const q = deferredQuery.toLowerCase().replace(/[-_\s]/g, "");
      const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]/g, "");
      return models.filter(
        (model) =>
          normalize(model.name).includes(q) ||
          normalize(model.provider).includes(q) ||
          normalize(model.id).includes(q) ||
          (model.family && normalize(model.family).includes(q)),
      );
    }

    let result = models;

    if (showFavoritesOnly) {
      result = result.filter((m) => favorites.has(m.id));
    }

    if (selectedProvider) {
      result = result.filter((m) => m.providerId === selectedProvider);
    }

    return result;
  }, [models, deferredQuery, selectedProvider, showFavoritesOnly, favorites]);

  const flatList = useMemo(() => {
    const popularModels = filteredModels.filter((m) => m.isPopular);
    const otherModels = filteredModels.filter((m) => !m.isPopular);
    return [...popularModels, ...otherModels];
  }, [filteredModels]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [deferredQuery, selectedProvider, showFavoritesOnly]);

  const calculateDropdownPosition = useCallback(() => {
    if (!triggerRef.current || isMobile) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = 520;
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    
    if (spaceAbove > spaceBelow && spaceAbove >= dropdownHeight) {
      setDropdownPosition({
        top: rect.top - dropdownHeight - 8,
        left: rect.left,
        openAbove: true,
      });
    } else {
      setDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
        openAbove: false,
      });
    }
  }, [isMobile]);

  useLayoutEffect(() => {
    if (open) calculateDropdownPosition();
  }, [open, calculateDropdownPosition]);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    
    calculateDropdownPosition();
    
    flushSync(() => {
      setHasEverOpened(true);
      setVisible(true);
    });
    
    setQuery("");
    setHighlightedIndex(-1);
    setSelectedProvider(null);
    setShowFavoritesOnly(favorites.size > 0);
    
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [disabled, favorites.size, calculateDropdownPosition]);

  const handleClose = useCallback(() => {
    flushSync(() => {
      setVisible(false);
    });
    hideInfoPanel();
    triggerRef.current?.focus();
  }, [hideInfoPanel]);

  const handleSelect = useCallback(
    (modelId: string) => {
      onValueChange(modelId);
      handleClose();
    },
    [onValueChange, handleClose],
  );

  const handleToggleFavorite = useCallback(
    (e: React.MouseEvent, modelId: string) => {
      e.stopPropagation();
      toggleFavorite(modelId);
    },
    [toggleFavorite],
  );

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) => (prev < flatList.length - 1 ? Math.max(0, prev + 1) : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        case "Enter":
          e.preventDefault();
          if (flatList[highlightedIndex]) {
            handleSelect(flatList[highlightedIndex].id);
          }
          break;
        case "Escape":
          e.preventDefault();
          handleClose();
          break;
        case "Tab":
          e.preventDefault();
          handleClose();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, flatList, highlightedIndex, handleSelect, handleClose]);

  useEffect(() => {
    if (!listRef.current || !open) return;
    const selectedElement = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, open]);

  useEffect(() => {
    return () => {
      if (infoHoverTimerRef.current) clearTimeout(infoHoverTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (target instanceof Element) {
        const infoPanel = target.closest("[data-model-info-panel]");
        if (infoPanel) return;
      }

      if (
        contentRef.current &&
        !contentRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        handleClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClose]);

  const hasFavorites = favorites.size > 0;

  return (
    <div className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? handleClose() : handleOpen())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select model"
        className={cn(
          "group flex items-center gap-1.5 md:gap-2",
          "h-10 md:h-9 px-3 md:px-3.5 rounded-xl",
          "text-sm text-muted-foreground",
          "bg-muted/40 hover:bg-muted/70 hover:text-foreground",
          "border border-border/40 hover:border-border/60",
          "shadow-sm shadow-black/5",
          "transition-all duration-200 ease-out",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "bg-muted/70 text-foreground border-border/60",
        )}
      >
        {selectedModel ? (
          <>
            <ProviderLogo providerId={selectedModel.logoId} className="size-4" />
            <span className="truncate max-w-[80px] md:max-w-[140px] font-medium">{selectedModel.name}</span>
          </>
        ) : (
          <span className="font-medium">{isLoading ? "Loading..." : "Select model"}</span>
        )}
        <ChevronDownIcon className={cn(
          "size-3.5 text-muted-foreground/60 transition-transform duration-200 shrink-0",
          open && "rotate-180"
        )} />
      </button>

      {hasEverOpened && createPortal(
        isMobile ? (
          <>
            <div
              className={cn(
                "fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm",
                "transition-opacity duration-150 ease-out",
                visible ? "opacity-100" : "opacity-0 pointer-events-none",
              )}
              onClick={handleClose}
            />
            <div
              ref={contentRef}
              className={cn(
                "fixed inset-x-0 bottom-0 z-[9999] flex max-h-[85vh] flex-col rounded-t-3xl border-t border-border bg-popover text-popover-foreground shadow-2xl",
                "transition-all duration-200 ease-out",
                visible 
                  ? "translate-y-0 opacity-100" 
                  : "translate-y-full opacity-0 pointer-events-none",
              )}
              role="listbox"
              aria-label="Models"
            >
              <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                <h2 className="text-base font-semibold text-foreground">Select Model</h2>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-accent active:text-foreground"
                  aria-label="Close"
                >
                  <CloseIcon className="size-5" />
                </button>
              </div>

              <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
                <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search all models..."
                  className="min-h-[44px] flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground/60 outline-none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {query && (
                  <button
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-accent active:text-foreground"
                  >
                    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {!isSearching && (
                <div className="flex items-center gap-2 overflow-x-auto border-b border-border/50 px-4 py-2.5 scrollbar-none">
                  <button
                    onClick={() => {
                      if (hasFavorites) {
                        setShowFavoritesOnly(true);
                        setSelectedProvider(null);
                      } else {
                        addDefaults();
                      }
                    }}
                    className={cn(
                      "flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-all duration-200",
                      showFavoritesOnly
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-muted/50 text-muted-foreground active:bg-accent active:text-foreground",
                    )}
                  >
                    <StarIcon filled={showFavoritesOnly || hasFavorites} className="size-4" />
                    <span>Favorites</span>
                  </button>

                  <div className="mx-1 h-5 w-px shrink-0 bg-border/60" />

                  {uniqueProviders.slice(0, 8).map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => {
                        if (selectedProvider !== provider.id) {
                          setSelectedProvider(provider.id);
                          setShowFavoritesOnly(false);
                        }
                      }}
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-200",
                        selectedProvider === provider.id
                          ? "bg-accent text-foreground"
                          : "bg-muted/50 text-muted-foreground active:bg-accent active:text-foreground",
                      )}
                      title={filterStyle === "company" ? provider.name : provider.modelName}
                    >
                      <ProviderLogo providerId={provider.logoId} className="size-5" />
                    </button>
                  ))}
                </div>
              )}

              <div ref={listRef} className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-3 scrollbar-thin">
                {isLoading ? (
                  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                    Loading models...
                  </div>
                ) : flatList.length === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                    <span className="text-muted-foreground/70">
                      {isSearching ? "No models found" : showFavoritesOnly ? "No favorites yet" : "No models found"}
                    </span>
                    {isSearching ? (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="min-h-[44px] rounded-xl bg-primary/10 px-4 text-sm font-medium text-primary transition-colors active:bg-primary/20"
                      >
                        Clear search
                      </button>
                    ) : showFavoritesOnly ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          addDefaults();
                        }}
                        className="flex min-h-[44px] items-center gap-2 rounded-xl bg-primary/10 px-4 text-sm font-medium text-primary transition-colors active:bg-primary/20"
                      >
                        <StarIcon filled className="size-4" />
                        Add suggested models
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <TooltipProvider delay={100}>
                    {flatList.map((model, index) => (
                      <ModelItem
                        key={model.id}
                        model={model}
                        isSelected={model.id === value}
                        isHighlighted={index === highlightedIndex}
                        isFavorite={isFavorite(model.id)}
                        onSelect={() => handleSelect(model.id)}
                        onHover={() => setHighlightedIndex(index)}
                        onInfoClick={() => onInfoOpen?.(model)}
                        onInfoHover={() => {}}
                        onInfoClear={() => {}}
                        onToggleFavorite={(e) => handleToggleFavorite(e, model.id)}
                        dataIndex={index}
                      />
                    ))}
                  </TooltipProvider>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border/50 bg-muted/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {showFavoritesOnly && missingDefaultsCount > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addDefaults();
                    }}
                    className="flex min-h-[44px] items-center gap-1.5 text-sm text-primary transition-colors active:text-primary/80"
                  >
                    <StarIcon filled className="size-3.5" />
                    Add {missingDefaultsCount} suggested
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground/60">Tap to select</span>
                )}
                <span className="text-sm tabular-nums text-muted-foreground/50">
                  {flatList.length} model{flatList.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div
            ref={contentRef}
            style={{ 
              position: 'fixed',
              top: dropdownPosition.top,
              left: dropdownPosition.left,
            }}
            className={cn(
              "z-[9999] flex items-start",
              "transition-all duration-150 ease-out",
              visible 
                ? "scale-100 opacity-100" 
                : "scale-95 opacity-0 pointer-events-none",
              dropdownPosition.openAbove ? "origin-bottom-left" : "origin-top-left",
            )}
            onMouseLeave={hideInfoPanel}
          >
          <div
            style={{ 
              height: Math.min(520, window.innerHeight - 80),
            }}
            className={cn(
              "flex w-[480px] rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl",
            )}
            role="listbox"
            aria-label="Models"
          >
            {!isSearching && (
              <div className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-border/50 bg-muted/20 py-3">
                <button
                  onClick={() => {
                    if (hasFavorites) {
                      setShowFavoritesOnly(true);
                      setSelectedProvider(null);
                    } else {
                      addDefaults();
                    }
                  }}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl transition-all duration-200",
                    showFavoritesOnly
                      ? "bg-amber-500/20 text-amber-400 shadow-sm shadow-amber-500/10"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground hover:scale-105",
                  )}
                  title={hasFavorites ? "Show favorites" : "Add suggested favorites"}
                >
                  <StarIcon filled={showFavoritesOnly || hasFavorites} className="size-[18px]" />
                </button>

                <div className="my-1.5 h-px w-7 bg-border/60" />

                <div className="flex flex-col gap-1.5 px-1">
                  {uniqueProviders.slice(0, 6).map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => {
                        if (selectedProvider !== provider.id) {
                          setSelectedProvider(provider.id);
                          setShowFavoritesOnly(false);
                        }
                      }}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-xl transition-all duration-200",
                        selectedProvider === provider.id
                          ? "bg-accent text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground hover:scale-105",
                      )}
                      title={filterStyle === "company" ? provider.name : provider.modelName}
                    >
                      <ProviderLogo providerId={provider.logoId} className="size-5" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2.5 border-b border-border/50 px-4 py-3">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search all models..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {query && (
                  <button
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    className="flex size-6 items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground"
                    title="Clear search"
                  >
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              <div ref={listRef} onMouseLeave={() => setHighlightedIndex(-1)} className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2 scrollbar-thin">
                {isLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading models...
                  </div>
                ) : flatList.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                    <span className="text-muted-foreground/70">
                      {isSearching ? "No models found" : showFavoritesOnly ? "No favorites yet" : "No models found"}
                    </span>
                    {isSearching ? (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="text-xs text-primary transition-colors hover:text-primary/80"
                      >
                        Clear search
                      </button>
                    ) : showFavoritesOnly ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          addDefaults();
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                      >
                        <StarIcon filled className="size-3" />
                        Add suggested models
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <TooltipProvider delay={100}>
                    {flatList.map((model, index) => (
                      <ModelItem
                        key={model.id}
                        model={model}
                        isSelected={model.id === value}
                        isHighlighted={index === highlightedIndex}
                        isFavorite={isFavorite(model.id)}
                        onSelect={() => handleSelect(model.id)}
                        onHover={() => setHighlightedIndex(index)}
                        onInfoClick={() => onInfoOpen?.(model)}
                        onInfoHover={() => showInfoPanel(model)}
                        onInfoClear={hideInfoPanel}
                        onToggleFavorite={(e) => handleToggleFavorite(e, model.id)}
                        dataIndex={index}
                      />
                    ))}
                  </TooltipProvider>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border/50 bg-muted/10 px-4 py-2">
                {showFavoritesOnly && missingDefaultsCount > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addDefaults();
                    }}
                    className="flex items-center gap-1 text-[11px] text-primary transition-colors hover:text-primary/80"
                  >
                    <StarIcon filled className="size-3" />
                    Add {missingDefaultsCount} suggested
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-muted-foreground/60">
                    <kbd className="inline-flex h-5 items-center rounded-md border border-border/60 bg-muted/50 px-1.5 font-mono text-[10px]">
                      ↑↓
                    </kbd>
                    <span className="text-[10px]">navigate</span>
                    <kbd className="ml-1 inline-flex h-5 items-center rounded-md border border-border/60 bg-muted/50 px-1.5 font-mono text-[10px]">
                      ↵
                    </kbd>
                    <span className="text-[10px]">select</span>
                  </div>
                )}
                <span className="text-[11px] tabular-nums text-muted-foreground/50">
                  {flatList.length} model{flatList.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
          {hoveredInfoModel && (
            <div className="ml-2" data-model-info-panel>
              <ModelInfoPanel model={hoveredInfoModel} />
            </div>
          )}
          </div>
        ),
        document.body
      )}
    </div>
  );
}

export function ConnectedModelSelector({
  className,
  disabled,
}: {
  className?: string;
  disabled?: boolean;
}) {
  const isMobile = useIsMobile();
  const selectedModelId = useModelStore((state) => state.selectedModelId);
  const setSelectedModel = useModelStore((state) => state.setSelectedModel);
  const [infoModel, setInfoModel] = useState<Model | null>(null);

  const handleInfoOpen = useCallback(
    (model: Model) => {
      if (!isMobile) return;
      setInfoModel(model);
    },
    [isMobile],
  );

  return (
    <>
      <ModelSelector
        value={selectedModelId}
        onValueChange={setSelectedModel}
        onInfoOpen={handleInfoOpen}
        className={className}
        disabled={disabled}
      />

      <Dialog
        open={infoModel !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setInfoModel(null);
          }
        }}
      >
        <DialogContent className="max-w-[calc(100%-1rem)] gap-3 rounded-3xl p-4 sm:max-w-lg" showCloseButton>
          <DialogHeader className="pr-10">
            <DialogTitle>Model info</DialogTitle>
          </DialogHeader>
          {infoModel && (
            <div data-model-info-panel className="overflow-auto">
              <ModelInfoPanel model={infoModel} className="w-full max-w-none shadow-none" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
