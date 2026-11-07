# Architecture Decision Log

Record decisions here before making changes that affect architecture or scope.

## ADR-001 — Modular monolith first
**Status:** Accepted baseline  
**Decision:** Start with a modular monolith API plus independent asynchronous workers.  
**Reason:** Easier to build, test, and operate for an MVP while preserving module boundaries.  
**Revisit when:** Team ownership, deployment isolation, or measured load justifies service extraction.

## ADR-002 — Logical rack interface in MVP
**Status:** Accepted baseline  
**Decision:** Model racks/nodes/workload placement as software inventory and label state provenance. No direct physical hardware control.  
**Reason:** Enables enterprise rack-oriented UX without falsely claiming hardware integrations.

## ADR-003 — Provider abstractions
**Status:** Accepted baseline  
**Decision:** Abstract embedding, vector DB, OCR, chat model, object storage, and queue providers.  
**Reason:** Avoid lock-in and enable local development/test providers.

## ADR-004 — Candidate small model
**Status:** Experiment only  
**Decision:** Qwen2.5-0.5B-Instruct may be benchmarked as a prototype model. It is not the mandatory or production default.  
**Reason:** Small parameter count can lower resource needs, but answer quality and concurrency must be measured. Verify license, hardware, language quality, and runtime compatibility before use.

## ADR-005 — Queue/worker semantics
**Status:** Superseded by "ADR-005 — Durable job queue on PostgreSQL" below  
**Decision required:** Select Celery or RQ and document delivery, persistence, retry, and recovery semantics.  
**Owner:** Coding agent/project team  
**Acceptance:** Integration test proves worker crash/retry and idempotent processing.

## ADR-006 — Authentication strategy
**Status:** Implemented as "ADR-006 (proposal)" below; SSO scope still awaits owner confirmation  
**Decision required:** Select secure session-based auth or a maintained OIDC-compatible provider/library.  
**Acceptance:** Role and tenant isolation tests pass; no custom cryptography.

## Proposed during the 2026-10-27 audit (3-day sprint)

### ADR-005 — Durable job queue on PostgreSQL (supersedes the Celery/Redis proposal)
- Status: Accepted 2026-10-27 — final acceptance when the worker-crash/retry/idempotency integration test passes.
- Context: The development host is Windows without Docker or admin rights. Celery does not support native Windows workers, RQ requires `fork()`, and Redis has no supported native Windows build. The README lists Redis + Celery/RQ as *proposed* defaults.
- Decision: `ProcessingJob` rows are both the authoritative state and the queue. Workers claim jobs with `SELECT … FOR UPDATE SKIP LOCKED`, hold a time-bounded lease renewed by heartbeat, and record every attempt in `JobAttempt`. Expired leases are reclaimed (crash recovery). Jobs are inserted in the same transaction as the document row (outbox-safe). Payloads carry IDs only.
- Alternatives: Celery + Redis (documented default; needs Linux containers), RQ (no Windows support).
- Consequences: One fewer infrastructure dependency; queue throughput is bounded by PostgreSQL (adequate for ingestion workloads; revisit with load tests). The `JobQueue` boundary (`rackflow.jobs`) allows a Celery/Redis transport later without changing handlers.

### ADR-014 — Local services without Docker; Docker Compose for deployment
- Status: Accepted 2026-10-27
- Decision: On the Windows development host, PostgreSQL 18 and Qdrant 1.20 run from portable binaries (`scripts/dev/start-services.ps1`, data under `.data/`, bound to 127.0.0.1). `docker-compose.yml` and Dockerfiles are maintained for Linux deployment and verified in CI (GitHub Actions), not on this host.
- Note: use `127.0.0.1`, not `localhost` — on this host IPv6 `::1` connections hang instead of being refused.

### ADR-015 — OCR provider: RapidOCR (ONNX) by default
- Status: Accepted 2026-10-27 (amends ADR-012)
- Decision: `rapidocr-onnxruntime` (Apache-2.0; pip-installable, no system binary) renders OCR for image-only PDF pages rendered with `pypdfium2`. Tesseract remains a possible alternative adapter behind `OCRProvider`.

