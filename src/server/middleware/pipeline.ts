/**
 * Everything the Astro middleware does, in order: request context, config check (fail
 * closed), the request guard, then the security headers and `x-request-id` on whatever
 * comes back, and one log line per request (unless the Node edge in `scripts/start.mjs`
 * already logs it, as it does in production).
 */
import { envStatus } from '../config/env';
import { errorResponse } from '../errors/responses';
import { requestLogLevel } from '../logging/logger';
import { createRequestPolicy, guardRequest, type GuardPolicy } from '../security/request-guard';
import { attachRequestContext, clientAddressOf, REQUEST_ID_HEADER } from './request-context';
import { withSecurityHeaders } from './security-headers';

interface PipelineContext {
  request: Request;
  url: URL;
  locals: App.Locals;
  clientAddress: string;
  routePattern?: string;
}

let policy: GuardPolicy | null = null;
let reportedBadEnv = false;

function currentPolicy(): GuardPolicy | null {
  const status = envStatus();
  if (!status.ok) return null;
  policy ??= createRequestPolicy(status.env);
  return policy;
}

export interface PipelineOptions {
  /**
   * Rethrow a page's render error to Astro (dev: keeps the error overlay). In production it
   * is logged here once, with its stack, and answered with a plain 500, so Astro does not
   * print its own unstructured copy.
   */
  rethrowRenderErrors?: boolean;
}

/** The body of a page that failed to render: no detail (the log has it). */
export function renderFailure(): Response {
  return new Response(
    '<!doctype html><title>Something went wrong</title><p>Something went wrong on this page. Please try again.</p>',
    {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}

export async function handleRequest(
  context: PipelineContext,
  next: () => Promise<Response>,
  options: PipelineOptions = { rethrowRenderErrors: import.meta.env.DEV },
): Promise<Response> {
  const started = performance.now();
  const { requestId, log } = attachRequestContext(context);
  const active = currentPolicy();
  let response: Response;

  if (!active) {
    const status = envStatus();
    if (!reportedBadEnv && !status.ok) {
      reportedBadEnv = true;
      log.error('config.invalid', 'Invalid server settings: refusing every request', {
        variables: status.variables,
      });
    }
    response = errorResponse(500, 'Server misconfigured');
  } else {
    const verdict = guardRequest(
      {
        host: context.request.headers.get('host'),
        address: clientAddressOf(context),
        aborted: context.request.signal.aborted,
      },
      active,
    );
    if (verdict.allow) {
      try {
        response = await next();
      } catch (err) {
        // A page threw while rendering (API routes handle their own errors in route()).
        if (options.rethrowRenderErrors) throw err;
        log.error('request.failed', 'Page render failed', {
          route: context.routePattern ?? context.url.pathname,
          status: 500,
          err,
        });
        response = renderFailure();
      }
    } else {
      if (verdict.log) log.warn('request.refused', verdict.log, { status: verdict.status });
      response = errorResponse(verdict.status, verdict.error);
    }
  }

  response = withSecurityHeaders(response, { [REQUEST_ID_HEADER]: requestId });
  if (!context.locals.edgeLogged) {
    const route = context.url.pathname;
    log[requestLogLevel(context.request.method, route, response.status)](
      'request.completed',
      'Request completed',
      {
        method: context.request.method,
        route: context.routePattern ?? route,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      },
    );
  }
  return response;
}
