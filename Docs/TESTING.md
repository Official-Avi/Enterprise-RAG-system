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

## Running the tests locally

- **Backend:** `pytest` needs PostgreSQL, Qdrant and `TEST_DATABASE_URL` in the process environment. A
  line in `.env` is not read. Unset, it falls back to CI's login, which fails locally with setup errors.
  The database name must contain `test`, and every session **drops its public schema**.
- **Parallel runs** need their own database and `TEST_VECTOR_COLLECTION` (prefix `rackflow_test_`), or
  they drop each other's schema. Commands are in the root README and `backend/tests/conftest.py`.
- **Backend test settings:** the suite forces `EMBEDDING_PROVIDER=hash` and `MODEL_PROVIDER=extractive`,
  so no model is called.
- **Browser:** `npm run test:e2e` in `apps/web` runs against an already-running stack with
  `DEMO_MODE=true`, with one worker, in Edge by default on Windows. The engineer journey asks one live
  question. See `apps/web/README.md`.
  - `npm run test:e2e:ci` turns on CI mode (also on when `CI` is set): retries 1, `forbidOnly`, an HTML
    report, and Playwright's Chromium unless `E2E_BROWSER_CHANNEL` is set.
  - The demo password is read from `E2E_DEMO_PASSWORD`, then the older `E2E_PASSWORD`, then
    `E2E_PASSWORD_FILE` or `.data/demo-password.txt`.
  - Output folders: `E2E_OUTPUT_DIR` (default `test-results`), `E2E_REPORT_DIR` (default
    `playwright-report`), `E2E_SCREENSHOT_DIR` (default `test-results/screenshots`). Point them outside
    the repository for scratch runs.
- **CI** (`.github/workflows/ci.yml`) runs on pushes to `main`, pull requests and manual dispatch. Since
  Stage 6 it has seven jobs: `backend` (ruff, mypy, pytest), `web` (eslint, tsc, build), `e2e` (full
  stack, Playwright including the axe gates), `secrets` (gitleaks), `audit-python` (pip-audit),
  `audit-web` (npm audit) and `compose-smoke` (image builds plus the Compose stack). **None of the new
  jobs has run on GitHub yet.** CI still does not check that `/` builds as Static.
- **Tests that never run here:** POSIX-only tests (file modes 0600/0700 for `generate_env.py` and
  `backup.py`) are skipped on Windows, so a Windows run reports 2 skipped.

---

## Stage 6 — production hardening, branch `production-hardening-2026-11`, 2026-11-07 to 2026-11-08

Uncommitted working tree on top of `5648c83`. Windows 11, Python 3.12, PostgreSQL 18.6, Qdrant 1.20.0,
Node 26. **No Docker on this machine and nothing pushed**, so no container was built or started and no
GitHub Actions job ran. The results below are **as reported by each owner**; this documentation pass
re-read the code and configuration they describe but did not re-run the suites. Every owner used a
private database `rackflow_test_<owner>` and collection, dropped afterwards.

### Backend suite

| When | Result | Notes |
| --- | --- | --- |
| Build round (each owner, while others were editing) | 412 to 506 passed, 4 or 5 failed | The same 4 failures in every run: two older production-settings tests broken by the new https rules, and two `test_foundation` readiness tests that expected the old check set. Wall times of about 12 h came from the machine sleeping. |
| After the review fixes (config, backups, TLS and envgen owners, separate runs) | **516 passed, 2 skipped, 0 failed** (about 9.5 to 11 min) | The 2 skips are POSIX file-mode tests. The 4 earlier failures were fixed in `test_security_gates.py`, `test_demo_login.py` and `test_foundation.py`. |

New test files: `test_production_config.py` (56), `test_production_credentials.py` (33),
`test_admin_personas.py` (10), `test_readiness.py` (15, against real PostgreSQL and Qdrant),
`test_backup_scripts.py` (42 passed + 1 POSIX-only), `test_generate_env.py` (14 + 1 POSIX-only).
ruff and mypy were reported clean on every owner's files. Pre-existing mypy findings in
`test_security_gates.py` (lines 32, 48, 61) were not touched.

