/**
 * Per-request context: the request id and its child logger, kept on `context.locals`
 * (request-scoped, never global: ADR-004 Order 1).
 *
 * The id comes from the Node edge (`scripts/start.mjs` passes it in `locals`), else from a
 * well-formed incoming `x-request-id`, else it is generated. It is returned in the
 * `x-request-id` response header.
 */
import { requestLog, resolveRequestId, type AppLogger } from '../logging/logger';

export const REQUEST_ID_HEADER = 'x-request-id';

interface ContextLike {
  request: Request;
  locals: App.Locals;
  clientAddress: string;
}

export function attachRequestContext(context: ContextLike): { requestId: string; log: AppLogger } {
  const requestId =
    context.locals.requestId ?? resolveRequestId(context.request.headers.get(REQUEST_ID_HEADER));
  const log = requestLog(requestId);
  context.locals.requestId = requestId;
  context.locals.log = log;
  return { requestId, log };
}

/** The TCP peer, or `null` when Astro has none (in dev: the client already disconnected). */
export function clientAddressOf(context: Pick<ContextLike, 'clientAddress'>): string | null {
  try {
    return context.clientAddress;
  } catch {
    return null;
  }
}

/** Rate-limit key for a client: its address, or one shared bucket when unknown. */
export function clientKeyOf(context: Pick<ContextLike, 'clientAddress'>): string {
  return clientAddressOf(context) ?? 'unknown';
}
