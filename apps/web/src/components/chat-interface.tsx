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
import { useQuery } from "convex/react";
import { api } from "@server/convex/_generated/api";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpIcon, BrainIcon, GlobeIcon,
  Loader2Icon,
  PaperclipIcon,
  SearchIcon,
  SquareIcon,
  XIcon,
  } from "lucide-react";
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
import { UserMessageActions, AssistantMessageActions } from "@/components/message-actions";

import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import type {PromptInputMessage} from "./ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { getModelById, getModelCapabilities, useModelStore, useModels } from "@/stores/model";
import { useWebSearch } from "@/stores/provider";
import { usePromptDraft } from "@/hooks/use-prompt-draft";
import { useAuth } from "@/lib/auth-client";
import {
  ChainOfThought as AiChainOfThought,
  ChainOfThoughtContent as AiChainOfThoughtContent,
  ChainOfThoughtHeader as AiChainOfThoughtHeader,
  ChainOfThoughtStep as AiChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { usePersistentChat } from "@/hooks/use-persistent-chat";

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
function buildChainOfThoughtSteps(
  parts: Array<any>,
  reasoningRequested = false,
): {
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
      if (!reasoningRequested) {
        continue;
      }
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

  if (steps.length === 0 && reasoningRequested) {
    steps.push({
      id: "reasoning-requested-no-content",
      type: "reasoning",
      label: "Thought process",
      content: "",
      status: "complete",
    });
  }

  return { steps, isAnyStreaming, hasTextContent };
}

// Chain of Thought Component - Multi-step reasoning visualization
interface ChainOfThoughtProps {
  steps: Array<ChainOfThoughtStep>;
  isStreaming?: boolean;
  hasTextContent?: boolean; // Whether the message has text content (for auto-collapse)
  thinkingTimeSec?: number;
  reasoningRequested?: boolean;
  reasoningTokenCount?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function ChainOfThought({
  steps,
  isStreaming = false,
  thinkingTimeSec,
  reasoningRequested = false,
  reasoningTokenCount,
  open,
  onOpenChange,
}: ChainOfThoughtProps) {
  const hasToolSteps = steps.some((step) => step.type === "tool");
  const reasoningText = steps
    .filter((step) => step.type === "reasoning" && step.content)
    .map((step) => step.content ?? "")
    .join("\n\n")
    .trim();
  const shouldShowHiddenReasoning =
    reasoningRequested &&
    !reasoningText &&
    !isStreaming &&
    typeof reasoningTokenCount === "number" &&
    reasoningTokenCount > 0;
  const shouldShowNoReasoningTokens =
    reasoningRequested &&
    !reasoningText &&
    !isStreaming &&
    typeof reasoningTokenCount === "number" &&
    reasoningTokenCount === 0;
  const shouldShowUnavailableReasoning =
    reasoningRequested &&
    !reasoningText &&
    !isStreaming &&
    !shouldShowHiddenReasoning &&
    !shouldShowNoReasoningTokens;
  const reasoningContent = reasoningText
    || (shouldShowHiddenReasoning
      ? "Reasoning was used for this response, but the provider returned it in a hidden/encrypted format."
      : shouldShowNoReasoningTokens
        ? "Reasoning was enabled, but this response used 0 reasoning tokens."
      : shouldShowUnavailableReasoning
        ? "Reasoning was requested, but this provider did not return visible reasoning text for this response."
        : "Thinking...");

  if (!hasToolSteps) {
    if (
      !reasoningText &&
      !isStreaming &&
      !shouldShowUnavailableReasoning &&
      !shouldShowHiddenReasoning &&
      !shouldShowNoReasoningTokens
    ) {
      return null;
    }

    return (
      <Reasoning
        isStreaming={isStreaming}
        open={open}
        defaultOpen={isStreaming}
        onOpenChange={onOpenChange}
        duration={thinkingTimeSec}
      >
        <ReasoningTrigger
          getThinkingMessage={(streaming, duration) => {
            if (shouldShowUnavailableReasoning) {
              return <p>Reasoning unavailable</p>;
            }
            if (shouldShowHiddenReasoning) {
              return <p>Reasoning hidden</p>;
            }
            if (shouldShowNoReasoningTokens) {
              return <p>No reasoning used</p>;
            }
            if (streaming) {
              return <p>Thinking...</p>;
            }
            if (duration === undefined || duration === 0) {
              return <p>Thought process</p>;
            }
            return <p>Thought for {duration} seconds</p>;
          }}
        />
        <ReasoningContent>{reasoningContent}</ReasoningContent>
      </Reasoning>
    );
  }

  const getToolLabel = (step: ChainOfThoughtStep) => {
    const input = step.toolInput as Record<string, unknown> | undefined;
    const query = input?.query as string | undefined;
    if (step.toolState === "output-available") {
      return `Search: ${query || step.toolName || "tool"}`;
    }
    if (step.toolState === "output-error") {
      return `Search failed: ${query || step.toolName || "tool"}`;
    }
    return `Searching: ${query || step.toolName || "tool"}...`;
  };

  return (
    <AiChainOfThought
      open={open}
      defaultOpen={isStreaming}
      onOpenChange={onOpenChange}
      className="mb-3 max-w-none"
    >
      <AiChainOfThoughtHeader>
        {isStreaming ? "Thinking..." : `Thought through ${steps.length} steps`}
      </AiChainOfThoughtHeader>
      <AiChainOfThoughtContent>
        {steps.map((step) => {
          const mappedStatus =
            step.status === "active" ? "active" : step.status === "pending" ? "pending" : "complete";
          const label = step.type === "tool" ? getToolLabel(step) : "Thought process";
          return (
            <AiChainOfThoughtStep
              key={step.id}
              icon={step.type === "tool" ? SearchIcon : BrainIcon}
              label={label}
              status={mappedStatus}
              className={cn(step.status === "error" && "text-destructive")}
            >
              {step.type === "reasoning" && step.content && (
                <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
                  <Streamdown>{step.content}</Streamdown>
                </div>
              )}
              {step.type === "tool" && step.toolState === "output-available" && !!step.toolOutput && (
                <SearchResultsDisplay results={step.toolOutput} isExpanded />
              )}
              {step.type === "tool" && step.toolState === "output-error" && step.errorText && (
                <p className="text-xs text-destructive">{step.errorText}</p>
              )}
            </AiChainOfThoughtStep>
          );
        })}
      </AiChainOfThoughtContent>
    </AiChainOfThought>
  );
}

// Allowed URL schemes for search result links (security: prevent XSS via javascript:/data: URLs)
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

// Validates and sanitizes a URL, returning null if the URL is invalid or uses a disallowed scheme
function getSafeUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Only allow http and https schemes to prevent XSS/phishing via javascript:, data:, etc.
    if (!ALLOWED_URL_SCHEMES.has(urlObj.protocol)) {
      return null;
    }
    return urlObj.toString();
  } catch {
    // If URL parsing fails, it's not a valid URL
    return null;
  }
}

