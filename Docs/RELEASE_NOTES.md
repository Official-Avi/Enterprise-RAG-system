# RackFlow AI — Release Notes

## Unreleased — branch `production-hardening-2026-11` (Stage 6, as of 2026-11-08)

Not committed, not merged, not tagged. **Not a production release:** the production setup below has not
been run, because the development machine has no Docker and nothing has been pushed to CI. Follow
`Docs/PRODUCTION_CHECKLIST.md` on a staging host before any real use.

### New
- **Production deployment with TLS:** a Caddy service (`--profile prod`) and the overlay
  `deploy/compose.prod.yml`. Only ports 80 and 443 are published; restart policies; read-only roots,
  no capabilities and `no-new-privileges`; Qdrant requires an API key. Runbook: `deploy/README.md`
  (ADR-028).
- **`scripts/ops/generate_env.py`** writes a production `.env` with fresh secrets, never prints them,
  never overwrites without `--force`. Reference: `deploy/env.production.example`.
- **`rackflow-admin bootstrap-admin`** creates a tenant's first org_admin (ADR-029).
- **Backups:** `scripts/ops/backup.py` and `restore.py` with checksummed manifests, retention
  (`--keep N`), refusal of non-empty targets, `--chown` for containers, and a restore drill. Runbook:
  `scripts/ops/README.md` (ADR-030).
- **Readiness** reports `vector_collection_consistent` and returns 503 when indexed documents have lost
  their vectors (ADR-031).
- **Web security headers:** Content-Security-Policy, Cross-Origin-Opener-Policy, and HSTS in production
  (ADR-033).
- **CI gates:** Playwright with the axe gates, gitleaks, pip-audit, npm audit, image builds; actions
  pinned to SHAs; Dependabot (ADR-034).
- **E2E:** `npm run test:e2e:ci`, `E2E_DEMO_PASSWORD`, and `E2E_OUTPUT_DIR`/`E2E_REPORT_DIR`/
  `E2E_SCREENSHOT_DIR`.

### Changed: production now refuses to start on unsafe settings (ADR-027)
With `APP_ENV=production`: a missing, default (`rackflow`), user-name or under-16-character database
password; non-https `WEB_ORIGIN` or `API_BASE_URL`; a remote Qdrant or model endpoint without https and
a key; `LOG_LEVEL` DEBUG/NOTSET; `MODEL_TIMEOUT_SECONDS` not below `WEB_PROXY_TIMEOUT_SECONDS`. Errors
name the variable and never echo its value. **Check a production `.env` against `DEPLOYMENT.md` §8.2
before upgrading.** Development settings are unchanged.

### Changed: accounts
- Accounts created by the CLI must meet a password policy (12+ characters, not common, no email name).
  `seed-demo` with a weak `RACKFLOW_SEED_PASSWORD` now exits 2 without writing anything.
- `seed-demo` and `seed-eval` refuse `APP_ENV=production` without `--allow-in-production`.
- Demo sign-in is off in production even if `DEMO_MODE` were forced on.
- While `DEMO_MODE` is on, the shared demo accounts cannot have their role changed or be removed (409
  `DEMO_ACCOUNT_PROTECTED`). Two admins can no longer demote each other at the same moment and leave a
  workspace with no admin.

### Changed: containers and configuration
- Images: two-stage backend on `python:3.12.16-slim-trixie`, three-stage web on
  `node:24.22.2-alpine3.24`, both UID/GID 10001 (the same UID as before, so existing volumes stay
  usable), HEALTHCHECKs, stricter `.dockerignore`. Builds need BuildKit.
- New settings: `WEB_PROXY_TIMEOUT_SECONDS` (API, default 120) and `API_PROXY_TIMEOUT_MS` (web build,
  default 120000). Compose derives the second from the first (ADR-032). Compose now also passes
  `VECTOR_STORE_API_KEY` and `MODEL_TIMEOUT_SECONDS`.
- The API healthcheck in Compose probes `/api/v1/health/live`; worker and migrate have none.
- `/health/live` no longer depends on anything.

### Known limitations
- Nothing needing Docker, Caddy or GitHub Actions has been executed (`Docs/TESTING.md` "Stage 6").
- The `audit-python` gate fails until pypdf is bumped from 6.21.2 to 6.21.4.
- The CSP allows inline scripts. Backups are not encrypted or copied off the host. Readiness does not
  catch partial vector loss. Passwords set through the admin API skip the new policy.
