# RackFlow AI — Progress Tracker

**Current phase:** UI redesign and bug fixes on branch `ui-redesign-2026-10`, awaiting the final gate and merge  
**Overall status:** v0.1.0 is the tagged pilot on `main`. The redesign and review fixes are implemented and owner-checked. **The final gate has not run, and this is not production ready.**  
**Last updated:** 2026-11-06  
**Rule:** The coding agent must update this file after every implementation session.

## Summary
- **Branches:** `main` and `origin/main` are at `7fbb85b` (tag `v0.1.0`). Local `ui-redesign-2026-10` is at `45cd0dd`, one commit ahead of its remote at `569d4e6`. About 70 files, including these docs, are modified and **uncommitted**.
- **Repository:** https://github.com/Official-Avi/Enterprise-RAG-system is **public** (reachable without signing in, checked 2026-11-06). Earlier documents call it private. Do not push without asking the owner.
- **Last full gate:** Stage 4 on 2026-11-06, before the review fixes: 233 backend tests, eslint, tsc, ruff, mypy, build, all Playwright specs.
- **Since then:** owner-level runs only. The last full backend run reported 350 passed, 1 failed. Final numbers are pending in `TESTING.md`.
- **Answer model on the local stack:** Groq, `qwen/qwen3.8-27b` through `openai_compatible`. Matched passages leave the machine. `extractive` stays the default in code and `.env.example`.
- **Running services:** the owners did not restart the API or worker, so the running stack may not include the latest backend fixes until `start-backend.ps1` runs again.
- **Environment:** Windows reinstalled 2026-11-01. Toolchain recreated 2026-11-05: Python 3.12 via uv, PostgreSQL 18.6, Qdrant 1.20.0, Node 26.13.0. No Docker.

## Phase status
Statuses reflect the last check of each phase, mostly v0.1.0 on 2026-10-27. Code in several phases has changed since, and those changes are covered by the final gate, which is pending.

| Phase | Name | Status | Evidence / notes |
|---|---|---|---|
| 0 | Repository and decisions | Verified | CI green at v0.1.0; no CI result recorded for this branch |
| 1 | Local foundation | Verified at v0.1.0 | Compose verified in CI then; **Compose changes on this branch not executed** |
| 2 | Authentication, tenancy, RBAC | Verified at v0.1.0; changed since | New sign-in limits and caps have tests; cross-tenant add awaits a decision (ADR-026); email invitations deferred (ADR-019) |
| 3 | Document ingestion and processing | Verified at v0.1.0; changed since | S3 adapter not started |
| 4 | Embeddings, vector index, retrieval | Verified at v0.1.0; changed since | Hybrid/rerank not started (optional) |
| 5 | RAG chat and citations | Verified at v0.1.0; changed since | Live answers with Groq checked by hand; retention policy not started |
| 6 | Operations and workload management | Verified at v0.1.0; changed since | No load test; load balancer guidance added, not exercised |
| 7 | Model serving and evaluation | Partially complete | **LLM evaluation incomplete: 7 of 13 scored;** retry not run against real Groq |
| 8 | Infrastructure / logical rack management | Verified at v0.1.0; changed since | Node and workload delete, PATCH null handling added |
| 9 | Monitoring, security, enterprise hardening | Partially complete | No tracing, backups, or CI dependency or secret scanning |
| 10 | Release and deployment | Partially complete | Clean install at v0.1.0 only; no staging or load tests |
| UI | Redesign (`DESIGN.md`) | Implemented; Stage 4 gate passed; later fixes owner-checked | Final gate pending; differences from the spec in `DESIGN.md` §12 |

## Open risks
Details and evidence are in `SECURITY.md` §10 and `TODO.md`.

1. **Cross-tenant membership add (owner decision, ADR-026):** an org_admin can add another tenant's user by email, revealing that the account exists and possibly changing their default sign-in tenant.
2. **Credentials to rotate (owner action):** the model API key appeared in a chat session; a local database password appeared in tool output; credentials from before the reinstall. No full malware scan is recorded.
3. **Data egress:** with Groq on, questions, retrieved passages and an earlier question for follow-ups leave the machine.
4. **Demo mode:** password-less org_admin access for anyone who can reach the site. Never on real data or a public address.
5. **Rate limits:** per API process. Without a load balancer, all Compose sign-ins share one address.
6. **Free-plan model limits:** chat returns `MODEL_OVERLOADED` under load. An evaluation run holds a worker for about 13 to 15 minutes, and uploads queue behind it with one worker.
7. **Stop does not cancel on the server:** the question and answer are saved and can feed follow-up search.
8. **Regression protection:** several fixes, including the blocker `safeNext` fix, have no permanent test.
9. **Demo data clutter:** test documents and leftover chats in the shared accounts, and leftover user `console-admin-test@example.com`.
10. **Not implemented:** backups and restore, TLS configuration, secret management, S3 storage, tracing, retention, malware scanning, SSO.