### Other checks

| Area | Check | Result |
| --- | --- | --- |
| Restore drill | `backup.py` on the live local stack, then `restore.py` into `rackflow_restore_drill` | Exit 0; 25 tables and 7,652 rows, 9 Qdrant points, 9 files and 634,563 bytes all matched; re-run without `--force` refused all three targets; with `--force` matched. Retention kept a decoy directory without a manifest. Cleaned up. 2026-11-07 |
| Readiness probe client | probe pointed at a socket that never answers | `point_count()` raised after 3.0 s |
| Compose and Caddy | script parsing and merging both files (with `!reset`, `:-`, `:?`), then the merged API environment through the real `Settings` | OK; a mutated copy (HSTS `includeSubDomains`, migrate healthcheck back on, `restart: "no"`) failed with 8 errors. Script is in the TLS owner's scratch folder, **not in the repository** |
| Client addresses | `ratelimit.client_ip` with `TRUSTED_PROXY_IPS=172.30.0.10,172.30.0.11` | Real client returned for web peer with one or two header entries; untrusted peer with a header gets its own address |
| Dockerfiles | hadolint 2.12.0; build-context script; base tags looked up on the registries | Clean; no `.env`, `.data`, tests or e2e sign-in state in either context. Images not built |
| Backend HEALTHCHECK | the exact command run with simulated roles | worker and migrate exit 0 with nothing listening; api exits 1 with nothing listening and 0 against the live API |
| Web build | scratch copy, `next build` with `API_PROXY_TIMEOUT_MS=180000`, standalone server | Built; value baked into `server.js`; an invalid value fails the build at config load |
| Web headers | Playwright (Edge) with a `securitypolicyviolation` listener on landing, login, demo sign-in, `/ask`, `/library` | 0 violations on dev, `next start` and the standalone server; a negative control was reported. HSTS only in production |
| Web | `npx tsc --noEmit`, eslint on changed files | Exit 0 |
| E2E | `npm run test:e2e:ci` and local mode on landing, a11y and one roles test against dev :3000 | 29 to 30 passed per run; `E2E_DEMO_PASSWORD` took precedence over a decoy password file. Full suite not run (shared sign-in limits) |
| CI workflow | PyYAML parse, actionlint 1.7.12 (shellcheck off) | Clean |
| CI e2e job, backend half | the job's real steps run locally against a private stack on :8765 | Ready with all 5 checks; starter document Ready in about 6 to 8 s; a wrong password and a name clash both exit 1 |
| Secret scan | gitleaks 8.30.1 over all 16 commits | 1 false positive, allowlisted; then no leaks; a fake secret beside the allowlisted prose is still caught |
| Dependency audit | `npm audit --omit=dev --audit-level=high`; pip-audit on the runtime export | npm 0; **pip-audit exit 1: 7 advisories in pypdf 6.21.2**, fixed by 6.21.4 (checked on a scratch lock) |

### Not verified (Stage 6)

- Any `docker build`, `docker compose config`/`up`, `caddy validate`, certificate issuance, an end-to-end
  request through Caddy, the read-only root at runtime, Qdrant enforcing its API key, or the
  `compose.backup.yml` merge.
- Any GitHub Actions run, including `next start` with `output: "standalone"` in the `e2e` job.
- POSIX file modes and `--chown` for real (Windows only; faked in unit tests); the backup cron line.
- Backups against a Qdrant with an API key, or against Docker volumes.
- The CI-mode Playwright run with Playwright's own Chromium (only Edge is installed here).
- The full Playwright suite after Stage 6.
- The live API on :8000 and the worker still run code from before Stage 6: they do not reload and were
  not restarted.

---

## Final gate for branch `ui-redesign-2026-10`, 2026-11-06

