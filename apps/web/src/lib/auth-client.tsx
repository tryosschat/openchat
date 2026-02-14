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
 * Better Auth client with Convex integration.
 */
export const authClient = createAuthClient({
  baseURL: env.CONVEX_SITE_URL,
  sessionOptions: {
    refetchOnWindowFocus: false,
    refetchInterval: 0,
    refetchWhenOffline: false,
  },
  plugins: [
    convexAuthPlugin(),
    crossDomainClient(),
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

export type InitialAuthUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
} | null;

interface SessionData {
  user: SessionUser | null;
  session: { id: string; token: string } | null;
}

interface AuthContextValue {
  user: SessionUser | null;
  session: { id: string; token: string } | null;
  loading: boolean;
  isAuthenticated: boolean;
  refetchSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Non-reactive auth provider that fetches session once and caches it.
 * This prevents the infinite loop caused by $sessionSignal notifications.
 */
export function StableAuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser?: InitialAuthUser;
}) {
  const [sessionData, setSessionData] = useState<SessionData>(() => {
    if (initialUser) {
      return { user: initialUser, session: null };
    }
    return { user: null, session: null };
  });
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);
  const fetchingRef = useRef(false);

  const fetchSession = useCallback(async (): Promise<boolean> => {
    // Prevent concurrent fetches
    if (fetchingRef.current) return false;
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
        return true;
      }
      setSessionData({ user: null, session: null });
      return false;
    } catch (error) {
      console.error("[StableAuthProvider] Failed to fetch session:", error);
      setSessionData({ user: null, session: null });
      return false;
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
      refetchSession: () => Promise.resolve(false),
    };
  }
  return context;
}

/**
 * Legacy hook for backward compatibility.
 * Uses our stable, non-reactive session management.
 */
export async function signInWithGitHub(callbackURL = "/") {
  return authClient.signIn.social({
    provider: "github",
    callbackURL,
  });
}

export async function signInWithVercel(callbackURL = "/") {
  return authClient.signIn.social({
    provider: "vercel",
    callbackURL,
  });
}

export async function signInWithEmail(email: string, password: string) {
  return authClient.signIn.email({
    email,
    password,
  });
}

export async function signUpWithEmail(
  email: string,
  password: string,
  name: string,
) {
  return authClient.signUp.email({
    email,
    password,
    name,
  });
}

/**
 * Sensitive sessionStorage keys that store chat content, drafts, and stream data.
 * These must be cleared on sign-out to prevent data leakage on shared devices.
 */
const SENSITIVE_SESSION_KEYS = [
  "openchat-chats-cache",
  "openchat-prompt-drafts",
  "openchat-stream",
];

export async function signOut() {
  return authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        // Clear sensitive chat/draft/stream data from sessionStorage
        for (const key of SENSITIVE_SESSION_KEYS) {
          try {
            sessionStorage.removeItem(key);
          } catch {
            // Ignore storage access errors
          }
        }
        window.location.href = "/auth/sign-in";
      },
    },
  });
}
