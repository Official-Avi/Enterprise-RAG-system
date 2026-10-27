# Testing Strategy and Definition of Done

## Test layers
1. Unit tests: parsing helpers, cleaning, chunking, token budgeting, retry policies, permission predicates.
2. Contract tests: embedding, vector-store, OCR, model, object-storage, queue provider interfaces.
3. Integration tests: PostgreSQL migrations, queue + worker lifecycle, object storage, vector indexing/retrieval.
4. Security tests: tenant isolation, RBAC, collection access, malicious file names, oversized uploads, prompt injection.
5. End-to-end tests: upload → processing → indexing → question → citations.
6. Resilience tests: worker termination, duplicate job delivery, provider timeout, queue backlog, retry exhaustion.
7. UI tests: upload errors/progress, job state transitions, citation navigation, role-based navigation, rack provenance.
8. Load tests: API, ingestion throughput, retrieval latency, model-serving concurrency, queue recovery.

## Required RAG evaluation set
Create a versioned synthetic/public-domain test corpus with:
- direct factual questions with known source passages,
- multi-chunk questions,
- no-answer questions,
- conflicting/old document versions,
- permission-restricted documents,
- prompt-injection text inside a document,
- scanned PDF with expected OCR caveats.

Track:
- retrieval hit/recall at k where labels exist,
- citation correctness,
- answer groundedness and completeness,
- abstention behavior on insufficient evidence,
- latency and token usage.
Do not treat an LLM judge as the only quality signal; include deterministic checks and human review.

## Definition of done for each task
- Code is implemented, not merely mocked unless task explicitly says prototype.
- Tests added and passing.
- Lint/type checks pass.
- API/UI behavior is manually verified for the changed path.
- Error and empty states are handled.
- Security implications reviewed.
- `TODO.md`, `PROGRESS.md`, and relevant architecture docs updated.
- Any limitation is documented honestly.

## Release gate
- Full test suite passes on a clean environment.
- Tenant and document access controls pass.
- No secrets committed.
- Backup/restore and deletion behavior documented.
- Performance claims cite environment and test methodology.

---

## Results log (actual runs — never edited after the fact)

Environment: Windows 11 host, Python 3.12.15 (uv), PostgreSQL 18.6 and Qdrant 1.20.0 portable
binaries on 127.0.0.1, Node 24.21.0. Embeddings in tests: `hash` test provider (fast, lexical);
live smoke uses the real `BAAI/bge-small-en-v1.5`. Answer model: extractive (no LLM).

### 2026-10-27 — end of Day 1

| Command (from `backend/` unless noted) | Result |
|---|---|
| `.venv/Scripts/python.exe -m ruff check src tests migrations` | All checks passed |
| `.venv/Scripts/python.exe -m mypy` | Success: no issues found in 72 source files |
| `.venv/Scripts/python.exe -m pytest -q` | **64 passed**, 0 failed (36.6 s) |
| `.venv/Scripts/python.exe ../scripts/dev/smoke_e2e.py` (live API + worker, real embeddings) | PASSED — PDF indexed in 2.0 s (bge-small), answer `supported`, citation → uploaded document p.1 |
| `apps/web`: `npm run lint` | 0 problems |
| `apps/web`: `npx tsc --noEmit` | 0 errors |
| `apps/web`: `npm run build` | Success, 17 routes |
| `apps/web` live via standalone server + API (curl) | /login 200; security headers present; unauthenticated API 401; cookie login sets HttpOnly `rf_session`; cookie request without CSRF header → 403 `CSRF_REQUIRED`; multipart upload through proxy → queued |