Run on the uncommitted working tree on top of `45cd0dd`, after the fixes in "2026-11-06 — review fixes"
below. Environment: Windows 11, Python 3.12, PostgreSQL 18.6, Qdrant 1.20.0, Edge via Playwright, Next dev
server for the browser runs.

| Check | Command | Result |
|---|---|---|
| Backend lint | `ruff check src tests migrations` | All checks passed |
| Backend types | `mypy` | No issues in 80 source files |
| Backend tests | `pytest -q` on `rackflow_test` | **350 passed, 0 failed**, 394 s (after the last backend change) |
| `test_chat_citations.py::test_answer_is_withheld_once_access_can_no_longer_be_checked` (failing at last owner run) | same run | Passed, alone and in both full runs. The cause of the earlier 409 was not reproduced. |
| Web lint | `eslint` | Exit 0, no problems |
| Web types | `npx tsc --noEmit` | Exit 0 |
| Web build, `/` still Static | `npm ci`, `next build` in a clean copy | Exit 0; `/` is Static (`○`) |
| Browser E2E, no-LLM backend (`MODEL_PROVIDER=extractive`), one spec per command | `playwright test e2e/<spec>` | landing 19, a11y 14, ask 16, library 19, roles 15, engineer-journey 6: all passed. Each count includes 4 sign-in setup tests. |
| Accessibility gates, same backend | `playwright test e2e/a11y-gates.spec.ts` | 128 passed, 5.9 min (includes the 4 setup tests) |
| Engineer journey with Groq on | `playwright test e2e/engineer-journey.spec.ts` | 6 passed, after the prompt fix |
| Open redirect, browser, `/.//evil.example`, `/..//evil.example`, `/%2e//evil.example` | through the form and a demo row | 6 of 6 stayed on the site and landed on `/ask`, 0 requests to `evil.example`. Now also permanent in `e2e/landing.spec.ts`. |

**Not re-run after the last change:** the browser suite on the no-LLM backend ran before the plain-text
prompt rule was removed. That prompt is not used by the extractive provider, and no web file changed after.
The build ran on the same web source as the browser suite. Docker Compose and CI were not executed.

### Evaluation, dataset v1, 13 questions, Evaluation corpus and restricted collections

Through the API as the demo admin. Groq is `openai_compatible`, `qwen/qwen3.8-27b`, free plan of 8000 tokens
per minute.

| Metric | Extractive | Groq, with plain-text rule (2 runs, same scores) | Groq, final |
|---|---|---|---|
| Questions scored / errors | 13 / 0 | 13 / 0 | **13 / 0** |
| Retrieval hit rate | 1.00 | 1.00 | 1.00 |
| MRR | 1.00 | 1.00 | 1.00 |
| Citation precision | 1.00 | 1.00 | 1.00 |
| Citation correctness | 1.00 | 1.00 | 1.00 |
| Answer term recall | 0.95 | 0.77 | **0.91** |
| Abstention accuracy | 1.00 | 1.00 | 1.00 |
| False abstention rate | 0.00 | **0.55** | **0.09** |
| Injection resistance | 1.00 | 1.00 | 1.00 |
| Restricted leaks | 0 | 0 | 0 |
| Average latency / p95, ms | 35 / 57 | 678 / 1610; 718 / 1981 | 753 / 1525 |
| Whole run | under 1 s | about 66 s | 67 s |

- **The review fixes had added a bug, found only by this run.** A new prompt rule, "write plain text only, do
  not use Markdown", made the model refuse 6 of 11 answerable questions, one reply arguing with itself in
  front of the reader. The backend suite never calls a real model, so it cannot show this. In a side test
  with the rule removed, 4 of 4 refused questions were answered; softer wording still refused 1 of 5. The
  rule was removed, and the client still handles bold and headings. A guard test holds this.
- **Final Groq run, the one remaining miss:** `r1` abstains, because its document says it is restricted to HR
  and leadership, although the admin has access. It scores 0 term recall and is the 0.09.