## Not verified
- Final gate results are in `TESTING.md`. `test_answer_is_withheld_once_access_can_no_longer_be_checked` now passes; the cause of its earlier failure was not reproduced.
- Docker Compose and CI on this branch: fixed web address, `DEMO_MODE` and `TRUSTED_PROXY_IPS` pass-through, curl retries. No CI result is recorded.
- Clean install using the current README.
- The Claude adapter against the live API.
- RAG and chat fixes beyond the full backend suites run by other owners; that owner's report was not received.
- Ask fixes against the real backend (browser checks used a mocked API); console writes against real data (stubbed); several landing edge cases (`TESTING.md`).
- `next start` behaviour for `X-Forwarded-For`.
- Load, backup and restore, real mobile devices, screen readers, Windows High Contrast.

## Latest session
### 2026-11-06 — Redesign finish, diff review and fixes
- Implemented: finished the UI redesign; Groq via `openai_compatible`; a 68-finding diff review (1 blocker, 14 major, 53 minor, some duplicates) followed by fixes from seven owners. See `RELEASE_NOTES.md` "Unreleased".
- Files changed: commit `45cd0dd`, plus the uncommitted working tree.
- Tests run and results: `TESTING.md` entries for 2026-11-05 and 2026-11-06. The final gate is pending.
- Manual verification: live Groq answers by hand. Browser scripts per owner, with the limits listed in `TESTING.md`.
- Decisions made: ADR-022 to ADR-025. ADR-026 awaits the owner.
- Deferred by owners: see `TODO.md`. Rejected: the reviewer's `FORWARDED_ALLOW_IPS` fix, because it would change nothing without a load balancer and would allow forged addresses (ADR-025).
- Blockers/risks: see "Open risks".
- Next steps: final gate, fix or explain the failing test, commit, restart services, reset demo data, merge locally, then ask before pushing. Production work follows on its own branch.
- TODO/PROGRESS updated: Yes

### 2026-11-05 — Reset laptop, setup and browser testing
- Implemented: fixed the build; set the backend up on the reinstalled laptop; added `scripts/dev/start-backend.ps1`.
- Tests run and results: 114 backend tests passed, ruff and mypy clean; browser E2E 49 of 53 (`TESTING.md`).
- Findings: 144 browser bugs (50 major, 0 blockers) and 182 spec gaps, worked through on 2026-11-06. Not all spec gaps are closed (`DESIGN.md` §13). ENV-1 from `LIVE_CHECK_REPORT.md` no longer reproduces.
- TODO/PROGRESS updated: at the time in project notes; recorded here on 2026-11-06.

### 2026-10-27 — Sprint Day 3: integration, verification, delivery
- Implemented: authentication release gate and other release-gate tests; Playwright browser E2E (5 specs); route-level permission gating and role-based landing; fixes for defects found by E2E; RAG logo and favicon; deployment guide (DEPLOYMENT.md §8); security status (SECURITY.md §9); release notes; final delivery report.
- Files changed: commits c8c4912, 0732c82, 883d4a9 and the Day-3 close commit.
- Tests run and results: backend 96/96; browser E2E 5/5 (Edge 156); web lint/tsc/build clean; dependency audits clean; clean install from GitHub passed; CI green (see TESTING.md).
- Manual verification: screenshot review of all main pages in light and dark mode.
- Decisions made: none new beyond ADR-021 (route gating is UI convenience; API remains the enforcement point).
- Day 3 acceptance: application starts from documented instructions (clean install); verified workflows operate (backend, browser, CI, live smoke); results recorded (TESTING.md); incomplete functionality documented (TODO.md, RELEASE_NOTES.md, DELIVERY_REPORT.md).
- Blockers/risks: no LLM configured; no backups/DR; no load tests; host malware (owner-accepted).
- Next steps: see DELIVERY_REPORT.md §13.
- TODO/PROGRESS updated: Yes

### 2026-10-27 — Sprint Day 2: enterprise infrastructure
- Implemented: member/role management with last-admin guard; collection access grants; audit log API; tenant settings API; logical racks/nodes/workloads with provenance rules and simulated seed; evaluation dataset v1, deterministic metrics, job-based runner and API; prompt-injection detector; shared ingestion service; UI pages for users, audit log, settings, racks (overview and detail with front view), evaluation and collection access management; GitHub repository and CI.
- Files changed: commit 7391027 (backend) and the Day-2 UI/docs commit.
- Tests run and results: backend 90/90; web lint/tsc/build clean; CI run 40512232777 green incl. Docker Compose smoke; live platform smoke passed (see TESTING.md).
- Manual verification: live stack through the web proxy (cookie sessions): admin/operator/auditor flows, seeded infrastructure, evaluation corpus indexed and evaluated by the worker with real embeddings; all 14 console pages served. UI still not inspected in a browser.
- Decisions made: ADR-019 (API deviations), ADR-020 (infrastructure provenance), ADR-021 (deterministic evaluation).
- Findings fixed: injection text quoted by extractive mode (found by the evaluation); non-idempotent evaluation seeding (found by a full-suite run); stopped worker shown as live in the infrastructure overview.
- Day 2 acceptance: core RAG workflow still passes (all Day-1 tests and live smoke); jobs have observable states (API and UI); failures handled (retry/backoff/cancel/crash-recovery tests); protected resources enforce authorization (role, tenant and collection tests across all modules).
- Blockers/risks: no real LLM configured (abstention 0.50 with extractive mode); host malware (owner-accepted); rate limits per process only; no tracing or backups.
- Next steps (Day 3): browser-level E2E if feasible; security review pass; clean-environment install check; README/DEPLOYMENT updates; final delivery report.
- TODO/PROGRESS updated: Yes

