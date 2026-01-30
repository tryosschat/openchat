/**
 * Server-side Convex HTTP Client
 * Use this for API routes, server functions, and SSR contexts
 * where the browser-based ConvexReactClient is not available.
 */

import { ConvexHttpClient } from "convex/browser";

const CONVEX_URL = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;

function createServerClient() {
	if (!CONVEX_URL) {
		console.warn("[Convex Server] No CONVEX_URL configured");
		return null;
	}
	console.log("[Convex Server] Initializing client with:", CONVEX_URL);
	return new ConvexHttpClient(CONVEX_URL);
}

export const convexServerClient = createServerClient();

export function getConvexServerClient() {
	if (!convexServerClient) {
		throw new Error("VITE_CONVEX_URL is not configured");
	}
	return convexServerClient;
}

export function createConvexServerClient(authToken?: string) {
	if (!CONVEX_URL) {
		throw new Error("VITE_CONVEX_URL is not configured");
	}
	const client = new ConvexHttpClient(CONVEX_URL);
	if (authToken) {
		client.setAuth(authToken);
	}
	return client;
}
