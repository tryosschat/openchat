import "./polyfills";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { streamLLM } from "./streaming";
import { api } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { getAllowedOrigins } from "./lib/origins";

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

// LLM streaming endpoint - runs on Convex infrastructure for persistence
http.route({
  path: "/stream-llm",
  method: "POST",
  handler: streamLLM,
});

// Handle CORS preflight for streaming endpoint
http.route({
  path: "/stream-llm",
  method: "OPTIONS",
  handler: streamLLM,
});

// Public stats endpoint for sign-in page
http.route({
  path: "/stats",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const stats = await ctx.runQuery(api.stats.getPublicStats, {});
    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=60", // Cache for 1 minute
      },
    });
  }),
});

export default http;
