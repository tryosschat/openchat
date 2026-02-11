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

describe("server-auth.getConvexAuthToken", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("uses better-auth.convex_jwt cookie fallback when Convex token endpoint is unavailable", async () => {
		vi.stubEnv("VITE_CONVEX_SITE_URL", "");
		vi.stubEnv("CONVEX_SITE_URL", "");

		const { getConvexAuthToken } = await loadModule();
		const request = requestWithCookie("better-auth.convex_jwt=abc%2E123%2Exyz; other=value");

		await expect(getConvexAuthToken(request)).resolves.toBe("abc.123.xyz");
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
		const request = requestWithCookie("better-auth.convex_jwt=fallback-token");

		await expect(getConvexAuthToken(request)).resolves.toBe("fallback-token");
	});
});