- **Citation scores cover only questions answered,** so the 1.00 for the earlier Groq column hides the refusals.
- **The evaluation retry worked against the real limit.** The final run hit the provider's limit and waited
  through several back-offs, with 0 errors. It took about a minute, not the 13 to 15 minutes estimated earlier.
- **One live answer through the API:** "How do I resolve connection pool exhausted errors?" gave `supported`,
  citation [1] `database-runbook.md`, no page (Markdown), correct steps. One attempt right after other model
  calls got a 503, most likely the rate limit (its error code was not captured); the same question passed 65 s
  later.

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

### 2026-10-27 — CI (GitHub Actions, first push)

Run 40512232777 on `ubuntu-24.04`: **backend** job — ruff clean, mypy clean, **64 passed**;
**web** job — lint, tsc, build passed; **compose-smoke** job — `docker compose up --build --wait`
succeeded; `/health/live` returned status ok, `/api/v1/health/ready` returned ready with
database=true and vector_store=true, web `/login` returned 200. This is the first verification of
the Dockerfiles and Compose stack (Docker is not available on the development host).

### 2026-10-27 — end of Day 2

| Command | Result |
|---|---|
| `backend`: ruff / mypy | clean (78 source files) |
| `backend`: `pytest -q` | **90 passed**, 0 failed (123.6 s) |
| `apps/web`: lint / tsc / build | 0 problems / 0 errors / success (19 routes) |
| `scripts/dev/smoke_platform.py` (live API + worker + web proxy, real bge-small embeddings) | PASSED — metrics below |

New tests on Day 2 (26): member lifecycle incl. one-time password login, role change applied to
live sessions, last-admin guard, removal revoking sessions; admin endpoints role/tenant scoping;
collection grants (read is not write/manage; members only; revoke); audit log recording and
scoping; tenant settings validation/reset; jobs API visibility (restricted collection, engineer
vs operator vs auditor vs other tenant), cancel then retry then succeed, filters; operations
summary equals database counts; worker list hides foreign job IDs; duplicate delivery creates no
duplicate chunks/vectors; storage quota; model concurrency limiter; infrastructure registry
(provenance rules, rack-unit validation, isolation, audit) and simulated seed; evaluation dataset
integrity, scoring rules, full run via the job queue (auditor sees scores only); injection
detector positives/negatives; extractive provider never quotes injected text.

**Evaluation baseline (dataset v1, 13 questions, extractive no-LLM provider):**

| Metric | Test run (hash embedder) | Live run (bge-small) |
|---|---|---|
| Retrieval hit rate | 1.00 | 1.00 |
| MRR | 0.88 | 1.00 |
| Citation precision | 0.95 | 0.95 |
| Citation correctness | 0.90 | 0.90 |
| Answer term recall | 0.85 | 0.85 |
| Abstention accuracy (no-answer) | **0.50** | **0.50** |
| False abstention rate | 0.00 | 0.00 |
| Injection resistance | 1.00 | 1.00 |
| Restricted leaks (operator without access) | 0 | 0 |
| Latency avg / p95 | 35 / 146 ms | 41 / 69 ms |

Findings: (1) the first evaluation run reported **injection resistance 0.00**: the extractive
provider's "include the following sentence" heuristic quoted an injected instruction (canary
CANARY-7731) verbatim. Fixed with an instruction-like-text detector (extractive mode never quotes
it; prompt sources are flagged; ingestion adds a warning) plus regression tests.
(2) Abstention accuracy is 0.50: the extractive provider answered one unanswerable question from
loosely matching text. Expected to improve with an LLM; not yet measured.
(3) A full-suite-only failure exposed non-idempotent evaluation seeding (the generated scanned
PDF embedded the current time). Fixed with deterministic PDF bytes and name-based idempotency.

Remaining verification gaps: no browser-level UI testing; no real LLM evaluated; no load tests;
tracing and backups/DR not implemented.

### 2026-10-27 — Day 3 (final verification)

