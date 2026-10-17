import { TooManyRequestsError } from '../errors/app-error';
import { clientLog, type AppLogger } from '../logging/logger';
import type { ClientErrorReport } from '../schemas/client-error';
import { ClientErrorIntake } from '../services/client-error-intake';

export interface ClientErrorDeps {
  intake: ClientErrorIntake;
  /** The client log (`<LOG_DIR>/client/`) for this request. */
  log: AppLogger;
}

const intake = new ClientErrorIntake();

export const clientErrorDeps = (requestId: string): ClientErrorDeps => ({
  intake,
  log: clientLog(requestId),
});

/**
 * Writes a client error report to the client log, unless it repeats a recent one.
 * Throws 429 when the client sends too many. Answers 204 either way, so a client cannot
 * tell a duplicate from a write.
 */
export function reportClientError(
  report: ClientErrorReport,
  clientKey: string,
  deps: ClientErrorDeps,
): Response {
  const result = deps.intake.submit(clientKey, report);
  if (result.outcome === 'limited') {
    throw new TooManyRequestsError('Too many reports', result.retryAfterSeconds);
  }
  if (result.outcome === 'accepted') {
    deps.log.error(`client.${report.errorCode.toLowerCase()}`, report.msg, {
      where: report.where,
      userAction: report.userAction,
      errorCode: report.errorCode,
      page: report.page,
      browser: report.browser,
      appVersion: report.appVersion,
      ...(report.source ? { source: report.source } : {}),
    });
  }
  return new Response(null, { status: 204 });
}
