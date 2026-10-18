// Starts the built Watchtower: `node scripts/start.mjs` (also `pnpm start`, the container CMD).
//
// The adapter runs in middleware mode, so this script owns the HTTP server: request ids,
// the request guard (Host and peer policy) and the security headers sit in front of every
// request, static files included, and each request is logged once here.
//
// It validates the environment BEFORE loading the bundle, with the same validator the app
// uses (scripts/server-env.mjs; see the README), and refuses to start on any problem.
// On the host it listens on 127.0.0.1 only (SPEC section 1); only container mode
// (WATCHTOWER_CONTAINER=1) honours HOST. PORT is configurable in both (default 4321).
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { createRequestListener } from './http-server.mjs';
import { createLogger } from './logger.mjs';
import { createRequestPolicy } from './request-guard.mjs';
import { readServerEnv, ServerEnvError, summariseServerEnv } from './server-env.mjs';
import { createStaticHandler } from './static-files.mjs';

// The production launcher: NODE_ENV defaults to production (the app reads the same value).
process.env.NODE_ENV ??= 'production';

let settings;
try {
  settings = readServerEnv(process.env);
} catch (err) {
  if (!(err instanceof ServerEnvError)) throw err;
  // The one console call in server code: there is no valid LOG_DIR or level to build the
  // logger from yet. The message names the variables, never their values.
  // eslint-disable-next-line no-console
  console.error(`[watchtower] refusing to start: ${err.message}`);
  process.exit(1);
}

const { system, forRequest } = createLogger({
  service: 'bff',
  env: settings.nodeEnv,
  level: settings.logLevel,
  logDir: settings.logDir,
});

// The build to serve: WATCHTOWER_DIST_DIR (default ./dist), the same folder astro build wrote.
const entry = join(settings.distDir, 'server', 'entry.mjs');
if (!existsSync(entry)) {
  system.fatal('server.no_build', 'No build to serve: run pnpm build first', {
    variable: 'WATCHTOWER_DIST_DIR',
  });
  process.exit(1);
}
const { handler } = await import(pathToFileURL(entry).href);
const listener = createRequestListener({
  policy: createRequestPolicy(settings),
  serveStatic: createStaticHandler(join(settings.distDir, 'client')),
  app: handler,
  logger: { forRequest },
});

const server = createServer(listener);
server.on('error', (err) => {
  system.fatal('server.failed', 'Server error', { err });
  process.exit(1);
});
server.listen(settings.port, settings.host, () => {
  system.info('server.started', 'Server started', {
    version: pkg.version,
    url: `http://${settings.host}:${settings.port}`,
    config: summariseServerEnv(settings),
  });
});

const shutdown = (signal) => {
  system.info('server.stopping', 'Server stopping', { signal });
  server.close(() => {
    system.info('server.stopped', 'Server stopped', { version: pkg.version });
    process.exit(0);
  });
  // Open SSE streams keep the server open: close them after a short grace period.
  setTimeout(() => {
    server.closeAllConnections();
  }, 2000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
