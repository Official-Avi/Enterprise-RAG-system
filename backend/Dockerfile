# syntax=docker/dockerfile:1.28
# RackFlow AI backend image. The API, the worker and the migrate job share it; the Compose command
# picks the role (default: the API). Two stages: "build" resolves the locked dependencies with uv,
# "runtime" carries only the virtualenv, the source and the runtime libraries. No uv, no caches.
#
# Base images are pinned by version. For a reproducible production build also pin the digest, e.g.
#   FROM python:3.12.16-slim-trixie@sha256:<index digest>
# (the multi-arch index digest seen on 2026-11-07 was
#  sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54) and let a bot such as
# Renovate or Dependabot move it, so security rebuilds stay deliberate. Both stages must use the
# same base: the virtualenv's python links to the base image's interpreter.

# uv is copied from its own pinned image (add @sha256:<digest> here too when pinning digests;
# the 0.12.22 index digest seen on 2026-11-07 was
# sha256:f513a91fc62fe7c17567eee97230dd198e43edb8a9fbecca843714a4358fe1bc).
FROM ghcr.io/astral-sh/uv:0.12.22 AS uv

FROM python:3.15.2-slim-trixie AS build
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
# Dependencies first so source edits do not reinstall them. The uv cache lives in a BuildKit
# cache mount, never in a layer.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./
# Installs the project itself (editable, pointing at /app/src, the same layout the image always
# had) and precompiles the source so nothing is written at runtime.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev \
 && python -m compileall -q /app/src /app/migrations

FROM python:3.15.2-slim-trixie AS runtime

ARG APP_UID=10001
ARG APP_GID=10001

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    OBJECT_STORAGE_PATH=/data/objects \
    FASTEMBED_CACHE_PATH=/data/models \
    HF_HOME=/data/models/huggingface \
    HOME=/tmp

# Runtime libraries needed by onnxruntime / OpenCV (RapidOCR) and pdfium. Trixie names the glib
# package libglib2.0-0t64. Debian package versions are not pinned: the archive drops superseded
# versions, so a pin would break the next build after a security update. The base digest pins them.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0t64 libgomp1 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /var/log/apt /var/log/dpkg.log

# Fixed UID/GID so volume ownership survives rebuilds (10001 matches earlier images). The code is
# owned by root and only readable by the app user; the only writable paths are the two data
# volumes and /tmp (uploads spool there), so the container can run with a read-only root file system.
RUN groupadd --system --gid "${APP_GID}" rackflow \
 && useradd --system --uid "${APP_UID}" --gid rackflow --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin rackflow \
 && mkdir -p /data/objects /data/models \
 && chown -R "${APP_UID}:${APP_GID}" /data \
 && chmod 0750 /data/objects /data/models

COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY --from=build /app/src ./src
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/alembic.ini ./

USER ${APP_UID}:${APP_GID}
# /data/objects and /data/models are mounted as volumes by Compose. No VOLUME instruction here,
# so the one-shot migrate container does not leave anonymous volumes behind.
EXPOSE 8000

# Probes the API role (the default command) on its dependency-free liveness route. Worker and
# migrate containers reuse this image but serve no HTTP: when PID 1 is not uvicorn the check passes
# without probing, so `docker compose up --wait` does not mark the worker unhealthy. Compose may
# still override it per service (healthcheck: disable: true, or a worker-specific test).
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; b'uvicorn' in open('/proc/1/cmdline', 'rb').read() or sys.exit(0); urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/live', timeout=4)"]

CMD ["uvicorn", "rackflow.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
