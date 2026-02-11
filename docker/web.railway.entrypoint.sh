#!/usr/bin/env sh
set -eu

PORT_TO_USE="${PORT:-3000}"

echo "[railway-entrypoint] starting web with NITRO_HOST=0.0.0.0 NITRO_PORT=${PORT_TO_USE}"

exec env NITRO_HOST=0.0.0.0 NITRO_PORT="${PORT_TO_USE}" bun apps/web/.output/server/index.mjs
