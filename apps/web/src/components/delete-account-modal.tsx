import { useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import type { Id } from "@server/convex/_generated/dataModel";
import { signOut } from "@/lib/auth-client";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DeleteAccountModalProps {
	userId: Id<"users">;
	externalId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function DeleteAccountModal({
	userId,
	externalId,
	open,
	onOpenChange,
}: DeleteAccountModalProps) {
	const [confirmText, setConfirmText] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isConfirmValid = confirmText === "DELETE";

	const handleDelete = async () => {
		if (!isConfirmValid) return;

		setIsDeleting(true);
		setError(null);

		try {
			const response = await fetch("/api/workflow/delete-account", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					userId,
					externalId,
				}),
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => ({}))) as { error?: string };
				throw new Error(payload.error || "Failed to delete account");
			}

			// Account deleted successfully - sign out and redirect
			// Even if signOut fails, redirect to sign-in since the account is gone
			try {
				await signOut();
			} catch {
				// signOut failed but account is deleted, force redirect
				window.location.href = "/auth/sign-in";
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to delete account");
			setIsDeleting(false);
		}
	};

	const handleOpenChange = (newOpen: boolean) => {
		if (!isDeleting) {
			onOpenChange(newOpen);
			if (!newOpen) {
				setConfirmText("");
				setError(null);
			}
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogMedia className="bg-destructive/10">
						<AlertTriangleIcon className="size-8 text-destructive" />
					</AlertDialogMedia>
					<AlertDialogTitle>Delete your account?</AlertDialogTitle>
					<AlertDialogDescription>
						This action is <strong>permanent and cannot be undone</strong>. All your data will
						be immediately deleted, including:
					</AlertDialogDescription>
				</AlertDialogHeader>

				<ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
					<li>All chat conversations and messages</li>
					<li>Uploaded files and attachments</li>
					<li>Custom prompt templates</li>
					<li>Your profile and settings</li>
					<li>Connected OpenRouter API key</li>
				</ul>

				<div className="space-y-2">
					<p className="text-sm font-medium">
						Type <code className="rounded bg-muted px-1">DELETE</code> to confirm:
					</p>
					<Input
						value={confirmText}
						onChange={(e) => setConfirmText(e.target.value)}
						placeholder="Type DELETE to confirm"
						disabled={isDeleting}
					/>
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
					<Button
						variant="destructive"
						onClick={handleDelete}
						disabled={!isConfirmValid || isDeleting}
					>
						{isDeleting ? "Deleting..." : "Delete Account"}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
