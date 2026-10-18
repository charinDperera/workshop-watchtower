/**
 * Peter's tests for the pure UI helpers that had no coverage: Luka's archive filter, record
 * HTML fitting and activity page helpers; Luke's stats, labels and the untested parts of
 * format, sigil and live logic.
 */
import { describe, expect, it } from 'vitest';
import type {
  ActivityEvent,
  Agent,
  ArchiveRecord,
  RecordHeader,
  Snapshot,
} from '../../src/shared/types';
import {
  activityQuery,
  EVENT_LABELS,
  matchesActivity,
  parseActivityFilter,
} from '../../src/ui/activity-page';
import {
  archiveQuery,
  compareRecords,
  EMPTY_FILTER,
  filterOptions,
  filterRecords,
  hasFilter,
  isWingId,
  matchesFilter,
  parseArchiveFilter,
  scopeCount,
  withSelected,
} from '../../src/ui/archive-filter';
import {
  agentNameFor,
  agentRefs,
  capitalise,
  eventTone,
  formatClock,
  formatDate,
  formatDateTime,
  parseTime,
  plural,
  relativeTime,
} from '../../src/ui/format';
import { agentHref, NAV, recordHref } from '../../src/ui/labels';
import {
  describeChanges,
  eventKey,
  LIVE_ACTIVITY_CAP,
  mergeEvents,
  backoffDelay,
} from '../../src/ui/live/logic';
import {
  fitRecordHtml,
  joinRecordPath,
  rewriteRecordLinks,
  shiftHeadings,
  wrapScrollRegions,
} from '../../src/ui/record-html';
import { hashName, seeded, sigilFor } from '../../src/ui/sigil';
import { overviewTiles } from '../../src/ui/stats';
import { HOOK_EVENTS } from '../../src/shared/types';

/* ------------------------------------------------------------------ */
/* Factories                                                          */
/* ------------------------------------------------------------------ */

function header(partial: Partial<RecordHeader> = {}): RecordHeader {
  return { type: null, date: null, agents: [], tags: [], status: null, extra: {}, ...partial };
}

function record(
  path: string,
  partial: Partial<Omit<ArchiveRecord, 'header'>> & { header?: Partial<RecordHeader> } = {},
): ArchiveRecord {
  const { header: h, ...rest } = partial;
  return {
    path,
    wing: 'chronicles',
    subWing: null,
    title: path.split('/').pop() ?? path,
    header: header(h),
    hasHeader: true,
    headerValid: true,
    headerProblems: [],
    isTemplate: false,
    inCatalog: true,
    revision: '0000000000000000',
    ...rest,
  };
}

function event(partial: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ts: '2026-10-16T12:00:00.000Z',
    event: 'PreToolUse',
    session: 's1',
    agent: 'luke',
    agentId: null,
    tool: 'Bash',
    toolUseId: null,
    source: null,
    reason: null,
    mcpServer: null,
    ...partial,
  };
}

function agent(partial: Partial<Agent> = {}): Agent {
  return {
    name: 'Paul',
    slug: 'paul',
    title: null,
    rank: 'worker',
    station: 'Build',
    role: 'Backend',
    isMain: false,
    inRoster: true,
    rosterTools: null,
    created: '2026-10-01',
    strikes: 0,
    strikeLimit: 3,
    definition: null,
    status: 'idle',
    activeReason: null,
    currentTool: null,
    lastSeen: null,
    lastEnd: null,
    stage: 'build',
    auditLogs: [],
    pardonedAt: null,
    recentEvents: [],
    ...partial,
  };
}

const RECORDS: ArchiveRecord[] = [
  record('limforia/chronicles/a.md', {
    title: 'Alpha',
    header: {
      type: 'chronicle',
      date: '2026-10-02',
      status: 'closed',
      tags: ['ui'],
      agents: ['Luke'],
    },
  }),
  record('limforia/chronicles/b.md', {
    title: 'Beta',
    header: {
      type: 'chronicle',
      date: '2026-10-03',
      status: 'open',
      tags: ['UI', 'api'],
      agents: ['paul'],
    },
  }),
  record('limforia/audit-hall/c.md', {
    wing: 'audit-hall',
    title: 'Gamma',
    header: { type: 'audit', date: '2026-10-03', status: 'closed', agents: ['Paul'] },
  }),
  record('limforia/vault-of-ideas/d.md', {
    wing: 'vault-of-ideas',
    title: 'Delta',
    hasHeader: false,
    headerValid: false,
  }),
  record('limforia/templates/chronicle.md', {
    wing: 'templates',
    isTemplate: true,
    title: 'Template',
    header: { type: 'chronicle', tags: ['template-tag'] },
  }),
];

