# Development and Deployment Plan

Sections 1 to 7 are the deployment plan and its goals. They do not describe what exists. Section 8 is
what is implemented, and it says what has been executed. **RackFlow AI has never run in production or
staging, and nothing here claims it is ready to.**

## 1. Development environment
Docker Compose runs:
- web frontend,
- API,
- background worker,
- PostgreSQL (metadata and the job queue; there is no Redis or other broker, see ADR-005),
- Qdrant.

Object storage is a local volume. The Windows development host has no Docker and runs PostgreSQL and
Qdrant from portable binaries (§8.4).

The model runtime is optional, so the application boots without one: the default `extractive` provider uses no LLM. The backend test suite runs with that provider and a `hash` test embedder.

## 2. Environment variables
Create `.env.example` documenting names and safe placeholders, for example:
- `APP_ENV`
- `API_BASE_URL`
- `DATABASE_URL`
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
- `AUTH_ISSUER` (reserved; no OIDC provider exists yet)
- `DEMO_MODE` (default false; refused with `APP_ENV=production`)
- `TRUSTED_PROXY_IPS` (default empty; see §8.8)

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
- The job queue lives in PostgreSQL, so it follows the database's durability and backups.
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

Last reviewed against the code on 2026-11-06, on branch `ui-redesign-2026-10`.

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
environment. A deployment on real data additionally requires `APP_ENV=production` (disables API docs;
startup fails if `COOKIE_SECURE` is false, a test-only embedding provider is configured, or
`DEMO_MODE` is true), `COOKIE_SECURE=true`, `WEB_ORIGIN=<https origin>`, and TLS termination in front
of the web tier.

Startup also fails if `MODEL_PROVIDER=openai_compatible` has a blank `MODEL_NAME` or no
`MODEL_BASE_URL`, if `MODEL_PROVIDER=anthropic` has no key, or if `TRUSTED_PROXY_IPS` is invalid.

Choosing a remote model sends questions and retrieved passages to that provider (ADR-023). Decide
this deliberately for each deployment.

### 8.3 Docker Compose (Linux) — verified in CI at v0.1.0 only
`docker compose up --build` starts PostgreSQL, Qdrant, the migration job, API, worker and web,
with health checks. CI job `compose-smoke` runs this on pushes to `main` and on pull requests, and
checks liveness, readiness (database, vector store, vector collection, embeddings; see §8.6) and the
web login page. Data ports bind to 127.0.0.1.

**Not executed yet:** the Compose and CI changes on this branch have only been parsed as YAML and
covered by a text-level test, because Docker is not on the development host. That covers the fixed web
address and network, `DEMO_MODE` and `TRUSTED_PROXY_IPS` pass-through, and the CI retries. The first
`compose-smoke` run on this branch is their first real test.

- A fresh stack has no accounts. Create them with `docker compose exec api rackflow-admin seed-demo`.
  It prints a generated password once. `RACKFLOW_SEED_PASSWORD` is not passed to containers by Compose.
- Containers get only the settings listed under `x-backend-env`. Anything else in `.env` does not reach
  them, including `MODEL_TIMEOUT_SECONDS` and the retrieval and chunking settings.
- `web` has the fixed address 172.30.0.10 on subnet 172.30.0.0/24. If that overlaps a host network,
  change both together in `docker-compose.yml`.
- The web service has no healthcheck, so `up --wait` does not wait for it.
Scale workers with `docker compose up --scale worker=3` (documented; queue concurrency is covered
by tests, not by a multi-replica Compose run). The web image bakes the API proxy target at
build time (`API_PROXY_TARGET` build arg, default `http://api:8000`).

### 8.4 Windows host without Docker — verified at v0.1.0
Portable PostgreSQL/Qdrant plus the commands in the root README. A clean clone from GitHub was
installed with exactly those commands on 2026-10-27 (fresh database, separate ports) and passed the
live smoke test (upload → index with real embeddings → cited answer) and web proxy login. That has not
been repeated for the current README, which now starts the backend with
`scripts\dev\start-backend.ps1`. The script has been used on the development host since 2026-11-05.

**Restarts:** the API and worker do not reload. Fixes in the code take effect only after
`start-backend.ps1` runs again. It stops the previous API and worker, and a job held by a stopped
worker is retried after its lease. It does not apply migrations.

