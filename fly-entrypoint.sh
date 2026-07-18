#!/bin/sh
set -e

echo "[entrypoint] Starting SwapProxy v2..."

redis-server --daemonize yes --save "" --appendonly no
sleep 1
echo "[entrypoint] Redis ready"

scylla --port 8899 --proxy-port 8081 &
echo "[entrypoint] Scylla starting..."

for i in $(seq 1 30); do
  if wget -q -O- http://127.0.0.1:8899/api/v1/proxies 2>/dev/null; then
    echo "[entrypoint] Scylla API ready"
    break
  fi
  sleep 2
done

export SCYLLA_API_URL=http://127.0.0.1:8899/api/v1/proxies
export REDIS_URL=redis://127.0.0.1:6379
export PROXY_PORT=3128

echo "[entrypoint] Engine starting..."
exec node /app/server.js