// Helper to replace UTM source in URLs with osschat.dev
// Returns null if the URL is invalid or uses a disallowed scheme
function replaceUtmSource(url: string): string | null {
  const safeUrl = getSafeUrl(url);
  if (!safeUrl) {
    return null;
  }
  
  try {
    const urlObj = new URL(safeUrl);
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
    // If URL parsing fails after validation, return the safe URL
    return safeUrl;
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
      {searchResults.slice(0, 5).map((result: any, i: number) => {
        // Validate and sanitize the URL - returns null if unsafe (javascript:, data:, etc.)
        const rawUrl = result.url || result.link;
        const safeUrl = rawUrl ? replaceUtmSource(rawUrl) : null;
        const displayTitle = result.title || result.name || rawUrl || "Result";
        
        return (
        <div key={i} className="p-2 rounded-md bg-muted/30 border border-border/50">
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {safeUrl ? (
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:underline line-clamp-1"
                >
                  {displayTitle}
                </a>
              ) : (
                <span className="text-xs font-medium text-foreground line-clamp-1">
                  {displayTitle}
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
        );
      })}
      {searchResults.length > 5 && (
        <p className="text-xs text-muted-foreground">
          +{String(searchResults.length - 5)} more results
        </p>
      )}
    </div>
  );
}

interface ToolbarToggleProps {
  disabled?: boolean;
}

// Pill Button Component for Search/Attach
interface PillButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  hideLabel?: boolean;
}

function PillButton({ icon, label, onClick, disabled, active, className, hideLabel }: PillButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex items-center justify-center gap-1.5",
        // Mobile: icon-only with 44px touch target, Desktop: with label
        hideLabel ? "size-10 md:size-auto md:h-8 md:px-3" : "h-10 md:h-8 px-3",
        "rounded-full",
        "text-sm",
        "border transition-all duration-150",
        active
          ? "bg-primary/10 text-primary border-primary/50 hover:bg-primary/20"
          : "text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground border-border/50",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
    >
      {icon}
      {!hideLabel && <span className="hidden md:inline">{label}</span>}
    </button>
  );
}

