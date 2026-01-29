/**
 * Message - AI Elements message components
 *
 * Provides:
 * - User and assistant message styling
 * - Markdown rendering via MessageResponse
 * - File attachment support
 */

"use client";

import { createContext, useContext } from "react";
import { Streamdown } from "streamdown";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// Context
// ============================================================================

interface MessageContextValue {
  from: "user" | "assistant";
}

const MessageContext = createContext<MessageContextValue | null>(null);

function useMessage() {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error("useMessage must be used within a Message component");
  }
  return context;
}

// ============================================================================
// Message
// ============================================================================

export interface MessageProps extends ComponentProps<"div"> {
  from: "user" | "assistant";
  children: ReactNode;
}

export const Message = ({ from, children, className, ...props }: MessageProps) => {
  const isUser = from === "user";

  return (
    <MessageContext.Provider value={{ from }}>
      <div
        className={cn("flex w-full", isUser ? "justify-end" : "justify-start", className)}
        {...props}
      >
        <div
          className={cn(
            // User messages: constrained width, right-aligned
            // Assistant messages: full width for proper text alignment
            isUser ? "max-w-[85%] flex flex-col items-end" : "w-full",
          )}
        >
          {children}
        </div>
      </div>
    </MessageContext.Provider>
  );
};

// ============================================================================
// MessageContent
// ============================================================================

export interface MessageContentProps extends ComponentProps<"div"> {
  children: ReactNode;
}

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => {
  const { from } = useMessage();
  const isUser = from === "user";

  return (
    <div className={cn("space-y-2", isUser && "flex flex-col items-end", className)} {...props}>
      {children}
    </div>
  );
};

// ============================================================================
// MessageResponse - Renders markdown content with streaming support
// ============================================================================

export interface MessageResponseProps extends ComponentProps<"div"> {
  children: string;
  isStreaming?: boolean;
}

export const MessageResponse = ({ children, className, isStreaming, ...props }: MessageResponseProps) => {
  const { from } = useMessage();
  const isUser = from === "user";

  if (isUser) {
    return (
      <div
        className={cn("rounded-2xl bg-primary text-primary-foreground px-4 py-3", className)}
        {...props}
      >
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{children}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "prose dark:prose-invert max-w-none",
        "prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-foreground/90",
        "prose-headings:text-foreground prose-headings:font-semibold",
        "prose-h1:text-xl prose-h1:mt-6 prose-h1:mb-3",
        "prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2",
        "prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2",
        "prose-li:text-[15px] prose-li:leading-relaxed prose-li:text-foreground/90 prose-li:my-1",
        "prose-ul:my-3 prose-ol:my-3 prose-ul:pl-8 prose-ol:pl-8 prose-ul:list-disc prose-ol:list-decimal",
        "prose-code:text-sm prose-code:font-medium prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:border prose-pre:border-border/50 prose-pre:rounded-lg prose-pre:my-4",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-blockquote:border-l-primary prose-blockquote:text-foreground/80 prose-blockquote:not-italic",
        "prose-hr:border-border/50 prose-hr:my-6",
        "prose-strong:text-foreground prose-strong:font-semibold",
        className,
      )}
      {...props}
    >
      <Streamdown>{children || ""}</Streamdown>
    </div>
  );
};

// ============================================================================
// MessageFile - For file attachments
// ============================================================================

export interface MessageFileProps extends ComponentProps<"div"> {
  filename?: string;
  url?: string;
  mediaType?: string;
}

export const MessageFile = ({
  filename,
  url,
  mediaType,
  className,
  ...props
}: MessageFileProps) => {
  const { from } = useMessage();
  const isUser = from === "user";
  const isImage = mediaType?.startsWith("image/");

  if (isImage && url) {
    return (
      <img
        src={url}
        alt={filename || "Attached image"}
        className={cn("max-w-full rounded-lg", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2",
        isUser
          ? "border border-primary-foreground/20 bg-primary-foreground/10"
          : "border border-border bg-background/50",
        className,
      )}
      {...props}
    >
      <FileIcon className="size-4" />
      <span className="truncate text-sm">{filename || "Attached file"}</span>
    </div>
  );
};

// Simple file icon
function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
    </svg>
  );
}
