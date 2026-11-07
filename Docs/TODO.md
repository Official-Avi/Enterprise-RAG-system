# Implementation TODO and Milestones

The coding agent must implement in order. Do not mark a task complete until code exists, tests pass, and documentation is updated.

Status vocabulary (3-day sprint): **VERIFIED** (tests/functional checks passed) · **IMPLEMENTED — NOT VERIFIED** (code exists; no passing check yet) · **PARTIALLY COMPLETE** · **IN PROGRESS** · **BLOCKED** · **NOT STARTED** · **DEFERRED** (owner/ADR decision). Checkbox legend kept for compatibility: `[x]` verified, `[~]` partial / not verified, `[ ]` not started, `[!]` blocked, `[-]` deferred.

_Last updated: 2026-11-06, on branch `ui-redesign-2026-10`. Evidence: Docs/TESTING.md "Results log"._

**How to read the phases below:** each `[x]` was verified at the time it was marked, mostly at v0.1.0 on 2026-10-27, unless the line says otherwise. Code has changed since on this branch, and the final gate is pending, so a `[x]` is not a claim about the current working tree. New work and open items are in the next section. **Nothing here means production ready.**

## Current round — redesign and bug fixes (2026-11-05 to 2026-11-06)

### Done and checked
- [x] VERIFIED — Build fixed; backend set up on the reset laptop (2026-11-05: 114 backend tests, ruff and mypy clean; ENV-1 no longer reproduces).
- [x] VERIFIED — Browser test round (E2E 49 of 53; 144 bugs logged, 50 major, 0 blockers).
- [x] VERIFIED — Stage 4 gate, before the review fixes: eslint, tsc, ruff, mypy, 233 backend tests, build with `/` Static, all Playwright specs.
- [x] VERIFIED (live, by hand) — Groq via `openai_compatible`: cited answers, follow-up, abstention, injection refusal.

### Fixed, owner-checked, final gate pending
- [~] Open redirect in `safeNext` and `#` handling in `canOpen`. Browser scripts only; no permanent test.
- [~] Sign-in audit flooding, `TRUSTED_PROXY_IPS`, audit reasons, per-tenant worker data, `MODEL_NAME` validation, `DEMO_MODE` tests. Backend tests pass except for the item below. Compose not executed.
- [~] Evaluation result gating, `reindex` and retry guards, infrastructure PATCH nulls, fractional CPU, upload order and validation fixes, orphan vectors, evaluation retry. Backend tests; retry not run against real Groq.
- [~] Saved answer withheld on access loss, citation markers, delimiters, follow-ups, quotes. Tests ran only within other owners' full suites; **the RAG and chat owner's report was not received.**
- [~] Landing cancel and stored-file reporting, FAQ, expired session, shared busy flag. Mocked browser script, one live API script.
- [~] Ask: DOCX citations, withheld note, titles, re-send, deleted chat, drafts, polling, bold. Browser script with the API mocked.
- [~] Console: paging, Load more, failed-delete actions, role gating, audit labels, settings, seed results. Browser script with writes stubbed.
- [~] Library gating and copy, e2e coverage restored, `roles` and `engineer-journey` specs updated. Playwright.

### To do before merging to `main`
- [ ] Run the final gate and fill in `TESTING.md`.
- [ ] Resolve `test_chat_citations.py::test_answer_is_withheld_once_access_can_no_longer_be_checked` (409 instead of 204 on collection delete at the last owner run).
- [ ] Commit the working tree. Nothing since `45cd0dd` is committed, and `45cd0dd` itself is not pushed.
- [ ] Restart the API and worker so the fixes take effect.
- [ ] Reset demo data: test documents in the demo corpus, leftover chats and documents, user `console-admin-test@example.com`.
- [ ] Merge locally, then ask the owner before any push. The repository is public.

