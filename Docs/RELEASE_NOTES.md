# RackFlow AI — Release Notes

## Unreleased — branch `ui-redesign-2026-10` (as of 2026-11-06)

Not merged and not tagged. This is still a development and pilot build, **not a production release**.
Final gate results go in `Docs/TESTING.md`. Until they are filled in, treat the items below as
implemented and checked by their owners, not as released.

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
- The Compose changes have not been executed. No CI result is recorded for this branch.
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
