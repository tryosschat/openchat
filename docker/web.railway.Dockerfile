# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.0 AS deps
WORKDIR /app

# Copy only manifests first so dependency install stays cached unless deps change.
COPY bun.lock package.json bunfig.toml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/extension/package.json apps/extension/package.json

RUN bun install --frozen-lockfile --filter web

FROM deps AS builder
WORKDIR /app

COPY tsconfig.base.json tsconfig.base.json
COPY apps/web apps/web
COPY apps/server/convex/_generated apps/server/convex/_generated

RUN bun run --cwd apps/web build

FROM oven/bun:1.3.0 AS runner
WORKDIR /app

ENV NODE_ENV=production
# HOST must be 0.0.0.0 so the server binds all interfaces inside the container.
# Do NOT set PORT or EXPOSE here — Railway injects its own PORT at runtime and
# uses that same value for healthcheck probes. Hardcoding PORT in the Dockerfile
# causes a mismatch where Nitro binds to Railway's dynamic port but the
# healthcheck probes the Dockerfile's static port, resulting in "service unavailable".
ENV HOST=0.0.0.0

COPY --from=builder /app/apps/web/.output ./apps/web/.output

CMD ["bun", "apps/web/.output/server/index.mjs"]
