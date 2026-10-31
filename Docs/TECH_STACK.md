# Technology Stack (verified against the code, 2026-10-29)

This lists what the code actually uses and why. Where an older document says otherwise, this file follows the code
(see "Doc/code differences" at the end). Versions are from `backend/uv.lock` and `apps/web/package-lock.json`.

## Frontend — `apps/web`

| Purpose | Technology | Notes |
|---|---|---|
| Framework | Next.js 16.4 (App Router), React 19.3, TypeScript 5.9 | Client components; `output: "standalone"` |
| Styling | Tailwind CSS 4.3 | CSS-variable tokens in `src/app/globals.css`; dark mode follows the OS |
| Data fetching | Custom `useApi(path, pollMs)` hook (`src/lib/hooks.ts`) | Polling via `setTimeout`; interval may depend on the latest data |
| API access | `src/lib/api.ts` | Same-origin `/api/v1/*`, rewritten by `next.config.ts` to the FastAPI server; adds `X-RackFlow-CSRF` on writes; uploads use XHR for progress |
| Route gating | `src/components/Shell.tsx` | Loads `/auth/me`; hides nav and blocks pages without the required permission (no middleware) |
| Tests / lint | Playwright 1.64 (`e2e/`), ESLint 9 | CI runs lint, `tsc` and build, not Playwright |

## Backend API — `backend/src/rackflow`

| Purpose | Technology | Notes |
|---|---|---|
| Web framework / server | FastAPI 0.162, Uvicorn 0.54 | All routes under `/api/v1`; OpenAPI docs disabled in production |
| Validation / settings | Pydantic 2.14, pydantic-settings 2.16 | Startup fails fast on invalid configuration (`core/config.py`) |
| ORM / migrations | SQLAlchemy 2.1 (sync) + psycopg 3.3, Alembic 1.20 | |
| Passwords | argon2-cffi (argon2id) | Dummy hash for unknown users (no timing leak) |
| Sessions | Server-side; SHA-256 of a random token stored in `auth_sessions` | Cookie `rf_session` (HttpOnly, SameSite=Lax), 12 h TTL; bearer-token mode for API clients |
| CSRF | `X-RackFlow-CSRF` header required on cookie-authenticated writes | |
| Authorization | RBAC (`auth/rbac.py`): org_admin, operator, engineer, auditor → 22 permissions; collection ACLs (`auth/access.py`) | Forbidden resources return 404 |
| Rate limiting | In-process sliding window (`core/ratelimit.py`) | login 10/min (IP+email), demo login 30/min (IP), upload 60/min, chat 30/min (user) |
| Logging | JSON logs with correlation IDs | Never logs document text or tracebacks |
| Demo access | `auth/demo.py`, `GET/POST /auth/demo` | Only when `DEMO_MODE=true`; refused in production; no passwords sent |

## Data and processing pipeline