### 2026-10-27 — Sprint Day 1: core platform and RAG pipeline
- Implemented: foundation (config, logging, errors, 24-table tenant-scoped schema + migration, local auth with hashed sessions, CSRF, RBAC matrix, collection access); ingestion (validation, storage, PDF/DOCX/TXT/MD extraction, RapidOCR, quality, cleaning, chunking); PostgreSQL job queue with leases/backoff/cancel/reclaim, worker process with heartbeats; embeddings (FastEmbed), Qdrant adapter, idempotent indexing; permission-aware retrieval with PostgreSQL re-validation; grounded answers with verified citations; chat sessions; model providers (Claude, OpenAI-compatible, extractive); jobs/operations/models APIs; Next.js console (login, overview, collections, documents + upload, document detail, chat, job queue, workers, model serving, inspector); Dockerfiles, Compose, CI workflow.
- Files changed: see commits bbfefd3, 3396b4a, 7837b96, 7a83d94.
- Tests run and results: see TESTING.md "Results log" — 64/64 backend tests, web lint/tsc/build, live smoke (real embeddings) all passed.
- Manual verification: live API + worker + web standalone server exercised over HTTP (login cookie, CSRF, upload through proxy, question answered with citation). Not inspected visually in a browser.
- Decisions made: ADR-005 (PostgreSQL queue), ADR-006 (local auth), ADR-013 (owner accepted host risk), ADR-014/015 (portable services, RapidOCR), ADR-016/017/018.
- Process note: four parallel subagents were launched for Day 1 and were stopped by the owner before producing files; the lead engineer implemented the modules directly.
- Blockers/risks: GitHub push needs owner `gh auth login`; development host has active malware detections (owner-accepted); no real LLM configured (extractive default); Docker/CI unverified.
- Next steps (Day 2): HTTP tests for jobs/operations + duplicate-delivery test; admin users/roles/collection grants + audit log API/UI; tenant settings API/UI; logical racks/nodes/workloads API + simulated seed + UI; evaluation dataset + runner + UI.
- TODO/PROGRESS updated: Yes

### 2026-10-27 — Audit (start of 3-day sprint)
- Implemented: No code. Workspace audit, cross-document consistency review, requirements traceability, environment audit.
- Workspace: `Docs/` with 14 Markdown files only; no source code, no git repository. Nothing to preserve beyond the docs.
- Environment findings (verified):
  - Windows 11 Home, Ryzen 5 5600H (6C/12T), 15.4 GB RAM, ~181 GB free disk, NVIDIA RTX 3050 Laptop 4 GB VRAM.
  - Docker, WSL, PostgreSQL, Redis, Qdrant, Ollama, Tesseract: not installed.
  - Python: both installed interpreters are missing `python.exe` (unusable). uv 0.12.22, Node 24.21.0, npm 11.19.0, git 2.56.0 present.
  - No LLM/embedding API keys set in any environment scope.
  - **Security:** Microsoft Defender real-time and behaviour monitoring are disabled; Defender reports 101 threat entries, including an active executable-infecting virus and credential-stealer/RAT detections.
- Documentation conflicts found: job-state names, provenance labels, workspace vs tenant, chat session vs conversation, sync vs async deletion, missing login/settings endpoints, phase-gating vs sprint. Proposed resolutions: ADR-007 to ADR-010 in `DECISIONS.md`.
- Tests run: None (no code; no usable Python interpreter on host).
- Decisions made: Proposed ADR-005 to ADR-012; ADR-013 blocks building on this host.
- Blockers/risks:
  1. Development host must not be used for builds or credentials until cleaned (ADR-013).
  2. Owner decisions pending: LLM/embedding provider (ADR-011), auth/SSO scope (ADR-006), development environment.
- Next steps: Once a clean Linux + Docker environment is available, start Phase 0 (repo skeleton, git init, compose stack, tooling, `.env.example`), then the Day 1 vertical slice.
- TODO/PROGRESS updated: Yes

## Session log template
### YYYY-MM-DD — Phase N
- Implemented:
- Files changed:
- Tests run and results:
- Manual verification:
- Decisions made:
- Blockers/risks:
- Next steps:
- TODO/PROGRESS updated: Yes/No
