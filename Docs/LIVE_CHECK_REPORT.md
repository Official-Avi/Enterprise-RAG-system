# RackFlow AI: Live Check Report

**Date:** 2026-10-29
**Scope:** 18 QA tracks tested features against the running local stack (API :8000, web proxy :3000, worker, Postgres, Qdrant :6333). Independent verifiers re-tested every critical and high bug (18 re-tests).
**Build under test:** the web app is the 2026-10-27 standalone build (HEAD). The uncommitted landing-page work is not built.

The core RAG flow (ingest, retrieve, answer) could not be tested at all today because of one environment fault, **ENV-1**. Everything else was judged normally.

---

## 1. Summary

| Area | Status | Evidence | Key latency |
|---|---|---|---|
| Auth & sessions | Working | 37/38 pass: login, logout revocation, CSRF, 429 on attempt 11, 4 demo personas | login 80–95 ms; /auth/me 6–7 ms |
| Admin: users, audit, settings | Working | Role changes reach live sessions immediately; every action audited; setting restored exactly | API 3–17 ms; pages 170–400 ms |
| Collections & permissions | Working | Grants and revokes apply on the next request; uniform 404. Gaps: no polling, no rename/delete in the UI | API 5–20 ms |
| RBAC matrix | Working | 280 calls, 0 mismatches with rbac.py; nav gating correct | median 6.0 ms |
| Tenant isolation | Partial | All cross-tenant calls return 404 or empty; vector-layer isolation untestable (ENV-1) | 5–11 ms |
| Ingestion: formats | Blocked by ENV-1 | 0/4 formats indexed; stages up to chunk OK; download and delete work | upload 17–36 ms |
| Ingestion: validation, OCR, edge cases | Partial | Validation 7/7 pass; OCR and indexing blocked by ENV-1; 10 MB proxy cap (BUG-02) | upload 7–32 ms |
| Jobs & workers | Partial | List, filter, cancel, retry, heartbeats work; stale-worker count wrong (BUG-09) | API 7–17 ms; pickup 0.11–1.2 s |
| RAG answers | Blocked by ENV-1 | 0 answers; 5/5 asks returned 503; sessions and history work | 503 in 19–35 ms |
| Retrieval inspector & evaluation | Partial | Eval pages work; inspect 6/6 returned 503; index deleted (BUG-01); failed run shown as "completed" (BUG-10) | 8–12 ms |
| Infra, models, health | Partial | APIs work; polling dies after one error (BUG-05); stale rack cards (BUG-14) | <15 ms; ready 68 ms |
| Web UI by role | Partial | 4 roles, 0 console errors, correct gating; no mobile nav (BUG-12) | nav 20–140 ms |
| Real-time UI | Partial | Polling only; new Documents row appears after 0.4–12.7 s | Overview poll 5 s |
| Perf (light) | Blocked by ENV-1 | API healthy; throughput and answer latency could not be measured | /health/live p95 ≤7.8 ms |
| Build: landing + demo | Blocked by ENV-1 | All frontend steps work; the flow stops at indexing; feasible with changes | ~100 ms before indexing |
| Build: /ask workspace | Blocked by ENV-1 | Session, scope and upload APIs work; answers could not be checked; feasible with changes | 8 ms session create |
| Build: library | Partial | Download and delete exist; ~4 endpoints missing; feasible with changes | download 19 ms |
| Build: streaming | Partial | SSE through the Next proxy proven with 2 changes | ~8 ms/event overhead |

---

## 2. ENV-1: onnxruntime fails on an unstable Windows host

**Root cause.** `import onnxruntime` in `backend/.venv` fails with "DLL initialization routine failed". Loading `onnxruntime.dll` directly gives WinError 1114. The installed packages are onnxruntime 1.31.1 and fastembed 0.9.1. The same packages indexed 11 documents on 2026-10-27, so this is an environment regression, not a code change.

The main session also found host-wide instability: 388 Application Error events in 4 days (faulting module `sspicli.dll`, c0000409) and about 200 Postgres crashes today. Verifiers rejected two proposed causes: restarting the worker alone does not help, and the deleted Qdrant collection does not cause the 503.