function ReasoningToggleButton({ disabled }: ToolbarToggleProps) {
  const { selectedModelId, reasoningEnabled, setReasoningEnabled } = useModelStore();
  const { models } = useModels();
  const currentModel = getModelById(models, selectedModelId);
  const capabilities = getModelCapabilities(selectedModelId, currentModel);
  const supportsReasoning = capabilities.supportsReasoning;

  useEffect(() => {
    if (!supportsReasoning && reasoningEnabled) {
      setReasoningEnabled(false);
    }
  }, [supportsReasoning, reasoningEnabled, setReasoningEnabled]);

  if (!supportsReasoning) return null;

  return (
    <PillButton
      icon={<BrainIcon className="size-4" />}
      label="Reasoning"
      active={reasoningEnabled}
      disabled={disabled}
      onClick={() => setReasoningEnabled(!reasoningEnabled)}
    />
  );
}

function WebSearchToggleButton({ disabled }: ToolbarToggleProps) {
  const {
    enabled: webSearchEnabled,
    toggle: toggleWebSearch,
    setEnabled: setWebSearchEnabled,
    remainingSearches: localRemainingSearches,
    isLimitReached: localIsLimitReached,
  } = useWebSearch();
  const { user } = useAuth();
  const convexUser = useQuery(
    api.users.getByExternalId,
    user?.id ? { externalId: user.id } : "skip",
  );
  const backendSearchAvailability = useQuery(
    api.search.getSearchAvailability,
    convexUser?._id ? { userId: convexUser._id } : "skip",
  );
  const isConfigured = backendSearchAvailability?.configured ?? true;
  const remainingSearches = backendSearchAvailability?.remaining ?? localRemainingSearches;
  const isLimitReached = backendSearchAvailability
    ? !backendSearchAvailability.canSearch
    : localIsLimitReached;

  useEffect(() => {
    if (!isConfigured && webSearchEnabled) {
      setWebSearchEnabled(false);
    }
  }, [isConfigured, webSearchEnabled, setWebSearchEnabled]);

  const handleClick = () => {
    if (!isConfigured && !webSearchEnabled) {
      toast.error("Web search unavailable", {
        description: "Server search is not configured yet.",
      });
      return;
    }
    if (isLimitReached && !webSearchEnabled) {
      toast.error("Search limit reached", {
        description: "You've used your daily web searches. Limit resets tomorrow.",
      });
      return;
    }
    toggleWebSearch();
  };

  return (
    <PillButton
      icon={<GlobeIcon className="size-4" />}
      label={webSearchEnabled ? `Search (${remainingSearches})` : "Web Search"}
      active={webSearchEnabled}
      disabled={disabled || (!isConfigured && !webSearchEnabled) || (isLimitReached && !webSearchEnabled)}
      onClick={handleClick}
    />
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
            <ReasoningToggleButton disabled={isLoading} />
            <WebSearchToggleButton disabled={isLoading} />
            <PillButton
              icon={<PaperclipIcon className="size-4" />}
              label="Attach"
              onClick={handleAttachClick}
              disabled={isLoading}
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
	const { messages, sendMessage, editMessage, retryMessage, forkMessage, status, error, stop, isNewChat } = usePersistentChat({
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

	const handleForkMessage = useCallback(
		async (messageId: string, modelId?: string) => {
			const newChatId = await forkMessage(messageId, modelId);
			if (!newChatId) return;
			navigate({ to: "/c/$chatId", params: { chatId: newChatId } });
		},
		[forkMessage, navigate],
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
        onEditMessage={editMessage}
        onRetryMessage={retryMessage}
			onForkMessage={handleForkMessage}
        textareaRef={textareaRef}
      />
    </PromptInputProvider>
  );
}

interface ChatMessageListProps {
  chatId: string | null;
  messages: Array<{
    id: string;
    role: string;
    parts?: Array<UIMessagePart<UIDataTypes, UITools>>;
    metadata?: unknown;
  }>;
  isLoading: boolean;
  isNewChat: boolean;
  onPromptSelect: (prompt: string) => void;
  onRetryMessage: (messageId: string, modelId?: string) => Promise<void>;
	onForkMessage: (messageId: string, modelId?: string) => Promise<void>;
  editingMessageId: string | null;
  onStartEdit: (messageId: string, content: string) => void;
}

const ChatMessageList = memo(function ChatMessageList({
  chatId,
  messages,
  isLoading,
  isNewChat,
  onPromptSelect,
  onRetryMessage,
	onForkMessage,
  editingMessageId,
  onStartEdit,
}: ChatMessageListProps) {
  const [openByMessageId, setOpenByMessageId] = useState<Record<string, boolean>>({});

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      setOpenByMessageId({});
      prevChatIdRef.current = chatId;
    }
  }, [chatId]);
  const prevThinkingStreamingByMessageIdRef = useRef<Record<string, boolean>>({});

  const processedMessages = useMemo(() => {
    if (messages.length === 0) return [];

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
        modelId?: string;
        tokensPerSecond?: number;
        tokenUsage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
        timeToFirstTokenMs?: number;
        totalDurationMs?: number;
      };

      const allParts = message.parts || [];
      const textParts = allParts.filter((p): p is { type: "text"; text: string } => p.type === "text");
      const fileParts = allParts.filter(
        (p): p is Extract<UIMessagePart<UIDataTypes, UITools>, { type: "file" }> =>
          p.type === "file",
      );

      const textContent = textParts.map((p) => p.text).join("").trim();
      const hasReasoning = allParts.some((p) => p.type === "reasoning");
      const hasToolParts = allParts.some(
        (p) => typeof p.type === "string" && p.type.startsWith("tool-"),
      );
      const hasFiles = fileParts.length > 0;
      const isCurrentlyStreaming = allParts.some((part) => {
        if ("state" in part && part.state === "streaming") {
          return true;
        }
        if (typeof part.type === "string" && part.type.startsWith("tool-")) {
          const toolState = (part as { state?: unknown }).state;
          return toolState === "input-streaming";
        }
        return false;
      });
      const metadata = message.metadata as {
        thinkingTimeSec?: unknown;
        reasoningRequested?: unknown;
        reasoningTokenCount?: unknown;
        resumedFromActiveStream?: unknown;
        modelId?: string;
        tokensPerSecond?: number;
        timeToFirstTokenMs?: number;
        totalDurationMs?: number;
        tokenUsage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
      } | undefined;
      const thinkingTimeSec =
        typeof metadata?.thinkingTimeSec === "number"
          ? metadata.thinkingTimeSec
          : undefined;
      const reasoningRequested = metadata?.reasoningRequested === true;
      const reasoningTokenCount =
        typeof metadata?.reasoningTokenCount === "number"
          ? metadata.reasoningTokenCount
          : undefined;
      const resumedFromActiveStream = metadata?.resumedFromActiveStream === true;

      const {
        steps: thinkingSteps,
        isAnyStreaming: isAnyStepStreaming,
        hasTextContent,
      } = buildChainOfThoughtSteps(allParts, reasoningRequested);

      const shouldSkip =
        msg.messageType !== "error" &&
        message.role === "assistant" &&
        !textContent &&
        !hasReasoning &&
        !reasoningRequested &&
        !hasToolParts &&
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
        thinkingTimeSec,
        reasoningRequested,
        reasoningTokenCount,
        resumedFromActiveStream,
        isCurrentlyStreaming,
        shouldSkip,
      };
    });
  }, [messages]);

  useEffect(() => {
    const prevThinkingStreamingByMessageId = prevThinkingStreamingByMessageIdRef.current;
    setOpenByMessageId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of processedMessages) {
        const hasStartedAnswerText = item.textParts.some((part) => part.text.trim().length > 0);

        if (item.isAnyStepStreaming && !hasStartedAnswerText && next[item.message.id] !== true) {
          next[item.message.id] = true;
          changed = true;
        }

        const wasThinkingStreaming = prevThinkingStreamingByMessageId[item.message.id] === true;
        if (
          wasThinkingStreaming &&
          hasStartedAnswerText &&
          next[item.message.id] !== false
        ) {
          next[item.message.id] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    const nextThinkingStreamingByMessageId: Record<string, boolean> = {};
    for (const item of processedMessages) {
      nextThinkingStreamingByMessageId[item.message.id] = item.isAnyStepStreaming;
    }
    prevThinkingStreamingByMessageIdRef.current = nextThinkingStreamingByMessageId;
  }, [processedMessages]);

  const setPanelOpen = useCallback((messageId: string, open: boolean) => {
    setOpenByMessageId((prev) => {
      if (prev[messageId] === open) return prev;
      return { ...prev, [messageId]: open };
    });
  }, []);

  return (
    <Conversation className="flex-1 px-2 md:px-4" showScrollButton>
      <AutoScroll messageCount={messages.length} />
      {/* Mobile: extra top padding to clear hamburger menu (fixed left-3 top-3 size-11 = 12px + 44px + 8px breathing room = 64px) */}
      <ConversationContent className="mx-auto max-w-3xl pt-16 md:pt-6 pb-16 px-2 md:px-4">
        {messages.length === 0 && isNewChat ? (
          <StartScreen onPromptSelect={onPromptSelect} />
        ) : messages.length === 0 ? null : (
          <>
			{processedMessages.map((item, itemIndex) => {
              if (item.shouldSkip) return null;

              if (item.msg.messageType === "error" && item.msg.error) {
                return (
                  <div key={item.message.id} className="group">
                    <Message from={item.message.role as "user" | "assistant"}>
                      <MessageContent>
                        <InlineErrorMessage error={item.msg.error} />
                      </MessageContent>
                    </Message>
                  </div>
                );
              }

              return (
                <div key={item.message.id} className={cn("group", editingMessageId === item.message.id && "ring-2 ring-primary/30 rounded-2xl")}>
                  <Message from={item.message.role as "user" | "assistant"}>
                      <MessageContent>
                        {item.thinkingSteps.length > 0 && (
                          <ChainOfThought
                            steps={item.thinkingSteps}
                            isStreaming={item.isAnyStepStreaming}
                            hasTextContent={item.hasTextContent || item.textParts.length > 0}
                            thinkingTimeSec={item.thinkingTimeSec}
                            reasoningRequested={item.reasoningRequested}
                            reasoningTokenCount={item.reasoningTokenCount}
                            open={openByMessageId[item.message.id] ?? item.isAnyStepStreaming}
                            onOpenChange={(open) => setPanelOpen(item.message.id, open)}
                          />
                        )}

                        {item.textParts.map((part, partIndex) => (
                          <MessageResponse
                            key={`text-${partIndex}`}
                            isStreaming={item.isCurrentlyStreaming && partIndex === item.textParts.length - 1}
                            skipInitialAnimation={item.resumedFromActiveStream}
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
					{item.message.role === "user" ? (
						<UserMessageActions
							messageId={item.message.id}
							content={item.textParts.map((p) => p.text).join("")}
							isStreaming={item.isCurrentlyStreaming || editingMessageId === item.message.id}
							onEdit={() => onStartEdit(item.message.id, item.textParts.map((p) => p.text).join(""))}
							onRetry={(modelId) => {
								void onRetryMessage(item.message.id, modelId);
							}}
							onFork={(modelId) => {
								void onForkMessage(item.message.id, modelId);
							}}
						/>
					) : (
						<AssistantMessageActions
							messageId={item.message.id}
							content={item.textParts.map((p) => p.text).join("")}
							isStreaming={item.isCurrentlyStreaming}
							analytics={{
								modelId: (item.message.metadata as Record<string, unknown> | undefined)?.modelId as string | undefined,
								tokensPerSecond: (item.message.metadata as Record<string, unknown> | undefined)?.tokensPerSecond as number | undefined,
								tokenUsage: (item.message.metadata as Record<string, unknown> | undefined)?.tokenUsage as { promptTokens: number; completionTokens: number; totalTokens: number } | undefined,
								timeToFirstTokenMs: (item.message.metadata as Record<string, unknown> | undefined)?.timeToFirstTokenMs as number | undefined,
							}}
							onRetry={(modelId) => {
								const precedingUser = processedMessages.slice(0, itemIndex)
									.reverse()
									.find((candidate) => candidate.message.role === "user");

								if (!precedingUser) {
									toast.error("Could not retry response", {
										description: "No preceding user message found for this assistant response.",
									});
									return;
								}

								void onRetryMessage(precedingUser.message.id, modelId);
							}}
							onFork={(modelId) => {
								const precedingUser = processedMessages.slice(0, itemIndex)
									.reverse()
									.find((candidate) => candidate.message.role === "user");

								if (!precedingUser) {
									toast.error("Could not branch off", {
										description: "No preceding user message found for this assistant response.",
									});
									return;
								}

								void onForkMessage(precedingUser.message.id, modelId);
							}}
						/>
                    )}
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
    metadata?: unknown;
  }>;
  isLoading: boolean;
  isNewChat: boolean;
  error: Error | null;
  stop: () => void;
  handleSubmit: (message: PromptInputMessage) => Promise<void>;
  onEditMessage: (messageId: string, newContent: string) => Promise<void>;
  onRetryMessage: (messageId: string, modelId?: string) => Promise<void>;
	onForkMessage: (messageId: string, modelId?: string) => Promise<void>;
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
  onEditMessage,
  onRetryMessage,
	onForkMessage,
  textareaRef,
}: ChatInterfaceContentProps) {
  const controller = usePromptInputController();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const savedDraftRef = useRef<string>("");

  // Persist prompt drafts to localStorage (per-chat, debounced, non-annoying)
  const { clearDraft } = usePromptDraft({
    chatId,
    textInputController: controller.textInput,
  });

  useEffect(() => {
    setEditingMessageId(null);
    setIsSavingEdit(false);
  }, [chatId]);

  // Cmd+L / Ctrl+L keybind to toggle focus on prompt input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingMessageId) {
        e.preventDefault();
        cancelEdit();
        return;
      }
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
  }, [textareaRef, editingMessageId]);

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

  const startEdit = useCallback(
    (messageId: string, content: string) => {
      savedDraftRef.current = controller.textInput.value;
      setEditingMessageId(messageId);
      setInput(content);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [controller.textInput.value, setInput, textareaRef],
  );

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setIsSavingEdit(false);
    setInput(savedDraftRef.current);
    savedDraftRef.current = "";
  }, [setInput]);

  const handleSubmitWithDraftClear = useCallback(
    async (message: PromptInputMessage) => {
      if (editingMessageId) {
        if (!message.text.trim()) return;
        try {
          setIsSavingEdit(true);
          await onEditMessage(editingMessageId, message.text);
          setEditingMessageId(null);
          setIsSavingEdit(false);
          savedDraftRef.current = "";
          clearDraft();
        } catch {
          setIsSavingEdit(false);
        }
        return;
      }
      await handleSubmit(message).then(() => {
        clearDraft();
      });
    },
    [handleSubmit, clearDraft, editingMessageId, onEditMessage],
  );

  return (
    <div className="flex h-full flex-col">
      <ChatMessageList
        chatId={chatId}
        messages={messages}
        isLoading={isLoading}
        isNewChat={isNewChat}
        onPromptSelect={onPromptSelect}
        onRetryMessage={onRetryMessage}
			onForkMessage={onForkMessage}
        editingMessageId={editingMessageId}
        onStartEdit={startEdit}
      />

      <div className="px-2 md:px-4 pt-2 md:pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-4">
        <div className="mx-auto max-w-3xl">
          {editingMessageId && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
              <span className="text-sm text-primary font-medium">Editing message</span>
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3" />
                Cancel
              </button>
            </div>
          )}
          <PremiumPromptInputInner
            onSubmit={handleSubmitWithDraftClear}
            isLoading={isLoading || isSavingEdit}
            onStop={stop}
            textareaRef={textareaRef}
          />
        </div>
      </div>
    </div>
  );
}