- Cross-tenant membership add (ADR-026) is unchanged and awaits the owner.

### Upgrade
No migration changed. Restart the API and worker after updating. A production deployment must
regenerate or check its `.env` (new refusals), and needs `VECTOR_STORE_API_KEY` and
`QDRANT__SERVICE__API_KEY` under the overlay; note that adding a key to an existing Qdrant volume makes
every keyless client fail.

## Redesign — branch `ui-redesign-2026-10` (as of 2026-11-06; merged to `main` in `5648c83`, not tagged)

Merged locally into `main`, not tagged. This is still a development and pilot build, **not a production
release**. Final gate results are in `Docs/TESTING.md`.

### New
- **Landing page** with upload card, demo accounts, How it works, Features and Questions.
- **`/ask` workspace:** chat history with rename and delete, upload from the chat (drag, paste, attach),
  scope picker, sources panel, and a question that waits for a file still being read.
- **`/library`, "My documents":** search, filters, and row actions gated to match the API.
- **One-click demo accounts** behind `DEMO_MODE`, off by default and refused in production. They have no
  password and are shared, so use them only for demos (ADR-022).
- **Groq and other hosted models** through `openai_compatible` (ADR-023).
- **Evaluation waits on a busy model** instead of recording an error (ADR-024). Not yet run against real
  Groq.
- **`TRUSTED_PROXY_IPS`** for rate limiting behind a load balancer (ADR-025).
- **API:** `GET`/`POST /auth/demo`, `PATCH`/`DELETE /chat/sessions/{id}`, `DELETE /infrastructure/nodes/{id}`
  and `/workloads/{id}`, `content_withheld`, `document_deleted`, the `completed_with_errors` run status,
  and `Retry-After` on 429 (`Docs/API_SPEC.md`).

### Fixed: security and access
- **Open redirect** in `?next=` at sign-in: values such as `/.//evil.example` could send users to another
  site after signing in.
- After access is revoked, a saved answer is now hidden, not only its citations. The answer text can be
  verbatim document content.
- Evaluation run details no longer show questions and answers to readers without access to all the
  run's collections.
- Anonymous clients could flood a tenant's audit log through failed sign-ins. Rows are now capped.
- `/operations/workers` no longer reveals activity from other tenants.
- A rejected sign-in by an account with no active tenant keeps its real reason in the audit log and is
  not written to an unrelated tenant's log.
- Document text can no longer forge citations with `[n]` or break out of its delimiters with `</SOURCE>`.
- Failed database statements no longer put bound parameters in tracebacks.
- Console: Delete requires write access, Manage access requires `collection:manage`, and Try again
  follows the API's rules.

### Fixed: answers and documents
- DOCX, TXT and Markdown citations no longer claim "page 1".
- Citation numbers count this answer's own sources. `【1】` markers from gpt-oss models are recognised.
- Follow-up questions use the earlier question for context. Quotes pick the sentence that supports the
  claim. In extractive mode a sentence must now cover most of what is asked before it counts as evidence.
- `reindex --include-failed` no longer brings back documents the user asked to delete.
- Retrying an out-of-date ingest job no longer takes a healthy document out of search, and a deleted
  file's old job can no longer bring its content back.
- Orphan vectors are removed when a delete overtakes a running ingest.
- A re-upload into a full workspace reports a duplicate instead of a quota error. A crafted DOCX no
  longer fails the whole batch with a 500. UTF-16 text with a BOM is accepted.
- Explicit `null` in an infrastructure PATCH returns 422 instead of 500. Fractional CPU is reported
  correctly.

### Fixed: interface
- Landing Cancel reports what was already stored and offers to remove it. An expired real session is
  no longer moved silently onto the shared demo account. The two upload cards no longer run at once.
- The FAQ's data-flow answers hold for any model provider.
- Console Documents has real paging, and document detail has Load more. Documents past the newest 100
  used to disappear with no notice.
- Failed deletes show "Delete again" instead of Retry. Audit shows "Not signed in" and offers the
  `auth.access_denied` filter. Prepare corpus reports refused files.
- A long title with an emoji at the cut point no longer causes a 422. Re-sending a failed question uses
  the current scope. A deleted chat shows a clear state and keeps your question. Drafts are tied to the
  account that wrote them.

### Changed configuration
- `MODEL_NAME` is required with `MODEL_PROVIDER=openai_compatible`, and startup fails if it is blank. The
  `qwen2.5:1.5b` fallback is gone. **Check your `.env` before upgrading.**
