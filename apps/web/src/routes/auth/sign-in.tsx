/**
 * Sign In Page - GitHub OAuth authentication
 */

import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  signInWithEmail,
  signInWithGitHub,
  signInWithVercel,
  signUpWithEmail,
  useAuth,
} from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";
import { analytics } from "@/lib/analytics";

// Stats type from our backend
type PublicStats = {
  messages: number;
  users: number;
  chats: number;
  stars: number;
  models: number;
};

export const Route = createFileRoute("/auth/sign-in")({
  head: () => ({
    meta: [
      { title: "Sign in to osschat - Free AI Chat with 350+ Models" },
      { name: "description", content: "Sign in to osschat to access GPT-4, Claude, Gemini and 350+ AI models. Free tier available with no API key required." },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "Sign in to osschat" },
      { property: "og:description", content: "Sign in to access 350+ AI models including GPT-4, Claude, and Gemini. Free tier available." },
      { property: "og:url", content: "https://osschat.dev/auth/sign-in" },
    ],
    links: [
      { rel: "canonical", href: "https://osschat.dev/auth/sign-in" },
    ],
  }),
  component: SignInPage,
});

// Icons
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function VercelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M24 22.525H0l12-21.05 12 21.05z" />
    </svg>
  );
}

function MessageSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
      />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// Logo component
function Logo({
  className,
  size = "default",
}: {
  className?: string;
  size?: "small" | "default" | "large";
}) {
  const sizeClasses = {
    small: { container: "gap-1.5", logo: "size-5", text: "text-base" },
    default: { container: "gap-2", logo: "size-6", text: "text-lg" },
    large: { container: "gap-3", logo: "size-8", text: "text-2xl" },
  };
  const sizes = sizeClasses[size];

  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold tracking-tight",
        sizes.container,
        className,
      )}
    >
      <img src="/logo.png" alt="osschat" className={sizes.logo} />
      <span className={cn("font-sans font-bold", sizes.text)}>
        <span className="text-foreground">oss</span>
        <span className="text-primary">chat</span>
      </span>
    </span>
  );
}

// Format large numbers nicely
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

