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