/* ------------------------------------------------------------------ */
/* archive-filter (Luka)                                              */
/* ------------------------------------------------------------------ */

describe('archive filter', () => {
  it('parses a full query and trims values', () => {
    const { filter, ignored } = parseArchiveFilter(
      new URLSearchParams('wing=audit-hall&type=+audit+&status=open&tag=ui&agent=Paul'),
    );
    expect(filter).toEqual({
      wing: 'audit-hall',
      type: 'audit',
      status: 'open',
      tag: 'ui',
      agent: 'Paul',
    });
    expect(ignored).toEqual([]);
  });

  it('ignores an unknown wing, prototype keys and over-long values', () => {
    // Wings are discovered: with the archive's wings known, any other name is ignored.
    const known = ['chronicles', 'checkpoints', 'intel'];
    for (const wing of ['nope', '__proto__', 'constructor', 'toString', '../x', 'a b']) {
      const parsed = parseArchiveFilter(new URLSearchParams({ wing }), known);
      expect(parsed.filter.wing).toBeNull();
      expect(parsed.ignored).toEqual([`wing "${wing}"`]);
    }
    expect(isWingId('hasOwnProperty', known)).toBe(false);
    // A new wing works as soon as it exists, with no app change.
    expect(
      parseArchiveFilter(new URLSearchParams({ wing: 'checkpoints' }), known).filter.wing,
    ).toBe('checkpoints');
    // Without the list (no snapshot), only malformed names are refused.
    expect(isWingId('checkpoints')).toBe(true);
    expect(isWingId('__proto__')).toBe(false);
    expect(isWingId('../x')).toBe(false);
    const long = parseArchiveFilter(new URLSearchParams({ tag: 'x'.repeat(101), type: '   ' }));
    expect(long.filter.tag).toBeNull();
    expect(long.filter.type).toBeNull();
    expect(hasFilter(long.filter)).toBe(false);
    expect(
      parseArchiveFilter(new URLSearchParams({ tag: 'x'.repeat(100) })).filter.tag,
    ).toHaveLength(100);
  });

  it('filters case-insensitively and hides templates unless their wing is chosen', () => {
    const titles = (f: Partial<typeof EMPTY_FILTER>) =>
      filterRecords(RECORDS, { ...EMPTY_FILTER, ...f }).map((r) => r.title);
    expect(titles({})).toEqual(['Beta', 'Gamma', 'Alpha', 'Delta']);
    expect(titles({ tag: 'ui' })).toEqual(['Beta', 'Alpha']);
    expect(titles({ agent: 'PAUL' })).toEqual(['Beta', 'Gamma']);
    expect(titles({ type: 'Chronicle', status: 'OPEN' })).toEqual(['Beta']);
    expect(titles({ wing: 'templates' })).toEqual(['Template']);
    expect(titles({ tag: 'template-tag' })).toEqual([]);
    expect(titles({ wing: 'intel' })).toEqual([]);
  });

  it('records without the filtered header field never match', () => {
    const delta = RECORDS[3] as ArchiveRecord;
    for (const key of ['type', 'status', 'tag', 'agent'] as const) {
      expect(matchesFilter(delta, { ...EMPTY_FILTER, [key]: 'x' })).toBe(false);
    }
  });

  it('sorts newest first, then by title, undated last', () => {
    const sorted = [...RECORDS].filter((r) => !r.isTemplate).sort(compareRecords);
    expect(sorted.map((r) => r.title)).toEqual(['Beta', 'Gamma', 'Alpha', 'Delta']);
  });

  it('counts the scope without templates (or only templates)', () => {
    expect(scopeCount(RECORDS, EMPTY_FILTER)).toBe(4);
    expect(scopeCount(RECORDS, { ...EMPTY_FILTER, wing: 'templates' })).toBe(1);
  });

  it('tallies options case-insensitively, in contract order, ignoring templates', () => {
    const options = filterOptions(RECORDS);
    expect(options.type).toEqual([
      { value: 'chronicle', count: 2 },
      { value: 'audit', count: 1 },
    ]);
    expect(options.status).toEqual([
      { value: 'open', count: 1 },
      { value: 'closed', count: 2 },
    ]);
    expect(options.tag).toEqual([
      { value: 'api', count: 1 },
      { value: 'ui', count: 2 },
    ]);
    expect(options.agent).toEqual([
      { value: 'luke', count: 1 },
      { value: 'paul', count: 2 },
    ]);
  });

  it('keeps a selected value that is gone from the archive', () => {
    const opts = [{ value: 'ui', count: 2 }];
    expect(withSelected(opts, null)).toBe(opts);
    expect(withSelected(opts, 'UI')).toBe(opts);
    expect(withSelected(opts, 'gone')).toEqual([{ value: 'gone', count: 0 }, ...opts]);
  });

  it('builds queries that drop empty values and encode the rest', () => {
    expect(archiveQuery(EMPTY_FILTER)).toBe('');
    expect(
      archiveQuery({ ...EMPTY_FILTER, tag: 'a b&c' }, { record: 'intel/x.md', empty: '' }),
    ).toBe('?tag=a+b%26c&record=intel%2Fx.md');
  });
});

