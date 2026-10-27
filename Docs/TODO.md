# Implementation TODO and Milestones

The coding agent must implement in order. Do not mark a task complete until code exists, tests pass, and documentation is updated.

Status vocabulary (3-day sprint): **VERIFIED** (tests/functional checks passed) · **IMPLEMENTED — NOT VERIFIED** (code exists; no passing check yet) · **PARTIALLY COMPLETE** · **IN PROGRESS** · **BLOCKED** · **NOT STARTED** · **DEFERRED** (owner/ADR decision). Checkbox legend kept for compatibility: `[x]` verified, `[~]` partial / not verified, `[ ]` not started, `[!]` blocked, `[-]` deferred.

_Last updated: 2026-10-27, end of sprint Day 2. Evidence: Docs/TESTING.md "Results log"._

## Phase 0 — Repository and decisions
- [x] VERIFIED — Inspect workspace and preserve existing user work (only `Docs/` existed).
- [-] DEFERRED — Clean development environment: owner accepted the host risk (ADR-013).
- [x] VERIFIED — Repository structure (adapted layout, ADR-016: `backend/` Python package + `apps/web`).
- [x] VERIFIED — `.env.example`; `.env` git-ignored; no secrets committed.
- [x] VERIFIED — Pinned versions (`backend/uv.lock`, exact versions in `apps/web/package.json` + lockfile).
- [x] VERIFIED — Formatter/linter/type checker + CI: ruff, mypy, ESLint, tsc and tests run in GitHub Actions (green). No pre-commit hooks.
- [x] VERIFIED — DECISIONS.md entries for queue, auth, storage, vector DB, model provider (ADR-005…016).
- [x] VERIFIED — PROGRESS.md updated.

## Phase 1 — Local foundation
- [x] VERIFIED (CI) — Docker Compose for PostgreSQL, Qdrant, migrate, API, worker, web: built and health-checked by the `compose-smoke` CI job. Redis not used (ADR-005).
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
- [x] VERIFIED — Tenant isolation tests: collections, documents, chunks, chat, retrieval, jobs, operations, admin, audit, infrastructure, evaluation.
- [x] VERIFIED — Audit events for logins, members/roles, grants, collections, documents, jobs, settings, infrastructure, evaluation; audit log API + UI (UI not browser-inspected).
- [x] VERIFIED (API) — Member management (add, role change, remove, last-admin guard) and collection grants; UI built (not browser-inspected). Email invitations DEFERRED (ADR-019).
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
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Job queue dashboard and filters; jobs API VERIFIED over HTTP.
- [x] VERIFIED (API) — Job detail/attempt timeline and retry/cancel actions with permission and state checks; UI not browser-inspected.
- [x] VERIFIED — Worker heartbeat, queue depth, summary counts matching the database, throughput/latency metrics.
- [x] VERIFIED — Bounded retries, exponential backoff with jitter, terminal failure handling.
- [~] PARTIALLY COMPLETE — Worker scaling documented (start more processes / `--scale worker=N`); no load test.
- [ ] NOT STARTED — Load balancer/API deployment guidance.
- [x] VERIFIED — Worker termination/recovery (real process kill test).
- [x] VERIFIED — Duplicate delivery of the same ingestion job creates no duplicate chunks or vectors.
- [x] VERIFIED — PROGRESS.md updated.

## Phase 7 — Model serving and evaluation
- [x] VERIFIED — Model endpoint configuration and health checks.
- [x] VERIFIED — Timeouts, safe errors, request metrics and the concurrency limiter.
- [ ] NOT STARTED — Evaluate candidate small model (no local LLM runtime installed; Qwen2.5 via Ollama possible).
- [x] VERIFIED — Versioned dataset v1: 13 labelled questions across 7 categories (factual, multi-chunk, conflicting versions, no-answer, prompt injection, scanned OCR, restricted).
- [x] VERIFIED — Deterministic runner (job-based) measuring hit rate, MRR, citation precision/correctness, term recall, abstention, injection resistance, restricted leakage, latency (ADR-021). Groundedness beyond citation checks not measured.
- [~] PARTIALLY COMPLETE — Baseline report for the extractive (no-LLM) provider recorded in TESTING.md; no LLM compared yet (no key/local model configured).

## Phase 8 — Infrastructure / logical rack management
- [x] VERIFIED — Logical rack, node/resource and workload-placement APIs with provenance rules (ADR-020).
- [x] VERIFIED — Manual registration and `seed-infra` simulated demo data (labelled).
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Rack overview and detail UI (front view, node cards); pages served.
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Provenance badges on every rack/node/workload; API provenance VERIFIED.
- [~] IMPLEMENTED — NOT VERIFIED (visual) — Workload placement and requested-vs-capacity allocation (not measured usage).
- [x] VERIFIED — No hardware control in MVP (no such code exists; ADR-002).
- [x] VERIFIED — Role and audit tests for infrastructure changes.

## Phase 9 — Monitoring, security, enterprise hardening
- [~] PARTIALLY COMPLETE — Operational metrics (summary, throughput chart, model metrics).
- [ ] NOT STARTED — OpenTelemetry-compatible tracing.
- [~] PARTIALLY COMPLETE — Rate limits (in-process, per API replica) for login/upload/chat; tenant storage quota VERIFIED; retention policy NOT STARTED.
- [~] PARTIALLY COMPLETE — Prompt-injection (delimiting + detector found via evaluation), file-parser, path-traversal, CSRF reviewed and tested; SSRF not applicable (no URL fetching); CORS restricted to WEB_ORIGIN.
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
