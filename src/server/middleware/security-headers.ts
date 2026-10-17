import { FALLBACK_CSP, SECURITY_HEADERS } from '../security/request-guard';

/**
 * Adds the security headers to a response that lacks them, and the strict fallback CSP to a
 * response with no CSP of its own (pages keep Astro's hashed policy). Applied to every
 * response the middleware returns, refusals and errors included.
 */
export function withSecurityHeaders(response: Response): Response {
  const missing = Object.entries(SECURITY_HEADERS).filter(([name]) => !response.headers.has(name));
  if (!response.headers.has('content-security-policy')) {
    missing.push(['Content-Security-Policy', FALLBACK_CSP]);
  }
  if (missing.length === 0) return response;
  try {
    for (const [name, value] of missing) response.headers.set(name, value);
    return response;
  } catch {
    // Some responses (for example redirects) have immutable headers: copy them instead.
    const headers = new Headers(response.headers);
    for (const [name, value] of missing) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
