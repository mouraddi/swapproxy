#!/bin/sh
set -e

echo "[entrypoint] Starting SwapProxy..."

redis-server --daemonize yes --save "" --appendonly no
sleep 1
echo "[entrypoint] Redis ready"

export REDIS_URL=redis://127.0.0.1:6379
export PROXY_PORT=3128

echo "[entrypoint] Engine starting..."
exec node /app/server.js