### ADR-006 (proposal) — Local accounts + server-side sessions; OIDC adapter later
- Status: Proposed — awaiting owner confirmation that enterprise SSO is not required for the MVP.
- Decision: email/password accounts hashed with argon2id (`argon2-cffi`); opaque random session tokens stored hashed in PostgreSQL; delivered as `HttpOnly`, `Secure`, `SameSite=Lax` cookie through a same-origin web proxy; CSRF mitigated by required custom header on state-changing requests. Tenant is resolved from `TenantMembership`, never from request bodies. User invitations by email are deferred; admins create users directly.
- Alternatives: Keycloak/OIDC now (stronger enterprise story, ~half a day of setup and test-harness work).

### ADR-007 — Sprint execution mode and phase reordering
- Status: Proposed (owner sprint brief, 2026-10-27)
- Context: `AGENT_INSTRUCTIONS.md`/`README.md` require stopping after Phase 0/1 for review; the owner's 3-day sprint brief directs continuous autonomous delivery.
- Decision: For this sprint, work continuously and report at each Day gate. Build the full tenant-scoped schema and minimal real authentication on Day 1 *before* ingestion, so retrieval is permission-filtered from the first commit (avoids retrofitting). Full RBAC matrix, collection permissions, admin UI and audit land on Day 2.

### ADR-008 — Canonical names (resolves conflicts between documents)
- Status: Proposed
- Job states: `queued`, `running`, `retry_wait`, `succeeded`, `failed`, `cancelled` (PRD FR-041). "completed"/"retrying" in PRD Journey C are prose aliases; "dead-letter" means terminal `failed` plus an operator-visible event.
- `state_source`: `manual`, `simulated`, `integration`. UI badges: manual→Configured, simulated→Simulated, integration→Integration-reported, missing→Unknown.
- "Workspace" (API/UI) = `Tenant` (data model). `GET /workspaces` returns the caller's memberships.
- "Chat session" (API) = `Conversation` (data model).

### ADR-009 — Asynchronous document deletion
- Status: Proposed
- Decision: `DELETE /documents/{id}` returns 202, marks the document `deleting`, excludes it from retrieval immediately (PostgreSQL re-check after vector search), and enqueues a retryable deletion job (vectors → object storage → rows). Stored citations referencing deleted or no-longer-authorized documents are re-authorized on read and hidden if access is gone.

### ADR-010 — Tenant-scoped operations views
- Status: Proposed
- Decision: All roles are tenant-scoped. Job/queue views return only the caller's tenant data. Worker health is shown without tenant-identifying details. No cross-tenant "platform operator" role in the MVP.

### ADR-011 — Model and embedding providers
- Status: Decided for the current deployment by ADR-023 (owner chose Groq, 2026-11-06). The adapters below remain.
- Proposal: embeddings run locally (`fastembed` with `BAAI/bge-small-en-v1.5`, 384-d, no document egress). Chat model behind `ChatModelProvider` with three adapters: hosted API (Anthropic Claude), OpenAI-compatible endpoint (Ollama/vLLM, for Qwen2.5 experiments per ADR-004), and a deterministic mock clearly labelled for CI only.

### ADR-012 — Document parsing libraries (licence-aware)
- Status: Proposed
- Decision: `pypdf` (BSD) for text-layer PDFs, `pypdfium2` (Apache-2.0/BSD) to render pages for OCR, Tesseract (Apache-2.0) for OCR inside the worker image, `python-docx` (MIT) for DOCX. Avoid PyMuPDF (AGPL) to keep enterprise licensing clean.

### ADR-013 — Development host
- Update 2026-11-06: project notes record that Windows was reinstalled on this laptop on 2026-11-01 and that the environment fault ENV-1 no longer reproduces. Toolchains and local secrets were recreated on 2026-11-05. No full Defender scan is recorded, and credentials used on the old install still need rotating (see PROGRESS.md). `Docs/env` and `Docs/demo-password.txt` date from the old install, are git-ignored and must not be used.
- Status: Owner accepted risk 2026-10-27 — development proceeds on this host. Owner was informed of the malware findings and chose to continue. Mitigations: no secrets committed; `.env` git-ignored; services bound to 127.0.0.1.
- Original status: Blocked — awaiting owner
- Context: The 2026-10-27 environment audit found the current Windows host has active Microsoft Defender malware detections and real-time protection disabled; Python executables are missing/damaged.
- Decision: Do not install toolchains, run builds, or place credentials on this host. Development resumes in a clean Linux environment with Docker (cleaned/reimaged host, separate machine, or cloud dev environment).

