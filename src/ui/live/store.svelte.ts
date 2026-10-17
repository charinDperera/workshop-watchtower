/**
 * The live layer: one EventSource to `/api/stream`, shared by every island on the page.
 *
 * Islands render their server-provided slice until the first `snapshot` arrives, then the
 * store's snapshot. On the server nothing here ever connects (connection starts only in
 * `$effect`, which does not run during SSR), so the module state stays empty there.
 */
import type { ActivityEvent, Snapshot } from '../../shared/types';
import {
  AnnouncementQueue,
  BACKOFF,
  backoffDelay,
  describeChanges,
  LIVE_ACTIVITY_CAP,
  mergeEvents,
} from './logic';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

export const STREAM_URL = '/api/stream';

class LiveStore {
  /** Latest snapshot from the stream, or null until the first one arrives. */
  snapshot = $state.raw<Snapshot | null>(null);
  /** Activity events received on the stream, newest first. */
  liveEvents = $state.raw<ActivityEvent[]>([]);
  connection = $state<ConnectionState>('connecting');
  /** When the next reconnect attempt is due (ms since epoch), while not live. */
  retryAt = $state<number | null>(null);
  /** The server could not build a snapshot (the stream sent an `error` event). */
  snapshotError = $state<string | null>(null);
  /** The latest polite announcement for the aria-live region. */
  announcement = $state('');

  /** Activity to show: live events merged over the newest known list. */
  activity(fallback: readonly ActivityEvent[]): ActivityEvent[] {
    return mergeEvents(this.liveEvents, this.snapshot?.activity.events ?? fallback);
  }
}

export const live = new LiveStore();

/* ------------------------------------------------------------------ */
/* Clock: one shared ticker for every relative time on the page        */
/* ------------------------------------------------------------------ */

const CLOCK_TICK_MS = 15_000;

class Clock {
  /** 0 until the first island mounts; components then fall back to the server's time. */
  now = $state(0);
}
export const clock = new Clock();

let clockUsers = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the shared ticker; returns a stop function. Call from `$effect`. */
export function useClock(): () => void {
  clockUsers += 1;
  if (clockUsers === 1) {
    clock.now = Date.now();
    clockTimer = setInterval(() => (clock.now = Date.now()), CLOCK_TICK_MS);
  }
  return () => {
    clockUsers -= 1;
    if (clockUsers === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

let users = 0;
let source: EventSource | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lostAnnounced = false;

const queue = new AnnouncementQueue();
let announceTimer: ReturnType<typeof setTimeout> | null = null;

function announce(messages: readonly string[]): void {
  const due = queue.push(messages);
  if (due === null || announceTimer) return;
  announceTimer = setTimeout(() => {
    announceTimer = null;
    const text = queue.flush();
    if (text) live.announcement = text;
    // Anything queued meanwhile goes out on the next interval.
    if (queue.size > 0) announce([]);
  }, due);
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  live.retryAt = null;
}

function onSnapshot(event: MessageEvent<string>): void {
  let next: Snapshot;
  try {
    next = JSON.parse(event.data) as Snapshot;
  } catch {
    return;
  }
  const prev = live.snapshot;
  live.snapshot = next;
  live.snapshotError = null;
  // Events already in the snapshot no longer need to be held separately.
  const newest = next.activity.events[0]?.ts;
  if (newest) live.liveEvents = live.liveEvents.filter((e) => e.ts > newest);
  if (live.connection !== 'live') {
    if (lostAnnounced) announce(['Live updates restored']);
    lostAnnounced = false;
  }
  attempt = 0;
  clearRetry();
  live.connection = 'live';
  if (prev) announce(describeChanges(prev, next));
}

function onActivity(event: MessageEvent<string>): void {
  try {
    const item = JSON.parse(event.data) as ActivityEvent;
    live.liveEvents = [item, ...live.liveEvents].slice(0, LIVE_ACTIVITY_CAP);
  } catch {
    // A malformed line is skipped, like the server does.
  }
}

function onServerError(event: Event): void {
  // The server sends a named `error` event (with data) when it cannot build a snapshot.
  // A connection failure is a plain Event without data.
  if (event instanceof MessageEvent && typeof event.data === 'string') {
    try {
      live.snapshotError = (JSON.parse(event.data) as { error?: string }).error ?? 'Unavailable';
    } catch {
      live.snapshotError = 'Snapshot unavailable';
    }
    return;
  }
  scheduleReconnect();
}

function open(): void {
  if (source || typeof EventSource === 'undefined') return;
  clearRetry();
  live.connection = attempt === 0 && !live.snapshot ? 'connecting' : 'reconnecting';
  if (attempt >= BACKOFF.disconnectedAfter) live.connection = 'disconnected';
  const es = new EventSource(STREAM_URL);
  es.addEventListener('snapshot', onSnapshot as EventListener);
  es.addEventListener('activity', onActivity as EventListener);
  es.addEventListener('error', onServerError);
  source = es;
}

function closeSource(): void {
  if (!source) return;
  source.close();
  source = null;
}

/** Our own backoff replaces EventSource's fixed retry, which gives up on HTTP errors. */
function scheduleReconnect(): void {
  closeSource();
  if (users === 0) return;
  if (!lostAnnounced && live.connection === 'live') {
    lostAnnounced = true;
    announce(['Live updates lost. Reconnecting']);
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  live.connection =
    offline || attempt + 1 >= BACKOFF.disconnectedAfter ? 'disconnected' : 'reconnecting';
  const delay = backoffDelay(attempt);
  attempt += 1;
  live.retryAt = Date.now() + delay;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    open();
  }, delay);
}

/** Try again now (the "Retry now" button, or the browser coming back online). */
export function reconnectNow(): void {
  if (users === 0) return;
  closeSource();
  clearRetry();
  open();
}

function onOnline(): void {
  reconnectNow();
}

function onOffline(): void {
  if (users === 0) return;
  closeSource();
  clearRetry();
  live.connection = 'disconnected';
}

/**
 * Joins the shared connection; returns a leave function. Call from `$effect` in an island.
 * The first island to join opens the stream, the last to leave closes it.
 */
export function useLive(): () => void {
  users += 1;
  if (users === 1) {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    open();
  }
  return () => {
    users -= 1;
    if (users > 0) return;
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    closeSource();
    clearRetry();
  };
}