- Compose now passes `DEMO_MODE` and `TRUSTED_PROXY_IPS`, and uses a fixed subnet, 172.30.0.0/24.
- New local start script: `scripts/dev/start-backend.ps1`.

### Known limitations added or still open
- Evaluation with Groq scored all 13 questions, but one answerable question (`r1`) is still wrongly refused:
  false abstention 0.09 against 0.00 with no LLM (`TESTING.md`, final gate).
- The Compose changes had not been executed at the time. No CI result is recorded for this branch.
- Stop does not cancel on the server. Markdown tables and lists show as plain text.
- With a hosted model on, questions and retrieved passages leave the machine.
- The limitations under v0.1.0 below still apply, except that an LLM can now be configured and has been
  exercised. The full open list is in `Docs/PROGRESS.md`.

### Upgrade
No migration has changed since v0.1.0. Restart the API and worker after updating, because they do not
reload. Documents already indexed keep their stored page values; non-PDF citations no longer show them.

## v0.1.0 — sprint release (2026-10-27)

First working release of RackFlow AI, an enterprise RAG infrastructure and management platform.
It is a **development/pilot release**, not a production release (see Known limitations).

### Highlights
- **Document-to-answer pipeline** — upload PDF, DOCX, TXT or Markdown; content-signature
  validation, zip-bomb/macro rejection, duplicate detection, text extraction, OCR for image-only
  PDF pages, quality scoring, conservative cleaning, token-budgeted chunking with overlap, local
  embeddings (BAAI/bge-small-en-v1.5) and tenant-filtered Qdrant indexing.
- **Grounded answers with verifiable citations** — permission-aware retrieval re-validated in
  PostgreSQL, delimited untrusted sources, citations accepted only when they reference retrieved
  chunks, explicit insufficient-evidence answers, verbatim source quotes.
- **Durable job system** — PostgreSQL queue with leases, exponential backoff with jitter,
  cancellation, manual retry, crash recovery (verified by killing a worker process), per-stage
  history and worker heartbeats.
- **Enterprise controls** — local accounts with server-side sessions, four roles, tenant
  isolation, restricted collections and grants, audit log, tenant settings and quotas, rate limits.
- **Operations** — overview dashboard, job queue, workers, model serving health/metrics.
- **Logical infrastructure** — racks, nodes and workload placement with mandatory provenance
  (configured / simulated / integration-reported); no hardware control.
- **Evaluation** — versioned 13-question dataset across 7 categories and a deterministic,
  job-based evaluation runner.
- **Web console** — Next.js console with light/dark themes and the RAG logo; permission-aware
  navigation and route gating.
- **Model providers** — Claude (`claude-opus-5-5`), any OpenAI-compatible endpoint (e.g. Ollama),
  or the built-in extractive mode (no LLM, clearly labelled; current default).

### Quality evidence
Backend and browser test suites, CI (incl. Docker Compose) and live smoke tests — see
`Docs/TESTING.md` "Results log" for every command and result.

### Fixed during the sprint (found by tests)
1. Extractive mode echoed a prompt-injection canary from a document (found by the evaluation).
2. Evaluation seeding was not idempotent (generated PDF embedded the current time).
3. A stopped worker was shown as a live platform process.
4. Chat page crashed in current Chromium/Edge (`scrollIntoView` now returns a Promise).
5. Users without `ops:read` landed on an access-denied Overview; pages fired forbidden requests.
6. Overview throughput chart rendered empty bars (CSS height).
7. Extractive answers quoted Markdown headings.

### Known limitations
- **No LLM configured by default** — answers are extractive quotations; abstention on
  unanswerable questions measured at 0.50 in this mode. Configure `MODEL_PROVIDER` for an LLM.
- **No backups / disaster recovery**; no S3-compatible storage adapter (local volume only).
- **No load testing** — no throughput or concurrency claims are made.
- **Rate limits are per API process**; not shared across replicas.
- **No SSO/OIDC, email invitations, retention policies, encryption at rest, malware scanning.**
- **No tracing/alerting**; logs are structured JSON on stdout.
- **Dependency and secret scanning are manual**, not CI gates.
- **Browser E2E** runs locally against a live stack (not in CI); accessibility is not audited.
- **Evaluation corpus is small and synthetic** (13 questions); results are indicative only.
- Development host had active malware detections during the sprint (owner-accepted, ADR-013).

### Upgrade / install
Fresh install only (first release). Follow the root `README.md`; apply migrations with
`alembic upgrade head`.
