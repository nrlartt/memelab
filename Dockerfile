# ── Stage 1: Build the Next.js frontend ──────────────────────────────────────
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

# Install dependencies first (better layer caching)
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy the rest of the frontend source
COPY frontend/ ./

# Build with NEXT_PUBLIC_API_BASE set to "/" so all API calls are same-origin
# (the FastAPI backend serves both the UI and the /api/* routes on one port)
ENV NEXT_PUBLIC_API_BASE=/
RUN npm run build

# ── Stage 2: Python runtime with embedded frontend assets ─────────────────────
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential gcc git curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY pyproject.toml .
COPY src ./src
COPY scripts ./scripts
COPY sql ./sql

# Copy the built Next.js static assets and pre-rendered pages into the image.
# FastAPI mounts these directories to serve the frontend without a Node process.
COPY --from=frontend-builder /frontend/.next /app/frontend/.next
COPY --from=frontend-builder /frontend/public /app/frontend/public

ENV PYTHONPATH=/app/src

EXPOSE 8000

CMD ["uvicorn", "memedna.main:app", "--host", "0.0.0.0", "--port", "8000"]
