/**
 * OpenRouter Connection Modal
 *
 * A modal/dialog for connecting Personal OpenRouter account.
 * Used from Settings page when user wants to connect their own API key.
 */

import { useEffect, useState } from "react";
import { CheckIcon, ExternalLinkIcon, KeyIcon, XIcon } from "lucide-react";
import { Button } from "./ui/button";
import { useOpenRouterKey } from "@/stores/openrouter";
import { cn } from "@/lib/utils";

interface OpenRouterConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpenRouterConnectModal({ open, onOpenChange }: OpenRouterConnectModalProps) {
  const { hasApiKey, initiateLogin, isLoading } = useOpenRouterKey();
  const [isClosing, setIsClosing] = useState(false);

  // Close modal when API key is set (successful connection)
  useEffect(() => {
    if (hasApiKey && open) {
      // Small delay to show success state
      const timer = setTimeout(() => {
        onOpenChange(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [hasApiKey, open, onOpenChange]);

  const handleConnect = () => {
    const callbackUrl = `${window.location.origin}/openrouter/callback`;
    initiateLogin(callbackUrl);
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onOpenChange(false);
      setIsClosing(false);
    }, 150);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
          "transition-opacity duration-150",
          isClosing ? "opacity-0" : "opacity-100",
        )}
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-full max-w-md",
          "transition-all duration-150",
          isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100",
        )}
      >
        <div className="rounded-2xl border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
                <img
                  src="https://models.dev/logos/openrouter.svg"
                  alt="OpenRouter"
                  className="size-5 invert"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
              <div>
                <h2 className="font-semibold">Connect OpenRouter</h2>
                <p className="text-xs text-muted-foreground">
                  Personal account for unlimited access
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {hasApiKey ? (
              // Success state
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex size-16 items-center justify-center rounded-full bg-success/10">
                  <CheckIcon className="size-8 text-success" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-success">Successfully connected!</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your OpenRouter account is now linked.
                  </p>
                </div>
              </div>
            ) : (
              // Connect state
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Connect your OpenRouter account to unlock:
                  </p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckIcon className="size-4 text-success" />
                      <span>Unlimited access to 350+ AI models</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckIcon className="size-4 text-success" />
                      <span>No daily usage limits</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckIcon className="size-4 text-success" />
                      <span>Pay only for what you use</span>
                    </li>
                  </ul>
                </div>

                <Button
                  onClick={handleConnect}
                  disabled={isLoading}
                  className="w-full gap-2"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <KeyIcon className="size-4" />
                      Connect with OpenRouter
                    </>
                  )}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  Don't have an account?{" "}
                  <a
                    href="https://openrouter.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Sign up for free
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
