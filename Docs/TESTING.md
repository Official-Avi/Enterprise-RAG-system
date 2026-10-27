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
