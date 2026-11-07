# API Specification

The first part of this file is the original proposed contract, kept for reference. The binding
description of what the code does is **"Implemented v1 response contracts"** below, last checked
against the routers on 2026-11-06. ADR-019 records where the code deliberately departs from the
proposal: for example, there is no `POST /admin/users/invitations` and no `PATCH /settings/model`.

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

## Implemented v1 response contracts (sprint 2026-10-27, updated 2026-11-06)

These shapes are the binding contract between backend modules and the web app. All paths are under `/api/v1`. Timestamps are ISO-8601 UTC. IDs are UUID strings. Lists use `{ "items": [...], "next_cursor": string | null }` with `?limit=` (default 50, max 200) and `?cursor=` unless noted.

### Auth (implemented)
- `POST /auth/login` body `{email, password, tenant_slug?, mode?: "cookie"|"token"}` → `Me & {token: string|null}`. Cookie mode sets an HttpOnly `rf_session` cookie.
- `POST /auth/logout` → 204. `GET /auth/me` → `Me`.
- `Me = {user_id, email, display_name, tenant_id, role, permissions: string[], memberships: [{tenant_id, tenant_name, tenant_slug, role}]}`
- Browser writes (POST/PATCH/DELETE with cookie auth) must send header `X-RackFlow-CSRF: 1`. The
  check runs where a session is read, so the public `POST /auth/login` and `POST /auth/demo` do not
  require it.
- Any rejected sign-in returns the same 401 `INVALID_CREDENTIALS`, whether the address is unknown, the
  password is wrong, the account is disabled or the account is not a member of `tenant_slug`.
- Sign-in limits: 60/min per client across all addresses, checked before the password check, and
  10/min per client and address. Over either limit: 429 `RATE_LIMITED` with `Retry-After`.
- Rejected sign-ins are audited as `auth.login` with outcome `failure` or `denied` and a `reason`
  (`unknown_account`, `wrong_password`, `account_disabled`, `not_a_member_of_tenant`). Rows are capped
  without changing the 401: unknown accounts at 5/min per client and tenant and 30/min per tenant,
  known accounts at 10/min per account and tenant. Over a cap, only a warning is logged. A typed
  address that matches no account is never stored.

### Demo sign-in (implemented, DEMO_MODE only)
Both routes are public. `DEMO_MODE` defaults to false, and startup fails if it is true with
`APP_ENV=production`.
- `GET /auth/demo` → `{enabled: bool, personas: DemoPersona[]}`. With demo mode off:
  `{enabled: false, personas: []}`. A persona whose seeded account is missing or inactive is left out.
- `DemoPersona = {key: "engineer"|"operator"|"admin"|"auditor", title, display_name, email, summary, can: string[], cannot: string[]}`. Passwords are never returned.
- `POST /auth/demo` `{persona: string (1..40)}` → `Me & {token: null}` and sets the `rf_session`
  cookie. No password is needed. Limited to 30/min per client (429 `RATE_LIMITED`). Audited as
  `auth.demo_login`. With demo mode off: 404. Unknown or unseeded persona: 404
  `DEMO_PERSONA_NOT_FOUND`.
- `/auth/me` has no `is_demo` field. Clients detect a demo session by matching the email to a persona.

### Client address for rate limits
`ratelimit.client_ip` uses the connecting peer. `X-Forwarded-For` is read only when the peer is listed
in `TRUSTED_PROXY_IPS`, from the right, and the first address that is not a trusted proxy is the
client. Anything unusable falls back to the peer. See ADR-025.

### Collections (implemented)
- `GET /collections` → `Collection[]` (plain array). `POST /collections` `{name, description?, visibility?: "tenant"|"restricted"}` → 201 `Collection`.
- `GET|PATCH|DELETE /collections/{id}`.
- `Collection = {id, name, description, visibility, access_level: "read"|"write"|"manage"|null, document_count, created_at, updated_at}`

