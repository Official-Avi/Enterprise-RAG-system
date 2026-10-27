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
- `GET /health/ready` — dependency readiness; no secrets in response.

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
- Apply rate limits to uploads and chat.
- Add correlation IDs to responses/logs.
- Add OpenAPI docs, but do not expose administrative endpoints publicly without authorization.
