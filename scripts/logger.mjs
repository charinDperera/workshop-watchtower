// The Watchtower's logger (ADR-005): structured JSON, one event per line, to stdout and to
// `<logDir>/<service>/YYYY-MM-DD.jsonl` (UTC day). The ONE implementation, shared by
// `scripts/start.mjs` and the app (typed facade: `src/server/logging/logger.ts`).
//
// Every line carries: time, level, app, service, env, requestId (null outside a request),
// msg and event. `event` is a required argument, so it cannot be forgotten.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';

export const APP_NAME = 'watchtower';

/** Field names that are never logged: credentials and anything token-like. */
export const SENSITIVE_KEYS = Object.freeze([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'password',
  'secret',
  'apiKey',
  'api_key',
]);

/** The key as a pino redaction path segment (bracket form when it is not an identifier). */
const segment = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `["${key}"]`);

/**
 * Redaction paths for every sensitive key at the top level and up to three levels down
 * (pino's redaction has no "any depth" wildcard; three covers `req.headers.x`).
 */
export const REDACT_PATHS = Object.freeze(
  SENSITIVE_KEYS.flatMap((key) =>
    ['', '*', '*.*', '*.*.*'].map((prefix) => `${prefix}${segment(key)}`.replace(/^\./, '')),
  ),
);

/** Appends lines to `<dir>/YYYY-MM-DD.jsonl`, switching file when the UTC day changes. */
export class DailyFile {
  /** @param {string} dir @param {() => Date} [now] */
  constructor(dir, now = () => new Date()) {
    this.dir = dir;
    this.now = now;
    this.ready = false;
  }

  /** The file a line written now goes to. */
  path() {
    return join(this.dir, `${this.now().toISOString().slice(0, 10)}.jsonl`);
  }

  write(line) {
    if (!this.ready) {
      mkdirSync(this.dir, { recursive: true });
      this.ready = true;
    }
    // Synchronous and small: a line is never lost on a crash, and never interleaved.
    try {
      appendFileSync(this.path(), line);
    } catch (err) {
      // The folder was removed while running (log retention, a cleanup): make it again, once.
      if (err?.code !== 'ENOENT') throw err;
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.path(), line);
    }
    return true;
  }
}

/** Sends each line to every sink; one failing sink never stops the others. */
function tee(sinks) {
  return {
    write(line) {
      for (const sink of sinks) {
        try {
          sink.write(line);
        } catch {
          // A full disk must not take the server down; stdout still has the line.
        }
      }
      return true;
    },
  };
}

/** Wraps pino so every call names its event: `log.info('request.completed', 'Request completed', {...})`. */
function wrap(base) {
  const at =
    (level) =>
    (event, msg, fields = {}) =>
      base[level]({ ...fields, event }, msg);
  return {
    fatal: at('fatal'),
    error: at('error'),
    warn: at('warn'),
    info: at('info'),
    debug: at('debug'),
    trace: at('trace'),
    child: (bindings) => wrap(base.child(bindings)),
    isLevelEnabled: (level) => base.isLevelEnabled(level),
  };
}

/**
 * @param {{
 *   service: string,
 *   env: string,
 *   level: string,
 *   logDir?: string | null,
 *   sinks?: { write(line: string): unknown }[],
 * }} options `logDir` adds the daily file sink under `<logDir>/<service>`; `sinks` replaces
 *   stdout (tests capture lines this way).
 */
export function createLogger({ service, env, level, logDir = null, sinks }) {
  // A copy: the caller's array is never changed.
  const outputs = [...(sinks ?? [process.stdout])];
  if (logDir) outputs.push(new DailyFile(join(logDir, service)));
  const base = pino(
    {
      level,
      base: { app: APP_NAME, service, env },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    },
    tee(outputs),
  );
  // The root is never used directly: system lines carry requestId null.
  return {
    system: wrap(base.child({ requestId: null })),
    forRequest: (requestId) => wrap(base.child({ requestId })),
  };
}

/** Request ids we accept from a client: 8-64 of [A-Za-z0-9_-]. Anything else is replaced. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The client's id when it is well formed, otherwise a new random UUID. */
/**
 * @param {unknown} incoming
 * @param {() => string} [generate]
 * @returns {string}
 */
export function resolveRequestId(incoming, generate = () => crypto.randomUUID()) {
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : generate();
}

/** Routes polled by machines (the Docker HEALTHCHECK every 30 s): logged quietly when fine. */
export const QUIET_ROUTES = Object.freeze(['/api/health']);

/**
 * The level of a `request.completed` line: `debug` for a successful GET of a quiet route
 * (about 2,880 health checks a day would otherwise drown the log), `info` for the rest.
 * Refusals are logged separately at `warn` either way.
 * @param {string | undefined} method @param {string} route @param {number} status
 */
export function requestLogLevel(method, route, status) {
  return method === 'GET' && QUIET_ROUTES.includes(route) && status < 400 ? 'debug' : 'info';
}
