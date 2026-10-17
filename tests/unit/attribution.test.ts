import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNATTRIBUTED_AGENT } from '../../src/shared/types';
import { AgentAttributor, attributeEvents } from '../../src/server/services/attribution';
import { deriveLiveStates } from '../../src/server/services/activity';
import { parseEvents } from '../../src/server/sources/parse/events';
import { readEventLog } from '../../src/server/sources/event-log';
import { createWorkstationFs } from '../../src/server/sources/workstation-fs';
import { EventTail } from '../../src/server/live/event-tail';
import { buildSnapshot } from '../../src/server/services/build-snapshot';
import { CLEAN_FIXTURE, copyFixture, fakeGit } from './helpers';

/** Shapes copied from the real F:\Projects\.watchtower\events.jsonl (ids shortened). */
const REAL = [
  '{"ts":"2026-10-16T20:00:00.000Z","event":"UserPromptSubmit","session":"05f3c60d","agent":"michael"}',
  '{"ts":"2026-10-16T20:00:01.000Z","event":"SubagentStart","session":"05f3c60d","agent":"luke","agentId":"aff6709ad2f3d4e57"}',
  '{"ts":"2026-10-16T20:00:02.000Z","event":"PreToolUse","session":"05f3c60d","agent":"luke","agentId":"aff6709ad2f3d4e57","tool":"Edit","toolUseId":"t1"}',
  '{"ts":"2026-10-16T20:00:03.000Z","event":"PostToolUse","session":"05f3c60d","agent":"luke","agentId":"aff6709ad2f3d4e57","tool":"Edit","toolUseId":"t1"}',
  // The same subagent's stop, written by the old logger without a type.
  '{"ts":"2026-10-16T20:00:04.000Z","event":"SubagentStop","session":"05f3c60d","agent":"michael","agentId":"aff6709ad2f3d4e57"}',
  // Internal subagent: a stop with no start anywhere (legacy "michael" form).
  '{"ts":"2026-10-16T20:00:05.000Z","event":"SubagentStop","session":"05f3c60d","agent":"michael","agentId":"a9a0aa7788fdd61dd"}',
  // A second Claude session, new logger form.
  '{"ts":"2026-10-16T20:00:06.000Z","event":"SubagentStop","session":"b95411d0","agent":"subagent","agentId":"af39fa89631d0285a"}',
  '{"ts":"2026-10-16T20:00:07.000Z","event":"Stop","session":"05f3c60d","agent":"michael"}',
];
const realEvents = () => parseEvents(REAL.join('\n')).events;

describe('subagent attribution', () => {
  it('resolves by agentId, else marks the event unattributed; michael keeps only his own', () => {
    const agents = attributeEvents(realEvents()).map((e) => [e.event, e.agent]);
    expect(agents).toEqual([
      ['UserPromptSubmit', 'michael'],
      ['SubagentStart', 'luke'],
      ['PreToolUse', 'luke'],
      ['PostToolUse', 'luke'],
      ['SubagentStop', 'luke'],
      ['SubagentStop', UNATTRIBUTED_AGENT],
      ['SubagentStop', UNATTRIBUTED_AGENT],
      ['Stop', 'michael'],
    ]);
    expect(UNATTRIBUTED_AGENT).toBe('subagent');
  });

  it('resolves a tool event without a type, and learns only from earlier events', () => {
    const a = new AgentAttributor();
    const base = {
      session: 's',
      tool: null,
      toolUseId: null,
      source: null,
      reason: null,
      mcpServer: null,
    };
    const early = a.attribute({
      ...base,
      ts: 't0',
      event: 'PreToolUse',
      agent: 'subagent',
      agentId: 'x',
    });
    a.attribute({ ...base, ts: 't1', event: 'SubagentStart', agent: 'paul', agentId: 'x' });
    const late = a.attribute({
      ...base,
      ts: 't2',
      event: 'PostToolUse',
      agent: 'michael',
      agentId: 'x',
    });
    expect([early.agent, late.agent]).toEqual(['subagent', 'paul']);
    // A real name on the event itself is never overwritten.
    expect(
      a.attribute({ ...base, ts: 't3', event: 'Stop', agent: 'peter', agentId: 'x' }).agent,
    ).toBe('peter');
  });

  it('never lets an unattributed stop touch Michael', () => {
    const now = Date.parse('2026-10-16T20:00:30.000Z');
    // A typeless stop from another session, after Michael's own last event.
    const trailing = parseEvents(
      '{"ts":"2026-10-16T20:00:10.000Z","event":"SubagentStop","session":"b95411d0","agent":"michael","agentId":"addc4303076a8d450"}',
    ).events;
    const events = [...realEvents(), ...trailing];
    const raw = deriveLiveStates(events, now);
    const fixed = deriveLiveStates(attributeEvents(events), now);
    expect(raw.get('michael')?.lastSeen).toBe('2026-10-16T20:00:10.000Z'); // the bug
    expect(fixed.get('michael')?.lastSeen).toBe('2026-10-16T20:00:07.000Z');
    expect(fixed.get('subagent')?.lastSeen).toBe('2026-10-16T20:00:10.000Z');
    expect(fixed.get('luke')?.lastSeen).toBe('2026-10-16T20:00:04.000Z');
    expect(raw.get('luke')?.lastSeen).toBe('2026-10-16T20:00:03.000Z');
    expect(fixed.get('subagent')?.active).toBe(false);
  });
});

