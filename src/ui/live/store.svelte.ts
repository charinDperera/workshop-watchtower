/**
 * The live layer: one EventSource to `/api/stream`, shared by every island on the page.
 *
 * Islands render their server-provided slice until the first `snapshot` arrives, then the
 * store's snapshot. On the server nothing here ever connects (connection starts only in
 * `$effect`, which does not run during SSR), so the module state stays empty there.
 */
import type { ActivityEvent, Snapshot } from '../../shared/types';
import { pageName, reportClientError } from '../client-errors';
import {
  AnnouncementQueue,
  BACKOFF,
  backoffDelay,
  CANCELLED_NAVIGATION_MS,
  describeChanges,
  LIVE_ACTIVITY_CAP,
  lifecycleAction,
  mergeEvents,
  wakeAction,
} from './logic';

/**
 * `paused`: the stream was closed on purpose for a navigation that never happened, while the
 * tab was hidden. It reopens when the tab is shown again, or at once on "Retry now".
 */
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'disconnected' | 'paused';

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
/**
 * Closed on purpose by `beforeunload` or `pagehide`: not a lost connection, so nothing
 * reconnects or announces.
 */
let suspended = false;
/** The page went away (`pagehide`) after the suspend: the navigation was not cancelled. */
let hiddenSinceSuspend = false;
/** Reopens the stream if a navigation announced by `beforeunload` never happened. */
let cancelTimer: ReturnType<typeof setTimeout> | null = null;

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
  // A teardown during navigation is our own close, never a failure to report or retry.
  if (suspended) return;
  // The server sends a named `error` event (with data) when it cannot build a snapshot.
  // A connection failure is a plain Event without data.
  if (event instanceof MessageEvent && typeof event.data === 'string') {
    try {
      live.snapshotError = (JSON.parse(event.data) as { error?: string }).error ?? 'Unavailable';
    } catch {
      live.snapshotError = 'Snapshot unavailable';
    }
    reportClientError({
      msg: 'The server could not build the workstation snapshot for live updates.',
      where: `${pageName(window.location.pathname)} → Live updates`,
      errorCode: 'SNAPSHOT_UNAVAILABLE',
    });
    return;
  }
  scheduleReconnect();
}

/**
 * Opens the stream. `quiet` (a resume from the back/forward cache) keeps the connection
 * state as it was, so the indicator never flashes Reconnecting for an intentional close.
 */
function open({ quiet = false }: { quiet?: boolean } = {}): void {
  if (source || typeof EventSource === 'undefined') return;
  clearRetry();
  if (!quiet) {
    live.connection = attempt === 0 && !live.snapshot ? 'connecting' : 'reconnecting';
    if (attempt >= BACKOFF.disconnectedAfter) live.connection = 'disconnected';
  }
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
  if (users === 0 || suspended) return;
  if (!lostAnnounced && live.connection === 'live') {
    lostAnnounced = true;
    announce(['Live updates lost. Reconnecting']);
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  live.connection =
    offline || attempt + 1 >= BACKOFF.disconnectedAfter ? 'disconnected' : 'reconnecting';
  if (live.connection === 'disconnected' && !offline) {
    reportClientError({
      msg: 'Live updates stopped: the page could not reconnect to the server.',
      where: `${pageName(window.location.pathname)} → Live updates`,
      errorCode: 'LIVE_UPDATES_DISCONNECTED',
    });
  }
  const delay = backoffDelay(attempt);
  attempt += 1;
  live.retryAt = Date.now() + delay;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    open();
  }, delay);
}

/**
 * "Retry now": a user action always wins, so it also ends an intentional suspend (a paused
 * stream, or one waiting out a cancelled navigation).
 */
export function reconnectNow(): void {
  if (users === 0) return;
  if (suspended) {
    clearCancelTimer();
    suspended = false;
    hiddenSinceSuspend = false;
    attempt = 0;
  }
  closeSource();
  clearRetry();
  open();
}

/** Back online: retry, unless the stream is closed on purpose (a navigation is under way). */
function onOnline(): void {
  if (suspended) return;
  reconnectNow();
}

function onOffline(): void {
  if (users === 0 || suspended) return;
  closeSource();
  clearRetry();
  live.connection = 'disconnected';
}

function clearCancelTimer(): void {
  if (cancelTimer) clearTimeout(cancelTimer);
  cancelTimer = null;
}

/** Close the stream ourselves: no retry, no state change, no announcement. */
function suspend(): void {
  suspended = true;
  clearRetry();
  closeSource();
}

/** Reopen what `suspend` closed, quietly, with a fresh backoff. */
function resume(): void {
  suspended = false;
  hiddenSinceSuspend = false;
  attempt = 0;
  open({ quiet: true });
}

/**
 * `beforeunload`: a navigation is starting. Close the stream now, before the browser cancels
 * it (WebKit does that before `pagehide` and reports a page error). If the page is still
 * here a moment later, the navigation was cancelled and the stream reopens.
 */
function onBeforeUnload(): void {
  if (lifecycleAction('beforeunload', false, { users, suspended }) !== 'suspend') return;
  suspend();
  hiddenSinceSuspend = false;
  clearCancelTimer();
  cancelTimer = setTimeout(() => {
    cancelTimer = null;
    wake('timer');
  }, CANCELLED_NAVIGATION_MS);
}

/** The state `wakeAction` decides on. */
function suspendState() {
  return {
    users,
    suspended,
    hiddenSinceSuspend,
    visible: document.visibilityState === 'visible',
    timerPending: cancelTimer !== null,
  };
}

/**
 * After a cancelled navigation: reopen if the tab is shown; if it is hidden, the indicator
 * says Paused (never Live for a closed stream) until the tab is shown. Nothing is announced.
 */
function wake(event: 'timer' | 'visible'): void {
  const action = wakeAction(event, suspendState());
  if (action === 'resume') resume();
  else if (action === 'pause') live.connection = 'paused';
}

/** The tab is shown again: wake a stream still paused by a cancelled navigation. */
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') wake('visible');
}

/** `pagehide`: the page goes (or enters the bfcache). Close the stream if still open. */
function onPageHide(event: PageTransitionEvent): void {
  hiddenSinceSuspend = true;
  clearCancelTimer();
  if (lifecycleAction('pagehide', event.persisted, { users, suspended }) !== 'suspend') return;
  suspend();
}

/** `pageshow` from the bfcache: reopen what was suspended. */
function onPageShow(event: PageTransitionEvent): void {
  if (lifecycleAction('pageshow', event.persisted, { users, suspended }) !== 'resume') return;
  resume();
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
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    suspended = false;
    hiddenSinceSuspend = false;
    open();
  }
  return () => {
    users -= 1;
    if (users > 0) return;
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearCancelTimer();
    suspended = false;
    hiddenSinceSuspend = false;
    closeSource();
    clearRetry();
  };
}
