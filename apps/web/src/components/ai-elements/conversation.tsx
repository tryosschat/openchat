/**
 * Conversation - Simple scroll container for chat messages
 *
 * Provides:
 * - Scrollable message area
 * - Auto-scroll to bottom via ref
 * - Scroll-to-bottom button (via showScrollButton prop)
 *
 * Note: This component must be used within a flex container with defined height.
 * The internal scroll area uses absolute positioning and relies on flex-1 for sizing.
 */

import { ArrowDownIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ComponentProps, RefObject } from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// Context for scroll state
// ============================================================================

interface ConversationContextValue {
  scrollRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

const ConversationContext = createContext<ConversationContextValue | null>(null);

export function useConversationScroll() {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error("useConversationScroll must be used within a Conversation component");
  }
  return context;
}

// ============================================================================
// Conversation
// ============================================================================

export type ConversationProps = ComponentProps<"div"> & {
  showScrollButton?: boolean;
};

export const Conversation = ({ className, children, showScrollButton = false, ...props }: ConversationProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    // Try anchor element first, fallback to direct scroll
    if (anchorRef.current) {
      anchorRef.current.scrollIntoView({ behavior: "instant", block: "end" });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Track scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const threshold = 50; // pixels from bottom to consider "at bottom"
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setIsAtBottom(atBottom);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Check initial state

    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <ConversationContext.Provider value={{ scrollRef, isAtBottom, scrollToBottom }}>
      {/* Outer wrapper for positioning the scroll button */}
      <div className={cn("relative flex-1", className)} {...props}>
        {/* Scroll container - takes full space */}
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto"
          role="log"
        >
          {children}
          {/* Anchor element for scroll-to-bottom */}
          <div ref={anchorRef} className="h-0 w-full" aria-hidden="true" />
        </div>
        {/* Scroll button - positioned outside scroll area */}
        {showScrollButton && !isAtBottom && (
          <button
            type="button"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 rounded-full shadow-lg flex size-11 md:size-9 items-center justify-center bg-background border border-border hover:bg-muted active:scale-95 transition-all"
            onClick={scrollToBottom}
          >
            <ArrowDownIcon className="size-5 md:size-4" />
          </button>
        )}
      </div>
    </ConversationContext.Provider>
  );
};

// ============================================================================
// ConversationContent
// ============================================================================

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  children,
  ...props
}: ConversationContentProps) => (
  <div className={cn("flex flex-col gap-6", className)} {...props}>
    {children}
  </div>
);

// ============================================================================
// ConversationEmptyState
// ============================================================================

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
      </>
    )}
  </div>
);
