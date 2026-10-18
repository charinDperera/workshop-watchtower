/**
 * API and HTTP security against the running e2e server (local only, 127.0.0.1:4399):
 * the Host-header guard, security headers and CSP on every response (static files and
 * refusals included), x-request-id, /api/record traversal, /api/activity validation,
 * /api/client-errors, unknown API routes, the SSE stream, and the request log in LOG_DIR.
 * Browser-independent, so it runs in one project only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import type { ApiError, RenderedRecord } from '../../src/shared/types';
import { expect, test } from './support/test';
import {
  E2E_DIST_DIR,
  E2E_HOST,
  E2E_LOG_DIR,
  E2E_PORT,
  e2eRoot,
  GATEWAY_LOCAL_HOST,
  hasEscapeJunction,
  OUTSIDE_SECRET,
} from './support/workstation';

test.skip(({ browserName }) => browserName !== 'chromium', 'HTTP-level tests run once');

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface RawOptions {
  method?: string;
  /** `null` sends no Host header at all. */
  host?: string | null;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

/** A raw request to the e2e server with full control over the Host header and the path. */
function raw(path: string, options: RawOptions = {}): Promise<RawResponse> {
  const { method = 'GET', host = E2E_HOST, body } = options;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (host !== null) headers.host = host;
    if (body !== undefined && headers['content-length'] === undefined) {
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    // An empty value means "send no such header" (e.g. chunked bodies without a length).
    for (const [name, value] of Object.entries(headers)) if (value === '') delete headers[name];
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: E2E_PORT,
        path,
        method,
        headers,
        setHost: host === null ? false : undefined,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
        );
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error(`timeout on ${path}`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const rawGet = (path: string, host: string | null = E2E_HOST) => raw(path, { host });
const json = <T>(r: RawResponse) => JSON.parse(r.body) as T;

/* ------------------------------------------------------------------ */
/* Host guard                                                          */
/* ------------------------------------------------------------------ */

test.describe('Host header guard (DNS rebinding)', () => {
  for (const host of [
    'evil.test:4399',
    'evil.test',
    '127.0.0.1',
    '127.0.0.1:80',
    `localhost:${E2E_PORT}.evil.test`,
    `127.0.0.1:${E2E_PORT}@evil.test`,
    `[::1]:${E2E_PORT}`,
    `0.0.0.0:${E2E_PORT}`,
    `LOCALHOST:${E2E_PORT} evil`,
  ]) {
    for (const path of [
      '/',
      '/api/snapshot',
      '/api/record?path=CLAUDE.md',
      '/api/stream',
      '/api/health',
      '/favicon.svg',
    ]) {
      test(`refuses Host "${host}" on ${path} with 403 JSON`, async () => {
        const res = await rawGet(path, host);
        expect(res.status).toBe(403);
        expect(json<ApiError>(res)).toEqual({ error: 'Host not allowed', status: 403 });
        expect(res.body).not.toContain('Michael');
      });
    }
  }

  test('refuses a request with no Host header', async () => {
    const res = await rawGet('/api/snapshot', null);
    expect([400, 403]).toContain(res.status);
  });

  // The defaults stay admitted (WATCHTOWER_ALLOWED_HOSTS adds, never replaces).
  for (const host of [
    E2E_HOST,
    `localhost:${E2E_PORT}`,
    `LocalHost:${E2E_PORT}`,
    '127.0.0.1:4321',
    'localhost:4321',
  ]) {
    test(`admits Host "${host}"`, async () => {
      expect((await rawGet('/api/snapshot', host)).status).toBe(200);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Security headers, CSP, request ids                                  */
/* ------------------------------------------------------------------ */

const EXPECTED_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

/** Parses a CSP header into directive -> sources. */
function parseCsp(header: string | string[] | undefined): Map<string, string[]> {
  const text = Array.isArray(header) ? header.join(';') : (header ?? '');
  const map = new Map<string, string[]>();
  for (const part of text.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), sources);
  }
  return map;
}

test.describe('security headers, CSP and request ids', () => {
  const PATHS = [
    '/',
    '/limforia',
    '/laws',
    '/api/snapshot',
    '/api/record?path=CLAUDE.md',
    '/api/health',
    '/api/nope',
    '/no-such-page',
    '/favicon.svg',
  ];

  for (const path of PATHS) {
    test(`are present on ${path}`, async () => {
      const res = await rawGet(path);
      for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
        expect(res.headers[name], `${name} on ${path}`).toBe(value);
      }
      expect(String(res.headers['x-powered-by'] ?? '')).toBe('');
      const csp = parseCsp(res.headers['content-security-policy']);
      expect(csp.size, `CSP on ${path}`).toBeGreaterThan(0);
      expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
      expect(csp.get('base-uri')).toEqual(["'none'"]);
      const scripts = csp.get('script-src') ?? csp.get('default-src') ?? [];
      expect(scripts, `script sources on ${path}`).not.toContain("'unsafe-inline'");
      expect(scripts).not.toContain("'unsafe-eval'");
      expect(scripts).not.toContain('*');
      expect(String(res.headers['x-request-id'] ?? '')).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
  }

  test('pages carry a hashed script policy and allow fonts only from self', async () => {
    const csp = parseCsp((await rawGet('/')).headers['content-security-policy']);
    expect(csp.get('script-src')?.some((s) => s.startsWith("'sha"))).toBe(true);
    expect(csp.get('font-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
  });

  test('are present on 403 refusals', async () => {
    const res = await rawGet('/', `evil.test:${E2E_PORT}`);
    for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(res.headers[name], name).toBe(value);
    }
    expect(parseCsp(res.headers['content-security-policy']).get('default-src')).toEqual(["'none'"]);
    expect(String(res.headers['x-request-id'] ?? '')).not.toBe('');
  });

  test('every response gets its own request id', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++)
      ids.add(String((await rawGet('/api/health')).headers['x-request-id']));
    expect(ids.size).toBe(5);
  });

  test('a well-formed incoming x-request-id is kept, a malformed one replaced', async () => {
    const kept = await raw('/api/health', { headers: { 'x-request-id': 'peter-req-12345678' } });
    expect(kept.headers['x-request-id']).toBe('peter-req-12345678');
    for (const bad of [
      'short',
      'has space in it',
      'x'.repeat(65),
      'bad"quote<id>',
      'line\\nbreak123',
    ]) {
      const res = await raw('/api/health', { headers: { 'x-request-id': bad } });
      expect(res.headers['x-request-id']).not.toBe(bad);
      expect(String(res.headers['x-request-id'])).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    }
  });

  test('API JSON is not cached and is typed', async () => {
    const res = await rawGet('/api/snapshot');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('/api/health answers', async () => {
    const res = await rawGet('/api/health');
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* /api/record                                                         */
/* ------------------------------------------------------------------ */

test.describe('/api/record traversal', () => {
  test('serves an allowed record', async () => {
    const res = await rawGet('/api/record?path=limforia%2Fchronicles%2F2026-10-01-first.md');
    expect(res.status).toBe(200);
    expect(json<RenderedRecord>(res).title).toBe('Chronicle: the first');
  });

  for (const [name, query, status] of [
    ['missing path', '', 400],
    ['empty path', '?path=', 400],
    ['two paths', '?path=CLAUDE.md&path=ROSTER.md', 400],
    ['../', '?path=../package.json', 400],
    ['../ inside an area', '?path=limforia/../ROSTER.md', 400],
    ['encoded ../', '?path=..%2F..%2FCLAUDE.md', 400],
    ['encoded dots', '?path=%2e%2e%2fCLAUDE.md', 400],
    ['double-encoded dots', '?path=limforia%2F%252e%252e%2FROSTER.md', 404],
    ['backslashes', '?path=limforia%5C..%5CROSTER.md', 400],
    ['absolute posix', '?path=%2Fetc%2Fpasswd', 400],
    ['absolute windows', '?path=C%3A%5CWindows%5Cwin.ini', 400],
    ['absolute workstation path', `?path=${encodeURIComponent('F:/Projects/CLAUDE.md')}`, 400],
    ['UNC', `?path=${encodeURIComponent('\\\\127.0.0.1\\c$\\x.md')}`, 400],
    ['device namespace', `?path=${encodeURIComponent('\\\\?\\C:\\x.md')}`, 400],
    ['NTFS stream', '?path=limforia%2FCATALOG.md%3A%3A%24DATA', 400],
    ['null byte', '?path=limforia%2FCATALOG.md%00.md', 400],
    ['trailing dot', '?path=limforia%2FCATALOG.md.', 400],
    ['device name', '?path=limforia%2FCON.md', 400],
    ['outside the areas', '?path=apps%2Fdemo-app%2Fx.md', 400],
    ['an agent definition', '?path=.claude%2Fagents%2Fpaul.md', 400],
    ['the event log', '?path=.watchtower%2Fevents.jsonl', 400],
    ['not markdown', '?path=limforia%2FCATALOG.txt', 400],
    ['a missing record', '?path=intel%2Fnope.md', 404],
  ] as const) {
    test(`${name} -> ${status}`, async () => {
      const res = await rawGet(`/api/record${query}`);
      expect(res.status).toBe(status);
      const body = json<ApiError>(res);
      expect(body.status).toBe(status);
      expect(typeof body.error).toBe('string');
      // Errors never echo file paths of the machine.
      expect(res.body).not.toMatch(/[A-Za-z]:\\\\|\/Users\/|Projects\\\\/);
    });
  }

  test('a junction out of the workstation is 404 and leaks nothing', async () => {
    test.skip(!hasEscapeJunction(e2eRoot()), 'junctions are not available here');
    const res = await rawGet('/api/record?path=limforia%2Fescape%2Fsecret.md');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(OUTSIDE_SECRET);
  });

  test('a malformed URL is refused, not crashed on', async () => {
    const res = await rawGet('/api/record?path=%E0%A4%A');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

/* ------------------------------------------------------------------ */
/* /api/activity                                                       */
/* ------------------------------------------------------------------ */

test.describe('/api/activity validation', () => {
  for (const [name, query] of [
    ['unknown parameter', '?foo=1'],
    ['agent with a slash', '?agent=..%2Fx'],
    ['upper-case agent', '?agent=Paul'],
    ['agent repeated', '?agent=paul&agent=luke'],
    ['unknown event', '?event=Nope'],
    ['before without a zone', '?before=2026-10-01T12:00:00'],
    ['impossible date', '?before=2026-02-31T00:00:00Z'],
    ['hour 24', '?before=2026-10-01T24:00:00Z'],
    ['before repeated', '?before=2026-10-01T12:00:00Z&before=2026-10-01T12:00:00Z'],
    ['limit 0', '?limit=0'],
    ['limit 501', '?limit=501'],
    ['negative limit', '?limit=-1'],
    ['fractional limit', '?limit=1.5'],
    ['hex limit', '?limit=0x10'],
    ['limit repeated', '?limit=1&limit=2'],
  ] as const) {
    test(`${name} -> 400`, async () => {
      const res = await rawGet(`/api/activity${query}`);
      expect(res.status).toBe(400);
      expect(json<ApiError>(res)).toMatchObject({ status: 400 });
    });
  }

  test('a valid query pages newest first', async () => {
    const res = await rawGet('/api/activity?limit=5&event=PreToolUse&event=PostToolUse');
    expect(res.status).toBe(200);
    const page = json<{ events: { ts: string }[]; nextBefore: string | null; total: number }>(res);
    expect(page.events).toHaveLength(5);
    const times = page.events.map((e) => Date.parse(e.ts));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(page.nextBefore).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* /api/client-errors                                                   */
/* ------------------------------------------------------------------ */

const ORIGIN = `http://${E2E_HOST}`;

function report(i: number, extra: Record<string, unknown> = {}) {
  return {
    msg: `The probe page could not load its data (${i}).`,
    where: 'Probe page → Probe panel',
    userAction: 'Viewing the page',
    errorCode: 'PETER_PROBE',
    page: `/probe/${i}`,
    browser: 'Probe 1 on Test',
    appVersion: '0.1.0',
    ...extra,
  };
}

const postReport = (body: string | Buffer, headers: Record<string, string> = {}) =>
  raw('/api/client-errors', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
  });

/** The client log lines written by the e2e server today (UTC). */
function logLines(service: 'bff' | 'client'): Record<string, unknown>[] {
  const file = join(E2E_LOG_DIR, service, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test.describe('/api/client-errors', () => {
  // In order: the rate limit (10 a minute per client) is shared by every test here.
  test.describe.configure({ mode: 'serial' });

  test('a same-origin report is accepted with 204 and written to the client log', async () => {
    const res = await postReport(JSON.stringify(report(1)));
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
    const requestId = String(res.headers['x-request-id']);
    await expect
      .poll(() => logLines('client').find((l) => l.requestId === requestId), { timeout: 5_000 })
      .toMatchObject({
        level: 'error',
        app: 'watchtower',
        service: 'client',
        event: 'client.peter_probe',
        msg: 'The probe page could not load its data (1).',
        where: 'Probe page → Probe panel',
        page: '/probe/1',
      });
  });

  for (const [name, headers] of [
    ['a foreign Origin', { origin: 'http://evil.test' }],
    ['no Origin', { origin: '' }],
    ['the Origin of another port', { origin: 'http://127.0.0.1:4321' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site fetch', { 'sec-fetch-site': 'same-site' }],
  ] as const) {
    test(`${name} is refused with 403`, async () => {
      const all: Record<string, string> = { ...headers };
      const res = await raw('/api/client-errors', {
        method: 'POST',
        body: JSON.stringify(report(2)),
        headers: {
          'content-type': 'application/json',
          ...(all.origin === '' ? {} : { origin: all.origin ?? ORIGIN }),
          'sec-fetch-site': all['sec-fetch-site'] ?? 'same-origin',
        },
      });
      expect(res.status).toBe(403);
      expect(json<ApiError>(res).status).toBe(403);
    });
  }

  test('a body over 4 KB is refused with 413, declared or streamed', async () => {
    const big = JSON.stringify(report(3, { msg: 'x'.repeat(5000) }));
    expect((await postReport(big)).status).toBe(413);
    // Chunked, with no Content-Length: the server must count the bytes itself.
    const chunked = await raw('/api/client-errors', {
      method: 'POST',
      body: big,
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'sec-fetch-site': 'same-origin',
        'transfer-encoding': 'chunked',
        'content-length': '',
      },
    });
    expect(chunked.status).toBe(413);
  });

  for (const type of [
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    '',
  ]) {
    test(`content type "${type}" is refused with 415`, async () => {
      const res = await postReport(JSON.stringify(report(4)), { 'content-type': type });
      expect(res.status).toBe(415);
    });
  }

  for (const [name, body] of [
    ['invalid JSON', '{"msg":'],
    ['an unknown field (form contents)', JSON.stringify(report(5, { password: 'hunter2' }))],
    ['a stack trace in msg', JSON.stringify(report(6, { msg: 'Error at fn (app.js:1:2)' }))],
    ['a newline in msg', JSON.stringify(report(7, { msg: 'line one\nline two' }))],
    ['a page with a query', JSON.stringify(report(8, { page: '/probe?token=x' }))],
    ['a lower-case error code', JSON.stringify(report(9, { errorCode: 'probe' }))],
    ['an array', '[]'],
  ] as const) {
    test(`${name} is refused with 400 and never logged`, async () => {
      const res = await postReport(body);
      expect(res.status).toBe(400);
      expect(res.body).not.toContain('hunter2');
      expect(JSON.stringify(logLines('client'))).not.toContain('hunter2');
    });
  }

  test('GET is not a way in', async () => {
    const res = await rawGet('/api/client-errors');
    expect([404, 405]).toContain(res.status);
  });

  test('more than 10 reports a minute get 429 with Retry-After', async () => {
    const statuses: number[] = [];
    let retryAfter: string | undefined;
    for (let i = 0; i < 12; i++) {
      const res = await postReport(JSON.stringify(report(100 + i)));
      statuses.push(res.status);
      if (res.status === 429) retryAfter = String(res.headers['retry-after'] ?? '');
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s !== 204 && s !== 429)).toEqual([]);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Request log                                                         */
/* ------------------------------------------------------------------ */

test.describe('request log (LOG_DIR)', () => {
  test('one request.completed line per request, with no query and no secrets', async () => {
    const id = 'peter-log-probe-0001';
    const res = await raw('/api/record?path=CLAUDE.md&probe=SECRET-QUERY-VALUE', {
      headers: {
        'x-request-id': id,
        authorization: 'Bearer SECRET-AUTH-TOKEN',
        cookie: 'session=SECRET-COOKIE-VALUE',
      },
    });
    expect(res.status).toBe(200);
    await expect
      .poll(() => logLines('bff').filter((l) => l.requestId === id).length, { timeout: 5_000 })
      .toBe(1);
    const line = logLines('bff').find((l) => l.requestId === id);
    expect(line).toMatchObject({
      level: 'info',
      app: 'watchtower',
      service: 'bff',
      env: 'production',
      event: 'request.completed',
      method: 'GET',
      route: '/api/record',
      status: 200,
    });
    expect(typeof line?.durationMs).toBe('number');
    expect(String(line?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const everything = JSON.stringify([...logLines('bff'), ...logLines('client')]);
    for (const secret of ['SECRET-QUERY-VALUE', 'SECRET-AUTH-TOKEN', 'SECRET-COOKIE-VALUE']) {
      expect(everything).not.toContain(secret);
    }
  });

  test('refused requests are logged too, as a warning and a completed line', async () => {
    const id = 'peter-log-probe-0002';
    await raw('/', { host: `evil.test:${E2E_PORT}`, headers: { 'x-request-id': id } });
    await expect
      .poll(
        () =>
          logLines('bff')
            .filter((l) => l.requestId === id)
            .map((l) => l.event),
        {
          timeout: 5_000,
        },
      )
      .toEqual(expect.arrayContaining(['request.refused', 'request.completed']));
  });

  test('log lines never carry the workstation contents', async () => {
    const everything = JSON.stringify(logLines('bff'));
    expect(everything).not.toContain(OUTSIDE_SECRET);
    expect(everything).not.toContain('Fixture agent body');
  });
});

/* ------------------------------------------------------------------ */
/* Unknown routes and methods                                           */
/* ------------------------------------------------------------------ */

test.describe('unknown API routes', () => {
  for (const path of [
    '/api/nope',
    '/api/',
    '/api/record/extra',
    '/api/../api/x',
    '/api/snapshot/x',
  ]) {
    test(`${path} is a JSON 404`, async () => {
      const res = await rawGet(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(json<ApiError>(res)).toEqual({ error: 'Unknown API route', status: 404 });
    });
  }

  test('write methods are not accepted on the read-only API', async () => {
    for (const path of ['/api/snapshot', '/api/record?path=CLAUDE.md', '/api/activity']) {
      const res = await raw(path, {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
      });
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.status, path).toBeLessThan(500);
    }
  });
});

/* ------------------------------------------------------------------ */
/* SSE                                                                  */
/* ------------------------------------------------------------------ */

test.describe('SSE stream', () => {
  test('sends a retry hint and a snapshot event on connect', async () => {
    const text = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: E2E_PORT, path: '/api/stream', headers: { host: E2E_HOST } },
        (res) => {
          expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            body += c;
            if (body.includes('event: snapshot')) {
              req.destroy();
              resolve(body);
            }
          });
        },
      );
      req.setTimeout(10_000, () => req.destroy(new Error('no snapshot event within 10 s')));
      req.on('error', (err) => (err.message.includes('socket hang up') ? undefined : reject(err)));
      req.end();
    });
    expect(text).toContain('retry: 3000');
    expect(text).toMatch(/event: snapshot\ndata: \{/);
  });
});

/* ------------------------------------------------------------------ */
/* The private e2e build                                               */
/* ------------------------------------------------------------------ */

test.describe('WATCHTOWER_DIST_DIR', () => {
  test('both e2e servers serve the private build in .local/peter/e2e/dist', async () => {
    expect(existsSync(join(E2E_DIST_DIR, 'server', 'entry.mjs'))).toBe(true);
    const html = (await rawGet('/')).body;
    const assets = [...html.matchAll(/["'](\/_astro\/[^"'?#]+)["']/g)].map((m) => m[1] ?? '');
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(existsSync(join(E2E_DIST_DIR, 'client', ...asset.split('/'))), asset).toBe(true);
    }
    // The gateway server answers from the same build.
    const gateway = await fetch('http://' + GATEWAY_LOCAL_HOST + '/');
    expect(gateway.status).toBe(200);
    const gatewayAssets = [...(await gateway.text()).matchAll(/["'](\/_astro\/[^"'?#]+)["']/g)];
    expect(gatewayAssets.length).toBeGreaterThan(0);
    for (const asset of gatewayAssets.map((m) => m[1] ?? '')) {
      expect(existsSync(join(E2E_DIST_DIR, 'client', ...asset.split('/'))), asset).toBe(true);
    }
  });
});
