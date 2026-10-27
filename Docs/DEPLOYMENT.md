# Development and Deployment Plan

## 1. Development environment
Use Docker Compose to run:
- web frontend,
- API,
- background worker,
- PostgreSQL,
- Redis/queue broker,
- Qdrant,
- optional local object-storage emulator if selected.

Keep model runtime optional so the base application can boot without downloading a large model. Provide a mock/test model provider for CI and a configurable real provider for experiments.

## 2. Environment variables
Create `.env.example` documenting names and safe placeholders, for example:
- `APP_ENV`
- `API_BASE_URL`
- `DATABASE_URL`
- `REDIS_URL`
- `VECTOR_STORE_URL`
- `OBJECT_STORAGE_MODE`
- `OBJECT_STORAGE_ENDPOINT`
- `OBJECT_STORAGE_BUCKET`
- `MODEL_PROVIDER`
- `MODEL_NAME`
- `MODEL_BASE_URL`
- `MODEL_API_KEY` (placeholder only; never commit real value)
- `EMBEDDING_PROVIDER`
- `EMBEDDING_MODEL`
- `UPLOAD_MAX_BYTES`
- `JOB_MAX_ATTEMPTS`
- `LOG_LEVEL`
- `AUTH_ISSUER` / provider-specific auth settings

Validate required variables at startup and fail with a safe, actionable message.

## 3. Local startup
The repository README must include exact commands based on the actual implementation. Expected outline:
1. Copy `.env.example` to `.env` and fill only local values.
2. Start dependencies with Compose.
3. Run database migrations.
4. Start API, worker, and web.
5. Open the local frontend and health endpoints.
6. Run smoke tests.
Do not write commands that have not been tested.

## 4. Staging
- Use separate tenant/data namespace and credentials from production.
- Enable TLS, managed database/object storage, backups, metrics, and central logs.
- Use a managed queue/broker or persistent configured broker.
- Restrict admin access and apply rate limits.
- Configure model serving with explicit resource limits.

## 5. Production
- Deploy stateless API replicas behind a load balancer.
- Scale worker replicas separately according to queue depth and CPU/memory/OCR load.
- Scale model-serving replicas independently; test batching/concurrency and GPU/CPU fit.
- Use managed PostgreSQL with backup/PITR if available.
- Use durable object storage and lifecycle policies.
- Configure vector DB backups and tested restore.
- Use health/readiness probes and graceful shutdown.
- Roll out migrations with a documented backup/rollback plan.
- Monitor errors, queue age, processing latency, retrieval latency, model latency, saturation, and cost.

## 6. Resource reality
Do not promise a particular concurrency level until measured. A 0.5B model may be small, but serving 500 simultaneous engineers depends on hardware, request rate, prompt/output lengths, batching, quantization, runtime, and acceptable latency. Test on the actual target environment.

## 7. Deployment acceptance
- Clean install succeeds.
- Health and readiness are correct.
- Secrets are injected securely.
- Backups and restore are tested.
- Queue recovery and worker restart are tested.
- Dashboard values match backend metrics.
- Runbook covers common failures and rollback.


---

## 8. Implemented deployment guide (sprint 2026-10-27)

Status labels: **verified** = executed successfully; **documented** = written but not executed.

### 8.1 Components and processes
| Process | Command | Scales | State |
|---|---|---|---|
| API | `uvicorn rackflow.api.app:create_app --factory --host 0.0.0.0 --port 8000` | Horizontally (stateless; sessions in PostgreSQL) | none |
| Worker | `rackflow-worker` (or `python -m rackflow.worker.main`) | Horizontally — add processes/replicas; jobs are claimed with `SKIP LOCKED` leases | none |
| Web | Next.js standalone `node server.js` | Horizontally | none |
| Migration | `alembic upgrade head` (one-shot, before API/worker start) | n/a | n/a |
| PostgreSQL 18 | metadata, sessions, job queue, audit | managed service recommended | persistent |
| Qdrant 1.20 | vectors (IDs + filter metadata only) | per Qdrant guidance | persistent |
| Object storage | local volume (`OBJECT_STORAGE_PATH`); S3 adapter not implemented | shared volume across API/workers | persistent |

### 8.2 Environment variables (no secrets in images or the repository)
See `.env.example` for every variable and safe defaults. Secrets — `DATABASE_URL` password,
`MODEL_API_KEY`, `VECTOR_STORE_API_KEY` — must come from the deployment's secret store or
environment. Production additionally requires `APP_ENV=production` (disables API docs; startup
fails if `COOKIE_SECURE` is false or a test-only embedding provider is configured),
`COOKIE_SECURE=true`, `WEB_ORIGIN=<https origin>`, and TLS termination in front of the web tier.

### 8.3 Docker Compose (Linux) — verified in CI
`docker compose up --build` starts PostgreSQL, Qdrant, the migration job, API, worker and web,
with health checks. CI job `compose-smoke` runs this on every push and checks liveness,
readiness (database + vector store) and the web login page. Data ports bind to 127.0.0.1.
Scale workers with `docker compose up --scale worker=3` (documented; queue concurrency is covered
by tests, not by a multi-replica Compose run). The web image bakes the API proxy target at
build time (`API_PROXY_TARGET` build arg, default `http://api:8000`).

### 8.4 Windows host without Docker — verified
Portable PostgreSQL/Qdrant plus the commands in the root README. A clean clone from GitHub was
installed with exactly those commands on 2026-10-27 (fresh database, separate ports) and passed the
live smoke test (upload → index with real embeddings → cited answer) and web proxy login.

### 8.5 Database migrations and rollback
- Apply: `alembic upgrade head` — verified (local, CI, clean install).
- Roll back one revision: `alembic downgrade -1`; to empty: `alembic downgrade base` — the full
  `upgrade head → downgrade base → upgrade head` round trip is an automated test.
- Before production migrations take a database backup; downgrades drop the affected tables.

### 8.6 Health probes and operations
- Liveness: `GET /health/live` (also `/api/v1/health/live`). Readiness: `GET /api/v1/health/ready`
  (503 until PostgreSQL and Qdrant respond).
- Worker liveness: heartbeats every 5 s in `worker_heartbeats`; the console marks a worker stale
  after 15 s. A crashed worker's jobs are reclaimed after `JOB_LEASE_SECONDS` (verified by a
  process-kill test).
- Logs: JSON lines on stdout with correlation IDs; no document text, prompts or answers.

### 8.7 Not yet implemented / not verified (required before production)
- Backups and tested restore for PostgreSQL, Qdrant and object storage (not implemented).
- S3-compatible object storage adapter (interface only; local volume used).
- Distributed rate limiting (current limits are per API process).
- OpenTelemetry tracing, central log shipping, alerting.
- TLS/reverse-proxy configuration, managed secrets integration, staging environment.
- Load testing; no concurrency or throughput claims are made.
- Malware scanning of uploads.
