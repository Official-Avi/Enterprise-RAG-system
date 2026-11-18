# Production Go-Live Checklist

An ordered list an operator can follow to put RackFlow AI into production with Docker Compose and
Caddy. Work top to bottom and do not skip a step: later steps assume the earlier ones are done.

Written 2026-11-08 for branch `production-hardening-2026-11`, against the working tree on that date.

> **Status: nothing in this checklist has been executed end to end.** The development machine has no
> Docker, so the production Compose overlay, the Caddy configuration, the container images, TLS
> issuance and the new GitHub Actions jobs have only been checked statically (YAML parsing, a merge
> and interpolation script, hadolint, actionlint). Steps marked **(not verified here)** are where that
> matters most. The first production-style install is also the first real test of this setup. Use a
> staging host first.

Reference material:

| Topic | Where |
| --- | --- |
| Compose overlay, Caddy, client-address chain, timeouts | `deploy/README.md` |
| Every production variable and the rules the API enforces | `deploy/env.production.example`, `backend/src/rackflow/core/config.py` |
| Backup, restore, disaster recovery, restore drill | `scripts/ops/README.md` |
| Deployment guide and status | `Docs/DEPLOYMENT.md` §8 (production: §8.2, §8.3a, §8.8 to §8.12) |
| Security controls and open risks | `Docs/SECURITY.md` §9 and §10 |
| Decisions behind this setup | `Docs/DECISIONS.md` ADR-027 to ADR-034 |

---

## 0. Owner decisions and actions (before anything else)

None of these are code changes an operator can make. Each needs the owner. Record each answer in
`Docs/DECISIONS.md` or `Docs/PROGRESS.md`.

- [ ] **Cross-tenant membership add (ADR-026).** Today an org_admin of one tenant can add an existing
      account from another tenant by email. That reveals the account exists, adds the membership with no
      consent, and can change that user's default sign-in tenant. The code is deliberately unchanged
      until the owner chooses an option in ADR-026. With more than one real tenant on one install, decide
      **before** go-live.
- [ ] **Rotate the Groq API key.** The key used on the development stack was exposed in a chat
      session. Revoke it in the Groq console and create a new one. Put the new key only in the
      production `.env` (`MODEL_API_KEY`) or the secret store, never in a tracked file, a chat or a
      ticket.
- [ ] **Rotate the local database password.** It appeared in one agent's tool output during
      development. Change it on the development PostgreSQL (`ALTER ROLE rackflow PASSWORD ...`, then
      update `.env`). Production must use the freshly generated password from step 3, never a
      development one.
