#!/bin/sh
set -e

# Railway sets PORT — Next.js listens on it directly (no nginx).
LISTEN_PORT="${PORT:-3000}"

cd /app
export PYTHONPATH=/app/src
uvicorn memedna.main:app --host 127.0.0.1 --port 8000 &

# SSR and /api rewrites need FastAPI; avoid first-request 502 while DB warms up.
i=0
while [ "$i" -lt 180 ]; do
  if curl -sf --connect-timeout 5 "http://127.0.0.1:8000/healthz" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

cd /app/next
export NODE_ENV=production
export PORT="$LISTEN_PORT"
export HOSTNAME=0.0.0.0
export HOST=0.0.0.0
exec node server.js
