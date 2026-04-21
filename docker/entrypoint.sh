#!/bin/sh
set -e

# Railway sets PORT for the public listener (often 3000). Next must use a *different*
# internal port or nginx cannot bind (502 / "application failed to respond").
LISTEN_PORT="${PORT:-8080}"
NEXT_INTERNAL_PORT=3001

cd /app/next
export NODE_ENV=production
export PORT="$NEXT_INTERNAL_PORT"
# Docker/Kubernetes set HOSTNAME to the container id; Next uses HOSTNAME as the bind
# address. If it is not 0.0.0.0/127.0.0.1, nginx upstream http://127.0.0.1:NEXT may get 502.
export HOSTNAME=0.0.0.0
export HOST=0.0.0.0
node server.js &

cd /app
export PYTHONPATH=/app/src
uvicorn memedna.main:app --host 127.0.0.1 --port 8000 &

# Avoid nginx → upstream 502 while Node/uvicorn are still booting.
# Next: any HTTP response means the port is accepting (do not use curl -f; SSR may 5xx briefly).
i=0
while [ "$i" -lt 90 ]; do
  if curl -sS --connect-timeout 2 -o /dev/null "http://127.0.0.1:${NEXT_INTERNAL_PORT}/" 2>/dev/null \
    && curl -sf --connect-timeout 2 "http://127.0.0.1:8000/healthz" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

sed -e "s/@@PORT@@/${LISTEN_PORT}/g" -e "s/@@NEXT_PORT@@/${NEXT_INTERNAL_PORT}/g" \
  /app/docker/nginx.conf.template > /tmp/nginx.conf
nginx -t -c /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
