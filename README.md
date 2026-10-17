# The Watchtower

A local live dashboard of the workstation (`F:\Projects`). It reads the workstation
read-only and is served on `http://localhost:4321/` only. See `SPEC.md` and ADR-002.

## Running it

### On the host

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`pnpm start` runs `scripts/start.mjs`. On the host it always binds to `127.0.0.1` (the
address is fixed); the port is `4321` unless `PORT` sets another.
Do not start `dist/server/entry.mjs` directly: it no longer starts a server.

### In Docker, behind the workshop gateway

The container is reached only through the workshop gateway (`infra/gateway/`), at
**https://dev-watchtower.workshop.io**. No port is published on the host.

```sh
# Once: the gateway. It also creates the Docker network `workshop`.
cd infra/gateway && scripts/new-certs.sh && docker compose up -d --build
# Then the Watchtower.
cd apps/watchtower && docker compose up -d --build --wait
```

Or `pnpm docker:up` (build, start detached and wait until healthy), and `pnpm docker:down`
to stop it. The browser needs two one-time steps by the User: the hosts line
`127.0.0.1 dev-watchtower.workshop.io` and trust in the Workshop Local CA. Both are
described in `infra/gateway/README.md`. To check it without them:

```sh
curl --resolve dev-watchtower.workshop.io:443:127.0.0.1 \
     --cacert infra/gateway/certs/ca/workshop-ca.crt --ssl-no-revoke \
     https://dev-watchtower.workshop.io/api/health
```

The host server (`pnpm start`, on `127.0.0.1:4321`) and the container no longer compete
for a port, so both can run at once.

How the container is set up (`Dockerfile`, `compose.yaml`):

- **Network.** The container joins the external network `workshop` as `watchtower`, the
  DNS name the gateway proxies to (`http://watchtower:4321`). Start the gateway first,
  because `docker compose up` here needs the `workshop` network to exist.
- **Trust.** The server admits loopback peers (its own HEALTHCHECK) and exactly one remote
  peer: the gateway's fixed address `172.30.50.2` (`WATCHTOWER_TRUSTED_CLIENTS`).
  `WATCHTOWER_PUBLIC_ORIGIN=https://dev-watchtower.workshop.io` admits that Host and is
  the origin for same-origin checks (see _Container mode and the gateway_ below).
  Anything else gets 403.
- **Workstation.** `../..` is mounted read-only at `/workstation` and polled every 2 s
  (`WATCHTOWER_POLL_MS`), because file events from a Windows host do not reach the
  container through the bind mount.
- **Logs.** `../../limforia/logs/watchtower` is bind-mounted read-write at `/var/log/app`
  (`LOG_DIR`), so log files land in `limforia/logs/watchtower/bff/` and `client/` on the
  host. It is a separate mount, not nested under `/workstation`. Compose creates the
  host folder if it is missing. The same files are also visible read-only under
  `/workstation/limforia/logs/`, which the watcher always ignores.
- **Hardening.** The container runs as the `node` user, with a read-only root filesystem
  (the log mount and a `tmpfs` at `/tmp` are the only writable paths), all capabilities
  dropped and `no-new-privileges`.
- **Health.** The image health check requests `/api/health` on `127.0.0.1:4321` inside
  the container, with Node's `fetch`.

## Architecture (ADR-004)

- **Layout.** Routes in `src/pages/api/` are thin: validate, call one handler, return.
  All server logic lives in `src/server/`: `handlers/` (one per use case), `services/`
  (business logic), `sources/` (read-only filesystem and git access, with their
  parsers), `live/` (watcher, poller, event tail, SSE), `render/`, `security/`,
  `schemas/` (input validation), `middleware/`, `errors/` (typed errors, turned into
  responses in one place: `errors/route.ts`), `config/` and `logging/`. Types and
  constants the browser needs live in `src/shared/` (no Node imports). ESLint forbids
  `src/components`, `src/ui`, `src/layouts` and `src/shared` from importing server code.
- **Stateless (Order 1).** Nothing a request depends on is kept on the instance. The
  only in-memory state is speed-only and rebuilt from the workstation at any time: the
  snapshot cache, the file watcher and event-log tail, and the client-error rate limiter
  (losing it only resets the limits). Killing or restarting the server loses nothing.
- **BFF (Order 2).** The browser calls only this app's own endpoints (`/api/*`). It makes
  no calls to any other service, internal or external.

## Configuration (ADR-006)

Every variable is listed and documented in `.env.example`; all are optional. The app
reads the environment only through `src/server/config/env.ts`, which is typed, frozen and
validated at startup, and fails fast naming the variable (never its value).

**Exception, recorded here:** the validator itself is `scripts/server-env.mjs` (plain JS),
not TypeScript in `src/server/config/`. `scripts/start.mjs` must validate the environment
before the built server is loaded, and the bundle cannot be imported for that. So there is
still exactly one implementation: `env.ts` re-exports it, typed. The same applies to the
logger (`scripts/logger.mjs`, typed in `src/server/logging/logger.ts`), which `start.mjs`
uses for startup and shutdown lines.

### Container mode and the gateway

- **Docker Desktop's Run button is not supported.** It starts the image without the
  read-only workstation mount and the trusted network that `compose.yaml` provides, so
  the server stops at once with: "No workstation is mounted at /workstation. Run The
  Watchtower with `docker compose up` from apps/watchtower (see README)." Use
  `docker compose up` (see In Docker above).
- **Behind the workstation gateway** (nginx at `https://dev-watchtower.workshop.io`), set
  `WATCHTOWER_PUBLIC_ORIGIN` to that origin. Its host is then admitted as a Host header,
  and `POST /api/client-errors` accepts it as the page's origin. `X-Forwarded-*` headers
  are never trusted: the peer check (`WATCHTOWER_TRUSTED_CLIENTS`, the gateway's address)
  stays the trust boundary. `/api/stream` sends `X-Accel-Buffering: no` so the proxy does
  not buffer live updates.

## Logging (ADR-005)

- Structured JSON (pino) to stdout and to `<LOG_DIR>/bff/YYYY-MM-DD.jsonl`; client error
  reports go to `<LOG_DIR>/client/YYYY-MM-DD.jsonl`. `LOG_DIR` defaults to
  `<WATCHTOWER_ROOT>/limforia/logs/watchtower`; in Docker it is `/var/log/app`.
- Every line has `time, level, app, service, env, requestId, msg, event`. Each request
  gets an id (a well-formed incoming `x-request-id` of 8-64 `[A-Za-z0-9_-]`, or a new
  UUID), returned in the `x-request-id` response header, and one `request.completed` line
  (method, route without the query string, status, durationMs). Credentials and
  token-like fields are redacted.
- In production the Node edge (`scripts/http-server.mjs`) logs each request; under
  `astro dev` the Astro middleware does.
- The browser reports errors only, through `POST /api/client-errors`
  (`src/ui/client-errors.ts`): readable reports, at most 5 per page load, never form
  contents, raw error messages or stack traces. The endpoint is same-origin only, caps the
  body at 4 KB, rate-limits each client (10 a minute) and writes each distinct report once
  per 5 minutes.
