# Architecture Decision Log

Record decisions here before making changes that affect architecture or scope.

## ADR-001 — Modular monolith first
**Status:** Accepted baseline  
**Decision:** Start with a modular monolith API plus independent asynchronous workers.  
**Reason:** Easier to build, test, and operate for an MVP while preserving module boundaries.  
**Revisit when:** Team ownership, deployment isolation, or measured load justifies service extraction.

## ADR-002 — Logical rack interface in MVP
**Status:** Accepted baseline  
**Decision:** Model racks/nodes/workload placement as software inventory and label state provenance. No direct physical hardware control.  
**Reason:** Enables enterprise rack-oriented UX without falsely claiming hardware integrations.

## ADR-003 — Provider abstractions
**Status:** Accepted baseline  
**Decision:** Abstract embedding, vector DB, OCR, chat model, object storage, and queue providers.  
**Reason:** Avoid lock-in and enable local development/test providers.

## ADR-004 — Candidate small model
**Status:** Experiment only  
**Decision:** Qwen2.5-0.5B-Instruct may be benchmarked as a prototype model. It is not the mandatory or production default.  
**Reason:** Small parameter count can lower resource needs, but answer quality and concurrency must be measured. Verify license, hardware, language quality, and runtime compatibility before use.

## ADR-005 — Queue/worker semantics
**Status:** To be finalized in Phase 0  
**Decision required:** Select Celery or RQ and document delivery, persistence, retry, and recovery semantics.  
**Owner:** Coding agent/project team  
**Acceptance:** Integration test proves worker crash/retry and idempotent processing.

## ADR-006 — Authentication strategy
**Status:** To be finalized in Phase 0  
**Decision required:** Select secure session-based auth or a maintained OIDC-compatible provider/library.  
**Acceptance:** Role and tenant isolation tests pass; no custom cryptography.

## Proposed during the 2026-10-27 audit (3-day sprint)

### ADR-005 — Durable job queue on PostgreSQL (supersedes the Celery/Redis proposal)
- Status: Accepted 2026-10-27 — final acceptance when the worker-crash/retry/idempotency integration test passes.
- Context: The development host is Windows without Docker or admin rights. Celery does not support native Windows workers, RQ requires `fork()`, and Redis has no supported native Windows build. The README lists Redis + Celery/RQ as *proposed* defaults.
- Decision: `ProcessingJob` rows are both the authoritative state and the queue. Workers claim jobs with `SELECT … FOR UPDATE SKIP LOCKED`, hold a time-bounded lease renewed by heartbeat, and record every attempt in `JobAttempt`. Expired leases are reclaimed (crash recovery). Jobs are inserted in the same transaction as the document row (outbox-safe). Payloads carry IDs only.
- Alternatives: Celery + Redis (documented default; needs Linux containers), RQ (no Windows support).
- Consequences: One fewer infrastructure dependency; queue throughput is bounded by PostgreSQL (adequate for ingestion workloads; revisit with load tests). The `JobQueue` boundary (`rackflow.jobs`) allows a Celery/Redis transport later without changing handlers.

### ADR-014 — Local services without Docker; Docker Compose for deployment
- Status: Accepted 2026-10-27
- Decision: On the Windows development host, PostgreSQL 18 and Qdrant 1.20 run from portable binaries (`scripts/dev/start-services.ps1`, data under `.data/`, bound to 127.0.0.1). `docker-compose.yml` and Dockerfiles are maintained for Linux deployment and verified in CI (GitHub Actions), not on this host.
- Note: use `127.0.0.1`, not `localhost` — on this host IPv6 `::1` connections hang instead of being refused.

### ADR-015 — OCR provider: RapidOCR (ONNX) by default
- Status: Accepted 2026-10-27 (amends ADR-012)
- Decision: `rapidocr-onnxruntime` (Apache-2.0; pip-installable, no system binary) renders OCR for image-only PDF pages rendered with `pypdfium2`. Tesseract remains a possible alternative adapter behind `OCRProvider`.

