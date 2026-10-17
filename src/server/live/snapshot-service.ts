/**
 * The live hub: caches the snapshot, rebuilds it when the workstation changes, and fans
 * snapshots and activity events out to subscribers (the SSE streams).
 *
 * Dependencies are injected (builder, watcher factory, tail, clock) so the service can be
 * tested without a real filesystem or timers.
 */
import type { ActivityEvent, Snapshot } from '../../shared/types';
import type { AppLogger } from '../logging/logger';

const SILENT: Pick<AppLogger, 'info' | 'warn' | 'error'> = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface Subscriber {
  onSnapshot(snapshot: Snapshot): void;
  onActivity(event: ActivityEvent): void;
}

export interface ServiceDeps {
  build: () => Promise<Snapshot>;
  /** Starts watching; calls back on debounced changes and on event-log changes. */
  watch: (handlers: {
    onChange: () => void;
    onEventLog: () => void;
    onError: (error: Error) => void;
  }) => { close(): void };
  tail: { start(): Promise<void>; poll(): Promise<ActivityEvent[]> };
  /** Where problems are reported (the system logger in production; silent by default). */
  log?: Pick<AppLogger, 'info' | 'warn' | 'error'>;
  now?: () => number;
}

/** Snapshot equality that ignores the build time. */
function fingerprint(snapshot: Snapshot): string {
  return JSON.stringify({ ...snapshot, generatedAt: '' });
}

export class SnapshotService {
  private cached: Promise<Snapshot> | null = null;
  private generation = 0;
  private lastSent = '';
  private readonly subscribers = new Set<Subscriber>();
  private watcher: { close(): void } | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private started = false;
  private readonly log: Pick<AppLogger, 'info' | 'warn' | 'error'>;
  private readonly now: () => number;

  constructor(private readonly deps: ServiceDeps) {
    this.log = deps.log ?? SILENT;
    this.now = deps.now ?? Date.now;
  }

  /** Starts the watcher and the tail once. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.deps.tail.start();
    } catch (err) {
      this.log.warn('events.unreadable', 'Event log not readable', { err });
    }
    this.watcher = this.deps.watch({
      onChange: () => this.refresh(),
      onEventLog: () => void this.pollActivity(),
      onError: (error) => this.log.error('watch.failed', 'Watcher error', { err: error }),
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.subscribers.clear();
    this.started = false;
  }

  /** The current snapshot, built on first use and after every change. */
  get(): Promise<Snapshot> {
    if (!this.cached) {
      const generation = this.generation;
      const building = this.deps.build().then((snapshot) => {
        if (generation === this.generation) this.scheduleExpiry(snapshot);
        return snapshot;
      });
      // A failed build is not cached, so the next request tries again.
      building.catch(() => {
        if (this.cached === building) this.cached = null;
      });
      this.cached = building;
    }
    return this.cached;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Drops the cache and, when anyone listens, pushes the new snapshot if it differs. */
  refresh(): void {
    this.generation += 1;
    this.cached = null;
    if (this.subscribers.size === 0) return;
    this.get()
      .then((snapshot) => {
        const print = fingerprint(snapshot);
        if (print === this.lastSent) return;
        this.lastSent = print;
        for (const subscriber of this.subscribers) subscriber.onSnapshot(snapshot);
      })
      .catch((err: unknown) => {
        this.log.error('snapshot.failed', 'Snapshot build failed', { err });
      });
  }

  /** Remembers what a new subscriber was sent, so identical rebuilds are not re-sent. */
  markSent(snapshot: Snapshot): void {
    this.lastSent = fingerprint(snapshot);
  }

  async pollActivity(): Promise<void> {
    let events: ActivityEvent[];
    try {
      events = await this.deps.tail.poll();
    } catch (err) {
      this.log.warn('events.read_failed', 'Event log read failed', { err });
      return;
    }
    for (const event of events) {
      for (const subscriber of this.subscribers) subscriber.onActivity(event);
    }
  }

  /** Agent status decays with time (60 s tool window); rebuild when it would change. */
  private scheduleExpiry(snapshot: Snapshot): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!snapshot.validUntil) return;
    const delay = Math.max(0, Date.parse(snapshot.validUntil) - this.now()) + 50;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.refresh();
    }, delay);
    this.expiryTimer.unref?.();
  }
}
