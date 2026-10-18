import { describe, expect, it } from 'vitest';
import {
  extractLinks,
  findTable,
  parseMarkdownTables,
  splitRow,
} from '../../src/server/sources/parse/markdown-table';
import { splitFrontmatter, toStringList } from '../../src/server/sources/parse/frontmatter';
import {
  parseCatalog,
  parseRoster,
  parseSoulBinder,
  parseStrikes,
  resolveRelativeLink,
} from '../../src/server/sources/parse/registers';
import { parseAgentDefinition } from '../../src/server/sources/parse/definition';
import {
  auditSubject,
  classifyPath,
  firstHeading,
  isIsoDate,
  parseRecord,
} from '../../src/server/sources/parse/record';
import {
  parseEventLine,
  parseEvents,
  splitCompleteLines,
} from '../../src/server/sources/parse/events';
import {
  countPorcelain,
  LOG_FORMAT,
  parseBranchTracking,
  parseGitLog,
} from '../../src/server/sources/parse/git';

describe('markdown tables', () => {
  it('splits rows and honours escaped pipes', () => {
    expect(splitRow('| a | b \\| c | d |')).toEqual(['a', 'b | c', 'd']);
  });

  it('drops placeholder rows and tracks the section heading', () => {
    const tables = parseMarkdownTables(
      '## One\n| A | B |\n|---|---|\n| — | — |\n\n## Two\n| A | B |\n|:---|---:|\n| x | y |\n',
    );
    expect(tables).toHaveLength(2);
    expect(tables[0]).toMatchObject({ section: 'One', rows: [] });
    expect(tables[1]).toMatchObject({ section: 'Two', rows: [{ A: 'x', B: 'y' }] });
  });

  it('ignores pipe lines that are not tables', () => {
    expect(parseMarkdownTables('| not a table\nplain text')).toEqual([]);
  });

  it('finds a table by headers case-insensitively and extracts links', () => {
    const tables = parseMarkdownTables('| name | role |\n|---|---|\n| X | Y |');
    expect(findTable(tables, ['Name', 'Role'])?.rows).toHaveLength(1);
    expect(extractLinks('see [a](x/a.md) and [b](b.md "t")')).toEqual([
      { text: 'a', href: 'x/a.md' },
      { text: 'b', href: 'b.md' },
    ]);
  });
});

describe('frontmatter', () => {
  it('parses a mapping and returns the body', () => {
    const r = splitFrontmatter('---\ntype: intel\ndate: 2026-10-16\n---\n# Title\n');
    expect(r).toMatchObject({ present: true, error: null, body: '# Title\n' });
    // YAML 1.2 core schema keeps dates as strings.
    expect(r.data).toEqual({ type: 'intel', date: '2026-10-16' });
  });

  it('handles CRLF and a BOM', () => {
    const r = splitFrontmatter('﻿---\r\ntype: x\r\n---\r\nbody');
    expect(r.data).toEqual({ type: 'x' });
    expect(r.body).toBe('body');
  });

  it('reports, never throws, on bad headers', () => {
    expect(splitFrontmatter('---\nno close').error).toMatch(/closing/);
    expect(splitFrontmatter('---\na: [b\n---\n').error).toMatch(/Invalid YAML/);
    expect(splitFrontmatter('---\n- a\n---\n').error).toMatch(/mapping/);
    expect(splitFrontmatter('# none')).toMatchObject({ present: false, data: null });
  });

  it('normalises lists', () => {
    expect(toStringList(['a', ' b ', null])).toEqual(['a', 'b']);
    expect(toStringList('Read, Write')).toEqual(['Read', 'Write']);
    expect(toStringList(3)).toEqual([]);
  });
});

