/**
 * Everything the Astro middleware does, in order: request context, config check (fail
 * closed), the request guard, then the security headers and `x-request-id` on whatever
 * comes back, and one log line per request (unless the Node edge in `scripts/start.mjs`
 * already logs it, as it does in production).
 */
import { envStatus } from '../config/env';
import { errorResponse } from '../errors/responses';
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

export async function handleRequest(
  context: PipelineContext,
  next: () => Promise<Response>,
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
      response = await next();
    } else {
      if (verdict.log) log.warn('request.refused', verdict.log, { status: verdict.status });
      response = errorResponse(verdict.status, verdict.error);
    }
  }

  response = withSecurityHeaders(response);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (!context.locals.edgeLogged) {
    log.info('request.completed', 'Request completed', {
      method: context.request.method,
      route: context.routePattern ?? context.url.pathname,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    });
  }
  return response;
}
