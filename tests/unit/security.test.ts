import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRecordFile, validateRecordPath } from '../../src/server/security/record-path';
import {
  guardRequest,
  isAllowedHost,
  isLoopbackAddress,
} from '../../src/server/security/request-guard';
import { renderMarkdown } from '../../src/server/render/markdown';
import { loadRenderedRecord } from '../../src/server/render/record-service';
import { FIXTURE, makeTempDir } from './helpers';

describe('record path guard (lexical)', () => {
  it.each([
    'limforia/chronicles/a.md',
    'limforia/scriptorium/decisions/ADR-001.md',
    'intel/report.md',
    'hueco-mundo/soul-binder/SOUL-BINDER.md',
    'CLAUDE.md',
    'ROSTER.md',
    'limforia\\chronicles\\a.md',
  ])('accepts %s', (path) => {
    expect(validateRecordPath(path).ok).toBe(true);
  });

  it.each([
    [null, /Missing/],
    ['', /Missing/],
    ['../secret.md', /segments/],
    ['limforia/../ROSTER.md', /segments/],
    ['limforia/./a.md', /segments/],
    ['limforia//a.md', /segments/],
    ['/etc/passwd.md', /relative/],
    ['\\\\server\\share\\a.md', /relative/],
    ['C:/Windows/a.md', /forbidden/],
    ['limforia/a.md:stream', /forbidden/],
    ['limforia/a\u0000.md', /forbidden/],
    ['limforia/a.txt', /Only \.md/],
    ['limforia/a.MD', /Only \.md/],
    ['limforia/a.md.', /dots/],
    ['limforia/a.md ', /spaces/],
    ['limforia/con.md', /reserved/],
    ['apps/watchtower/SPEC.md', /outside/],
    ['.claude/agents/paul.md', /outside/],
    ['README.md', /outside/],
    ['limforia', /Only \.md/],
    ['LIMFORIA/a.md', /outside/],
    ['x'.repeat(600) + '.md', /too long/],
  ])('rejects %j', (path, reason) => {
    const check = validateRecordPath(path as string | null);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.status).toBe(400);
      expect(check.reason).toMatch(reason);
    }
  });
});

describe('record path guard (filesystem)', () => {
  it('resolves an existing record and 404s a missing one', async () => {
    const ok = validateRecordPath('limforia/chronicles/2026-10-01-first.md');
    if (!ok.ok) throw new Error('expected ok');
    expect((await resolveRecordFile(FIXTURE, ok)).ok).toBe(true);
    const missing = validateRecordPath('limforia/chronicles/nope.md');
    if (!missing.ok) throw new Error('expected ok');
    expect(await resolveRecordFile(FIXTURE, missing)).toMatchObject({ ok: false, status: 404 });
  });

  it('refuses a link that leads out of its area', async () => {
    const ws = makeTempDir('ws-');
    const outside = makeTempDir('outside-');
    try {
      writeFileSync(join(outside.dir, 'secret.md'), '# secret');
      mkdirSync(join(ws.dir, 'limforia'));
      mkdirSync(join(ws.dir, 'apps'));
      writeFileSync(join(ws.dir, 'apps', 'private.md'), '# private');
      // Junctions need no special rights on Windows; on other systems this is a dir symlink.
      symlinkSync(outside.dir, join(ws.dir, 'limforia', 'escape'), 'junction');
      symlinkSync(join(ws.dir, 'apps'), join(ws.dir, 'limforia', 'sideways'), 'junction');

      for (const path of ['limforia/escape/secret.md', 'limforia/sideways/private.md']) {
        const check = validateRecordPath(path);
        if (!check.ok) throw new Error('expected lexical ok');
        expect(await resolveRecordFile(ws.dir, check)).toMatchObject({ ok: false, status: 404 });
      }
    } finally {
      ws.cleanup();
      outside.cleanup();
    }
  });

  it('refuses a folder named like a record', async () => {
    const ws = makeTempDir('ws-');
    try {
      mkdirSync(join(ws.dir, 'intel', 'folder.md'), { recursive: true });
      const check = validateRecordPath('intel/folder.md');
      if (!check.ok) throw new Error('expected lexical ok');
      expect(await resolveRecordFile(ws.dir, check)).toMatchObject({ ok: false, status: 404 });
    } finally {
      ws.cleanup();
    }
  });
});

