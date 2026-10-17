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
- The port is published on `127.0.0.1` only. The container runs as the `node` user,
  with a read-only root filesystem, a `tmpfs` at `/tmp`, all capabilities dropped and
  `no-new-privileges`.
- The server admits loopback peers and the one address in `WATCHTOWER_TRUSTED_CLIENTS`.
  On Docker Desktop for Windows, traffic to the published port reaches the server from
  the gateway of the compose network (`172.30.43.1`), not from `192.168.65.x`. This was
  measured on Docker Desktop 4.95 by holding a connection open and reading the container's
  socket table (`netstat -tn`). If you change the network's `subnet` or `gateway`, change
  `WATCHTOWER_TRUSTED_CLIENTS` with it. Without it, every request from the host gets 403.
- The image health check requests `/api/health` with Node's `fetch`.