### ADR-016 — Repository layout adapted from ARCHITECTURE §9
- Status: Accepted 2026-10-27
- Decision: One Python distribution `backend/` (package `rackflow`) holds the API, worker, ingestion, RAG, providers, jobs, ops and infra modules as sub-packages with explicit boundaries; the API (`rackflow.api`) and worker (`rackflow.worker`) are separate processes built from the same codebase (ADR-001). The web console is `apps/web`. Docs stay in `Docs/`.
- Alternatives: separate `apps/api`, `apps/worker`, `packages/*` Python distributions (more packaging overhead, shared models duplicated or published).
- Consequences: one dependency lock for API and workers; module boundaries enforced by package structure and provider interfaces rather than separate distributions.

### ADR-017 — Collection visibility and content permissions
- Status: Accepted 2026-10-27
- Decision: Collections are `tenant` (all content-capable members can read; engineers can write) or `restricted` (only creator, org_admin and explicit grants). Auditors never receive document content (metadata only). Every content path — retrieval, chunks, citations, download — uses `rackflow.auth.access`. Missing, foreign-tenant and forbidden resources return identical 404 responses.

### ADR-018 — Answer grounding contract
- Status: Accepted 2026-10-27
- Decision: The model receives numbered, delimited sources marked as untrusted; it must cite `[n]` or reply `INSUFFICIENT_EVIDENCE:`. Only markers referring to sources actually supplied survive; an answer with no valid citation is replaced by an "unverifiable" message and marked `insufficient`. Single-turn retrieval per question (no prior answers fed back), avoiding leakage from documents whose access was revoked. The extractive provider (no LLM) is the default until a model is configured and is labelled in UI and API.
- Amended 2026-11-06: prior *answers* are still never fed back. A question detected as a follow-up (`rag/evidence.py` `followup_context`) adds one earlier *user question*, at most 300 characters, to the search text and to the prompt as labelled context. Which documents the caller may see is still decided only in `retrieve`. See ADR-023 for marker handling.

### ADR-019 — Deviations from API_SPEC in the sprint
- Status: Accepted 2026-10-27
- `POST /admin/users/invitations` → replaced by `POST /admin/users`: no mail service exists, so admins add members directly; a one-time temporary password is returned once for new accounts (never for existing accounts, never logged). Email invitations remain future work.
- `PATCH /settings/model` → deferred; `GET /settings/model` is read-only. The model provider is configured by deployment environment so credentials never pass through the API or database (`ModelEndpoint.api_key_env` names an env variable only).
- Added (not in the original spec): `GET/PUT/DELETE /collections/{id}/permissions[/{user_id}]`, `DELETE /admin/users/{id}`, `GET/PATCH /settings/tenant`, `GET /infrastructure/overview`, `DELETE /infrastructure/racks/{id}`, `GET /evaluation/datasets`, `POST /evaluation/datasets/{version}/seed`, `GET /evaluation/runs`, `POST /retrieval/inspect`.

### ADR-020 — Provenance rules for the logical infrastructure registry
- Status: Accepted 2026-10-27
- Decision: API clients may register racks/nodes/workloads only as `manual` (configured) or `simulated`. `integration` is reserved for data the platform measures itself; today that is only RackFlow worker heartbeats, shown as live platform processes with healthy/stale/stopped health. A manually registered workload never reports an observed state (`unknown`) because nothing is measured. Utilisation is labelled as requested-vs-configured allocation, not usage. No endpoint deploys, starts or controls anything.

### ADR-021 — Deterministic evaluation (no LLM judge)
- Status: Accepted 2026-10-27
- Decision: Evaluation scores retrieval hit/MRR against labelled source documents, citation precision/correctness, expected-term recall, abstention on unanswerable questions, prompt-injection canaries and restricted-document leakage — all deterministic. Runs execute as queued jobs with the requesting user's permissions; auditors see scores but not questions/answers. An LLM judge may be added later only as an additional signal (TESTING.md).