- [ ] **Malware scan, and credentials from the old machine.** The laptop had active malware detections
      before its 2026-11-01 reinstall (ADR-013), and no full scan is recorded since. Run a full
      Microsoft Defender scan (or the organisation's scanner) on the current machine. Treat every
      credential that was used or stored on the old install as compromised and rotate it: GitHub tokens
      and SSH keys, model provider keys, database passwords, cloud and registry logins. `Docs/env` and
      `Docs/demo-password.txt` date from that install: do not use them, and do not copy them to a server.
- [ ] **Data leaving the server.** With `MODEL_PROVIDER=anthropic` or a remote `openai_compatible`
      endpoint (for example Groq), **every answer sends the question, the matched document passages, and
      for a follow-up one earlier question, to that provider** (ADR-023). Whole files and embeddings are
      not sent. Decide whether that is acceptable for the documents this install will hold, and check the
      provider's data-retention and training terms. `MODEL_PROVIDER=extractive` (no model) or a
      self-hosted model on a private address sends nothing.
- [ ] **Public repository.** The GitHub repository is public. Keep secrets, real documents, production
      host names and customer names out of it, including out of issues and pull requests.
- [ ] Optional, but decide knowingly: the web Content-Security-Policy allows `'unsafe-inline'` scripts
      (ADR-033). A nonce-based policy would make every page dynamic, including the static landing page.

## 1. Code and CI gates (before deploying a commit)

- [ ] **Bump pypdf.** `backend/uv.lock` pins pypdf 6.21.2, which has 7 published advisories. The new
      `audit-python` job fails until this is fixed. Run
      `cd backend && uv lock --upgrade-package 'pypdf==6.21.4'` (a bare `--upgrade-package pypdf` jumps
      to the 7.0 major), then `uv sync` and the backend suite. The CI owner checked this change on a
      scratch copy: it changes only the pypdf entry, and pip-audit then reports no known vulnerabilities.
- [ ] **CI green on the commit you deploy**, including the new jobs: `backend`, `web`, `e2e`,
      `secrets`, `audit-python`, `audit-web`, `compose-smoke` (`.github/workflows/ci.yml`). **None of the
      new jobs have run on GitHub yet (not verified here).**
- [ ] Repository settings (owner): if the repository belongs to a GitHub organisation, add the
      `GITLEAKS_LICENSE` secret (gitleaks-action v2 needs it there). Make all seven jobs required checks
      on `main`. Turn on Dependabot alerts and security updates.
- [ ] Deploy a tagged commit from `main`, not a working tree.

## 2. Host preparation

- [ ] A Linux host with Docker Engine and **Docker Compose 2.24.4 or newer** (the overlay uses `!reset`).
- [ ] A DNS A/AAAA record for the public host name (`DOMAIN`) pointing at the host.
- [ ] Ports 80 and 443 (TCP, plus 443/UDP for HTTP/3) reachable from the internet, for ACME challenges and
      users. Every other port closed by the host firewall. Only Caddy publishes ports under the overlay.
- [ ] The Compose subnet `172.30.0.0/24` does not overlap a network on the host. If it does, change the
      subnet, both fixed addresses (web `172.30.0.10`, caddy `172.30.0.11`) and `TRUSTED_PROXY_IPS` in
      `deploy/compose.prod.yml` together (`deploy/README.md`).
- [ ] Disk for the volumes (`pgdata`, `qdrantdata`, `objects`, `models`, `caddy_data`) and for backups.
      A Qdrant snapshot can be far larger than its vectors (about 660 MB for 9 points on the local test).
- [ ] Python 3.12 and the backend virtualenv on the host (or a separate ops host), plus PostgreSQL 18
      client tools, for `scripts/ops/backup.py` and `restore.py`.

## 3. Generate the production `.env`

- [ ] Generate it next to `docker-compose.yml`:
      ```
      python scripts/ops/generate_env.py --output .env --domain <DOMAIN> --tls-issuer <ops-email>
      ```
      It writes `APP_ENV=production`, `COOKIE_SECURE=true`, `DEMO_MODE=false`, `LOG_LEVEL=INFO`, https
      `WEB_ORIGIN`/`API_BASE_URL`, and fresh 43-character URL-safe secrets for `POSTGRES_PASSWORD` (also
      inside `DATABASE_URL`) and `VECTOR_STORE_API_KEY` (also as `QDRANT__SERVICE__API_KEY`). It refuses
      to overwrite an existing file unless `--force`, creates it with mode 600 on POSIX, and prints only
      variable names, never values.
- [ ] Fill what it lists as still to fill in. For a model: `MODEL_PROVIDER`, `MODEL_NAME`,
      `MODEL_BASE_URL`, `MODEL_API_KEY` (the rotated key from step 0). Leave `extractive` to send nothing
      off the server.
- [ ] Check the file is readable only by the deploying user (`ls -l .env` shows `-rw-------`).
- [ ] Keep a copy of `.env` in the organisation's secret store. `POSTGRES_PASSWORD` is only applied when
      the database volume is first created, and a restore needs it.
- [ ] Timeouts: `WEB_PROXY_TIMEOUT_SECONDS` is in **whole** seconds (default 120). Compose derives the
      web's `API_PROXY_TIMEOUT_MS` from it, so `API_PROXY_TIMEOUT_MS` in `.env` is ignored by Compose.
      `MODEL_TIMEOUT_SECONDS` (default 60) must be below it, or the API refuses to start. If you raise
      `WEB_PROXY_TIMEOUT_SECONDS` above about 170, raise `CADDY_UPSTREAM_TIMEOUT` (default `180s`) by hand.
      With `MODEL_PROVIDER=anthropic` the client retries once, so a worst-case answer can take about
      twice `MODEL_TIMEOUT_SECONDS` plus queueing: leave a wide margin.

The API refuses to start in production if any of these are wrong; the error names the variable, never
its value (ADR-027): `COOKIE_SECURE`, `DEMO_MODE`, a test embedding provider, the database password
(missing, `rackflow`, equal to the user name, or under 16 characters), non-https `WEB_ORIGIN` or
`API_BASE_URL`, a remote `VECTOR_STORE_URL` without https and a key, a remote model endpoint without
https and a key, `LOG_LEVEL` DEBUG or NOTSET, or `MODEL_TIMEOUT_SECONDS` not below
`WEB_PROXY_TIMEOUT_SECONDS`.

## 4. Static checks on the host (not verified here)

```
export COMPOSE_FILE=docker-compose.yml:deploy/compose.prod.yml COMPOSE_PROFILES=prod
docker compose config --quiet
docker run --rm -e DOMAIN=localhost -e TLS_ISSUER=internal \
  -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

- [ ] Both exit 0. `config` fails with a clear message if `DOMAIN`, `TLS_ISSUER`, `POSTGRES_PASSWORD`,
      `VECTOR_STORE_API_KEY` or `QDRANT__SERVICE__API_KEY` is missing.
- [ ] `caddy:2.10.2` is still a current 2.x tag. Base images (`python:3.12.16-slim-trixie`,
      `node:24.22.2-alpine3.24`, `ghcr.io/astral-sh/uv:0.12.22`) are pinned by tag; digests are noted in
      the Dockerfile comments but not applied.

## 5. Start the stack (not verified here)

```
docker compose up -d --build
docker compose ps
```

- [ ] `migrate` exited 0; `api` and `web` show `healthy`; `worker` shows running with no health status
      (its healthcheck is disabled: it serves no HTTP); postgres, qdrant and caddy are running.
- [ ] Every later `docker compose` command uses the same files and profile (the two exports above do
      that for the shell).
- [ ] Readiness from inside the network:
      `docker compose exec api python -c "import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/api/v1/health/ready').read())"`
      shows `"status": "ready"` with all five checks true (section 7 explains them). On a cold model cache
      `embeddings` stays false until the embedding model has downloaded.

## 6. Verify the edge (not verified here)

- [ ] `curl -sI https://<DOMAIN>/login` returns 200 with a valid certificate, and
      `strict-transport-security: max-age=31536000` (no `includeSubDomains`), a `content-security-policy`,
      `cross-origin-opener-policy: same-origin` and `x-frame-options: DENY`. No `Server` header.
- [ ] `curl -sI http://<DOMAIN>/login` redirects to https.
- [ ] Caddy's access log (`docker compose logs caddy`) shows real client addresses as `remote_ip`, not
      `172.30.0.1`. If every request shows the gateway, Docker's userland proxy is in the path and all
      clients share one rate-limit bucket: set `"userland-proxy": false` in the Docker daemon config, or
      enable IPv6 on the Compose network (`deploy/README.md`).
- [ ] A sign-in request with a forged `X-Forwarded-For` header is limited by the real address, not the
      forged one (repeat wrong passwords from one client: the 429 still arrives).
- [ ] Qdrant refuses requests without the key:
      `docker compose exec api python -c "import urllib.request as u; u.urlopen('http://qdrant:6333/collections')"`
      fails with HTTP 401.
- [ ] No other port answers from outside: 3000, 8000, 5432 and 6333 are not published.
- [ ] `https://<DOMAIN>/api/v1/docs` returns 404 (API docs are off in production).

## 7. First administrator

Production has no demo accounts. `seed-demo` and `seed-eval` refuse to run with `APP_ENV=production`
unless given `--allow-in-production`; do not pass it on a real install.

- [ ] Create each tenant and its first org_admin:
      ```
      docker compose exec api rackflow-admin bootstrap-admin \
        --tenant <slug> --tenant-name "<name>" --email <admin-email>
      ```
      With no `RACKFLOW_ADMIN_PASSWORD` in the container's environment, a password that meets the policy
      is generated and printed **once**. Put it straight into a password manager. It refuses with exit 2
      if the tenant already has an org_admin, and records the audit event `member.bootstrap_admin`.
      (Passing your own password through `--password-env` needs the variable inside the container; the
      generated route avoids putting it on a command line.)
- [ ] Sign in at `https://<DOMAIN>/login` as that admin, add the other members from the admin console,
      and give each new member their one-time password through a private channel.
- [ ] `GET https://<DOMAIN>/api/v1/auth/demo` reports demo sign-in disabled, and the landing page shows
      no demo accounts.
- [ ] Upload one small document, wait for Ready, ask one question, and check the answer cites it. Then
      readiness still reports `vector_collection_consistent: true`.

Password policy for accounts created by the CLI (`bootstrap-admin`, `create-user`, `seed-demo`): 12 to
512 characters, not a common or project password, no fragments such as `password`, `qwerty`, `123456`
or `rackflow`, at least 5 distinct characters, and not containing the email name. Passwords chosen
through the admin API are not yet checked against this policy (SECURITY.md §10).

## 8. Backups and the restore drill

- [ ] Give the host loopback-only access to PostgreSQL and Qdrant for the backup scripts with a third
      Compose file kept on the host (`compose.backup.yml` in `scripts/ops/README.md`). **The merge of that
      file with the overlay's `ports: !reset []` is not verified here.**
- [ ] Take the first backup by hand and check exit 0:
      `python scripts/ops/backup.py --output /srv/backups/rackflow --keep 14`. It writes one
      `rackflow-backup-<UTC timestamp>/` directory holding `postgres.dump`, `qdrant.snapshot`,
      `objects.tar.gz` and `manifest.json` (sizes, sha256, versions, Alembic revision, row and point
      counts). On POSIX it is owner-only (directories 0700, files 0600); make `--output` 0700 yourself if
      it already exists.
- [ ] Schedule it (cron or a systemd timer, nightly), alert on a non-zero exit, and choose the retention:
      `--keep N` keeps the newest N backups and deletes only older directories this tool wrote. 14 nightly
      backups is the documented example, not a requirement.
- [ ] Copy backups off the host, encrypted. The tool does neither. Backups contain every tenant's
      documents, password hashes and session-token hashes.
- [ ] **Run the restore drill before go-live, then monthly and after any PostgreSQL or Qdrant upgrade**
      (`scripts/ops/README.md`, "Restore drill"): restore the latest backup into new names
      (`--target-db rackflow_restore_drill --target-collection rackflow_restore_drill --target-storage <dir>`),
      expect exit 0 and "every count matches", then drop the drill database and collection. The drill
      passed on the local Windows stack on 2026-11-07; it has not been run against Docker volumes.
- [ ] Read the disaster-recovery steps for the production overlay (restore over the original names with
      `--chown 10001:10001`, because the containers run as UID/GID 10001). Not verified here.

## 9. Monitoring and operations

- [ ] Liveness probe: `GET /health/live` or `/api/v1/health/live` (no dependencies; restart only on
      failure). Readiness: `GET /api/v1/health/ready` (take out of service on 503, do not restart).
- [ ] Readiness checks, all booleans: `database` (one bounded query, 2 s statement timeout),
      `vector_store` (one Qdrant count, 3 s timeout), `vector_collection` (the collection exists, or
      nothing is indexed yet), `vector_collection_consistent` (if live indexed chunks exist, the
      collection exists and holds at least one point), `embeddings` (the model embeds a short string within
      5 s; success cached 60 s). Monitoring that matches the exact key set must include
      `vector_collection_consistent`.
- [ ] Alert on the log events `readiness_vector_collection_inconsistent` and `vector_collection_created`.
      Readiness does not catch a collection that was lost, recreated and then refilled by new uploads;
      older documents then have no vectors. Recover with `rackflow-admin reindex --tenant <slug>`.
- [ ] Worker liveness is its database heartbeat (Operations page, stale after 15 s), not a container
      healthcheck.
- [ ] Ship container logs (JSON on stdout) somewhere with retention. Logs carry IDs and counts, not
      document text, prompts or answers.
- [ ] Rate limits are per API process. Keep one API replica, or accept per-replica limits.

## 10. After go-live

- [ ] Upgrades: take a backup, `git pull` the new tag, `docker compose up -d --build`. `migrate` applies
      migrations before the API and worker start. Downgrades drop tables: restore from the backup instead.
- [ ] Review Dependabot pull requests weekly (Python, npm, Docker images, Compose, GitHub Actions).
- [ ] Rotate `POSTGRES_PASSWORD` (inside PostgreSQL with `ALTER ROLE`, then `.env`), the Qdrant key (both
      variables together) and `MODEL_API_KEY` on the organisation's schedule, and at once after any
      suspected exposure. Restored backups bring back old sessions: revoke them after a credential
      incident.
- [ ] Re-run the restore drill monthly and record the result.

## Known gaps that remain after this checklist

These are accepted or open, not steps to skip silently (details in `SECURITY.md` §10 and `TODO.md`):

- No malware scanning of uploaded files, no encryption at rest beyond the host's disk, no retention
  policies, no SSO.
- Object storage is a local Docker volume; there is no S3 adapter. One host only: no high availability.
- No load test: no concurrency or throughput is claimed.
- No tracing, metrics export or alerting is built in.
- Backups are not encrypted or copied off the host by the tool.
- The Content-Security-Policy allows inline scripts (ADR-033).
