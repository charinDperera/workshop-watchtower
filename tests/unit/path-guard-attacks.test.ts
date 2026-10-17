/**
 * Peter's attack suite for the record path guard (src/lib/security/record-path.ts) and the
 * record service that sits behind GET /api/record and /limforia?record=.
 */
import { linkSync, mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isInside,
  resolveRecordFile,
  validateRecordPath,
} from '../../src/server/security/record-path';
import { loadRenderedRecord } from '../../src/server/render/record-service';
import { makeTempDir } from './helpers';

describe('lexical guard: traversal and smuggling attempts are 400', () => {
  it.each([
    'limforia/../ROSTER.md',
    'limforia/..\\ROSTER.md',
    'limforia\\..\\..\\secret.md',
    'intel/./../CLAUDE.md',
    '..\\CLAUDE.md',
    './CLAUDE.md',
    'limforia/chronicles/../../apps/x.md',
    '/limforia/a.md',
    '\\limforia\\a.md',
    '//server/share/limforia/a.md',
    '\\\\?\\C:\\Projects\\CLAUDE.md',
    '\\\\.\\C:\\Projects\\CLAUDE.md',
    'F:/Projects/CLAUDE.md',
    'F:\\Projects\\CLAUDE.md',
    'C:CLAUDE.md',
    'limforia/a.md::$DATA',
    'limforia/a.md:Zone.Identifier',
    'limforia/a.md\u0000.txt',
    'limforia/a\n.md',
    'limforia/a\r.md',
    'limforia/a\t.md',
    'limforia/a\u001f.md',
    'limforia/a\u007f.md',
    'limforia/a<b.md',
    'limforia/a>b.md',
    'limforia/a|b.md',
    'limforia/a"b.md',
    'limforia/a?.md',
    'limforia/*.md',
    'limforia/a.md/',
    'limforia//a.md',
    'limforia/a.md.',
    'limforia/a.md...',
    'limforia/a.md ',
    'limforia/ a.md',
    'limforia /a.md',
    'limforia./a.md',
    'limforia/NUL.md',
    'limforia/nul',
    'limforia/COM1.md',
    'limforia/lpt9.txt.md',
    'limforia/aux.tar.md',
    'limforia/CON',
    'Limforia/a.md',
    'INTEL/a.md',
    'claude.md',
    'Roster.md',
    'CLAUDE.md/x.md',
    'apps/watchtower/SPEC.md',
    '.claude/agents/paul.md',
    '.git/config.md',
    '.watchtower/events.md',
    'limforia/a.md.txt',
    'limforia/a.markdown',
    'limforia/a.mdx',
    'limforia/a.md%00',
    'limforia/a.MD',
    'hueco-mundo',
    'intel',
    ' ',
    '\t',
  ])('rejects %j', (path) => {
    const check = validateRecordPath(path);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.status).toBe(400);
  });

  it('does not decode percent-encoding itself (that is the URL layer), so %2e%2e stays a name', () => {
    // The URL parser has already decoded once; a second, encoded layer is a literal name.
    const check = validateRecordPath('limforia/%2e%2e/ROSTER.md');
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.segments).toEqual(['limforia', '%2e%2e', 'ROSTER.md']);
  });

  it('rejects non-strings and an over-long path without throwing', () => {
    for (const bad of [undefined, null, 42, {}, []] as unknown[]) {
      expect(validateRecordPath(bad as string).ok).toBe(false);
    }
    expect(validateRecordPath(`limforia/${'a/'.repeat(300)}x.md`)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('isInside', () => {
  it('handles prefixes, siblings and dot-named children', () => {
    const root = join('F:', 'ws');
    expect(isInside(root, join(root, 'limforia', 'a.md'))).toBe(true);
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, join('F:', 'ws-evil', 'a.md'))).toBe(false);
    expect(isInside(root, join('F:', 'other'))).toBe(false);
    if (process.platform === 'win32') expect(isInside(root, 'C:\\ws\\a.md')).toBe(false);
  });
});

describe('filesystem guard: links that try to leave their area are 404', () => {
  let ws: { dir: string; cleanup: () => void };
  let outside: { dir: string; cleanup: () => void };

  beforeAll(() => {
    ws = makeTempDir('ws-');
    outside = makeTempDir('outside-');
    writeFileSync(join(outside.dir, 'secret.md'), '# Outside secret\n\nSECRET-OUTSIDE');
    for (const dir of ['limforia/chronicles', 'intel', 'hueco-mundo', 'apps/app']) {
      mkdirSync(join(ws.dir, dir), { recursive: true });
    }
    writeFileSync(join(ws.dir, 'ROSTER.md'), '# Roster\n\nROSTER-BODY');
    writeFileSync(join(ws.dir, 'CLAUDE.md'), '# Laws');
    writeFileSync(join(ws.dir, 'apps', 'app', 'private.md'), '# Private\n\nAPP-SECRET');
    writeFileSync(join(ws.dir, 'intel', 'report.md'), '# Report');
    writeFileSync(join(ws.dir, 'limforia', 'chronicles', 'ok.md'), '# OK');
    // Junctions need no special rights on Windows; elsewhere they are directory symlinks.
    symlinkSync(ws.dir, join(ws.dir, 'limforia', 'root'), 'junction');
    symlinkSync(outside.dir, join(ws.dir, 'limforia', 'out'), 'junction');
    symlinkSync(join(ws.dir, 'apps'), join(ws.dir, 'hueco-mundo', 'apps'), 'junction');
    symlinkSync(join(ws.dir, 'intel'), join(ws.dir, 'limforia', 'intel-alias'), 'junction');
    symlinkSync(
      join(ws.dir, 'limforia', 'chronicles'),
      join(ws.dir, 'limforia', 'inner-alias'),
      'junction',
    );
  });

  afterAll(() => {
    ws.cleanup();
    outside.cleanup();
  });

  it.each([
    ['junction to the workstation root, then a root file', 'limforia/root/ROSTER.md'],
    ['junction to the root, then an app file', 'limforia/root/apps/app/private.md'],
    ['junction out of the workstation', 'limforia/out/secret.md'],
    ['junction into apps/', 'hueco-mundo/apps/app/private.md'],
    ['junction into another allowed area', 'limforia/intel-alias/report.md'],
  ])('%s: 404 and never read', async (_name, path) => {
    const result = await loadRenderedRecord(ws.dir, path);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('follows a junction that stays inside its own area', async () => {
    const result = await loadRenderedRecord(ws.dir, 'limforia/inner-alias/ok.md');
    expect(result.ok).toBe(true);
  });

  it('refuses an allowed area that is itself a junction to the outside', async () => {
    const ws2 = makeTempDir('ws2-');
    try {
      symlinkSync(outside.dir, join(ws2.dir, 'intel'), 'junction');
      const check = validateRecordPath('intel/secret.md');
      if (!check.ok) throw new Error('expected lexical ok');
      expect(await resolveRecordFile(ws2.dir, check)).toMatchObject({ ok: false, status: 404 });
    } finally {
      ws2.cleanup();
    }
  });

  it('serves the allowed root files and nothing else at the root', async () => {
    expect((await loadRenderedRecord(ws.dir, 'ROSTER.md')).ok).toBe(true);
    expect((await loadRenderedRecord(ws.dir, 'CLAUDE.md')).ok).toBe(true);
    expect(await loadRenderedRecord(ws.dir, 'apps/app/private.md')).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  // Known limitation, reported: a hard link is the same file under a second name, so no
  // path check can see where "else" it lives. Creating one needs write access to the
  // workstation. This test documents the current behaviour rather than asserting a fix.
  it('refuses a hard link inside limforia/ to a file elsewhere on the same volume (404)', async () => {
    const target = join(ws.dir, 'apps', 'app', 'private.md');
    const link = join(ws.dir, 'limforia', 'hard.md');
    try {
      linkSync(target, link);
    } catch {
      return; // Hard links unsupported here (different volume or filesystem).
    }
    expect(statSync(link).nlink).toBe(2); // NTFS reports real hard links
    const result = await loadRenderedRecord(ws.dir, 'limforia/hard.md');
    expect(result).toMatchObject({ ok: false, status: 404 });
    if (!result.ok) expect(JSON.stringify(result)).not.toContain('APP-SECRET');
    // An ordinary (single-link) record in the same area is still served.
    expect(await loadRenderedRecord(ws.dir, 'limforia/chronicles/ok.md')).toMatchObject({
      ok: true,
    });
  });
});
