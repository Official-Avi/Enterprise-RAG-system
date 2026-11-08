# Production deployment with TLS (Docker Compose)

`docker-compose.yml` on its own is the development stack: plain HTTP, every service published on
127.0.0.1. Production adds two things:

- `deploy/compose.prod.yml`, an overlay that stops everything but Caddy from publishing ports and
  switches the backend to production settings;
- the `prod` profile, which starts `caddy` (image `caddy:2.10.2`, config `deploy/caddy/Caddyfile`).

```
client --HTTPS--> caddy 172.30.0.11 :443 --HTTP--> web 172.30.0.10 :3000 --/api--> api :8000
```

Requirements: Docker Compose 2.24.4 or newer (the overlay uses `!reset`), a Linux host whose ports
80 and 443 are reachable from the internet (ACME HTTP-01/TLS-ALPN-01 challenges), and a DNS A/AAAA
record for `DOMAIN` pointing at it.

## Start

Generate `.env` next to `docker-compose.yml` (never commit it) with

```
python scripts/ops/generate_env.py --output .env --domain <DOMAIN> --tls-issuer <email|internal>
```

It fills the secrets below; `deploy/env.production.example` documents every variable. The ones
this setup depends on:

| Variable | Required | Meaning |
| --- | --- | --- |
| `DOMAIN` | yes | Public host name, one name only, e.g. `rag.example.com`. Also sets `WEB_ORIGIN` and `API_BASE_URL` to `https://DOMAIN`. |
| `TLS_ISSUER` | yes | An e-mail address: certificates from a public ACME CA, with that address as the contact. `internal`: certificates from Caddy's own CA, for test hosts only. |
| `POSTGRES_PASSWORD` | yes | A generated, URL-safe password; production refuses the default and short ones. |
| `QDRANT__SERVICE__API_KEY` | yes | The key the Qdrant server requires. |
| `VECTOR_STORE_API_KEY` | yes | The key the API, the worker and the ops scripts send to Qdrant. Must equal `QDRANT__SERVICE__API_KEY`, or every vector call gets 401 and `/api/v1/health/ready` fails. |
| `WEB_PROXY_TIMEOUT_SECONDS` | no | Web `/api` proxy timeout in **whole** seconds, default `120`. Compose derives the web's `API_PROXY_TIMEOUT_MS` from it (the value followed by `000`), so the two cannot drift; `API_PROXY_TIMEOUT_MS` in `.env` is not read by Compose. `MODEL_TIMEOUT_SECONDS` must stay below it. |
| `CADDY_UPSTREAM_TIMEOUT` | no | How long Caddy waits for web's response headers, default `180s`. Keep it above `WEB_PROXY_TIMEOUT_SECONDS`; raise it whenever that goes above about 170. |

```
docker compose -f docker-compose.yml -f deploy/compose.prod.yml --profile prod up -d --build
docker compose -f docker-compose.yml -f deploy/compose.prod.yml --profile prod ps
```

Every later command (`ps`, `logs`, `exec`, `down`) needs the same `-f` and `--profile` flags, or set
them once in the shell: `export COMPOSE_FILE=docker-compose.yml:deploy/compose.prod.yml
COMPOSE_PROFILES=prod`.

The overlay fixes, regardless of `.env`: `APP_ENV=production`, `COOKIE_SECURE=true`,
`DEMO_MODE=false`, `TRUSTED_PROXY_IPS=172.30.0.10,172.30.0.11`. Postgres, Qdrant, the API and web
publish no host ports; reach them with `docker compose exec`. Caddy publishes 80 (redirects to
HTTPS and answers ACME challenges), 443/tcp and 443/udp (HTTP/3).

The overlay also:

- **Requires the Qdrant key.** Qdrant gets `QDRANT__SERVICE__API_KEY`; the API, worker and migrate
  get `VECTOR_STORE_API_KEY`. Without it any process on the Compose network could read or delete
  every tenant's vectors. Host-side `scripts/ops/backup.py`/`restore.py` read `VECTOR_STORE_API_KEY`
  from the same `.env` and send it as `api-key`.