| Check | Command / method | Result |
|---|---|---|
| Backend lint / types | `ruff check src tests migrations` · `mypy` | clean · no issues (78 files) |
| Backend tests | `pytest -q` | **96 passed**, 0 failed (102 s) |
| Authentication release gate | `tests/test_security_gates.py` | 62 API operations: 59 require authentication (static dependency check **and** anonymous request → 401), 3 intentionally public (health live/ready, login) |
| Other release gates | same file | login rate limit (10/min/key → 429); safe error shape + security headers; production config refuses insecure cookies / test embedder and hides API docs; migrations `head → base → head` round trip |
| Dependency audit | `npm audit` (prod + dev); `uvx pip-audit -r <uv export --no-dev>` | 0 vulnerabilities; no known vulnerabilities |
| Clean install | fresh `git clone` of the GitHub repo into an empty folder; README commands only (`uv sync`, `alembic upgrade head`, `seed-demo`, API :8100, worker, `npm install`, `npm run build` with `API_PROXY_TARGET`, standalone web :3100); separate database and Qdrant collection; shared PostgreSQL/Qdrant servers | Passed: `smoke_e2e.py` (PDF indexed in 6.1 s with bge-small, cited answer) and web proxy login + document listing |
| Browser E2E | `E2E_BROWSER_CHANNEL=msedge npx playwright test` (Microsoft Edge 156; Playwright 1.64.1) | **5 passed** — engineer journey (create collection → upload → indexed → pipeline → ask → supported answer → citation source), auth redirect + bad password, landing page by role, auditor restrictions, operator infra/job queue/workers/models/evaluation |
| Visual review | 11 E2E screenshots + light/dark logo screenshots reviewed by the developer | layout acceptable; 2 visual defects found and fixed (below) |
| CI | GitHub Actions on each push | backend, web, compose-smoke green |

Defects found by Day-3 testing and fixed (all re-verified):
1. **Chat page crash** in current Chromium/Edge — `TypeError: i is not a function`: a concise-arrow
   `useEffect` returned `scrollIntoView()`'s new Promise, which React treated as a cleanup
   function. HTTP-level checks could not detect this; the browser E2E did.
2. Users without `ops:read` (engineers) landed on an access-denied Overview whose data hooks
   still issued forbidden requests (3 × 403). Fixed with route-level permission gating in the
   shell and a role-based landing page.
3. Overview throughput chart rendered no bars (bucket column lacked an explicit height).
4. Extractive answers quoted Markdown headings.
5. Gate test initially enumerated only 1 route: FastAPI 0.162 keeps included routers as
   `_IncludedRouter` objects; the gate now reads the public router list the app mounts.

Verification limitations that remain: browser E2E runs locally (not in CI) on Edge only; no
mobile/responsive or automated accessibility audit; no load testing; no real LLM exercised.

### 2026-11-05 — reset laptop: setup and browser testing (recorded in project notes)

Environment: Windows 11 after the 2026-11-01 reinstall, Python 3.12 via uv, PostgreSQL 18.6, Qdrant
1.20.0, Node 26. No Docker. The raw output of these runs is not in the repository.

| Stage | Result |
|---|---|
| Backend setup | 114 backend tests passed; ruff and mypy clean. Environment fault ENV-1 no longer reproduced. |
| Browser testing | E2E 49 of 53 passed: 1 real bug, 2 test problems, 1 needing the demo password. 144 bugs logged, 50 major, 0 blockers. |

### 2026-11-06 — Stage 4 gate, before the review fixes (recorded in project notes)

eslint, tsc, ruff and mypy clean; 233 backend tests passed; production build with `/` Static; all
Playwright specs passed. Open from that gate: no CI job for Playwright or axe; test documents in the
demo corpus; old documents keep old page numbers until re-uploaded.

### 2026-11-06 — live model check with Groq (recorded in project notes)

`MODEL_PROVIDER=openai_compatible`, model `qwen/qwen3.8-27b`, free plan of 8000 tokens per minute.

- Manual checks passed: correct cited answers, a follow-up, abstention, and refusal of an injection.
- **Evaluation incomplete:** 6 of 13 questions failed with `MODEL_OVERLOADED`. The abstention, restricted
  and injection categories were not scored.
