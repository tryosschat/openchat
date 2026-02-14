import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, useMutation, useQuery } from "convex/react";
import { Toaster } from "sonner";
import { api } from "@server/convex/_generated/api";
import { convexClient } from "../lib/convex";
import { StableAuthProvider, authClient, useAuth, type InitialAuthUser } from "../lib/auth-client";
import { prefetchModels } from "../stores/model";
import { useProviderStore } from "../stores/provider";
import { useOpenRouterStore } from "../stores/openrouter";
import { ThemeProvider } from "./theme-provider";
import { PostHogProvider } from "./posthog";

if (typeof window !== "undefined") {
  const schedulePrefetch = () => {
    const connection = (navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }).connection;
    if (connection?.saveData) return;
    if (connection?.effectiveType && /2g/.test(connection.effectiveType)) return;

    const run = () => prefetchModels();
    const requestIdle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;

    if (typeof requestIdle === "function") {
      requestIdle(run, { timeout: 2000 });
    } else {
      setTimeout(run, 1500);
    }
  };

  if (document.readyState === "complete") {
    schedulePrefetch();
  } else {
    window.addEventListener("load", schedulePrefetch, { once: true });
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

interface ProvidersProps {
  children: React.ReactNode;
  initialUser?: InitialAuthUser;
}

function useStableConvexAuth() {
  const { isAuthenticated, loading } = useAuth();

  const fetchAccessToken = useCallback(async () => {
    if (!isAuthenticated) return null;
    try {
      const result = await authClient.convex.token();
      return result.data?.token || null;
    } catch {
      return null;
    }
  }, [isAuthenticated]);

  return useMemo(
    () => ({ isLoading: loading, isAuthenticated, fetchAccessToken }),
    [loading, isAuthenticated, fetchAccessToken]
  );
}

/**
 * Component that syncs Better Auth users to Convex users table.
 * This is CRITICAL - without this, convexUserId will be undefined
 * and message sending will silently fail.
 */
function UserSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const ensureUser = useMutation(api.users.ensure);
  const syncedRef = useRef(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    // Only sync once when user is authenticated and we have user data
    if (loading || !isAuthenticated || !user?.id || syncedRef.current || syncingRef.current) {
      return;
    }

    syncingRef.current = true;

    // Sync Better Auth user to Convex users table
    ensureUser({
      externalId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.image ?? undefined,
    })
      .then(() => {
        syncedRef.current = true;
        console.log("[UserSync] User synced to Convex successfully");
      })
      .catch((error) => {
        console.error("[UserSync] Failed to sync user to Convex:", error);
        // Reset so we can retry on next render
        syncingRef.current = false;
      });
  }, [loading, isAuthenticated, user, ensureUser]);

  return <>{children}</>;
}

function UsageSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const syncUsage = useProviderStore((s) => s.syncUsage);
  const resetDailyUsage = useProviderStore((s) => s.resetDailyUsage);
  const convexUser = useQuery(
    api.users.getByExternalId,
    !loading && isAuthenticated && user?.id ? { externalId: user.id } : "skip",
  );

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      resetDailyUsage();
      return;
    }
    if (!convexUser) return;
    const today = new Date().toISOString().split("T")[0];
    const serverDate = convexUser.aiUsageDate ?? today;
    const serverUsage =
      serverDate === today ? (convexUser.aiUsageCents ?? 0) : 0;
    syncUsage(serverUsage, today);
  }, [
    convexUser,
    isAuthenticated,
    resetDailyUsage,
    syncUsage,
    user?.id,
  ]);

  return <>{children}</>;
}

/**
 * Component that checks OpenRouter API key status from the server.
 * This syncs the hasApiKey state without exposing the actual key to the client.
 */
function OpenRouterKeyStatusProvider({ children }: { children: React.ReactNode }) {
	const { isAuthenticated, loading } = useAuth();
	const initialize = useOpenRouterStore((s) => s.initialize);
	const checkedRef = useRef(false);
	const checkingRef = useRef(false);

  useEffect(() => {
    // Only check once when user is authenticated
    if (loading || !isAuthenticated || checkedRef.current || checkingRef.current) {
      return;
    }

    checkingRef.current = true;
    
		initialize()
			.then(() => {
				checkedRef.current = true;
				console.log("[OpenRouterKeyStatus] API key status checked successfully");
			})
      .catch((error: unknown) => {
        console.error("[OpenRouterKeyStatus] Failed to check API key status:", error);
        // Reset so we can retry on next render
        checkingRef.current = false;
      });
	}, [loading, isAuthenticated, initialize]);

  // Reset checked state when user logs out
  useEffect(() => {
    if (!isAuthenticated && !loading) {
      checkedRef.current = false;
      checkingRef.current = false;
    }
  }, [isAuthenticated, loading]);

  return <>{children}</>;
}

function ConvexAuthWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convexClient!} useAuth={useStableConvexAuth}>
      <UserSyncProvider>
        <UsageSyncProvider>
          <OpenRouterKeyStatusProvider>{children}</OpenRouterKeyStatusProvider>
        </UsageSyncProvider>
      </UserSyncProvider>
    </ConvexProviderWithAuth>
  );
}

export function Providers({ children, initialUser }: ProvidersProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const content = (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster richColors position="bottom-right" theme="system" />
      </QueryClientProvider>
    </ThemeProvider>
  );

  if (!isClient || !convexClient) {
    return <PostHogProvider>{content}</PostHogProvider>;
  }

  return (
    <PostHogProvider>
      <StableAuthProvider initialUser={initialUser}>
        <ConvexAuthWrapper>{content}</ConvexAuthWrapper>
      </StableAuthProvider>
    </PostHogProvider>
  );
}
