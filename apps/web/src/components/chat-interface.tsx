/**
 * Chat Interface - Main conversational UI component
 *
 * Uses AI Elements components for a polished, modern UI:
 * - Conversation for auto-scrolling message container
 * - Message for user/assistant message rendering
 * - PromptInput for message composition with file attachments
 * - ModelSelector for choosing AI models
 * - Streaming response support via AI SDK 5
 * - Convex persistence for chat history
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpIcon, BrainIcon, ChevronDownIcon, GlobeIcon,
  LinkIcon,
  Loader2Icon,
  MinusIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  XIcon } from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Conversation,
  ConversationContent,
  useConversationScroll,
} from "./ai-elements/conversation";
import { Message, MessageContent, MessageFile, MessageResponse } from "./ai-elements/message";
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputFooter,
  
  PromptInputProvider,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController
} from "./ai-elements/prompt-input";
import { ConnectedModelSelector } from "./model-selector";
import { StartScreen } from "./start-screen";
import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import type {PromptInputMessage} from "./ai-elements/prompt-input";
import type {ReasoningEffort} from "@/stores/model";
import { cn } from "@/lib/utils";
import { getModelById, getModelCapabilities, useModelStore, useModels } from "@/stores/model";
import { useWebSearch } from "@/stores/provider";
import { usePromptDraft } from "@/hooks/use-prompt-draft";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Note: Using details/summary instead of Collapsible for now
import { usePersistentChat } from "@/hooks/use-persistent-chat";
import { useSmoothText } from "@/hooks/use-smooth-text";

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

function useIsMac() {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  return isMac;
}

// Auto-scroll component - scrolls to bottom when messages change
function AutoScroll({ messageCount }: { messageCount: number }) {
  const { scrollToBottom, isAtBottom } = useConversationScroll();
  const prevCountRef = useRef(messageCount);
  const initialScrollDone = useRef(false);

  useEffect(() => {
    // Scroll to bottom on initial load (when we have messages)
    if (messageCount > 0 && !initialScrollDone.current) {
      initialScrollDone.current = true;
      // Multiple scroll attempts to handle layout shifts
      // First: immediate scroll after paint
      requestAnimationFrame(() => {
        scrollToBottom();
        // Second: delayed scroll for async content (images, markdown)
        setTimeout(() => {
          scrollToBottom();
        }, 100);
      });
    }
    // Also scroll when new messages are added and user was at bottom
    else if (messageCount > prevCountRef.current && isAtBottom) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
    prevCountRef.current = messageCount;
  }, [messageCount, scrollToBottom, isAtBottom]);

  return null;
}

// Loading indicator for streaming (no avatar)
function LoadingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <span className="size-2 animate-bounce rounded-full bg-foreground/40 [animation-delay:0ms]" />
      <span className="size-2 animate-bounce rounded-full bg-foreground/40 [animation-delay:150ms]" />
      <span className="size-2 animate-bounce rounded-full bg-foreground/40 [animation-delay:300ms]" />
    </div>
  );
}



// Inline error message component (like T3.chat) - displayed in message thread
interface InlineErrorMessageProps {
  error: {
    code: string;
    message: string;
    details?: string;
    provider?: string;
    retryable?: boolean;
  };
  onRetry?: () => void;
}

function InlineErrorMessage({ error, onRetry }: InlineErrorMessageProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const MAX_RETRIES = 3;
  const retriesRemaining = MAX_RETRIES - retryCount;
  const canRetry = error.retryable && onRetry && retryCount < MAX_RETRIES;

  // Exponential backoff: 1s, 2s, 4s
  const getBackoffDelay = (attempt: number) => Math.pow(2, attempt) * 1000;

  const handleRetry = async () => {
    if (!canRetry || isRetrying) return;

    setIsRetrying(true);
    const delay = getBackoffDelay(retryCount);

    // Wait for backoff delay
    await new Promise((resolve) => setTimeout(resolve, delay));

    setRetryCount((prev) => prev + 1);
    setIsRetrying(false);

    onRetry();
  };

  // Get human-readable error title based on code
  const getErrorTitle = (code: string) => {
    switch (code) {
      case "rate_limit":
        return "Rate Limit Exceeded";
      case "auth_error":
        return "Authentication Error";
      case "context_length":
        return "Context Too Long";
      case "content_filter":
        return "Content Filtered";
      case "model_error":
        return "Model Error";
      case "network_error":
        return "Network Error";
      default:
        return "Error";
    }
  };

  return (
    <div className="w-full rounded-xl border border-destructive/30 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <svg
            className="size-5 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-destructive">{getErrorTitle(error.code)}</h4>
          <p className="mt-1 text-sm text-destructive/80">{error.message}</p>
          {error.provider && (
            <p className="mt-1 text-xs text-destructive/60">Provider: {error.provider}</p>
          )}
          {error.details && (
            <div className="mt-2">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-destructive/60 hover:text-destructive transition-colors"
              >
                {showDetails ? "Hide details" : "Show details"}
              </button>
              {showDetails && (
                <pre className="mt-2 p-2 rounded bg-destructive/20 text-xs text-destructive/70 overflow-x-auto max-h-32 overflow-y-auto">
                  {error.details}
                </pre>
              )}
            </div>
          )}
          {error.retryable && onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetry}
              disabled={!canRetry || isRetrying}
              className={cn(
                "mt-3 transition-all",
                canRetry
                  ? "text-destructive hover:text-destructive/80 hover:bg-destructive/20"
                  : "text-destructive/40 cursor-not-allowed",
              )}
            >
              {isRetrying ? (
                <>
                  <Loader2Icon className="mr-1.5 size-3 animate-spin" />
                  Retrying...
                </>
              ) : retryCount >= MAX_RETRIES ? (
                "Max retries reached"
              ) : (
                `Retry (${retriesRemaining} left)`
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Chain of Thought Step type - represents a single reasoning/tool step
interface ChainOfThoughtStep {
  id: string;
  type: "reasoning" | "tool";
  label: string;
  content?: string; // For reasoning text (can be merged from multiple parts)
  toolName?: string; // For tool calls
  toolInput?: unknown; // Tool input/arguments
  toolOutput?: unknown; // Tool output/result
  toolState?: "input-streaming" | "input-available" | "output-available" | "output-error";
  errorText?: string; // For tool errors
  status: "complete" | "active" | "pending" | "error";
}

// Helper to build chain of thought steps from message parts IN ORDER
// This preserves the exact stream order
// Each reasoning part is its own step (not merged) so they can collapse independently
function buildChainOfThoughtSteps(parts: Array<any>): {
  steps: Array<ChainOfThoughtStep>;
  isAnyStreaming: boolean;
  hasTextContent: boolean;
} {
  const steps: Array<ChainOfThoughtStep> = [];
  let isAnyStreaming = false;
  let hasTextContent = false;

  // Process parts in their original order (as they came from the stream)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.type === "text") {
      hasTextContent = true;
      // Text parts are rendered separately, not in chain of thought
      continue;
    }

    if (part.type === "reasoning") {
      const isStreaming = part.state === "streaming";
      if (isStreaming) isAnyStreaming = true;

      // Each reasoning part is its own step (so they can collapse independently)
      steps.push({
        id: `reasoning-${i}`,
        type: "reasoning",
        label: isStreaming ? "Thinking..." : "Thought process",
        content: part.text || "",
        status: isStreaming ? "active" : "complete",
      });
    } else if (
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      part.type !== "tool-call" &&
      part.type !== "tool-result"
    ) {
      const toolName = part.type.replace("tool-", "");
      const isStreaming = part.state === "input-streaming";
      const isComplete = part.state === "output-available";
      const isError = part.state === "output-error";

      if (isStreaming) isAnyStreaming = true;

      steps.push({
        id: `tool-${part.toolCallId || i}`,
        type: "tool",
        label: toolName,
        toolName: toolName,
        toolInput: part.input,
        toolOutput: part.output,
        toolState: part.state,
        errorText: part.errorText,
        status: isError ? "error" : isComplete ? "complete" : "active",
      });
    }
  }

  return { steps, isAnyStreaming, hasTextContent };
}

// Chain of Thought Component - Multi-step reasoning visualization
interface ChainOfThoughtProps {
  steps: Array<ChainOfThoughtStep>;
  isStreaming?: boolean;
  hasTextContent?: boolean; // Whether the message has text content (for auto-collapse)
}

function ChainOfThought({
  steps,
  isStreaming = false,
  hasTextContent = false,
}: ChainOfThoughtProps) {
  const [isOpen, setIsOpen] = useState(true); // Start open
  const wasStreamingRef = useRef(isStreaming);
  const hasAutoCollapsedRef = useRef(false);

  // Auto-collapse ONLY when:
  // 1. Streaming transitions from true -> false (message is complete)
  // 2. There is text content (the actual response)
  // 3. We haven't already auto-collapsed this message
  useEffect(() => {
    if (isStreaming) {
      // Currently streaming - keep open and reset flags
      setIsOpen(true);
      wasStreamingRef.current = true;
      hasAutoCollapsedRef.current = false;
    } else if (
      wasStreamingRef.current &&
      hasTextContent &&
      !hasAutoCollapsedRef.current
    ) {
      // Streaming just finished AND we have text content - auto-collapse after a delay
      hasAutoCollapsedRef.current = true;
      const timer = setTimeout(() => {
        setIsOpen(false);
      }, 500); // Small delay for UX
      return () => clearTimeout(timer);
    }
  }, [isStreaming, hasTextContent]);

  const completedSteps = steps.filter((s) => s.status === "complete").length;
  const errorSteps = steps.filter((s) => s.status === "error").length;
  const hasActiveStep = steps.some((s) => s.status === "active");

  return (
    <details
      className="group overflow-hidden rounded-xl border border-border/50 bg-muted/30 mb-3"
      open={isOpen}
      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 flex-1">
          {/* Status indicator */}
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              hasActiveStep
                ? "bg-primary animate-pulse"
                : errorSteps > 0
                  ? "bg-destructive"
                  : "bg-success",
            )}
          />
          <span className="font-medium">Thinking</span>
          <span className="text-xs opacity-60">
            {completedSteps}/{steps.length} steps
          </span>
        </div>
        <ChevronDownIcon className="w-4 h-4 transition-transform duration-200 group-open:rotate-180" />
      </summary>

      <div className="border-t border-border/30">
        <div className="divide-y divide-border/30">
          {steps.map((step) => (
            <ChainOfThoughtStepItem key={step.id} step={step} />
          ))}
        </div>
      </div>
    </details>
  );
}

