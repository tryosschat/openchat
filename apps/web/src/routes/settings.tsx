/**
 * Settings Page
 */

import {   useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@server/convex/_generated/api";
import { CheckCircleIcon, CheckIcon, DatabaseIcon, Loader2Icon, PencilIcon, RefreshCwIcon, XIcon, ZapIcon } from "lucide-react";
import type {KeyboardEvent, MouseEvent} from "react";
import type {ChatTitleLength} from "@/stores/chat-title";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { authClient, signOut, useAuth } from "@/lib/auth-client";
import { useOpenRouterKey } from "@/stores/openrouter";
import { DAILY_LIMIT_CENTS, useProviderStore } from "@/stores/provider";
import { getCacheStatus, useModels } from "@/stores/model";
import { useChatTitleStore } from "@/stores/chat-title";
import { useUIStore } from "@/stores/ui";
import { OpenRouterConnectModal } from "@/components/openrouter-connect-modal";
import { DeleteAccountModal } from "@/components/delete-account-modal";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings - osschat" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SettingsPage,
});

type Section = "account" | "providers" | "chat" | "models";

const sections: Array<{ id: Section; label: string }> = [
  { id: "account", label: "Account" },
  { id: "providers", label: "Providers" },
  { id: "chat", label: "Chat" },
  { id: "models", label: "Models" },
];

function SettingsPage() {
  const { user, isAuthenticated, loading, refetchSession } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>("account");

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Please sign in to access settings.</p>
        <Link to="/auth/sign-in">
          <Button>Sign In</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-none border-b bg-background pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-3xl px-6">
          {/* Top row */}
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to="/"
                className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                Back
              </Link>
              <Separator orientation="vertical" className="h-5" />
              <div className="flex items-center gap-2">
                <Avatar className="size-6">
                  <AvatarImage src={user.image || undefined} alt={user.name || "User"} />
                  <AvatarFallback className="text-xs">
                    {(user.name || user.email || "U")[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{user.name || "User"}</span>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>

          {/* Navigation tabs */}
          <nav className="-mb-px flex gap-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "relative px-4 py-3 text-sm font-medium transition-colors",
                  activeSection === section.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {section.label}
                {activeSection === section.id && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          {activeSection === "account" && <AccountSection user={user} refetchSession={refetchSession} />}
          {activeSection === "providers" && <ProvidersSection />}
          {activeSection === "chat" && <ChatSection />}
          {activeSection === "models" && <ModelsSection />}
        </div>
      </main>
    </div>
  );
}

function AccountSection({
	user,
	refetchSession,
}: { user: { id: string; name?: string | null; email?: string | null }; refetchSession: () => Promise<void> }) {
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
	const [isEditingName, setIsEditingName] = useState(false);
	const [nameValue, setNameValue] = useState(user.name || "");
	const [isSaving, setIsSaving] = useState(false);

	// Get Convex user ID from external ID (Better Auth ID)
	const convexUser = useQuery(api.users.getByExternalId, { externalId: user.id });
	const updateName = useMutation(api.users.updateName);

	const handleSaveName = async () => {
		if (!convexUser || !nameValue.trim()) return;
		setIsSaving(true);
		try {
			// Update name in Better Auth (primary auth source)
			await authClient.updateUser({ name: nameValue.trim() });
			// Also update in Convex for consistency
			await updateName({ userId: convexUser._id, name: nameValue.trim() });
			// Refresh the session to get the updated user data
			await refetchSession();
			setIsEditingName(false);
		} catch (error) {
			console.error("Failed to update name:", error);
		} finally {
			setIsSaving(false);
		}
	};

	const handleCancelEdit = () => {
		setNameValue(convexUser?.name || user.name || "");
		setIsEditingName(false);
	};

	// Use Convex user name (real-time) if available, fall back to auth user name
	const displayName = convexUser?.name || user.name || "Not set";

	return (
		<div className="space-y-8">
			{/* Profile */}
			<section className="space-y-4">
				<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
					Profile
				</h2>
				<div className="rounded-xl border bg-card">
					<div className="flex items-center justify-between p-4">
						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
								<svg
									className="size-5 text-muted-foreground"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={1.5}
										d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
									/>
								</svg>
							</div>
							{isEditingName ? (
								<div className="flex items-center gap-2">
									<Input
										value={nameValue}
										onChange={(e) => setNameValue(e.target.value)}
										placeholder="Enter your name"
										className="h-8 w-48"
										autoFocus
										onKeyDown={(e) => {
											if (e.key === "Enter") handleSaveName();
											if (e.key === "Escape") handleCancelEdit();
										}}
									/>
									<Button
										variant="ghost"
										size="icon"
										className="size-8"
										onClick={handleSaveName}
										disabled={isSaving || !nameValue.trim()}
									>
										{isSaving ? (
											<Loader2Icon className="size-4 animate-spin" />
										) : (
											<CheckIcon className="size-4 text-success" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="size-8"
										onClick={handleCancelEdit}
										disabled={isSaving}
									>
										<XIcon className="size-4 text-muted-foreground" />
									</Button>
								</div>
							) : (
								<div>
									<p className="text-sm font-medium">Name</p>
									<p className="text-sm text-muted-foreground">{displayName}</p>
								</div>
							)}
						</div>
						{!isEditingName && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setNameValue(convexUser?.name || user.name || "");
									setIsEditingName(true);
								}}
								disabled={!convexUser}
							>
								<PencilIcon className="mr-1.5 size-3.5" />
								Edit
							</Button>
						)}
					</div>
					<Separator />
					<div className="flex items-center justify-between p-4">
						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
								<svg
									className="size-5 text-muted-foreground"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={1.5}
										d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
									/>
								</svg>
							</div>
							<div>
								<p className="text-sm font-medium">Email</p>
								<p className="text-sm text-muted-foreground">{user.email || "Not set"}</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Authentication */}
			<section className="space-y-4">
				<h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
					Authentication
				</h2>
				<div className="rounded-xl border bg-card">
					<div className="flex items-center justify-between p-4">
						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
								<svg
									className="size-5 text-muted-foreground"
									fill="currentColor"
									viewBox="0 0 24 24"
								>
									<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
								</svg>
							</div>
							<div>
								<p className="text-sm font-medium">GitHub</p>
								<p className="text-sm text-muted-foreground">Connected via OAuth</p>
							</div>
						</div>
						<span className="flex items-center gap-1.5 text-xs font-medium text-primary">
							<svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M5 13l4 4L19 7"
								/>
							</svg>
							Connected
						</span>
					</div>
				</div>
			</section>

			{/* Danger Zone */}
			<section className="space-y-4">
				<h2 className="text-sm font-medium text-destructive uppercase tracking-wide">
					Danger Zone
				</h2>
				<div className="rounded-xl border border-destructive/20 bg-destructive/5">
					<div className="flex items-center justify-between p-4">
						<div>
							<p className="text-sm font-medium">Delete Account</p>
							<p className="text-sm text-muted-foreground">
								Permanently delete your account and all data
							</p>
						</div>
						<Button
							variant="destructive"
							size="sm"
							onClick={() => setDeleteModalOpen(true)}
							disabled={!convexUser}
						>
							Delete
						</Button>
					</div>
				</div>
			</section>

			{/* Delete Account Modal */}
			{convexUser && (
				<DeleteAccountModal
					userId={convexUser._id}
					externalId={user.id}
					open={deleteModalOpen}
					onOpenChange={setDeleteModalOpen}
				/>
			)}
		</div>
	);
}