/* ------------------------------------------------------------------ */
/* record-html (Luka)                                                 */
/* ------------------------------------------------------------------ */

describe('record html fitting', () => {
  it('shifts headings and caps them at h6, keeping attributes', () => {
    expect(shiftHeadings('<h1>a</h1><h5 id="x">b</h5><h6>c</h6>', 2)).toBe(
      '<h3>a</h3><h6 id="x">b</h6><h6>c</h6>',
    );
    expect(shiftHeadings('<h1>a</h1>', 0)).toBe('<h1>a</h1>');
    expect(shiftHeadings('<h1>a</h1>', -1)).toBe('<h1>a</h1>');
    expect(shiftHeadings('<header>x</header><hr>', 1)).toBe('<header>x</header><hr>');
  });

  it('wraps tables and code blocks as focusable regions', () => {
    const html = wrapScrollRegions('<table><tr><td>1</td></tr></table><pre><code>x</code></pre>');
    expect(html).toContain(
      'role="region" tabindex="0" aria-label="Table, scrolls sideways">\n<table>',
    );
    expect(html).toContain('</table>\n</div>');
    expect(html).toContain('<pre tabindex="0">');
  });

  it('joins relative record paths and refuses to leave the workstation', () => {
    expect(joinRecordPath('limforia/chronicles/a.md', 'b.md')).toBe('limforia/chronicles/b.md');
    expect(joinRecordPath('limforia/chronicles/a.md', '../audit-hall/c.md')).toBe(
      'limforia/audit-hall/c.md',
    );
    expect(joinRecordPath('limforia/chronicles/a.md', './x/../y.md')).toBe(
      'limforia/chronicles/y.md',
    );
    expect(joinRecordPath('limforia/a.md', '../../x.md')).toBeNull();
    expect(joinRecordPath('CLAUDE.md', 'limforia/CATALOG.md')).toBe('limforia/CATALOG.md');
    expect(joinRecordPath('limforia/a.md', '..')).toBeNull();
  });

  it('rewrites only relative .md links into viewer links', () => {
    const from = 'limforia/CATALOG.md';
    const html =
      '<a href="chronicles/a.md#part">a</a> <a href="https://x.test/a.md">b</a> ' +
      '<a href="/limforia">c</a> <a href="#top">d</a> <a href="mailto:a@b.test">e</a> ' +
      '<a href="notes.txt">f</a> <a href="bad%zz.md">g</a> <a href="a%20b.md">h</a>';
    const out = rewriteRecordLinks(html, from);
    expect(out).toContain(`<a href="${recordHref('limforia/chronicles/a.md')}"`);
    expect(out).toContain('<a href="https://x.test/a.md"');
    expect(out).toContain('<a href="/limforia"');
    expect(out).toContain('<a href="#top"');
    expect(out).toContain('<a href="mailto:a@b.test"');
    expect(out).toContain('<a href="notes.txt"');
    expect(out).toContain('<a href="bad%zz.md"');
    expect(out).toContain(`<a href="${recordHref('limforia/a b.md')}"`);
  });

  it('fits a record: drops the leading h1, shifts, rewrites and wraps', () => {
    const out = fitRecordHtml(
      '<h1>Title</h1>\n<h2>Part</h2><p><a href="x.md">x</a></p><table></table>',
      {
        path: 'intel/r.md',
      },
    );
    expect(out).not.toContain('Title');
    expect(out).toContain('<h3>Part</h3>');
    expect(out).toContain(recordHref('intel/x.md'));
    expect(out).toContain('class="prose-scroll"');
    const kept = fitRecordHtml('<h1>Title</h1>', {
      path: 'intel/r.md',
      dropTitle: false,
      shift: 0,
    });
    expect(kept).toBe('<h1>Title</h1>');
  });
});

