import {
  
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import { createAuthClient } from "better-auth/react";
import {
  convexClient as convexAuthPlugin,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { env } from "./env";
import { analytics } from "./analytics";
import type {ReactNode} from "react";


/**
 * Deduplicating storage that only triggers updates when value actually changes.
 * This prevents the infinite loop caused by crossDomainClient's $sessionSignal notification.
 */
const deduplicatingStorage = {
  _cache: new Map<string, string>(),

  setItem: (key: string, value: string) => {
    const cached = deduplicatingStorage._cache.get(key);
    // Only write if value actually changed
    if (cached === value) {
      return;
    }

    deduplicatingStorage._cache.set(key, value);
    localStorage.setItem(key, value);

  },

  getItem: (key: string) => {
    // Populate cache from localStorage on first read
    if (!deduplicatingStorage._cache.has(key)) {
      const value = localStorage.getItem(key);
      if (value) {
        deduplicatingStorage._cache.set(key, value);
      }
    }
    return localStorage.getItem(key);
  },

  removeItem: (key: string) => {
    deduplicatingStorage._cache.delete(key);
    localStorage.removeItem(key);
  },
};

/**
 * Better Auth client with Convex integration
 *
 * IMPORTANT: Uses deduplicating storage to prevent the infinite session loop.
 * The crossDomainClient plugin notifies $sessionSignal on EVERY response with
 * set-better-auth-cookie header, causing useSession to refetch endlessly.
 * Our deduplicating storage prevents writes when value hasn't changed,
 * breaking the loop.
 */
export const authClient = createAuthClient({
  baseURL: env.CONVEX_SITE_URL,
  // Disable aggressive session refetching to prevent API spam
  sessionOptions: {
    refetchOnWindowFocus: false,
    refetchInterval: 0,
    refetchWhenOffline: false,
  },
  plugins: [
    convexAuthPlugin(),
    crossDomainClient({
      storage: deduplicatingStorage,
      // Disable local session cache - we manage caching ourselves
      disableCache: true,
    }),
  ],
});

// ============================================================================
// NON-REACTIVE SESSION MANAGEMENT
// ============================================================================
// The core issue is that ConvexBetterAuthProvider uses authClient.useSession()
// which is reactive to $sessionSignal. Every time the signal fires, it refetches.
// Instead, we fetch session ONCE and cache it, only refetching on explicit actions.

interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

interface SessionData {
  user: SessionUser | null;
  session: { id: string; token: string } | null;
}

interface AuthContextValue {
  user: SessionUser | null;
  session: { id: string; token: string } | null;
  loading: boolean;
  isAuthenticated: boolean;
  refetchSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Non-reactive auth provider that fetches session once and caches it.
 * This prevents the infinite loop caused by $sessionSignal notifications.
 */
export function StableAuthProvider({ children }: { children: ReactNode }) {
  const [sessionData, setSessionData] = useState<SessionData>({
    user: null,
    session: null,
  });
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);
  const fetchingRef = useRef(false);

  const fetchSession = useCallback(async () => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      // Use getSession directly instead of the reactive useSession hook
      const result = await authClient.getSession();
      if (result.data?.user) {
        setSessionData({
          user: {
            id: result.data.user.id,
            email: result.data.user.email,
            name:
              result.data.user.name ||
              result.data.user.email.split("@")[0] ||
              "User",
            image: result.data.user.image ?? null,
          },
          session: { id: result.data.session.id, token: result.data.session.token },
        });
      } else {
        setSessionData({ user: null, session: null });
      }
    } catch (error) {
      console.error("[StableAuthProvider] Failed to fetch session:", error);
      setSessionData({ user: null, session: null });
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const urlParams = new URLSearchParams(window.location.search);
    const ott = urlParams.get("ott");

    if (ott) {
      authClient.crossDomain.oneTimeToken
        .verify({ token: ott })
        .then(() => {
          analytics.signedIn();
          const url = new URL(window.location.href);
          url.searchParams.delete("ott");
          window.history.replaceState({}, "", url.toString());
        })
        .catch((err: unknown) => {
          console.error("Failed to verify one-time token:", err);
        })
        .finally(() => {
          fetchSession();
        });
    } else {
      fetchSession();
    }
  }, [fetchSession]);

  const value: AuthContextValue = {
    user: sessionData.user,
    session: sessionData.session,
    loading,
    isAuthenticated: !!sessionData.user,
    refetchSession: fetchSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access auth state from StableAuthProvider.
 * This is non-reactive and will NOT cause infinite loops.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    // Fallback for components outside provider (during SSR)
    return {
      user: null,
      session: null,
      loading: true,
      isAuthenticated: false,
      refetchSession: async () => {},
    };
  }
  return context;
}

/**
 * Legacy hook for backward compatibility.
 * Uses our stable, non-reactive session management.
 */
/**
 * Sign in with GitHub OAuth
 */
export async function signInWithGitHub(callbackURL = "/") {
  return authClient.signIn.social({
    provider: "github",
    callbackURL,
  });
}

/**
 * Sign in with Vercel OAuth
 */
export async function signInWithVercel(callbackURL = "/") {
  return authClient.signIn.social({
    provider: "vercel",
    callbackURL,
  });
}

/**
 * Sign out
 */
export async function signOut() {
  return authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        window.location.href = "/auth/sign-in";
      },
    },
  });
}
