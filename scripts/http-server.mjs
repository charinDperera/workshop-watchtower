// The Node request listener behind `scripts/start.mjs`. Every request, static files
// included, passes the same guard as the Astro middleware and leaves with the security
// headers. Order: headers, guard, URL check, static file, Astro.

import { FALLBACK_CSP, guardRequest, SECURITY_HEADERS } from './request-guard.mjs';

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

/**
 * @param {{
 *   policy: { allowedHosts: readonly string[], isTrustedPeer(address: string): boolean },
 *   serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean>,
 *   app: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => unknown,
 *   log?: Pick<Console, 'warn' | 'error'>,
 * }} deps
 */
export function createRequestListener({ policy, serveStatic, app, log = console }) {
  return async (req, res) => {
    setSecurityHeaders(res);
    const host = typeof req.headers.host === 'string' ? req.headers.host : null;
    const verdict = guardRequest(
      { host, address: req.socket.remoteAddress ?? null, aborted: req.destroyed },
      policy,
    );
    if (!verdict.allow) {
      if (verdict.log) log.warn(`[watchtower] ${verdict.log}`);
      return sendError(res, verdict.status, verdict.error);
    }
    try {
      decodeURI(req.url ?? '/');
    } catch {
      return sendError(res, 400, 'Bad request URL');
    }
    try {
      if (await serveStatic(req, res)) return;
      await app(req, res);
    } catch (err) {
      log.error(`[watchtower] request failed: ${err instanceof Error ? err.message : err}`);
      if (!res.headersSent) sendError(res, 500, 'Internal error');
      else res.destroy();
    }
  };
}