/* ------------------------------------------------------------------ */
/* activity-page (Luka)                                               */
/* ------------------------------------------------------------------ */

describe('activity page helpers', () => {
  it('labels every hook event', () => {
    for (const name of HOOK_EVENTS) expect(EVENT_LABELS[name]).toBeTruthy();
  });

  it('parses a valid filter, lower-casing the agent', () => {
    expect(
      parseActivityFilter(
        new URLSearchParams('agent=Paul&event=PreToolUse&before=2026-10-01T12:00:00.000Z'),
      ),
    ).toEqual({
      filter: { agent: 'paul', event: 'PreToolUse', before: '2026-10-01T12:00:00.000Z' },
      ignored: [],
    });
  });

  it('ignores bad, repeated and blank values instead of applying them', () => {
    const parsed = parseActivityFilter(
      new URLSearchParams('agent=../x&event=Nope&before=2026-02-31T00:00:00Z'),
    );
    expect(parsed.filter).toEqual({ agent: null, event: null, before: null });
    expect(parsed.ignored).toEqual(['agent', 'event', 'before']);

    const repeated = parseActivityFilter(
      new URLSearchParams('agent=a&agent=b&event=Stop&event=Stop'),
    );
    expect(repeated.filter.agent).toBeNull();
    expect(repeated.filter.event).toBeNull();
    expect(repeated.ignored).toEqual(['agent', 'event']);

    const blank = parseActivityFilter(new URLSearchParams('agent=&event=%20&before='));
    expect(blank).toEqual({ filter: { agent: null, event: null, before: null }, ignored: [] });

    expect(parseActivityFilter(new URLSearchParams('before=2026-10-01T12:00:00')).ignored).toEqual([
      'before',
    ]);
  });

  it('matches by agent and event', () => {
    const e = event({ agent: 'paul', event: 'Stop' });
    expect(matchesActivity(e, { agent: null, event: null })).toBe(true);
    expect(matchesActivity(e, { agent: 'paul', event: 'Stop' })).toBe(true);
    expect(matchesActivity(e, { agent: 'luke', event: null })).toBe(false);
    expect(matchesActivity(e, { agent: null, event: 'PreToolUse' })).toBe(false);
  });

  it('builds the query the API accepts', () => {
    expect(activityQuery({})).toBe('');
    expect(
      activityQuery({
        agent: 'paul',
        event: 'Stop',
        before: '2026-10-01T12:00:00.000Z',
        limit: 50,
      }),
    ).toBe('?agent=paul&event=Stop&before=2026-10-01T12%3A00%3A00.000Z&limit=50');
  });
});

/* ------------------------------------------------------------------ */
/* format (Luke): the parts the existing tests skip                   */
/* ------------------------------------------------------------------ */

