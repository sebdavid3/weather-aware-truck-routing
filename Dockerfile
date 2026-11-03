# One image serves the API and the built frontend from the same origin.

FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    DJANGO_DEBUG=false
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
EXPOSE 8000
# One process keeps the in-memory cache shared by every request; threads
# handle concurrency while requests wait on the weather and routing APIs.
CMD ["sh", "-c", "uv run --no-sync gunicorn config.wsgi --workers 1 --threads 8 --timeout 150 --bind 0.0.0.0:${PORT:-8000}"]
