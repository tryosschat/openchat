import "./polyfills";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { getAllowedOrigins, getCorsOrigin } from "./lib/origins";

const http = httpRouter();

// Register Better Auth routes with CORS enabled for client-side requests
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: getAllowedOrigins(),
    allowedHeaders: ["content-type", "authorization", "better-auth-cookie"],
    exposedHeaders: ["set-better-auth-cookie"],
  },
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({ 
        ok: true, 
        ts: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }),
});

// Public stats endpoint for sign-in page
// SECURITY: This endpoint exposes only aggregate, non-sensitive stats (counts, stars).
// If sensitive data is ever added, ensure CORS remains restricted to getAllowedOrigins().
http.route({
  path: "/stats",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const origin = request.headers.get("origin");
    const allowedOrigin = getCorsOrigin(origin);

    const stats = await ctx.runQuery(api.stats.getPublicStats, {});

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cache-control": "public, max-age=60", // Cache for 1 minute
      "vary": "Origin",
    };

    // Only set CORS header for allowed origins
    if (allowedOrigin) {
      headers["access-control-allow-origin"] = allowedOrigin;
    }

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers,
    });
  }),
});

http.route({
  path: "/workflow/cleanup-batch",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const payload = body as {
      workflowToken?: unknown;
      retentionDays?: unknown;
      batchSize?: unknown;
      dryRun?: unknown;
    };

    const authorization = request.headers.get("authorization")?.trim();
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;
    const bodyWorkflowToken =
      typeof payload.workflowToken === "string" ? payload.workflowToken.trim() : null;
    const workflowToken = bearerToken || bodyWorkflowToken;

    if (!workflowToken) {
      return new Response(JSON.stringify({ error: "workflowToken is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    let result;
    try {
      result = await ctx.runAction(internal.cleanupAction.runCleanupBatchForWorkflow, {
        workflowToken,
        retentionDays:
          typeof payload.retentionDays === "number" && Number.isFinite(payload.retentionDays)
            ? payload.retentionDays
            : undefined,
        batchSize:
          typeof payload.batchSize === "number" && Number.isFinite(payload.batchSize)
            ? payload.batchSize
            : undefined,
        dryRun: typeof payload.dryRun === "boolean" ? payload.dryRun : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup batch failed";
      const status =
        message === "Unauthorized"
          ? 401
          : message.includes("must be between")
            ? 400
            : 500;
      if (status === 500) {
        console.error("[cleanup-batch] Internal error", error);
      }
      const safeMessage = status === 500 ? "Cleanup batch failed" : message;
      return new Response(JSON.stringify({ error: safeMessage }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

export default http;