### ADR-006 (proposal) — Local accounts + server-side sessions; OIDC adapter later
- Status: Proposed — awaiting owner confirmation that enterprise SSO is not required for the MVP.
- Decision: email/password accounts hashed with argon2id (`argon2-cffi`); opaque random session tokens stored hashed in PostgreSQL; delivered as `HttpOnly`, `Secure`, `SameSite=Lax` cookie through a same-origin web proxy; CSRF mitigated by required custom header on state-changing requests. Tenant is resolved from `TenantMembership`, never from request bodies. User invitations by email are deferred; admins create users directly.
- Alternatives: Keycloak/OIDC now (stronger enterprise story, ~half a day of setup and test-harness work).

### ADR-007 — Sprint execution mode and phase reordering
- Status: Proposed (owner sprint brief, 2026-10-27)
- Context: `AGENT_INSTRUCTIONS.md`/`README.md` require stopping after Phase 0/1 for review; the owner's 3-day sprint brief directs continuous autonomous delivery.
- Decision: For this sprint, work continuously and report at each Day gate. Build the full tenant-scoped schema and minimal real authentication on Day 1 *before* ingestion, so retrieval is permission-filtered from the first commit (avoids retrofitting). Full RBAC matrix, collection permissions, admin UI and audit land on Day 2.

### ADR-008 — Canonical names (resolves conflicts between documents)
- Status: Proposed
- Job states: `queued`, `running`, `retry_wait`, `succeeded`, `failed`, `cancelled` (PRD FR-041). "completed"/"retrying" in PRD Journey C are prose aliases; "dead-letter" means terminal `failed` plus an operator-visible event.
- `state_source`: `manual`, `simulated`, `integration`. UI badges: manual→Configured, simulated→Simulated, integration→Integration-reported, missing→Unknown.
- "Workspace" (API/UI) = `Tenant` (data model). `GET /workspaces` returns the caller's memberships.
- "Chat session" (API) = `Conversation` (data model).

### ADR-009 — Asynchronous document deletion
- Status: Proposed
- Decision: `DELETE /documents/{id}` returns 202, marks the document `deleting`, excludes it from retrieval immediately (PostgreSQL re-check after vector search), and enqueues a retryable deletion job (vectors → object storage → rows). Stored citations referencing deleted or no-longer-authorized documents are re-authorized on read and hidden if access is gone.

### ADR-010 — Tenant-scoped operations views
- Status: Proposed
- Decision: All roles are tenant-scoped. Job/queue views return only the caller's tenant data. Worker health is shown without tenant-identifying details. No cross-tenant "platform operator" role in the MVP.

### ADR-011 — Model and embedding providers
- Status: Awaiting owner decision (data egress, cost, keys)
- Proposal: embeddings run locally (`fastembed` with `BAAI/bge-small-en-v1.5`, 384-d, no document egress). Chat model behind `ChatModelProvider` with three adapters: hosted API (Anthropic Claude), OpenAI-compatible endpoint (Ollama/vLLM, for Qwen2.5 experiments per ADR-004), and a deterministic mock clearly labelled for CI only.

### ADR-012 — Document parsing libraries (licence-aware)
- Status: Proposed
- Decision: `pypdf` (BSD) for text-layer PDFs, `pypdfium2` (Apache-2.0/BSD) to render pages for OCR, Tesseract (Apache-2.0) for OCR inside the worker image, `python-docx` (MIT) for DOCX. Avoid PyMuPDF (AGPL) to keep enterprise licensing clean.

### ADR-013 — Development host
- Status: Owner accepted risk 2026-10-27 — development proceeds on this host. Owner was informed of the malware findings and chose to continue. Mitigations: no secrets committed; `.env` git-ignored; services bound to 127.0.0.1.
- Original status: Blocked — awaiting owner
- Context: The 2026-10-27 environment audit found the current Windows host has active Microsoft Defender malware detections and real-time protection disabled; Python executables are missing/damaged.
- Decision: Do not install toolchains, run builds, or place credentials on this host. Development resumes in a clean Linux environment with Docker (cleaned/reimaged host, separate machine, or cloud dev environment).

## Change template
### ADR-XXX — Title
- Status: Proposed / Accepted / Superseded
- Context:
- Decision:
- Alternatives:
- Consequences:
- Tests/evidence:
