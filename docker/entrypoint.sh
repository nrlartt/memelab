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
# FastAPI: accept any response (not just 200) so a slow startup doesn't block nginx indefinitely.
i=0
while [ "$i" -lt 180 ]; do
  NEXT_OK=0
  FASTAPI_OK=0

  if curl -sS --connect-timeout 5 -o /dev/null "http://127.0.0.1:${NEXT_INTERNAL_PORT}/" 2>/dev/null; then
    NEXT_OK=1
  fi

  if curl -sS --connect-timeout 5 -o /dev/null "http://127.0.0.1:8000/healthz" 2>/dev/null; then
    FASTAPI_OK=1
  fi

  if [ "$NEXT_OK" -eq 1 ] && [ "$FASTAPI_OK" -eq 1 ]; then
    echo "[entrypoint] Next.js and FastAPI are ready after ${i}s — starting nginx"
    break
  fi

  echo "[entrypoint] Waiting for services (${i}s elapsed) — Next.js: ${NEXT_OK}, FastAPI: ${FASTAPI_OK}"
  i=$((i + 1))
  sleep 1
done

if [ "$NEXT_OK" -eq 0 ] || [ "$FASTAPI_OK" -eq 0 ]; then
  echo "[entrypoint] WARNING: timed out waiting for services after 180s — Next.js: ${NEXT_OK}, FastAPI: ${FASTAPI_OK}. Starting nginx anyway."
fi

sed -e "s/@@PORT@@/${LISTEN_PORT}/g" -e "s/@@NEXT_PORT@@/${NEXT_INTERNAL_PORT}/g" \
  /app/docker/nginx.conf.template > /tmp/nginx.conf
nginx -t -c /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
