import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { ActivityEvent, ActivityPage, ApiError } from '../../src/shared/types';
import { HOOK_EVENTS } from '../../src/shared/types';
import {
  newestFirst,
  pageActivity,
  recentEventsByAgent,
  sortOldestFirst,
  type ActivityQuery,
} from '../../src/server/services/activity-history';
import { parseActivityQuery, parseIsoTimestamp } from '../../src/server/schemas/activity-query';
import { readEventLog } from '../../src/server/sources/event-log';
import { createWorkstationFs } from '../../src/server/sources/workstation-fs';
import { buildSnapshot } from '../../src/server/services/build-snapshot';
import { CLEAN_FIXTURE, FIXTURE, copyFixture, fakeGit, makeTempDir } from './helpers';

vi.mock('../../src/server/live/runtime', () => ({ getRuntime: () => ({ root: FIXTURE }) }));

const T0 = Date.parse('2026-10-16T12:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

function ev(event: string, s: number, agent = 'paul', id = `${event}@${s}`): ActivityEvent {
  return {
    ts: at(s),
    event,
    session: 's1',
    agent,
    agentId: null,
    tool: null,
    toolUseId: id,
    source: null,
    reason: null,
    mcpServer: null,
  };
}

const query = (q: Partial<ActivityQuery> = {}): ActivityQuery => ({
  agent: null,
  events: [],
  before: null,
  limit: 100,
  ...q,
});

const ids = (events: ActivityEvent[]) => events.map((e) => e.toolUseId);

describe('hook events contract', () => {
  it('lists the ten registered hook events', () => {
    expect(HOOK_EVENTS).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ]);
  });
});

describe('activity history', () => {
  it('sorts by time, keeping log order for equal timestamps and honouring offsets', () => {
    const late = { ...ev('Stop', 0, 'michael', 'offset'), ts: '2026-10-16T14:00:05.000+02:00' };
    const sorted = sortOldestFirst([
      ev('A', 9, 'p', 'a'),
      ev('B', 1, 'p', 'b'),
      ev('C', 1, 'p', 'c'),
      late,
    ]);
    expect(ids(sorted)).toEqual(['b', 'c', 'offset', 'a']);
  });

  it('takes the newest events, newest first', () => {
    const sorted = [ev('A', 1, 'p', 'a'), ev('B', 2, 'p', 'b'), ev('C', 3, 'p', 'c')];
    expect(ids(newestFirst(sorted, 2))).toEqual(['c', 'b']);
    expect(ids(newestFirst(sorted, 10))).toEqual(['c', 'b', 'a']);
  });

  it('keeps the newest 25 per agent, however busy the other agents are', () => {
    const sorted: ActivityEvent[] = [];
    for (let s = 0; s < 30; s += 1) sorted.push(ev('PreToolUse', s, 'paul', `p${s}`));
    // 300 newer events from Michael would push Paul out of a global 200 cap.
    for (let s = 100; s < 400; s += 1) sorted.push(ev('PreToolUse', s, 'michael', `m${s}`));
    const byAgent = recentEventsByAgent(sorted, 25);
    expect(byAgent.get('paul')).toHaveLength(25);
    expect(byAgent.get('paul')?.[0]?.toolUseId).toBe('p29');
    expect(byAgent.get('paul')?.[24]?.toolUseId).toBe('p5');
    expect(byAgent.get('michael')?.[0]?.toolUseId).toBe('m399');
    expect(byAgent.has('peter')).toBe(false);
  });
});

