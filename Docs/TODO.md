# Implementation TODO and Milestones

The coding agent must implement in order. Do not mark a task complete until code exists, tests pass, and documentation is updated.

Status vocabulary (3-day sprint): **VERIFIED** (tests/functional checks passed) · **IMPLEMENTED — NOT VERIFIED** (code exists; no passing check yet) · **PARTIALLY COMPLETE** · **IN PROGRESS** · **BLOCKED** · **NOT STARTED** · **DEFERRED** (owner/ADR decision). Checkbox legend kept for compatibility: `[x]` verified, `[~]` partial / not verified, `[ ]` not started, `[!]` blocked, `[-]` deferred.

_Last updated: 2026-10-27, end of sprint Day 1. Evidence: Docs/TESTING.md "Results log"._

## Phase 0 — Repository and decisions
- [x] VERIFIED — Inspect workspace and preserve existing user work (only `Docs/` existed).
- [-] DEFERRED — Clean development environment: owner accepted the host risk (ADR-013).
- [x] VERIFIED — Repository structure (adapted layout, ADR-016: `backend/` Python package + `apps/web`).
- [x] VERIFIED — `.env.example`; `.env` git-ignored; no secrets committed.
- [x] VERIFIED — Pinned versions (`backend/uv.lock`, exact versions in `apps/web/package.json` + lockfile).
- [~] PARTIALLY COMPLETE — Formatter/linter/type checker: ruff, mypy, ESLint, tsc pass locally. CI workflow written but not yet run (repo not pushed). No pre-commit hooks.
- [x] VERIFIED — DECISIONS.md entries for queue, auth, storage, vector DB, model provider (ADR-005…016).
- [x] VERIFIED — PROGRESS.md updated.

## Phase 1 — Local foundation
- [~] IMPLEMENTED — NOT VERIFIED — Docker Compose for PostgreSQL, Qdrant, API, worker, web (no Docker on host; CI job pending). Redis not used (ADR-005).
- [x] VERIFIED — FastAPI health/readiness endpoints.
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Next.js app shell, navigation, design tokens, responsive layout. Build/lint/typecheck pass; pages served over HTTP; not inspected in a browser.
- [x] VERIFIED — DB migrations (Alembic) and configuration validation.
- [x] VERIFIED — Request/correlation IDs and structured JSON logging.
- [x] VERIFIED — Startup and troubleshooting documentation (README; commands run on host).
- [x] VERIFIED — Smoke test for stack startup and end-to-end flow (`scripts/dev/smoke_e2e.py`).
- [x] VERIFIED — PROGRESS.md updated.

## Phase 2 — Authentication, tenancy, RBAC
- [x] VERIFIED — Authentication: local accounts (argon2id), server-side hashed session tokens, CSRF header (ADR-006).
- [x] VERIFIED — Tenant/workspace membership; tenant derived from session.
- [x] VERIFIED — Roles org_admin, operator, engineer, auditor with explicit permission matrix.
- [x] VERIFIED — Server-side permission dependency (`require(Permission.X)`).
- [~] PARTIALLY COMPLETE — Tenant isolation tests: collections, documents, chunks, chat, retrieval verified; jobs/operations/admin endpoints pending.
- [~] PARTIALLY COMPLETE — Audit events: login, collection, document, job, inspector actions recorded; admin/role-change endpoints not built yet.
- [ ] NOT STARTED — Admin user management and collection-permission grant APIs + UI.
- [x] VERIFIED — PROGRESS.md updated.

## Phase 3 — Document ingestion and processing
- [x] VERIFIED — Upload API (multi-file) for PDF, TXT, Markdown, DOCX.
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Upload UI with progress and per-file results.
- [x] VERIFIED — Size/extension/content-signature checks, safe filenames, zip-bomb and macro rejection.
- [~] PARTIALLY COMPLETE — Local object storage verified; S3-compatible adapter NOT STARTED.
- [x] VERIFIED — Document metadata and content-hash deduplication.
- [x] VERIFIED — Durable queued jobs and visible state machine.
- [x] VERIFIED — Text extraction for supported formats.
- [x] VERIFIED — OCR for image-only PDF pages (RapidOCR).
- [x] VERIFIED — Extraction-quality checks and warnings.
- [x] VERIFIED — Conservative cleaning; token counting (approximate tokenizer, documented).
- [x] VERIFIED — Chunking with overlap and page/offset metadata.
- [x] VERIFIED — Retry/backoff, attempt history, idempotent stages, failure handling.
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Processing status UI; integration tests VERIFIED.
- [x] VERIFIED — PROGRESS.md updated.

## Phase 4 — Embeddings, vector index, retrieval
- [x] VERIFIED — Embedding and vector-store interfaces.
- [x] VERIFIED — Local FastEmbed provider with model/version metadata.
- [x] VERIFIED — Qdrant adapter with mandatory tenant/collection/document filters.
- [x] VERIFIED — Idempotent upsert (vector id = chunk id) and deletion cleanup.
- [x] VERIFIED — Authorized top-k retrieval, similarity threshold, PostgreSQL re-validation.
- [ ] NOT STARTED — Optional hybrid retrieval/reranking.
- [~] PARTIALLY COMPLETE — Retrieval inspector: API verified (operator/admin only); UI not visually verified.
- [x] VERIFIED — Cross-tenant and cross-collection isolation tests.
- [x] VERIFIED — PROGRESS.md updated.

