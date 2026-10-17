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

`pnpm start` runs `scripts/start.mjs`, which always binds to `127.0.0.1:4321`.
Do not start `dist/server/entry.mjs` directly: it no longer starts a server.

### In Docker

```sh
docker compose up --build
```

Or `pnpm docker:up` (build, start detached and wait until healthy), and
`pnpm docker:down` to stop it. Open `http://localhost:4321/`.

Only one of the two can run at a time, because both use port 4321 on the host.

How the container is set up (`Dockerfile`, `compose.yaml`):

- The workstation (`../..`) is mounted read-only at `/workstation`, and polled every
  2 s (`WATCHTOWER_POLL_MS`), because file events from a Windows host do not reach the
  container through the bind mount.
- Logs: `../../limforia/logs/watchtower` is bind-mounted read-write at `/var/log/app`
  (`LOG_DIR`), so log files land in `limforia/logs/watchtower/bff/` and `client/` on the
  host. It is a separate mount, not nested under `/workstation`. Compose creates the
  host folder if it is missing. The same files are also visible read-only under
  `/workstation/limforia/logs/`, which the watcher always ignores.
- The port is published on `127.0.0.1` only. The container runs as the `node` user,
  with a read-only root filesystem (the log mount and a `tmpfs` at `/tmp` are the only
  writable paths), all capabilities dropped and
  `no-new-privileges`.
- The server admits loopback peers and the one address in `WATCHTOWER_TRUSTED_CLIENTS`.
  On Docker Desktop for Windows, traffic to the published port reaches the server from
  the gateway of the compose network (`172.30.43.1`), not from `192.168.65.x`. This was
  measured on Docker Desktop 4.95 by holding a connection open and reading the container's
  socket table (`netstat -tn`). If you change the network's `subnet` or `gateway`, change
  `WATCHTOWER_TRUSTED_CLIENTS` with it. Without it, every request from the host gets 403.
- The image health check requests `/api/health` with Node's `fetch`.

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
