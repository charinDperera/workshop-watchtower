/**
 * The Council tree's pure layout (src/ui/council.ts): tiers, station order, epithets,
 * rank labels and honest liveness. Written by Luke for the v3 tree; no agent names are
 * assumed by the code, so these use invented ones.
 */
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../src/shared/types';
import {
  agentLines,
  councilSeed,
  councilTiers,
  firstClause,
  liveness,
  numeral,
  rankLabel,
  silenceLabel,
  silenceNote,
  tierTitle,
  UNSTATIONED_TITLE,
} from '../../src/ui/council';

function agent(name: string, partial: Partial<Agent> = {}): Agent {
  return {
    name,
    slug: name.toLowerCase(),
    title: null,
    rank: 'worker',
    station: null,
    role: null,
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
    stage: null,
    auditLogs: [],
    pardonedAt: null,
    recentEvents: [],
    ...partial,
  };
}

const STAGES = [
  { id: 'data', title: 'Data' },
  { id: 'build', title: 'Build' },
  { id: 'test', title: 'Test' },
];

describe('councilTiers', () => {
  it('splits overseers, counsel and workers, any number of each', () => {
    const tiers = councilTiers(
      [
        agent('Ariel', { rank: 'overseer' }),
        agent('Barachiel', { rank: 'overseer' }),
        agent('Cassiel', { rank: 'counsel' }),
        agent('Dina', { rank: 'counsel' }),
        agent('Eli', { station: 'Build', stage: 'build' }),
      ],
      STAGES,
    );
    expect(tiers.overseers.map((a) => a.name)).toEqual(['Ariel', 'Barachiel']);
    expect(tiers.counsel.map((a) => a.name)).toEqual(['Cassiel', 'Dina']);
    expect(tiers.stations).toHaveLength(1);
    expect(tiers.count).toBe(5);
  });

  it('orders stations by the Order of Work, then unknown stations in roster order, then the unstationed', () => {
    const tiers = councilTiers(
      [
        agent('Zed'),
        agent('Yona', { station: 'Harbour' }),
        agent('Xan', { station: 'Test', stage: 'test' }),
        agent('Wren', { station: 'Archive' }),
        agent('Vera', { station: 'Data', stage: 'data' }),
        agent('Uma', { station: 'build' }), // matched case-insensitively, without a stage id
      ],
      STAGES,
    );
    expect(tiers.stations.map((s) => [s.title, s.order])).toEqual([
      ['Data', 1],
      ['Build', 2],
      ['Test', 3],
      ['Harbour', null],
      ['Archive', null],
      [UNSTATIONED_TITLE, null],
    ]);
  });

  it('groups members of one station in roster order and leaves out the retired', () => {
    const tiers = councilTiers(
      [
        agent('Paula', { station: 'Build', stage: 'build' }),
        agent('Gone', { station: 'Build', stage: 'build', status: 'retired' }),
        agent('Lucan', { station: 'Build', stage: 'build' }),
      ],
      STAGES,
    );
    expect(tiers.stations[0]?.members.map((a) => a.name)).toEqual(['Paula', 'Lucan']);
    expect(tiers.count).toBe(2);
  });

  it('copes with no stages and no agents', () => {
    expect(councilTiers([], [])).toEqual({ overseers: [], counsel: [], stations: [], count: 0 });
    const tiers = councilTiers([agent('Solo', { station: 'Forge' })]);
    expect(tiers.stations.map((s) => s.title)).toEqual(['Forge']);
  });
});

describe('agentLines', () => {
  it('uses the title as epithet and the role first clause as the line beneath', () => {
    expect(
      agentLines({ title: 'Keeper of the Keys', role: 'Tester: unit, end-to-end and security' }),
    ).toEqual({ epithet: 'Keeper of the Keys', summary: 'Tester' });
  });

  it('falls back to the role first clause as epithet, and the rest as the summary', () => {
    expect(agentLines({ title: null, role: 'Backend Architect: business logic, APIs' })).toEqual({
      epithet: 'Backend Architect',
      summary: 'Business logic, APIs',
    });
    expect(agentLines({ title: '  ', role: 'Scribe' })).toEqual({
      epithet: 'Scribe',
      summary: null,
    });
    expect(agentLines({ title: null, role: null })).toEqual({ epithet: null, summary: null });
  });

  it('cuts the first clause at common separators', () => {
    expect(firstClause('Research, frameworks and plugins')).toBe('Research');
    expect(firstClause('DevOps (Docker) and more')).toBe('DevOps');
    expect(firstClause('Data — schemas and queries')).toBe('Data');
    expect(firstClause('Front-end designer')).toBe('Front-end designer');
    expect(firstClause('')).toBeNull();
  });
});

describe('rank and tiers in words', () => {
  it('names the place of each rank', () => {
    expect(rankLabel({ rank: 'overseer', station: null })).toBe('Overseer of The Council');
    expect(rankLabel({ rank: 'counsel', station: null })).toBe('Advisor to The Council');
    expect(rankLabel({ rank: 'worker', station: 'Ship' })).toBe('Serves at Ship');
    expect(rankLabel({ rank: 'worker', station: null })).toMatch(/awaiting a station/);
  });

  it('pluralises the overseer tier', () => {
    expect(tierTitle('overseer', 1)).toBe('The Overseer');
    expect(tierTitle('overseer', 2)).toBe('The Overseers');
    expect(tierTitle('counsel', 1)).toBe('The Advisor');
    expect(tierTitle('counsel', 3)).toBe('The Advisors');
  });

  it('writes station numerals', () => {
    expect([1, 4, 7, 9, 14, 39].map(numeral)).toEqual(['I', 'IV', 'VII', 'IX', 'XIV', 'XXXIX']);
    expect(numeral(40)).toBe('40');
  });
});

describe('liveness', () => {
  const at = '2026-10-17T08:00:00.000Z';
  const now = Date.parse('2026-10-17T08:03:00.000Z');

  it('reads Active only for an active status, whatever the last end', () => {
    expect(liveness({ status: 'active', lastEnd: { at, outcome: 'failed' } })).toEqual({
      kind: 'active',
    });
  });

  it('says how a silent agent fell silent', () => {
    const failed = liveness({ status: 'idle', lastEnd: { at, outcome: 'failed' } });
    expect(silenceLabel(failed)).toBe('Fell silent: stopped by an error');
    expect(silenceNote(failed, now)).toBe('Fell silent: stopped by an error, 3 min ago');
    const quiet = liveness({ status: 'idle', lastEnd: { at, outcome: 'abandoned' } });
    expect(silenceLabel(quiet)).toBe('Went quiet');
  });

  it('is plain Idle after a clean end or none, and Retired for the departed', () => {
    expect(liveness({ status: 'idle', lastEnd: { at, outcome: 'completed' } })).toEqual({
      kind: 'idle',
    });
    expect(liveness({ status: 'idle', lastEnd: null })).toEqual({ kind: 'idle' });
    expect(liveness({ status: 'retired', lastEnd: null })).toEqual({ kind: 'retired' });
    expect(silenceNote({ kind: 'idle' }, now)).toBeNull();
  });
});

describe('councilSeed', () => {
  it('drops event history and keeps only the stage order', () => {
    const seed = councilSeed({
      agents: [agent('Eli', { recentEvents: [{} as never] })],
      pipeline: [{ id: 'build', title: 'Build', agents: ['eli'], lit: false, activeAgents: [] }],
    } as never);
    expect(seed.agents[0]?.recentEvents).toEqual([]);
    expect(seed.stages).toEqual([{ id: 'build', title: 'Build' }]);
  });
});
