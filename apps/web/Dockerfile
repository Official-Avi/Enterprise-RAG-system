# syntax=docker/dockerfile:1.28
# RackFlow AI web console (Next.js standalone output). Three stages: "deps" installs the locked
# packages, "build" runs next build, "runtime" carries only the standalone server, its static assets
# and public/. No npm, no package caches, no dev dependencies in the final image.
#
# Base image is pinned by version. For a reproducible production build also pin the digest, e.g.
#   FROM node:24.22.2-alpine3.24@sha256:<index digest>
# (the multi-arch index digest seen on 2026-11-07 was
#  sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8) and let a bot such as
# Renovate or Dependabot move it. Keep all three stages on the same tag.

FROM node:26.13.1-alpine3.24 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# The npm cache lives in a BuildKit cache mount, never in a layer.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM node:26.13.1-alpine3.24 AS build
WORKDIR /app
# Rewrites (target and proxy timeout) are compiled into the standalone server at build time: point
# /api/* at the API service. Keep API_PROXY_TIMEOUT_MS equal to the API's
# WEB_PROXY_TIMEOUT_SECONDS x 1000 (Compose passes both).
ARG API_PROXY_TARGET=http://api:8000
ARG API_PROXY_TIMEOUT_MS=120000
ENV API_PROXY_TARGET=$API_PROXY_TARGET \
    API_PROXY_TIMEOUT_MS=$API_PROXY_TIMEOUT_MS \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# .dockerignore keeps .env*, node_modules, .next, e2e (and its saved sessions), test-results and the
# Playwright config out of this copy.
COPY . .
RUN npm run build

FROM node:26.13.1-alpine3.24 AS runtime

ARG APP_UID=10001
ARG APP_GID=10001

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The server only needs node. Drop npm, npx, corepack and yarn: they are build tools and the
# largest source of CVE noise in the base image. Fixed UID/GID for the app user.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
      /root/.npm /tmp/* \
 && addgroup -S -g "${APP_GID}" app \
 && adduser -S -D -H -u "${APP_UID}" -G app -h /nonexistent -s /sbin/nologin app

WORKDIR /app
# Code is owned by root and only readable by the app user. The single writable path is
# .next/cache (image optimiser and fetch cache); mount a tmpfs there when the root file system is
# read-only.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p /app/.next/cache \
 && chown "${APP_UID}:${APP_GID}" /app/.next/cache

USER ${APP_UID}:${APP_GID}
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/',{redirect:'manual',signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.status>=200&&r.status<400?0:1),()=>process.exit(1))"]

CMD ["node", "server.js"]