| Stage | Technology | Key settings |
|---|---|---|
| Metadata + job queue | PostgreSQL 18 | Jobs claimed with `FOR UPDATE SKIP LOCKED`, 120 s leases, 4 attempts, full-jitter backoff, idempotency keys (`jobs/queue.py`) |
| Workers | Python processes (`worker/main.py`), one job at a time each | Heartbeat every 5 s (stale after 15 s); scale by starting more processes |
| Upload validation | `ingestion/validation.py` | Extension allowlist (pdf, docx, txt, md); byte signatures; 25 MiB; DOCX zip-bomb + macro checks; SHA-256 dedupe per collection |
| Object storage | Local filesystem (`providers/storage.py`) | Server-generated keys, atomic writes; S3 settings exist but are not implemented |
| Text extraction | pypdf 6.21 (PDF), python-docx 1.2 (DOCX), charset-normalizer (TXT/MD) | |
| OCR | RapidOCR (ONNX Runtime 1.31) + pypdfium2 at 200 DPI | Only for PDF pages without text, max 50 pages; bundled PP-OCRv4 models |
| Cleaning / quality | `ingestion/cleaning.py`, `quality.py` | De-hyphenation; repeated header/footer removal; quality score gate |
| Chunking | `ingestion/chunking.py` | Greedy paragraph packing, splitting to sentences then word windows; 400 tokens, 60 overlap; not heading-aware |
| Tokenization | `providers/tokenizer.py` (`regex-approx-v1`) | Approximate count (not tiktoken); the embedding model truncates at 512 tokens |
| Embeddings | FastEmbed 0.9, `BAAI/bge-small-en-v1.5` (quantized ONNX) | 384 dimensions, L2-normalized, batches of 64; runs locally (no document egress); cache `.data/models` |
| Vector database | Qdrant 1.20 (`providers/vectorstore.py`) | Collection `rackflow_chunks`, cosine; payload holds IDs only (no text); keyword indexes on tenant/collection/document/version |
| Retrieval | `rag/retrieval.py` | 18 candidates → PostgreSQL re-validation of every hit → dedupe → top 6; threshold 0.45; no hybrid search or reranking |
| Generation | `providers/chat.py` | `extractive` (default, no LLM, quotes top sentences); `anthropic` (`claude-opus-5-5`); `openai_compatible` (e.g. Ollama); 60 s timeout, 4 concurrent calls |
| Prompt safety | `rag/prompts.py`, `rag/context.py`, `rag/injection.py` | Sources wrapped as untrusted `<source>` blocks; injection heuristics; ~5,100-token context budget |
| Citation checking | `rag/answer.py` | Only citations to sources actually given to the model survive; otherwise the answer is marked unverified |
| Evaluation | `evaluation/` | 13-question dataset over 7 documents; deterministic metrics (hit rate, MRR, citation precision, abstention, injection resistance, leaks, latency) |
| Health / metrics | `/health/live`, `/health/ready` (DB, Qdrant, vector collection, embedding probe), `/operations/*` | Metrics computed from PostgreSQL; audit log in `audit_events` |

## Infrastructure

| Purpose | Technology |
|---|---|
| Containers | `backend/Dockerfile` (python:3.12-slim + uv, non-root), `apps/web/Dockerfile` (node:24-alpine, standalone) |
| Orchestration | `docker-compose.yml`: postgres 18.6, qdrant 1.20, migrate, api, worker (scalable), web |
| CI | `.github/workflows/ci.yml`: ruff, mypy, pytest with service containers; web lint/tsc/build; compose smoke |
| Local Windows | Portable PostgreSQL + Qdrant started by `scripts/dev/start-services.ps1` (see README) |

## Request lifecycles

**Upload → searchable.** Browser XHR → Next.js rewrite → FastAPI (session, CSRF, RBAC, collection write access,
rate limit) → stream and validate the file → store it atomically → one transaction creates the document, an
idempotent ingest job and an audit event → a worker claims the job (SKIP LOCKED, lease) → pypdf extraction, with
RapidOCR for pages without text → quality, cleaning → chunking (400/60) → FastEmbed vectors → Qdrant upsert with
count verification → document marked `INDEXED`.

**Question → cited answer.** `POST /chat/sessions/{id}/messages` → FastAPI checks → allowed collections → FastEmbed
query vector → Qdrant filtered search (18) → PostgreSQL re-validation → top 6 → `<source>` prompt within the token
budget → extractive / Claude / OpenAI-compatible provider → citation validation and quote extraction → messages and
citations saved → JSON answer.

## Doc/code differences (as of this file)

- `DECISIONS.md` ADR-012 names Tesseract; the code uses RapidOCR (ADR-015).
- `ARCHITECTURE.md` mentions optional hybrid search, reranking and a Redis broker; none are implemented.
- `prometheus-client` is a dependency but is not used; metrics come from PostgreSQL.
- `OBJECT_STORAGE_ENDPOINT`/`BUCKET` are ignored; only local storage exists.
- Top-level `eval/` and `infra/` are empty; evaluation lives in `backend/src/rackflow/evaluation`.