describe('activity pages', () => {
  const log = sortOldestFirst([
    ev('SubagentStart', 1, 'paul', 'a'),
    ev('PreToolUse', 2, 'paul', 'b'),
    ev('PreToolUse', 3, 'peter', 'c'),
    ev('PostToolUse', 4, 'paul', 'd'),
    ev('SubagentStop', 5, 'paul', 'e'),
    ev('Stop', 6, 'michael', 'f'),
  ]);

  it('returns everything newest first by default', () => {
    expect(pageActivity(log, query())).toEqual({
      events: [...log].reverse(),
      nextBefore: null,
      total: 6,
    });
  });

  it('filters by agent and by any of several events', () => {
    const page = pageActivity(log, query({ agent: 'paul', events: ['PreToolUse', 'PostToolUse'] }));
    expect(ids(page.events)).toEqual(['d', 'b']);
    expect(page.total).toBe(2);
    expect(pageActivity(log, query({ agent: 'nobody' }))).toEqual({
      events: [],
      nextBefore: null,
      total: 0,
    });
  });

  it('pages backwards with nextBefore; total ignores before', () => {
    const first = pageActivity(log, query({ limit: 4 }));
    expect(ids(first.events)).toEqual(['f', 'e', 'd', 'c']);
    expect(first).toMatchObject({ nextBefore: at(3), total: 6 });
    const second = pageActivity(log, query({ limit: 4, before: Date.parse(first.nextBefore!) }));
    expect(ids(second.events)).toEqual(['b', 'a']);
    expect(second).toMatchObject({ nextBefore: null, total: 6 });
  });

  it('treats before as exclusive and accepts a time between events', () => {
    expect(ids(pageActivity(log, query({ before: Date.parse(at(3)) })).events)).toEqual(['b', 'a']);
    expect(ids(pageActivity(log, query({ before: Date.parse(at(3)) + 1 })).events)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(pageActivity(log, query({ before: Date.parse(at(0)) })).events).toEqual([]);
  });

  it('never splits events that share a timestamp across pages', () => {
    const ties = sortOldestFirst([
      ev('PreToolUse', 1, 'paul', 'a'),
      ev('PreToolUse', 2, 'paul', 'b1'),
      ev('PreToolUse', 2, 'paul', 'b2'),
      ev('PreToolUse', 2, 'paul', 'b3'),
      ev('PreToolUse', 3, 'paul', 'c'),
    ]);
    // A limit of 3 would end inside the 3-event group at s=2: the group waits for page 2.
    const first = pageActivity(ties, query({ limit: 3 }));
    expect(ids(first.events)).toEqual(['c']);
    expect(first.nextBefore).toBe(at(3));
    const second = pageActivity(ties, query({ limit: 3, before: Date.parse(at(3)) }));
    expect(ids(second.events)).toEqual(['b3', 'b2', 'b1']);
    // A page that would be one timestamp only grows to hold the whole group.
    const grown = pageActivity(ties, query({ limit: 2, before: Date.parse(at(3)) }));
    expect(ids(grown.events)).toEqual(['b3', 'b2', 'b1']);
    expect(grown.nextBefore).toBe(at(2));
  });

  it('visits every event exactly once when walking all pages', () => {
    const many: ActivityEvent[] = [];
    for (let i = 0; i < 97; i += 1) many.push(ev('PreToolUse', Math.floor(i / 4), 'paul', `e${i}`));
    const sorted = sortOldestFirst(many);
    for (const limit of [1, 3, 4, 7, 50, 500]) {
      const seen: string[] = [];
      let before: number | null = null;
      for (let guard = 0; guard < 200; guard += 1) {
        const page = pageActivity(sorted, query({ limit, before }));
        seen.push(...ids(page.events).map(String));
        if (page.nextBefore === null) break;
        before = Date.parse(page.nextBefore);
      }
      expect(seen).toEqual(ids(newestFirst(sorted, sorted.length)).map(String));
    }
  });
});

describe('activity query validation', () => {
  const parse = (qs: string) => parseActivityQuery(new URLSearchParams(qs));

  it('applies the defaults', () => {
    expect(parse('')).toEqual({ ok: true, query: query() });
  });

  it('accepts every documented parameter', () => {
    expect(
      parse(
        'agent=paul&event=PreToolUse&event=Stop&event=Stop&before=2026-10-01T12:00:00.5Z&limit=500',
      ),
    ).toEqual({
      ok: true,
      query: {
        agent: 'paul',
        events: ['PreToolUse', 'Stop'],
        before: Date.parse('2026-10-01T12:00:00.500Z'),
        limit: 500,
      },
    });
    expect(parse('agent=frontend-design:luke_2&before=2026-10-01T14:00:00%2B02:00')).toMatchObject({
      ok: true,
      query: { agent: 'frontend-design:luke_2', before: Date.parse('2026-10-01T12:00:00Z') },
    });
  });

  it.each([
    ['unknown parameter', 'agents=paul', /Unknown parameter "agents"/],
    ['repeated agent', 'agent=paul&agent=peter', /"agent" at most once/],
    ['empty agent', 'agent=', /lower-case agent slug/],
    ['upper-case agent', 'agent=Paul', /lower-case agent slug/],
    ['agent with a slash', 'agent=../paul', /lower-case agent slug/],
    ['agent too long', `agent=${'a'.repeat(201)}`, /lower-case agent slug/],
    ['unknown event', 'event=Notification', /"event" must be one of/],
    ['empty event', 'event=', /"event" must be one of/],
    ['lower-case event', 'event=stop', /"event" must be one of/],
    ['repeated before', 'before=2026-10-01T00:00:00Z&before=2026-10-02T00:00:00Z', /at most once/],
    ['before without a zone', 'before=2026-10-01T12:00:00', /ISO 8601/],
    ['before as a date only', 'before=2026-10-01', /ISO 8601/],
    ['before as epoch ms', 'before=1790856000000', /ISO 8601/],
    ['before on 31 February', 'before=2026-02-31T00:00:00Z', /ISO 8601/],
    ['before at hour 24', 'before=2026-10-01T24:00:00Z', /ISO 8601/],
    ['before with a bad offset', 'before=2026-10-01T12:00:00+24:00', /ISO 8601/],
    ['limit 0', 'limit=0', /1 to 500/],
    ['limit 501', 'limit=501', /1 to 500/],
    ['negative limit', 'limit=-1', /1 to 500/],
    ['fractional limit', 'limit=1.5', /1 to 500/],
    ['padded limit', 'limit=010', /1 to 500/],
    ['empty limit', 'limit=', /1 to 500/],
    ['repeated limit', 'limit=1&limit=2', /at most once/],
  ])('rejects %s', (_name, qs, message) => {
    const result = parse(qs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  it('checks the calendar that Date.parse does not', () => {
    expect(parseIsoTimestamp('2028-02-29T00:00:00Z')).toBe(Date.parse('2028-02-29T00:00:00Z'));
    expect(parseIsoTimestamp('2026-02-29T00:00:00Z')).toBeNull();
    expect(parseIsoTimestamp('2026-04-31T00:00:00Z')).toBeNull();
    expect(parseIsoTimestamp('2026-10-01T12:00:60Z')).toBeNull();
  });
});

describe('event log reader', () => {
  it('reads the rotated file before the current one', async () => {
    const log = await readEventLog(createWorkstationFs(FIXTURE));
    expect(log.events).toHaveLength(13);
    expect(log.events[0]?.ts).toBe('2026-09-30T09:00:00.000Z');
    expect(log.events.at(-1)?.event).toBe('Stop');
    expect(log.files).toEqual([
      { path: '.watchtower/events.1.jsonl', skippedLines: 1 },
      { path: '.watchtower/events.jsonl', skippedLines: 2 },
    ]);
    expect(log.skippedLines).toBe(3);
  });

  it('treats missing files as empty', async () => {
    const temp = makeTempDir();
    try {
      expect(await readEventLog(createWorkstationFs(temp.dir))).toEqual({
        events: [],
        files: [
          { path: '.watchtower/events.1.jsonl', skippedLines: 0 },
          { path: '.watchtower/events.jsonl', skippedLines: 0 },
        ],
        skippedLines: 0,
      });
    } finally {
      temp.cleanup();
    }
  });

  it('feeds an agent that is only in the rotated file into its snapshot history', async () => {
    const ws = copyFixture(CLEAN_FIXTURE);
    try {
      mkdirSync(join(ws.dir, '.watchtower'));
      const lines = (agent: string, n: number, day: string) =>
        Array.from({ length: n }, (_, i) =>
          JSON.stringify({
            ts: new Date(Date.parse(`2026-10-${day}T00:00:00Z`) + i * 1000).toISOString(),
            event: 'PreToolUse',
            agent,
            toolUseId: `${agent}-${i}`,
          }),
        ).join('\n') + '\n';
      writeFileSync(join(ws.dir, '.watchtower', 'events.1.jsonl'), lines('paul', 30, '01'));
      writeFileSync(join(ws.dir, '.watchtower', 'events.jsonl'), lines('michael', 250, '02'));
      const snapshot = await buildSnapshot({
        fs: createWorkstationFs(ws.dir),
        git: fakeGit({}),
        now: () => Date.parse('2026-10-03T00:00:00Z'),
      });
      expect(snapshot.activity.total).toBe(280);
      expect(snapshot.activity.events).toHaveLength(200);
      expect(snapshot.activity.events.some((e) => e.agent === 'paul')).toBe(false);
      const agent = (slug: string) => snapshot.agents.find((a) => a.slug === slug);
      expect(agent('paul')?.recentEvents).toHaveLength(25);
      expect(ids(agent('paul')?.recentEvents ?? []).slice(0, 2)).toEqual(['paul-29', 'paul-28']);
      expect(agent('michael')?.recentEvents[0]?.toolUseId).toBe('michael-249');
    } finally {
      ws.cleanup();
    }
  });
});

describe('GET /api/activity', async () => {
  const { GET } = await import('../../src/pages/api/activity');
  const call = async (qs: string) => {
    const response = await GET({
      url: new URL(`http://127.0.0.1:4321/api/activity${qs}`),
    } as unknown as APIContext);
    return { status: response.status, body: (await response.json()) as unknown };
  };

  it('pages the fixture log', async () => {
    const { status, body } = await call('?agent=peter&limit=2');
    expect(status).toBe(200);
    const page = body as ActivityPage;
    expect(page.events.map((e) => e.event)).toEqual(['SubagentStop', 'PostToolUseFailure']);
    expect(page).toMatchObject({ nextBefore: '2026-09-30T09:00:03.000Z', total: 4 });
  });

  it('answers bad input with a 400 ApiError', async () => {
    const { status, body } = await call('?limit=9999');
    expect(status).toBe(400);
    expect(body as ApiError).toEqual({
      status: 400,
      error: '"limit" must be an integer from 1 to 500',
    });
  });
});
