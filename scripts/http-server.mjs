// The Node request listener behind `scripts/start.mjs` (the production edge). Every request,
// static files included: request id, security headers, the same guard as the Astro
// middleware, URL check, static file or Astro, and one log line when the response ends.

import { requestLogLevel, resolveRequestId } from './logger.mjs';
import { FALLBACK_CSP, guardRequest, SECURITY_HEADERS } from './request-guard.mjs';

export const REQUEST_ID_HEADER = 'x-request-id';

/** The same JSON body and caching as the app's `errorResponse` (`ApiError`). */
export function sendError(res, status, error) {
  const body = JSON.stringify({ error, status });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Sets the security headers and the fallback CSP on the response up front. Astro's own
 * headers (a page's hashed CSP) are written later and take precedence over these.
 */
export function setSecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  res.setHeader('Content-Security-Policy', FALLBACK_CSP);
}

/** The path without query or fragment: query values are never logged. */
const routeOf = (url) => (url ?? '/').split(/[?#]/, 1)[0];

/**
 * @param {{
 *   policy: { allowedHosts: readonly string[], isTrustedPeer(address: string): boolean },
 *   serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean>,
 *   app: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: unknown, locals?: object) => unknown,
 *   logger: { forRequest(requestId: string): { debug: Function, info: Function, warn: Function, error: Function } },
 *   now?: () => number,
 * }} deps
 */
export function createRequestListener({
  policy,
  serveStatic,
  app,
  logger,
  now = () => performance.now(),
}) {
  return async (req, res) => {
    const started = now();
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    // Astro sees the same id: as locals, and in the header (replacing a malformed one).
    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    setSecurityHeaders(res);
    const log = logger.forRequest(requestId);
    res.once('close', () => {
      const route = routeOf(req.url);
      log[requestLogLevel(req.method, route, res.statusCode)](
        'request.completed',
        'Request completed',
        {
          method: req.method,
          route,
          status: res.statusCode,
          durationMs: Math.round(now() - started),
        },
      );
    });

    const host = typeof req.headers.host === 'string' ? req.headers.host : null;
    const verdict = guardRequest(
      { host, address: req.socket.remoteAddress ?? null, aborted: req.destroyed },
      policy,
    );
    if (!verdict.allow) {
      if (verdict.log) log.warn('request.refused', verdict.log, { status: verdict.status });
      return sendError(res, verdict.status, verdict.error);
    }
    try {
      decodeURI(req.url ?? '/');
    } catch {
      return sendError(res, 400, 'Bad request URL');
    }
    try {
      if (await serveStatic(req, res)) return;
      await app(req, res, undefined, { requestId, edgeLogged: true });
    } catch (err) {
      log.error('request.failed', 'Request failed', { err });
      if (!res.headersSent) sendError(res, 500, 'Internal error');
      else res.destroy();
    }
  };
}
