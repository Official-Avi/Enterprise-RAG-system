# RackFlow AI backend image (API and worker share it; the command selects the role).
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# Runtime libraries needed by onnxruntime / OpenCV (RapidOCR) and pdfium.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.22 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 --home /app rackflow \
 && mkdir -p /data/objects /data/models \
 && chown -R rackflow /data
USER rackflow

ENV OBJECT_STORAGE_PATH=/data/objects \
    FASTEMBED_CACHE_PATH=/data/models

EXPOSE 8000
CMD ["uvicorn", "rackflow.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