### Tests to add
- [ ] Playwright spec for `safeNext` and `canOpen`, because the scripts that checked them will not survive. Hostile `next` values through the form and a demo card must stay on the site and land on `/ask`: `/.//evil.example`, `/..//evil.example`, `/%2e//evil.example`, `/a/..//evil.example`, `/%2e%2e//evil.example`, `/.///evil.example`, `/.//evil.example/x?y=1#z`. `/%2e/login` and `/.//login` go to `/ask` with no loop. An auditor with `/ask`, `/ask#x` or `/library#x` goes to `/overview`. `/library?x=1#y` is kept.
- [ ] Permanent tests for the hero cancel states, and the Ask and console fixes now checked only by scripts.
- [ ] The landing cases nobody exercised: emptied box, read-only box during the countdown, Switch to Engineer with an edited question, session expiry during Try again, a real 98% cancel.
- [ ] Re-send holding for a file still being read.
- [ ] CI jobs for Playwright and axe, and the assertion that `/` builds as Static.

### Evaluation
- [x] VERIFIED — Complete 13-question run with Groq, retry active, 0 errors, about a minute (`TESTING.md`, final gate).
- [ ] Groq still refuses `r1` because the document says it is restricted, although the reader has access (false abstention 0.09).
- [ ] Store results as they arrive, so a worker crash mid-run does not spend the tokens again.

### Owner decisions
- [!] Cross-tenant membership add (ADR-026).
- [!] "Verify critical steps" notice (review finding 46): restore it near the composer and add the assertion to `engineer-journey.spec.ts`, or confirm its removal in `UI_DESIGN_SPEC.md`.
- [!] `POST /documents/{id}/retry` on a document whose delete gave up: keep or refuse. The Library and console pages hide the button, but the API still accepts the call.
- [!] Rotate the model API key and the local database password. Also rotate credentials from before the reinstall, and run a full Defender scan (none is recorded).

### Smaller fixes
- [ ] `providers/chat.py`: pass `Retry-After` on `ModelError`, so the evaluation runner can wait less.
- [ ] `routers/health.py`: readiness should compare point count with indexed chunks, or `rag/indexing.py` should not recreate a lost collection silently.
- [ ] Stop should cancel on the server, or the answer should be discardable (`chat.py`, `answer.py`).
- [ ] `lib/api.ts` `uploadFiles` has no timeout, so the hero's "Stopping…" can wait for ever if the server never answers.
- [ ] Stale dialog error on `infrastructure/page.tsx` (NewRack, NewWorkload) and `[id]/page.tsx` (NewNode): reported, not confirmed.
- [ ] `documents/page.tsx` and `documents/[id]/page.tsx`: retry errors still say "Your role can't retry" where the cause can be collection access. Re-check `mayDelete`.
- [ ] Jobs page: show the 409 reason in the drawer; hiding the button needs a new job field.
- [ ] `GET /settings/tenant`: add a defaults field so Settings can show the default while an override is set.
- [ ] Collections and Evaluation pages call `/collections` with the default limit of 100, so a longer list is cut off and Evaluation could miss its corpus.
- [ ] Run evaluation stays enabled after a refused seed; a real gate needs corpus status from the API.
- [ ] Merge the three exact-name matches for evaluation collections into one helper in `lib/workspace.ts`.
- [ ] `lib/types.ts`: add `content_withheld` to `ChatMessage`, then remove the local `SavedMessage`. Remove the unused `uploadToMyDocuments`.
- [ ] Copy: Evaluation page note; `modeBadge` fallback "Written by Claude"; "See the exact page" for non-PDFs; `FactStrip` "Your files stay"; "Not accepted" on a deleted document's row (`lib/status.ts`, `AttachmentChip.tsx`).
- [ ] Markdown tables and lists in written answers.
- [ ] `UI_DESIGN_SPEC.md` lines 199 and 202 still carry the old FAQ copy. `Docs/env.example` is an untracked, out-of-date copy of `.env.example`. Decide what to do with the other untracked notes in `Docs/`.
- [ ] Deferred on purpose, low risk: a socket-address hop for Compose; IPv6 /64 limits; local `X-Forwarded-For` through uvicorn's default trust.