| Symptom | Evidence |
|---|---|
| Embeddings and OCR libraries cannot load | `fastembed` (14 verifiers) and `rapidocr_onnxruntime` imports fail the same way |
| Ingestion fails | 0 `document_indexed` since worker start (14:31Z); every format fails after 4 attempts (10–30 s) |
| Chat returns 503 RETRIEVAL_UNAVAILABLE | no `/messages` request returned 200; 62 `retrieval_backend_error` lines, all ImportError |
| Retrieval inspector returns 503 | 8 × 503, 0 × 200 |
| OCR skipped | `ocr_provider_unavailable`, then NO_EXTRACTABLE_TEXT (the intended fallback) |
| Evaluation invalid | run `ceb15cfe…`: 13/13 questions returned RETRIEVAL_UNAVAILABLE |
| Perf numbers invalid | only error-path latency was measurable (p50 17.5 ms) |
| Dashboards skewed | job error rate 74–95%; the worker still reports "healthy" at 50 ok / 184 failed |

**Could not be judged (re-run after the fix):**
- answers, evidence_status, citations, pages and quotes
- follow-up and override answers
- auto-title
- chunk page numbers
- removal from retrieval after delete
- Qdrant-layer tenant isolation
- OCR
- batch indexing
- the "Indexed" badge and KPI
- throughput and answer latency
- the landing and /ask flows end to end

---

## 3. Product bugs not caused by ENV-1

Duplicate findings across reports are merged into one entry. "Verified" means an independent verifier reproduced the bug. "Not-run" means only medium and low findings from the original tracks back it.

### High

**BUG-01: Test teardown deleted the live Qdrant index.** High. Verified yes (2 verifiers).
- **Repro:** Qdrant `GET /collections` returns `[]`. `qdrant.log` shows an exists-check then a DELETE of `rackflow_chunks` at 15:25:56Z, 6 ms before pytest wrote its cache.
- **Expected vs actual:** vectors should persist; instead, all 16 documents marked indexed have no vectors.
- **Location:** `backend/tests/conftest.py:27` uses `setdefault` for VECTOR_COLLECTION, but the shell already exports `rackflow_chunks`. The teardown (lines 59–64) deletes that collection.
- **Fix:** always use a `rackflow_test_<hex>` name and refuse to delete any other. Add a re-index path: retry only accepts FAILED documents (`documents.py:345`), and `search()` silently returns `[]` when the collection is missing.

**BUG-02: Web proxy caps request bodies at 10 MB.** High. Verified yes.
- **Repro:** upload an 11 MiB file, or two 6 MiB files in one batch, through :3000.
- **Expected vs actual:** expected the 25 MiB per-file limit the UI advertises; got HTTP 500 after ~30.1 s.
- **Location:** `apps/web/next.config.ts` (Next 16.4.3 default `proxyClientMaxBodySize` is 10485760).
- **Fix:** raise the limit to at least 26 MiB plus multipart overhead, return 413, and check the batch total on the client.

### Medium

**BUG-03: Deterministic ImportError retried 4× as INTERNAL_ERROR, attributed to the wrong stage.** Medium. Verified yes (secondary finding of 6 verifiers).
- **Expected vs actual:** expected a failure at stage `embed` with EMBEDDING_FAILED and no retry. Got `stage=chunk` (chunk itself succeeded), no embed row, 4 attempts over 15–32 s, and only `exc_type` in the log. The pipeline view shows no failed row.
- **Location:** `rag/indexing.py:29-33` builds the provider and store before `ctx.stage(EMBED)`; `runner.py` retries every unknown exception.
- **Fix:** open the stage first, treat ImportError and config errors as permanent, and log a safe message with the module name.

**BUG-04: Readiness and model health ignore embedding failures and a missing collection.** Verifier: not a bug as specified (readiness is DB + Qdrant per DEPLOYMENT.md §8.6). Kept as a robustness gap at Medium, because it hid both ENV-1 and BUG-01.
- **Actual:** `/health/ready` returns 200 with both checks true, `/models/health` returns `ok:true` (extractive LLM only), and the worker reports "healthy" with 142+ failed jobs.
- **Location:** `api/routers/health.py`; `vectorstore.py` `health()`.
- **Fix:** add a cached embedding probe and a `collection_exists` check (or a degraded state), and report provider failures in the worker heartbeat.