### ADR-022 — UI redesign and shared demo accounts
- Status: Accepted (owner brief; spec approved 2026-10-29). Implemented on branch `ui-redesign-2026-10`; not merged to `main`.
- Context: The console-first interface was hard to demo and hard to use for someone with one document and one question.
- Decision:
  - One root layout with a public landing page, an `/ask` and `/library` workspace in plain language, and the existing console at its existing URLs. Details: `DESIGN.md`, `UI_DESIGN_SPEC.md`.
  - One-click demo personas (engineer, operator, admin, auditor) when `DEMO_MODE=true`. `POST /auth/demo` opens a session for the seeded account with no password. A dropped file with no session signs in as Engineer, the least-privileged uploader, never Admin.
  - `DEMO_MODE` defaults to off, and startup refuses it with `APP_ENV=production`.
  - The accounts are shared on purpose. A sticky, undismissable strip says so on every signed-in page, and `/ask` never auto-opens the latest chat.
- Alternatives: a persona picker on file drop (spec §13: rejected, one more click). A per-visitor sandbox tenant was not built.
- Consequences:
  - **Anyone who can reach a `DEMO_MODE=true` site can act as that tenant's org_admin without a password**, and sees everything other visitors upload. It must never run against real data or on a public address. The only technical guard is the `APP_ENV=production` check; a deployment with another `APP_ENV` value is not stopped.
  - The persona's session is not revoked by the next demo login, and `/auth/me` has no `is_demo` field, so the client detects demo sessions by email.
  - Test runs leave clutter in the shared accounts. Demo data must be reset before any presentation.
- Tests/evidence: `backend/tests/test_demo_login.py`, `apps/web/e2e/landing.spec.ts`, `roles.spec.ts`. Results: `TESTING.md`.

### ADR-023 — Groq through the `openai_compatible` provider; citation marker handling
- Status: Accepted for the current deployment 2026-11-06 (owner chose Groq over Claude). Decides ADR-011. Not a commitment for production.
- Context: The no-LLM extractive mode scored abstention 0.50 in evaluation and can only quote. The existing OpenAI-compatible adapter can reach Groq with configuration alone.
- Decision:
  - `MODEL_PROVIDER=openai_compatible`, `MODEL_BASE_URL` set to Groq's OpenAI-compatible endpoint, and a Groq model in `MODEL_NAME`. The key lives only in `.env`. `extractive` stays the default in `.env.example` and in the code.
  - `MODEL_NAME` is now required for `openai_compatible`: startup fails if it is blank. The old `qwen2.5:1.5b` fallback is removed.
  - Citations: `verify_citations` converts `【1】` and `【1†L3-L5】`, which gpt-oss models produce whatever the prompt asks, to `[1]`. It drops markers that do not refer to a supplied source and renumbers the rest 1..n in order of appearance, so numbers count this answer's sources. `MARKER_RE` accepts up to 3 digits.
  - Document text cannot forge citations: `rag/context.py` rewrites `[2]` and `【2】` in source text to `(2)` before the prompt, and neutralises `<source>` tags in any letter case.
  - The quote stored with a citation is the chunk sentence that best matches what the answer says from that source, never text flagged as an instruction.
  - The system prompt sets no formatting rule, and the client handles `**bold**` and heading markers. A "plain text only" rule was tried and removed: on Groq it caused wrong abstentions (`Docs/TESTING.md`, final gate).
- Alternatives: Claude (the owner chose Groq; the adapter remains and can be selected by configuration); a local model through the same adapter (not tried).
- Consequences:
  - **Data egress:** with Groq on, each question, the retrieved passages sent in the prompt and, for a follow-up, one earlier question leave the machine. Whole files and embeddings do not.
  - Free-plan rate limits (8000 tokens per minute observed) refuse many requests under load. Chat surfaces this as `MODEL_OVERLOADED`; evaluation waits (ADR-024).
  - `OpenAICompatibleProvider` and `AnthropicProvider` do not pass on a `Retry-After` header.
- Tests/evidence: `backend/tests/rag/test_citation_markers.py`, `test_rag.py`. Live check 2026-11-06 with `qwen/qwen3.8-27b`: correct cited answers, follow-up, abstention, injection refusal. Evaluation with this model is incomplete; see `TESTING.md`.

