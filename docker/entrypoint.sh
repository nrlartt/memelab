#!/bin/sh
set -e

# Railway sets PORT — Next.js listens on it directly (no nginx).
LISTEN_PORT="${PORT:-3000}"

cd /app
export PYTHONPATH=/app/src
uvicorn memedna.main:app --host 127.0.0.1 --port 8000 &

# Railway (and other platforms) must see a process bound to $PORT *immediately* after
# the container starts. A long blocking wait for FastAPI /healthz meant **nothing
# listened on $PORT** for up to 3 minutes → edge error "Application failed to respond".
# Give Uvicorn a moment to import and bind, then start Next. First /api calls may
# 502 for a few seconds if the DB is slow — acceptable vs the whole site offline.
sleep 2

cd /app/next
export NODE_ENV=production
export PORT="$LISTEN_PORT"
export HOSTNAME=0.0.0.0
export HOST=0.0.0.0
exec node server.js
