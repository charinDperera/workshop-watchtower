/**
 * API and HTTP security against the running server (local only, 127.0.0.1:4321):
 * the Host-header guard, /api/record traversal, /api/activity validation, unknown API
 * routes and the security headers. Browser-independent, so it runs in one project only.
 */
import { request as httpRequest } from 'node:http';
import type { ApiError, RenderedRecord } from '../../src/lib/types';
import { expect, test } from './support/test';
import { e2eRoot, hasEscapeJunction, OUTSIDE_SECRET } from './support/workstation';

test.skip(({ browserName }) => browserName !== 'chromium', 'HTTP-level tests run once');

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw GET to the local server with full control over the Host header and the path. */
function rawGet(path: string, host: string | null = '127.0.0.1:4321'): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (host !== null) headers.host = host;
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: 4321,
        path,
        method: 'GET',
        headers,
        setHost: host === null ? false : undefined,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error(`timeout on ${path}`)));
    req.on('error', reject);
    req.end();
  });
}

const json = <T>(r: RawResponse) => JSON.parse(r.body) as T;

test.describe('Host header guard (DNS rebinding)', () => {
  for (const host of [
    'evil.test:4321',
    'evil.test',
    '127.0.0.1',
    '127.0.0.1:80',
    'localhost:4321.evil.test',
    '127.0.0.1:4321@evil.test',
    '[::1]:4321',
    '0.0.0.0:4321',
    'LOCALHOST:4321 evil',
  ]) {
    for (const path of [
      '/',
      '/api/snapshot',
      '/api/record?path=CLAUDE.md',
      '/api/stream',
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

  for (const host of ['127.0.0.1:4321', 'localhost:4321', 'LocalHost:4321']) {
    test(`admits Host "${host}"`, async () => {
      expect((await rawGet('/api/snapshot', host)).status).toBe(200);
    });
  }
});

test.describe('security headers', () => {
  const EXPECTED = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
  };
  for (const path of [
    '/',
    '/limforia',
    '/api/snapshot',
    '/api/record?path=CLAUDE.md',
    '/api/nope',
    '/no-such-page',
    '/favicon.svg',
  ]) {
    test(`are present on ${path}`, async () => {
      const res = await rawGet(path);
      for (const [name, value] of Object.entries(EXPECTED)) {
        expect(res.headers[name], `${name} on ${path}`).toBe(value);
      }
      expect(String(res.headers['x-powered-by'] ?? '')).toBe('');
    });
  }

  test('API JSON is not cached and is typed', async () => {
    const res = await rawGet('/api/snapshot');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('also present on 403 responses', async () => {
    const res = await rawGet('/', 'evil.test:4321');
    // Rejections are built before the header step; report if they are missing.
    for (const [name, value] of Object.entries(EXPECTED))
      expect(res.headers[name], name).toBe(value);
  });
});

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
});

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

  test('write methods are not accepted on the API', async ({ request }) => {
    for (const path of ['/api/snapshot', '/api/record?path=CLAUDE.md', '/api/activity']) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBeGreaterThanOrEqual(400);
      expect(res.status(), path).toBeLessThan(500);
    }
  });
});

test.describe('SSE stream', () => {
  test('sends a retry hint and a snapshot event on connect', async () => {
    const text = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: 4321, path: '/api/stream', headers: { host: '127.0.0.1:4321' } },
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