**BUG-05: `useApi` stops polling for good after one failed request.** Medium. Not-run, but reproduced independently by 2 tracks.
- **Repro:** after one injected 500, there were 0 summary polls in 20 s, while the workers panel kept polling.
- **Expected vs actual:** expected a retry with backoff; got frozen KPIs until the user clicks Retry. There is no fetch timeout, and every polled page is affected.
- **Location:** `apps/web/src/lib/hooks.ts` catch block.
- **Fix:** back off and reschedule, add a ~10 s AbortController timeout, and mark stale data.

**BUG-06: Chat session becomes unusable once any scoped collection is deleted.** Medium (downgraded from High). Verified yes.
- **Repro:** create a session over collections [A,B], delete A, then ask. Every question returns 404 COLLECTION_NOT_FOUND. The UI never sends an override, so users have no workaround.
- **Location:** `chat.py:217-218` and `:137-140`.
- **Fix:** intersect the stored scope with authorized collections and return 404 only if nothing is left. Make the scope editable (BUG-07).

**BUG-07: No endpoint to delete or rename chat sessions.** Medium. Verified yes.
- **Repro:** PATCH, PUT and DELETE return 405; OpenAPI lists GET only.
- **Impact:** test sessions pile up (§6), and the /ask sidebar cannot be built.
- **Fix:** add PATCH `{title, collection_ids}` and DELETE via `_own_session` (`chat.py:127-134`); messages cascade. Audit both.

**BUG-08: A failed ask drops the user's message and leaves an empty session.** Medium. Not-run.
- **Actual:** the message is not stored, the UI bubble is cleared in `finally`, and an empty "New conversation" session remains.
- **Location:** `chat.py:220-225`; `chat/page.tsx` ~120–129.
- **Fix:** persist the user message first and keep the bubble with a Retry action.

**BUG-09: Summary counts workers the workers list never shows.** Medium. Not-run (a verifier also saw `stale=4`).
- **Actual:** Overview shows "1/5, 4 stale" while the list shows 1 worker.
- **Location:** `operations.py` `summary()` (~110) has no time filter; `workers()` (~131) keeps only the last 24 h.
- **Fix:** use the same filter in both, or prune old rows.

**BUG-10: Evaluation run with every question errored is labelled "completed".** Medium. Not-run.
- **Actual:** 13/13 errors and null metrics, but a green check. The run also replaces the valid Oct 27 run in "Latest results".
- **Location:** `evaluation/runner.py` ~85; `evaluation/page.tsx`.
- **Fix:** add a `completed_with_errors` or `failed` status, and headline the latest run without errors.

**BUG-11: OCR-unavailable warning is lost when the job fails.** Medium. Not-run.
- **Actual:** the user sees only NO_EXTRACTABLE_TEXT, with `warnings=[]`.
- **Location:** `ingestion/orchestrator.py` saves warnings only at FINALIZE.
- **Fix:** persist warnings on failure and display them.

**BUG-12: No navigation at phone width.** Medium. Not-run.
- **Actual:** at 390 px the sidebar is `hidden md:flex`, and the header shows only the logo and Sign out.
- **Location:** `Shell.tsx:186`.
- **Fix:** add a mobile drawer.

**BUG-13: Proxy 30 s idle timeout would cut long chat answers (latent).** Medium. Not-run (proven on a copy of the build).
- **Actual:** a 35 s silent response is dropped at 30121 ms. Today's extractive answers take 0–1 ms, so it only bites once an LLM provider is enabled.
- **Location:** `next.config.ts` has no `experimental.proxyTimeout`.
- **Fix:** set ~120000 before enabling an LLM, then stream with heartbeats.

### Low