describe('registers', () => {
  it('parses strike counts', () => {
    expect(parseStrikes('1 / 3')).toEqual({ strikes: 1, limit: 3 });
    expect(parseStrikes('one')).toEqual({ strikes: null, limit: 3 });
  });

  it('parses the roster and reports unreadable strikes', () => {
    const md =
      '| Name | Role | Tools | Created | Strikes |\n|---|---|---|---|---|\n| Paul | Arch | Read | 2026-10-16 | 0 / 3 |\n| Bad | x | y | z | ? |';
    const r = parseRoster(md);
    // Legacy 5-column roster: no title, worker, no station.
    expect(r.items[0]).toEqual({
      name: 'Paul',
      title: null,
      rank: 'worker',
      station: null,
      role: 'Arch',
      tools: 'Read',
      created: '2026-10-16',
      strikes: 0,
      strikeLimit: 3,
    });
    expect(r.problems[0]?.message).toMatch(/Unreadable strike count for Bad/);
  });

  it('reads Title, Rank and Station from the 8-column roster', () => {
    const md = [
      '| Name | Title | Rank | Station | Role | Tools | Created | Strikes |',
      '|---|---|---|---|---|---|---|---|',
      '| Michael | Prince of the Host | Overseer | — | Main agent: leads | All | 2026-10-16 | 0 / 3 |',
      '| Uriel | The Wizard | COUNSEL | — | Research | Read | 2026-10-16 | 0 / 3 |',
      '| Joseph | Guardian | worker | Data | Data | Read | 2026-10-17 | 0 / 3 |',
      '| Nobody |  |  |  | Unranked | Read | 2026-10-17 | 0 / 3 |',
      '| Odd | – | Archangel | Build | Unknown rank | Read | 2026-10-17 | 0 / 3 |',
    ].join('\n');
    const r = parseRoster(md);
    expect(r.items.map((e) => [e.name, e.title, e.rank, e.station])).toEqual([
      ['Michael', 'Prince of the Host', 'overseer', null],
      ['Uriel', 'The Wizard', 'counsel', null],
      ['Joseph', 'Guardian', 'worker', 'Data'],
      ['Nobody', null, 'worker', null],
      ['Odd', null, 'worker', 'Build'],
    ]);
    // Only the unknown value is reported; a missing one is simply a worker.
    expect(r.problems).toEqual([
      { source: 'ROSTER.md', message: 'Unknown rank for Odd: "Archangel" (treated as Worker)' },
    ]);
  });

  it('reads the Advisor rank, and Counsel as its old alias, as the counsel tier', () => {
    const md = [
      '| Name | Title | Rank | Station | Role | Tools | Created | Strikes |',
      '|---|---|---|---|---|---|---|---|',
      '| Uriel | The Wizard | Advisor | — | Research | Read | 2026-10-18 | 0 / 3 |',
      '| Old | — | Counsel | — | Research | Read | 2026-10-16 | 0 / 3 |',
      '| Loud | — | ADVISOR | — | Research | Read | 2026-10-18 | 0 / 3 |',
      '| Proto | — | constructor | — | Research | Read | 2026-10-18 | 0 / 3 |',
    ].join('\n');
    const r = parseRoster(md);
    expect(r.items.map((e) => [e.name, e.rank])).toEqual([
      ['Uriel', 'counsel'],
      ['Old', 'counsel'],
      ['Loud', 'counsel'],
      ['Proto', 'worker'],
    ]);
    // Only the unknown keyword is reported (an inherited object key is not a rank).
    expect(r.problems.map((p) => p.message)).toEqual([
      'Unknown rank for Proto: "constructor" (treated as Worker)',
    ]);
  });

  it('infers the overseer from the role only in a legacy roster without a Rank column', () => {
    const legacy =
      '| Name | Role | Tools | Created | Strikes |\n|---|---|---|---|---|\n| Michael | Main agent: leads | All | 2026-10-16 | 0 / 3 |';
    expect(parseRoster(legacy).items[0]?.rank).toBe('overseer');
    const ranked =
      '| Name | Rank | Role | Tools | Created | Strikes |\n|---|---|---|---|---|---|\n| Michael | Worker | Main agent: leads | All | 2026-10-16 | 0 / 3 |';
    expect(parseRoster(ranked).items[0]?.rank).toBe('worker');
  });

  it('tolerates a missing roster', () => {
    expect(parseRoster(null)).toMatchObject({ items: [], found: false });
  });

  it('treats an all-dash Soul Binder as empty', () => {
    const md =
      '| Name | Role | Served | Cause of retirement | Audit log |\n|---|---|---|---|---|\n| — | — | — | — | — |';
    expect(parseSoulBinder(md)).toMatchObject({ items: [], found: true });
  });

  it('resolves soul binder audit links relative to the binder', () => {
    const md =
      '| Name | Role | Served | Cause of retirement | Audit log |\n|---|---|---|---|---|\n| Az | r | s | c | [a](../../limforia/audit-hall/a.md) |';
    expect(parseSoulBinder(md).items[0]?.auditLogPath).toBe('limforia/audit-hall/a.md');
  });

  it('collects catalog links with their section', () => {
    const md =
      '## Chronicles\n| Date | Entry |\n|---|---|\n| 2026-10-16 | [x](chronicles/x.md) |\n| — | — |';
    expect(parseCatalog(md).items).toEqual([
      {
        section: 'Chronicles',
        date: '2026-10-16',
        label: 'x',
        href: 'chronicles/x.md',
        path: 'limforia/chronicles/x.md',
        cells: { Date: '2026-10-16', Entry: '[x](chronicles/x.md)' },
      },
    ]);
  });

  it('refuses links that escape the workstation or are external', () => {
    expect(resolveRelativeLink('limforia/CATALOG.md', '../../etc/passwd')).toBeNull();
    expect(resolveRelativeLink('limforia/CATALOG.md', 'https://x.test/a.md')).toBeNull();
    expect(resolveRelativeLink('limforia/CATALOG.md', 'a%20b.md#top')).toBe('limforia/a b.md');
  });
});

