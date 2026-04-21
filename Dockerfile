# -----------------------------------------------------------------------------
# Next.js production bundle (standalone server)
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Same-origin API in the unified image (Next rewrites → uvicorn on 127.0.0.1:8000).
ARG NEXT_PUBLIC_API_BASE=
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE

RUN npm run build

# -----------------------------------------------------------------------------
# Python API (internal) + Next standalone on Railway PORT (rewrites proxy /api)
# -----------------------------------------------------------------------------
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Next standalone still needs a Node runtime in this stage (only the built bundle is copied from frontend-build).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential \
       gcc \
       git \
       curl \
       ca-certificates \
       gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY pyproject.toml .
COPY src ./src
COPY scripts ./scripts
COPY sql ./sql
COPY docker ./docker

ENV PYTHONPATH=/app/src

COPY --from=frontend-build /app/frontend/.next/standalone /app/next
COPY --from=frontend-build /app/frontend/.next/static /app/next/.next/static
COPY --from=frontend-build /app/frontend/public /app/next/public

RUN chmod +x /app/docker/entrypoint.sh

# Railway sets PORT; Next listens on it (default 3000 locally).
EXPOSE 3000

ENTRYPOINT ["/app/docker/entrypoint.sh"]