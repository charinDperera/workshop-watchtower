import { describe, expect, it } from 'vitest';
import type {
  ActivityEvent,
  AgentDefinition,
  AgentRank,
  RepoState,
  RosterEntry,
} from '../../src/shared/types';
import { deriveLiveStates } from '../../src/server/services/activity';
import { ACTIVE_SILENCE_MS, LOGGER_MAIN_AGENT } from '../../src/server/constants';
import {
  derivePipeline,
  findMainSlug,
  joinAgents,
  nextExpiry,
  stationId,
  type AgentJoinInput,
} from '../../src/server/services/agents';
import {
  AUDIT_OUTCOMES,
  countWings,
  discoverWings,
  indexAuditLogs,
  isPardonLog,
  isStrikeLog,
  pardonedSlugs,
} from '../../src/server/services/archive';
import {
  checkCatalogCoverage,
  checkCleanTree,
  checkRecordHeaders,
  checkRosterDefinitions,
  checkStrikeCounts,
  checkThreeStrikes,
  checkUniqueNames,
  runComplianceChecks,
  type ComplianceInput,
} from '../../src/server/services/compliance';
import { parseRecord } from '../../src/server/sources/parse/record';

const T0 = Date.parse('2026-10-16T12:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

function ev(
  partial: Partial<ActivityEvent> & Pick<ActivityEvent, 'event'>,
  s: number,
): ActivityEvent {
  return {
    ts: at(s),
    session: 's1',
    agent: 'michael',
    agentId: null,
    tool: null,
    toolUseId: null,
    source: null,
    reason: null,
    mcpServer: null,
    ...partial,
  };
}

const sub = { agent: 'paul', agentId: 'agent-1' };
const MIN = 60_000;

describe('live state', () => {
  it('a subagent is active between SubagentStart and SubagentStop, then completed', () => {
    const start = [ev({ event: 'SubagentStart', ...sub }, 0)];
    expect(deriveLiveStates(start, T0 + MIN).get('paul')).toMatchObject({
      active: true,
      reason: 'open-session',
      lastEnd: null,
      expiresAt: T0 + ACTIVE_SILENCE_MS,
    });
    const stopped = [...start, ev({ event: 'SubagentStop', ...sub }, 1)];
    expect(deriveLiveStates(stopped, T0 + MIN).get('paul')).toMatchObject({
      active: false,
      reason: null,
      lastEnd: { at: at(1), outcome: 'completed' },
      expiresAt: null,
    });
  });

  it('is active only while heard from within 5 minutes; past that the run is abandoned', () => {
    expect(ACTIVE_SILENCE_MS).toBe(300_000);
    const events = [
      ev({ event: 'SubagentStart', ...sub }, 0),
      ev({ event: 'PreToolUse', ...sub, tool: 'Bash', toolUseId: 't' }, 200),
    ];
    // Each event keeps the run alive: 4m59s after the last one it is still active.
    expect(deriveLiveStates(events, T0 + 200_000 + 299_000).get('paul')).toMatchObject({
      active: true,
      currentTool: 'Bash',
      expiresAt: T0 + 200_000 + ACTIVE_SILENCE_MS,
    });
    // 5m01s of silence (a usage limit killed it): idle, abandoned as of its last event.
    expect(deriveLiveStates(events, T0 + 200_000 + 301_000).get('paul')).toMatchObject({
      active: false,
      currentTool: null,
      lastEnd: { at: at(200), outcome: 'abandoned' },
      expiresAt: null,
    });
  });

  it('closes a subagent on Stop or StopFailure that carries its agentId (real shapes)', () => {
    const start = ev({ event: 'SubagentStart', agent: 'paul', agentId: 'aad6de0080dfb57c4' }, 0);
    // {"event":"StopFailure","agent":"paul","agentId":"aad6…"}
    const failed = ev({ event: 'StopFailure', agent: 'paul', agentId: 'aad6de0080dfb57c4' }, 5);
    const turn = ev({ event: 'UserPromptSubmit' }, 1);
    const states = deriveLiveStates([turn, start, failed], T0 + MIN);
    expect(states.get('paul')).toMatchObject({
      active: false,
      lastEnd: { at: at(5), outcome: 'failed' },
    });
    // The subagent's stop does not end the main agent's turn.
    expect(states.get('michael')).toMatchObject({ active: true, lastEnd: null });

    const completed = ev({ event: 'Stop', agent: 'paul', agentId: 'aad6de0080dfb57c4' }, 5);
    expect(deriveLiveStates([start, completed], T0 + MIN).get('paul')?.lastEnd).toEqual({
      at: at(5),
      outcome: 'completed',
    });
  });

  it('closes the main turn on StopFailure without an agentId (real shape), as failed', () => {
    // {"event":"StopFailure","agent":"michael"}
    const events = [
      ev({ event: 'UserPromptSubmit' }, 0),
      ev({ event: 'SubagentStart', ...sub }, 1),
      ev({ event: 'StopFailure' }, 2),
    ];
    const states = deriveLiveStates(events, T0 + MIN);
    expect(states.get('michael')).toMatchObject({
      active: false,
      lastEnd: { at: at(2), outcome: 'failed' },
    });
    // The subagent's own run is not touched by the main agent's stop.
    expect(states.get('paul')?.active).toBe(true);
  });

  it('parallel instances of one agent are tracked by agentId', () => {
    const events = [
      ev({ event: 'SubagentStart', agent: 'paul', agentId: 'a' }, 0),
      ev({ event: 'SubagentStart', agent: 'paul', agentId: 'b' }, 1),
      ev({ event: 'SubagentStop', agent: 'paul', agentId: 'a' }, 2),
    ];
    expect(deriveLiveStates(events, T0 + MIN).get('paul')?.active).toBe(true);
  });

  it('the main agent is active during a turn, not merely because a session is open', () => {
    const idle = deriveLiveStates([ev({ event: 'SessionStart' }, 0)], T0 + MIN);
    expect(idle.get('michael')?.active).toBe(false);
    const turn = [ev({ event: 'UserPromptSubmit' }, 0)];
    expect(deriveLiveStates(turn, T0 + MIN).get('michael')?.active).toBe(true);
    const done = deriveLiveStates([...turn, ev({ event: 'Stop' }, 1)], T0 + MIN);
    expect(done.get('michael')).toMatchObject({
      active: false,
      lastEnd: { at: at(1), outcome: 'completed' },
    });
  });

  it('SessionEnd abandons everything still open in that session', () => {
    const events = [
      ev({ event: 'UserPromptSubmit' }, 0),
      ev({ event: 'SubagentStart', ...sub }, 1),
      ev({ event: 'PreToolUse', ...sub, tool: 'Bash', toolUseId: 't' }, 2),
      ev({ event: 'SessionEnd', reason: 'other' }, 3),
    ];
    const states = deriveLiveStates(events, T0 + MIN);
    expect(states.get('michael')).toMatchObject({
      active: false,
      lastEnd: { at: at(3), outcome: 'abandoned' },
    });
    expect(states.get('paul')).toMatchObject({
      active: false,
      currentTool: null,
      lastEnd: { at: at(3), outcome: 'abandoned' },
    });
  });

  it('tool use without an open run does not make an agent active', () => {
    const events = [
      ev({ event: 'PreToolUse', ...sub, tool: 'Read', toolUseId: 't' }, 0),
      ev({ event: 'PostToolUse', ...sub, tool: 'Read', toolUseId: 't' }, 1),
    ];
    expect(deriveLiveStates(events, T0 + 30_000).get('paul')).toMatchObject({
      active: false,
      reason: null,
      lastSeen: at(1),
      lastEnd: null,
    });
  });

  it('reports the earliest silence mark across agents, so the rebuild timer fires there', () => {
    const events = [
      ev({ event: 'SubagentStart', ...sub }, 0),
      ev({ event: 'SubagentStart', agent: 'peter', agentId: 'p' }, 100),
      ev({ event: 'PreToolUse', ...sub, tool: 'Read', toolUseId: 't' }, 150),
    ];
    const live = deriveLiveStates(events, T0 + 200_000);
    expect(nextExpiry(live)).toBe(T0 + 100_000 + ACTIVE_SILENCE_MS);
    // Once the first goes silent, the next mark is the other agent's.
    const later = deriveLiveStates(events, T0 + 410_000);
    expect(nextExpiry(later)).toBe(T0 + 150_000 + ACTIVE_SILENCE_MS);
  });

  it('keeps the latest end: a later abandonment replaces an earlier completion', () => {
    const events = [
      ev({ event: 'SubagentStart', agent: 'paul', agentId: 'a' }, 0),
      ev({ event: 'SubagentStop', agent: 'paul', agentId: 'a' }, 1),
      ev({ event: 'SubagentStart', agent: 'paul', agentId: 'b' }, 10),
    ];
    expect(deriveLiveStates(events, T0 + 20 * MIN).get('paul')?.lastEnd).toEqual({
      at: at(10),
      outcome: 'abandoned',
    });
  });

  it('follows the main agent named by the roster', () => {
    const events = [ev({ event: 'UserPromptSubmit', agent: 'gabriel' }, 0)];
    expect(deriveLiveStates(events, T0 + MIN, 'gabriel').get('gabriel')?.active).toBe(true);
    expect(deriveLiveStates(events, T0 + MIN).get('gabriel')?.active).toBe(false);
  });

  it('current tool follows tool use ids, and a failure clears it', () => {
    const base = [
      ev({ event: 'SubagentStart', ...sub }, 0),
      ev({ event: 'PreToolUse', ...sub, tool: 'Read', toolUseId: 'r' }, 1),
      ev({ event: 'PreToolUse', ...sub, tool: 'Grep', toolUseId: 'g' }, 2),
      ev({ event: 'PostToolUse', ...sub, tool: 'Grep', toolUseId: 'g' }, 3),
    ];
    expect(deriveLiveStates(base, T0 + 5_000).get('paul')?.currentTool).toBe('Read');
    const failed = [
      ...base,
      ev({ event: 'PostToolUseFailure', ...sub, tool: 'Read', toolUseId: 'r' }, 4),
    ];
    expect(deriveLiveStates(failed, T0 + 5_000).get('paul')?.currentTool).toBeNull();
  });

  it('pairs tool ends by name when ids are missing', () => {
    const events = [
      ev({ event: 'SubagentStart', ...sub }, 0),
      ev({ event: 'PreToolUse', ...sub, tool: 'Edit' }, 1),
      ev({ event: 'PostToolUse', ...sub, tool: 'Edit' }, 2),
    ];
    expect(deriveLiveStates(events, T0 + 5_000).get('paul')?.currentTool).toBeNull();
  });

  it('orders events by time, not file order', () => {
    const events = [
      ev({ event: 'SubagentStop', ...sub }, 2),
      ev({ event: 'SubagentStart', ...sub }, 1),
    ];
    expect(deriveLiveStates(events, T0 + MIN).get('paul')?.active).toBe(false);
  });
});

type RosterRow = [string, string, number | null, AgentRank?, (string | null)?, (string | null)?];

/** `[name, role, strikes, rank?, station?, title?]`; rank defaults like a legacy roster. */
const roster = (rows: RosterRow[]): RosterEntry[] =>
  rows.map(([name, role, strikes, rank, station, title]) => ({
    name,
    title: title ?? null,
    rank: rank ?? (/^main agent\b/i.test(role) ? 'overseer' : 'worker'),
    station: station ?? null,
    role,
    tools: 'Read',
    created: '2026-10-16',
    strikes,
    strikeLimit: 3,
  }));

const def = (name: string, problems: string[] = []): AgentDefinition => ({
  file: `.claude/agents/${name}.md`,
  name,
  description: `${name}.`,
  tools: ['Read'],
  skills: [],
  model: null,
  problems,
});

describe('agents and pipeline', () => {
  const host = roster([
    ['Michael', 'Leads', 0, 'overseer', null, 'Prince of the Host'],
    ['Uriel', 'Research', 0, 'counsel'],
    ['Joseph', 'Data', 0, 'worker', 'Data'],
    ['Paul', 'Backend', 0, 'worker', 'Build'],
    ['Luka', 'Images', 0, 'worker', 'Design'],
    ['Peter', 'Tester', 0, 'worker', 'Test'],
    // A station that appears again later joins its first stage (case and spaces ignored).
    ['Luke', 'Interface', 0, 'worker', '  build '],
  ]);
  const join = (live = new Map(), extra: Partial<AgentJoinInput> = {}) =>
    joinAgents({
      roster: host,
      definitions: [],
      retired: [],
      live,
      auditLogs: new Map(),
      recentEvents: new Map(),
      ...extra,
    });

  it('finds the main agent by rank, not by name', () => {
    expect(findMainSlug(host)).toBe('michael');
    expect(findMainSlug(roster([['Gabriel', 'Anything', 0, 'overseer']]))).toBe('gabriel');
    // No overseer: the hook logger's own main-agent value.
    expect(findMainSlug(roster([['Paul', 'Backend', 0]]))).toBe(LOGGER_MAIN_AGENT);
    expect(findMainSlug([])).toBe(LOGGER_MAIN_AGENT);
  });

  it('slugs stations', () => {
    expect(stationId('Build')).toBe('build');
    expect(stationId('  Data Ops ')).toBe('data-ops');
    expect(stationId('R&D')).toBe('r-d');
    expect(stationId('—')).toBeNull();
    expect(stationId(null)).toBeNull();
    expect(stationId(' -- ')).toBeNull();
  });

  it('joins roster and definitions, keeping orphans and marking the retired', () => {
    const live = deriveLiveStates([ev({ event: 'SubagentStart', ...sub }, 0)], T0 + 1000);
    const agents = joinAgents({
      roster: host,
      definitions: [def('paul'), def('peter'), def('raphiel')],
      retired: [
        { name: 'Peter', role: '', served: '', cause: '', auditLog: '', auditLogPath: null },
      ],
      live,
      auditLogs: new Map([['paul', ['limforia/audit-hall/a.md']]]),
      recentEvents: new Map([['paul', [ev({ event: 'SubagentStart', ...sub }, 0)]]]),
    });
    expect(agents.map((a) => [a.slug, a.status, a.inRoster])).toEqual([
      ['michael', 'idle', true],
      ['uriel', 'idle', true],
      ['joseph', 'idle', true],
      ['paul', 'active', true],
      ['luka', 'idle', true],
      ['peter', 'retired', true],
      ['luke', 'idle', true],
      ['raphiel', 'idle', false],
    ]);
    const bySlug = (slug: string) => agents.find((a) => a.slug === slug);
    expect(bySlug('michael')).toMatchObject({
      isMain: true,
      rank: 'overseer',
      title: 'Prince of the Host',
      station: null,
      stage: null,
      definition: null,
    });
    expect(bySlug('uriel')).toMatchObject({ isMain: false, rank: 'counsel', stage: null });
    expect(bySlug('paul')).toMatchObject({
      rank: 'worker',
      station: 'Build',
      stage: 'build',
      title: null,
      lastEnd: null,
      auditLogs: ['limforia/audit-hall/a.md'],
    });
    expect(bySlug('paul')?.recentEvents.map((e) => e.event)).toEqual(['SubagentStart']);
    expect(bySlug('michael')?.recentEvents).toEqual([]);
    // A definition with no roster row: a worker with no station, outside the pipeline.
    expect(bySlug('raphiel')).toMatchObject({
      name: 'Raphiel',
      rank: 'worker',
      title: null,
      station: null,
      stage: null,
    });
  });

  it('carries how the last run ended', () => {
    const live = deriveLiveStates(
      [ev({ event: 'SubagentStart', ...sub }, 0), ev({ event: 'StopFailure', ...sub }, 4)],
      T0 + 10_000,
    );
    expect(join(live).find((a) => a.slug === 'paul')).toMatchObject({
      status: 'idle',
      lastEnd: { at: at(4), outcome: 'failed' },
    });
  });

  it('builds the stages from worker stations, in the order they first appear', () => {
    const live = deriveLiveStates(
      [ev({ event: 'SubagentStart', agent: 'peter', agentId: 'x' }, 0)],
      T0 + 1000,
    );
    const pipeline = derivePipeline(join(live));
    expect(pipeline).toEqual([
      { id: 'data', title: 'Data', agents: ['joseph'], lit: false, activeAgents: [] },
      { id: 'build', title: 'Build', agents: ['paul', 'luke'], lit: false, activeAgents: [] },
      { id: 'design', title: 'Design', agents: ['luka'], lit: false, activeAgents: [] },
      { id: 'test', title: 'Test', agents: ['peter'], lit: true, activeAgents: ['peter'] },
    ]);
    // Overseer and counsel are not in the pipeline.
    expect(pipeline.flatMap((s) => s.agents)).not.toContain('michael');
    expect(pipeline.flatMap((s) => s.agents)).not.toContain('uriel');
  });

  it('has no stages when no worker has a station (legacy roster)', () => {
    const legacy = roster([
      ['Michael', 'Main agent: leads', 0],
      ['Paul', 'Backend', 0],
    ]);
    const agents = joinAgents({
      roster: legacy,
      definitions: [],
      retired: [],
      live: new Map(),
      auditLogs: new Map(),
      recentEvents: new Map(),
    });
    expect(derivePipeline(agents)).toEqual([]);
    expect(agents[0]).toMatchObject({ isMain: true, rank: 'overseer' });
  });
});

describe('archive', () => {
  it('counts every wing, including empty ones and sub-wings', () => {
    const records = [
      parseRecord('limforia/scriptorium/decisions/a.md', ''),
      parseRecord('limforia/scriptorium/issues/b.md', ''),
      parseRecord('intel/c.md', ''),
    ];
    const wings = countWings(
      records,
      discoverWings(['scriptorium', 'chronicles', 'logs'], new Map([['scriptorium', 'Docs']])),
    );
    expect(wings.map((w) => w.id)).toEqual(['scriptorium', 'chronicles', 'intel']);
    expect(wings.find((w) => w.id === 'scriptorium')).toEqual({
      id: 'scriptorium',
      title: 'Scriptorium',
      description: 'Docs',
      count: 2,
      subWings: { decisions: 1, issues: 1 },
    });
    expect(wings.find((w) => w.id === 'chronicles')?.count).toBe(0);
    expect(wings.find((w) => w.id === 'intel')?.count).toBe(1);
  });

  it('counts strike and executed logs, not dismissed ones', () => {
    const header = { type: 'audit', date: null, agents: [], tags: [], status: null, extra: {} };
    expect(isStrikeLog({ ...header, extra: { outcome: 'strike' } })).toBe(true);
    expect(isStrikeLog({ ...header, extra: { outcome: 'executed' } })).toBe(true);
    expect(isStrikeLog({ ...header, extra: { outcome: 'dismissed' } })).toBe(false);
    const record = parseRecord('limforia/audit-hall/a.md', '---\noutcome: dismissed\n---\n');
    const index = indexAuditLogs([
      { record, subject: 'Paul' },
      { record: parseRecord('limforia/audit-hall/b.md', ''), subject: null },
    ]);
    expect(index.bySubject.get('paul')).toEqual(['limforia/audit-hall/a.md']);
    expect(index.strikes.get('paul')).toBeUndefined();
    expect(index.unattributed).toEqual(['limforia/audit-hall/b.md']);
  });
});

describe('building-stage notes (outcome: note)', () => {
  // The header of limforia/audit-hall/2026-10-18-luke-premature-webkit-claim.md.
  const note = parseRecord(
    'limforia/audit-hall/2026-10-18-luke-premature-webkit-claim.md',
    [
      '---',
      'type: audit',
      'date: 2026-10-18',
      'agents: [Luke]',
      'tags: [false-claim, webkit, watchtower, building-stage]',
      'status: closed',
      'outcome: note',
      '---',
      '',
      '# Audit Log: Luke, a premature claim that the WebKit allowance could be dropped',
    ].join('\n'),
  );

  it('is a known outcome with a valid header and no header problem', () => {
    expect(AUDIT_OUTCOMES).toContain('note');
    expect(note.header.extra.outcome).toBe('note');
    expect(note.headerValid).toBe(true);
    expect(note.headerProblems).toEqual([]);
  });

  it('is not a strike: filed under the agent, but never counted', () => {
    expect(isStrikeLog(note.header)).toBe(false);
    expect(isPardonLog(note.header)).toBe(false);
    const index = indexAuditLogs([{ record: note, subject: 'Luke' }]);
    expect(index.bySubject.get('luke')).toEqual([note.path]);
    expect(index.strikes.get('luke')).toBeUndefined();
    const counts = checkStrikeCounts(
      input({ roster: roster([['Luke', 'Interface', 0]]), strikeLogs: index.strikes }),
    );
    expect(counts.result).toBe('pass');
  });
});

/** A fixed clock for the pardon tests (after every pardon dated in them). */
const PARDON_NOW = Date.parse('2026-10-21T12:00:00Z');

describe('pardons', () => {
  /** An audit log with a real header (parsed like the archive). */
  const log = (name: string, header: string) =>
    parseRecord(`limforia/audit-hall/${name}.md`, `---\ntype: audit\n${header}\n---\n# ${name}\n`);
  const pardon = log(
    'pardon',
    'date: 2026-10-18\nagents: [Michael]\noutcome: pardon\npardons: [PAUL, Peter]',
  );
  const audits = [
    { record: log('paul-before', 'date: 2026-10-17\noutcome: strike'), subject: 'Paul' },
    { record: log('paul-same-day', 'date: 2026-10-18\noutcome: strike'), subject: 'Paul' },
    { record: log('paul-after', 'date: 2026-10-19\noutcome: strike'), subject: 'Paul' },
    { record: log('peter-before', 'date: 2026-10-01\noutcome: executed'), subject: 'Peter' },
    { record: log('thomas-before', 'date: 2026-10-17\noutcome: strike'), subject: 'Thomas' },
    { record: pardon, subject: 'Michael' },
  ];

  it('is not a strike, and is filed under every agent it pardons (case-insensitive)', () => {
    expect(isPardonLog(pardon.header)).toBe(true);
    expect(isStrikeLog(pardon.header)).toBe(false);
    expect(pardonedSlugs(pardon.header)).toEqual(['paul', 'peter']);
    expect(AUDIT_OUTCOMES).toContain('pardon');
    const index = indexAuditLogs(audits, PARDON_NOW);
    expect(index.bySubject.get('paul')).toContain('limforia/audit-hall/pardon.md');
    expect(index.bySubject.get('peter')).toContain('limforia/audit-hall/pardon.md');
    // Michael wrote it (agents) but is not pardoned by it: pardons, when present, decide.
    expect(index.bySubject.get('michael')).toBeUndefined();
    expect([...index.pardonedAt.entries()]).toEqual([
      ['paul', '2026-10-18'],
      ['peter', '2026-10-18'],
    ]);
  });

  it('covers strikes dated on or before it; later ones and other agents still count', () => {
    const index = indexAuditLogs(audits, PARDON_NOW);
    // Paul: the 17th and the 18th (same day) are covered, the 19th counts.
    expect(index.strikes.get('paul')).toEqual(['limforia/audit-hall/paul-after.md']);
    // Peter: fully pardoned.
    expect(index.strikes.get('peter')).toBeUndefined();
    // Thomas is not named by the pardon.
    expect(index.strikes.get('thomas')).toEqual(['limforia/audit-hall/thomas-before.md']);
  });

  it('falls back to agents without a pardons key; the latest pardon wins', () => {
    const early = log('early', 'date: 2026-10-10\nagents: [Thomas]\noutcome: pardon');
    const late = log('late', 'date: 2026-10-20\nagents: [thomas]\noutcome: pardon');
    expect(pardonedSlugs(early.header)).toEqual(['thomas']);
    const index = indexAuditLogs(
      [
        { record: log('t1', 'date: 2026-10-15\noutcome: strike'), subject: 'Thomas' },
        { record: late, subject: null },
        { record: early, subject: null },
      ],
      PARDON_NOW,
    );
    expect(index.pardonedAt.get('thomas')).toBe('2026-10-20');
    expect(index.strikes.get('thomas')).toBeUndefined();
    expect(index.unattributed).toEqual([]);
  });

  // Thomas MAJ-1: a pardon's date is used only when it is a real YYYY-MM-DD date, not after now.
  it.each([
    ['a year only', '2099'],
    ['a letter', 'z'],
    ['a one-digit day', '2026-10-1'],
    ['an impossible day', '2026-02-30'],
  ])('does not apply a pardon dated with %s, and reports it', (_name, date) => {
    const forged = log(
      'forged',
      `date: "${date}"\noutcome: pardon\npardons: [Paul, Peter, Thomas]`,
    );
    // The header keeps no invalid date (the problem names the raw value).
    expect(forged.header.date).toBeNull();
    expect(forged.headerProblems).toContain(`Invalid date "${date}" (expected YYYY-MM-DD)`);
    const index = indexAuditLogs(
      [...audits.slice(0, 5), { record: forged, subject: null }],
      PARDON_NOW,
    );
    expect(index.pardonedAt.size).toBe(0);
    expect(index.pardons).toEqual([]);
    // Nothing is forgiven: every strike still counts.
    expect(index.strikes.get('paul')).toHaveLength(3);
    expect(index.strikes.get('thomas')).toHaveLength(1);
    // Reported once, as an unapplied pardon (with its reason), not as "unattributed".
    expect(index.unattributed).not.toContain(forged.path);
    // The roster matches the audit hall (nothing was forgiven), so only the warning remains.
    const check = checkStrikeCounts(
      input({
        roster: roster([
          ['Paul', 'Backend', 3],
          ['Peter', 'Tester', 1],
          ['Thomas', 'Reviewer', 1],
        ]),
        strikeLogs: index.strikes,
        pardons: index.pardons,
        pardonProblems: index.problems,
      }),
    );
    expect(check.result).toBe('warn');
    expect(check.details).toContain(
      `${forged.path}: Pardon not applied: it has no valid date (YYYY-MM-DD)`,
    );
    expect(index.problems).toEqual([
      { source: forged.path, message: 'Pardon not applied: it has no valid date (YYYY-MM-DD)' },
    ]);
  });

  it('does not forgive in advance: a valid pardon dated after now is ignored, with a problem', () => {
    const advance = log('advance', 'date: 2099-01-01\noutcome: pardon\npardons: [Paul]');
    expect(advance.header.date).toBe('2099-01-01');
    const index = indexAuditLogs(
      [...audits.slice(0, 3), { record: advance, subject: null }],
      PARDON_NOW,
    );
    expect(index.pardonedAt.has('paul')).toBe(false);
    expect(index.strikes.get('paul')).toHaveLength(3);
    expect(index.problems).toEqual([
      {
        source: advance.path,
        message: 'Pardon not applied: it is dated 2099-01-01, after today (2026-10-21)',
      },
    ]);
    // The same pardon applies once its day has come.
    const later = indexAuditLogs(
      [...audits.slice(0, 3), { record: advance, subject: null }],
      Date.parse('2099-01-01T08:00:00Z'),
    );
    expect(later.strikes.get('paul')).toBeUndefined();
  });

  it('does not apply a pardon that names nobody', () => {
    const nobody = log('nobody', 'date: 2026-10-18\noutcome: pardon\npardons: []');
    const index = indexAuditLogs([{ record: nobody, subject: null }], PARDON_NOW);
    expect(index.pardons).toEqual([]);
    expect(index.problems).toEqual([
      { source: nobody.path, message: 'Pardon not applied: it names no agent (pardons or agents)' },
    ]);
  });

  it('summarises each applied pardon: who, when, and how many strikes it covers', () => {
    const index = indexAuditLogs(audits, PARDON_NOW);
    expect(index.pardons).toEqual([
      // Paul's 17th and 18th, and Peter's 1st: three logs. Paul's 19th is after it.
      {
        path: 'limforia/audit-hall/pardon.md',
        date: '2026-10-18',
        agents: ['paul', 'peter'],
        covers: 3,
      },
    ]);
    const check = checkStrikeCounts(
      input({
        roster: roster([
          ['Paul', 'Backend', 1],
          ['Peter', 'Tester', 0],
          ['Thomas', 'Reviewer', 1],
        ]),
        strikeLogs: index.strikes,
        pardons: index.pardons,
      }),
    );
    // Counts agree: a PASS, with every applied pardon still listed in the details.
    expect(check).toEqual({
      result: 'pass',
      details: [
        'limforia/audit-hall/pardon.md: pardon of paul, peter on 2026-10-18 covers 3 strike log(s)',
      ],
    });
  });

  it('check 5: a mismatch still fails, and lists the pardon after the failure', () => {
    const index = indexAuditLogs(audits, PARDON_NOW);
    const check = checkStrikeCounts(
      input({
        roster: roster([
          ['Paul', 'Backend', 0],
          ['Peter', 'Tester', 0],
          ['Thomas', 'Reviewer', 1],
        ]),
        strikeLogs: index.strikes,
        pardonedAt: index.pardonedAt,
        pardons: index.pardons,
      }),
    );
    expect(check).toEqual({
      result: 'fail',
      details: [
        'Paul: roster says 0, audit hall holds 1 after the pardon of 2026-10-18',
        'limforia/audit-hall/pardon.md: pardon of paul, peter on 2026-10-18 covers 3 strike log(s)',
      ],
    });
  });

  it('check 5: an unapplied pardon (future, or naming nobody) is a warning with its reason', () => {
    const advance = log('advance', 'date: 2099-01-01\noutcome: pardon\npardons: [Thomas]');
    const nobody = log('nobody', 'date: 2026-10-18\noutcome: pardon\npardons: []');
    const index = indexAuditLogs(
      [
        audits[4] as (typeof audits)[number],
        { record: advance, subject: null },
        { record: nobody, subject: null },
      ],
      PARDON_NOW,
    );
    const check = checkStrikeCounts(
      input({
        roster: roster([['Thomas', 'Reviewer', 1]]),
        strikeLogs: index.strikes,
        pardons: index.pardons,
        pardonProblems: index.problems,
      }),
    );
    expect(check).toEqual({
      result: 'warn',
      details: [
        'limforia/audit-hall/advance.md: Pardon not applied: it is dated 2099-01-01, after today (2026-10-21)',
        'limforia/audit-hall/nobody.md: Pardon not applied: it names no agent (pardons or agents)',
      ],
    });
  });

  it('never covers a strike without a valid date', () => {
    const index = indexAuditLogs(
      [
        { record: log('undated', 'outcome: strike'), subject: 'Paul' },
        { record: pardon, subject: null },
      ],
      PARDON_NOW,
    );
    expect(index.strikes.get('paul')).toEqual(['limforia/audit-hall/undated.md']);
  });

  it('feeds checks 5 and 6 the post-pardon count', () => {
    const index = indexAuditLogs(audits, PARDON_NOW);
    const base = {
      strikeLogs: index.strikes,
      pardonedAt: index.pardonedAt,
    };
    // Roster after the pardon: Paul 1 (the strike after it), Peter 0, Thomas 1.
    const ok = checkStrikeCounts(
      input({
        ...base,
        roster: roster([
          ['Michael', 'Main agent', 0],
          ['Paul', 'Backend', 1],
          ['Peter', 'Tester', 0],
          ['Thomas', 'Reviewer', 1],
        ]),
      }),
    );
    expect(ok.result).not.toBe('fail');
    const off = checkStrikeCounts(input({ ...base, roster: roster([['Paul', 'Backend', 0]]) }));
    expect(off.details).toContain(
      'Paul: roster says 0, audit hall holds 1 after the pardon of 2026-10-18',
    );
    expect(
      checkThreeStrikes(input({ ...base, roster: roster([['Paul', 'Backend', 3]]) })).result,
    ).toBe('pass');
  });
});

const cleanGit: RepoState = {
  path: '.',
  isRepo: true,
  branch: 'main',
  commits: [],
  dirty: 0,
  ahead: null,
  upstream: null,
  error: null,
};

function input(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    roster: roster([
      ['Michael', 'Main agent', 0],
      ['Paul', 'Backend', 0],
    ]),
    rosterFound: true,
    definitions: [def('paul')],
    retired: [],
    records: [],
    catalog: [],
    catalogFound: true,
    strikeLogs: new Map(),
    unattributedAudits: [],
    workstationGit: cleanGit,
    ...overrides,
  };
}

