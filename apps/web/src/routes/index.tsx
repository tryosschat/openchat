import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "../lib/auth-client";
import { Button } from "../components/ui/button";
import { ChatInterface } from "../components/chat-interface";
import { ChangelogButton } from "../components/changelog-button";
import { convexClient } from "../lib/convex";
import { useRef, useCallback, useState, useEffect } from "react";

export const Route = createFileRoute('/')({
  component: HomePage,
})

const GAP = 2

function generateStaircaseSquares(gridSize: number) {
  const squares: { col: number; row: number; key: string }[] = []

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
  anchorTop = false,
}: {
  className?: string
  anchorTop?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [layout, setLayout] = useState({ gridSize: 7, squareSize: 80 })

  useEffect(() => {
    const updateLayout = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        // Portrait: use width to make staircase bigger
        // Landscape: use smaller dimension
        const baseDimension = anchorTop
          ? window.innerWidth * 0.7
          : Math.min(rect.width, rect.height)
        const gridSize = 7
        const squareSize = Math.floor(
          (baseDimension - GAP * (gridSize - 1)) / gridSize,
        )
        setLayout({ gridSize, squareSize: Math.max(squareSize, 40) })
      }
    }

    const timer = setTimeout(updateLayout, 50)
    window.addEventListener('resize', updateLayout)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', updateLayout)
    }
  }, [anchorTop])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
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
    const effectRadius = squareSize * 3
    if (distance > effectRadius) return 1
    return 0.7 + 0.3 * (distance / effectRadius)
  }

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
        const rect = containerRef.current?.getBoundingClientRect()
        const centerX = (rect?.width ?? 0) - rightPos - squareSize / 2
        const centerY = anchorTop
          ? verticalPos + squareSize / 2
          : (rect?.height ?? 0) - verticalPos - squareSize / 2
        const scale = getScale(centerX, centerY)

        return (
          <div
            key={key}
            className="absolute bg-primary transition-transform duration-150 ease-out"
            style={{
              width: squareSize,
              height: squareSize,
              right: rightPos,
              ...(anchorTop ? { top: verticalPos } : { bottom: verticalPos }),
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
    <div className="flex min-h-screen flex-col-reverse md:flex-row bg-background overflow-hidden">
      {/* Content Section */}
      <div className="flex flex-1 flex-col justify-between p-8 md:p-12 lg:p-16 min-h-[60vh] md:min-h-screen">
        <div className="flex-1" />

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

        {/* Footer Links */}
        <div className="mt-12 flex items-center gap-1.5 text-sm text-muted-foreground">
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
        </div>
      </div>

      {/* Staircase Section */}
      <div className="relative h-[40vh] md:h-screen md:w-1/2 shrink-0">
        {/* Portrait: \ from top-right (shown on mobile) */}
        <div className="absolute inset-0 md:hidden">
          <InteractiveStaircase className="w-full h-full" anchorTop />
        </div>
        {/* Landscape: / from bottom-right (shown on desktop) */}
        <div className="absolute inset-0 hidden md:block">
          <InteractiveStaircase className="w-full h-full" />
        </div>
      </div>
    </div>
  )
}

function HomePage() {
  const { isAuthenticated, loading } = useAuth();

  if (!convexClient || loading) {
    return <div className="flex h-full bg-background" />;
  }

  if (!isAuthenticated) {
    return <LandingPage />
  }

  return <ChatInterface />
}