## Phase 5 — RAG chat and citations
- [x] VERIFIED — Chat model provider interface and configurable endpoint (Claude, OpenAI-compatible, extractive).
- [x] VERIFIED — Context builder with token budget and deduplication.
- [x] VERIFIED — Grounded prompt treating retrieved content as untrusted data.
- [x] VERIFIED — Answer + citation schema; invented citations dropped.
- [x] VERIFIED — Insufficient-evidence behaviour.
- [~] PARTIALLY COMPLETE — Conversation history VERIFIED; retention policy NOT STARTED.
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Chat UI and citation source viewer.
- [x] VERIFIED — RAG end-to-end tests (API + live smoke).
- [x] VERIFIED — PROGRESS.md updated.

## Phase 6 — Operations and workload management
- [~] IMPLEMENTED — NOT VERIFIED — Job queue dashboard and filters (UI built; jobs API not yet HTTP-tested).
- [~] IMPLEMENTED — NOT VERIFIED — Job detail/attempt timeline and retry/cancel actions (queue semantics verified; endpoints not yet HTTP-tested).
- [~] PARTIALLY COMPLETE — Worker heartbeat (written by workers) and queue-depth metrics; operations endpoints not yet tested.
- [x] VERIFIED — Bounded retries, exponential backoff with jitter, terminal failure handling.
- [~] PARTIALLY COMPLETE — Worker scaling documented (start more processes / `--scale worker=N`); no load test.
- [ ] NOT STARTED — Load balancer/API deployment guidance.
- [x] VERIFIED — Worker termination/recovery (real process kill test).
- [ ] NOT STARTED — Explicit duplicate-delivery test for the ingestion handler.
- [x] VERIFIED — PROGRESS.md updated.

## Phase 7 — Model serving and evaluation
- [x] VERIFIED — Model endpoint configuration and health checks.
- [~] PARTIALLY COMPLETE — Timeouts, safe errors and request metrics verified; concurrency limiter not tested.
- [ ] NOT STARTED — Evaluate candidate small model (no local LLM runtime installed; Qwen2.5 via Ollama possible).
- [ ] NOT STARTED — Repeatable test questions with expected evidence sources.
- [ ] NOT STARTED — Retrieval recall, citation correctness, groundedness, latency measurement.
- [ ] NOT STARTED — Model comparison report.

## Phase 8 — Infrastructure / logical rack management
- [~] PARTIALLY COMPLETE — Data model (racks, nodes, workloads with provenance) migrated; APIs NOT STARTED.
- [ ] NOT STARTED — Manual registration and seeded simulated demo data.
- [ ] NOT STARTED — Rack overview and detail UI.
- [ ] NOT STARTED — Resource display with Configured/Simulated/Integration-reported labels.
- [ ] NOT STARTED — Workload placement and utilisation views.
- [x] VERIFIED — No hardware control in MVP (no such code exists; ADR-002).
- [ ] NOT STARTED — Role and audit tests for infrastructure changes.

## Phase 9 — Monitoring, security, enterprise hardening
- [~] PARTIALLY COMPLETE — Operational metrics (summary, throughput chart, model metrics).
- [ ] NOT STARTED — OpenTelemetry-compatible tracing.
- [~] PARTIALLY COMPLETE — Rate limits (in-process, per API replica) for login/upload/chat; tenant storage quota implemented, untested; retention/deletion policy NOT STARTED.
- [~] PARTIALLY COMPLETE — Prompt-injection, file-parser, path-traversal, CSRF reviewed and tested; SSRF not applicable (no URL fetching); CORS restricted to WEB_ORIGIN.
- [x] VERIFIED — All vector search paths apply authorization filters (single retrieval path + PostgreSQL re-check).
- [ ] NOT STARTED — Dependency/security scanning and CI test gates.
- [ ] NOT STARTED — Backup/restore and disaster recovery runbook.

## Phase 10 — Release and deployment
- [ ] NOT STARTED — Staging/prod deployment instructions.
- [ ] NOT STARTED — Production secrets and storage configuration.
- [~] PARTIALLY COMPLETE — Migrations run via Alembic (upgrade verified); rollback not documented/tested.
- [ ] NOT STARTED — Full tests and load tests on declared hardware.
- [ ] NOT STARTED — Accessibility and responsive UI checks.
- [ ] NOT STARTED — Release notes and known limitations.
- [ ] NOT STARTED — Installation from a clean environment.

## Rules
- Never skip ahead because a UI mock looks complete.
- Never mark a feature complete based only on placeholder screens.
- Any task that cannot be completed must be marked `[!]` with the blocker.
- Any scope change must be recorded in `DECISIONS.md` before implementation.