describe('compliance checks', () => {
  it('all pass on a clean host', () => {
    const summary = runComplianceChecks(input());
    expect(summary).toMatchObject({ pass: 7, warn: 0, fail: 0 });
    expect(summary.checks.map((c) => c.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('1: definitions and roster must match, except the main agent', () => {
    const r = checkRosterDefinitions(
      input({ definitions: [def('raphiel'), def('bad', ['Invalid YAML'])] }),
    );
    expect(r.result).toBe('fail');
    expect(r.details.join('\n')).toMatch(/raphiel\.md \(raphiel\) has no roster entry/);
    expect(r.details.join('\n')).toMatch(/Roster entry Paul has no definition/);
    expect(r.details.join('\n')).toMatch(/bad\.md: Invalid YAML/);
    expect(r.details.join('\n')).not.toMatch(/Michael/);
    expect(checkRosterDefinitions(input({ rosterFound: false })).result).toBe('fail');
  });

  it('2: duplicate and bound names fail', () => {
    const r = checkUniqueNames(
      input({
        roster: roster([
          ['Paul', 'a', 0],
          ['paul', 'b', 0],
        ]),
        retired: [
          { name: 'Paul', role: '', served: '', cause: '', auditLog: '', auditLogPath: null },
        ],
      }),
    );
    expect(r.result).toBe('fail');
    expect(r.details).toEqual([
      '"paul" appears more than once in the roster',
      '"paul" is active but bound in the Soul Binder',
    ]);
  });

  it('3: invalid headers fail, templates are excluded', () => {
    const records = [
      parseRecord('limforia/templates/t.md', '---\ndate: YYYY-MM-DD\n---\n'),
      parseRecord('intel/x.md', '# no header'),
    ];
    const r = checkRecordHeaders(input({ records }));
    expect(r).toEqual({ result: 'fail', details: ['intel/x.md: No header'] });
  });

  it('4: uncatalogued records and dead links fail; external links warn', () => {
    const record = { ...parseRecord('limforia/chronicles/a.md', ''), inCatalog: false };
    const intel = parseRecord('intel/b.md', '');
    const entry = { section: 'S', date: null, label: 'x', cells: {} };
    const r = checkCatalogCoverage(
      input({
        records: [record, intel],
        catalog: [
          { ...entry, href: 'gone.md', path: 'limforia/gone.md', resolves: false },
          { ...entry, href: 'https://x.test', path: null, resolves: false },
        ],
      }),
    );
    expect(r.result).toBe('fail');
    expect(r.details).toEqual([
      'limforia/chronicles/a.md is not listed in CATALOG.md',
      'Link "gone.md" in S does not resolve',
      'Link "https://x.test" in S is not a local file',
    ]);
    expect(checkCatalogCoverage(input({ catalogFound: false })).result).toBe('fail');
  });

  it('5: strike counts must equal strike logs', () => {
    const r = checkStrikeCounts(
      input({
        strikeLogs: new Map([
          ['paul', ['a.md']],
          ['ghost', ['g.md']],
        ]),
        unattributedAudits: ['u.md'],
      }),
    );
    expect(r.result).toBe('fail');
    expect(r.details).toEqual([
      'Paul: roster says 0, audit hall holds 1',
      'Audit logs name "ghost", who is neither on the roster nor in the Soul Binder: g.md',
      'u.md: cannot tell which agent it is about',
    ]);
    expect(checkStrikeCounts(input({ unattributedAudits: ['u.md'] })).result).toBe('warn');
  });

  it('6: an agent with 3 strike logs that still count fails', () => {
    const three = ['a.md', 'b.md', 'c.md'].map((f) => `limforia/audit-hall/${f}`);
    const r = checkThreeStrikes(
      input({
        roster: roster([['Thomas', 'Reviewer', 3]]),
        strikeLogs: new Map([['thomas', three]]),
      }),
    );
    expect(r).toEqual({
      result: 'fail',
      details: ['Thomas has 3 / 3 strikes and is still active'],
    });
  });

  it('6: counts what check 5 counts, so pardoned strikes no longer fail it', () => {
    // The roster number alone is check 5's business (roster vs audit hall).
    const r = checkThreeStrikes(input({ roster: roster([['Thomas', 'Reviewer', 3]]) }));
    expect(r).toEqual({ result: 'pass', details: [] });
  });

  it('7: a dirty tree or unknown git state warns', () => {
    expect(checkCleanTree(input({ workstationGit: { ...cleanGit, dirty: 2 } }))).toEqual({
      result: 'warn',
      details: ['2 uncommitted change(s)'],
    });
    expect(checkCleanTree(input({ workstationGit: { ...cleanGit, isRepo: false } })).result).toBe(
      'warn',
    );
    expect(
      checkCleanTree(input({ workstationGit: { ...cleanGit, error: 'boom', dirty: null } })).result,
    ).toBe('warn');
  });
});