describe('attribution through the log, snapshot and tail', () => {
  function workstation(lines: string[]) {
    const ws = copyFixture(CLEAN_FIXTURE);
    mkdirSync(join(ws.dir, '.watchtower'));
    writeFileSync(join(ws.dir, '.watchtower', 'events.jsonl'), lines.join('\n') + '\n');
    return ws;
  }

  it('keeps unattributed events out of Michael and in the activity feed', async () => {
    const ws = workstation(REAL);
    try {
      const snapshot = await buildSnapshot({
        fs: createWorkstationFs(ws.dir),
        git: fakeGit({}),
        now: () => Date.parse('2026-10-16T20:00:30.000Z'),
      });
      const michael = snapshot.agents.find((a) => a.slug === 'michael');
      expect(michael?.recentEvents.map((e) => e.event)).toEqual(['Stop', 'UserPromptSubmit']);
      expect(michael?.recentEvents.every((e) => e.agentId === null)).toBe(true);
      expect(michael?.lastSeen).toBe('2026-10-16T20:00:07.000Z');
      const unnamed = snapshot.activity.events.filter((e) => e.agent === 'subagent');
      expect(unnamed.map((e) => e.agentId)).toEqual(['af39fa89631d0285a', 'a9a0aa7788fdd61dd']);
      expect(snapshot.activity.total).toBe(8);
    } finally {
      ws.cleanup();
    }
  });

  it('attributes rotated starts and current stops together', async () => {
    const ws = workstation([REAL[4] as string]);
    try {
      writeFileSync(
        join(ws.dir, '.watchtower', 'events.1.jsonl'),
        REAL.slice(0, 4).join('\n') + '\n',
      );
      const log = await readEventLog(createWorkstationFs(ws.dir));
      expect(log.events.at(-1)).toMatchObject({ event: 'SubagentStop', agent: 'luke' });
    } finally {
      ws.cleanup();
    }
  });

  it('gives the live tail the same answer as the snapshot, seeded from the existing log', async () => {
    const ws = workstation(REAL.slice(0, 4));
    try {
      const fs = createWorkstationFs(ws.dir);
      const file = fs.absolute('.watchtower/events.jsonl');
      const tail = new EventTail(file, async () => (await readEventLog(fs)).events);
      await tail.start();
      appendFileSync(file, REAL.slice(4).join('\n') + '\n');
      const live = (await tail.poll()).map((e) => e.agent);
      const snapshotView = (await readEventLog(fs)).events.slice(4).map((e) => e.agent);
      expect(live).toEqual(['luke', 'subagent', 'subagent', 'michael']);
      expect(live).toEqual(snapshotView);
    } finally {
      ws.cleanup();
    }
  });

  it('without a seed, the tail still never reports a typeless subagent as michael', async () => {
    const ws = workstation([]);
    try {
      const file = join(ws.dir, '.watchtower', 'events.jsonl');
      const tail = new EventTail(file);
      await tail.start();
      appendFileSync(file, `${REAL[5]}\n`);
      expect((await tail.poll()).map((e) => e.agent)).toEqual(['subagent']);
    } finally {
      ws.cleanup();
    }
  });
});