function SmoothReasoningContent({ content, isActive }: { content: string; isActive: boolean }) {
  const smoothContent = useSmoothText(content, isActive);
  return <Streamdown>{smoothContent}</Streamdown>;
}

function ChainOfThoughtStepItem({ step }: { step: ChainOfThoughtStep }) {
  // Tool steps with output start expanded, reasoning steps follow streaming state
  const [isExpanded, setIsExpanded] = useState(
    step.type === "tool" ? step.toolState === "output-available" : step.status === "active",
  );
  const prevStatusRef = useRef(step.status);

  // Auto-expand when step becomes active
  // Auto-collapse reasoning steps when complete, but keep tool results expanded
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = step.status;

    if (step.status === "active") {
      // Step became active - expand it
      setIsExpanded(true);
    } else if (prevStatus === "active" && step.status === "complete") {
      // Step just finished - only auto-collapse REASONING steps, not tool results
      if (step.type === "reasoning") {
        const timer = setTimeout(() => {
          setIsExpanded(false);
        }, 300);
        return () => clearTimeout(timer);
      }
      // Tool steps stay expanded when they complete (so user can see results)
    }
  }, [step.status, step.type]);

  // Get icon based on step type
  const getStepIcon = () => {
    if (step.type === "tool") {
      if (step.toolName === "webSearch") {
        return <SearchIcon className="size-3" />;
      }
      return <GlobeIcon className="size-3" />;
    }
    return <BrainIcon className="size-3" />;
  };

  // Get step label
  const getStepLabel = () => {
    if (step.type === "tool") {
      const input = step.toolInput as Record<string, unknown> | undefined;
      const query = input?.query as string | undefined;
      if (step.toolState === "output-available") {
        return `Search: ${query || step.toolName}`;
      }
      if (step.toolState === "output-error") {
        return `Search failed: ${query || step.toolName}`;
      }
      return `Searching: ${query || step.toolName}...`;
    }
    return step.label;
  };

  return (
    <div className="px-4 py-3">
      {/* Step header - clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-3 w-full text-left"
      >
        {/* Step number/icon indicator */}
        <div
          className={cn(
            "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs",
            step.status === "complete" && "bg-success/20 text-success",
            step.status === "active" && "bg-primary/20 text-primary animate-pulse",
            step.status === "pending" && "bg-muted text-muted-foreground",
          )}
        >
          {getStepIcon()}
        </div>

        {/* Step label */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium truncate",
                step.status === "active" ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {getStepLabel()}
            </span>
            {step.status === "active" && (
              <Loader2Icon className="size-3 animate-spin text-primary" />
            )}
          </div>
        </div>

        {/* Expand indicator - show for reasoning with content OR tool with output */}
        {Boolean(step.content || (step.type === "tool" && step.toolOutput)) && (
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              isExpanded && "rotate-180",
            )}
          />
        )}
      </button>

      {isExpanded && step.type === "reasoning" && step.content && (
        <div className="mt-2 ml-9">
          <div
            className={cn(
              "prose prose-sm dark:prose-invert max-w-none",
              "prose-p:text-xs prose-p:leading-relaxed prose-p:text-muted-foreground prose-p:my-1",
              "prose-strong:text-foreground/80 prose-strong:font-semibold",
              "prose-em:text-muted-foreground",
              "prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:rounded",
              "prose-ul:my-1 prose-ol:my-1 prose-li:text-xs prose-li:text-muted-foreground",
              "max-h-[200px] overflow-y-auto",
            )}
          >
            <SmoothReasoningContent content={step.content} isActive={step.status === "active"} />
          </div>
        </div>
      )}

      {/* Tool output display */}
      {step.type === "tool" && step.toolState === "output-available" && !!step.toolOutput && (
        <div className="mt-2 ml-9">
          <SearchResultsDisplay results={step.toolOutput} isExpanded={isExpanded} />
        </div>
      )}

      {/* Tool error display */}
      {step.type === "tool" && step.toolState === "output-error" && step.errorText && (
        <div className="mt-2 ml-9 text-xs text-destructive">Error: {step.errorText}</div>
      )}
    </div>
  );
}

