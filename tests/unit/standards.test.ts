/**
 * ADR-004/005/006: handlers and services without HTTP, client error intake, request ids,
 * redaction, log files, the middleware pipeline, the log-folder watch rule, dynamic wings
 * and the client reporter.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createLogger,
  DailyFile,
  REQUEST_ID,
  requestLogLevel,
  resolveRequestId,
} from '../../scripts/logger.mjs';
import { AppError, BadRequestError } from '../../src/server/errors/app-error';
import { toErrorResponse } from '../../src/server/errors/route';
import { getActivity } from '../../src/server/handlers/activity';
import { reportClientError } from '../../src/server/handlers/client-errors';
import { getHealth } from '../../src/server/handlers/health';
import { getRecord } from '../../src/server/handlers/record';
import { getSnapshot } from '../../src/server/handlers/snapshot';
import { openStream } from '../../src/server/handlers/stream';
import { ignoredPrefixes } from '../../src/server/live/runtime';
import { isIgnoredChange } from '../../src/server/live/watch-filter';
import { scanTree } from '../../src/server/live/poll-watcher';
import { handleRequest } from '../../src/server/middleware/pipeline';
import { activityQuery } from '../../src/server/schemas/activity-query';
import {
  assertSameOrigin,
  localOriginHosts,
  parseClientErrorReport,
  readJsonBody,
  type ClientErrorReport,
} from '../../src/server/schemas/client-error';
import { recordPathParam } from '../../src/server/schemas/record-query';
import { discoverWings } from '../../src/server/services/archive';
import { buildSnapshot } from '../../src/server/services/build-snapshot';
import { ClientErrorIntake } from '../../src/server/services/client-error-intake';
import { parseFolderDescriptions } from '../../src/server/sources/parse/folder-descriptions';
import { createWorkstationFs } from '../../src/server/sources/workstation-fs';
import type { AppLogger } from '../../src/server/logging/logger';
import { wingTitle } from '../../src/shared/wings';
import {
  buildPayload,
  createReporter,
  describeBrowser,
  errorCodeOf,
  MAX_REPORTS,
  pageName,
  pagePath,
  sourceOf,
} from '../../src/ui/client-errors';
import { APP_DIR, copyFixture, fakeGit, FIXTURE, makeTempDir } from './helpers';

/** A logger that records what it is asked to log. */
function spyLog() {
  const calls: { level: string; event: string; msg: string; fields?: Record<string, unknown> }[] =
    [];
  const at = (level: string) => (event: string, msg: string, fields?: Record<string, unknown>) =>
    calls.push({ level, event, msg, fields });
  const log: AppLogger = {
    fatal: at('fatal'),
    error: at('error'),
    warn: at('warn'),
    info: at('info'),
    debug: at('debug'),
    trace: at('trace'),
    child: () => log,
    isLevelEnabled: () => true,
  };
  return { log, calls };
}

