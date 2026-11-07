# Security and Privacy Baseline

## 1. Tenant isolation
- Derive tenant from verified identity/membership; do not trust client-supplied tenant IDs.
- Scope every database query, object-storage key, job, vector search, conversation, citation, and audit event by tenant.
- Use negative tests proving tenant A cannot discover or read tenant B data.
- Apply collection/document permission filters before retrieved content is placed in model context.
- Avoid leaking unauthorized existence through counts, error wording, search timing, or logs.

## 2. Authentication and authorization
- Use a maintained identity library/provider; do not invent cryptography.
- Enforce RBAC on the server for every protected endpoint.
- Roles are a baseline, not the full permission model; collection permissions may narrow access.
- Use least privilege and explicit deny-by-default behavior.
- Audit role changes, document deletion, model configuration changes, and infrastructure registry changes.

## 3. File handling
- Allowlist file types and validate extension plus MIME/content signature where practical.
- Enforce file size, page count, archive expansion, parsing time, and OCR limits.
- Generate storage keys; never use user-provided filenames as paths.
- Scan files with an available malware scanner in production where appropriate.
- Run parsers in constrained workers; set CPU/memory/time limits.
- Do not execute macros, scripts, embedded commands, or document links.
- Protect against path traversal, decompression bombs, malformed files, and parser vulnerabilities.

## 4. RAG prompt-injection controls
- Treat all retrieved document content as untrusted data, not instructions.
- System policy and developer rules must not be overridden by document text.
- Never let retrieved text grant permissions or authorize actions.
- Do not execute commands found in documents.
- Provide citations only for authorized retrieved sources.
- For critical troubleshooting, explain evidence and uncertainty; no autonomous infrastructure actions.

## 5. Secrets and transport
- Use `.env.example` with placeholders only; never commit `.env`.
- Use secret manager or deployment environment secrets in hosted environments.
- Use TLS in deployment; configure CORS narrowly.
- Apply secure cookies/CSRF controls if cookie sessions are used.
- Rotate credentials and redact secrets from logs and errors.

## 6. API and abuse controls
- Rate-limit authentication, upload, chat, and expensive endpoints.
- Enforce request size/timeouts and model concurrency limits.
- Validate all inputs and use parameterized DB access.
- Protect outbound fetch integrations against SSRF; MVP should not fetch arbitrary user-provided URLs.
- Add pagination and safe filtering; prevent unbounded queries.

## 7. Retention and deletion
- Define retention for original files, extracted text, vectors, chats, logs, and audit events.
- Deletion must propagate to vectors and object storage; expose status until cleanup is verified.
- Avoid retaining prompts/responses longer than needed.
- Document backup deletion/retention limitations.

## 8. Security release gate
No release is production-ready until authorization tests, dependency scanning, secret scanning, upload limits, tenant isolation, and deletion cleanup tests pass.


## 9. Implementation status (sprint 2026-10-27, updated 2026-11-06)

