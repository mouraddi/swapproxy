#!/bin/sh
set -e

echo "[entrypoint] Starting SwapProxy v2..."

# Start Redis
redis-server --daemonize yes --save "" --appendonly no
sleep 1
echo "[entrypoint] Redis started"

# Start Scylla in background
scylla --port 8899 --proxy-port 8081 --daemon &
echo "[entrypoint] Scylla started"

# Wait for Scylla API
for i in $(seq 1 20); do
  if wget -q -O- http://127.0.0.1:8899/api/v1/proxies 2>/dev/null; then
    echo "[entrypoint] Scylla API ready"
    break
  fi
  sleep 2
done

# Start engine
exec node /app/server.js
