/**
 * Message - AI Elements message components
 *
 * Provides:
 * - User and assistant message styling
 * - Markdown rendering via MessageResponse
 * - File attachment support
 */

import { createContext, isValidElement, memo, useContext, useMemo, useState } from 'react'
import { Streamdown } from 'streamdown'
import { TriangleAlertIcon } from 'lucide-react'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from './code-block'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import type { ComponentProps, ReactNode } from 'react'
import type { LinkSafetyConfig, LinkSafetyModalProps, StreamdownProps } from 'streamdown'
import { useSmoothText } from '@/hooks/use-smooth-text'
import { cn } from '@/lib/utils'

// ============================================================================
// Context
// ============================================================================

interface MessageContextValue {
  from: 'user' | 'assistant'
}

const MessageContext = createContext<MessageContextValue | null>(null)

function useMessage() {
  const context = useContext(MessageContext)
  if (!context) {
    throw new Error('useMessage must be used within a Message component')
  }
  return context
}

// ============================================================================
// Message
// ============================================================================

export interface MessageProps extends ComponentProps<'div'> {
  from: 'user' | 'assistant'
  children: ReactNode
}

export const Message = ({
  from,
  children,
  className,
  ...props
}: MessageProps) => {
  const isUser = from === 'user'

  return (
    <MessageContext.Provider value={{ from }}>
      <div
        className={cn(
          'flex w-full',
          isUser ? 'justify-end' : 'justify-start',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            // User messages: constrained width, right-aligned
            // Assistant messages: full width for proper text alignment
            isUser ? 'max-w-[85%] flex flex-col items-end' : 'w-full',
          )}
        >
          {children}
        </div>
      </div>
    </MessageContext.Provider>
  )
}

// ============================================================================
// MessageContent
// ============================================================================

