import { appendFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEvent, Snapshot } from '../../src/shared/types';
import { EventTail } from '../../src/server/live/event-tail';
import { isEventLogChange, isIgnoredChange } from '../../src/server/live/watch-filter';
import { debounce, watchWorkstation } from '../../src/server/live/watcher';
import { SnapshotService, type ServiceDeps } from '../../src/server/live/snapshot-service';
import { createEventStream, formatSseEvent, SSE_PING } from '../../src/server/live/sse';
import { resolveRoot } from '../../src/server/config/root';
import { APP_DIR, FIXTURE, makeTempDir } from './helpers';

const line = (event: string, ts = '2026-10-16T12:00:00.000Z') =>
  `${JSON.stringify({ ts, event, agent: 'paul' })}\n`;

describe('watch filter', () => {
  it.each([
    'node_modules/x/index.js',
    'apps/site/node_modules/a',
    'apps/site/dist/index.html',
    '.git/objects/ab/cdef',
    'apps/site/.git/objects/pack/x',
    'apps\\watchtower\\.astro\\types.d.ts',
    'apps/watchtower/.pnpm-store/v11/x',
  ])('ignores %s', (path) => expect(isIgnoredChange(path)).toBe(true));

  it.each([
    'ROSTER.md',
    '.git/HEAD',
    '.git/logs/HEAD',
    '.git/index',
    'limforia/chronicles/a.md',
    '.watchtower/events.jsonl',
  ])('keeps %s', (path) => expect(isIgnoredChange(path)).toBe(false));

  it('recognises the event log', () => {
    expect(isEventLogChange('.watchtower\\events.jsonl')).toBe(true);
    expect(isEventLogChange('.watchtower/events.1.jsonl')).toBe(true);
    expect(isEventLogChange('apps/x/.watchtower/events.jsonl')).toBe(false);
  });
});

describe('debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('fires once after quiet, with every item', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const d = debounce<string>(300, fire);
    d.push('a');
    vi.advanceTimersByTime(200);
    d.push('b');
    vi.advanceTimersByTime(299);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledWith(['a', 'b']);
  });
});

describe('workstation watcher (real fs.watch)', () => {
  it('reports a change and an event-log change', async () => {
    const temp = makeTempDir('watch-');
    const onChange = vi.fn();
    const onEventLog = vi.fn();
    const watcher = watchWorkstation(temp.dir, { onChange, onEventLog, onError: vi.fn() }, 50);
    try {
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(join(temp.dir, 'ROSTER.md'), 'x');
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
      writeFileSync(join(temp.dir, '.watchtower-tmp'), '');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(temp.dir, '.watchtower'));
      writeFileSync(join(temp.dir, '.watchtower', 'events.jsonl'), line('Stop'));
      await vi.waitFor(() => expect(onEventLog).toHaveBeenCalled(), { timeout: 3000 });
    } finally {
      watcher.close();
      temp.cleanup();
    }
  });
});

describe('event tail', () => {
  it('reports only appended, complete lines and survives rotation', async () => {
    const temp = makeTempDir('tail-');
    const file = join(temp.dir, 'events.jsonl');
    try {
      writeFileSync(file, line('SessionStart'));
      const tail = new EventTail(file);
      await tail.start();
      expect(await tail.poll()).toEqual([]);

      const next = line('PreToolUse');
      appendFileSync(file, next.slice(0, 10));
      expect(await tail.poll()).toEqual([]);
      appendFileSync(file, next.slice(10) + 'garbage\n');
      expect((await tail.poll()).map((e) => e.event)).toEqual(['PreToolUse']);

      renameSync(file, join(temp.dir, 'events.1.jsonl'));
      writeFileSync(file, line('Stop') + line('SessionEnd') + line('Stop'));
      expect((await tail.poll()).map((e) => e.event)).toEqual(['Stop', 'SessionEnd', 'Stop']);
    } finally {
      temp.cleanup();
    }
  });

  it('starts cleanly when the log does not exist yet', async () => {
    const temp = makeTempDir('tail-');
    try {
      const tail = new EventTail(join(temp.dir, 'events.jsonl'));
      await tail.start();
      expect(await tail.poll()).toEqual([]);
      writeFileSync(join(temp.dir, 'events.jsonl'), line('Stop'));
      expect(await tail.poll()).toHaveLength(1);
    } finally {
      temp.cleanup();
    }
  });
});

function fakeSnapshot(n: number, validUntil: string | null = null): Snapshot {
  return {
    version: 1,
    generatedAt: new Date(n).toISOString(),
    validUntil,
    rootName: `r${n}`,
  } as Snapshot;
}

