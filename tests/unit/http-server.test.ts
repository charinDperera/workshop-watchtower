import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestListener } from '../../scripts/http-server.mjs';
import { createStaticHandler, staticPathFor } from '../../scripts/static-files.mjs';
import {
  cspHash,
  inlineScriptsOf,
  inlineScriptHashes,
} from '../../scripts/inline-script-hashes.mjs';
import {
  createRequestPolicy,
  DEFAULT_POLICY,
  FALLBACK_CSP,
} from '../../src/server/security/request-guard';
import { withSecurityHeaders } from '../../src/server/middleware/security-headers';
import { errorResponse } from '../../src/server/errors/responses';
import { readServerEnv } from '../../scripts/server-env.mjs';
import type { ServerSettings } from '../../src/server/config/env';
import { APP_DIR, makeTempDir } from './helpers';

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

describe('withSecurityHeaders (middleware)', () => {
  it('adds the headers and the fallback CSP to refusals and errors', () => {
    for (const status of [400, 403, 404, 500]) {
      const response = withSecurityHeaders(errorResponse(status, 'x'));
      for (const [name, value] of Object.entries(HEADERS)) {
        expect(response.headers.get(name)).toBe(value);
      }
      expect(response.headers.get('content-security-policy')).toBe(FALLBACK_CSP);
    }
  });

  it("keeps a page's own CSP", () => {
    const page = new Response('<p>x</p>', {
      headers: { 'Content-Security-Policy': "script-src 'self' 'sha256-x'" },
    });
    expect(withSecurityHeaders(page).headers.get('content-security-policy')).toBe(
      "script-src 'self' 'sha256-x'",
    );
  });

  it('copies a response whose headers are immutable', () => {
    const redirect = Response.redirect('http://127.0.0.1:4321/x', 302);
    const fixed = withSecurityHeaders(redirect);
    expect(fixed.status).toBe(302);
    expect(fixed.headers.get('x-frame-options')).toBe('DENY');
    expect(fixed.headers.get('location')).toBe('http://127.0.0.1:4321/x');
  });
});

describe('static file paths', () => {
  const root = join(APP_DIR, 'dist', 'client');
  it.each([
    ['/favicon.svg', join(root, 'favicon.svg')],
    ['/_astro/a%20b.js', join(root, '_astro', 'a b.js')],
  ])('maps %s inside the client folder', (url, file) => {
    expect(staticPathFor(root, url)).toBe(file);
  });

  it.each([
    '/',
    '/_astro/',
    '/.gitkeep',
    '/_astro/.hidden.js',
    '/../package.json',
    '/_astro/..%2f..%2fpackage.json',
    '/%2e%2e/package.json',
    '/a%5cb',
    '/a%00b',
    '/%E0%A4%A',
    'relative',
  ])('refuses %s', (url) => {
    expect(staticPathFor(root, url)).toBeNull();
  });
});

describe('Node request listener (start.mjs)', () => {
  let server: Server;
  let port = 0;
  let client: { dir: string; cleanup: () => void };
  const appCalls: string[] = [];

  beforeAll(async () => {
    client = makeTempDir('client-');
    mkdirSync(join(client.dir, '_astro'));
    writeFileSync(join(client.dir, 'favicon.svg'), '<svg/>');
    writeFileSync(join(client.dir, '_astro', 'app.js'), 'console.log(1)');
    writeFileSync(join(client.dir, '.secret'), 'dot');
    try {
      symlinkSync(join(APP_DIR, 'package.json'), join(client.dir, 'link.json'));
    } catch {
      // Symlinks may need rights on Windows; the static handler refuses them either way.
    }
    const listener = createRequestListener({
      policy: DEFAULT_POLICY,
      serveStatic: createStaticHandler(client.dir),
      app: (req, res) => {
        appCalls.push(req.url ?? '');
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Security-Policy': "script-src 'self' 'sha256-page'",
        });
        res.end('<p>page</p>');
      },
      log: { warn: () => {}, error: () => {} },
    });
    server = createServer(listener);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    client.cleanup();
  });

  const get = (path: string, host = '127.0.0.1:4321', method = 'GET') =>
    new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
      (done, fail) => {
        const req = request({ host: '127.0.0.1', port, path, method, headers: { host } }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on('error', fail);
        req.end();
      },
    );

  const expectHeaders = (headers: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(HEADERS)) expect(headers[name]).toBe(value);
  };

  it('serves a static file with the headers, the fallback CSP and caching', async () => {
    const asset = await get('/_astro/app.js');
    expect(asset).toMatchObject({ status: 200, body: 'console.log(1)' });
    expectHeaders(asset.headers);
    expect(asset.headers['content-security-policy']).toBe(FALLBACK_CSP);
    expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const icon = await get('/favicon.svg');
    expect(icon.headers['cache-control']).toBe('no-cache');
    expect((await get('/favicon.svg', undefined, 'HEAD')).body).toBe('');
  });

  it('guards static files: a bad Host is refused before anything is read', async () => {
    for (const path of ['/favicon.svg', '/_astro/app.js', '/']) {
      const refused = await get(path, 'evil.test:4321');
      expect(refused.status).toBe(403);
      expect(JSON.parse(refused.body)).toEqual({ error: 'Host not allowed', status: 403 });
      expectHeaders(refused.headers);
      expect(refused.headers['content-security-policy']).toBe(FALLBACK_CSP);
    }
    expect(appCalls).not.toContain('/');
  });

  it('hands pages to Astro and keeps their own CSP', async () => {
    const page = await get('/host');
    expect(page).toMatchObject({ status: 200, body: '<p>page</p>' });
    expectHeaders(page.headers);
    expect(page.headers['content-security-policy']).toBe("script-src 'self' 'sha256-page'");
  });

  it('never serves dotfiles, symlinks or folders, and rejects a malformed URL', async () => {
    appCalls.length = 0;
    await get('/.secret');
    await get('/link.json');
    await get('/_astro');
    expect(appCalls).toEqual(['/.secret', '/link.json', '/_astro']);
    const bad = await get('/%E0%A4%A');
    expect(bad.status).toBe(400);
    expectHeaders(bad.headers);
  });
});

describe('container-mode policy at the Node level', () => {
  it('admits the trusted gateway only in container mode', () => {
    const settings = readServerEnv({
      WATCHTOWER_CONTAINER: '1',
      WATCHTOWER_TRUSTED_CLIENTS: '172.17.0.1',
    }) as ServerSettings;
    const policy = createRequestPolicy(settings);
    expect(policy.isTrustedPeer('172.17.0.1')).toBe(true);
    expect(policy.isTrustedPeer('127.0.0.1')).toBe(true);
    expect(DEFAULT_POLICY.isTrustedPeer('172.17.0.1')).toBe(false);
  });
});

describe('inline script hashes (CSP)', () => {
  it('hashes each is:inline script exactly as written', () => {
    const source = '---\n---\n<script is:inline>\n  a();\n</script>\n<script>b()</script>';
    expect(inlineScriptsOf(source)).toEqual(['\n  a();\n']);
    expect(cspHash('\n  a();\n')).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
  });

  it('finds the inline scripts under src/', () => {
    const hashes = inlineScriptHashes(join(APP_DIR, 'src'));
    expect(hashes.length).toBeGreaterThan(0);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
