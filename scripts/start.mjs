// Starts the built Watchtower: `node scripts/start.mjs` (also `pnpm start`, the container CMD).
//
// The adapter runs in middleware mode, so this script owns the HTTP server. That puts the
// request guard (Host and peer policy) and the security headers in front of every request,
// static files included; in standalone mode the adapter served `dist/client` before any
// middleware ran.
//
// On the host it listens on 127.0.0.1 only: the Watchtower must never listen on 0.0.0.0 there
// (SPEC section 1). Only container mode (WATCHTOWER_CONTAINER=1) honours HOST, defaulting to
// 0.0.0.0 inside the container; compose then publishes the port on 127.0.0.1 only.
// PORT is configurable in both (default 4321). See scripts/server-env.mjs for every setting.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequestListener } from './http-server.mjs';
import { createRequestPolicy } from './request-guard.mjs';
import { readServerEnv, ServerEnvError } from './server-env.mjs';
import { createStaticHandler } from './static-files.mjs';

let settings;
try {
  settings = readServerEnv(process.env);
} catch (err) {
  if (!(err instanceof ServerEnvError)) throw err;
  console.error(`[watchtower] refusing to start: ${err.message}`);
  process.exit(1);
}

// The app reads these too (the middleware validates the same environment).
process.env.HOST = settings.host;
process.env.PORT = String(settings.port);

const { handler } = await import('../dist/server/entry.mjs');
const listener = createRequestListener({
  policy: createRequestPolicy(settings),
  serveStatic: createStaticHandler(fileURLToPath(new URL('../dist/client/', import.meta.url))),
  app: handler,
});

const server = createServer(listener);
server.on('error', (err) => {
  console.error(`[watchtower] server error: ${err.message}`);
  process.exit(1);
});
server.listen(settings.port, settings.host, () => {
  console.info(
    `[watchtower] listening on http://${settings.host}:${settings.port}` +
      (settings.container ? ' (container mode)' : ''),
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