describe('agent definitions', () => {
  it('reads name, tools and skills', () => {
    const d = parseAgentDefinition(
      '.claude/agents/paul.md',
      '---\nname: paul\ndescription: Paul.\ntools: Read, Bash\nskills: website-stack\n---\nbody',
    );
    expect(d).toMatchObject({
      name: 'paul',
      tools: ['Read', 'Bash'],
      skills: ['website-stack'],
      model: null,
      problems: [],
    });
  });

  it('falls back to the file name and reports malformed frontmatter', () => {
    const d = parseAgentDefinition('.claude/agents/broken.md', '---\nname: [x\n---\n');
    expect(d.name).toBe('broken');
    expect(d.problems.join()).toMatch(/Invalid YAML/);
  });
});

describe('records', () => {
  it('validates dates strictly', () => {
    expect(isIsoDate('2026-10-16')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('YYYY-MM-DD')).toBe(false);
  });

  it('classifies wings and sub-wings', () => {
    expect(classifyPath('limforia/scriptorium/decisions/a.md')).toEqual({
      wing: 'scriptorium',
      subWing: 'decisions',
    });
    expect(classifyPath('limforia/chronicles/a.md')).toEqual({ wing: 'chronicles', subWing: null });
    expect(classifyPath('intel/a.md')).toEqual({ wing: 'intel', subWing: null });
    // Any limforia/ subfolder is a wing (wings are discovered), sub-wings are generic.
    expect(classifyPath('limforia/checkpoints/a.md')).toEqual({
      wing: 'checkpoints',
      subWing: null,
    });
    expect(classifyPath('limforia/odd/deeper/a.md')).toEqual({ wing: 'odd', subWing: 'deeper' });
    expect(classifyPath('limforia/README.md')).toEqual({ wing: 'other', subWing: null });
  });

  it('takes the first H1 outside code fences', () => {
    expect(firstHeading('```\n# not this\n```\n## two\n# Real title #\n')).toBe('Real title');
  });

  it('parses a valid record and keeps extra keys', () => {
    const r = parseRecord(
      'limforia/audit-hall/x.md',
      '---\ntype: audit\ndate: 2026-10-16\nagents: [Paul]\ntags: [a]\nstatus: open\noutcome: strike\n---\n# Audit\n',
    );
    expect(r).toMatchObject({ wing: 'audit-hall', title: 'Audit', headerValid: true });
    expect(r.header.extra).toEqual({ outcome: 'strike' });
  });

  it('reports every header problem', () => {
    const r = parseRecord(
      'intel/x.md',
      '---\ntype: memo\ndate: 2026-13-01\nagents: Paul\nstatus: pending\n---\n',
    );
    expect(r.headerValid).toBe(false);
    expect(r.headerProblems).toEqual(
      expect.arrayContaining([
        'Missing "tags"',
        'Unknown type "memo"',
        'Invalid date "2026-13-01" (expected YYYY-MM-DD)',
        'Unknown status "pending"',
        '"agents" must be a list',
      ]),
    );
    expect(r.title).toBe('x');
  });

  it('flags templates and records without headers', () => {
    expect(parseRecord('limforia/templates/t.md', '# T').isTemplate).toBe(true);
    expect(parseRecord('limforia/chronicles/c.md', '# C').headerProblems).toEqual(['No header']);
  });

  it('finds the subject of an audit log', () => {
    const header = {
      type: 'audit',
      date: null,
      agents: ['Michael', 'Paul'],
      tags: [],
      status: null,
      extra: {},
    };
    expect(auditSubject('- **Agent:** Paul\n', header)).toBe('Paul');
    expect(auditSubject('no agent line', header)).toBeNull();
    expect(auditSubject('no agent line', { ...header, agents: ['Peter'] })).toBe('Peter');
  });
});

