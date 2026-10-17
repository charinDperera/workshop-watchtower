/**
 * Typed facade over `scripts/request-guard.mjs`, the single implementation of the request
 * guard (SPEC section 5). The same functions run in the Node server (`scripts/start.mjs`,
 * every request including static files) and in the Astro middleware.
 */
import * as guard from '../../../scripts/request-guard.mjs';
import type { ServerSettings } from '../config/env';

export interface GuardInput {
  host: string | null;
  /** The TCP peer address, or `null` when the server could not provide one. */
  address: string | null;
  /** True when the client has already disconnected. */
  aborted: boolean;
}

export type GuardVerdict =
  | { allow: true }
  | {
      allow: false;
      status: 403;
      error: string;
      /** Warning for the server log, or `null` when there is nothing worth reporting. */
      log: string | null;
    };

/** Which Host values and peers to admit. */
export interface GuardPolicy {
  allowedHosts: readonly string[];
  isTrustedPeer(address: string): boolean;
}

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = guard.DEFAULT_ALLOWED_HOSTS;

/** DNS-rebinding guard: the Host header must be exactly an allowed `host:port`. */
export const isAllowedHost: (host: string | null, allowed?: readonly string[]) => boolean =
  guard.isAllowedHost;

/** True for a loopback peer (`127.0.0.0/8`, `::1`, `::ffff:127.x.x.x`). */
export const isLoopbackAddress: (address: string | null | undefined) => boolean =
  guard.isLoopbackAddress;

/** The host policy: the two fixed Host values and loopback peers only. */
export const DEFAULT_POLICY: GuardPolicy = guard.DEFAULT_POLICY;

/** The policy for validated settings; container mode adds the trusted clients. */
export const createRequestPolicy: (settings: ServerSettings) => GuardPolicy =
  guard.createRequestPolicy;

/** The decision for one request. Fails closed. */
export const guardRequest: (input: GuardInput, policy?: GuardPolicy) => GuardVerdict =
  guard.guardRequest as (input: GuardInput, policy?: GuardPolicy) => GuardVerdict;

/** Headers on every response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = guard.SECURITY_HEADERS;

/** The CSP for responses that bring none of their own (JSON, errors, static files). */
export const FALLBACK_CSP: string = guard.FALLBACK_CSP;