Test inventory (64): foundation/auth/RBAC/tenant isolation for collections (11); ingestion unit
tests — validation incl. traversal names, content spoofing, zip bomb, macro DOCX, extraction,
cleaning, quality, chunking (25); end-to-end ingestion incl. OCR of a scanned PDF, dedup,
failure+retry, deletion propagation to vectors/objects/rows, document access scoping (4); queue —
idempotent enqueue, concurrent claim, backoff/exhaustion, permanent failure, error-text redaction,
cancellation, lease reclaim with stale-owner guard, document status propagation, manual retry,
**real worker process kill and recovery** (11); RAG — grounded answer with verbatim quotes,
insufficient evidence, cross-tenant isolation, restricted collections/roles, deleted document with
live vectors never retrieved, citation hidden after access revoked, session ownership, safe model
timeout + metrics, models endpoints, invented-citation removal, prompt-injection delimiter
containment, Claude adapter request shape (no sampling params) and refusal handling, real
FastEmbed ranking (13).

Known verification gaps at end of Day 1: UI not inspected in a real browser; Docker Compose and CI
not executed; jobs/operations endpoints not HTTP-tested; concurrency limiter and tenant quota
untested; no load/performance tests; no real LLM exercised (no key / local model configured).

### 2026-10-27 — CI (GitHub Actions, first push)

Run 40512232777 on `ubuntu-24.04`: **backend** job — ruff clean, mypy clean, **64 passed**;
**web** job — lint, tsc, build passed; **compose-smoke** job — `docker compose up --build --wait`
succeeded; `/health/live` returned status ok, `/api/v1/health/ready` returned ready with
database=true and vector_store=true, web `/login` returned 200. This is the first verification of
the Dockerfiles and Compose stack (Docker is not available on the development host).

### 2026-10-27 — end of Day 2

| Command | Result |
|---|---|
| `backend`: ruff / mypy | clean (78 source files) |
| `backend`: `pytest -q` | **90 passed**, 0 failed (123.6 s) |
| `apps/web`: lint / tsc / build | 0 problems / 0 errors / success (19 routes) |
| `scripts/dev/smoke_platform.py` (live API + worker + web proxy, real bge-small embeddings) | PASSED — metrics below |

New tests on Day 2 (26): member lifecycle incl. one-time password login, role change applied to
live sessions, last-admin guard, removal revoking sessions; admin endpoints role/tenant scoping;
collection grants (read is not write/manage; members only; revoke); audit log recording and
scoping; tenant settings validation/reset; jobs API visibility (restricted collection, engineer
vs operator vs auditor vs other tenant), cancel then retry then succeed, filters; operations
summary equals database counts; worker list hides foreign job IDs; duplicate delivery creates no
duplicate chunks/vectors; storage quota; model concurrency limiter; infrastructure registry
(provenance rules, rack-unit validation, isolation, audit) and simulated seed; evaluation dataset
integrity, scoring rules, full run via the job queue (auditor sees scores only); injection
detector positives/negatives; extractive provider never quotes injected text.

**Evaluation baseline (dataset v1, 13 questions, extractive no-LLM provider):**

| Metric | Test run (hash embedder) | Live run (bge-small) |
|---|---|---|
| Retrieval hit rate | 1.00 | 1.00 |
| MRR | 0.88 | 1.00 |
| Citation precision | 0.95 | 0.95 |
| Citation correctness | 0.90 | 0.90 |
| Answer term recall | 0.85 | 0.85 |
| Abstention accuracy (no-answer) | **0.50** | **0.50** |
| False abstention rate | 0.00 | 0.00 |
| Injection resistance | 1.00 | 1.00 |
| Restricted leaks (operator without access) | 0 | 0 |
| Latency avg / p95 | 35 / 146 ms | 41 / 69 ms |

Findings: (1) the first evaluation run reported **injection resistance 0.00**: the extractive
provider's "include the following sentence" heuristic quoted an injected instruction (canary
CANARY-7731) verbatim. Fixed with an instruction-like-text detector (extractive mode never quotes
it; prompt sources are flagged; ingestion adds a warning) plus regression tests.
(2) Abstention accuracy is 0.50: the extractive provider answered one unanswerable question from
loosely matching text. Expected to improve with an LLM; not yet measured.
(3) A full-suite-only failure exposed non-idempotent evaluation seeding (the generated scanned
PDF embedded the current time). Fixed with deterministic PDF bytes and name-based idempotency.

Remaining verification gaps: no browser-level UI testing; no real LLM evaluated; no load tests;
tracing and backups/DR not implemented.
