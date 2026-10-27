# Implementation TODO and Milestones

The coding agent must implement in order. Do not mark a task complete until code exists, tests pass, and documentation is updated.

Legend: `[ ]` not started, `[x]` completed, `[!]` blocked, `[-]` intentionally deferred.

## Phase 0 — Repository and decisions
- [x] Inspect workspace and preserve any existing user work. (2026-10-27: only `Docs/` exists; see PROGRESS.md audit entry.)
- [!] Provide a clean development environment. Blocked: current host failed security check (ADR-013).
- [ ] Create repository structure from `ARCHITECTURE.md`.
- [ ] Create `.env.example`; never commit secrets.
- [ ] Pin compatible dependency versions and document why.
- [ ] Add formatter, linter, type checker, pre-commit/CI basics.
- [ ] Add `DECISIONS.md` entries for chosen queue, auth strategy, storage, vector DB, model provider.
- [ ] Update `PROGRESS.md`.

## Phase 1 — Local foundation
- [ ] Add Docker Compose for PostgreSQL, Redis, Qdrant, API, worker, web.
- [ ] Add FastAPI health/readiness endpoints.
- [ ] Add Next.js app shell, navigation, design tokens, responsive layout.
- [ ] Add DB migrations and configuration validation.
- [ ] Add request/correlation IDs and structured logging.
- [ ] Add startup and troubleshooting documentation.
- [ ] Add smoke tests for stack startup and health.
- [ ] Update `PROGRESS.md`.

## Phase 2 — Authentication, tenancy, RBAC
- [ ] Implement authentication using a secure, documented strategy.
- [ ] Implement tenant/workspace membership.
- [ ] Implement roles: org_admin, operator, engineer, auditor.
- [ ] Add server-side permission dependency/middleware.
- [ ] Add tenant isolation tests for all tenant-owned entities.
- [ ] Add audit events for admin and permission changes.
- [ ] Update `PROGRESS.md`.

## Phase 3 — Document ingestion and processing
- [ ] Implement upload API and UI for PDF, TXT, Markdown, DOCX.
- [ ] Enforce size/MIME/extension limits and safe filenames.
- [ ] Store files locally in development; support S3-compatible adapter.
- [ ] Create document metadata and content-hash deduplication.
- [ ] Add durable queued jobs and visible state machine.
- [ ] Implement text extraction for supported formats.
- [ ] Add optional OCR provider for scanned PDFs.
- [ ] Add extraction-quality checks and clear warnings.
- [ ] Implement conservative cleaning and token counting.
- [ ] Implement chunking with overlap and metadata preservation.
- [ ] Add retry/backoff, attempt history, idempotency, and failure handling.
- [ ] Add processing status UI and integration tests.
- [ ] Update `PROGRESS.md`.

## Phase 4 — Embeddings, vector index, retrieval
- [ ] Define embedding and vector-store interfaces.
- [ ] Implement selected embedding provider and version metadata.
- [ ] Implement Qdrant adapter with tenant/collection/document filters.
- [ ] Implement idempotent upsert and deletion cleanup.
- [ ] Implement authorized top-k retrieval and similarity threshold.
- [ ] Add optional hybrid retrieval/reranking only after baseline tests.
- [ ] Add retrieval inspector restricted to authorized roles.
- [ ] Test cross-tenant and cross-collection isolation.
- [ ] Update `PROGRESS.md`.

## Phase 5 — RAG chat and citations
- [ ] Define chat model provider interface and configurable model endpoint.
- [ ] Implement context builder with token budget and deduplication.
- [ ] Implement grounded prompt with retrieved content treated as untrusted data.
- [ ] Implement answer plus source citation schema.
- [ ] Add insufficient-evidence behavior.
- [ ] Add conversation history and retention policy.
- [ ] Build chat UI and citation source viewer.
- [ ] Add RAG end-to-end tests.
- [ ] Update `PROGRESS.md`.

## Phase 6 — Operations and workload management
- [ ] Build job queue dashboard and filters.
- [ ] Build job detail/attempt timeline and safe retry/cancel actions.
- [ ] Add worker heartbeat/health and queue-depth metrics.
- [ ] Add bounded retries, exponential backoff, dead-letter/terminal failure handling.
- [ ] Add worker replica scaling documentation and load test.
- [ ] Add load balancer/API deployment guidance.
- [ ] Test worker termination/recovery and duplicate delivery.
- [ ] Update `PROGRESS.md`.

## Phase 7 — Model Serving and evaluation
- [ ] Implement model endpoint configuration and health checks.
- [ ] Add request timeouts, concurrency limits, request metrics, safe errors.
- [ ] Evaluate candidate small model (including Qwen2.5-0.5B-Instruct only if license/hardware fit).
- [ ] Create repeatable test questions with expected evidence sources.
- [ ] Measure retrieval recall/relevance, citation correctness, groundedness, latency.
- [ ] Add model comparison report; do not claim production readiness without evidence.
- [ ] Update `PROGRESS.md`.

## Phase 8 — Infrastructure / logical rack management
- [ ] Add logical rack, node/resource, workload-placement data model and APIs.
- [ ] Add manual registration and seeded simulated demo data.
- [ ] Build rack overview and rack detail UI.
- [ ] Display CPU/RAM/GPU/storage only when values exist; label simulated/configured/integration-reported.
- [ ] Show workload placement and resource utilization trends where measured.
- [ ] Keep hardware control out of MVP.
- [ ] Add role and audit tests for infrastructure changes.
- [ ] Update `PROGRESS.md`.

## Phase 9 — Monitoring, security, enterprise hardening
- [ ] Add operational metrics and dashboard charts.
- [ ] Add OpenTelemetry-compatible tracing where practical.
- [ ] Add rate limits, upload quotas, retention/deletion policy.
- [ ] Review prompt injection, file parser risks, SSRF, path traversal, secrets, CORS, CSRF as relevant.
- [ ] Verify all vector search paths apply authorization filters.
- [ ] Add dependency/security scanning and CI test gates.
- [ ] Add backup/restore and disaster recovery runbook.
- [ ] Update `PROGRESS.md`.

## Phase 10 — Release and deployment
- [ ] Write staging/prod deployment instructions.
- [ ] Configure production secrets and storage; no secrets in image/build args.
- [ ] Run migrations safely and document rollback.
- [ ] Run full tests and load tests on declared hardware.
- [ ] Run accessibility and responsive UI checks.
- [ ] Create release notes and known-limitations section.
- [ ] Verify installation from a clean environment.
- [ ] Update `PROGRESS.md` with evidence and remaining risks.

## Rules
- Never skip ahead because a UI mock looks complete.
- Never mark a feature complete based only on placeholder screens.
- Any task that cannot be completed must be marked `[!]` with the blocker.
- Any scope change must be recorded in `DECISIONS.md` before implementation.
