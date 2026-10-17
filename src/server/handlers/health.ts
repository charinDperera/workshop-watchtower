import { APP_VERSION } from '../../shared/version';

/**
 * Liveness for the container HEALTHCHECK. Deliberately cheap: no snapshot, no runtime.
 * It still passes the middleware guards.
 */
export function getHealth(): { ok: true; version: string } {
  return { ok: true, version: APP_VERSION };
}
