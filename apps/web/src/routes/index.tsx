import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-client";
import { Button } from "../components/ui/button";
import { ChatInterface } from "../components/chat-interface";
import { convexClient } from "../lib/convex";

export const Route = createFileRoute('/')({
  component: HomePage,
})

const GAP = 2

function generateStaircaseSquares(gridSize: number) {
  const squares: Array<{ col: number; row: number; key: string }> = []

  for (let row = 0; row < gridSize; row++) {
    const colsToFill = gridSize - row
    for (let col = gridSize - colsToFill; col < gridSize; col++) {
      squares.push({
        col,
        row,
        key: `${col}-${row}`,
      })
    }
  }

  return squares
}

function InteractiveStaircase({
  className,
}: {
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [layout, setLayout] = useState({ gridSize: 12, squareSize: 40 })

  useEffect(() => {
    const updateLayout = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        rectRef.current = rect
        const gridSize = 12

        const availableSize = Math.min(rect.width, rect.height)
        const squareSize = Math.floor(
          (availableSize - GAP * (gridSize - 1)) / gridSize,
        )

        setLayout({ gridSize, squareSize: Math.max(squareSize, 10) })
      }
    }

    // Use requestAnimationFrame for proper initial layout timing
    const rafId = requestAnimationFrame(updateLayout)
    window.addEventListener('resize', updateLayout)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateLayout)
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Use cached rect to avoid getBoundingClientRect on every mouse move
    const rect = rectRef.current
    if (rect) {
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    setMousePos(null)
  }, [])

  const { gridSize, squareSize } = layout
  const stepSize = squareSize + GAP
  const squares = generateStaircaseSquares(gridSize)

  const getScale = (centerX: number, centerY: number) => {
    if (!mousePos) return 1
    const distance = Math.sqrt(
      (mousePos.x - centerX) ** 2 + (mousePos.y - centerY) ** 2,
    )
    const effectRadius = squareSize * 4
    if (distance > effectRadius) return 1
    return 0.6 + 0.4 * (distance / effectRadius)
  }

  // Use cached rect for container dimensions
  const containerWidth = rectRef.current?.width ?? 0
  const containerHeight = rectRef.current?.height ?? 0

  return (
    <div
      ref={containerRef}
      className={`${className} relative`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {squares.map(({ col, row, key }) => {
        const rightPos = (gridSize - 1 - col) * stepSize
        const verticalPos = row * stepSize
        const centerX = containerWidth - rightPos - squareSize / 2
        const centerY = containerHeight - verticalPos - squareSize / 2
        const scale = getScale(centerX, centerY)

        return (
          <div
            key={key}
            className="absolute bg-primary transition-transform duration-150 ease-out"
            style={{
              width: squareSize,
              height: squareSize,
              right: rightPos,
              bottom: verticalPos,
              transform: `scale(${scale})`,
            }}
          />
        )
      })}
    </div>
  )
}

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background overflow-hidden">
      {/* Content Section */}
      <div className="flex flex-1 flex-col justify-between p-8 md:p-12 lg:p-16 min-h-[60vh] md:min-h-screen">
        {/* Main Content */}
        <div className="space-y-6">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground">
            osschat
          </h1>
          <p className="text-lg text-muted-foreground max-w-md">
            the coolest open source ai chat powered by openrouter
          </p>
          <Link to="/auth/sign-in">
            <Button variant="outline" size="lg">
              sign in
            </Button>
          </Link>
        </div>

        <div className="flex-1" />

        {/* Footer Links */}
        <div className="mt-12 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
          <span>by</span>
          <a
            href="https://x.com/leodev"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
          >
            @leodev
          </a>
          <span>·</span>
          <a
            href="https://x.com/osschat"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
          >
            @osschat
          </a>
          <span>·</span>
          <a
            href="https://github.com/tryosschat/openchat"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
          >
            github
          </a>
          <span>·</span>
          <Link
            to="/about"
            className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
          >
            about
          </Link>
          <span>·</span>
          <Link
            to="/privacy"
            className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
          >
            privacy
          </Link>
          <span>·</span>
          <Link
            to="/terms"
            className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
          >
            terms
          </Link>
        </div>
      </div>

      {/* Staircase Section */}
      <div className="relative h-[40vh] md:h-screen md:flex-1 shrink-0">
        <div className="absolute inset-0">
          <InteractiveStaircase className="w-full h-full" />
        </div>
      </div>
    </div>
  )
}

function HomePage() {
  const { isAuthenticated, loading } = useAuth();

  // Load autochangelog in-app widget only on root page for authenticated users
  useEffect(() => {
    if (!isAuthenticated) return;

    const scriptId = 'autochangelog-in-app';
    if (document.getElementById(scriptId)) return;

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://autochangelog.com/embed/tryosschat/osschat/in-app.js';
    document.body.appendChild(script);

    return () => {
      const existingScript = document.getElementById(scriptId);
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, [isAuthenticated]);

  if (!convexClient || loading) {
    return <div className="flex h-full bg-background" />;
  }

  if (!isAuthenticated) {
    return <LandingPage />
  }

  return <ChatInterface />
}
