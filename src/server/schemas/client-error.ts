/**
 * `POST /api/client-errors` input (ADR-005, client side): a short, readable report. Strict:
 * unknown keys are refused (so no form contents can ride along), lengths are capped, and
 * nothing that looks like a stack trace is accepted.
 */
import { z } from 'zod';
import {
  BadRequestError,
  ForbiddenError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from '../errors/app-error';

/** Largest accepted body. A real report is a few hundred bytes. */
export const CLIENT_ERROR_MAX_BYTES = 4096;

/** Printable text on one line: no control characters (so no newlines, no log injection). */
const ONE_LINE = /^[^\p{Cc}]*$/u;
/** A stack frame: `at fn (file.js:1:2)` or `file.js:1:2`. Reports carry `source` instead. */
const STACK_FRAME = /\bat\s+\S+\s+\(|\S+\.(?:m?js|ts|svelte):\d+:\d+/;

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(ONE_LINE, { error: 'must be one line of text' })
    .refine((v) => !STACK_FRAME.test(v), { error: 'must not contain a stack trace' });

export const clientErrorReport = z.strictObject({
  /** What went wrong, in plain words. */
  msg: text(300),
  /** Where in the UI, e.g. "Activity page → Live timeline". */
  where: text(200),
  /** What the user was doing, e.g. "Viewing the page". */
  userAction: text(200),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, { error: 'must be UPPER_SNAKE_CASE' }),
  /** Path only, no query or fragment. */
  page: z.string().regex(/^\/[A-Za-z0-9/_.~%-]{0,200}$/, { error: 'must be a path' }),
  browser: text(100),
  appVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[A-Za-z0-9.]{1,20})?$/, {
    error: 'must be a version',
  }),
  /** Top source location only: `file:line`. */
  source: z
    .string()
    .regex(/^[A-Za-z0-9_./-]{1,200}:\d{1,7}$/, { error: 'must be file:line' })
    .optional(),
});

export type ClientErrorReport = z.infer<typeof clientErrorReport>;

/** Validates a parsed body. Field names in the message, never the values. */
export function parseClientErrorReport(body: unknown): ClientErrorReport {
  const parsed = clientErrorReport.safeParse(body);
  if (!parsed.success) {
    // Unknown keys are reported by name only when the name is short and plain (it is the
    // client's text); the values are never echoed.
    const fields = [
      ...new Set(
        parsed.error.issues.flatMap((i) =>
          i.code === 'unrecognized_keys'
            ? i.keys.map((k) => (/^[A-Za-z0-9_]{1,40}$/.test(k) ? k : 'unknown field'))
            : [String(i.path[0] ?? 'body')],
        ),
      ),
    ];
    throw new BadRequestError(`Invalid report: ${fields.join(', ')}`);
  }
  return parsed.data;
}

/**
 * Same-origin only: the browser's `Origin` must be this server's own origin (the Host
 * header already passed the guard), and `Sec-Fetch-Site`, when sent, must agree.
 */
export function assertSameOrigin(headers: Headers): void {
  const host = headers.get('host');
  const origin = headers.get('origin');
  const site = headers.get('sec-fetch-site');
  if (!host || origin !== `http://${host}` || (site !== null && site !== 'same-origin')) {
    throw new ForbiddenError('Cross-origin reports are not accepted');
  }
}

/** Reads a JSON body of at most `maxBytes`, refusing anything else. */
export async function readJsonBody(
  request: Request,
  maxBytes = CLIENT_ERROR_MAX_BYTES,
): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) {
    throw new UnsupportedMediaTypeError('Send application/json');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new PayloadTooLargeError('Report too large');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError('Report too large');
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequestError('Body is not valid JSON');
  }
}