describe('host and address guards', () => {
  it('admits only 127.0.0.1:4321 and localhost:4321', () => {
    expect(isAllowedHost('127.0.0.1:4321')).toBe(true);
    expect(isAllowedHost('LOCALHOST:4321')).toBe(true);
    for (const bad of [
      null,
      '',
      'evil.test',
      'evil.test:4321',
      '127.0.0.1',
      '127.0.0.1:80',
      'localhost:4321.evil.test',
      '[::1]:4321',
    ]) {
      expect(isAllowedHost(bad)).toBe(false);
    }
  });

  it('admits only loopback peers', () => {
    for (const ok of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'])
      expect(isLoopbackAddress(ok)).toBe(true);
    for (const bad of [
      null,
      undefined,
      '',
      '192.168.1.5',
      '::ffff:10.0.0.1',
      '0.0.0.0',
      '127.0.0.1.evil',
    ]) {
      expect(isLoopbackAddress(bad)).toBe(false);
    }
  });
});

describe('middleware verdict', () => {
  const local = { host: '127.0.0.1:4321', address: '127.0.0.1', aborted: false };

  it('admits a local request on an allowed Host, in every loopback form', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      expect(guardRequest({ ...local, address })).toEqual({ allow: true });
  });

  it('checks the Host before the peer', () => {
    expect(guardRequest({ ...local, host: 'evil.test:4321', address: '10.0.0.1' })).toEqual({
      allow: false,
      status: 403,
      error: 'Host not allowed',
      log: 'rejected request with a disallowed Host header',
    });
  });

  it('refuses an untrusted (non-loopback) peer and says so', () => {
    expect(guardRequest({ ...local, address: '192.168.1.5' })).toMatchObject({
      allow: false,
      status: 403,
      log: 'rejected request from an untrusted address',
    });
  });

  it('refuses a request with no peer address without calling it foreign', () => {
    // Dev server: the browser abandoned the request, so Node cleared socket.remoteAddress.
    for (const address of [null, '', '  ']) {
      const verdict = guardRequest({ ...local, address, aborted: true });
      expect(verdict).toEqual({
        allow: false,
        status: 403,
        error: 'Only local requests are allowed',
        log: null,
      });
    }
    // Still connected but no address: refused, with an accurate warning.
    expect(guardRequest({ ...local, address: null })).toMatchObject({
      allow: false,
      log: 'rejected request: the client address is unavailable',
    });
  });

  it('still refuses a foreign peer whose request was aborted', () => {
    expect(guardRequest({ ...local, address: '10.0.0.1', aborted: true })).toMatchObject({
      allow: false,
      log: 'rejected request from an untrusted address',
    });
  });
});

describe('markdown rendering', () => {
  it('renders GFM', () => {
    const html = renderMarkdown('# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n`code`');
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code>code</code>');
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
  });

  it('escapes raw HTML and drops unsafe links', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[js](javascript:alert(1)) [d](data:text/html,x) <a href="https://x.test" onclick="y">a</a>',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<a[^>]*onclick/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/href="data:/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps safe links and marks them noopener', () => {
    const html = renderMarkdown('[a](https://x.test) [b](chronicles/x.md) [c](mailto:a@b.test)');
    expect(html).toContain('href="https://x.test"');
    expect(html).toContain('href="chronicles/x.md"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('record service', () => {
  it('renders a fixture record with its header', async () => {
    const result = await loadRenderedRecord(
      FIXTURE,
      'limforia/audit-hall/2026-10-01-paul-strike.md',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.title).toBe('Audit Log: Paul, fixture');
      expect(result.record.header).toMatchObject({ type: 'audit', extra: { outcome: 'strike' } });
      expect(result.record.html).not.toContain('outcome: strike');
    }
  });

  it('escapes the planted script in the fixture', async () => {
    const result = await loadRenderedRecord(FIXTURE, 'limforia/vault-of-ideas/no-header.md');
    if (!result.ok) throw new Error(result.error);
    expect(result.record.header).toBeNull();
    expect(result.record.html).not.toMatch(/<script/i);
    expect(result.record.html).not.toMatch(/href="javascript:/i);
  });

  it('returns 400 and 404 without reading', async () => {
    expect(await loadRenderedRecord(FIXTURE, '../package.json')).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await loadRenderedRecord(FIXTURE, 'intel/missing.md')).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
