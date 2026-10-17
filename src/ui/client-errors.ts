/**
 * The client's error reporter (ADR-005): errors only, never user actions. Each report is a
 * readable sentence (what failed, where, while doing what) sent to the BFF at
 * `POST /api/client-errors`.
 *
 * Privacy: the raw error message is never sent (it can echo data), nor any form contents,
 * query string or stack trace. `source` is at most one same-origin `file:line`.
 * Limits: at most `MAX_REPORTS` per page load, each distinct report once.
 */
import { APP_VERSION } from '../shared/version';
import { NAV } from './labels';

export const CLIENT_ERRORS_URL = '/api/client-errors';
export const MAX_REPORTS = 5;

export interface ReadableError {
  /** What went wrong, in plain words. */
  msg: string;
  /** Where in the UI, e.g. "Activity page → Live updates". */
  where: string;
  /** What the user was doing. Defaults to "Viewing the page". */
  userAction?: string;
  /** UPPER_SNAKE_CASE, e.g. `TYPE_ERROR`. */
  errorCode: string;
  /** `file:line` of the top same-origin frame, if known. */
  source?: string;
}

export interface ReportPayload extends Required<Omit<ReadableError, 'source'>> {
  page: string;
  browser: string;
  appVersion: string;
  source?: string;
}

const clip = (text: string, max: number): string =>
  text
    .replace(/\p{Cc}+/gu, ' ')
    .trim()
    .slice(0, max) || '-';

/** `TypeError` -> `TYPE_ERROR`; anything unusable -> the fallback. */
export function errorCodeOf(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : '';
  const code = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
    .replace(/^_+|_+$/g, '');
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : fallback;
}

/** The kind of error, for the sentence: `TypeError`, or "an unknown error". */
function kindOf(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
    ? error.name
    : 'unknown error';
}

/** "Activity page" for `/activity`, from the navigation labels. */
export function pageName(path: string): string {
  const item = NAV.find((n) => n.match(path));
  return item ? `${item.label} page` : 'This page';
}

/** The page path only, in the form the server accepts. */
export function pagePath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? '/';
  return /^\/[A-Za-z0-9/_.~%-]{0,200}$/.test(clean) ? clean : '/';
}

/** "Chrome 141 on Windows": browser family, major version and platform only. */
export function describeBrowser(userAgent: string): string {
  const families: [string, RegExp][] = [
    ['Edge', /Edg\/(\d+)/],
    ['Firefox', /Firefox\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ];
  const found = families.find(([, re]) => re.test(userAgent));
  const version = found ? (found[1].exec(userAgent)?.[1] ?? '') : '';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'an unknown system';
  return found ? `${found[0]} ${version} on ${os}` : `Unknown browser on ${os}`;
}

/** `file:line` for a same-origin script, else undefined. */
export function sourceOf(
  filename: string | undefined,
  line: number | undefined,
  origin: string,
): string | undefined {
  if (!filename || !line) return undefined;
  try {
    const url = new URL(filename);
    if (url.origin !== origin) return undefined;
    const path = url.pathname.replace(/^\//, '');
    return /^[A-Za-z0-9_./-]{1,200}$/.test(path) ? `${path}:${line}` : undefined;
  } catch {
    return undefined;
  }
}

export function buildPayload(
  error: ReadableError,
  env: { path: string; userAgent: string },
): ReportPayload {
  return {
    msg: clip(error.msg, 300),
    where: clip(error.where, 200),
    userAction: clip(error.userAction ?? 'Viewing the page', 200),
    errorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.errorCode) ? error.errorCode : 'CLIENT_ERROR',
    page: pagePath(env.path),
    browser: clip(describeBrowser(env.userAgent), 100),
    appVersion: APP_VERSION,
    ...(error.source ? { source: error.source } : {}),
  };
}

export type Send = (payload: ReportPayload) => void;

/** A reporter with its own per-page budget and dedupe set. */
export function createReporter(send: Send, env: () => { path: string; userAgent: string }) {
  const sent = new Set<string>();
  return (error: ReadableError): boolean => {
    const payload = buildPayload(error, env());
    const key = [payload.errorCode, payload.where, payload.msg, payload.page].join('|');
    if (sent.size >= MAX_REPORTS || sent.has(key)) return false;
    sent.add(key);
    send(payload);
    return true;
  };
}

const browserSend: Send = (payload) => {
  void fetch(CLIENT_ERRORS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {
    // Reporting must never cause another error.
  });
};

let reporter: ((error: ReadableError) => boolean) | null = null;

/** Reports one error (from anywhere in the client). No-op outside a browser. */
export function reportClientError(error: ReadableError): void {
  if (typeof window === 'undefined') return;
  reporter ??= createReporter(browserSend, () => ({
    path: window.location.pathname,
    userAgent: navigator.userAgent,
  }));
  reporter(error);
}

/** Global handlers for uncaught errors and rejections. Safe to call more than once. */
export function installClientErrorReporter(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;
  window.addEventListener('error', (event) => {
    const page = pageName(window.location.pathname);
    reportClientError({
      msg: `A script on the ${page} failed (${kindOf(event.error)}).`,
      where: `${page} → page script`,
      errorCode: errorCodeOf(event.error, 'SCRIPT_ERROR'),
      source: sourceOf(event.filename, event.lineno, window.location.origin),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const page = pageName(window.location.pathname);
    reportClientError({
      msg: `A background task on the ${page} failed (${kindOf(event.reason)}).`,
      where: `${page} → background task`,
      errorCode: errorCodeOf(event.reason, 'UNHANDLED_REJECTION'),
    });
  });
}

let installed = false;
