#!/bin/sh
set -e

# Railway sets PORT for the public listener (often 3000). Next must use a *different*
# internal port or nginx cannot bind (502 / "application failed to respond").
LISTEN_PORT="${PORT:-8080}"
NEXT_INTERNAL_PORT=3001

cd /app/next
export NODE_ENV=production
export PORT="$NEXT_INTERNAL_PORT"
node server.js &

cd /app
export PYTHONPATH=/app/src
uvicorn memedna.main:app --host 127.0.0.1 --port 8000 &

sed -e "s/@@PORT@@/${LISTEN_PORT}/g" -e "s/@@NEXT_PORT@@/${NEXT_INTERNAL_PORT}/g" \
  /app/docker/nginx.conf.template > /tmp/nginx.conf
nginx -t -c /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
