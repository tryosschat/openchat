'use client'

import type { ComponentProps, HTMLAttributes } from 'react'
import type {
  BundledLanguage,
  BundledTheme,
  HighlighterGeneric,
  ThemedToken,
} from 'shiki'
import { bundledLanguages, createHighlighter } from 'shiki'
import { CheckIcon, CopyIcon } from 'lucide-react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: string
  showLineNumbers?: boolean
}

interface CodeBlockContextType {
  code: string
}

interface TokenizedCode {
  tokens: ThemedToken[][]
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
})

const highlighterCache = new Map<
  string,
  Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
>()
const tokenCache = new Map<string, TokenizedCode>()
const inflightTokenCache = new Map<string, Promise<TokenizedCode>>()

const LINE_NUMBER_CLASSES = cn(
  'block',
  'before:content-[counter(line)]',
  'before:inline-block',
  'before:[counter-increment:line]',
  'before:w-8',
  'before:mr-4',
  'before:text-right',
  'before:text-muted-foreground/50',
  'before:font-mono',
  'before:select-none',
)

const toBundledLanguage = (language: string): BundledLanguage => {
  const normalized = language.trim().toLowerCase()
  return normalized in bundledLanguages
    ? (normalized as BundledLanguage)
    : 'bash'
}

const hashCode = (value: string) => {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

const getTokenCacheKey = (code: string, language: string) => {
  return `${language}:${code.length}:${hashCode(code)}`
}

const getHighlighter = (
  language: BundledLanguage,
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
  const cached = highlighterCache.get(language)
  if (cached) {
    return cached
  }

  const highlighterPromise = createHighlighter({
    langs: [language],
    themes: ['github-light', 'min-dark'],
  }).catch((error) => {
    highlighterCache.delete(language)
    throw error
  })

  highlighterCache.set(language, highlighterPromise)
  return highlighterPromise
}

const createRawTokens = (code: string): TokenizedCode => ({
  tokens: code
    .split('\n')
    .map((line) =>
      line === ''
        ? []
        : [{ content: line, offset: 0, htmlStyle: {} } as ThemedToken],
    ),
})

const highlightCode = async (
  code: string,
  language: string,
): Promise<TokenizedCode> => {
  const cacheKey = getTokenCacheKey(code, language)
  const cached = tokenCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const inflight = inflightTokenCache.get(cacheKey)
  if (inflight) {
    return inflight
  }

  const promise = (async () => {
    try {
      const lang = toBundledLanguage(language)
      const highlighter = await getHighlighter(lang)
      const result = highlighter.codeToTokens(code, {
        lang,
        themes: {
          light: 'github-light',
          dark: 'min-dark',
        },
      })

      const tokenized: TokenizedCode = {
        tokens: result.tokens,
      }

      tokenCache.set(cacheKey, tokenized)
      return tokenized
    } finally {
      inflightTokenCache.delete(cacheKey)
    }
  })()

  inflightTokenCache.set(cacheKey, promise)
  return promise
}

const CodeBlockBody = memo(
  ({
    tokenized,
    showLineNumbers,
  }: {
    tokenized: TokenizedCode
    showLineNumbers: boolean
  }) => {
    return (
      <pre className="m-0 bg-transparent p-3.5 text-[13px] leading-6 text-foreground/90">
        <code
          className={cn(
            'font-mono text-[13px]',
            showLineNumbers &&
              '[counter-increment:line_0] [counter-reset:line]',
          )}
        >
          {tokenized.tokens.map((line, lineIndex) => (
            <span
              key={`line-${lineIndex}`}
              className={showLineNumbers ? LINE_NUMBER_CLASSES : 'block'}
            >
              {line.length === 0
                ? '\n'
                : line.map((token, tokenIndex) => (
                    <span
                      key={`line-${lineIndex}-token-${tokenIndex}`}
                      className="dark:!text-[var(--shiki-dark)]"
                      style={{
                        color: token.color,
                        ...token.htmlStyle,
                      }}
                    >
                      {token.content}
                    </span>
                  ))}
            </span>
          ))}
        </code>
      </pre>
    )
  },
  (prevProps, nextProps) =>
    prevProps.tokenized === nextProps.tokenized &&
    prevProps.showLineNumbers === nextProps.showLineNumbers,
)

CodeBlockBody.displayName = 'CodeBlockBody'

const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false,
}: {
  code: string
  language: string
  showLineNumbers?: boolean
}) => {
  const rawTokens = useMemo(() => createRawTokens(code), [code])
  const [tokenized, setTokenized] = useState<TokenizedCode>(rawTokens)

  useEffect(() => {
    let cancelled = false
    setTokenized(rawTokens)

    highlightCode(code, language)
      .then((result) => {
        if (!cancelled) {
          setTokenized(result)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokenized(rawTokens)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, language, rawTokens])

  return (
    <div className="relative overflow-auto bg-muted/20 dark:bg-muted/15">
      <CodeBlockBody tokenized={tokenized} showLineNumbers={showLineNumbers} />
    </div>
  )
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const contextValue = useMemo(() => ({ code }), [code])

  return (
    <CodeBlockContext.Provider value={contextValue}>
      <div
        className={cn(
          'group relative w-full overflow-hidden rounded-xl border border-border/60 bg-card/50 text-foreground',
          className,
        )}
        data-language={language}
        {...props}
      >
        {children}
        <CodeBlockContent
          code={code}
          language={language}
          showLineNumbers={showLineNumbers}
        />
      </div>
    </CodeBlockContext.Provider>
  )
}

export const CodeBlockHeader = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex items-center justify-between border-b border-border/60 bg-transparent px-3 pt-2 pb-1 text-muted-foreground text-[11px]',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export const CodeBlockTitle = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center gap-2', className)} {...props}>
    {children}
  </div>
)

export const CodeBlockFilename = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('font-mono lowercase', className)} {...props}>
    {children}
  </span>
)

export const CodeBlockActions = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('-my-1 -mr-1 flex items-center gap-1', className)}
    {...props}
  >
    {children}
  </div>
)

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
      onError?.(new Error('Clipboard API not available'))
      return
    }

    try {
      if (!isCopied) {
        await navigator.clipboard.writeText(code)
        setIsCopied(true)
        onCopy?.()
        timeoutRef.current = window.setTimeout(
          () => setIsCopied(false),
          timeout,
        )
      }
    } catch (error) {
      onError?.(error as Error)
    }
  }, [code, isCopied, onCopy, onError, timeout])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    [],
  )

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      className={cn('size-6 shrink-0', className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  )
}