| ID | Title | Repro → actual | Location | Fix |
|---|---|---|---|---|
| BUG-14 | Rack cards stale while the count note refreshes | External delete: "Configured 1 racks" shown above 2 cards | `infrastructure/page.tsx:144-147` | Poll the lists at 10 s |
| BUG-15 | Collections, Audit, Users, rack detail and eval run detail never refresh | Cross-user grant not visible after 12 s; a revoked link silently falls back to all collections | `collections/page.tsx:164` | Poll, or refetch on focus |
| BUG-16 | Documents idle poll is 15 s | External uploads appear 11.8–14.5 s late | `documents/page.tsx:160-162` | ~5 s idle; fast mode after own upload |
| BUG-17 | Upload panel badge stuck at "Queued" | The table row says Failed | `documents/page.tsx` ~137 | Follow the live status |
| BUG-18 | "Into collection" ignores the active filter | Uploads can land in the wrong collection | documents upload panel | Default to the filter |
| BUG-19 | Horizontal page scroll at 390 px | scrollWidth 426–585 on 4 pages | card around `ui.tsx:284` | `min-w-0` |
| BUG-20 | Settings save audits all 6 fields | No from/to values recorded | settings page; `settings.py` | Send only the diff |
| BUG-21 | No UI to rename or delete a collection | Works through the API only | `collections/page.tsx` | Add the actions |
| BUG-22 | No download button | The API returns 200 | `documents/page.tsx:217-241` | Add a link |
| BUG-23 | `formatBytes` stops at MB | Shows "655360.0 MB" | `lib/format.ts` | Add GB/TB |
| BUG-24 | "Evaluation queued" banner persists | Still shown after completion | `evaluation/page.tsx` | Clear it on terminal status |
| BUG-25 | No DELETE for nodes, workloads or user accounts | A rack with nodes can't be deleted; test users persist | infra and admin routers | Add audited DELETEs |
| BUG-26 | 429 has no Retry-After; forced 401 shows a blank login | No header or "session ended" notice | login limiter; `api.ts` | Add both |

**Minor notes (not filed):**
- `MODEL_MANAGE` is defined but unused.
- The collection list sorts case-sensitively.
- Permission denials are not audited.
- Re-uploading a failed document returns "duplicate".

### Rejected or re-scoped

- **"/" and "/ask" have no route:** not a bug. This is unfinished uncommitted work, and the live build serves "/".
- **/overview returns 404:** the build predates the rename.
- **Readiness reports ready:** matches the documented scope; tracked as the BUG-04 gap.
- **"Stale worker, restart fixes it" and "UI Markdown ingest fails":** both are ENV-1; the chunk stage itself succeeds.
- **Invalid JSON gets 422 before 403:** standard FastAPI behaviour.
- **Follow-ups ignore earlier turns:** retrieval is single-turn per DECISIONS.md.

---

## 4. Real-time behaviour

Every live update comes from `useApi` polling. There is no SSE or WebSocket, no pause in hidden tabs, no refetch on focus and no ETags.

| Page | Refresh | Measured |
|---|---|---|
| Overview (`/`) | summary and workers 5 s; metrics 15 s; model health 30 s | Queue depth +2.95 s, failed +4.3 s; external logout caught in 4.4 s; polling dies after one error |
| Documents list | 2.5 s while any doc is active, else 15 s | New row 0.4 s (fast) or 11.8–14.5 s (idle); delete 1.2 s or 12–13.6 s |
| Document detail | 2 s while active | Stops at a terminal state |
| Job queue | 4 s always; drawer 2 s while active | New row after 3.25 s; fast jobs skip intermediate states |
| Workers | 5 s | Heartbeat advanced within 11 s |
| Models | health 30 s; metrics 15 s | n/a |
| Evaluation | 3 s while a run is active; run detail never polls | Queued row 92 ms; completed 3.18 s |
| Infrastructure | count note 10 s; cards once | External changes not shown after 13 s |
| Collections, Users, Audit, Settings | none | Collections and Audit unchanged after 12 s |
| Chat | none; one blocking POST | Progress indicator after 36–48 ms; answer time blocked by ENV-1 |

**Recommendations:**
- **Now (~0.5 d):** fix BUG-05; make polling visibility-aware; poll Documents every ~5 s when idle; make Jobs polling adaptive.
- **Status updates:** one tenant-scoped SSE `GET /events` fed by Postgres LISTEN/NOTIFY. Payloads carry ids only, and clients refetch over REST. Use a sync listener thread (measured 0.69 ms), because async psycopg fails on the Windows Proactor event loop. Add a 15 s heartbeat and a polling fallback. Long-polling is not recommended.
- **Answer streaming through the Next proxy is feasible**, with three requirements:
  - Send `Cache-Control: no-cache, no-transform`. Without it, gzip buffers the stream (all events arrived at 3082 ms instead of 4, 527, 1041 ms…).
  - Send a `: ping` heartbeat every 15 s to beat the 30 s idle timeout. A 45 s stream with regular events passed.
  - Use fetch with a ReadableStream, because EventSource cannot POST or send the CSRF header.

  Streaming only pays off once an LLM provider is enabled.
