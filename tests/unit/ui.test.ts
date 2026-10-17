import { describe, expect, it } from 'vitest';
import type { ActivityEvent, Snapshot } from '../../src/shared/types';
import {
  agentNameFor,
  eventPhrase,
  formatDate,
  isUnattributed,
  relativeTime,
  toolLabel,
  UNATTRIBUTED_LABEL,
} from '../../src/ui/format';
import { UNATTRIBUTED_AGENT } from '../../src/shared/types';
import {
  ANNOUNCE,
  AnnouncementQueue,
  BACKOFF,
  backoffDelay,
  describeChanges,
  mergeEvents,
} from '../../src/ui/live/logic';
import { hashName, sigilFor } from '../../src/ui/sigil';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');

function event(partial: Partial<ActivityEvent>): ActivityEvent {
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

describe('format', () => {
  it('formats relative times in fixed buckets', () => {
    expect(relativeTime(null, NOW)).toBe('never');
    expect(relativeTime('2026-10-16T11:59:30.000Z', NOW)).toBe('just now');
    expect(relativeTime('2026-10-16T11:55:00.000Z', NOW)).toBe('5 min ago');
    expect(relativeTime('2026-10-16T09:00:00.000Z', NOW)).toBe('3 h ago');
    expect(relativeTime('2026-10-14T12:00:00.000Z', NOW)).toBe('2 d ago');
    expect(relativeTime('2026-10-16T12:05:00.000Z', NOW)).toBe('just now');
  });

  it('shows plain dates without a time-zone shift', () => {
    expect(formatDate('2026-10-16')).toBe('16 Oct 2026');
  });

  it('labels MCP tools by server and tool', () => {
    expect(toolLabel('mcp__playwright__browser_click')).toBe('playwright: browser_click');
    expect(toolLabel('mcp__astro-docs__search_astro_docs')).toBe('astro-docs: search_astro_docs');
    expect(toolLabel('Bash')).toBe('Bash');
    expect(toolLabel(null)).toBe('a tool');
  });

  it('describes events without leaking anything but names', () => {
    expect(eventPhrase(event({}))).toBe('began Bash');
    expect(eventPhrase(event({ event: 'SubagentStart', tool: null }))).toBe('was summoned');
    expect(eventPhrase(event({ event: 'SessionEnd', tool: null, reason: 'clear' }))).toBe(
      'closed the session (clear)',
    );
    expect(eventPhrase(event({ event: 'SomethingNew', tool: null }))).toBe('SomethingNew');
  });
});

describe('agent names', () => {
  const names = new Map([['paul', 'Paul']]);
  it('uses the roster name, the unattributed label, or the slug', () => {
    expect(agentNameFor('paul', names)).toBe('Paul');
    expect(agentNameFor(UNATTRIBUTED_AGENT, names)).toBe(UNATTRIBUTED_LABEL);
    expect(agentNameFor('explore', names)).toBe('explore');
    expect(isUnattributed(UNATTRIBUTED_AGENT)).toBe(true);
    expect(isUnattributed('paul')).toBe(false);
  });
});

describe('sigils', () => {
  it('are deterministic and case-insensitive', () => {
    expect(hashName('Luke')).toBe(hashName(' luke '));
    expect(sigilFor('Luke')).toEqual(sigilFor('luke'));
  });

  it('differ between names and always draw a star', () => {
    const names = ['Michael', 'Uriel', 'Thomas', 'Luke', 'Luka', 'Peter', 'Paul', 'Raphael'];
    const stars = new Set(names.map((n) => sigilFor(n).star));
    expect(stars.size).toBeGreaterThan(1);
    for (const n of names) {
      const g = sigilFor(n);
      expect(g.star).toMatch(/^M[\d. ]+/);
      expect(g.initial).toBe(n[0]);
      expect(g.marks.length).toBeGreaterThan(0);
    }
  });

  it('handles empty names', () => {
    expect(sigilFor('').initial).toBe('?');
  });
});

describe('mergeEvents', () => {
  it('de-duplicates, sorts newest first and caps', () => {
    const a = event({ ts: '2026-10-16T12:00:01.000Z', toolUseId: 'a' });
    const b = event({ ts: '2026-10-16T12:00:02.000Z', toolUseId: 'b' });
    const c = event({ ts: '2026-10-16T12:00:03.000Z', toolUseId: 'c' });
    expect(mergeEvents([c, b], [b, a]).map((e) => e.toolUseId)).toEqual(['c', 'b', 'a']);
    expect(mergeEvents([c, b], [a], 2)).toHaveLength(2);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially within the cap, with jitter', () => {
    expect(backoffDelay(0, () => 0)).toBe(BACKOFF.baseMs / 2);
    expect(backoffDelay(0, () => 1)).toBe(BACKOFF.baseMs);
    expect(backoffDelay(3, () => 1)).toBe(BACKOFF.baseMs * 8);
    expect(backoffDelay(50, () => 1)).toBe(BACKOFF.maxMs);
  });
});

describe('describeChanges', () => {
  const base = {
    agents: [
      { slug: 'paul', name: 'Paul', status: 'idle', strikes: 0, strikeLimit: 3 },
      { slug: 'luke', name: 'Luke', status: 'active', strikes: 0, strikeLimit: 3 },
    ],
    compliance: { checks: [{ id: 'clean-tree', order: 7, result: 'pass' }] },
    git: { workstation: { commits: [{ hash: 'a', subject: 'first' }] } },
    records: [{ isTemplate: false }],
    retired: [],
  } as unknown as Snapshot;

  it('reports status, strike, law, commit and record changes', () => {
    const next = {
      ...base,
      agents: [
        { slug: 'paul', name: 'Paul', status: 'active', strikes: 1, strikeLimit: 3 },
        { slug: 'luke', name: 'Luke', status: 'active', strikes: 0, strikeLimit: 3 },
      ],
      compliance: { checks: [{ id: 'clean-tree', order: 7, result: 'warn' }] },
      git: { workstation: { commits: [{ hash: 'b', subject: 'second' }] } },
      records: [{ isTemplate: false }, { isTemplate: false }],
    } as unknown as Snapshot;
    expect(describeChanges(base, next)).toEqual([
      'Paul is now active',
      'Paul now has 1 of 3 strikes',
      'Law check 7 is now warning',
      'New commit: second',
      '1 new record in the archive',
    ]);
  });

  it('says nothing when nothing that matters changed', () => {
    expect(describeChanges(base, { ...base })).toEqual([]);
  });
});

describe('AnnouncementQueue', () => {
  it('rate-limits and summarises', () => {
    let now = 0;
    const queue = new AnnouncementQueue(() => now);
    expect(queue.push([])).toBeNull();
    expect(queue.push(['a'])).toBe(0);
    expect(queue.flush()).toBe('a.');
    now = 1_000;
    expect(queue.push(['b', 'c', 'd', 'e', 'b'])).toBe(ANNOUNCE.intervalMs - 1_000);
    expect(queue.flush()).toBe('b. c. d. And 1 more change.');
    expect(queue.flush()).toBeNull();
  });
});
