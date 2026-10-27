# RackFlow AI — Release Notes

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
