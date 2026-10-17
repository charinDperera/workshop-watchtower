/**
 * The one place where errors become HTTP responses and are logged (once). Every API route
 * is `route(handler)`: the handler returns data (sent as JSON), a `Response` (sent as is),
 * or throws.
 * - `AppError` 4xx: the client's mistake; logged at warn, returned with its message.
 * - `AppError` 5xx: logged at error with its cause; only the public message is returned.
 * - Anything else: logged at error; returned as a generic 500.
 */
import type { APIContext, APIRoute } from 'astro';
import { requestLog, type AppLogger } from '../logging/logger';
import { AppError } from './app-error';
import { errorResponse, jsonResponse } from './responses';

export type RouteHandler = (context: APIContext, log: AppLogger) => unknown;

/** The request's logger (set by the middleware), or a fresh one outside a request. */
export function logOf(context: Pick<APIContext, 'locals'>): AppLogger {
  return context.locals?.log ?? requestLog(context.locals?.requestId ?? 'none');
}

export function toErrorResponse(err: unknown, log: AppLogger, route: string): Response {
  if (err instanceof AppError) {
    if (err.status < 500) {
      log.warn('request.rejected', err.message, { route, status: err.status });
    } else {
      log.error('request.failed', err.message, {
        route,
        status: err.status,
        err: err.cause ?? err,
      });
    }
    const response = errorResponse(err.status, err.message);
    for (const [name, value] of Object.entries(err.headers)) response.headers.set(name, value);
    return response;
  }
  log.error('request.failed', 'Unexpected error', { route, status: 500, err });
  return errorResponse(500, 'Internal error');
}

export function route(handler: RouteHandler): APIRoute {
  return async (context) => {
    const log = logOf(context);
    try {
      const result = await handler(context, log);
      return result instanceof Response ? result : jsonResponse(result);
    } catch (err) {
      return toErrorResponse(err, log, context.url.pathname);
    }
  };
}