- **Restarts services** (`restart: unless-stopped`) on postgres, qdrant, api, worker, web and caddy,
  so the stack comes back after a crash, a Docker daemon restart or a reboot. `migrate` has none: it
  is a one-shot job the API and worker wait for.
- **Drops privileges** on api, worker, migrate and web: `read_only: true`, `cap_drop: [ALL]`,
  `no-new-privileges`. Both images already run as UID/GID 10001. Writable paths are the `objects`
  and `models` volumes and tmpfs mounts: `/tmp` (512 MiB on api and worker for upload spooling,
  16 MiB on migrate and web) and web's `/app/.next/cache` (128 MiB). tmpfs counts against memory.
  Bind mounts used instead of the `objects`/`models` volumes must be writable by UID/GID 10001.
  postgres, qdrant and caddy keep their image defaults.

Healthchecks: the API's probes `/api/v1/health/live` (no dependencies); web has the image's own
check, and Caddy starts only once web is healthy. The worker and migrate share the backend image
but serve no HTTP, so their healthcheck is disabled; worker liveness is its database heartbeat on
the Operations page.

### Test host with self-signed certificates

`DOMAIN=localhost` (or the test host's name or IP address) and `TLS_ISSUER=internal`. Caddy issues
certificates from its own CA; browsers warn unless that CA is trusted. Its root certificate is at
`/data/caddy/pki/authorities/local/root.crt` inside the caddy container. HSTS is still sent, so a
browser that accepted the warning will insist on HTTPS for that name for a year.

## What Caddy does

- Automatic HTTPS for `DOMAIN`, HTTP to HTTPS redirect, certificate renewal. Certificates and the ACME
  account live in the `caddy_data` volume; do not delete it, or Caddy re-issues and may hit CA rate
  limits.
- `Strict-Transport-Security: max-age=31536000`, the same value the web app sends in production. One
  policy, set identically in both layers: Caddy's header block (it also removes `Server`) replaces
  the app's header on proxied responses, and also covers Caddy's own responses (413, 502). No
  `includeSubDomains` and no `preload`: they would bind sibling hosts of the operator's domain. To
  change the policy, change `deploy/caddy/Caddyfile` and `apps/web/next.config.ts` together. The other
  security headers (CSP, COOP, X-Frame-Options, ...) come from the web app and pass through unchanged.
- Request bodies up to 26 MiB: the 25 MiB per-file upload limit plus multipart overhead, equal to the
  web proxy's `proxyClientMaxBodySize`. Larger bodies get `413`.
- Timeouts: response headers from web 180 s (above the web proxy's 120 s, so the app's own timeout
  answers first), request body 10 min (slow uploads), request headers 30 s, idle 5 min.
- JSON access log on stdout (`docker compose ... logs caddy`); Caddy redacts `Cookie` and
  `Authorization`.

## Client addresses and `TRUSTED_PROXY_IPS`

Sign-in and demo rate limits are per client address. The API (`ratelimit.client_ip`, ADR-025) uses
the connecting peer, and reads `X-Forwarded-For` only when that peer is in `TRUSTED_PROXY_IPS`, from
the right, taking the first address that is not itself trusted.

The chain in production, hop by hop:

1. **Client to Caddy.** Caddy has no `trusted_proxies`, so it treats every client as untrusted:
   it ignores any `X-Forwarded-For` the client sent and sets the header to the client's own
   address. A forged header never gets past Caddy.
2. **Caddy to web.** The Next `/api` rewrite forwards `X-Forwarded-For` unchanged and adds nothing.
3. **Web to API.** The API's peer is web, `172.30.0.10`. It is trusted, so the API reads the header,
   whose only entry is the real client address, and rate limits by it.

Trusted addresses, and why:

| Address | Trusted because |
| --- | --- |
| `172.30.0.10` (web) | **Required.** It is the API's peer for every browser request. Without it every client shares one rate-limit bucket. |
| `172.30.0.11` (caddy) | Defensive. The API never sees Caddy as a peer, and Caddy's address is not in the header today. If the web proxy ever starts appending its own peer, the API skips Caddy's address instead of treating every request as coming from Caddy. |

Both are fixed in `docker-compose.yml` and lie outside the network's `ip_range`
(`172.30.0.128/25`), so no other container can be given them. Do **not** add anything else:

- not the Docker gateway (`172.30.0.1`) or the whole subnet: then a header set by anything that can
  reach the API or web directly would be believed;
- not the public internet or `0.0.0.0/0` (refused at startup anyway).

Rules that keep this safe:

- **Web (3000) and the API (8000) must never be published** while `TRUSTED_PROXY_IPS` is set. The
  overlay removes both; do not add them back. Anyone who can reach web directly can state any address.
- **Do not add `trusted_proxies` to the Caddyfile** unless another proxy or load balancer sits in
  front of Caddy. If one does, set Caddy's `trusted_proxies` to exactly that proxy's addresses (in the
  global `servers` block) and keep the API's `TRUSTED_PROXY_IPS` as it is.
- **Check that Caddy sees real client addresses.** With Docker's default iptables port publishing,
  it does. If `docker compose ... logs caddy` shows `172.30.0.1` (the gateway) as `remote_ip` for every
  request, Docker's userland proxy is in the path (common for IPv6 clients on an IPv4-only network);
  rate limits then fall back to one shared bucket. Fix it with `"userland-proxy": false` in the Docker
  daemon config, or by enabling IPv6 on the Compose network.

If the network's subnet has to change (it overlaps a host network), change the subnet, both fixed
addresses in `docker-compose.yml`, and `TRUSTED_PROXY_IPS` in `deploy/compose.prod.yml` together.

## Timeouts, kept consistent

| Setting | Where | Default |
| --- | --- | --- |
| `MODEL_TIMEOUT_SECONDS` | API | 60 s; production requires it below `WEB_PROXY_TIMEOUT_SECONDS` |
| `WEB_PROXY_TIMEOUT_SECONDS` | API, worker, migrate | 120 s (whole seconds) |
| `API_PROXY_TIMEOUT_MS` | web (build argument and runtime) | derived by Compose: `${WEB_PROXY_TIMEOUT_SECONDS}000` |
| `CADDY_UPSTREAM_TIMEOUT` | caddy | 180 s; keep above `WEB_PROXY_TIMEOUT_SECONDS` |

Only `WEB_PROXY_TIMEOUT_SECONDS` sets the web proxy timeout in Docker: Compose appends `000` to it
for the web's `API_PROXY_TIMEOUT_MS`, so the API's assumption and the web proxy cannot disagree,
and the API's production check (`MODEL_TIMEOUT_SECONDS` below it) covers the whole chain. A value
that is not a whole number (`120.5`) makes the web build fail on purpose. `next.config.ts` is
compiled into the standalone build, so a new value needs `--build`. (Outside Docker, `next dev` /
`next build` still read `API_PROXY_TIMEOUT_MS` directly.)

## Not verified

This setup was written on a machine without Docker. The YAML was parsed and its references checked
with a script; `docker compose config`, a Caddy start, certificate issuance and an end-to-end request
through Caddy have not been run. Before relying on it, run on the target host:

```
docker compose -f docker-compose.yml -f deploy/compose.prod.yml --profile prod config --quiet
docker run --rm -e DOMAIN=localhost -e TLS_ISSUER=internal \
  -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.10.2 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

then, once up, `curl -sI https://DOMAIN/login` (expect `strict-transport-security: max-age=31536000`),
a sign-in with a forged `X-Forwarded-For` to confirm it is ignored, an upload (read-only root with
the `/tmp` tmpfs), `ps` showing api and web healthy and worker running with no health status, and
`docker compose ... exec api python -c "import urllib.request as u; u.urlopen('http://qdrant:6333/collections')"`
failing with 401 (Qdrant refuses requests without the key).