// Helper to replace UTM source in URLs with osschat.dev
function replaceUtmSource(url: string): string {
  try {
    const urlObj = new URL(url);
    // Replace any existing utm_source with osschat.dev
    if (urlObj.searchParams.has("utm_source")) {
      urlObj.searchParams.set("utm_source", "osschat.dev");
    }
    // Replace utm_medium if it exists
    if (urlObj.searchParams.has("utm_medium")) {
      urlObj.searchParams.set("utm_medium", "referral");
    }
    return urlObj.toString();
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

// Search results display component - shows summary collapsed, details when expanded
function SearchResultsDisplay({ results, isExpanded }: { results: unknown; isExpanded: boolean }) {
  // Parse the results - handle different structures from various search tools
  // Could be: array directly, { results: [...] }, { data: [...] }, etc.
  let searchResults: Array<any> = [];

  if (Array.isArray(results)) {
    searchResults = results;
  } else if (results && typeof results === "object") {
    const obj = results as Record<string, unknown>;
    // Try common patterns for search result structures
    if (Array.isArray(obj.results)) {
      searchResults = obj.results;
    } else if (Array.isArray(obj.data)) {
      searchResults = obj.data;
    } else if (Array.isArray(obj.items)) {
      searchResults = obj.items;
    } else if (Array.isArray(obj.hits)) {
      searchResults = obj.hits;
    } else if (Array.isArray(obj.organic)) {
      // Some search APIs use 'organic' for organic results
      searchResults = obj.organic;
    }
  }

  if (searchResults.length === 0) {
    return <p className="text-xs text-muted-foreground">No results found</p>;
  }

  // When collapsed, just show summary
  if (!isExpanded) {
    return (
      <p className="text-xs text-muted-foreground">
        {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found
      </p>
    );
  }

  // When expanded, show full results
  return (
    <div className="space-y-2">
      {searchResults.slice(0, 5).map((result: any, i: number) => (
        <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/50">
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {result.url || result.link ? (
                <a
                  href={replaceUtmSource(result.url || result.link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:underline line-clamp-1"
                >
                  {result.title || result.name || result.url || result.link}
                </a>
              ) : (
                <span className="text-xs font-medium text-foreground line-clamp-1">
                  {result.title || result.name || "Result"}
                </span>
              )}
              {(result.description || result.snippet || result.content) && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {result.description || result.snippet || result.content}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
      {searchResults.length > 5 && (
        <p className="text-xs text-muted-foreground">
          +{String(searchResults.length - 5)} more results
        </p>
      )}
    </div>
  );
}

// Reasoning Slider Component - Continuous slider with labels
interface ReasoningSliderProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  disabled?: boolean;
}

const EFFORT_OPTIONS: Array<ReasoningEffort> = ["none", "low", "medium", "high"];
const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};

function ReasoningSlider({ value, onChange, disabled }: ReasoningSliderProps) {
  const currentIndex = EFFORT_OPTIONS.indexOf(value);
  const percentage = (currentIndex / (EFFORT_OPTIONS.length - 1)) * 100;

  const handleClick = (index: number) => {
    if (disabled) return;
    onChange(EFFORT_OPTIONS[index]);
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickPercentage = x / rect.width;
    const index = Math.round(clickPercentage * (EFFORT_OPTIONS.length - 1));
    onChange(EFFORT_OPTIONS[Math.max(0, Math.min(index, EFFORT_OPTIONS.length - 1))]);
  };

  return (
    <div className={cn("space-y-2", disabled && "opacity-40 pointer-events-none")}>
      {/* Slider Track */}
      <div className="relative h-2 cursor-pointer" onClick={handleTrackClick}>
        {/* Background track */}
        <div className="absolute inset-0 bg-muted rounded-full" />

        {/* Filled track */}
        <div
          className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-150"
          style={{ width: `${percentage}%` }}
        />

        {/* Thumb/handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full shadow-md border-2 border-background transition-all duration-150"
          style={{ left: `calc(${percentage}% - 8px)` }}
        />

        {/* Click targets at each position */}
        <div className="absolute inset-0 flex justify-between">
          {EFFORT_OPTIONS.map((_, index) => (
            <button
              key={index}
              type="button"
              className="w-4 h-full z-10"
              onClick={(e) => {
                e.stopPropagation();
                handleClick(index);
              }}
            />
          ))}
        </div>
      </div>

      {/* Labels */}
      <div className="flex justify-between text-xs text-muted-foreground">
        {EFFORT_OPTIONS.map((effort, index) => (
          <button
            key={effort}
            type="button"
            onClick={() => handleClick(index)}
            className={cn(
              "transition-colors hover:text-foreground",
              value === effort && "text-foreground font-medium",
            )}
          >
            {EFFORT_LABELS[effort]}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ModelConfigPopoverProps {
  disabled?: boolean;
}

function ModelConfigPopover({ disabled }: ModelConfigPopoverProps) {
  const { selectedModelId, reasoningEffort, setReasoningEffort, maxSteps, setMaxSteps } =
    useModelStore();
  const {
    enabled: webSearchEnabled,
    toggle: toggleWebSearch,
    remainingSearches,
    isLimitReached,
  } = useWebSearch();
  const [open, setOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const isMobile = useIsMobile();

  const { models } = useModels();
  const currentModel = getModelById(models, selectedModelId);
  const capabilities = getModelCapabilities(selectedModelId, currentModel);

  const getBadgeText = () => {
    const parts: Array<string> = [];
    if (reasoningEffort !== "none" && capabilities.supportsReasoning) {
      parts.push(reasoningEffort.toUpperCase());
    }
    if (webSearchEnabled) {
      parts.push("Search");
    }
    return parts.length > 0 ? parts.join(" + ") : null;
  };

  const badgeText = getBadgeText();

  const handleReasoningChange = (effort: ReasoningEffort) => {
    setReasoningEffort(effort);
  };

  const handleSearchToggle = () => {
    if (isLimitReached && !webSearchEnabled) {
      toast.error("Search limit reached", {
        description: "You've used your 20 daily web searches. Limit resets tomorrow.",
      });
      return;
    }
    toggleWebSearch();
  };

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setOpen(false);
      setIsClosing(false);
    }, 150);
  }, []);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setIsClosing(false);
  }, [disabled]);

  const configContent = (
    <>
      <div className={cn("pb-4", isMobile ? "border-b border-border/50" : "")}>
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <BrainIcon className="size-4" />
          <span className="font-medium">Reasoning effort</span>
        </div>
        <div className="py-2">
          <ReasoningSlider
            value={capabilities.supportsReasoning ? reasoningEffort : "none"}
            onChange={handleReasoningChange}
            disabled={!capabilities.supportsReasoning}
          />
        </div>
        {!capabilities.supportsReasoning && (
          <p className="text-xs text-muted-foreground/60 mt-1">
            This model doesn't support reasoning
          </p>
        )}
      </div>

      <div className={cn(
        "pt-4",
        webSearchEnabled && !isMobile ? "pb-4" : "",
        webSearchEnabled && isMobile ? "pb-4 border-b border-border/50" : ""
      )}>
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <GlobeIcon className="size-4" />
          <span className="font-medium">Web search</span>
          <span className="ml-auto">{remainingSearches} left</span>
        </div>
        <div className="py-2">
          <button
            type="button"
            onClick={handleSearchToggle}
            disabled={isLimitReached && !webSearchEnabled}
            className={cn(
              "w-full flex items-center justify-between rounded-lg transition-all",
              isMobile ? "py-3 px-4 min-h-[52px]" : "py-2 px-3",
              webSearchEnabled
                ? "bg-primary/10 border border-primary/30"
                : "bg-muted/50 border border-transparent hover:bg-muted",
              isLimitReached && !webSearchEnabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <span className={cn(isMobile ? "text-base" : "text-sm")}>
              {webSearchEnabled ? "Enabled" : "Disabled"}
            </span>
            <div
              className={cn(
                "rounded-full transition-all relative",
                isMobile ? "w-12 h-7" : "w-10 h-6",
                webSearchEnabled ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <div
                className={cn(
                  "absolute rounded-full bg-white transition-all shadow-sm",
                  isMobile ? "top-1 w-5 h-5" : "top-1 w-4 h-4",
                  webSearchEnabled ? (isMobile ? "left-6" : "left-5") : "left-1",
                )}
              />
            </div>
          </button>
          <p className={cn("text-muted-foreground mt-2", isMobile ? "text-sm" : "text-xs")}>
            Allow the AI to search the web for current information
          </p>
        </div>
      </div>

      {webSearchEnabled && (
        <div className={cn(isMobile ? "pt-4" : "pt-4 border-t border-border/50")}>
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <LinkIcon className="size-4" />
            <span className="font-medium">Max iterations</span>
          </div>
          <div className="py-2">
            <div className="flex items-center justify-between">
              <span className={cn("text-muted-foreground", isMobile ? "text-sm" : "text-xs")}>
                Search/tool steps
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMaxSteps(maxSteps - 1)}
                  disabled={maxSteps <= 1}
                  className={cn(
                    "rounded flex items-center justify-center",
                    "bg-muted hover:bg-muted/80 active:bg-muted/60 transition-colors",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    isMobile ? "w-10 h-10" : "w-6 h-6",
                  )}
                >
                  <MinusIcon className={cn(isMobile ? "size-5" : "size-3")} />
                </button>
                <span className={cn(
                  "text-center font-medium tabular-nums",
                  isMobile ? "w-8 text-lg" : "w-6 text-sm"
                )}>
                  {maxSteps}
                </span>
                <button
                  type="button"
                  onClick={() => setMaxSteps(maxSteps + 1)}
                  disabled={maxSteps >= 10}
                  className={cn(
                    "rounded flex items-center justify-center",
                    "bg-muted hover:bg-muted/80 active:bg-muted/60 transition-colors",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    isMobile ? "w-10 h-10" : "w-6 h-6",
                  )}
                >
                  <PlusIcon className={cn(isMobile ? "size-5" : "size-3")} />
                </button>
              </div>
            </div>
            <p className={cn("text-muted-foreground mt-2", isMobile ? "text-sm" : "text-xs")}>
              Maximum search/tool iterations per response
            </p>
          </div>
        </div>
      )}
    </>
  );

  const triggerButton = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (isMobile ? handleOpen() : undefined)}
      className={cn(
        "flex items-center justify-center gap-1.5",
        "size-10 md:size-auto md:h-8 md:px-3 rounded-full",
        "text-sm",
        "border transition-all duration-150",
        badgeText
          ? "bg-primary/10 text-primary border-primary/50 hover:bg-primary/20"
          : "text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground border-border/50",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <SlidersHorizontalIcon className="size-4" />
      {badgeText && <span className="hidden md:inline text-xs font-medium">{badgeText}</span>}
    </button>
  );

  if (isMobile) {
    return (
      <>
        {triggerButton}
        {open && createPortal(
          <>
            <div
              className={cn(
                "fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm",
                isClosing
                  ? "animate-out fade-out-0 duration-150"
                  : "animate-in fade-in-0 duration-200",
              )}
              onClick={handleClose}
            />
            <div
              className={cn(
                "fixed inset-x-0 bottom-0 z-[9999] flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-popover text-popover-foreground shadow-2xl",
                isClosing
                  ? "animate-out slide-out-to-bottom fade-out-0 duration-200"
                  : "animate-in slide-in-from-bottom fade-in-0 duration-300",
              )}
            >
              <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                <h2 className="text-base font-semibold text-foreground">Model Settings</h2>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-accent active:text-foreground"
                  aria-label="Close"
                >
                  <XIcon className="size-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {configContent}
              </div>
            </div>
          </>,
          document.body
        )}
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "flex items-center justify-center gap-1.5",
          "size-10 md:size-auto md:h-8 md:px-3 rounded-full",
          "text-sm",
          "border transition-all duration-150",
          badgeText
            ? "bg-primary/10 text-primary border-primary/50 hover:bg-primary/20"
            : "text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground border-border/50",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <SlidersHorizontalIcon className="size-4" />
        {badgeText && <span className="hidden md:inline text-xs font-medium">{badgeText}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-3">
        {configContent}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Pill Button Component for Search/Attach
interface PillButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  hideLabel?: boolean;
}

function PillButton({ icon, label, onClick, active, className, hideLabel }: PillButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex items-center justify-center gap-1.5",
        // Mobile: icon-only with 44px touch target, Desktop: with label
        hideLabel ? "size-10 md:size-auto md:h-8 md:px-3" : "h-8 px-3",
        "rounded-full",
        "text-sm",
        "border transition-all duration-150",
        active
          ? "bg-primary/10 text-primary border-primary/50 hover:bg-primary/20"
          : "text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground border-border/50",
        className,
      )}
    >
      {icon}
      {!hideLabel && <span className="hidden md:inline">{label}</span>}
    </button>
  );
}

// Premium Send Button Component
interface SendButtonProps {
  isLoading: boolean;
  hasContent: boolean;
  onStop: () => void;
}

function SendButton({ isLoading, hasContent, onStop }: SendButtonProps) {
  if (isLoading) {
    return (
      <button
        type="button"
        onClick={onStop}
        className={cn(
          "flex items-center justify-center",
          "size-11 md:size-9 rounded-full",
          "bg-foreground text-background",
          "transition-all duration-150",
          "hover:scale-105 active:scale-95",
        )}
        aria-label="Stop generating"
      >
        <SquareIcon className="size-4" />
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={!hasContent}
      className={cn(
        "flex items-center justify-center",
        "size-11 md:size-9 rounded-full",
        "transition-all duration-150",
        hasContent
          ? "bg-primary text-primary-foreground hover:scale-105 active:scale-95"
          : "bg-muted text-muted-foreground cursor-not-allowed",
      )}
      aria-label="Send message"
    >
      <ArrowUpIcon className="size-4" />
    </button>
  );
}

// Premium Prompt Input Component (wrapped)
interface PremiumPromptInputProps {
  onSubmit: (message: PromptInputMessage) => Promise<void>;
  isLoading: boolean;
  onStop: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function PremiumPromptInputInner({
  onSubmit,
  isLoading,
  onStop,
  textareaRef,
}: PremiumPromptInputProps) {
  const controller = usePromptInputController();
  const hasContent = controller.textInput.value.trim().length > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMac = useIsMac();
  const focusShortcut = isMac ? "⌘L" : "Ctrl+L";

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      controller.attachments.add(Array.from(files));
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  return (
    <div
      className={cn(
        // Glass morphism container
        "relative rounded-2xl",
        "bg-background/90 backdrop-blur-xl",
        "border border-border/40",
        "shadow-lg shadow-black/5",
      )}
    >
      <PromptInput
        onSubmit={onSubmit}
        accept="image/*,application/pdf"
        multiple
        className="gap-0 border-0 bg-transparent shadow-none"
      >
        {/* Attachments preview */}
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>

        <PromptInputTextarea
          ref={textareaRef}
          placeholder={`Message... (${focusShortcut} to focus)`}
          disabled={isLoading}
          className={cn(
            "min-h-[72px] md:min-h-[100px] py-3 md:py-4 px-4",
            "text-[15px] leading-relaxed",
            "placeholder:text-muted-foreground/50",
            "resize-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0",
          )}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.txt,.csv,.json"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <PromptInputFooter className="px-2 md:px-3 pb-2 md:pb-3 pt-1 gap-1.5 md:gap-2">
          <PromptInputTools className="gap-1.5 md:gap-2 flex-1 min-w-0">
            <ConnectedModelSelector disabled={isLoading} />
            <ModelConfigPopover disabled={isLoading} />
            <PillButton
              icon={<PaperclipIcon className="size-4" />}
              label="Attach"
              onClick={handleAttachClick}
              hideLabel
            />
          </PromptInputTools>

          <PromptInputTools className="shrink-0">
            <SendButton isLoading={isLoading} hasContent={hasContent} onStop={onStop} />
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

// Chat Interface Props
interface ChatInterfaceProps {
  chatId?: string;
}

// Main Chat Interface
export function ChatInterface({ chatId }: ChatInterfaceProps) {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use persistent chat hook with Convex integration
  const { messages, sendMessage, status, error, stop, isNewChat } = usePersistentChat({
    chatId,
    onChatCreated: (newChatId) => {
      // Navigate to the new chat page
      navigate({
        to: "/c/$chatId",
        params: { chatId: newChatId },
        replace: true,
      });
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Note: use-stick-to-bottom handles auto-scroll, no manual scroll needed

  // Handle submit from PromptInput
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (!message.text.trim() && message.files.length === 0) return;

      await sendMessage({
        text: message.text,
        files: message.files,
      });
    },
    [sendMessage],
  );

  // Note: handlePromptSelect is handled in ChatInterfaceContent
  // because it needs access to the PromptInputProvider context

  // Render immediately - messages will appear as they load from Convex
  // This provides instant navigation feel instead of showing a loading skeleton
  return (
    <PromptInputProvider>
      <ChatInterfaceContent
        chatId={chatId ?? null}
        messages={messages}
        isLoading={isLoading}
        isNewChat={isNewChat}
        error={error ?? null}
        stop={stop}
        handleSubmit={handleSubmit}
        textareaRef={textareaRef}
      />
    </PromptInputProvider>
  );
}

interface ChatMessageListProps {
  messages: Array<{
    id: string;
    role: string;
    parts?: Array<UIMessagePart<UIDataTypes, UITools>>;
  }>;
  isLoading: boolean;
  isNewChat: boolean;
  onPromptSelect: (prompt: string) => void;
}

const ChatMessageList = memo(function ChatMessageList({
  messages,
  isLoading,
  isNewChat,
  onPromptSelect,
}: ChatMessageListProps) {
  const processedMessages = useMemo(() => {
    if (messages.length === 0) return [];
    const streamingId = isLoading ? messages[messages.length - 1]?.id : null;

    return messages.map((message) => {
      const msg = message as typeof message & {
        error?: {
          code: string;
          message: string;
          details?: string;
          provider?: string;
          retryable?: boolean;
        };
        messageType?: "text" | "error" | "system";
      };

      const allParts = message.parts || [];
      const textParts = allParts.filter((p): p is { type: "text"; text: string } => p.type === "text");
      const fileParts = allParts.filter((p): p is { type: "file"; filename?: string; url?: string; mediaType?: string } => p.type === "file");

      const {
        steps: thinkingSteps,
        isAnyStreaming: isAnyStepStreaming,
        hasTextContent,
      } = buildChainOfThoughtSteps(allParts);

      const textContent = textParts.map((p) => p.text).join("").trim();
      const hasReasoning = allParts.some((p) => p.type === "reasoning");
      const hasFiles = fileParts.length > 0;
      const isCurrentlyStreaming = streamingId === message.id;

      const shouldSkip =
        msg.messageType !== "error" &&
        message.role === "assistant" &&
        !textContent &&
        !hasReasoning &&
        !hasFiles &&
        !isCurrentlyStreaming;

      return {
        message,
        msg,
        textParts,
        fileParts,
        thinkingSteps,
        isAnyStepStreaming,
        hasTextContent,
        isCurrentlyStreaming,
        shouldSkip,
      };
    });
  }, [messages, isLoading]);

  return (
    <Conversation className="flex-1 px-2 md:px-4" showScrollButton>
      <AutoScroll messageCount={messages.length} />
      {/* Mobile: extra top padding to clear hamburger menu (fixed left-3 top-3 size-11 = 12px + 44px + 8px breathing room = 64px) */}
      <ConversationContent className="mx-auto max-w-3xl pt-16 md:pt-6 pb-16 px-2 md:px-4">
        {messages.length === 0 && isNewChat ? (
          <StartScreen onPromptSelect={onPromptSelect} />
        ) : messages.length === 0 ? null : (
          <>
            {processedMessages.map((item) => {
              if (item.shouldSkip) return null;

              if (item.msg.messageType === "error" && item.msg.error) {
                return (
                  <div key={item.message.id}>
                    <Message from={item.message.role as "user" | "assistant"}>
                      <MessageContent>
                        <InlineErrorMessage error={item.msg.error} />
                      </MessageContent>
                    </Message>
                  </div>
                );
              }

              return (
                <div key={item.message.id}>
                  <Message from={item.message.role as "user" | "assistant"}>
                    <MessageContent>
                      {item.thinkingSteps.length > 0 && (
                        <ChainOfThought
                          steps={item.thinkingSteps}
                          isStreaming={item.isAnyStepStreaming}
                          hasTextContent={item.hasTextContent || item.textParts.length > 0}
                        />
                      )}

                      {item.textParts.map((part, partIndex) => (
                        <MessageResponse
                          key={`text-${partIndex}`}
                          isStreaming={item.isCurrentlyStreaming && partIndex === item.textParts.length - 1}
                        >
                          {part.text || ""}
                        </MessageResponse>
                      ))}

                      {item.fileParts.map((part, partIndex) => (
                        <MessageFile
                          key={`file-${partIndex}`}
                          filename={part.filename}
                          url={part.url}
                          mediaType={part.mediaType}
                        />
                      ))}
                    </MessageContent>
                  </Message>
                </div>
              );
            })}
            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <LoadingIndicator />
            )}
            {/* Note: Errors are now shown inline as messages via InlineErrorMessage */}
          </>
        )}
      </ConversationContent>
    </Conversation>
  );
});

// Inner content component that has access to PromptInputProvider context
interface ChatInterfaceContentProps {
  chatId: string | null;
  messages: Array<{
    id: string;
    role: string;
    parts?: Array<UIMessagePart<UIDataTypes, UITools>>;
  }>;
  isLoading: boolean;
  isNewChat: boolean;
  error: Error | null;
  stop: () => void;
  handleSubmit: (message: PromptInputMessage) => Promise<void>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function ChatInterfaceContent({
  chatId,
  messages,
  isLoading,
  isNewChat,
  error: _error,
  stop,
  handleSubmit,
  textareaRef,
}: ChatInterfaceContentProps) {
  const controller = usePromptInputController();

  // Persist prompt drafts to localStorage (per-chat, debounced, non-annoying)
  const { clearDraft } = usePromptDraft({
    chatId,
    textInputController: controller.textInput,
  });

  // Cmd+L / Ctrl+L keybind to toggle focus on prompt input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+L (Mac) or Ctrl+L (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();

        const textarea = textareaRef.current;
        if (!textarea) return;

        // Toggle: if textarea is focused (or contains focus), blur; otherwise focus
        const isTextareaFocused =
          document.activeElement === textarea || textarea.contains(document.activeElement as Node);

        if (isTextareaFocused) {
          textarea.blur();
          // Also blur the document to ensure we're not stuck in the input
          (document.activeElement as HTMLElement).blur();
        } else {
          textarea.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [textareaRef]);

  // Handler for StartScreen prompt selection - populates input and focuses
  const setInput = controller.textInput.setInput;
  const onPromptSelect = useCallback(
    (prompt: string) => {
      setInput(prompt);
      // Focus the textarea after setting the value
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [setInput, textareaRef],
  );

  // Wrap handleSubmit to clear the draft after successful submission
  const handleSubmitWithDraftClear = useCallback(
    async (message: PromptInputMessage) => {
      // Use .then() to only clear draft on success, preserving draft on errors for retry
      await handleSubmit(message).then(() => {
        clearDraft();
      });
    },
    [handleSubmit, clearDraft],
  );

  return (
    <div className="flex h-full flex-col">
      <ChatMessageList
        messages={messages}
        isLoading={isLoading}
        isNewChat={isNewChat}
        onPromptSelect={onPromptSelect}
      />

      <div className="px-2 md:px-4 pt-2 md:pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-4">
        <div className="mx-auto max-w-3xl">
          <PremiumPromptInputInner
            onSubmit={handleSubmitWithDraftClear}
            isLoading={isLoading}
            onStop={stop}
            textareaRef={textareaRef}
          />
        </div>
      </div>
    </div>
  );
}
