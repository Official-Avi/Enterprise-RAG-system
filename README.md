# RackFlow AI — Enterprise RAG Infrastructure & Management Platform

RackFlow AI is a multi-tenant control plane for document-grounded AI: upload documents, process
and index them through a durable job pipeline, ask questions and receive answers with verifiable
source citations, and operate the queues, workers, model endpoints and logical infrastructure
behind it. Product and architecture documents live in [`Docs/`](Docs/).

> **Status (2026-11-08):** v0.1.0 is the tagged pilot. The UI redesign is merged into `main`
> (`5648c83`, not tagged). Branch `production-hardening-2026-11` adds a production setup (Caddy TLS,
> hardened containers, backups, CI gates) that is **written and unit-tested but has never been run**:
> the development machine has no Docker. **This is not production ready.** See
> [`Docs/PROGRESS.md`](Docs/PROGRESS.md) for what is verified and the open risks,
> [`Docs/TESTING.md`](Docs/TESTING.md) for actual test results, and
> [`Docs/PRODUCTION_CHECKLIST.md`](Docs/PRODUCTION_CHECKLIST.md) before any real deployment.

## Architecture at a glance

| Component | Technology | Location |
|---|---|---|
| Web app (landing, `/ask`, `/library`, admin console) | Next.js 16, React 19, TypeScript, Tailwind 4 | `apps/web` |
| API | FastAPI, SQLAlchemy 2, Pydantic 2 | `backend/src/rackflow/api` |
| Workers | Python process claiming jobs from PostgreSQL (`SKIP LOCKED` + leases) | `backend/src/rackflow/worker`, `jobs` |
| Metadata + job queue | PostgreSQL 18 (Alembic migrations) | `backend/migrations` |
| Vector store | Qdrant 1.20 (tenant-filtered; never the only authorization check) | `providers/vectorstore.py` |
| Embeddings | Local FastEmbed `BAAI/bge-small-en-v1.5` (no document egress) | `providers/embeddings.py` |
| Extraction / OCR | pypdf, python-docx, RapidOCR (ONNX) + pypdfium2 | `providers/extractors.py`, `ocr.py` |
| Answer generation | Built-in extractive mode (default, no LLM), or a model through `anthropic` or `openai_compatible` (see [Choosing the answer model](#choosing-the-answer-model)) | `providers/chat.py`, `rag/` |

Key decisions and their reasons are in [`Docs/DECISIONS.md`](Docs/DECISIONS.md). The interface is
described in [`Docs/DESIGN.md`](Docs/DESIGN.md).

## Local setup on Windows without Docker

Tools, with the versions observed on the development host on 2026-11-05 and 2026-11-06:

| Tool | Version | Notes |
|---|---|---|
| Python | 3.12 (3.12.16 in `backend/.venv`) | `pyproject.toml` requires `>=3.12,<3.13`. Let [uv](https://docs.astral.sh/uv/) install it. Use `backend\.venv\Scripts\python.exe`, not a system Python. |
| Node.js | 26.13.0 observed | CI and `apps/web/Dockerfile` use Node 24. Earlier checks ran on 24.21.0. |
| PostgreSQL | 18.6 portable binaries | [Download](https://www.enterprisedb.com/download-postgresql-binaries), unpack to `%USERPROFILE%\tools\pgsql` (override: `RACKFLOW_PG_BIN`). |
| Qdrant | 1.20.0 Windows release | [Download](https://github.com/qdrant/qdrant/releases), unpack to `%USERPROFILE%\tools\qdrant` (override: `RACKFLOW_QDRANT_EXE`). |

Use `127.0.0.1`, not `localhost`, in URLs. On this host IPv6 `::1` connections hang.

### First-time setup

```powershell
# 1. Configuration (edit values as needed; never commit .env)
Copy-Item .env.example .env

# 2. One-time database initialisation (choose your own password and put it in DATABASE_URL)
& "$env:USERPROFILE\tools\pgsql\bin\initdb.exe" -D .data\pg -U rackflow --pwfile=<file-with-password> -E UTF8 --auth=scram-sha-256 --locale=C
powershell -ExecutionPolicy Bypass -File scripts\dev\start-services.ps1
& "$env:USERPROFILE\tools\pgsql\bin\psql.exe" -h 127.0.0.1 -U rackflow -d postgres -c "CREATE DATABASE rackflow;" -c "CREATE DATABASE rackflow_test;"

# 3. Backend dependencies, schema and demo accounts
cd backend
uv sync
.venv\Scripts\python.exe -m alembic upgrade head
$env:RACKFLOW_SEED_PASSWORD = "<choose-a-demo-password>"   # optional; 12+ chars, not common, no "password"/"rackflow"; otherwise one is generated and printed once
.venv\Scripts\python.exe -m rackflow.cli seed-demo          # tenants acme + globex, one user per role
cd ..

# 4. Web dependencies
cd apps\web
npm install
cd ..\..
```

To use the one-click demo personas on the landing page, set `DEMO_MODE=true` in `.env`. It is off by
default, and startup refuses it with `APP_ENV=production`. **Demo accounts have no password and are
shared: anyone who can reach the site can act as the demo admin.** Never use them with real data or on
a public address (ADR-022).

### Starting it

```powershell
# Backend: PostgreSQL and Qdrant if not running, then restarts the API on :8000 and one worker
powershell -ExecutionPolicy Bypass -File scripts\dev\start-backend.ps1

# Web, in a second terminal
cd apps\web
npx next dev -H 127.0.0.1 -p 3000
```

Open http://127.0.0.1:3000.

`start-backend.ps1` runs the API and worker detached, appends output to `.data\api.log` and
`.data\worker.log`, and exits 0 only after it has seen live, ready and a fresh worker heartbeat. The
API and worker do not reload, so **run it again after changing backend code or `.env`**. It does not
apply migrations: after pulling new code, run `alembic upgrade head` first.

For a production-style web build instead of the dev server:

```powershell
cd apps\web
npm run build
Copy-Item -Recurse .next\static .next\standalone\.next\
Copy-Item -Recurse public .next\standalone\
$env:PORT=3000; $env:HOSTNAME="127.0.0.1"; node .next\standalone\server.js
```

Running `next build` beside a running dev server may collide. Build from a copy if you need both.

Health: `GET http://127.0.0.1:8000/api/v1/health/live` (no dependencies) and `/api/v1/health/ready`
(database, vector store, vector collection, vector collection consistent with indexed documents, and
embeddings; 503 unless all pass). API docs (non-production only): `http://127.0.0.1:8000/api/v1/docs`.

### Smoke test (live stack)

```powershell
cd backend
.venv\Scripts\python.exe ..\scripts\dev\smoke_e2e.py --email engineer@acme.example.com
```
Logs in, creates a collection, uploads a generated PDF, waits for indexing, asks a question and
checks that the answer cites the uploaded document. The password is read from
`RACKFLOW_SMOKE_PASSWORD` or `.data/demo-password.txt`.

## Tests

Backend tests need PostgreSQL and Qdrant running and a test database named by `TEST_DATABASE_URL`.

- Plain `pytest` falls back to CI's login on `rackflow_test`, which a local PostgreSQL usually rejects
  with setup errors. Pytest reads the variable from the process environment only, so a line in `.env`
  is not enough.
- **Every run drops the public schema of that database.** Its name must contain `test`, and it must
  never be the database the app runs on.
- Runs at the same time need separate databases and collections, or they drop each other's schema.

```powershell
cd backend
.venv\Scripts\python.exe -m ruff check src tests migrations
.venv\Scripts\python.exe -m mypy

# Use the same user and password as DATABASE_URL in your .env
$env:TEST_DATABASE_URL = "postgresql+psycopg://<user>:<password>@127.0.0.1:5432/rackflow_test"
$env:TEST_VECTOR_COLLECTION = "rackflow_test_mine"   # optional; must start with rackflow_test_
.venv\Scripts\python.exe -m pytest -q

cd ..\apps\web
npm run lint; npx tsc --noEmit; npm run build

# Browser tests. Windows defaults to Microsoft Edge. Variables: apps/web/README.md
npm run test:e2e
npm run test:a11y
npm run test:e2e:ci   # CI mode: retries, HTML report, Playwright Chromium unless E2E_BROWSER_CHANNEL is set
```

Browser tests run against an already-running stack with `DEMO_MODE=true`. They use the shared demo
accounts, leave some data behind, and the engineer journey asks the configured model one live question.
The demo password comes from `E2E_DEMO_PASSWORD`, else `.data/demo-password.txt`. `E2E_OUTPUT_DIR`,
`E2E_REPORT_DIR` and `E2E_SCREENSHOT_DIR` move the output out of the repository.

CI (`.github/workflows/ci.yml`) runs `backend`, `web`, `e2e` (full stack with Playwright and the axe
gates), `secrets` (gitleaks), `audit-python`, `audit-web` and `compose-smoke`. The new jobs have not run
on GitHub yet ([`Docs/DEPLOYMENT.md`](Docs/DEPLOYMENT.md) §8.12).

## Docker Compose (Linux hosts)

Docker is not installed on the Windows development host, so **nothing in this section has been run
since v0.1.0**, when the `compose-smoke` CI job last passed.

### Development stack

`docker-compose.yml` on its own defines PostgreSQL, Qdrant, a one-shot migration, API, worker (scalable
with `--scale worker=N`) and web, plain HTTP, all on 127.0.0.1.

```bash
cp .env.example .env   # set POSTGRES_PASSWORD and other values
docker compose up --build
docker compose exec api rackflow-admin seed-demo   # a fresh stack has no accounts; prints a generated password once
```

Containers receive only the settings listed under `x-backend-env`; anything else in `.env` does not
reach them.

### Production with TLS (not verified here)

Follow [`Docs/PRODUCTION_CHECKLIST.md`](Docs/PRODUCTION_CHECKLIST.md). In short:

```bash
python scripts/ops/generate_env.py --output .env --domain rag.example.com --tls-issuer ops@example.com
# fill in the model settings it lists, then:
docker compose -f docker-compose.yml -f deploy/compose.prod.yml --profile prod up -d --build
docker compose -f docker-compose.yml -f deploy/compose.prod.yml --profile prod exec api \
  rackflow-admin bootstrap-admin --tenant acme --tenant-name "Acme" --email admin@example.com
```

Caddy terminates TLS and is the only service that publishes ports; the overlay forces
`APP_ENV=production` and trusts exactly the web and Caddy addresses for client IPs. With
`APP_ENV=production` the API refuses to start on default or weak credentials, plain-HTTP origins, debug
logging and similar settings ([`Docs/DEPLOYMENT.md`](Docs/DEPLOYMENT.md) §8.2). Details:
[`deploy/README.md`](deploy/README.md).

### Backups

`scripts/ops/backup.py --output <dir> --keep N` backs up PostgreSQL, the Qdrant collection and the
uploaded files with a checksummed manifest; `scripts/ops/restore.py` restores into named targets and
compares counts. Run the restore drill before go-live and monthly: [`scripts/ops/README.md`](scripts/ops/README.md).
The drill passed on the local Windows stack on 2026-11-07; it has not been run against Docker volumes.

## Choosing the answer model

| `MODEL_PROVIDER` | What answers questions | Required settings | Data sent off the machine |
|---|---|---|---|
| `extractive` (default) | No LLM. Quotes the most relevant retrieved sentences with citations; labelled in the UI and API | None | None |
| `anthropic` | Claude via the official SDK (default model `claude-opus-5-5`) | `MODEL_API_KEY` | Question, retrieved passages, and for a follow-up one earlier question, to Anthropic |
| `openai_compatible`, hosted (for example Groq) | Any OpenAI-compatible service | `MODEL_BASE_URL`, `MODEL_NAME`, `MODEL_API_KEY` | The same, to that service |
| `openai_compatible`, local (for example Ollama) | A model on your own server | `MODEL_BASE_URL`, `MODEL_NAME` | None if it runs on this host |

Startup fails if a required setting is missing. With `APP_ENV=production` a remote endpoint must also
use `https://` and have a key. Files and embeddings never leave the server in any mode.

Groq example for `.env`, with the key kept out of any tracked file:

```ini
MODEL_PROVIDER=openai_compatible
MODEL_BASE_URL=https://api.groq.com/openai/v1
MODEL_NAME=qwen/qwen3.8-27b        # the model used for the 2026-11-06 live check
MODEL_API_KEY=<your-groq-api-key>
```

Local Ollama example: `MODEL_BASE_URL=http://127.0.0.1:11434/v1` and `MODEL_NAME=<a model you have pulled>`.

Restart the API and worker after changing these. On a free plan of 8000 tokens per minute, a model
often refuses requests under load. Chat shows that as "The AI model isn't available right now." An
evaluation run waits and retries instead, takes roughly one minute per question, and holds a worker
for that time (ADR-023, ADR-024).

## Security posture (summary)

Tenant is derived from the verified session, never from request bodies. Every protected endpoint
checks a role permission; document content additionally requires collection access. Retrieval
filters by tenant and collection in the vector store **and** re-validates every hit in
PostgreSQL. Uploaded files are validated by content signature, size, archive expansion and macro
checks; stored under generated keys. Retrieved text is delimited as untrusted data in prompts;
citations are accepted only if they reference retrieved, authorized chunks, and a saved answer is
hidden if the reader loses access to its source. Logs and job errors never contain document text.
In production the API refuses unsafe configuration, demo accounts are off, the web app sends a
Content-Security-Policy and HSTS, and CI scans for secrets and vulnerable dependencies (the production
setup and the new CI jobs have not been run yet).
See [`Docs/SECURITY.md`](Docs/SECURITY.md) and the open risks in
[`Docs/PROGRESS.md`](Docs/PROGRESS.md). This is **not** a claim of production readiness.