/** Lines written by a real logger to a capture sink. */
function capture(level = 'trace') {
  const lines: string[] = [];
  const pair = createLogger({
    service: 'bff',
    env: 'test',
    level,
    sinks: [{ write: (line: string) => lines.push(line) }],
  });
  return {
    ...pair,
    lines,
    entries: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

const REPORT: ClientErrorReport = {
  msg: 'A script on the Activity page failed (TypeError).',
  where: 'Activity page → page script',
  userAction: 'Viewing the page',
  errorCode: 'TYPE_ERROR',
  page: '/activity',
  browser: 'Chrome 141 on Windows',
  appVersion: '0.1.0',
  source: '_astro/app.js:12',
};

describe('handlers, without HTTP', () => {
  it('getSnapshot returns the service snapshot, or a 500 AppError that keeps the cause', async () => {
    const snapshot = { version: 1 } as never;
    expect(await getSnapshot({ service: { get: async () => snapshot } })).toBe(snapshot);
    const cause = new Error('disk on fire');
    const failed = getSnapshot({ service: { get: async () => Promise.reject(cause) } });
    await expect(failed).rejects.toMatchObject({
      status: 500,
      message: 'Snapshot unavailable',
      cause,
    });
  });

  it('getActivity pages the fixture log', async () => {
    const page = await getActivity(activityQuery(new URLSearchParams('agent=peter&limit=2')), {
      fs: createWorkstationFs(FIXTURE),
    });
    expect(page.events.map((e) => e.event)).toEqual(['SubagentStop', 'PostToolUseFailure']);
    expect(page.total).toBe(4);
  });

  it('getRecord renders a record, and maps the guard to 400 and 404', async () => {
    const record = await getRecord('limforia/chronicles/2026-10-01-first.md', { root: FIXTURE });
    expect(record.path).toBe('limforia/chronicles/2026-10-01-first.md');
    await expect(getRecord('../x.md', { root: FIXTURE })).rejects.toMatchObject({ status: 400 });
    await expect(getRecord('limforia/none.md', { root: FIXTURE })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('getHealth reports the version', () => {
    const { version } = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(getHealth()).toEqual({ ok: true, version });
  });

  it('schemas reject bad input with a BadRequestError', () => {
    expect(() => activityQuery(new URLSearchParams('limit=0'))).toThrow(BadRequestError);
    expect(() => recordPathParam(new URLSearchParams('path=a&path=b'))).toThrow(
      'Give exactly one "path"',
    );
    expect(recordPathParam(new URLSearchParams(''))).toBeNull();
  });
});

describe('errors become responses in one place, logged once', () => {
  it('a 4xx AppError is a warning with its message', async () => {
    const { log, calls } = spyLog();
    const response = toErrorResponse(new BadRequestError('Bad thing'), log, '/api/x');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Bad thing', status: 400 });
    expect(calls).toEqual([
      {
        level: 'warn',
        event: 'request.rejected',
        msg: 'Bad thing',
        fields: { route: '/api/x', status: 400 },
      },
    ]);
  });

  it('a 5xx keeps the cause in the log and out of the response', async () => {
    const { log, calls } = spyLog();
    const cause = new Error('SECRET internal detail');
    const response = toErrorResponse(
      new AppError(500, 'Unavailable', {}, { cause }),
      log,
      '/api/x',
    );
    expect(await response.text()).not.toContain('SECRET');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 'error',
      event: 'request.failed',
      fields: { err: cause },
    });
  });

  it('an unknown error is a generic 500, logged once', async () => {
    const { log, calls } = spyLog();
    const response = toErrorResponse(new TypeError('SECRET'), log, '/api/x');
    expect(await response.json()).toEqual({ error: 'Internal error', status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('a 429 carries Retry-After', () => {
    const { log } = spyLog();
    const intake = new ClientErrorIntake({ limit: 0 });
    let thrown: unknown;
    try {
      reportClientError(REPORT, 'c', { intake, log });
    } catch (err) {
      thrown = err;
    }
    const response = toErrorResponse(thrown, log, '/api/client-errors');
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('client error reports', () => {
  it('accepts a readable report', () => {
    expect(parseClientErrorReport(REPORT)).toEqual(REPORT);
    const { source: _source, ...withoutSource } = REPORT;
    expect(parseClientErrorReport(withoutSource)).toEqual(withoutSource);
  });

  it.each([
    ['an unknown key (form contents cannot ride along)', { ...REPORT, password: 'x' }, 'password'],
    ['a stack trace in msg', { ...REPORT, msg: 'TypeError: x\n    at f (app.js:1:2)' }, 'msg'],
    ['an inline stack frame', { ...REPORT, where: 'at render (https://x/app.js:10:5)' }, 'where'],
    ['a long msg', { ...REPORT, msg: 'x'.repeat(301) }, 'msg'],
    ['an empty where', { ...REPORT, where: '' }, 'where'],
    ['a lower-case code', { ...REPORT, errorCode: 'type_error' }, 'errorCode'],
    ['a page with a query', { ...REPORT, page: '/activity?agent=paul' }, 'page'],
    ['a full URL as page', { ...REPORT, page: 'https://evil.test/' }, 'page'],
    ['a source with a column', { ...REPORT, source: 'app.js:1:2' }, 'source'],
    ['a bad version', { ...REPORT, appVersion: 'latest' }, 'appVersion'],
    ['a control character', { ...REPORT, browser: 'Chrome\u0007' }, 'browser'],
    ['a missing field', { msg: 'x' }, 'where'],
  ])('rejects %s, naming the field', (_name, body, field) => {
    let thrown: unknown;
    try {
      parseClientErrorReport(body);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BadRequestError);
    expect((thrown as Error).message).toContain(field);
    // Field names only, never the submitted values.
    expect((thrown as Error).message).not.toMatch(/evil|alert|password: x|Chrome/);
  });

  it('is same-origin only', () => {
    const headers = (h: Record<string, string>) => new Headers(h);
    expect(() =>
      assertSameOrigin(headers({ host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' })),
    ).not.toThrow();
    const refused: Record<string, string>[] = [
      { host: '127.0.0.1:4321' },
      { host: '127.0.0.1:4321', origin: 'http://evil.test' },
      { host: '127.0.0.1:4321', origin: 'http://localhost:4321' },
      { host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321', 'sec-fetch-site': 'cross-site' },
    ];
    for (const bad of refused) {
      expect(() => assertSameOrigin(headers(bad))).toThrow('Cross-origin reports are not accepted');
    }
  });

  it('reads at most a capped JSON body', async () => {
    const post = (body: string, type = 'application/json') =>
      new Request('http://127.0.0.1:4321/api/client-errors', {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      });
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ a: 1 });
    await expect(readJsonBody(post('{"a":1}', 'text/plain'))).rejects.toMatchObject({
      status: 415,
    });
    await expect(readJsonBody(post('x'.repeat(5000)))).rejects.toMatchObject({ status: 413 });
    await expect(readJsonBody(post('{not json'))).rejects.toMatchObject({ status: 400 });
  });

  it('rate-limits per client and writes each report once', () => {
    let now = 0;
    const intake = new ClientErrorIntake({
      limit: 3,
      windowMs: 60_000,
      dedupeMs: 300_000,
      now: () => now,
    });
    const other = { ...REPORT, msg: 'Something else went wrong.' };
    expect(intake.submit('a', REPORT)).toEqual({ outcome: 'accepted' });
    expect(intake.submit('a', REPORT)).toEqual({ outcome: 'duplicate' });
    expect(intake.submit('a', other)).toEqual({ outcome: 'accepted' });
    expect(intake.submit('a', other)).toMatchObject({ outcome: 'limited', retryAfterSeconds: 60 });
    // Another client has its own budget.
    expect(intake.submit('b', { ...other, page: '/git' })).toEqual({ outcome: 'accepted' });
    // The window slides.
    now = 61_000;
    expect(intake.submit('a', { ...other, where: 'Git page' })).toEqual({ outcome: 'accepted' });
    // A duplicate is written again after the dedupe window.
    now = 400_000;
    expect(intake.submit('a', REPORT)).toEqual({ outcome: 'accepted' });
  });

  it('keeps its memory bounded', () => {
    const intake = new ClientErrorIntake({ maxEntries: 5 });
    for (let i = 0; i < 50; i += 1) intake.submit(`client-${i}`, { ...REPORT, msg: `m${i}` });
    const internals = intake as unknown as {
      hits: Map<string, unknown>;
      seen: Map<string, unknown>;
    };
    expect(internals.hits.size).toBeLessThanOrEqual(5);
    expect(internals.seen.size).toBeLessThanOrEqual(5);
  });

  it('writes an accepted report to the client log as a readable error, and answers 204', () => {
    const { log, calls } = spyLog();
    const intake = new ClientErrorIntake();
    expect(reportClientError(REPORT, 'a', { intake, log }).status).toBe(204);
    expect(reportClientError(REPORT, 'a', { intake, log }).status).toBe(204);
    expect(calls).toEqual([
      {
        level: 'error',
        event: 'client.type_error',
        msg: REPORT.msg,
        fields: {
          where: REPORT.where,
          userAction: REPORT.userAction,
          errorCode: 'TYPE_ERROR',
          page: '/activity',
          browser: REPORT.browser,
          appVersion: '0.1.0',
          source: '_astro/app.js:12',
        },
      },
    ]);
  });
});

describe('logging', () => {
  it('accepts only well-formed request ids', () => {
    for (const ok of ['abcd1234', 'A-b_c-0123456789', 'x'.repeat(64)]) {
      expect(REQUEST_ID.test(ok)).toBe(true);
      expect(resolveRequestId(ok)).toBe(ok);
    }
    for (const bad of [
      undefined,
      '',
      'short',
      'x'.repeat(65),
      'has space1',
      'a;b=c-12345',
      'line\nbreak1',
      42,
    ]) {
      expect(resolveRequestId(bad, () => 'generated-id')).toBe('generated-id');
    }
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('writes the required fields on every line', () => {
    const log = capture();
    log.system.info('server.started', 'Server started', { version: '0.1.0' });
    log.forRequest('req-0000001').warn('request.refused', 'Refused');
    const [system, request] = log.entries();
    for (const line of [system, request]) {
      expect(Object.keys(line ?? {})).toEqual(
        expect.arrayContaining([
          'time',
          'level',
          'app',
          'service',
          'env',
          'requestId',
          'msg',
          'event',
        ]),
      );
    }
    expect(system).toMatchObject({
      level: 'info',
      app: 'watchtower',
      service: 'bff',
      env: 'test',
      requestId: null,
      event: 'server.started',
    });
    expect(request).toMatchObject({
      level: 'warn',
      requestId: 'req-0000001',
      event: 'request.refused',
    });
    expect(new Date(String(system?.time)).toISOString()).toBe(system?.time);
  });

  it('never writes a token, cookie or secret, wherever it appears', () => {
    const log = capture();
    log.forRequest('req-0000002').info('test.redaction', 'Headers seen', {
      headers: {
        authorization: 'Bearer SECRET-TOKEN-1',
        cookie: 'sid=SECRET-COOKIE',
        'set-cookie': 'SECRET-SET',
      },
      req: { headers: { authorization: 'Bearer SECRET-TOKEN-2' } },
      token: 'SECRET-TOKEN-3',
      password: 'SECRET-PASSWORD',
      apiKey: 'SECRET-KEY',
      nested: { secret: 'SECRET-NESTED' },
    });
    const text = log.lines.join('');
    expect(text).not.toContain('SECRET');
    expect(text).toContain('[redacted]');
  });

  it('logs the Docker health check quietly, and nothing else', () => {
    expect(requestLogLevel('GET', '/api/health', 200)).toBe('debug');
    expect(requestLogLevel('HEAD', '/api/health', 200)).toBe('info');
    expect(requestLogLevel('GET', '/api/health', 403)).toBe('info');
    expect(requestLogLevel('GET', '/api/health', 500)).toBe('info');
    expect(requestLogLevel('GET', '/api/healthz', 200)).toBe('info');
    expect(requestLogLevel('GET', '/api/snapshot', 200)).toBe('info');
    // At debug level the line is there, with the usual fields.
    const log = capture('debug');
    const level = requestLogLevel('GET', '/api/health', 200);
    const fields = { method: 'GET', route: '/api/health', status: 200, durationMs: 1 };
    log.forRequest('req-health01')[level]('request.completed', 'Request completed', fields);
    expect(log.entries()).toMatchObject([
      { level: 'debug', event: 'request.completed', route: '/api/health' },
    ]);
  });

  it('honours the level', () => {
    const log = capture('warn');
    log.system.info('x.info', 'hidden');
    log.system.warn('x.warn', 'shown');
    expect(log.entries().map((e) => e.event)).toEqual(['x.warn']);
  });

  it('appends to <dir>/<service>/YYYY-MM-DD.jsonl, by UTC day', () => {
    const temp = makeTempDir('logs-');
    try {
      let day = new Date('2026-10-17T23:59:59.000Z');
      const file = new DailyFile(join(temp.dir, 'bff'), () => day);
      file.write('{"a":1}\n');
      day = new Date('2026-10-18T00:00:01.000Z');
      file.write('{"a":2}\n');
      expect(readdirSync(join(temp.dir, 'bff')).sort()).toEqual([
        '2026-10-17.jsonl',
        '2026-10-18.jsonl',
      ]);
      const pair = createLogger({
        service: 'client',
        env: 'test',
        level: 'info',
        logDir: temp.dir,
        sinks: [],
      });
      pair.forRequest('req-0000003').error('client.type_error', 'Readable message');
      const written = readdirSync(join(temp.dir, 'client'));
      expect(written).toHaveLength(1);
      expect(written[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
      const line = JSON.parse(readFileSync(join(temp.dir, 'client', written[0] ?? ''), 'utf8'));
      expect(line).toMatchObject({
        service: 'client',
        requestId: 'req-0000003',
        event: 'client.type_error',
      });
    } finally {
      temp.cleanup();
    }
  });
});

describe('middleware pipeline', () => {
  const context = (
    host: string,
    address: string,
    extra: Partial<App.Locals> = {},
    headers: Record<string, string> = {},
  ) => ({
    request: new Request('http://127.0.0.1:4321/api/x', { headers: { host, ...headers } }),
    url: new URL('http://127.0.0.1:4321/api/x'),
    locals: { ...extra } as App.Locals,
    clientAddress: address,
    routePattern: '/api/x',
  });

  it('admits a local request, and sets the request id and security headers', async () => {
    const ctx = context('127.0.0.1:4321', '127.0.0.1', {}, { 'x-request-id': 'pipeline-0001' });
    const next = vi.fn(async () => new Response('ok'));
    const response = await handleRequest(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.headers.get('x-request-id')).toBe('pipeline-0001');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(ctx.locals.requestId).toBe('pipeline-0001');
    expect(ctx.locals.log).toBeDefined();
  });

  it('uses the edge id from locals and refuses a foreign Host without calling next', async () => {
    const ctx = context('evil.test:4321', '127.0.0.1', {
      requestId: 'edge-id-00001',
      edgeLogged: true,
    });
    const next = vi.fn(async () => new Response('ok'));
    const response = await handleRequest(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(response.headers.get('x-request-id')).toBe('edge-id-00001');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('keeps an immutable response (a redirect) intact while adding the headers', async () => {
    const ctx = context('127.0.0.1:4321', '127.0.0.1');
    const response = await handleRequest(ctx, async () =>
      Response.redirect('http://127.0.0.1:4321/', 302),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('review fixes', () => {
  it('accepts client reports from the public origin exactly, and still from this server', () => {
    const origin = 'https://dev-watchtower.workshop.io';
    const h = (o: Record<string, string>) => new Headers(o);
    expect(() =>
      assertSameOrigin(
        h({ host: 'dev-watchtower.workshop.io', origin, 'sec-fetch-site': 'same-origin' }),
        origin,
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(h({ host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' }), origin),
    ).not.toThrow();
    // A plain-http page on the public host is a downgrade, not this server's origin: refused.
    expect(() =>
      assertSameOrigin(
        h({ host: 'dev-watchtower.workshop.io', origin: 'http://dev-watchtower.workshop.io' }),
        origin,
      ),
    ).toThrow('Cross-origin reports are not accepted');
    for (const bad of ['https://evil.test', `${origin}.evil.test`, 'https://workshop.io']) {
      expect(() =>
        assertSameOrigin(h({ host: 'dev-watchtower.workshop.io', origin: bad }), origin),
      ).toThrow('Cross-origin reports are not accepted');
    }
    // Without a public origin, the gateway's origin is refused.
    expect(() => assertSameOrigin(h({ host: 'dev-watchtower.workshop.io', origin }))).toThrow();
  });

  it('refuses the public host over plain http (Peter: watchtower.e2e.test repro)', () => {
    const origin = 'https://watchtower.e2e.test';
    const h = (o: Record<string, string>) => new Headers(o);
    const local = localOriginHosts(['127.0.0.1:4398', 'localhost:4398'], origin);
    // The repro: Host watchtower.e2e.test, Origin http://watchtower.e2e.test -> 403.
    expect(() =>
      assertSameOrigin(
        h({
          host: 'watchtower.e2e.test',
          origin: 'http://watchtower.e2e.test',
          'sec-fetch-site': 'same-origin',
        }),
        origin,
        local,
      ),
    ).toThrow('Cross-origin reports are not accepted');
    // The public origin itself is accepted, exactly.
    expect(() =>
      assertSameOrigin(
        h({ host: 'watchtower.e2e.test', origin, 'sec-fetch-site': 'same-origin' }),
        origin,
        local,
      ),
    ).not.toThrow();
    // Local hosts keep the http://<Host> rule, including WATCHTOWER_ALLOWED_HOSTS and case.
    for (const host of ['127.0.0.1:4321', 'localhost:4321', '127.0.0.1:4398', 'LocalHost:4398']) {
      expect(() =>
        assertSameOrigin(h({ host, origin: `http://${host.toLowerCase()}` }), origin, local),
      ).not.toThrow();
    }
    // An unlisted host never counts as local.
    expect(() =>
      assertSameOrigin(h({ host: 'evil.test', origin: 'http://evil.test' }), origin, local),
    ).toThrow();
  });

  it('never treats the public host as local, even if WATCHTOWER_ALLOWED_HOSTS lists it', () => {
    expect(
      localOriginHosts(['watchtower.e2e.test', '127.0.0.1:4398'], 'https://watchtower.e2e.test'),
    ).toEqual(['127.0.0.1:4321', 'localhost:4321', '127.0.0.1:4398']);
    // A public origin with a port excludes exactly host:port.
    expect(localOriginHosts(['gw.test:8443', 'gw.test'], 'https://gw.test:8443')).toEqual([
      '127.0.0.1:4321',
      'localhost:4321',
      'gw.test',
    ]);
    expect(localOriginHosts([], null)).toEqual(['127.0.0.1:4321', 'localhost:4321']);
  });

  it('sends the stream with X-Accel-Buffering: no, for the proxy', async () => {
    const service = {
      get: async () => ({ version: 1 }) as never,
      subscribe: () => () => {},
      markSent: () => {},
    };
    const abort = new AbortController();
    const response = openStream(abort.signal, { service });
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    abort.abort();
    await response.body?.cancel();
  });

  it('keeps the stack when an error is logged', () => {
    const log = capture();
    log.system.error('test.failed', 'Something failed', { err: new Error('boom') });
    const [line] = log.entries();
    expect(line?.err).toMatchObject({ type: 'Error', message: 'boom' });
    expect(String((line?.err as { stack?: string }).stack)).toContain('standards.test.ts');
  });

  it('redacts the wider set of credential names, three levels deep', () => {
    const log = capture();
    log.forRequest('req-redact02').info('test.redaction', 'More secrets', {
      api_key: 'SECRET-1',
      accessToken: 'SECRET-2',
      refresh_token: 'SECRET-3',
      'x-api-key': 'SECRET-4',
      a: { b: { c: { accessToken: 'SECRET-5', refreshToken: 'SECRET-6' } } },
      req: { headers: { 'x-api-key': 'SECRET-7', cookie: 'SECRET-8' } },
    });
    expect(log.lines.join('')).not.toContain('SECRET');
  });

  it('never changes the sinks array it is given', () => {
    const temp = makeTempDir('sinks-');
    try {
      const sinks = [{ write: () => true }];
      createLogger({ service: 'bff', env: 'test', level: 'info', logDir: temp.dir, sinks });
      expect(sinks).toHaveLength(1);
    } finally {
      temp.cleanup();
    }
  });

  it('re-creates a log folder removed while running, and keeps writing', () => {
    const temp = makeTempDir('enoent-');
    try {
      const dir = join(temp.dir, 'bff');
      const file = new DailyFile(dir, () => new Date('2026-10-17T12:00:00Z'));
      file.write('{"n":1}\n');
      rmSync(dir, { recursive: true, force: true });
      file.write('{"n":2}\n');
      expect(readFileSync(join(dir, '2026-10-17.jsonl'), 'utf8')).toBe('{"n":2}\n');
    } finally {
      temp.cleanup();
    }
  });
});

describe('the watcher never watches the logs', () => {
  it('ignores limforia/logs and a LOG_DIR inside the workstation', () => {
    expect(isIgnoredChange('limforia/logs/watchtower/bff/2026-10-17.jsonl')).toBe(true);
    expect(isIgnoredChange('limforia\\logs\\watchtower\\client\\x.jsonl')).toBe(true);
    expect(isIgnoredChange('limforia/logs')).toBe(true);
    expect(isIgnoredChange('limforia/logsheet.md')).toBe(false);
    expect(isIgnoredChange('limforia/chronicles/a.md')).toBe(false);
    const extra = ignoredPrefixes('F:/ws', 'F:/ws/var/logs');
    expect(extra).toEqual(['var/logs']);
    expect(isIgnoredChange('var/logs/bff/x.jsonl', extra)).toBe(true);
    // A LOG_DIR outside the workstation needs no rule.
    expect(ignoredPrefixes('F:/ws', 'F:/elsewhere/logs')).toEqual([]);
    expect(ignoredPrefixes('F:/ws', undefined)).toEqual([]);
  });

  it('skips the log folder when polling', async () => {
    const temp = makeTempDir('poll-logs-');
    try {
      mkdirSync(join(temp.dir, 'limforia', 'logs', 'watchtower', 'bff'), { recursive: true });
      mkdirSync(join(temp.dir, 'limforia', 'chronicles'), { recursive: true });
      writeFileSync(join(temp.dir, 'limforia', 'logs', 'watchtower', 'bff', 'x.jsonl'), '{}\n');
      writeFileSync(join(temp.dir, 'limforia', 'chronicles', 'a.md'), '# A');
      expect([...(await scanTree(temp.dir)).keys()]).toEqual(['limforia/chronicles/a.md']);
    } finally {
      temp.cleanup();
    }
  });
});

describe('dynamic wings', () => {
  const CONSTITUTION = [
    '| Wing | Holds |',
    '|---|---|',
    '| `chronicles/` | Records of archived chats and contexts |',
    '| `scriptorium/` | Documentation: `features/`, `decisions/` |',
    '| `logs/` | Application logs |',
    "| `checkpoints/` | Michael's handover files |",
    '',
    '| Realm | Purpose |',
    '|---|---|',
    '| `limforia/` | The Great Archive |',
    '| `.claude/agents/` | Definitions of active subagents |',
    "| `intel/` | Uriel's research reports |",
  ].join('\n');

  it('reads folder descriptions from CLAUDE.md tables', () => {
    const descriptions = parseFolderDescriptions(CONSTITUTION);
    expect([...descriptions.entries()]).toEqual([
      ['chronicles', 'Records of archived chats and contexts'],
      ['scriptorium', 'Documentation: features/, decisions/'],
      ['logs', 'Application logs'],
      ['checkpoints', "Michael's handover files"],
      ['limforia', 'The Great Archive'],
      ['intel', "Uriel's research reports"],
    ]);
    expect(parseFolderDescriptions(null).size).toBe(0);
  });

  it('discovers wings from folders, excluding logs, in table order, with fallbacks', () => {
    const wings = discoverWings(
      ['zeta-new', 'checkpoints', 'logs', 'chronicles', 'alpha-new'],
      parseFolderDescriptions(CONSTITUTION),
    );
    expect(wings).toEqual([
      { id: 'chronicles', description: 'Records of archived chats and contexts' },
      { id: 'checkpoints', description: "Michael's handover files" },
      { id: 'alpha-new', description: 'alpha-new' },
      { id: 'zeta-new', description: 'zeta-new' },
      { id: 'intel', description: "Uriel's research reports" },
    ]);
  });

  it('titles wings from their folder names', () => {
    expect(wingTitle('vault-of-ideas')).toBe('Vault of Ideas');
    expect(wingTitle('audit-hall')).toBe('Audit Hall');
    expect(wingTitle('checkpoints')).toBe('Checkpoints');
    expect(wingTitle('of-the_end')).toBe('Of the End');
  });

  it('shows a new wing in the snapshot with no app change, and never logs/ records', async () => {
    const ws = copyFixture();
    try {
      writeFileSync(join(ws.dir, 'CLAUDE.md'), CONSTITUTION);
      mkdirSync(join(ws.dir, 'limforia', 'checkpoints'));
      writeFileSync(join(ws.dir, 'limforia', 'checkpoints', '2026-10-17-a.md'), '# A checkpoint');
      mkdirSync(join(ws.dir, 'limforia', 'logs', 'watchtower'), { recursive: true });
      writeFileSync(join(ws.dir, 'limforia', 'logs', 'README.md'), '# Logs');
      const snapshot = await buildSnapshot({
        fs: createWorkstationFs(ws.dir),
        git: fakeGit({}),
        now: () => Date.parse('2026-10-17T00:00:00Z'),
      });
      const ids = snapshot.wings.map((w) => w.id);
      expect(ids).toContain('checkpoints');
      expect(ids).not.toContain('logs');
      expect(ids.at(-1)).toBe('intel');
      expect(snapshot.wings.find((w) => w.id === 'checkpoints')).toMatchObject({
        title: 'Checkpoints',
        description: "Michael's handover files",
        count: 1,
      });
      expect(snapshot.wings.find((w) => w.id === 'audit-hall')?.description).toBe('audit-hall');
      expect(snapshot.records.some((r) => r.path.startsWith('limforia/logs/'))).toBe(false);
    } finally {
      ws.cleanup();
    }
  });
});

describe('client reporter', () => {
  const env = () => ({
    path: '/activity?agent=paul#x',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537',
  });

  it('builds a readable payload the server accepts', () => {
    const payload = buildPayload(
      {
        msg: 'A script on the Activity page failed (TypeError).',
        where: 'Activity page → page script',
        errorCode: 'TYPE_ERROR',
        source: '_astro/a.js:3',
      },
      env(),
    );
    expect(payload).toMatchObject({
      userAction: 'Viewing the page',
      page: '/activity',
      browser: 'Chrome 141 on Windows',
    });
    expect(parseClientErrorReport(payload)).toEqual(payload);
  });

  it('sends at most MAX_REPORTS per page, each distinct report once', () => {
    const sent: unknown[] = [];
    const report = createReporter((p) => sent.push(p), env);
    const error = (n: number) => ({ msg: `Failure ${n}.`, where: 'Activity page', errorCode: 'X' });
    expect(report(error(1))).toBe(true);
    expect(report(error(1))).toBe(false);
    for (let i = 2; i <= 10; i += 1) report(error(i));
    expect(sent).toHaveLength(MAX_REPORTS);
  });

  it('turns errors into codes and places into names', () => {
    expect(errorCodeOf(new TypeError('x'), 'SCRIPT_ERROR')).toBe('TYPE_ERROR');
    expect(errorCodeOf(new DOMException('x', 'AbortError'), 'X')).toBe('ABORT_ERROR');
    expect(errorCodeOf('not an error', 'UNHANDLED_REJECTION')).toBe('UNHANDLED_REJECTION');
    expect(pageName('/activity')).toBe('Activity page');
    expect(pageName('/host/paul')).toMatch(/ page$/);
    expect(pageName('/nowhere')).toBe('This page');
    expect(pagePath('/a b')).toBe('/');
    expect(
      describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'),
    ).toBe('Firefox 140 on Linux');
    expect(describeBrowser('curl/8')).toBe('Unknown browser on an unknown system');
  });

  it('keeps only a same-origin file:line as source', () => {
    expect(sourceOf('http://127.0.0.1:4321/_astro/a.js', 12, 'http://127.0.0.1:4321')).toBe(
      '_astro/a.js:12',
    );
    expect(sourceOf('https://cdn.test/a.js', 12, 'http://127.0.0.1:4321')).toBeUndefined();
    expect(sourceOf(undefined, 12, 'http://127.0.0.1:4321')).toBeUndefined();
  });
});
