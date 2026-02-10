# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.0 AS deps
WORKDIR /app

# Copy only manifests first so dependency install stays cached unless deps change.
COPY bun.lock package.json bunfig.toml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/extension/package.json apps/extension/package.json

RUN --mount=type=cache,id=openchat-web-bun,target=/root/.bun/install/cache \
	bun install --frozen-lockfile --filter web

FROM deps AS builder
WORKDIR /app

COPY tsconfig.base.json tsconfig.base.json
COPY apps/web apps/web
COPY apps/server/convex/_generated apps/server/convex/_generated

RUN bun run --cwd apps/web build

FROM oven/bun:1.3.0 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=builder /app/apps/web/.output ./apps/web/.output

EXPOSE 3000
CMD ["bun", "apps/web/.output/server/index.mjs"]
