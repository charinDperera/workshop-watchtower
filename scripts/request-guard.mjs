// The request guard (SPEC section 5), in one dependency-free module used in two places:
// the Node server in `scripts/start.mjs`, which checks every request before anything is
// served (static files included), and the Astro middleware (`src/middleware.ts`), which
// checks again in production and is the only check under `astro dev`.
// Typed facade for the app: `src/server/security/request-guard.ts`.

import { createClientMatcher, hostOfOrigin } from './server-env.mjs';

export const SERVER_PORT = 4321;

/** The only Host header values answered by default (DNS-rebinding guard). */
export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  `127.0.0.1:${SERVER_PORT}`,
  `localhost:${SERVER_PORT}`,
]);

/** DNS-rebinding guard: the Host header must be exactly an allowed `host:port`. */
export function isAllowedHost(host, allowed = DEFAULT_ALLOWED_HOSTS) {
  if (typeof host !== 'string') return false;
  return allowed.includes(host.trim().toLowerCase());
}

/**
 * Defence in depth for a server that must stay local: the TCP peer must be loopback.
 * Covers a misconfigured `HOST` that would otherwise expose the app to the network,
 * where a remote client could forge the Host header.
 */
export function isLoopbackAddress(address) {
  if (!address) return false;
  const a = address.trim().toLowerCase();
  return a === '::1' || /^127(\.\d{1,3}){3}$/.test(a) || /^::ffff:127(\.\d{1,3}){3}$/.test(a);
}

/** The host policy: the two fixed Host values and loopback peers only. */
export const DEFAULT_POLICY = Object.freeze({
  allowedHosts: DEFAULT_ALLOWED_HOSTS,
  isTrustedPeer: isLoopbackAddress,
});

/**
 * The policy for validated settings (`readServerEnv`). Container mode adds the trusted
 * clients; `WATCHTOWER_ALLOWED_HOSTS` adds to the fixed Host values, never replaces them.
 */
export function createRequestPolicy(settings) {
  const trusted = settings.container ? createClientMatcher(settings.trustedClients) : () => false;
  // Behind the workstation gateway the browser's Host is the public origin's host. Only the
  // Host header is admitted from it: X-Forwarded-* is never trusted, and the peer check
  // (WATCHTOWER_TRUSTED_CLIENTS) stays the trust boundary.
  const publicHost = settings.publicOrigin ? [hostOfOrigin(settings.publicOrigin)] : [];
  return {
    allowedHosts: [...DEFAULT_ALLOWED_HOSTS, ...settings.allowedHosts, ...publicHost],
    isTrustedPeer: (address) => isLoopbackAddress(address) || trusted(address),
  };
}

function deny(error, log) {
  return { allow: false, status: 403, error, log };
}

/**
 * The decision for one request. Fails closed: a request is admitted only with an allowed
 * Host and a known, trusted peer.
 *
 * An unknown peer is not the same as an untrusted one. In `astro dev` the address is read
 * from the socket after routing, and Node clears `socket.remoteAddress` once the socket is
 * destroyed, so a request the browser abandons (for example during a reload) arrives with no
 * address. That request is still refused, but it is not logged as a foreign client.
 */
export function guardRequest(input, policy = DEFAULT_POLICY) {
  if (!isAllowedHost(input.host, policy.allowedHosts)) {
    return deny('Host not allowed', 'rejected request with a disallowed Host header');
  }
  if (input.address === null || input.address === undefined || input.address.trim() === '') {
    return deny(
      'Only local requests are allowed',
      input.aborted ? null : 'rejected request: the client address is unavailable',
    );
  }
  if (!policy.isTrustedPeer(input.address)) {
    return deny('Only local requests are allowed', 'rejected request from an untrusted address');
  }
  return { allow: true };
}

/** Headers on every response. */
export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

/**
 * The CSP for every response that does not bring its own (JSON, errors, static files):
 * nothing may load, run or frame it. Pages carry Astro's hashed policy instead
 * (`security.csp` in astro.config.mjs).
 */
export const FALLBACK_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
