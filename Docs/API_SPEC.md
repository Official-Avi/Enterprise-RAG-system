# Initial API Specification

This is a starting contract. Implement consistently and version breaking changes.

Base path: `/api/v1`  
Content type: JSON unless upload endpoint.  
Authentication: secure session or bearer-token strategy documented in implementation.  
All tenant-owned endpoints require tenant context derived from authenticated identity.

## Standard response/error shape
```json
{
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "The requested document could not be found.",
    "correlation_id": "..."
  }
}
```
Do not expose stack traces, secrets, internal paths, or cross-tenant existence.

## Health
- `GET /health/live` — process liveness.
- `GET /health/ready` — dependency readiness; no secrets in response. 200
  `{status: "ready", checks: {database, vector_store, vector_collection, embeddings}}` when every
  check is true, otherwise 503 with `status: "not_ready"` and the failing checks `false`.
  `vector_collection` is false when the configured Qdrant collection is missing while documents
  are marked indexed (a fresh deployment with nothing indexed is ready). `embeddings` builds the
  embedding provider and embeds a short string (5 s timeout; success cached for 60 s).

## Workspaces and collections
- `GET /workspaces`
- `GET /collections`
- `POST /collections`
- `GET /collections/{collection_id}`
- `PATCH /collections/{collection_id}`
- `DELETE /collections/{collection_id}`

## Documents
- `POST /collections/{collection_id}/documents` — multipart upload; returns document and job IDs.
- `GET /documents` — filtered/paginated, permission scoped.
- `GET /documents/{document_id}`
- `GET /documents/{document_id}/pipeline`
- `POST /documents/{document_id}/retry` — only if retryable and authorized.
- `DELETE /documents/{document_id}` — removes metadata, file, chunks/vectors, and handles jobs safely.

Example upload response:
```json
{
  "document_id": "uuid",
  "job_id": "uuid",
  "status": "queued",
  "duplicate": false
}
```

## Jobs / operations
- `GET /jobs?status=queued&limit=50&cursor=...`
- `GET /jobs/{job_id}`
- `POST /jobs/{job_id}/retry`
- `POST /jobs/{job_id}/cancel`
- `GET /operations/summary`
- `GET /operations/workers`
- `GET /operations/metrics?window=1h`

## RAG chat
- `POST /chat/sessions`
- `GET /chat/sessions`
- `GET /chat/sessions/{session_id}`
- `POST /chat/sessions/{session_id}/messages`

Request:
```json
{
  "collection_ids": ["uuid"],
  "message": "How do I troubleshoot a database connection timeout?"
}
```

Response:
```json
{
  "message_id": "uuid",
  "answer": "Based on the available runbook...",
  "evidence_status": "supported",
  "citations": [
    {
      "document_id": "uuid",
      "filename": "database-runbook.pdf",
      "page": 12,
      "chunk_id": "uuid",
      "quote": "Short authorized excerpt..."
    }
  ],
  "model": {
    "provider": "configured-provider",
    "name": "configured-model"
  },
  "latency_ms": 1234
}
```
The example values are illustrative only. Citations must map to authorized retrieved evidence. If evidence is insufficient, use `evidence_status: "insufficient"` and explain the limitation.

## Model serving
- `GET /models`
- `GET /models/health`
- `GET /models/metrics`
- Admin-only `PATCH /settings/model` — validated provider/model settings; secrets supplied via secret manager/env, never returned by API.

## Logical infrastructure
- `GET /infrastructure/racks`
- `POST /infrastructure/racks`
- `GET /infrastructure/racks/{rack_id}`
- `PATCH /infrastructure/racks/{rack_id}`
- `GET /infrastructure/nodes`
- `POST /infrastructure/nodes`
- `PATCH /infrastructure/nodes/{node_id}`
- `GET /infrastructure/workloads`
- `POST /infrastructure/workloads` — register logical workload, not deploy/control hardware.

Every infrastructure response includes `state_source`: `manual`, `simulated`, or `integration`.

## Users, roles, audit, evaluation
- `GET /admin/users`
- `POST /admin/users/invitations`
- `PATCH /admin/users/{user_id}/roles`
- `GET /admin/audit-events`
- `POST /evaluation/runs`
- `GET /evaluation/runs/{run_id}`

## API rules
- Validate request bodies with typed schemas.
- Use pagination for lists.
- Use consistent status codes.
- Apply rate limits to uploads and chat. A 429 `RATE_LIMITED` response carries `Retry-After`
  (whole seconds until the oldest request leaves the window, at least 1).
- Add correlation IDs to responses/logs.
- Add OpenAPI docs, but do not expose administrative endpoints publicly without authorization.

---

## Implemented v1 response contracts (sprint 2026-10-27)

These shapes are the binding contract between backend modules and the web app. All paths are under `/api/v1`. Timestamps are ISO-8601 UTC. IDs are UUID strings. Lists use `{ "items": [...], "next_cursor": string | null }` with `?limit=` (default 50, max 200) and `?cursor=` unless noted.

### Auth (implemented)
- `POST /auth/login` body `{email, password, tenant_slug?, mode?: "cookie"|"token"}` → `Me & {token: string|null}`. Cookie mode sets an HttpOnly `rf_session` cookie.
- `POST /auth/logout` → 204. `GET /auth/me` → `Me`.
- `Me = {user_id, email, display_name, tenant_id, role, permissions: string[], memberships: [{tenant_id, tenant_name, tenant_slug, role}]}`
- Browser writes (POST/PATCH/DELETE with cookie auth) must send header `X-RackFlow-CSRF: 1`.

