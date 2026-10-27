# RackFlow AI — Enterprise RAG Infrastructure & Management Platform

RackFlow AI is a multi-tenant control plane for document-grounded AI: upload documents, process
and index them through a durable job pipeline, ask questions and receive answers with verifiable
source citations, and operate the queues, workers, model endpoints and logical infrastructure
behind it. Product and architecture documents live in [`Docs/`](Docs/).

> Status: active 3-day sprint. See [`Docs/PROGRESS.md`](Docs/PROGRESS.md) for what is verified,
> partial or pending, and [`Docs/TESTING.md`](Docs/TESTING.md) for actual test results.

## Architecture at a glance

| Component | Technology | Location |
|---|---|---|
| Web console | Next.js 16, React 19, TypeScript, Tailwind 4 | `apps/web` |
| API | FastAPI, SQLAlchemy 2, Pydantic 2 | `backend/src/rackflow/api` |
| Workers | Python process claiming jobs from PostgreSQL (`SKIP LOCKED` + leases) | `backend/src/rackflow/worker`, `jobs` |
| Metadata + job queue | PostgreSQL 18 (Alembic migrations) | `backend/migrations` |
| Vector store | Qdrant 1.20 (tenant-filtered; never the only authorization check) | `providers/vectorstore.py` |
| Embeddings | Local FastEmbed `BAAI/bge-small-en-v1.5` (no document egress) | `providers/embeddings.py` |
| Extraction / OCR | pypdf, python-docx, RapidOCR (ONNX) + pypdfium2 | `providers/extractors.py`, `ocr.py` |
| Answer generation | Claude (`claude-opus-5-5`), any OpenAI-compatible endpoint (e.g. Ollama), or the labelled extractive no-LLM fallback | `providers/chat.py`, `rag/` |

Key decisions and their reasons are in [`Docs/DECISIONS.md`](Docs/DECISIONS.md).

## Local setup on Windows without Docker (verified on the development host)

Prerequisites: [uv](https://docs.astral.sh/uv/) (installs Python 3.12), Node.js 24, git, and the
portable [PostgreSQL 18 binaries](https://www.enterprisedb.com/download-postgresql-binaries) and
[Qdrant 1.20 Windows release](https://github.com/qdrant/qdrant/releases) unpacked to
`%USERPROFILE%\tools\pgsql` and `%USERPROFILE%\tools\qdrant` (override with `RACKFLOW_PG_BIN` /
`RACKFLOW_QDRANT_EXE`). Use `127.0.0.1`, not `localhost`, in URLs.

```powershell
# 1. Configuration (edit values as needed; never commit .env)
Copy-Item .env.example .env

# 2. One-time database initialisation (choose your own password and put it in DATABASE_URL)
& "$env:USERPROFILE\tools\pgsql\bin\initdb.exe" -D .data\pg -U rackflow --pwfile=<file-with-password> -E UTF8 --auth=scram-sha-256 --locale=C
powershell -ExecutionPolicy Bypass -File scripts\dev\start-services.ps1
& "$env:USERPROFILE\tools\pgsql\bin\psql.exe" -h 127.0.0.1 -U rackflow -d postgres -c "CREATE DATABASE rackflow;" -c "CREATE DATABASE rackflow_test;"

# 3. Backend
cd backend
uv sync
.venv\Scripts\python.exe -m alembic upgrade head
$env:RACKFLOW_SEED_PASSWORD = "<choose-a-demo-password>"   # optional; otherwise one is generated and printed once
.venv\Scripts\python.exe -m rackflow.cli seed-demo          # tenants acme + globex, one user per role
.venv\Scripts\python.exe -m uvicorn rackflow.api.app:create_app --factory --host 127.0.0.1 --port 8000
# in a second terminal (scale by starting more):
.venv\Scripts\python.exe -m rackflow.worker.main

# 4. Web console (third terminal)
cd apps\web
npm install
npm run build
Copy-Item -Recurse .next\static .next\standalone\.next\
$env:PORT=3000; $env:HOSTNAME="127.0.0.1"; node .next\standalone\server.js
# open http://127.0.0.1:3000 and sign in, e.g. engineer@acme.example.com
```

On subsequent runs only `start-services.ps1`, the API, the worker and the web server are needed.
`npm run dev` is the standard Next.js dev server but has not been verified in this sprint.

Health: `GET http://127.0.0.1:8000/api/v1/health/live` and `/api/v1/health/ready` (database +
vector store). API docs (non-production only): `http://127.0.0.1:8000/api/v1/docs`.

### Smoke test (live stack)

```powershell
cd backend
.venv\Scripts\python.exe ..\scripts\dev\smoke_e2e.py --email engineer@acme.example.com
```
Logs in, creates a collection, uploads a generated PDF, waits for indexing, asks a question and
checks that the answer cites the uploaded document. The password is read from
`RACKFLOW_SMOKE_PASSWORD` or `.data/demo-password.txt`.

## Tests

```powershell
cd backend
.venv\Scripts\python.exe -m ruff check src tests migrations
.venv\Scripts\python.exe -m mypy
.venv\Scripts\python.exe -m pytest -q          # needs PostgreSQL (TEST_DATABASE_URL) and Qdrant

cd ..\apps\web
npm run lint; npx tsc --noEmit; npm run build
```

## Docker Compose (Linux hosts)

`docker-compose.yml` defines PostgreSQL, Qdrant, a one-shot migration, API, worker (scalable with
`--scale worker=N`) and web. It is exercised by the `compose-smoke` CI job; it has **not** been
run on the Windows development host (Docker is not installed there).

```bash
cp .env.example .env   # set POSTGRES_PASSWORD and other values
docker compose up --build
```

## Choosing the answer model

| `MODEL_PROVIDER` | What answers questions | Notes |
|---|---|---|
| `extractive` (default) | No LLM — quotes the most relevant retrieved sentences with citations | Clearly labelled in the UI and API |
| `anthropic` | Claude via the official SDK (default `claude-opus-5-5`) | Requires `MODEL_API_KEY`; retrieved excerpts are sent to Anthropic |
| `openai_compatible` | Any OpenAI-compatible endpoint, e.g. Ollama at `http://127.0.0.1:11434/v1` | Set `MODEL_BASE_URL` and `MODEL_NAME` (e.g. `qwen2.5:1.5b`) |

## Security posture (summary)

Tenant is derived from the verified session, never from request bodies. Every protected endpoint
checks a role permission; document content additionally requires collection access. Retrieval
filters by tenant and collection in the vector store **and** re-validates every hit in
PostgreSQL. Uploaded files are validated by content signature, size, archive expansion and macro
checks; stored under generated keys. Retrieved text is delimited as untrusted data in prompts;
citations are accepted only if they reference retrieved, authorized chunks. Logs and job errors
never contain document text. See [`Docs/SECURITY.md`](Docs/SECURITY.md) and the open risks in
[`Docs/PROGRESS.md`](Docs/PROGRESS.md). This is **not** a claim of production readiness.
