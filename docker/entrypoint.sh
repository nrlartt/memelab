#!/bin/sh
set -e

# External port (Railway / Docker). Next.js uses its own internal PORT=3000 below.
LISTEN_PORT="${PORT:-8080}"

cd /app/next
export NODE_ENV=production
export PORT=3000
node server.js &

cd /app
export PYTHONPATH=/app/src
uvicorn memedna.main:app --host 127.0.0.1 --port 8000 &

sed "s/@@PORT@@/${LISTEN_PORT}/g" /app/docker/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
