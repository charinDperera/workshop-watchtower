/**
 * The app's configuration (ADR-006): typed, validated, frozen. This is the only module in
 * `src/` that touches `process.env`. The validator itself is `scripts/server-env.mjs`, the
 * single implementation shared with `scripts/start.mjs` (which validates before the bundle
 * loads; see the README).
 *
 * The environment is validated when this module loads. A bad environment is kept as an
 * error rather than thrown, so the middleware can refuse every request (fail closed) even
 * if the server was started without `scripts/start.mjs`, which would have refused to start.
 */
import { readServerEnv, ServerEnvError, summariseServerEnv } from '../../../scripts/server-env.mjs';
import type { LogLevel } from '../logging/logger';

export interface TrustedClient {
  address: string;
  prefix: number | null;
  family: number;
}

export interface ServerEnv {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly container: boolean;
  readonly host: string;
  readonly port: number;
  /** The workstation root, an existing directory. */
  readonly root: string;
  readonly trustedClients: readonly TrustedClient[];
  readonly allowedHosts: readonly string[];
  readonly pollMs: number | null;
  readonly logLevel: LogLevel;
  readonly logDir: string;
}

/** Kept for the guard's signature: the policy needs these fields of the config. */
export type ServerSettings = Pick<ServerEnv, 'container' | 'trustedClients' | 'allowedHosts'>;

export type LoadedEnv =
  { ok: true; env: ServerEnv } | { ok: false; error: string; variables: readonly string[] };

/** Validates an environment map. Never includes a value in the error. */
export function loadEnv(source: NodeJS.ProcessEnv): LoadedEnv {
  try {
    return { ok: true, env: readServerEnv(source) as ServerEnv };
  } catch (err) {
    if (err instanceof ServerEnvError) {
      return { ok: false, error: err.message, variables: err.variables as string[] };
    }
    throw err;
  }
}

const loaded: LoadedEnv = loadEnv(process.env);

/** The process-wide configuration status (validated at startup). */
export function envStatus(): LoadedEnv {
  return loaded;
}

/** The validated configuration. Throws `ConfigError` when the environment is invalid. */
export function serverEnv(): ServerEnv {
  if (!loaded.ok) throw new ConfigError(loaded.error);
  return loaded.env;
}

/** Startup summary for the log: no secrets, no values beyond what an operator needs. */
export const summariseEnv: (env: ServerEnv) => Record<string, unknown> = summariseServerEnv;

/** A copy of the environment for child processes (git needs PATH and friends). */
export function childProcessEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