function ProvidersSection() {
  const { apiKey, clearApiKey } = useOpenRouterKey();
  const activeProvider = useProviderStore((s) => s.activeProvider);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const dailyUsageCents = useProviderStore((s) => s.dailyUsageCents);
  const remainingBudget = useProviderStore((s) => s.remainingBudgetCents());
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const handleDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearApiKey();
    // Switch back to OSSChat if disconnecting while on OpenRouter
    if (activeProvider === "openrouter") {
      setActiveProvider("osschat");
    }
  };

  return (
    <div className="space-y-8">
      {/* Provider Selection */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          AI Provider
        </h2>
        <div className="grid gap-3">
          {/* OSSChat Cloud - Free Tier */}
          <button
            onClick={() => setActiveProvider("osschat")}
            className={cn(
              "flex items-start gap-4 rounded-xl border p-4 text-left transition-all",
              activeProvider === "osschat"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:border-primary/50",
            )}
          >
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-cyan-500">
              <img
                src="https://models.dev/logos/openrouter.svg"
                alt="OpenRouter"
                className="size-6 invert"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">OSSChat Cloud</p>
                <span className="rounded-full bg-success/10 px-2 py-0.5 text-caption font-medium text-success">
                  FREE
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                350+ AI models with {DAILY_LIMIT_CENTS}¢ daily limit
              </p>
              {activeProvider === "osschat" && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Daily Usage</span>
                    <span className="font-medium">
                      {dailyUsageCents.toFixed(2)}¢ / {DAILY_LIMIT_CENTS}¢
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        remainingBudget <= 0
                          ? "bg-destructive"
                          : remainingBudget < DAILY_LIMIT_CENTS * 0.3
                            ? "bg-warning"
                            : "bg-success",
                      )}
                      style={{
                        width: `${Math.min(100, (dailyUsageCents / DAILY_LIMIT_CENTS) * 100)}%`,
                      }}
                    />
                  </div>
                  {remainingBudget <= 0 && (
                    <p className="text-xs text-destructive">
                      Daily limit reached. Connect your own OpenRouter account for unlimited usage.
                    </p>
                  )}
                </div>
              )}
            </div>
            {activeProvider === "osschat" && (
              <svg
                className="size-5 shrink-0 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </button>

          {/* Personal OpenRouter - BYOK */}
          <div
            className={cn(
              "rounded-xl border p-4 transition-all",
              activeProvider === "openrouter"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : apiKey
                  ? "border-border bg-card"
                  : "border-dashed border-border bg-card",
            )}
          >
            <button
              onClick={() => apiKey && setActiveProvider("openrouter")}
              disabled={!apiKey}
              className={cn("flex w-full items-start gap-4 text-left", !apiKey && "cursor-default")}
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 to-purple-600">
                <img
                  src="https://models.dev/logos/openrouter.svg"
                  alt="OpenRouter"
                  className="size-6 invert"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">Personal OpenRouter</p>
                  {apiKey && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary">
                      CONNECTED
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {apiKey
                    ? "Unlimited access with your own API key"
                    : "Use your own OpenRouter account for unlimited access"}
                </p>
                {apiKey && activeProvider === "openrouter" && (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {apiKey.slice(0, 8)}...{apiKey.slice(-4)}
                  </p>
                )}
              </div>
              {activeProvider === "openrouter" && (
                <svg
                  className="size-5 shrink-0 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </button>

            {/* Connect/Disconnect button integrated into card */}
            <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
              {apiKey ? (
                <>
                  <a
                    href="https://openrouter.ai/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Manage keys
                    <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDisconnect}
                    className="h-7 text-xs"
                  >
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button onClick={() => setConnectModalOpen(true)} size="sm" className="w-full h-8">
                  Connect OpenRouter Account
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* OpenRouter Connect Modal */}
      <OpenRouterConnectModal open={connectModalOpen} onOpenChange={setConnectModalOpen} />
    </div>
  );
}

const TITLE_LENGTH_OPTIONS: Array<ChatTitleLength> = ["short", "standard", "long"];
const TITLE_LENGTH_LABELS: Record<ChatTitleLength, string> = {
  short: "Concise (2-4 words)",
  standard: "Standard (4-6 words)",
  long: "Descriptive (7-10 words)",
};

function ChatSection() {
  const length = useChatTitleStore((s) => s.length);
  const setLength = useChatTitleStore((s) => s.setLength);
  const confirmDelete = useChatTitleStore((s) => s.confirmDelete);
  const setConfirmDelete = useChatTitleStore((s) => s.setConfirmDelete);
  const currentIndex = TITLE_LENGTH_OPTIONS.indexOf(length);
  const percentage = (currentIndex / (TITLE_LENGTH_OPTIONS.length - 1)) * 100;

  const handleClick = (index: number) => {
    setLength(TITLE_LENGTH_OPTIONS[index]);
  };

  const handleTrackClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = x / rect.width;
    const index = Math.round(position * (TITLE_LENGTH_OPTIONS.length - 1));
    handleClick(Math.max(0, Math.min(index, TITLE_LENGTH_OPTIONS.length - 1)));
  };

  const handleTrackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const lastIndex = TITLE_LENGTH_OPTIONS.length - 1;
    let nextIndex = currentIndex;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIndex = Math.min(lastIndex, currentIndex + 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    } else {
      return;
    }

    event.preventDefault();
    handleClick(nextIndex);
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Chat Titles
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto title length</p>
              <p className="text-sm text-muted-foreground">
                Controls how short or descriptive the AI chat names are.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {TITLE_LENGTH_LABELS[length]}
            </span>
          </div>

          <div className="space-y-2">
            <div
              className="relative h-2 cursor-pointer"
              onClick={handleTrackClick}
              onKeyDown={handleTrackKeyDown}
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={TITLE_LENGTH_OPTIONS.length - 1}
              aria-valuenow={currentIndex}
              aria-valuetext={TITLE_LENGTH_LABELS[length]}
            >
              <div className="absolute inset-0 bg-muted rounded-full" />
              <div
                className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-150"
                style={{ width: `${percentage}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full shadow-md border-2 border-background transition-all duration-150"
                style={{ left: `calc(${percentage}% - 8px)` }}
              />
              <div className="absolute inset-0 flex justify-between">
                {TITLE_LENGTH_OPTIONS.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    className="w-4 h-full z-10"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClick(index);
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-between text-xs text-muted-foreground">
              {TITLE_LENGTH_OPTIONS.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleClick(index)}
                  className={cn(
                    "transition-colors hover:text-foreground",
                    length === option && "text-foreground font-medium",
                  )}
                >
                  {TITLE_LENGTH_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Deletion
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Delete confirmation</p>
              <p className="text-sm text-muted-foreground">
                Require confirmation before deleting a chat.
              </p>
            </div>
            <Switch
              id="confirm-delete"
              checked={confirmDelete}
              onCheckedChange={setConfirmDelete}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function ModelsSection() {
  const { models, isLoading, reload, totalCount, error } = useModels();
  const cacheStatus = getCacheStatus();
  const [isReloading, setIsReloading] = useState(false);
  const filterStyle = useUIStore((s) => s.filterStyle);
  const setFilterStyle = useUIStore((s) => s.setFilterStyle);

  const handleReload = async () => {
    setIsReloading(true);
    try {
      await reload();
    } finally {
      setIsReloading(false);
    }
  };

  // Format age for display
  const formatAge = (ms: number | null) => {
    if (!ms) return "Never";
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="space-y-8">
      {/* Filter Display */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Filter Display
        </h2>
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Provider filters</p>
              <p className="text-sm text-muted-foreground">
                Show provider names or icons in the model selector filters.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              <button
                onClick={() => setFilterStyle("names")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  filterStyle === "names"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Names
              </button>
              <button
                onClick={() => setFilterStyle("icons")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  filterStyle === "icons"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Icons
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Model Source Info */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Model Source
        </h2>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 to-purple-600">
              <ZapIcon className="size-6 text-white" />
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">OpenRouter</p>
                <span className="rounded-full px-2 py-0.5 text-caption font-medium bg-info/10 text-info">
                  FULL CATALOG
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Full access to 350+ models via OpenRouter API
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Model Statistics */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Model Cache
        </h2>
        <div className="rounded-xl border bg-card">
          {/* Stats row */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <DatabaseIcon className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Models Loaded</p>
                <p className="text-sm text-muted-foreground">
                  {isLoading ? "Loading..." : `${totalCount} models available`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {cacheStatus.hasData && !cacheStatus.isStale && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircleIcon className="size-3.5" />
                  Fresh
                </span>
              )}
              {cacheStatus.isStale && <span className="text-xs text-warning">Stale</span>}
            </div>
          </div>

          <Separator />

          {/* Cache info */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <RefreshCwIcon className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Last Updated</p>
                <p className="text-sm text-muted-foreground">{formatAge(cacheStatus.age)}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReload}
              disabled={isReloading || isLoading}
              className="gap-2"
            >
              <RefreshCwIcon
                className={cn("size-4", (isReloading || isLoading) && "animate-spin")}
              />
              {isReloading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {error && (
            <>
              <Separator />
              <div className="p-4">
                <p className="text-sm text-destructive">Error loading models: {error.message}</p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Model Preview (show first few models) */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Available Models
        </h2>
        <div className="rounded-xl border bg-card">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading models...</div>
          ) : (
            <div className="divide-y divide-border">
              {models.slice(0, 8).map((model) => (
                <div key={model.id} className="flex items-center gap-3 p-3">
                  <img
                    src={`https://models.dev/logos/${model.logoId}.svg`}
                    alt={model.provider}
                    className="size-5 dark:invert"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{model.name}</p>
                    <p className="text-xs text-muted-foreground">{model.provider}</p>
                  </div>
                  {model.isPopular && (
                    <span className="rounded-full bg-warning/10 px-2 py-0.5 text-caption font-medium text-warning">
                      POPULAR
                    </span>
                  )}
                  {model.isFree && (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-caption font-medium text-success">
                      FREE
                    </span>
                  )}
                </div>
              ))}
              {totalCount > 8 && (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  +{totalCount - 8} more models available
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}