| Control | Implementation | Verification |
|---|---|---|
| Authentication on every endpoint | `require(Permission)` / `get_principal` dependencies | Automated gate (`test_security_gates.py`): every non-public operation depends on authentication and returns 401 anonymously. Public: health, login, and `GET`/`POST /auth/demo` (which do nothing unless `DEMO_MODE` is on) |
| Tenant derived from identity | Session → membership; no tenant in request bodies | Cross-tenant tests for every module return 404 |
| RBAC + collection permissions | Role matrix + tenant/restricted collections + grants | Role tests per module; restricted-collection tests incl. retrieval and citations |
| Retrieval authorization | Collection intersection, tenant-filtered vector search, PostgreSQL re-validation | Deleted document with live vectors never returned; cross-tenant identical content isolated |
| No existence leaks | Identical 404 for missing/foreign/forbidden | Tests compare responses |
| Prompt injection | Delimited untrusted sources, neutralised in any letter case; `[n]` markers in document text rewritten to `(n)` so a document cannot forge a citation; grounding policy; citations must map to supplied sources; instruction-like text detector, also across hard-wrapped lines (flag in prompt, never quoted, ingestion warning) | Unit tests + evaluation canary with the extractive provider (resistance 1.0). One live injection refusal with Groq. The injection category has **not** been scored with an LLM |
| Upload safety | Extension allowlist + content signature, size/page limits, zip-bomb and macro rejection, generated storage keys, path-traversal-safe storage | Unit and API tests |
| Session security | argon2id passwords; random tokens stored hashed; HttpOnly SameSite=Lax cookie; Secure required in production; CSRF header on cookie writes | Tests incl. CSRF rejection and logout revocation |
| Abuse controls | Rate limits per API process: sign-in 60/min per client before the password check and 10/min per client and address; demo sign-in 30/min per client; upload 60/min and chat 30/min per user. Tenant storage quota; model concurrency limit | Tests for limits, quota, concurrency, limiter eviction |
| Sign-in audit flooding | Rows for rejected sign-ins are capped: unknown accounts 5/min per client and tenant and 30/min per tenant (including the no-tenant bucket), known accounts 10/min per account. The 401 does not change. Rows hold no password or token, and an address matching no account is not stored | `test_infra_auth_bugs.py`, `test_demo_login.py` |
| Client address | `X-Forwarded-For` read only from peers in `TRUSTED_PROXY_IPS`, rightmost untrusted hop, fallback to the peer (ADR-025) | Unit tests incl. forged and malformed values. Compose network not executed |
| Redirects | `safeNext` rejects values that normalise to `//host` or another origin; `canOpen` ignores `?` and `#` | Browser scripts on 2026-11-06: before the fix 6 of 6 hostile runs reached the outside site; after it 16 of 16 stayed on the site. **No permanent test in the repo yet** |
| Saved answers after access loss | The whole answer is withheld, not just its citations, when any citation's collection is inaccessible or gone (`content_withheld`) | `test_chat_citations.py`; one test there failed at the last owner run, see TESTING.md |
| Evaluation results | Questions and answers only for readers with content access to every collection the run searched; auditors keep filenames only | `test_ops_bugs.py` |
| Worker data across tenants | `/operations/workers` counts per caller's tenant; another tenant's job shows as idle | `test_infra_auth_bugs.py` |
| Safe errors and logging | Standard error shape with correlation ID; validation errors never echo input; job errors use safe codes; logs carry IDs/counts only; SQLAlchemy `hide_parameters` keeps bound values out of tracebacks | Tests (redaction of unknown exception text, validation echo) |
| Security headers | nosniff, frame DENY, no-referrer, CSP `default-src 'none'` on API, no-store | Test |
| Audit trail | Logins, member/role changes, grants, documents, jobs, settings, infrastructure, evaluation | Tests |
| Dependency scanning | `npm audit` (0 vulnerabilities), `pip-audit` on runtime lock (no known vulnerabilities) — run manually 2026-10-27 | Not yet a CI gate |
| Secret scanning | Manual scan of all commits before first push (no secrets) | Not yet a CI gate |
| Deletion propagation | Async job removes vectors, stored file and chunk rows; document hidden immediately. An ingest running when a delete overtakes it removes its vectors on failure or cancel. `reindex --include-failed` skips documents the user asked to delete | End-to-end and regression tests |

## 10. Open risks (2026-11-06)

**This is not a production-readiness claim.** No independent security review has taken place.

Owner decisions and actions:
- **Cross-tenant membership add (ADR-026):** an org_admin of one tenant can add an existing user of
  another tenant by email. This reveals that the account exists and can change their default sign-in
  tenant. Awaiting a decision; the code is unchanged.
- **Credentials to rotate:** the model API key appeared in a chat session and a local database password
  appeared in one agent's tool output during development. Anything used on the laptop before its
  2026-11-01 reinstall should also be rotated. `Docs/env` and `Docs/demo-password.txt` are from that
  install, are git-ignored, and must not be used. No full malware scan is recorded since the reinstall.
- **The repository is public.** Keep secrets, real documents and production hostnames out of it.
- **Data egress:** with a hosted model on, questions and retrieved passages go to that provider (ADR-023).

Known weaknesses:
- `DEMO_MODE` gives password-less org_admin access to whoever can reach the site. Its only guard is the
  `APP_ENV=production` check (ADR-022).
- Without a load balancer, all Compose sign-ins share one address, so one client can lock out others
  (ADR-025). IPv6 clients behind a proxy are limited per address, not per /64.
- Rate limits and audit caps are per API process.
- A capped audit row is only a log warning, so a sustained attack leaves gaps in the tenant's audit log.
- Stop does not cancel on the server: the question and answer are saved and can feed follow-up search.
- A worker crashing between vector upsert and cleanup can leave orphan vectors. Retrieval drops them
  through its PostgreSQL re-check.
- A document whose delete gave up, with `deleted_at` cleared, can still be retried with
  `POST /documents/{id}/retry`. This is deliberate, and an owner decision is open on whether to refuse it.
- Compose defaults the database password to `rackflow` when `POSTGRES_PASSWORD` is unset. Nothing rejects
  default credentials at startup.

Not implemented: retention policies, encryption at rest, malware scanning of uploads, SSO/OIDC,
backup/restore, secret scanning and dependency audits in CI. The last recorded manual dependency audit
was 2026-10-27.
