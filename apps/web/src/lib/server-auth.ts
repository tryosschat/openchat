import { api } from "@server/convex/_generated/api";
import type { Id } from "@server/convex/_generated/dataModel";
import { createConvexServerClient } from "@/lib/convex-server";

export type AuthSessionUser = {
	id: string;
	email?: string | null;
	name?: string | null;
	image?: string | null;
};

type AuthSessionResponse = {
	user?: AuthSessionUser | null;
	session?: { id: string; token: string } | null;
};

const CONVEX_SITE_URL =
	process.env.VITE_CONVEX_SITE_URL || process.env.CONVEX_SITE_URL;

export async function getConvexAuthToken(request: Request): Promise<string | null> {
	if (!CONVEX_SITE_URL) return null;
	const cookie = request.headers.get("cookie");
	if (!cookie) return null;

	const response = await fetch(`${CONVEX_SITE_URL}/api/auth/convex/token`, {
		headers: { cookie },
	});
	if (!response.ok) return null;
	const data = (await response.json()) as { token?: string } | null;
	return data?.token ?? null;
}

/**
 * Validates that the request origin matches the server origin for CSRF protection.
 *
 * For state-changing methods (POST, PUT, DELETE, PATCH), we require a valid Origin
 * header that matches the server's origin. Missing or "null" origins are rejected
 * to prevent CSRF attacks from sandboxed iframes or file:// contexts.
 *
 * For safe methods (GET, HEAD, OPTIONS), we allow missing Origin headers since
 * these requests should be read-only and browsers don't always send Origin for
 * same-origin navigational requests.
 */
export function isSameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin");
	const method = request.method.toUpperCase();
	const stateChangingMethods = ["POST", "PUT", "DELETE", "PATCH"];

	// Reject "null" origin (from sandboxed iframes, file:// contexts, etc.)
	if (origin === "null") {
		return false;
	}

	// For state-changing methods, require a valid Origin header
	if (stateChangingMethods.includes(method)) {
		if (!origin) {
			return false;
		}
		return origin === new URL(request.url).origin;
	}

	// For safe methods (GET, HEAD, OPTIONS), allow missing Origin
	// but still validate if present
	if (!origin) {
		return true;
	}

	return origin === new URL(request.url).origin;
}

export async function getAuthUser(
	request: Request,
): Promise<AuthSessionUser | null> {
	if (!CONVEX_SITE_URL) return null;
	const cookie = request.headers.get("cookie");
	if (!cookie) return null;

	const response = await fetch(`${CONVEX_SITE_URL}/api/auth/session`, {
		headers: { cookie },
	});
	if (!response.ok) return null;

	const data = (await response.json()) as AuthSessionResponse | null;
	return data?.user ?? null;
}

export async function getConvexUserId(
	authUser: AuthSessionUser,
	request: Request,
): Promise<Id<"users"> | null> {
	const authToken = await getConvexAuthToken(request);
	if (!authToken) return null;
	const convexClient = createConvexServerClient(authToken);
	const existing = await convexClient.query(api.users.getByExternalId, {
		externalId: authUser.id,
	});
	if (existing?._id) return existing._id;

	const created = await convexClient.mutation(api.users.ensure, {
		externalId: authUser.id,
		email: authUser.email ?? undefined,
		name: authUser.name ?? undefined,
		avatarUrl: authUser.image ?? undefined,
	});
	return created.userId;
}

/**
 * Read-only variant of getConvexUserId that only queries for an existing user.
 * Use this in GET handlers to avoid side-effects (user creation).
 * Accepts an existing ConvexHttpClient to avoid redundant auth token fetches.
 */
export async function getConvexUserIdReadOnly(
	authUser: AuthSessionUser,
	convexClient: ReturnType<typeof createConvexServerClient>,
): Promise<Id<"users"> | null> {
	const existing = await convexClient.query(api.users.getByExternalId, {
		externalId: authUser.id,
	});
	return existing?._id ?? null;
}

export async function getConvexClientForRequest(request: Request) {
	const authToken = await getConvexAuthToken(request);
	if (!authToken) return null;
	return createConvexServerClient(authToken);
}
