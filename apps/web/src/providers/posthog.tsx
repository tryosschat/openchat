/**
 * PostHog Analytics Provider
 */

import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { env } from "@/lib/env";

// Initialize PostHog only on client side
let posthogInitialized = false;

function initPostHog() {
  if (posthogInitialized) return;
  if (typeof window === "undefined") return;
  if (!env.POSTHOG_KEY) return;

  posthog.init(env.POSTHOG_KEY, {
    api_host: env.POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false, // We'll capture manually for SPA
    capture_pageleave: true,
    autocapture: true,
  });

  posthogInitialized = true;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  // If no PostHog key, just render children without provider
  if (!env.POSTHOG_KEY) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

/**
 * Query parameter allowlist for analytics.
 * Only these non-sensitive params are forwarded to PostHog.
 * Auth tokens (ott, code, state) and other sensitive values are stripped.
 */
const SAFE_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
]);

/**
 * Build a sanitized URL that excludes sensitive query parameters.
 * Returns `origin + pathname` plus any allowlisted params (e.g. UTMs).
 */
function getSanitizedUrl(): string {
  const url = new URL(window.location.href);
  const sanitized = new URL(url.origin + url.pathname);

  for (const [key, value] of url.searchParams) {
    if (SAFE_QUERY_PARAMS.has(key)) {
      sanitized.searchParams.set(key, value);
    }
  }

  return sanitized.toString();
}

// Hook to capture page views (call this in your router)
export function usePostHogPageView(pathname: string) {
  useEffect(() => {
    if (env.POSTHOG_KEY && posthogInitialized) {
      posthog.capture("$pageview", {
        $current_url: getSanitizedUrl(),
        $pathname: pathname,
      });
    }
  }, [pathname]);
}

// Export posthog instance for manual event capture
export { posthog };