- **Effort:** 6–8 dev-days in total (polling 0.5 d, chat streaming 2–3 d, `/events` 3–4 d).

---

## 5. Build feasibility

**Landing page and demo flow** (feasible with changes; no estimate given)
- **Proven via the proxy:**
  - anonymous `/auth/me` returns 401
  - the demo login sets `rf_session` (13 ms)
  - find-or-create collection works (a duplicate name returns 409, then re-list)
  - upload (26 ms) and session creation (13 ms) work
- **Blocked:** indexing and answers (ENV-1, BUG-01).
- **Missing:**
  - a public `app/page.tsx` and `(app)/ask/page.tsx`
  - an "Ask" nav item
  - a `noAuthRedirect` option on `useApi`
  - e2e test updates
- **Pitfalls:**
  - Demo personas are shared accounts, so visitors see each other's uploads and chats (proven live).
  - The demo limiter is probably one global bucket behind the proxy (not verified).

**/ask workspace** (feasible with changes)
- **Proven:** the scope list, a session over 14 collections, the session list, per-message override validation, and upload with polling.
- **Gaps:**
  - rename and delete (BUG-07)
  - stale scope (BUG-06)
  - lazy creation and orphan sessions (BUG-08)
  - stored per-message scope
  - readiness
- **Effort:** backend 1–1.5 d; frontend ~1.5 d, reusing the chat and documents components.

**Library** (feasible with changes)
- **Proven:** download (19 ms, byte-identical) and delete. Visibility is only `tenant|restricted`, and engineers cannot use the eval seed endpoint.
- **Gaps:**
  - `POST /collections/default` with an `is_default` migration (1–1.5 d)
  - `POST /library/samples` (0.75 d)
  - document rename (≤0.5 d)
  - a UI download button and a "mine" filter (hours)
  - session rename and delete (1 d)
  - optional move between collections (1–1.5 d)
- **Effort:** 3.5–4 d, or 4.5–5.5 d with move.

---

## 6. Test data left behind

- **Collections, documents, racks, settings:** cleaned up by every track and verifier, confirmed by 404s. Settings were restored exactly.
- **Chat sessions: at least 26 left, and none can be deleted (BUG-07).**
  - **Tracks (13):**
    - tenant-isolation `da074406…`, which references a deleted collection
    - ingestion-formats `d3307c8a…`
    - rag-answers 1
    - perf-light 4
    - build-realtime-streaming 3, on the **shared demo persona engineer@acme**
    - build-ask-workspace `1907aa93…` and `deda2397…`
    - build-landing-flow 1, also on engineer@acme
    - realtime-ui created sessions too but did not list them
  - **Verifiers (13):** `66662bb5`, `e3148994`, `a25d29d0`, 2 from tenant-isolation, `5506d29f`, `c04cd341`, `ce6ddd76`, `0a068c0b`, `dbdb722e`, `396616c8`, `08b7d4af`, and 1 created in the UI.
- **Accounts:** the livecheck-* accounts remain (admin, collections, globex, realtime, perf, ask, rag, jobs, ocr). `livecheck-admin-tmp` was removed from the workspace, but the account itself persists because there is no delete API.
- **Open sessions:** 7 browser and token sessions were left open; they expire on their own (cookie Max-Age is 12 h).
- **Residue:** eval run `ceb15cfe…` now headlines /evaluation. Failed jobs inflate the error rate.
- **Damage:** the Qdrant index was lost (BUG-01), so 16 documents need re-indexing.

---

## 7. Recommended fix order

1. **ENV-1:** stabilise the host, repair onnxruntime, restart the API and worker.
2. **BUG-01:** guard conftest first, then re-index the 16 documents.
3. **Re-run every ENV-1-blocked track** (§2).
4. **BUG-03 and BUG-04:** make outages visible and correctly classified.
5. **BUG-02:** proxy body limit.
6. **BUG-05:** `useApi` resilience.
7. **BUG-07, BUG-06, BUG-08:** the /ask prerequisites. Then delete the test sessions, engineer@acme first.
8. **BUG-09, BUG-10, BUG-11.**
9. **BUG-13** before enabling any LLM, then the streaming and `/events` work.
10. **BUG-12 and the low items**, then the landing, /ask and library builds.
