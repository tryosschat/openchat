import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadModule() {
	vi.resetModules();
	return import("@/lib/server-auth");
}

function requestWithCookie(cookie: string): Request {
	return {
		headers: {
			get: (name: string) => (name.toLowerCase() === "cookie" ? cookie : null),
		},
	} as unknown as Request;
}

function createJwt(expSecondsFromNow = 3600): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
	).toString("base64url");
	return `${header}.${payload}.signature`;
}

describe("server-auth.getConvexAuthToken", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.stubEnv("ALLOW_AUTH_COOKIE_FALLBACK", "true");
		vi.stubEnv("VERCEL", "");
		vi.stubEnv("CONVEX_CLOUD_URL", "");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("uses better-auth.convex_jwt cookie fallback when Convex token endpoint is unavailable", async () => {
		vi.stubEnv("VITE_CONVEX_SITE_URL", "");
		vi.stubEnv("CONVEX_SITE_URL", "");

		const { getConvexAuthToken } = await loadModule();
		const fallbackJwt = createJwt();
		const request = requestWithCookie(`better-auth.convex_jwt=${fallbackJwt}; other=value`);

		await expect(getConvexAuthToken(request)).resolves.toBe(fallbackJwt);
	});

	it("prefers token endpoint when it returns a valid token", async () => {
		vi.stubEnv("VITE_CONVEX_SITE_URL", "https://example.convex.site");
		vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ token: "endpoint-token" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const { getConvexAuthToken } = await loadModule();
		const request = requestWithCookie("better-auth.convex_jwt=fallback-token");

		await expect(getConvexAuthToken(request)).resolves.toBe("endpoint-token");
	});

	it("falls back to cookie token when endpoint request throws", async () => {
		vi.stubEnv("VITE_CONVEX_SITE_URL", "https://example.convex.site");
		vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

		const { getConvexAuthToken } = await loadModule();
		const fallbackJwt = createJwt();
		const request = requestWithCookie(`better-auth.convex_jwt=${fallbackJwt}`);

		await expect(getConvexAuthToken(request)).resolves.toBe(fallbackJwt);
	});

	it("returns null when token endpoint explicitly rejects the request", async () => {
		vi.stubEnv("VITE_CONVEX_SITE_URL", "https://example.convex.site");
		vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: "unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const { getConvexAuthToken } = await loadModule();
		const request = requestWithCookie("better-auth.convex_jwt=fallback-token");

		await expect(getConvexAuthToken(request)).resolves.toBeNull();
	});

	it("falls back to cookie token when token endpoint has a server error", async () => {
		vi.stubEnv("VITE_CONVEX_SITE_URL", "https://example.convex.site");
		vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: "server-error" }), {
				status: 503,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const { getConvexAuthToken } = await loadModule();
		const fallbackJwt = createJwt();
		const request = requestWithCookie(`better-auth.convex_jwt=${fallbackJwt}`);

		await expect(getConvexAuthToken(request)).resolves.toBe(fallbackJwt);
	});
});