### Next round, on its own branch (owner's plan)
- [ ] Production work: real LLM answers, backups, TLS, secrets, rejecting default credentials, CI gates.

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
- [x] VERIFIED (CI, v0.1.0 only) — Docker Compose for PostgreSQL, Qdrant, migrate, API, worker, web: built and health-checked by the `compose-smoke` CI job. Redis not used (ADR-005). **Changes on this branch not executed.**
- [x] VERIFIED — FastAPI health/readiness endpoints.
- [x] VERIFIED — Next.js app shell, navigation, design tokens, light/dark themes, route-level permission gating (browser E2E in Edge 156 + screenshot review). Responsive/mobile layout only spot-checked.
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
- [x] VERIFIED — Upload UI with per-file results (browser E2E). Progress bar not separately asserted.
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
- [x] VERIFIED — Processing status UI: queued → indexed with live polling, stage timeline (browser E2E).
- [x] VERIFIED — PROGRESS.md updated.

## Phase 4 — Embeddings, vector index, retrieval
- [x] VERIFIED — Embedding and vector-store interfaces.
- [x] VERIFIED — Local FastEmbed provider with model/version metadata.
- [x] VERIFIED — Qdrant adapter with mandatory tenant/collection/document filters.
- [x] VERIFIED — Idempotent upsert (vector id = chunk id) and deletion cleanup.
- [x] VERIFIED — Authorized top-k retrieval, similarity threshold, PostgreSQL re-validation.
- [ ] NOT STARTED — Optional hybrid retrieval/reranking.
- [~] PARTIALLY COMPLETE — Retrieval inspector: API verified (operator/admin only); UI built but not covered by browser E2E.
- [x] VERIFIED — Cross-tenant and cross-collection isolation tests.
- [x] VERIFIED — PROGRESS.md updated.

## Phase 5 — RAG chat and citations
- [x] VERIFIED — Chat model provider interface and configurable endpoint (Claude, OpenAI-compatible, extractive). The Claude adapter is covered by a request-shape test only, not a live call; OpenAI-compatible was used live with Groq on 2026-11-06.
- [x] VERIFIED — Context builder with token budget and deduplication.
- [x] VERIFIED — Grounded prompt treating retrieved content as untrusted data.
- [x] VERIFIED — Answer + citation schema; invented citations dropped.
- [x] VERIFIED — Insufficient-evidence behaviour.
- [~] PARTIALLY COMPLETE — Conversation history VERIFIED; retention policy NOT STARTED.
- [x] VERIFIED — Chat UI and citation source viewer (browser E2E: question → supported answer → citation chip → exact source passage).
- [x] VERIFIED — RAG end-to-end tests (API + live smoke).
- [x] VERIFIED — PROGRESS.md updated.

## Phase 6 — Operations and workload management
- [x] VERIFIED — Job queue dashboard and job detail dialog (browser E2E incl. keyboard dismissal); jobs API over HTTP.
- [x] VERIFIED (API) — Job detail/attempt timeline and retry/cancel actions with permission and state checks; UI not browser-inspected.
- [x] VERIFIED — Worker heartbeat, queue depth, summary counts matching the database, throughput/latency metrics.
- [x] VERIFIED — Bounded retries, exponential backoff with jitter, terminal failure handling.
- [~] PARTIALLY COMPLETE — Worker scaling documented (start more processes / `--scale worker=N`); no load test.
- [~] PARTIALLY COMPLETE — Scaling, probe and stateless-API guidance in DEPLOYMENT.md §8; no load balancer configuration exercised.
- [x] VERIFIED — Worker termination/recovery (real process kill test).
- [x] VERIFIED — Duplicate delivery of the same ingestion job creates no duplicate chunks or vectors.
- [x] VERIFIED — PROGRESS.md updated.

