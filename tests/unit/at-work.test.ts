/**
 * At work selection (src/ui/at-work.ts): active first, then by lastSeen, the cap, ties,
 * resting and empty. Invented names: the code assumes none.
 */
import { describe, expect, it } from 'vitest';
import type { Agent } from '../../src/shared/types';
import { AT_WORK_LIMIT, atWork, END_LABEL } from '../../src/ui/at-work';

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
    recentEvents: [],
    ...partial,
  };
}

const at = (minute: number) => `2026-10-17T08:${String(minute).padStart(2, '0')}:00.000Z`;
const names = (list: Agent[]) => list.map((a) => a.name);

describe('atWork', () => {
  it('puts active agents first, newest first, then fills with the most recently seen', () => {
    const pick = atWork([
      agent('Ada', { lastSeen: at(10) }),
      agent('Ben', { status: 'active', lastSeen: at(20) }),
      agent('Cy', { lastSeen: at(30) }),
      agent('Dee', { status: 'active', lastSeen: at(40) }),
      agent('Eve', { lastSeen: at(5) }),
    ]);
    expect(names(pick.active)).toEqual(['Dee', 'Ben']);
    expect(names(pick.recent)).toEqual(['Cy', 'Ada']);
    expect(pick.moreActive).toBe(0);
    expect(pick.resting).toBe(false);
    expect(pick.empty).toBe(false);
  });

  it('caps the cards at the limit (4 by default) and counts active agents beyond it', () => {
    expect(AT_WORK_LIMIT).toBe(4);
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) =>
      agent(n, { status: 'active', lastSeen: at(10 + i) }),
    );
    const pick = atWork([...many, agent('Quiet', { lastSeen: at(59) })]);
    expect(names(pick.active)).toEqual(['F', 'E', 'D', 'C']);
    expect(pick.moreActive).toBe(2);
    expect(pick.recent).toEqual([]);

    expect(atWork(many, 2).active).toHaveLength(2);
    expect(atWork(many, 0)).toMatchObject({ active: [], recent: [], moreActive: 6 });
  });

  it('keeps roster order on equal lastSeen', () => {
    const pick = atWork([
      agent('First', { lastSeen: at(15) }),
      agent('Second', { lastSeen: at(15) }),
      agent('Third', { lastSeen: at(15) }),
    ]);
    expect(names(pick.recent)).toEqual(['First', 'Second', 'Third']);
    const active = atWork([
      agent('One', { status: 'active', lastSeen: at(15) }),
      agent('Two', { status: 'active', lastSeen: at(15) }),
    ]);
    expect(names(active.active)).toEqual(['One', 'Two']);
  });

  it('rests when nobody is active, showing the most recent', () => {
    const pick = atWork(['A', 'B', 'C', 'D', 'E'].map((n, i) => agent(n, { lastSeen: at(i) })));
    expect(pick.resting).toBe(true);
    expect(pick.active).toEqual([]);
    expect(names(pick.recent)).toEqual(['E', 'D', 'C', 'B']);
  });

  it('leaves out the retired and the never seen, and is empty when nobody was seen', () => {
    const pick = atWork([
      agent('Gone', { status: 'retired', lastSeen: at(50) }),
      agent('Never'),
      agent('Seen', { lastSeen: at(1) }),
    ]);
    expect(names(pick.recent)).toEqual(['Seen']);
    expect(atWork([agent('Never'), agent('Gone', { status: 'retired', lastSeen: at(2) })])).toEqual(
      {
        active: [],
        moreActive: 0,
        recent: [],
        resting: false,
        empty: true,
      },
    );
    expect(atWork([]).empty).toBe(true);
  });

  it('shows an active agent even if it has no lastSeen, after those that do', () => {
    const pick = atWork([
      agent('Blank', { status: 'active' }),
      agent('Timed', { status: 'active', lastSeen: at(3) }),
    ]);
    expect(names(pick.active)).toEqual(['Timed', 'Blank']);
    expect(pick.empty).toBe(false);
  });

  it('ignores an unparsable lastSeen for Last active', () => {
    expect(atWork([agent('Odd', { lastSeen: 'not a time' })]).empty).toBe(true);
  });

  it('words every way a session can end', () => {
    expect(END_LABEL).toEqual({
      completed: 'Ended cleanly',
      failed: 'Fell silent: stopped by an error',
      abandoned: 'Went quiet',
    });
  });
});
