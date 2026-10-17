/**
 * Typed facade over `scripts/logger.mjs` (ADR-005), plus the process-wide loggers:
 * `systemLog()` for startup, the watcher and other non-request work, `requestLog(id)` for
 * one request, `clientLog()` for client error reports (`<LOG_DIR>/client/`).
 */
import * as impl from '../../../scripts/logger.mjs';
import { envStatus } from '../config/env';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppLogger {
  fatal(event: string, msg: string, fields?: Record<string, unknown>): void;
  error(event: string, msg: string, fields?: Record<string, unknown>): void;
  warn(event: string, msg: string, fields?: Record<string, unknown>): void;
  info(event: string, msg: string, fields?: Record<string, unknown>): void;
  debug(event: string, msg: string, fields?: Record<string, unknown>): void;
  trace(event: string, msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): AppLogger;
  isLevelEnabled(level: LogLevel): boolean;
}

export interface LoggerPair {
  system: AppLogger;
  forRequest(requestId: string): AppLogger;
}

export interface LoggerOptions {
  service: string;
  env: string;
  level: string;
  logDir?: string | null;
  sinks?: { write(line: string): unknown }[];
}

export const createLogger: (options: LoggerOptions) => LoggerPair = impl.createLogger;
export const REDACT_PATHS: readonly string[] = impl.REDACT_PATHS;
export const REQUEST_ID: RegExp = impl.REQUEST_ID;
export const resolveRequestId: (incoming: unknown, generate?: () => string) => string =
  impl.resolveRequestId;

function fromEnv(service: string): LoggerPair {
  const status = envStatus();
  // With an invalid environment there is no LOG_DIR to trust: stdout only.
  return status.ok
    ? createLogger({
        service,
        env: status.env.nodeEnv,
        level: status.env.logLevel,
        logDir: status.env.logDir,
      })
    : createLogger({ service, env: 'unknown', level: 'info' });
}

let bff: LoggerPair | null = null;
let client: LoggerPair | null = null;

const bffLoggers = (): LoggerPair => (bff ??= fromEnv('bff'));

export function systemLog(): AppLogger {
  return bffLoggers().system;
}

export function requestLog(requestId: string): AppLogger {
  return bffLoggers().forRequest(requestId);
}

/** Client error reports (written by the BFF on the client's behalf). */
export function clientLog(requestId: string): AppLogger {
  client ??= fromEnv('client');
  return client.forRequest(requestId);
}