### Documents
- `POST /collections/{collection_id}/documents` multipart field `files` (one or more) → 201
  `{items: [{filename, status: "queued"|"duplicate"|"rejected", document_id|null, job_id|null, duplicate: bool, error: {code, message}|null}]}`
  Duplicates are checked before quota, so re-uploading a file into a full workspace reports
  `duplicate`. A crafted DOCX gives that file a `CORRUPT_FILE` rejection, not a failed batch. UTF-16
  text with a BOM is accepted; binary text without a BOM is rejected. Limited to 60/min per user.
- `GET /documents?collection_id=&status=&file_type=&q=&limit=&cursor=` → `{items: Document[], next_cursor}`
- `GET /documents/{id}` → `Document`
- `Document = {id, collection_id, collection_name, filename, file_type, mime_type, size_bytes, status: "queued"|"processing"|"indexed"|"failed"|"deleting"|"deleted", page_count, chunk_count, token_count, extraction_method, ocr_page_count, quality_score, warnings: string[], pipeline_version, embedding_model, uploaded_by, created_at, updated_at, indexed_at, latest_job: JobBrief|null}`
- `JobBrief = {id, job_type, status, stage, attempt_count, max_attempts, error_code, safe_error_message}`
- `GET /documents/{id}/pipeline` → `{document_id, status, jobs: [Job & {attempts: Attempt[], stages: StageRun[]}]}`
- `GET /documents/{id}/chunks?page=&limit=&cursor=` → `{items: [{id, chunk_index, page_start, page_end, token_count, text}], next_cursor}` (requires content access)
- `GET /documents/{id}/download` → the original file as an attachment (`application/octet-stream`). Requires `document:read_content` and read access. Audited as `document.download`.
- `POST /documents/{id}/retry` → 202 `{document_id, job_id, status: "queued"}`. Needs write access to
  the collection, or only read access for a caller with `job:manage`. 409 `NOT_RETRYABLE` unless the
  document is `failed`, or while it keeps `deleted_at` from a delete that failed. A document whose
  delete gave up with `deleted_at` cleared can still be retried; this is deliberate and is listed as an
  owner decision in PROGRESS.md.
- `DELETE /documents/{id}` → 202 `{document_id, job_id, status: "deleting"}`. Needs write access, then
  uploader, collection manager or org_admin. 409 `ALREADY_DELETING`. Calling it again on a document
  whose delete failed re-queues the delete.

