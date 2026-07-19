#!/bin/sh
set -e

echo "[entrypoint] Starting SwapProxy..."

redis-server --daemonize yes --save "" --appendonly no
sleep 1
echo "[entrypoint] Redis ready"

export REDIS_URL=redis://127.0.0.1:6379
export PROXY_PORT=3128

# Start proxy engine in background
echo "[entrypoint] Starting proxy engine..."
node /app/engine/server.js &
sleep 2

# Start web server in foreground
echo "[entrypoint] Starting web server..."
export PROXY_DOMAIN=${PROXY_DOMAIN:-swapproxy.fly.dev}
exec node /app/web/server.js