describe('format, untested parts', () => {
  const NOW = Date.parse('2026-10-16T12:00:00.000Z');

  it('parses times defensively', () => {
    expect(parseTime(undefined)).toBeNull();
    expect(parseTime('not a date')).toBeNull();
    expect(parseTime('2026-10-16T12:00:00.000Z')).toBe(NOW);
  });

  it('switches relative time to a date after 30 days and handles invalid input', () => {
    expect(relativeTime('2026-09-01T12:00:00.000Z', NOW)).toBe('1 Sept 2026');
    expect(relativeTime('garbage', NOW)).toBe('never');
    expect(relativeTime('2026-10-16T11:59:15.000Z', NOW)).toBe('1 min ago');
    expect(relativeTime('2026-10-16T11:00:00.000Z', NOW)).toBe('1 h ago');
  });

  it('formats dates, clocks and date-times with fallbacks', () => {
    expect(formatDate(null)).toBe('unknown');
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatClock(null)).toBe('--:--:--');
    expect(formatClock('2026-10-16T12:00:00.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatDateTime(undefined)).toBe('unknown time');
    expect(formatDateTime('2026-10-16T12:00:00.000Z')).toMatch(/2026/);
  });

  it('gives tones by event kind', () => {
    expect(eventTone(event({ event: 'PostToolUseFailure' }))).toBe('fail');
    expect(eventTone(event({ event: 'StopFailure' }))).toBe('fail');
    expect(eventTone(event({ event: 'SubagentStart' }))).toBe('active');
    expect(eventTone(event({ event: 'UserPromptSubmit' }))).toBe('active');
    expect(eventTone(event({ event: 'SessionStart' }))).toBe('info');
    expect(eventTone(event({ event: 'SessionEnd' }))).toBe('info');
    expect(eventTone(event({ event: 'PreToolUse' }))).toBe('neutral');
  });

  it('has small text helpers', () => {
    expect(capitalise('')).toBe('');
    expect(capitalise('paul')).toBe('Paul');
    expect(plural(0, 'record')).toBe('0 records');
    expect(plural(1, 'record')).toBe('1 record');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
    expect(agentNameFor('x', new Map([['paul', 'Paul']]))).toBe('x');
    expect(agentNameFor('paul', new Map([['paul', 'Paul']]))).toBe('Paul');
    expect(agentRefs([agent()])).toEqual([{ slug: 'paul', name: 'Paul', status: 'idle' }]);
  });
});

/* ------------------------------------------------------------------ */
/* labels and sigil (Luke)                                            */
/* ------------------------------------------------------------------ */

describe('labels', () => {
  it('encodes record and agent links', () => {
    expect(recordHref('limforia/a b&c.md')).toBe('/limforia?record=limforia%2Fa%20b%26c.md');
    expect(agentHref('a/b?c')).toBe('/host/a%2Fb%3Fc');
  });

  it('marks the current section in the nav', () => {
    const current = (path: string) => NAV.filter((n) => n.match(path)).map((n) => n.label);
    expect(current('/')).toEqual(['Overview']);
    // The /host section is labelled "The Council" (Luke's rename, after the roster's wording).
    expect(current('/host/paul')).toEqual(['The Council']);
    expect(current('/hostile')).toEqual([]);
    expect(current('/limforia')).toEqual(['Limforia']);
  });
});

describe('sigil, untested parts', () => {
  it('seeded streams are deterministic and in [0, 1)', () => {
    const a = seeded(42);
    const b = seeded(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(hashName('')).toBe(0x811c9dc5);
  });

  it('draws one closed path per sub-polygon and stays inside the box', () => {
    for (const name of ['Michael', 'Uriel', 'Azazel', 'Gabriel', 'x', '名前', 'a'.repeat(300)]) {
      const g = sigilFor(name);
      const closed = g.star.match(/Z/g)?.length ?? 0;
      expect(closed).toBeGreaterThanOrEqual(1);
      expect(g.star.split('M').length - 1).toBe(closed);
      const numbers = g.star.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      for (const n of numbers) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(64);
      }
      expect([8, 12, 16, 24]).toContain(g.marks.length);
      expect([null, '2 2', '4 2', '1 3']).toContain(g.ringDash);
    }
    expect(sigilFor('  ').initial).toBe('?');
    expect(sigilFor('ñame').initial).toBe('Ñ');
  });
});

/* ------------------------------------------------------------------ */
/* live logic (Luke): the parts the existing tests skip                */
/* ------------------------------------------------------------------ */

describe('live logic, untested parts', () => {
  it('keys events on every identifying field', () => {
    const a = event({ agentId: 'x' });
    expect(eventKey(a)).not.toBe(eventKey(event({ agentId: 'y' })));
    expect(eventKey(a)).toBe(eventKey({ ...a }));
    expect(eventKey(event({ session: null }))).not.toBe(eventKey(event()));
  });

  it('caps the merge at the snapshot limit by default', () => {
    const many = Array.from({ length: LIVE_ACTIVITY_CAP + 10 }, (_, i) =>
      event({ ts: new Date(Date.UTC(2026, 9, 16, 0, 0, i)).toISOString() }),
    );
    const merged = mergeEvents(many, []);
    expect(merged).toHaveLength(LIVE_ACTIVITY_CAP);
    expect(merged[0]?.ts).toBe(many[many.length - 1]?.ts);
  });

  it('treats a negative attempt as the first', () => {
    expect(backoffDelay(-5, () => 1)).toBe(backoffDelay(0, () => 1));
  });

  it('announces joins, departures and new retirements', () => {
    const base = {
      agents: [agent()],
      compliance: { checks: [] },
      git: { workstation: { commits: [] } },
      records: [],
      retired: [],
    } as unknown as Snapshot;
    const next = {
      ...base,
      agents: [agent({ slug: 'luka', name: 'Luka' })],
      retired: [{ name: 'Paul' }],
    } as unknown as Snapshot;
    expect(describeChanges(base, next)).toEqual([
      'Luka joined the host',
      'Paul left the roster',
      '1 agent bound into the Soul Binder',
    ]);
  });

  it('does not announce a strike count that became unknown', () => {
    const base = {
      agents: [agent({ strikes: 1 })],
      compliance: { checks: [] },
      git: { workstation: { commits: [] } },
      records: [],
      retired: [],
    } as unknown as Snapshot;
    expect(describeChanges(base, { ...base, agents: [agent({ strikes: null })] })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* stats (Luke)                                                       */
/* ------------------------------------------------------------------ */

describe('overview tiles', () => {
  function snapshot(partial: Partial<Snapshot> = {}): Snapshot {
    return {
      agents: [],
      records: [],
      wings: [],
      compliance: { checks: [], pass: 0, warn: 0, fail: 0 },
      git: {
        workstation: {
          path: '.',
          isRepo: true,
          branch: 'main',
          commits: [],
          dirty: 0,
          ahead: null,
          upstream: null,
          error: null,
        },
      },
      ...partial,
    } as unknown as Snapshot;
  }
  const tile = (s: Snapshot, id: string) => overviewTiles(s).find((t) => t.id === id);

  it('is quiet and clean for an empty workstation', () => {
    const s = snapshot();
    expect(overviewTiles(s).map((t) => t.id)).toEqual([
      'active',
      'strikes',
      'records',
      'laws',
      'tree',
    ]);
    expect(tile(s, 'active')).toMatchObject({ value: '0 / 0', hint: 'All quiet', tone: 'neutral' });
    expect(tile(s, 'strikes')).toMatchObject({ value: 0, hint: 'A clean record', tone: 'neutral' });
    expect(tile(s, 'laws')).toMatchObject({
      value: '0 / 0',
      hint: 'Every check passes',
      tone: 'active',
    });
    expect(tile(s, 'tree')).toMatchObject({ value: 'Clean', hint: 'On main', tone: 'active' });
  });

  it('counts active agents and strikes, ignoring the retired', () => {
    const s = snapshot({
      agents: [
        agent({ name: 'Paul', status: 'active', strikes: 1 }),
        agent({ name: 'Thomas', slug: 'thomas', strikes: 3 }),
        agent({ name: 'Azazel', slug: 'azazel', status: 'retired', strikes: 2 }),
      ],
    });
    expect(tile(s, 'active')).toMatchObject({ value: '1 / 2', hint: 'Paul', tone: 'active' });
    expect(tile(s, 'strikes')).toMatchObject({ value: 4, hint: 'On Paul, Thomas', tone: 'fail' });
    const warn = snapshot({ agents: [agent({ strikes: 2 })] });
    expect(tile(warn, 'strikes')?.tone).toBe('warn');
  });

  it('counts records and wings in use without templates', () => {
    const s = snapshot({
      records: RECORDS,
      wings: [
        { id: 'chronicles', title: 'Chronicles', description: 'd', count: 2, subWings: {} },
        { id: 'templates', title: 'Templates', description: 'd', count: 1, subWings: {} },
        { id: 'intel', title: 'Intel', description: 'd', count: 0, subWings: {} },
      ],
    });
    expect(tile(s, 'records')).toMatchObject({ value: 4, hint: 'Across 1 wing' });
  });

  it('reports failing and warning laws', () => {
    const fail = snapshot({ compliance: { checks: [{}, {}] as never, pass: 0, warn: 1, fail: 1 } });
    expect(tile(fail, 'laws')).toMatchObject({ value: '0 / 2', hint: '1 failure', tone: 'fail' });
    const warn = snapshot({ compliance: { checks: [{}] as never, pass: 0, warn: 1, fail: 0 } });
    expect(tile(warn, 'laws')).toMatchObject({ hint: '1 warning', tone: 'warn' });
  });

  it('describes a dirty, detached, broken or missing repo', () => {
    const base = snapshot().git.workstation;
    const dirty = snapshot({ git: { workstation: { ...base, dirty: 3, branch: null } } });
    expect(tile(dirty, 'tree')).toMatchObject({
      value: 3,
      hint: '3 changes on a detached head',
      tone: 'warn',
    });
    const none = snapshot({ git: { workstation: { ...base, isRepo: false } } });
    expect(tile(none, 'tree')).toMatchObject({
      value: null,
      hint: 'Not a git repository',
      tone: 'fail',
    });
    const broken = snapshot({ git: { workstation: { ...base, error: 'timeout' } } });
    expect(tile(broken, 'tree')?.tone).toBe('fail');
  });
});