// Cache stats in memory to avoid repeated fetches
let cachedStats: PublicStats | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function SignInPage() {
  const navigate = useNavigate();
  const { isAuthenticated, loading, refetchSession } = useAuth();
  const [isGitHubLoading, setIsGitHubLoading] = useState(false);
  const [isVercelLoading, setIsVercelLoading] = useState(false);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [stats, setStats] = useState<PublicStats | null>(cachedStats);

  // Redirect if already authenticated
  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate({ to: "/" });
    }
  }, [loading, isAuthenticated, navigate]);

  // Fetch real stats from backend (cached)
  useEffect(() => {
    // Use cache if fresh
    if (cachedStats && Date.now() - cacheTimestamp < CACHE_TTL) {
      setStats(cachedStats);
      return;
    }

    const siteUrl = env.CONVEX_SITE_URL;
    if (!siteUrl) return;

    fetch(`${siteUrl}/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          cachedStats = data;
          cacheTimestamp = Date.now();
          setStats(data);
        }
      })
      .catch(() => null);
  }, []);

  // Fallback stats while loading
  const displayStats = stats || {
    messages: 0,
    users: 0,
    models: 200,
    stars: 0,
  };

  const handleGitHubSignIn = async () => {
    setIsGitHubLoading(true);
    try {
      await signInWithGitHub("/");
    } catch (error) {
      console.error("Sign in failed:", error);
      setIsGitHubLoading(false);
    }
  };

  const handleVercelSignIn = async () => {
    setIsVercelLoading(true);
    try {
      await signInWithVercel("/");
    } catch (error) {
      console.error("Sign in failed:", error);
      setIsVercelLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setIsEmailLoading(true);

    try {
      if (isSignUp) {
        const { error } = await signUpWithEmail(email, password, name || email.split("@")[0] || "User");
        if (error) {
          setEmailError("Could not create account. The email may already be in use.");
          return;
        }
      } else {
        const { error } = await signInWithEmail(email, password);
        if (error) {
          setEmailError("Invalid email or password.");
          return;
        }
      }
      const success = await refetchSession();
      if (success) {
        analytics.signedIn();
        navigate({ to: "/" });
      } else {
        setEmailError("Signed in but failed to load session. Please refresh the page.");
      }
    } catch (err) {
      console.error("Email auth failed:", err);
      setEmailError(isSignUp ? "Sign up failed. Please try again." : "Sign in failed. Please try again.");
    } finally {
      setIsEmailLoading(false);
    }
  };

  const anyLoading = isGitHubLoading || isVercelLoading || isEmailLoading;

  return (
    <div className="grid min-h-svh lg:grid-cols-2 overflow-hidden">
      {/* Left Column - Sign In Form */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link
            to="/"
            className="flex items-center gap-2 font-medium transition-opacity hover:opacity-80"
          >
            <Logo size="small" />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs space-y-6">
            <div className="space-y-1 text-center">
              <h1 className="text-xl font-semibold tracking-tight">Welcome to osschat</h1>
              <p className="text-muted-foreground text-sm">Sign in to access your workspace</p>
            </div>

            <form onSubmit={handleEmailSubmit} className="space-y-3">
              {isSignUp && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={anyLoading}
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={anyLoading}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={anyLoading}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                />
              </div>

              {emailError && (
                <p className="text-sm text-destructive">{emailError}</p>
              )}

              <Button
                type="submit"
                disabled={anyLoading}
                className="w-full"
              >
                {isEmailLoading
                  ? (isSignUp ? "Creating account..." : "Signing in...")
                  : (isSignUp ? "Create account" : "Sign in")}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setEmailError(null); }}
              className="text-sm text-muted-foreground hover:text-foreground text-center w-full transition-colors"
            >
              {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleGitHubSignIn}
                disabled={anyLoading}
                variant="outline"
                className="w-full gap-2"
              >
                <GithubIcon className="size-5" />
                {isGitHubLoading ? "Signing in..." : "Continue with GitHub"}
              </Button>
              <Button
                onClick={handleVercelSignIn}
                disabled={anyLoading}
                variant="outline"
                className="w-full gap-2"
              >
                <VercelIcon className="size-4" />
                {isVercelLoading ? "Signing in..." : "Continue with Vercel"}
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      </div>

      {/* Right Column - Gradient Background with Stats */}
      <div className="relative hidden lg:block overflow-hidden">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/5 to-background" />

        {/* Decorative Elements */}
        <div className="absolute inset-0">
          {/* Large Gradient Orbs */}
          <div className="absolute -right-1/4 -top-1/4 size-[600px] rounded-full bg-gradient-to-br from-primary/30 to-transparent blur-3xl" />
          <div className="absolute -bottom-1/4 -left-1/4 size-[500px] rounded-full bg-gradient-to-tr from-primary/20 to-transparent blur-3xl" />

          {/* Grid Pattern Overlay */}
          <div
            className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        {/* Content Overlay */}
        <div className="relative flex h-full flex-col items-center justify-center p-12">
          <div className="max-w-md text-center space-y-10">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
              {/* Messages Stat */}
              <div className="rounded-2xl bg-primary/5 backdrop-blur-sm p-6 space-y-1">
                <div className="flex items-center justify-center gap-2 text-primary">
                  <MessageSquareIcon className="size-5" />
                </div>
                <div className="text-3xl font-bold tabular-nums">
                  {displayStats.messages ? formatNumber(displayStats.messages) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">messages sent</div>
              </div>

              {/* Models Stat */}
              <div className="rounded-2xl bg-primary/5 backdrop-blur-sm p-6 space-y-1">
                <div className="flex items-center justify-center gap-2 text-primary">
                  <SparklesIcon className="size-5" />
                </div>
                <div className="text-3xl font-bold tabular-nums">{displayStats.models}+</div>
                <div className="text-xs text-muted-foreground">AI models</div>
              </div>

              {/* Users Stat */}
              <div className="rounded-2xl bg-primary/5 backdrop-blur-sm p-6 space-y-1">
                <div className="flex items-center justify-center gap-2 text-primary">
                  <UsersIcon className="size-5" />
                </div>
                <div className="text-3xl font-bold tabular-nums">
                  {displayStats.users ? formatNumber(displayStats.users) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">users</div>
              </div>

              {/* GitHub Stars */}
              <div className="rounded-2xl bg-primary/5 backdrop-blur-sm p-6 space-y-1">
                <div className="flex items-center justify-center gap-2 text-primary">
                  <StarIcon className="size-5" />
                </div>
                <div className="text-3xl font-bold tabular-nums">
                  {displayStats.stars ? formatNumber(displayStats.stars) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">GitHub stars</div>
              </div>
            </div>

            {/* Tagline */}
            <div className="space-y-3">
              <p className="text-lg font-medium">One interface. Every AI model.</p>
              <p className="text-sm text-muted-foreground">
                GPT-4, Claude, Gemini, and 200+ more. Your keys, your privacy.
              </p>
            </div>

            {/* Provider Logos */}
            <div className="flex items-center justify-center gap-5 opacity-50">
              <img
                src="https://models.dev/logos/openai.svg"
                alt="OpenAI"
                className="h-4 dark:invert"
              />
              <img
                src="https://models.dev/logos/anthropic.svg"
                alt="Anthropic"
                className="h-4 dark:invert"
              />
              <img
                src="https://models.dev/logos/google.svg"
                alt="Google"
                className="h-4 dark:invert"
              />
              <img src="https://models.dev/logos/xai.svg" alt="xAI" className="h-4 dark:invert" />
              <img
                src="https://models.dev/logos/deepseek.svg"
                alt="DeepSeek"
                className="h-4 dark:invert"
              />
            </div>

            {/* Open Source Badge */}
            <a
              href="https://github.com/opentech1/openchat"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary backdrop-blur-sm transition-colors hover:bg-primary/20"
            >
              <GithubIcon className="size-4" />
              <span>100% Open Source</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