### Collections (implemented)
- `GET /collections` → `Collection[]` (plain array). `POST /collections` `{name, description?, visibility?: "tenant"|"restricted"}` → 201 `Collection`.
- `GET|PATCH|DELETE /collections/{id}`.
- `Collection = {id, name, description, visibility, access_level: "read"|"write"|"manage"|null, document_count, created_at, updated_at}`

### Documents
- `POST /collections/{collection_id}/documents` multipart field `files` (one or more) → 201
  `{items: [{filename, status: "queued"|"duplicate"|"rejected", document_id|null, job_id|null, duplicate: bool, error: {code, message}|null}]}`
- `GET /documents?collection_id=&status=&file_type=&q=` → list of `Document`
- `GET /documents/{id}` → `Document`
- `Document = {id, collection_id, collection_name, filename, file_type, mime_type, size_bytes, status: "queued"|"processing"|"indexed"|"failed"|"deleting"|"deleted", page_count, chunk_count, token_count, extraction_method, ocr_page_count, quality_score, warnings: string[], pipeline_version, embedding_model, uploaded_by, created_at, updated_at, indexed_at, latest_job: JobBrief|null}`
- `JobBrief = {id, job_type, status, stage, attempt_count, max_attempts, error_code, safe_error_message}`
- `GET /documents/{id}/pipeline` → `{document_id, status, jobs: [Job & {attempts: Attempt[], stages: StageRun[]}]}`
- `GET /documents/{id}/chunks?page=` → list of `{id, chunk_index, page_start, page_end, token_count, text}` (requires content access)
- `POST /documents/{id}/retry` → 202 `{document_id, job_id}`; `DELETE /documents/{id}` → 202 `{document_id, job_id, status: "deleting"}`

### Jobs
- `GET /jobs?status=&job_type=&collection_id=&document_id=` → list of `Job`
- `GET /jobs/{id}` → `Job & {attempts: Attempt[], stages: StageRun[]}`
- `POST /jobs/{id}/retry`, `POST /jobs/{id}/cancel` → `Job`
- `Job = {id, job_type, status: "queued"|"running"|"retry_wait"|"succeeded"|"failed"|"cancelled", stage, document_id, document_filename, collection_id, attempt_count, max_attempts, priority, queued_at, available_at, started_at, finished_at, error_code, safe_error_message, correlation_id, cancel_requested}`
- `Attempt = {attempt_number, worker_id, status, stage, started_at, finished_at, error_code, safe_error_message}`
- `StageRun = {attempt_number, stage, status, started_at, finished_at, duration_ms, details: object, error_code}`

### Operations
- `GET /operations/summary` → `{jobs: {queued, running, retry_wait, succeeded, failed, cancelled}, queue_depth, oldest_queued_age_seconds, documents: {queued, processing, indexed, failed, deleting}, indexed_chunks, workers: {total, healthy, stale}, generated_at}`
- `GET /operations/workers` → `{items: [{worker_id, hostname, status, health: "healthy"|"stale"|"stopped", current_job_id|null, jobs_succeeded, jobs_failed, started_at, last_heartbeat_at, version}]}`
- `GET /operations/metrics?window=1h|24h|7d` → `{window_seconds, buckets: [{start, succeeded, failed}], avg_job_duration_ms, p95_job_duration_ms, error_rate, stage_durations_ms: {<stage>: number}}`

### Chat
- `POST /chat/sessions` `{title?, collection_ids: uuid[]}` → 201 `Session`; `GET /chat/sessions` → list of `Session`
- `GET /chat/sessions/{id}` → `{session: Session, messages: Message[]}`
- `PATCH /chat/sessions/{id}` `{title?: string (1..200), collection_ids?: uuid[] (1..50)}` → `Session`.
  Owner only (anyone else gets 404), permission `chat:use`. Does not change `updated_at`. Every
  collection must be accessible (404 `COLLECTION_NOT_FOUND`); a blank title is 422. Audited as
  `chat.session.rename` (title) and `chat.session.update` (collections), counts only.
- `DELETE /chat/sessions/{id}` → 204. Owner only (404 otherwise), permission `chat:use`. Removes
  the messages and their citations; documents are not affected. Audited as `chat.session.delete`.
- `POST /chat/sessions/{id}/messages` `{message, collection_ids?}` →
  `{message_id, user_message_id, answer, evidence_status: "supported"|"insufficient", citations: Citation[], model: {provider, name, deployment_mode}, latency_ms, retrieved_count}`.
  Without `collection_ids` the session's stored collections are used, minus any that were deleted
  or are no longer accessible; 404 `SESSION_SCOPE_EMPTY` only when none remain. An explicit
  `collection_ids` override must be fully accessible (404 `COLLECTION_NOT_FOUND`).
- `Session = {id, title, collection_ids, created_at, updated_at}`
- `Message = {id, role: "user"|"assistant", content, evidence_status|null, citations: Citation[], model: {provider, name}|null, latency_ms|null, created_at}`
- `Citation = {marker, document_id, filename, page, chunk_id, quote, score}` — only for sources the caller can still access.
- `POST /retrieval/inspect` `{query, collection_ids}` → `{items: [{chunk_id, document_id, filename, page_start, page_end, score, text}]}` (permission `retrieval:inspect`)

### Models
- `GET /models` → `{items: [{provider, name, deployment_mode, is_default, timeout_seconds, max_concurrency}]}`
- `GET /models/health` → `{ok, provider, model, deployment_mode, detail, latency_ms}`
- `GET /models/metrics?window=1h` → `{window_seconds, requests, errors, timeouts, error_rate, avg_latency_ms, p95_latency_ms, prompt_tokens, completion_tokens}`