### Jobs
- `GET /jobs?status=&job_type=&collection_id=&document_id=` → list of `Job`
- `GET /jobs/{id}` → `Job & {attempts: Attempt[], stages: StageRun[]}`
- `POST /jobs/{id}/retry`, `POST /jobs/{id}/cancel` → `Job`
- `POST /jobs/{id}/retry` returns 409 `INVALID_JOB_STATE`, with the specific reason as its message, for:
  a job that is not failed or cancelled; an ingest job whose document is no longer failed ("out of
  date"), so a healthy document is not taken out of search; an ingest job for a document that was
  deleted, or whose delete gave up; and a delete job whose document has since been re-processed.
- `Job = {id, job_type, status: "queued"|"running"|"retry_wait"|"succeeded"|"failed"|"cancelled", stage, document_id, document_filename, collection_id, attempt_count, max_attempts, priority, queued_at, available_at, started_at, finished_at, error_code, safe_error_message, correlation_id, cancel_requested}`
- `Attempt = {attempt_number, worker_id, status, stage, started_at, finished_at, error_code, safe_error_message}`
- `StageRun = {attempt_number, stage, status, started_at, finished_at, duration_ms, details: object, error_code}`

### Operations
- `GET /operations/summary` → `{jobs: {queued, running, retry_wait, succeeded, failed, cancelled}, queue_depth, oldest_queued_age_seconds, documents: {queued, processing, indexed, failed, deleting}, indexed_chunks, workers: {total, healthy, stale}, generated_at}`
- `GET /operations/workers` → `{items: [{worker_id, hostname, status, health: "healthy"|"stale"|"stopped", current_job_id|null, jobs_succeeded, jobs_failed, started_at, last_heartbeat_at, version}]}`.
  Workers serve every tenant, so `jobs_succeeded`, `jobs_failed` and `current_job_id` cover the
  caller's tenant only. A worker busy only on another tenant's job reports `status: "idle"`.
- `GET /operations/metrics?window=1h|24h|7d` → `{window_seconds, buckets: [{start, succeeded, failed}], avg_job_duration_ms, p95_job_duration_ms, error_rate, stage_durations_ms: {<stage>: number}}`

### Chat
- `POST /chat/sessions` `{title?, collection_ids: uuid[] (1..50)}` → 201 `Session`
- `GET /chat/sessions?limit=` (default 50, max 200) → `{items: Session[], next_cursor: null}`, newest
  activity first. `next_cursor` is always null: this list has no further pages.
- `GET /chat/sessions/{id}` → `{session: Session, messages: Message[]}`
- `PATCH /chat/sessions/{id}` `{title?: string (1..200), collection_ids?: uuid[] (1..50)}` → `Session`.
  Owner only (anyone else gets 404), permission `chat:use`. Does not change `updated_at`. Every
  collection must be accessible (404 `COLLECTION_NOT_FOUND`); a blank title is 422. Audited as
  `chat.session.rename` (title) and `chat.session.update` (collections), counts only.
- `DELETE /chat/sessions/{id}` → 204. Owner only (404 otherwise), permission `chat:use`. Removes
  the messages and their citations; documents are not affected. Audited as `chat.session.delete`.
- `POST /chat/sessions/{id}/messages` `{message: string (1..4000, no NUL), collection_ids?}` →
  `{message_id, user_message_id, answer, evidence_status: "supported"|"insufficient", citations: Citation[], model: {provider, name, deployment_mode}, latency_ms, retrieved_count}`.
  Without `collection_ids` the session's stored collections are used, minus any that were deleted
  or are no longer accessible; 404 `SESSION_SCOPE_EMPTY` only when none remain. An explicit
  `collection_ids` override must be fully accessible (404 `COLLECTION_NOT_FOUND`). Limited to 30/min
  per user.
  - Model failures: `MODEL_OVERLOADED` (503, also for a provider's 429), `MODEL_UNAVAILABLE` (503),
    `MODEL_MISCONFIGURED` (503), `MODEL_TIMEOUT` (504), `MODEL_REFUSED` (422). Chat does not retry a
    busy model; only evaluation runs do (ADR-024).
  - `insufficient` answers have no citations. `retrieved_count` says whether related passages were
    found (`> 0`) or none (`0`).
  - There is no way to cancel a request on the server. A client that stops waiting still gets the
    question and answer saved to the session.
- `Session = {id, title, collection_ids, created_at, updated_at}`
- `Message = {id, role: "user"|"assistant", content, evidence_status|null, citations: Citation[], model: {provider, name}|null, latency_ms|null, created_at, retrieved_count: int|null, content_withheld: bool}`
- `Citation = {marker, document_id|null, filename, page|null, chunk_id|null, quote, score|null, document_deleted: bool}`
  - `marker` counts this answer's own sources, numbered 1..n in order of appearance. Markers that do
    not refer to a retrieved source are removed.
  - `page` is a real page for PDFs only. It is `null` for DOCX, TXT and Markdown, including citations
    saved when those formats still stored page 1.
- `POST /retrieval/inspect` `{query, collection_ids?}` → `{items: [{chunk_id, document_id, filename, page_start, page_end, score, text}]}` (permission `retrieval:inspect`; shares the chat limit)

#### Stored citations and withheld answers (`GET /chat/sessions/{id}`)
Stored citations are re-authorised on every read (ADR-009). For each citation:

| Situation | Citation returned | Message |
|---|---|---|
| Document exists, caller has access | As stored, `document_deleted: false` | Unchanged |
| Document `deleting` or `deleted`, collection still accessible | Tombstone filename, stored `page` and `quote`, `chunk_id: null`, `document_deleted: true` | Unchanged |
| Document record is gone (for example its collection was deleted) | Marker only: `document_id`, `page`, `chunk_id`, `score` null, `filename` and `quote` empty, `document_deleted: true` | **Withheld** |
| Caller no longer has access to the collection | Left out | **Withheld** |

A withheld message has `content_withheld: true`, `evidence_status: null`, and `content` set to the
fixed note in `ANSWER_WITHHELD_NOTE`. The original text is hidden because an answer can be verbatim
document text. If access returns, the message is shown as before.

The live answer from `POST .../messages` always has `document_deleted: false`.

### Models
- `GET /models` → `{items: [{provider, name, deployment_mode, is_default, timeout_seconds, max_concurrency}]}`
- `GET /models/health` → `{ok, provider, model, deployment_mode, detail, latency_ms}`
- `GET /models/metrics?window=1h` → `{window_seconds, requests, errors, timeouts, error_rate, avg_latency_ms, p95_latency_ms, prompt_tokens, completion_tokens}`

### Logical infrastructure (implemented)
All routes are under `/infrastructure`. Reads need `infra:read`, writes need `infra:manage`. Every
record carries `state_source`; clients may set only `manual` or `simulated` (ADR-020).
- `GET /overview` → `{racks, nodes, workloads: {<state_source>: count}, platform_processes, note}`
- `GET /racks` → `{items: Rack[]}`; `POST /racks` → 201 `Rack`; `GET /racks/{id}` → `Rack & {nodes, workloads}`; `PATCH /racks/{id}` → `Rack`
- `GET /nodes` → `{items: Node[]}`; `POST /nodes` → 201 `Node`; `PATCH /nodes/{id}` → `Node`
- `GET /workloads` → `{items: Workload[]}`; `POST /workloads` → 201 `Workload`; `PATCH /workloads/{id}` → `Workload`
- `DELETE /racks/{id}` → 204. 409 `RACK_NOT_EMPTY` while it has nodes. Audited as `infra.rack.delete`.
- `DELETE /nodes/{id}` → 204. 409 `NODE_HAS_WORKLOADS` while it has workloads. Audited as `infra.node.delete`.
- `DELETE /workloads/{id}` → 204. Audited as `infra.workload.delete`.
- All three deletes return 409 `INTEGRATION_MANAGED` for an `integration` record. They remove a record
  only: nothing is stopped, undeployed or touched on any hardware.
- PATCH applies every field it names. An explicit `null` returns 422 for fields that cannot be empty:
  rack `name`, `environment`, `description`, `status`; node `name`, `status`; workload `desired_state`,
  `observed_state`, `resource_request`. Rack `location_label`, node `rack_id`, `rack_unit_position`,
  capacity fields and `accelerator_info`, and workload `node_id` can be cleared with `null`.
- `Capacity = {cpu_cores: float, memory_bytes, storage_bytes, accelerators}`. Allocated CPU may be
  fractional, rounded to 3 places. Allocation is the sum of requests, not measured usage.

### Evaluation (implemented)
- `GET /evaluation/datasets` → `Dataset[]` (`eval:read`)
- `POST /evaluation/datasets/{version}/seed` → `{main_collection_id, restricted_collection_id, queued, duplicates, rejected: string[]}` (`eval:run` and `collection:create`; idempotent)
- `POST /evaluation/runs` `{dataset_version?, collection_ids: uuid[] (1..20)}` → 202 `Run` (`eval:run`)
- `GET /evaluation/runs?limit=` → `Run[]`; `GET /evaluation/runs/{id}` → `Run & {results}` (`eval:read`)
- `Run.status`: `queued`, `running`, `completed`, `completed_with_errors`, `failed`, `cancelled`.
  - `completed_with_errors` means the job finished, but at least one question errored, for example
    `{id, category, error: "MODEL_OVERLOADED"}`. `metrics.errors` holds the count and the other figures
    leave those questions out, so **the scores must not be headlined as a clean result**. Runs from
    before this status existed show `completed` with `metrics.errors > 0`.
  - `failed` and `cancelled` come from the job ending that way.
- `results` depend on the reader, because a run's answers were produced with its creator's access:
  - `question` and `answer` appear only if the reader has content access to **every** collection the
    run searched.
  - `retrieved_docs` and `cited_docs` (filenames, metadata) are also hidden unless the reader can see
    every such collection. Auditors keep filenames and never see questions or answers.
  - A run over a deleted collection, or with no recorded collections, shows none of these fields.
