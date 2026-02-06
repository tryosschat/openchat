import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { Providers } from "../providers";
import { CommandPalette, useCommandPaletteShortcut } from "../components/command-palette";
import { SidebarInset, SidebarProvider } from "../components/ui/sidebar";
import { NavigationProgress } from "../components/navigation-progress";
import { AppSidebar } from "../components/app-sidebar";
import { useAuth } from "../lib/auth-client";
import { usePostHogPageView } from "../providers/posthog";
import { convexClient } from "../lib/convex";

import appCss from "../styles.css?url";

const SITE_URL = "https://osschat.dev";
const SITE_NAME = "osschat";
const SITE_DESCRIPTION = "Open source AI chat with 350+ models. Access GPT-4, Claude, Gemini, and more through one beautiful interface. Free tier available, no API key required.";
const SITE_TAGLINE = "One interface. Every AI model.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      // Basic
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: `${SITE_NAME} - ${SITE_TAGLINE}` },
      { name: "description", content: SITE_DESCRIPTION },

      // SEO
      { name: "robots", content: "index, follow" },
      { name: "author", content: "osschat" },
      { name: "keywords", content: "AI chat, ChatGPT alternative, Claude, GPT-4, Gemini, open source, OpenRouter, AI assistant, LLM, free AI chat" },

      // Theme
      { name: "theme-color", content: "#1C1917" },
      { name: "color-scheme", content: "dark light" },

      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: `${SITE_NAME} - ${SITE_TAGLINE}` },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: `${SITE_URL}/og-image.png` },
      { property: "og:image:width", content: "1920" },
      { property: "og:image:height", content: "1440" },
      { property: "og:image:alt", content: "osschat - Open source AI chat interface" },
      { property: "og:locale", content: "en_US" },

      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@osschat" },
      { name: "twitter:creator", content: "@leodev" },
      { name: "twitter:title", content: `${SITE_NAME} - ${SITE_TAGLINE}` },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: `${SITE_URL}/og-image.png` },
      { name: "twitter:image:alt", content: "osschat - Open source AI chat interface" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: SITE_URL },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", href: "/logo.svg?v=2", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico?v=2", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2" },
    ],
    scripts: [
      // Theme initialization
      {
        children: `
          (function() {
            const stored = localStorage.getItem('openchat-theme');
            const theme = stored === 'dark' || stored === 'light' ? stored :
              (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.classList.add(theme);
          })();
        `,
      },
      // Structured Data (JSON-LD)
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          "name": SITE_NAME,
          "description": SITE_DESCRIPTION,
          "url": SITE_URL,
          "applicationCategory": "UtilityApplication",
          "operatingSystem": "Any",
          "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD",
          },
          "creator": {
            "@type": "Organization",
            "name": "osschat",
            "url": SITE_URL,
            "sameAs": [
              "https://github.com/tryosschat/openchat",
              "https://x.com/osschat",
            ],
          },
          "featureList": [
            "Access to 350+ AI models",
            "GPT-4, Claude, Gemini support",
            "Free tier with daily limit",
            "Bring your own OpenRouter API key",
            "100% open source",
          ],
        }),
      },
      // Analytics
      {
        src: "https://assets.onedollarstats.com/stonks.js",
        defer: true,
      },
    ],
  }),

  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Providers>
        <AppShell />
      </Providers>
    </RootDocument>
  );
}

function AppShell() {
  // Register global keyboard shortcuts
  useCommandPaletteShortcut();

  // Track page views
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  usePostHogPageView(pathname);

  const { isAuthenticated, loading } = useAuth();

  if (!convexClient || loading) {
    return (
      <div className="flex h-screen w-full bg-sidebar">
        <div className="w-64 shrink-0 bg-sidebar" />
        <div className="flex-1 bg-background" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Outlet />
        <CommandPalette />
      </>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset className="relative overflow-hidden">
        <Outlet />
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <HeadContent />
      </head>
      <body className="h-full overflow-hidden bg-background antialiased" suppressHydrationWarning>
        <NavigationProgress />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
