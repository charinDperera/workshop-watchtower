// The Watchtower's configuration: the ONE validator of the environment (ADR-006).
//
// It lives in `scripts/` (plain JS) because `scripts/start.mjs` must validate before the
// built server is loaded. The app reads it only through `src/server/config/env.ts`, which
// re-exports it typed and frozen. See `.env.example` for every variable.
//
// Rules: unset or empty means "use the default"; every problem names the variable and
// says what is wrong, but never echoes the value; any problem stops the server.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const DEFAULT_PORT = 4321;
export const LOOPBACK_HOST = '127.0.0.1';
export const CONTAINER_DEFAULT_HOST = '0.0.0.0';
export const POLL_MIN_MS = 250;
export const POLL_MAX_MS = 60_000;
export const NODE_ENVS = Object.freeze(['development', 'test', 'production']);
export const LOG_LEVELS = Object.freeze([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);
/** LOG_DIR default, relative to the workstation root (ADR-005). */
export const DEFAULT_LOG_SUBDIR = 'limforia/logs/watchtower';
const APP_PACKAGE_NAME = 'watchtower';

/** Shown when container mode finds no workstation mounted (see the README). */
export const CONTAINER_NO_ROOT =
  'No workstation is mounted at /workstation. Run The Watchtower with `docker compose up` from apps/watchtower (see README).';

/** True when `path` is `other` or one of its ancestors (case-insensitive on Windows). */
export function isSameOrAncestor(path, other) {
  const norm = (p) => {
    const r = resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const rel = relative(norm(path), norm(other));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export class ServerEnvError extends Error {
  /** @param {{ variable: string, problem: string }[]} problems */
  constructor(problems) {
    super(`Invalid environment: ${problems.map((p) => `${p.variable} ${p.problem}`).join('; ')}`);
    this.name = 'ServerEnvError';
    /** Variable names only, never values. */
    this.variables = problems.map((p) => p.variable);
    this.problems = problems;
  }
}

/** Walks up from `start` to the folder holding this app's package.json. */
export function findAppDir(start) {
  let dir = start;
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === APP_PACKAGE_NAME) return dir;
      } catch {
        // Not our manifest; keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The default workstation root: the folder two levels above the app. */
export function defaultRoot(moduleUrl = import.meta.url) {
  const appDir =
    findAppDir(dirname(fileURLToPath(moduleUrl))) ?? findAppDir(process.cwd()) ?? process.cwd();
  return resolve(appDir, '..', '..');
}

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const list = (text) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

/** `a.b.c.d`, an IPv6 literal, or either with `/prefix`; `null` when invalid. */
export function parseClientEntry(entry) {
  const [address, prefix, extra] = entry.split('/');
  const family = isIP(address ?? '');
  if (extra !== undefined || family === 0 || address.includes('%')) return null;
  if (prefix === undefined) return { address: address.toLowerCase(), prefix: null, family };
  const max = family === 4 ? 32 : 128;
  const bits = /^\d{1,3}$/.test(prefix) ? Number(prefix) : NaN;
  if (!(bits >= 0 && bits <= max)) return null;
  return { address: address.toLowerCase(), prefix: bits, family };
}

/** `host:port` or `[ipv6]:port`, lower-cased; `null` when invalid. */
export function parseAllowedHost(entry) {
  return parseHostPort(entry);
}

/**
 * A strict public origin, e.g. `https://dev-watchtower.workshop.io` or `http://host:8080`:
 * http or https, a host, an optional port, nothing else (no path, not even `/`, no query,
 * fragment or credentials). Returns the normalised origin, or `null`.
 */
export function parsePublicOrigin(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return text.toLowerCase() === url.origin ? url.origin : null;
}

/** The Host header value a public origin produces (`host[:port]`, default port omitted). */
export function hostOfOrigin(origin) {
  return new URL(origin).host;
}

function parseHostPort(entry) {
  const host = entry.toLowerCase();
  const match =
    /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*):(\d{1,5})$/.exec(
      host,
    );
  const port = match ? Number(match[5]) : NaN;
  return match && port >= 1 && port <= 65535 ? host : null;
}

// ---------------------------------------------------------------------------------------
// Schema. Every message is fixed text: zod never sees a message built from the value.
// ---------------------------------------------------------------------------------------

/** Unset, empty or blank -> `undefined`; otherwise the trimmed string. */
const optional = (schema) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    schema.optional(),
  );

const integer = (min, max) =>
  z
    .string()
    .regex(/^\d{1,6}$/, { error: `must be an integer from ${min} to ${max}` })
    .transform(Number)
    .refine((n) => n >= min && n <= max, { error: `must be an integer from ${min} to ${max}` });

const entries = (parse, what) =>
  z.string().transform((text, ctx) => {
    const parsed = [];
    list(text).forEach((entry, index) => {
      const value = parse(entry);
      if (value === null)
        ctx.addIssue({ code: 'custom', message: `entry ${index + 1} is not ${what}` });
      else parsed.push(value);
    });
    return parsed;
  });

const schema = z
  .object({
    NODE_ENV: optional(z.enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(', ')}` })),
    WATCHTOWER_CONTAINER: optional(z.enum(['0', '1'], { error: 'must be 1 or 0' })),
    HOST: optional(z.string().refine((v) => isIP(v) !== 0, { error: 'must be an IP address' })),
    PORT: optional(integer(1, 65535)),
    WATCHTOWER_ROOT: optional(z.string()),
    WATCHTOWER_TRUSTED_CLIENTS: optional(entries(parseClientEntry, 'an IP or CIDR')),
    WATCHTOWER_ALLOWED_HOSTS: optional(entries(parseAllowedHost, 'a host:port')),
    WATCHTOWER_POLL_MS: optional(integer(POLL_MIN_MS, POLL_MAX_MS)),
    LOG_LEVEL: optional(z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })),
    LOG_DIR: optional(z.string()),
    WATCHTOWER_PUBLIC_ORIGIN: optional(
      z.string().transform((text, ctx) => {
        const origin = parsePublicOrigin(text);
        if (origin === null) {
          ctx.addIssue({
            code: 'custom',
            message: 'must be an http or https origin with no path, e.g. https://host.example',
          });
          return z.NEVER;
        }
        return origin;
      }),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.WATCHTOWER_TRUSTED_CLIENTS !== undefined && v.WATCHTOWER_CONTAINER !== '1') {
      ctx.addIssue({
        code: 'custom',
        path: ['WATCHTOWER_TRUSTED_CLIENTS'],
        message: 'needs WATCHTOWER_CONTAINER=1',
      });
    }
  });

/**
 * Reads and validates the environment. Returns a frozen settings object, or throws
 * `ServerEnvError` listing every invalid variable (by name, never by value).
 * @param {Record<string, string | undefined>} env
 * @param {{ moduleUrl?: string }} [options]
 */
export function readServerEnv(env, options = {}) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ServerEnvError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'environment'),
        problem: issue.message,
      })),
    );
  }
  const v = parsed.data;
  const container = v.WATCHTOWER_CONTAINER === '1';
  const root = v.WATCHTOWER_ROOT
    ? resolve(process.cwd(), v.WATCHTOWER_ROOT)
    : defaultRoot(options.moduleUrl);
  if (!isDirectory(root)) {
    // In a container the root is a mount: say how to provide it (Docker Desktop's Run
    // button cannot add the mount). Names the documented mount point, never the value.
    throw new ServerEnvError([
      {
        variable: 'WATCHTOWER_ROOT',
        problem: container ? CONTAINER_NO_ROOT : 'is not an existing directory',
      },
    ]);
  }
  const logDir = v.LOG_DIR
    ? isAbsolute(v.LOG_DIR)
      ? v.LOG_DIR
      : resolve(process.cwd(), v.LOG_DIR)
    : join(root, ...DEFAULT_LOG_SUBDIR.split('/'));
  if (isSameOrAncestor(logDir, root)) {
    // Logs written there would land among (or above) the records the app reads.
    throw new ServerEnvError([
      { variable: 'LOG_DIR', problem: 'must not be the workstation root or a folder above it' },
    ]);
  }

  return Object.freeze({
    nodeEnv: v.NODE_ENV ?? 'development',
    container,
    // HOST is honoured only in container mode; the host always binds to loopback.
    host: container ? (v.HOST ?? CONTAINER_DEFAULT_HOST) : LOOPBACK_HOST,
    port: v.PORT ?? DEFAULT_PORT,
    root,
    trustedClients: Object.freeze(v.WATCHTOWER_TRUSTED_CLIENTS ?? []),
    allowedHosts: Object.freeze(v.WATCHTOWER_ALLOWED_HOSTS ?? []),
    pollMs: v.WATCHTOWER_POLL_MS ?? null,
    logLevel: v.LOG_LEVEL ?? 'info',
    logDir,
    publicOrigin: v.WATCHTOWER_PUBLIC_ORIGIN ?? null,
  });
}

/**
 * A summary safe to log at startup: no addresses, hosts or paths beyond what an operator
 * needs, and nothing secret (the app has no secrets today).
 */
export function summariseServerEnv(settings) {
  return {
    nodeEnv: settings.nodeEnv,
    container: settings.container,
    host: settings.host,
    port: settings.port,
    trustedClients: settings.trustedClients.length,
    extraAllowedHosts: settings.allowedHosts.length,
    watch: settings.pollMs === null ? 'fs.watch' : `poll ${settings.pollMs} ms`,
    logLevel: settings.logLevel,
    // Not a secret: the address users open (behind the workstation gateway).
    publicOrigin: settings.publicOrigin,
  };
}

/**
 * A predicate for the trusted-client allowlist. IPv4-mapped IPv6 peers
 * (`::ffff:172.17.0.1`) match IPv4 entries.
 * @param {readonly { address: string, prefix: number | null, family: number }[]} list
 */
export function createClientMatcher(list) {
  if (list.length === 0) return () => false;
  const blocks = new BlockList();
  for (const { address, prefix, family } of list) {
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === null) blocks.addAddress(address, type);
    else blocks.addSubnet(address, prefix, type);
  }
  return (peer) => {
    if (typeof peer !== 'string') return false;
    const family = isIP(peer.trim());
    if (family === 0) return false;
    return blocks.check(peer.trim().toLowerCase(), family === 4 ? 'ipv4' : 'ipv6');
  };
}