### ADR-024 — Evaluation waits and retries on a busy model
- Status: Accepted 2026-11-06. Implemented with mocked sleep in tests; **not yet run against real Groq**.
- Context: A 13-question run on an 8000 tokens-per-minute plan failed 6 questions with `MODEL_OVERLOADED`, so the abstention, restricted and injection categories were not scored.
- Decision (`evaluation/runner.py`):
  - On `MODEL_OVERLOADED`, wait 5, 15, 30, 65, 65 seconds, about 180 seconds per question. If the error carries `retry_after`, wait that plus 1 second, up to 120 seconds; a longer value fails the question at once. Providers do not set this today, so the fixed schedule applies.
  - Waits run in 5-second ticks that check for cancel, renew the job lease and hold no open transaction.
  - After a question uses all its waits, later questions get one try each until the model answers again, so a dead model costs about 180 seconds rather than 39 minutes.
  - A run with any errored question ends as `completed_with_errors`, never `completed`.
- Not done: per-minute token pacing; retrying in the chat path, which still returns `MODEL_OVERLOADED` straight away.
- Consequences:
  - A run on that plan takes roughly one minute per question, about 13 to 15 minutes, and holds a worker for that time. With one worker, uploads queue behind it. A dedicated worker is possible: `python -m rackflow.worker.main --job-types evaluation_run`.
  - Results are stored only at the end of a run, so a worker crash mid-run spends the tokens again on the next attempt.
- Tests/evidence: `backend/tests/test_ops_bugs.py` (patched `_sleep`, including a simulated model allowing one question per minute: all 13 scored, 0 errors).

### ADR-025 — Client addresses and `TRUSTED_PROXY_IPS`
- Status: Accepted 2026-11-06. Unit tested; **the Compose network part has not been executed** (no Docker on the development host).
- Context: Browsers reach the API through the web container's `/api` rewrite, so in Compose every sign-in shares one client address, and rate limits become global. A throwaway Next 16.4.3 app against an echo server showed that the rewrite adds no `X-Forwarded-For` of its own and passes a client-supplied one through unchanged. That test used `next dev`; `next start` was not run.
- Decision:
  - Rate limiting uses `ratelimit.client_ip`: the connecting peer, unless `TRUSTED_PROXY_IPS` lists that peer. Then `X-Forwarded-For` is read from the right, and the first address that is not a trusted proxy is the client. Malformed values fall back to the peer.
  - `TRUSTED_PROXY_IPS` defaults to empty. It is validated at startup and refuses `*`, hostnames and `/0`.
  - Compose gives `web` the fixed address `172.30.0.10`, with an `ip_range` so no other container can take it. Compose still trusts nobody by default.
  - An operator with a load balancer sets `TRUSTED_PROXY_IPS=172.30.0.10` and makes the load balancer set the header. Port 3000 must then be reachable only through that load balancer, or clients can forge their address.
- Alternatives: `FORWARDED_ALLOW_IPS` on uvicorn trusting the web container (rejected: it changes nothing without a load balancer, and allows forgery if port 3000 is exposed); a hop that stamps the socket address, such as a reverse proxy or Next server wrapper (the proper fix, deferred as a design change).
- Consequences:
  - **Without a load balancer, all Compose traffic still shares the web container's address.** This is tolerable only because port 3000 binds to loopback.
  - uvicorn's default trust of 127.0.0.1 lets a local process send `X-Forwarded-For` through :3000 or :8000 in local development.
  - IPv6 clients behind a trusted proxy are limited per address, not per /64. There is no IPv6 path in the current deployment.
  - Limits remain per API process.
- Tests/evidence: `backend/tests/test_infra_auth_bugs.py`.

### ADR-026 — Adding a user who belongs to another tenant
- Status: **Awaiting owner decision.** The code is unchanged; do not change it without one.
- Context: `POST /admin/users` (`create_member` in `routers/admin.py`) adds any existing account by email to the caller's tenant. An acme org_admin can therefore add a globex user. This:
  - reveals that the account exists: a `temporary_password` comes back only for a new account, and the `new_account` audit flag differs;
  - adds the membership with no consent from the user;
  - can change that user's default sign-in tenant, because `login` picks the first active membership ordered by tenant name when no `tenant_slug` is given.
- Options:
  1. Keep as is, and document it as how accounts work.
  2. Require acceptance by the invited user.
  3. Refuse an email that already has an account elsewhere, with a neutral response.
  4. Make the default sign-in tenant explicit and stable, whichever of the above is chosen.
- Consequences until decided: an open risk in `PROGRESS.md` and `SECURITY.md`.

## Change template
### ADR-XXX — Title
- Status: Proposed / Accepted / Superseded
- Context:
- Decision:
- Alternatives:
- Consequences:
- Tests/evidence:
