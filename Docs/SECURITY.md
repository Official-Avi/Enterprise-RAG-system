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


## 9. Implementation status (sprint 2026-10-27)

| Control | Implementation | Verification |
|---|---|---|
| Authentication on every endpoint | `require(Permission)` / `get_principal` dependencies | Automated gate: all 59 non-public operations depend on authentication and return 401 anonymously; only health and login are public |
| Tenant derived from identity | Session → membership; no tenant in request bodies | Cross-tenant tests for every module return 404 |
| RBAC + collection permissions | Role matrix + tenant/restricted collections + grants | Role tests per module; restricted-collection tests incl. retrieval and citations |
| Retrieval authorization | Collection intersection, tenant-filtered vector search, PostgreSQL re-validation | Deleted document with live vectors never returned; cross-tenant identical content isolated |
| No existence leaks | Identical 404 for missing/foreign/forbidden | Tests compare responses |
| Prompt injection | Delimited untrusted sources; grounding policy; citations must map to supplied sources; instruction-like text detector (flag in prompt, never quoted by extractive mode, ingestion warning) | Unit tests + evaluation canary (resistance 1.0 after fix) |
| Upload safety | Extension allowlist + content signature, size/page limits, zip-bomb and macro rejection, generated storage keys, path-traversal-safe storage | Unit and API tests |
| Session security | argon2id passwords; random tokens stored hashed; HttpOnly SameSite=Lax cookie; Secure required in production; CSRF header on cookie writes | Tests incl. CSRF rejection and logout revocation |
| Abuse controls | Rate limits on login/upload/chat (per process); tenant storage quota; model concurrency limit | Tests for login rate limit, quota, concurrency |
| Safe errors and logging | Standard error shape with correlation ID; validation errors never echo input; job errors use safe codes; logs carry IDs/counts only | Tests (redaction of unknown exception text, validation echo) |
| Security headers | nosniff, frame DENY, no-referrer, CSP `default-src 'none'` on API, no-store | Test |
| Audit trail | Logins, member/role changes, grants, documents, jobs, settings, infrastructure, evaluation | Tests |
| Dependency scanning | `npm audit` (0 vulnerabilities), `pip-audit` on runtime lock (no known vulnerabilities) — run manually 2026-10-27 | Not yet a CI gate |
| Secret scanning | Manual scan of all commits before first push (no secrets) | Not yet a CI gate |
| Deletion propagation | Async job removes vectors, stored file and chunk rows; document hidden immediately | End-to-end test |

Open risks: the development host has active malware detections (owner accepted, ADR-013);
rate limits are per process; retention policies, encryption at rest, malware scanning of uploads,
SSO/OIDC and backup/restore are not implemented. **This is not a production-readiness claim.**