function fakeDeps(builds: (() => Promise<Snapshot>)[]) {
  const handlers: { onChange?: () => void; onEventLog?: () => void } = {};
  const queue: ActivityEvent[][] = [];
  let i = 0;
  const deps: ServiceDeps = {
    build: vi.fn(() => (builds[Math.min(i++, builds.length - 1)] as () => Promise<Snapshot>)()),
    watch: (h) => {
      Object.assign(handlers, h);
      return { close: vi.fn() };
    },
    tail: { start: vi.fn(async () => {}), poll: vi.fn(async () => queue.shift() ?? []) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { deps, handlers, queue };
}

describe('snapshot service', () => {
  it('caches until a change, then pushes a new snapshot to subscribers only if it differs', async () => {
    const { deps, handlers } = fakeDeps([
      async () => fakeSnapshot(1),
      async () => fakeSnapshot(2),
      async () => ({ ...fakeSnapshot(2), generatedAt: 'later' }),
    ]);
    const service = new SnapshotService(deps);
    await service.start();
    expect(await service.get()).toBe(await service.get());
    expect(deps.build).toHaveBeenCalledTimes(1);

    const onSnapshot = vi.fn();
    service.subscribe({ onSnapshot, onActivity: vi.fn() });
    handlers.onChange?.();
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(1));
    expect(onSnapshot.mock.calls[0]?.[0].rootName).toBe('r2');

    handlers.onChange?.();
    await vi.waitFor(() => expect(deps.build).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 10));
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('does not rebuild on change when nobody listens', async () => {
    const { deps, handlers } = fakeDeps([async () => fakeSnapshot(1)]);
    const service = new SnapshotService(deps);
    await service.start();
    handlers.onChange?.();
    expect(deps.build).not.toHaveBeenCalled();
    service.stop();
  });

  it('does not cache a failed build', async () => {
    const { deps } = fakeDeps([
      async () => Promise.reject(new Error('boom')),
      async () => fakeSnapshot(1),
    ]);
    const service = new SnapshotService(deps);
    await expect(service.get()).rejects.toThrow('boom');
    await expect(service.get()).resolves.toMatchObject({ rootName: 'r1' });
  });

  it('fans activity out and unsubscribes', async () => {
    const { deps, handlers, queue } = fakeDeps([async () => fakeSnapshot(1)]);
    const service = new SnapshotService(deps);
    await service.start();
    const onActivity = vi.fn();
    const unsubscribe = service.subscribe({ onSnapshot: vi.fn(), onActivity });
    queue.push([{ event: 'Stop' } as ActivityEvent, { event: 'SessionEnd' } as ActivityEvent]);
    handlers.onEventLog?.();
    await vi.waitFor(() => expect(onActivity).toHaveBeenCalledTimes(2));
    unsubscribe();
    expect(service.subscriberCount).toBe(0);
    service.stop();
  });

  it('rebuilds when agent status expires', async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const { deps } = fakeDeps([
        async () => fakeSnapshot(1, new Date(1000).toISOString()),
        async () => fakeSnapshot(2),
      ]);
      const service = new SnapshotService({ ...deps, now: () => Date.now() });
      const onSnapshot = vi.fn();
      service.subscribe({ onSnapshot, onActivity: vi.fn() });
      await service.get();
      await vi.advanceTimersByTimeAsync(1100);
      expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ rootName: 'r2' }));
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SSE stream', () => {
  function source(snapshot: Snapshot) {
    const subs = new Set<{
      onSnapshot: (s: Snapshot) => void;
      onActivity: (e: ActivityEvent) => void;
    }>();
    return {
      subs,
      get: async () => snapshot,
      markSent: vi.fn(),
      subscribe: (s: {
        onSnapshot: (s: Snapshot) => void;
        onActivity: (e: ActivityEvent) => void;
      }) => {
        subs.add(s);
        return () => subs.delete(s);
      },
    };
  }

  async function readText(reader: ReadableStreamDefaultReader<Uint8Array>, until: string) {
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes(until)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    return text;
  }

  it('formats events', () => {
    expect(formatSseEvent('x', { a: 'b\nc' })).toBe('event: x\ndata: {"a":"b\\nc"}\n\n');
  });

  it('sends a snapshot on connect, then activity and pings, and cleans up on abort', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const src = source(fakeSnapshot(1));
      const abort = new AbortController();
      const reader = createEventStream(src, abort.signal, 1000).getReader();

      const first = await readText(reader, 'event: snapshot');
      expect(first).toContain('retry: 3000');
      expect(first).toContain('"rootName":"r1"');
      expect(src.markSent).toHaveBeenCalled();

      for (const s of src.subs) s.onActivity({ event: 'PreToolUse' } as ActivityEvent);
      expect(await readText(reader, 'event: activity')).toContain('"event":"PreToolUse"');

      vi.advanceTimersByTime(1000);
      expect(await readText(reader, ':')).toBe(SSE_PING);

      abort.abort();
      expect(src.subs.size).toBe(0);
      expect((await reader.read()).done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up when the reader cancels', async () => {
    const src = source(fakeSnapshot(1));
    const reader = createEventStream(src, new AbortController().signal).getReader();
    await readText(reader, 'event: snapshot');
    await reader.cancel();
    expect(src.subs.size).toBe(0);
  });
});

describe('root resolution', () => {
  it('uses WATCHTOWER_ROOT when set', () => {
    expect(resolveRoot({ WATCHTOWER_ROOT: FIXTURE })).toBe(FIXTURE);
  });

  it('defaults to two levels above the app', () => {
    const root = resolveRoot({}, new URL('../../src/lib/config.ts', import.meta.url).href);
    expect(root).toBe(join(APP_DIR, '..', '..'));
  });

  it('rejects a root that is not a directory', () => {
    expect(() => resolveRoot({ WATCHTOWER_ROOT: join(FIXTURE, 'ROSTER.md') })).toThrow(
      /not a directory/,
    );
  });
});