describe('events', () => {
  it('parses a valid line and lower-cases the agent', () => {
    expect(
      parseEventLine(
        '{"ts":"2026-10-16T12:00:00.000Z","event":"PreToolUse","agent":"Paul","tool":"Edit","toolUseId":"t1"}',
      ),
    ).toEqual({
      ts: '2026-10-16T12:00:00.000Z',
      event: 'PreToolUse',
      session: null,
      agent: 'paul',
      agentId: null,
      tool: 'Edit',
      toolUseId: 't1',
      source: null,
      reason: null,
      mcpServer: null,
    });
  });

  it('defaults the agent to michael and skips bad lines', () => {
    expect(parseEventLine('{"ts":"2026-10-16T12:00:00Z","event":"Stop"}')?.agent).toBe('michael');
    expect(parseEventLine('not json')).toBeNull();
    expect(parseEventLine('[1]')).toBeNull();
    expect(parseEventLine('{"event":"Stop"}')).toBeNull();
    expect(parseEventLine('{"ts":"yesterday","event":"Stop"}')).toBeNull();
    const parsed = parseEvents('{"ts":"2026-10-16T12:00:00Z","event":"Stop"}\n\nbad\n');
    expect(parsed).toMatchObject({ skippedLines: 1 });
    expect(parsed.events).toHaveLength(1);
  });

  it('keeps a trailing partial line for the next read', () => {
    expect(splitCompleteLines('a\nb\npart')).toEqual({ lines: ['a', 'b'], rest: 'part' });
    expect(splitCompleteLines('part')).toEqual({ lines: [], rest: 'part' });
  });
});

describe('git output', () => {
  it('parses log records, including subjects with separators-like text', () => {
    const hash = 'a'.repeat(40);
    const out = `${hash}\x1f2026-10-16T22:22:00+01:00\x1fCharin\x1ffeat: a | b\x1e\n`;
    expect(LOG_FORMAT).toContain('%H');
    expect(parseGitLog(out)).toEqual([
      {
        hash,
        shortHash: 'aaaaaaa',
        date: '2026-10-16T22:22:00+01:00',
        author: 'Charin',
        subject: 'feat: a | b',
      },
    ]);
    expect(parseGitLog('garbage')).toEqual([]);
  });

  it('counts porcelain entries', () => {
    expect(countPorcelain(' M a\n?? b\n\n')).toBe(2);
    expect(countPorcelain('')).toBe(0);
    // v2 with --branch: the '#' headers are not changes.
    expect(countPorcelain('# branch.oid abc\n# branch.head main\n1 .M N... x\n? y\n')).toBe(2);
  });

  it('reads upstream tracking from porcelain v2 headers', () => {
    expect(parseBranchTracking('# branch.oid abc\n# branch.head main\n')).toEqual({
      upstream: null,
      ahead: null,
    });
    expect(parseBranchTracking('# branch.upstream origin/main\r\n# branch.ab +0 -4\r\n')).toEqual({
      upstream: 'origin/main',
      ahead: 0,
    });
    // An ab line without an upstream line cannot happen; it is ignored rather than trusted.
    expect(parseBranchTracking('# branch.ab +2 -0\n')).toEqual({ upstream: null, ahead: null });
    // A file named like a header is an entry line, not a header.
    expect(parseBranchTracking('? # branch.upstream x\n')).toEqual({ upstream: null, ahead: null });
  });
});
