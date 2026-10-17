/**
 * WATCHTOWER_PUBLIC_ORIGIN (the gateway's origin), HTTP level:
 * - set (the 4398 server, `https://watchtower.e2e.test`): its host is admitted as a Host
 *   header, and client error reports from that exact origin are accepted;
 * - unset (the main 4399 server): the same Host and Origin are refused;
 * - either way, X-Forwarded-* headers are never trusted.
 * Browser-independent, so it runs in one project only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import type { ApiError } from '../../src/shared/types';
import { expect, test } from './support/test';
import {
  E2E_HOST,
  E2E_PORT,
  GATEWAY_LOCAL_HOST,
  GATEWAY_LOG_DIR,
  GATEWAY_PORT,
  PUBLIC_HOST,
  PUBLIC_ORIGIN,
} from './support/workstation';

test.skip(({ browserName }) => browserName !== 'chromium', 'HTTP-level tests run once');

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function raw(
  port: number,
  path: string,
  host: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      accept: 'application/json',
      host,
      ...options.headers,
    };
    if (options.body !== undefined)
      headers['content-length'] = String(Buffer.byteLength(options.body));
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers },
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
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const report = (n: number) =>
  JSON.stringify({
    msg: `The gateway probe could not load its data (${n}).`,
    where: 'Gateway probe → Probe panel',
    userAction: 'Viewing the page',
    errorCode: 'PETER_GATEWAY_PROBE',
    page: `/probe/gateway/${n}`,
    browser: 'Probe 1 on Test',
    appVersion: '0.1.0',
  });

function postReport(
  port: number,
  host: string,
  origin: string,
  extra: Record<string, string> = {},
  n = 1,
) {
  return raw(port, '/api/client-errors', host, {
    method: 'POST',
    body: report(n),
    headers: {
      'content-type': 'application/json',
      origin,
      'sec-fetch-site': 'same-origin',
      ...extra,
    },
  });
}

test.describe('WATCHTOWER_PUBLIC_ORIGIN set (gateway server)', () => {
  for (const path of ['/', '/host', '/api/snapshot', '/api/health', '/favicon.svg']) {
    test(`admits Host "${PUBLIC_HOST}" on ${path}`, async () => {
      const res = await raw(GATEWAY_PORT, path, PUBLIC_HOST);
      expect(res.status).toBe(200);
      // The gateway path gets the same protections.
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(String(res.headers['content-security-policy'] ?? '')).not.toBe('');
      expect(String(res.headers['x-request-id'] ?? '')).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
  }

  test('still admits its own local Host values', async () => {
    expect((await raw(GATEWAY_PORT, '/api/health', GATEWAY_LOCAL_HOST)).status).toBe(200);
  });

  for (const host of [
    'evil.test',
    `${PUBLIC_HOST}.evil.test`,
    `evil.${PUBLIC_HOST}`,
    `${PUBLIC_HOST}:4398`,
    `${PUBLIC_HOST}@evil.test`,
    `${PUBLIC_HOST} evil`,
  ]) {
    test(`still refuses Host "${host}"`, async () => {
      const res = await raw(GATEWAY_PORT, '/api/snapshot', host);
      expect(res.status).toBe(403);
      expect((JSON.parse(res.body) as ApiError).error).toBe('Host not allowed');
    });
  }

  test('X-Forwarded-Host cannot stand in for the Host header', async () => {
    const res = await raw(GATEWAY_PORT, '/api/snapshot', 'evil.test', {
      headers: {
        'x-forwarded-host': PUBLIC_HOST,
        'x-forwarded-proto': 'https',
        forwarded: `host=${PUBLIC_HOST};proto=https`,
      },
    });
    expect(res.status).toBe(403);
  });

  test('a report from the public origin is accepted and logged', async () => {
    const res = await postReport(GATEWAY_PORT, PUBLIC_HOST, PUBLIC_ORIGIN);
    expect(res.status).toBe(204);
    const requestId = String(res.headers['x-request-id']);
    const file = join(GATEWAY_LOG_DIR, 'client', `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await expect
      .poll(
        () =>
          existsSync(file) &&
          readFileSync(file, 'utf8')
            .split('\n')
            .filter(Boolean)
            .some((l) => (JSON.parse(l) as { requestId?: string }).requestId === requestId),
        { timeout: 5_000 },
      )
      .toBe(true);
  });

  test('a report from the server itself is still accepted', async () => {
    const res = await postReport(
      GATEWAY_PORT,
      GATEWAY_LOCAL_HOST,
      `http://${GATEWAY_LOCAL_HOST}`,
      {},
      2,
    );
    expect(res.status).toBe(204);
  });

  for (const [name, origin] of [
    ['the public host over plain http', `http://${PUBLIC_HOST}`],
    ['the public origin with a path', `${PUBLIC_ORIGIN}/`],
    ['a look-alike host', `https://${PUBLIC_HOST}.evil.test`],
    ['a sub-domain', `https://evil.${PUBLIC_HOST}`],
    ['a foreign origin', 'https://evil.test'],
    ['null', 'null'],
  ] as const) {
    test(`a report from ${name} is refused with 403`, async () => {
      const res = await postReport(GATEWAY_PORT, PUBLIC_HOST, origin);
      expect(res.status).toBe(403);
    });
  }

  test('a cross-site fetch from the public origin is refused', async () => {
    const res = await postReport(GATEWAY_PORT, PUBLIC_HOST, PUBLIC_ORIGIN, {
      'sec-fetch-site': 'cross-site',
    });
    expect(res.status).toBe(403);
  });

  test('X-Forwarded-* cannot make a foreign origin pass as the server or the gateway', async () => {
    // Local Host, so only the forwarded headers could vouch for the http public host.
    const res = await postReport(GATEWAY_PORT, GATEWAY_LOCAL_HOST, `http://${PUBLIC_HOST}`, {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': PUBLIC_HOST,
      forwarded: `host=${PUBLIC_HOST};proto=https`,
    });
    expect(res.status).toBe(403);
  });
});

test.describe('WATCHTOWER_PUBLIC_ORIGIN unset (main server)', () => {
  for (const path of ['/', '/api/snapshot', '/favicon.svg']) {
    test(`refuses Host "${PUBLIC_HOST}" on ${path}`, async () => {
      const res = await raw(E2E_PORT, path, PUBLIC_HOST);
      expect(res.status).toBe(403);
    });
  }

  test('refuses X-Forwarded-Host for the public host', async () => {
    const res = await raw(E2E_PORT, '/api/snapshot', 'evil.test', {
      headers: { 'x-forwarded-host': PUBLIC_HOST },
    });
    expect(res.status).toBe(403);
  });

  test('refuses a report from the public origin', async () => {
    const res = await postReport(E2E_PORT, E2E_HOST, PUBLIC_ORIGIN);
    expect(res.status).toBe(403);
  });
});
