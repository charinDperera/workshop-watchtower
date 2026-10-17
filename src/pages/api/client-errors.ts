import { route } from '../../server/errors/route';
import { clientErrorDeps, reportClientError } from '../../server/handlers/client-errors';
import { clientKeyOf } from '../../server/middleware/request-context';
import {
  assertSameOrigin,
  parseClientErrorReport,
  readJsonBody,
} from '../../server/schemas/client-error';

/** Readable client error reports (ADR-005): same origin, capped, rate-limited, deduped. */
export const POST = route(async (context) => {
  assertSameOrigin(context.request.headers);
  const report = parseClientErrorReport(await readJsonBody(context.request));
  const deps = clientErrorDeps(context.locals.requestId ?? 'none');
  return reportClientError(report, clientKeyOf(context), deps);
});