## Phase 7 — Model serving and evaluation
- [x] VERIFIED — Model endpoint configuration and health checks.
- [x] VERIFIED — Timeouts, safe errors, request metrics and the concurrency limiter.
- [ ] NOT STARTED — Evaluate candidate small model through a local runtime (ADR-004). Groq is the current hosted choice (ADR-023).
- [x] VERIFIED — Versioned dataset v1: 13 labelled questions across 7 categories (factual, multi-chunk, conflicting versions, no-answer, prompt injection, scanned OCR, restricted).
- [x] VERIFIED — Deterministic runner (job-based) measuring hit rate, MRR, citation precision/correctness, term recall, abstention, injection resistance, restricted leakage, latency (ADR-021). Groundedness beyond citation checks not measured.
- [~] PARTIALLY COMPLETE — Baseline for the extractive (no-LLM) provider recorded in TESTING.md. An LLM run with Groq scored all 13 (false abstention 0.09, `r1`).

## Phase 8 — Infrastructure / logical rack management
- [x] VERIFIED — Logical rack, node/resource and workload-placement APIs with provenance rules (ADR-020).
- [x] VERIFIED — Manual registration and `seed-infra` simulated demo data (labelled).
- [x] VERIFIED — Rack overview and detail UI with front view and node cards (browser E2E + screenshot review).
- [x] VERIFIED — Provenance badges on racks/nodes/workloads (browser E2E asserts Simulated labels) and API provenance rules.
- [x] VERIFIED — Workload placement and requested-vs-capacity allocation views (screenshot review; labelled as allocation, not measured usage).
- [x] VERIFIED — No hardware control in MVP (no such code exists; ADR-002).
- [x] VERIFIED — Role and audit tests for infrastructure changes.

## Phase 9 — Monitoring, security, enterprise hardening
- [~] PARTIALLY COMPLETE — Operational metrics (summary, throughput chart, model metrics).
- [ ] NOT STARTED — OpenTelemetry-compatible tracing.
- [~] PARTIALLY COMPLETE — Rate limits (in-process, per API replica) for sign-in/demo/upload/chat; tenant storage quota VERIFIED; retention policy NOT STARTED.
- [~] PARTIALLY COMPLETE — Prompt-injection (delimiting + detector found via evaluation), file-parser, path-traversal, CSRF reviewed and tested; SSRF not applicable (no URL fetching); CORS restricted to WEB_ORIGIN.
- [x] VERIFIED — All vector search paths apply authorization filters (single retrieval path + PostgreSQL re-check).
- [~] PARTIALLY COMPLETE — Authentication release gate runs with the test suite (public operations now also include `GET`/`POST /auth/demo`); npm audit and pip-audit last run manually on 2026-10-27 and are not CI gates; no secret scanner in CI.
- [ ] NOT STARTED — Backup/restore and disaster recovery runbook.

## Phase 10 — Release and deployment
- [~] PARTIALLY COMPLETE — Deployment guide and production checklist (DEPLOYMENT.md §8); no staging environment exercised.
- [ ] NOT STARTED — Production secrets and storage configuration.
- [x] VERIFIED — Migrations: upgrade verified locally, in CI and on a clean install; full downgrade/upgrade round trip is an automated test; rollback documented.
- [~] PARTIALLY COMPLETE — Full functional suites pass (backend, browser E2E, CI incl. Docker Compose); load tests NOT STARTED.
- [~] PARTIALLY COMPLETE — Labels, visible focus, keyboard-dismissable dialogs, skip links, non-colour status badges. Axe and keyboard gates exist as Playwright specs (`a11y-gates.spec.ts`) and passed at the Stage 4 gate, but do not run in CI. No screen-reader or real-device testing is recorded.
- [x] VERIFIED — Release notes and known limitations (Docs/RELEASE_NOTES.md), cross-checked against TESTING.md.
- [x] VERIFIED (v0.1.0 only) — Clean installation from a fresh GitHub clone using only README commands (separate database/ports; shared PostgreSQL/Qdrant servers) — live smoke and web proxy login passed on 2026-10-27. Not repeated for the current README.

## Rules
- Never skip ahead because a UI mock looks complete.
- Never mark a feature complete based only on placeholder screens.
- Any task that cannot be completed must be marked `[!]` with the blocker.
- Any scope change must be recorded in `DECISIONS.md` before implementation.