- Citation correctness was 1.0 on the 7 scored questions, against 0.6 in the no-LLM baseline noted at the
  time. **These are not comparable as a headline,** because the 7 are a subset. The 2026-10-27 run above
  recorded 0.90 for the no-LLM provider.

### 2026-11-06 — review fixes, as reported by each owner

A diff review produced 68 findings: 1 blocker, 14 major, 53 minor, some of them duplicates. The owners
below fixed and checked their areas. **These are per-owner runs on a working tree that others were
changing at the same time. The final gate above replaces them.** No owner re-ran the whole browser suite.

| Owner | Checks reported | Limits they stated |
|---|---|---|
| Backend: auth and ops | Full suite on a private database: 350 passed, 1 failed. ruff clean on owned files; mypy clean, 80 source files. YAML parse of Compose and CI. | The failure is the test named below. Docker not on host, so Compose never executed. |
| Backend: jobs and evaluation | Full suite on a private database: 350 passed, same 1 failure. Owned subset: 152 passed, same failure. New tests run against committed source: 25 failed and 7 errored as expected for confirmed bugs, 12 guard tests passed. ruff clean. | mypy reports one unused type-ignore at `tests/ingestion/test_units.py:111`. Retry not run against real Groq. |
| Web: redirect | Browser against the live dev server. Before the fix: 6 of 6 hostile runs reached `evil.example`. After: 16 of 16 stayed on the site, with 0 requests to it. Legitimate targets kept. eslint and tsc clean. | `canOpen` fix confirmed from code only before the fix. **The script is not in the repo.** About 30 real sign-ins added audit rows. |
| Web: landing | Mocked script 25 of 26. The 1 failure is a too-thin mock of `/ask`; a second script with chat stubbed covered that case. Live API script: upload, Cancel at 100%, "already saved", Remove. eslint and tsc clean. | Not exercised: emptied box, read-only box during the countdown, Switch to Engineer with an edited question, session expiry during Try again, a real 98% cancel. Scripts not in the repo. |
| Web: Ask | 34 of 34 checks with every API call mocked. tsc and eslint clean. | Real backend not exercised end to end. No negative control. Holding a re-send for a file still being read not exercised. Scripts not in the repo. |
| Web: console | 37 of 37 checks through the live dev server, as all four roles. tsc and eslint clean. | Edge-case data and all writes stubbed, so no real 100+ documents or real failed delete. e2e suite not run. |
| Web: library and e2e | `library.spec.ts` 14 of 14 (red first: 4 of 6 new tests failed before the fix), then the access group 21 of 21 with `--repeat-each=3`. `roles` and `engineer-journey`: first run 10 passed, 3 failed from test problems; those 3 passed on re-run. Live journey passed with one model question. | `a11y-gates` and other specs not run. Other roles tests not re-run after the fixes. |

**Failing at the last report:** `tests/test_chat_citations.py::test_answer_is_withheld_once_access_can_no_longer_be_checked`
got 409 instead of 204 when deleting a collection. Two owners saw it. Neither owned that file, and its
cause is unconfirmed. The RAG and chat owner's report was not received, so that work is described from the
code; its tests ran only as part of the full suites above.

### Not verified (2026-11-06)

- **Docker Compose and CI on this branch:** nothing executed; no CI result is recorded.
- **Clean install** from the current README: last done 2026-10-27 at v0.1.0.
- **Permanent regression tests:** hero cancel, Ask and console fixes were checked by throwaway browser
  scripts. `apps/web` has no unit test runner, and `e2e/` has no spec for them. `safeNext` and `canOpen` are
  now covered in `e2e/landing.spec.ts`.
- **Load, concurrency, backup and restore, mobile devices, screen readers, Windows High Contrast:** not done.
  §9 checks marked "manual" in the UI spec are not recorded as performed.
- **`next start`** behaviour for `X-Forwarded-For`: only `next dev` was tested.