### 8.5 Database migrations and rollback
- Apply: `alembic upgrade head` — verified (local, CI, clean install).
- Roll back one revision: `alembic downgrade -1`; to empty: `alembic downgrade base` — the full
  `upgrade head → downgrade base → upgrade head` round trip is an automated test.
- Before production migrations take a database backup; downgrades drop the affected tables.

### 8.6 Health probes and operations
- Liveness: `GET /health/live` (also `/api/v1/health/live`). Readiness: `GET /api/v1/health/ready`
  returns 503 until every check passes: `database` (PostgreSQL answers), `vector_store` (Qdrant
  answers), `vector_collection` (the configured collection exists, or nothing is indexed yet: the
  worker creates it on the first index) and `embeddings` (the embedding provider loads and embeds
  a short string within 5 s; success is cached for 60 s). The API starts loading the embedding
  model in the background at startup, so the first probe is usually fast; on a cold model cache
  readiness can stay 503 while the model downloads.
- Lost vectors (for example a deleted Qdrant collection: readiness shows
  `vector_collection: false`): rebuild them from the stored originals with
  `rackflow-admin reindex --tenant <slug> [--include-failed] [--dry-run]`, then let the workers
  drain the queue. Re-index jobs run behind interactive uploads (priority 200).
- Jobs that fail because a library cannot be loaded on the host (ImportError, DLL load errors)
  fail at once with `DEPENDENCY_UNAVAILABLE` instead of being retried; fix the host, then retry.
- Readiness can go green again after a lost collection is recreated: `ensure_collection` recreates it
  and logs a `vector_collection_created` warning, but the probe does not compare the point count with
  indexed chunks. Watch for that warning.
- `reindex --include-failed` skips documents whose newest job is a failed or cancelled delete and prints
  them as skipped, including in a dry run. A document the owner retried after a failed delete is still
  re-indexed.
- Evaluation runs hold a worker. On a rate-limited model a 13-question run can take minutes (about a minute measured on Groq's free plan),
  and with one worker uploads queue behind it. To separate them, run a dedicated worker:
  `python -m rackflow.worker.main --job-types evaluation_run`, and give the other workers
  `--job-types ingest_document,delete_document`. The retry itself has not been run against a real
  rate-limited provider.
- Worker liveness: heartbeats every 5 s in `worker_heartbeats`; the console marks a worker stale
  after 15 s. A crashed worker's jobs are reclaimed after `JOB_LEASE_SECONDS` (verified by a
  process-kill test).
- Logs: JSON lines on stdout with correlation IDs; no document text, prompts or answers.

### 8.7 Not yet implemented / not verified (required before production)
- Backups and tested restore for PostgreSQL, Qdrant and object storage (not implemented).
- S3-compatible object storage adapter (interface only; local volume used).
- Distributed rate limiting (current limits are per API process).
- A hop that stamps the client's socket address (§8.8).
- OpenTelemetry tracing, central log shipping, alerting.
- TLS/reverse-proxy configuration, managed secrets integration, staging environment.
- Load testing; no concurrency or throughput claims are made.
- Malware scanning of uploads.
- CI jobs for Playwright and axe, dependency audits and secret scanning.
- Default-credential rejection: Compose falls back to the password `rackflow` if `POSTGRES_PASSWORD`
  is unset, and `.env.example` shows the same value.
- Any repeat of the clean install on the current branch.

### 8.8 Load balancers and client addresses (`TRUSTED_PROXY_IPS`)
Sign-in and demo rate limits are per client address. The API takes that address from the connecting
peer, and trusts `X-Forwarded-For` only from peers listed in `TRUSTED_PROXY_IPS` (ADR-025).

Requirements behind a load balancer:
1. **The load balancer must set `X-Forwarded-For` itself.**
2. Set `TRUSTED_PROXY_IPS=172.30.0.10` (the web container).
3. **Port 3000 must be reachable only through the load balancer.** The Next proxy adds no address of
   its own and passes on whatever header it receives, so with this set and port 3000 published, clients
   can forge their address.

Without a load balancer, leave it empty. All Compose traffic then shares the web container's address,
so one client can use up the sign-in limits for everyone. This is acceptable only while port 3000 is
bound to loopback, as it is by default.

Values are comma-separated IP addresses or CIDR ranges. Startup refuses `*`, hostnames and `/0`. Next's
behaviour was checked with a throwaway `next dev` app and an echo server; `next start` was not run.
