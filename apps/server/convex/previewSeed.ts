import { internalAction } from "./_generated/server";

/**
 * Preview deployment seed function
 *
 * This function is automatically run on preview deployments via the --preview-run flag.
 *
 * Usage in package.json build command:
 * convex deploy --cmd 'bun run build' --preview-run previewSeed --preview-create DEPLOYMENT=preview
 *
 * Note: With Better Auth, users are managed via GitHub OAuth. This seed function
 * can be used to initialize any preview-specific data if needed.
 */
export default internalAction(async (_ctx) => {
	const deployment = process.env.DEPLOYMENT;
	const nodeEnv = process.env.NODE_ENV;
	const appUrl = process.env.APP_URL || "http://localhost:3000";

	console.log(`[Preview Seed] Running in deployment: ${deployment}, NODE_ENV: ${nodeEnv}`);
	console.log(`[Preview Seed] App URL: ${appUrl}`);

	// Only seed in preview deployments
	if (deployment !== "preview") {
		console.log("[Preview Seed] Skipping - not a preview deployment");
		return { success: false, message: "Not a preview deployment" };
	}

	// With Better Auth, user authentication is handled via GitHub OAuth.
	console.log("[Preview Seed] Preview deployment ready");
	console.log("[Preview Seed] Sign in using GitHub OAuth");

	return {
		success: true,
		message: "Preview deployment initialized",
		note: "Sign in using GitHub OAuth",
	};
});
