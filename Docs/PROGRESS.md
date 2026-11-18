# RackFlow AI — Progress Tracker

**Current phase:** Stage 6, production hardening, on branch `production-hardening-2026-11`  
**Overall status:** v0.1.0 is the tagged pilot. The UI redesign is merged into local `main` (`5648c83`). Stage 6 is implemented and unit-tested but **uncommitted, and nothing that needs Docker or GitHub Actions has run. This is not production ready.**  
**Last updated:** 2026-11-08  
**Rule:** The coding agent must update this file after every implementation session.

## Summary
- **Branches:** `production-hardening-2026-11` was cut from local `main` at `5648c83` (merge of `ui-redesign-2026-10`). Stage 6 changes are in the working tree, **uncommitted**. Whether `5648c83` is pushed is not recorded here.
- **Repository:** https://github.com/Official-Avi/Enterprise-RAG-system is **public** (checked 2026-11-06). Do not push without asking the owner.
- **Stage 6 result:** backend 516 passed, 2 skipped (POSIX only), 0 failed, owner-reported after the review fixes; restore drill passed on the local stack; web tsc and eslint clean; CSP checked in a browser. Details: `TESTING.md` "Stage 6".
- **Go-live procedure:** `PRODUCTION_CHECKLIST.md`. Decisions: ADR-027 to ADR-034.
- **Answer model on the local stack:** Groq, `qwen/qwen3.8-27b` through `openai_compatible`. Matched passages leave the machine. `extractive` stays the default in code, `.env.example` and the generated production env.
- **Running services:** the shared API and worker on :8000 were not restarted during Stage 6, so they still run the pre-Stage-6 code (no new readiness check, no demo-account guard).
- **Environment:** Windows reinstalled 2026-11-01. Python 3.12 via uv, PostgreSQL 18.6, Qdrant 1.20.0, Node 26. No Docker.

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
| 9 | Monitoring, security, enterprise hardening | Partially complete | Stage 6: production config refusals, password policy, readiness consistency, backups with a passed local drill, CI audit and secret-scan jobs (not yet run). No tracing; pip-audit red until pypdf is bumped |
| 10 | Release and deployment | Partially complete | Stage 6: Caddy TLS overlay, hardened images, `generate_env.py`, `bootstrap-admin`, go-live checklist; **none executed** (no Docker). Clean install at v0.1.0 only; no staging or load tests |
| UI | Redesign (`DESIGN.md`) | Implemented; Stage 4 gate passed; later fixes owner-checked | Final gate pending; differences from the spec in `DESIGN.md` §12 |

## Open risks
Details and evidence are in `SECURITY.md` §10 and `TODO.md`.

1. **Cross-tenant membership add (owner decision, ADR-026):** an org_admin can add another tenant's user by email, revealing that the account exists and possibly changing their default sign-in tenant.
2. **Credentials to rotate (owner action):** the Groq API key appeared in a chat session; a local database password appeared in tool output; credentials from before the reinstall. No full malware scan is recorded.
3. **Data egress:** with Groq on, questions, matched passages and an earlier question for follow-ups leave the machine.
4. **Production setup never executed:** the Caddy overlay, images, CI jobs and backups against Docker volumes are checked statically only. The first real run may find problems.
5. **pip-audit gate red:** pypdf 6.21.2 has 7 advisories; bump to 6.21.4 before merging.
6. **Demo mode:** password-less org_admin access for anyone who can reach the site. Never on real data or a public address. Production refuses it.
7. **Rate limits:** per API process. Without Caddy (development Compose), all sign-ins share one address.
8. **Free-plan model limits:** chat returns `MODEL_OVERLOADED` under load. An evaluation run holds a worker, and uploads queue behind it with one worker.
9. **Stop does not cancel on the server:** the question and answer are saved and can feed follow-up search.
10. **Regression protection:** several UI fixes have no permanent test; the new web security headers and the Compose overlay rules have no test in the repository yet.
11. **Demo data clutter:** test documents and leftover chats in the shared accounts, and leftover user `console-admin-test@example.com` (not recorded as cleaned).
12. **Not implemented:** backup encryption and off-host copy, managed secret store, S3 storage, tracing, retention, malware scanning of uploads, SSO.

## Not verified
- Stage 6 without Docker or GitHub: `docker compose config`/`up` with the overlay, `caddy validate`, TLS issuance, image builds, read-only roots, Qdrant key enforcement, every new CI job, backups against Docker volumes or a keyed Qdrant, POSIX file modes (`TESTING.md` "Stage 6").
- Docker Compose and CI changes since v0.1.0. No CI result is recorded since then.
- Clean install using the current README.
- The Claude adapter against the live API.
- RAG and chat fixes beyond the full backend suites run by other owners; that owner's report was not received.
- Ask fixes against the real backend (browser checks used a mocked API); console writes against real data (stubbed); several landing edge cases (`TESTING.md`).
- `next start` behaviour for `X-Forwarded-For`.
- Load, real mobile devices, screen readers, Windows High Contrast. Backup and restore: drill passed on the local Windows stack only.

## Latest session
### 2026-11-07 to 2026-11-08 — Stage 6: production hardening
- Implemented, by eleven owners in parallel, then a diff review (14 findings: 4 blocker, 5 major, 5 minor, including duplicates) and fixes:
  - Production configuration refusals in `core/config.py`, `WEB_PROXY_TIMEOUT_SECONDS` (ADR-027).
  - `bootstrap-admin`, CLI password policy, production guard on demo seeding, demo sign-in off in production; demo accounts protected and last-admin locking in `routers/admin.py` (`create_member` untouched) (ADR-029).
  - Readiness `vector_collection_consistent`, bounded probes, dependency-free liveness (ADR-031).
  - `scripts/ops/backup.py`, `restore.py` and their runbook with retention and the restore drill (ADR-030); `generate_env.py` and `deploy/env.production.example`.
  - Caddy TLS service, `deploy/compose.prod.yml` overlay with restart policies, read-only roots, dropped capabilities and a required Qdrant key; client-address chain trusting web and Caddy (ADR-028).
  - Two-stage backend and three-stage web images, non-root, HEALTHCHECKs, stricter `.dockerignore`.
  - Web CSP, COOP and production HSTS; `API_PROXY_TIMEOUT_MS` derived from one timeout variable (ADR-032, ADR-033).
  - CI: SHA-pinned actions, least-privilege token, new `e2e`, `secrets`, `audit-python`, `audit-web` jobs, image builds; Dependabot (ADR-034).
  - E2E: `test:e2e:ci`, `E2E_DEMO_PASSWORD`, configurable output folders.
- Review blockers fixed: worker and migrate inheriting the API healthcheck (fixed in both the image and Compose); two production-settings tests and two readiness tests out of date. Majors fixed: Qdrant key never passed to containers, no restart policies, Compose disaster recovery leaving root-owned files (`--chown`). Minors fixed: owner-only backup files, privilege drop, one HSTS policy, one timeout variable, a starter document so the CI e2e job cannot pass on skipped tests. Open: pypdf advisories (lock not bumped; no owner holds `uv.lock`).
- Tests run and results: `TESTING.md` "Stage 6". Backend 516 passed, 2 skipped, 0 failed (owner-reported); restore drill passed 2026-11-07.
- Not run: Docker, Caddy, GitHub Actions. This documentation pass re-read the code and configuration but ran no suite.
- Decisions made: ADR-027 to ADR-034; ADR-025 amended. ADR-026 still awaits the owner.
- Next steps: `TODO.md` "To do before merging this branch", then `PRODUCTION_CHECKLIST.md` on a staging host.
- TODO/PROGRESS updated: Yes

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