export interface MessageContentProps extends ComponentProps<'div'> {
  children: ReactNode
}

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => {
  const { from } = useMessage()
  const isUser = from === 'user'

  return (
    <div
      className={cn(
        'space-y-2',
        isUser && 'flex flex-col items-end',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ============================================================================
// MessageResponse - Renders markdown content with streaming support
// ============================================================================

const CODE_LANGUAGE_PATTERN = /language-([^\s]+)/

type MarkdownCodeProps = ComponentProps<'code'> & {
  node?: {
    position?: {
      start?: { line?: number }
      end?: { line?: number }
    }
  }
}

const getCodeFromNodeChildren = (children: ReactNode): string => {
  if (typeof children === 'string') {
    return children
  }

  if (Array.isArray(children)) {
    return children.map((child) => getCodeFromNodeChildren(child)).join('')
  }

  if (isValidElement<{ children?: ReactNode }>(children)) {
    return getCodeFromNodeChildren(children.props.children)
  }

  return ''
}

const MarkdownCode = memo(
  ({ className, children, node, ...props }: MarkdownCodeProps) => {
    const startLine = node?.position?.start?.line
    const endLine = node?.position?.end?.line
    const isInline =
      typeof startLine === 'number' &&
      typeof endLine === 'number' &&
      startLine === endLine

    if (isInline) {
      return (
        <code
          className={cn(
            'rounded bg-muted px-1.5 py-0.5 font-mono text-sm',
            className,
          )}
          {...props}
        >
          {children}
        </code>
      )
    }

    const language = className?.match(CODE_LANGUAGE_PATTERN)?.[1] ?? 'text'
    const code = getCodeFromNodeChildren(children).replace(/\n$/, '')

    return (
      <CodeBlock className="my-4" code={code} language={language}>
        <CodeBlockHeader className="px-3 pt-2 pb-1">
          <CodeBlockTitle>
            <CodeBlockFilename className="rounded bg-muted/45 px-2 py-0.5 text-[11px] tracking-wide">
              {language}
            </CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton className="text-muted-foreground/70 opacity-70 transition-opacity hover:text-foreground group-hover:opacity-100" />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
    )
  },
)

MarkdownCode.displayName = 'MarkdownCode'

const streamdownComponents: StreamdownProps['components'] = {
  code: MarkdownCode,
}

const LINK_SAFETY_DISABLED_KEY = 'openchat-link-safety-disabled'

function isLinkSafetyDisabled(): boolean {
  try {
    return localStorage.getItem(LINK_SAFETY_DISABLED_KEY) === 'true'
  } catch {
    return false
  }
}

function LinkSafetyModal({ url, isOpen, onClose, onConfirm }: LinkSafetyModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false)

  let displayHost: string
  try {
    const parsed = new URL(url)
    displayHost = parsed.hostname
  } catch {
    displayHost = url
  }

  const handleContinue = () => {
    if (dontShowAgain) {
      try {
        localStorage.setItem(LINK_SAFETY_DISABLED_KEY, 'true')
      } catch { /* ignore */ }
    }
    onConfirm()
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlertIcon className="size-5 text-warning" />
            Open External Link
          </AlertDialogTitle>
          <AlertDialogDescription>
            We cannot guarantee the safety of external links, be cautious and keep your personal information safe.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">
            Continue to: <span className="text-primary">{displayHost}</span>
          </p>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(checked === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <span className="text-sm font-medium text-foreground">Don't show this warning again.</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Note: We cannot guarantee the safety of external links, use this option at your own risk. You can turn this warning back on in your customization settings if you change your mind.
              </p>
            </div>
          </label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleContinue}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function useLinkSafetyConfig(): LinkSafetyConfig {
  return useMemo(() => ({
    enabled: true,
    onLinkCheck: () => isLinkSafetyDisabled(),
    renderModal: (props: LinkSafetyModalProps) => <LinkSafetyModal {...props} />,
  }), [])
}

export interface MessageResponseProps extends ComponentProps<'div'> {
  children: string
  isStreaming?: boolean
  skipInitialAnimation?: boolean
}

export const MessageResponse = ({
  children,
  className,
  isStreaming,
  skipInitialAnimation,
  ...props
}: MessageResponseProps) => {
  const { from } = useMessage()
  const isUser = from === 'user'
  const linkSafety = useLinkSafetyConfig()
  const smoothText = useSmoothText(children || '', !!isStreaming, {
    skipInitialAnimation,
  })

  if (isUser) {
    return (
      <div
        className={cn(
          'rounded-2xl bg-primary text-primary-foreground px-4 py-3',
          className,
        )}
        {...props}
      >
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {children}
        </p>
      </div>
    )
  }

  const displayText = smoothText

  return (
    <div
      className={cn(
        'max-w-none',
        'text-[15px] leading-relaxed text-foreground/90',
        '[&_a]:text-primary [&_a]:no-underline [&_a:hover]:underline',
        '[&_strong]:text-foreground [&_strong]:font-semibold',
        '[&_li]:text-[15px] [&_li]:leading-relaxed [&_li]:text-foreground/90',
        '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-8 [&_ol]:pl-8',
        '[&_blockquote]:border-l-4 [&_blockquote]:border-l-primary [&_blockquote]:pl-4 [&_blockquote]:text-foreground/80',
        '[&_hr]:my-6 [&_hr]:border-border/50',
        className,
      )}
      {...props}
    >
      <Streamdown components={streamdownComponents} linkSafety={linkSafety}>{displayText}</Streamdown>
    </div>
  )
}

// ============================================================================
// MessageFile - For file attachments
// ============================================================================

export interface MessageFileProps extends ComponentProps<'div'> {
  filename?: string
  url?: string
  mediaType?: string
}

export const MessageFile = ({
  filename,
  url,
  mediaType,
  className,
  ...props
}: MessageFileProps) => {
  const { from } = useMessage()
  const isUser = from === 'user'
  const isImage = mediaType?.startsWith('image/')

  if (isImage && url) {
    return (
      <img
        src={url}
        alt={filename || 'Attached image'}
        className={cn('max-w-full rounded-lg', className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2',
        isUser
          ? 'border border-primary-foreground/20 bg-primary-foreground/10'
          : 'border border-border bg-background/50',
        className,
      )}
      {...props}
    >
      <FileIcon className="size-4" />
      <span className="truncate text-sm">{filename || 'Attached file'}</span>
    </div>
  )
}

// Simple file icon
function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
    </svg>
  )
}
