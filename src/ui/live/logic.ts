/**
 * Pure logic behind the live layer: merging activity, reconnect backoff, change detection
 * for announcements and the announcement rate limiter. No DOM, no timers of its own, so it
 * is unit-tested directly (tests/unit/ui-live.test.ts).
 */
import type { ActivityEvent, Snapshot } from '../../shared/types';
import { CHECK_LABEL, plural } from '../format';

/* ------------------------------------------------------------------ */
/* Activity                                                           */
/* ------------------------------------------------------------------ */

/** Matches the snapshot cap (`ACTIVITY_LIMIT` on the server). */
export const LIVE_ACTIVITY_CAP = 200;

/** Identity of an event: the log has no ids, so the fields that make a line unique. */
export function eventKey(e: ActivityEvent): string {
  return [e.ts, e.event, e.agent, e.agentId ?? '', e.toolUseId ?? '', e.session ?? ''].join('|');
}

/** Union of both lists, de-duplicated, newest first, capped. */
export function mergeEvents(
  live: readonly ActivityEvent[],
  base: readonly ActivityEvent[],
  cap: number = LIVE_ACTIVITY_CAP,
): ActivityEvent[] {
  const seen = new Set<string>();
  const out: ActivityEvent[] = [];
  for (const e of [...live, ...base]) {
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return out.slice(0, cap);
}

/* ------------------------------------------------------------------ */
/* Reconnect backoff                                                  */
/* ------------------------------------------------------------------ */

export const BACKOFF = {
  baseMs: 1_000,
  maxMs: 30_000,
  /** After this many failed attempts in a row the indicator says "disconnected". */
  disconnectedAfter: 4,
} as const;

/**
 * Delay before reconnect attempt `attempt` (0-based): exponential, capped, with "equal
 * jitter" so many tabs do not reconnect in lockstep. `random` is injectable for tests.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/* ------------------------------------------------------------------ */
/* Change detection for announcements                                 */
/* ------------------------------------------------------------------ */

/** Short sentences describing what changed between two snapshots that matters to a person. */
export function describeChanges(prev: Snapshot, next: Snapshot): string[] {
  const out: string[] = [];

  const before = new Map(prev.agents.map((a) => [a.slug, a]));
  for (const agent of next.agents) {
    const old = before.get(agent.slug);
    if (!old) {
      out.push(`${agent.name} joined the host`);
      continue;
    }
    if (old.status !== agent.status) out.push(`${agent.name} is now ${agent.status}`);
    if (old.strikes !== agent.strikes && agent.strikes !== null) {
      out.push(`${agent.name} now has ${agent.strikes} of ${agent.strikeLimit} strikes`);
    }
  }
  const after = new Set(next.agents.map((a) => a.slug));
  for (const agent of prev.agents) {
    if (!after.has(agent.slug)) out.push(`${agent.name} left the roster`);
  }

  const oldChecks = new Map(prev.compliance.checks.map((c) => [c.id, c.result]));
  for (const check of next.compliance.checks) {
    const was = oldChecks.get(check.id);
    if (was && was !== check.result) {
      out.push(`Law check ${check.order} is now ${CHECK_LABEL[check.result].toLowerCase()}`);
    }
  }

  const oldHead = prev.git.workstation.commits[0]?.hash;
  const newHead = next.git.workstation.commits[0];
  if (newHead && newHead.hash !== oldHead) out.push(`New commit: ${newHead.subject}`);

  const oldRecords = prev.records.filter((r) => !r.isTemplate).length;
  const newRecords = next.records.filter((r) => !r.isTemplate).length;
  if (newRecords > oldRecords) {
    out.push(`${plural(newRecords - oldRecords, 'new record')} in the archive`);
  }

  if (next.retired.length > prev.retired.length) {
    out.push(
      `${plural(next.retired.length - prev.retired.length, 'agent')} bound into the Soul Binder`,
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Announcement rate limiting                                         */
/* ------------------------------------------------------------------ */

export const ANNOUNCE = {
  /** At most one announcement per interval. */
  intervalMs: 8_000,
  /** Sentences per announcement; the rest are summarised as "and N more changes". */
  maxItems: 3,
} as const;

/**
 * Queues messages and releases them as one polite announcement per interval.
 * The caller owns the timer: `push` returns the delay after which to call `flush`.
 */
export class AnnouncementQueue {
  private queue: string[] = [];
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly now: () => number = Date.now) {}

  /** Adds messages; returns ms until a flush is due (0 = now), or null when nothing queued. */
  push(messages: readonly string[]): number | null {
    for (const m of messages) if (!this.queue.includes(m)) this.queue.push(m);
    if (this.queue.length === 0) return null;
    return Math.max(0, this.lastAt + ANNOUNCE.intervalMs - this.now());
  }

  /** The text to announce now, or null when nothing is queued. */
  flush(): string | null {
    if (this.queue.length === 0) return null;
    const items = this.queue.slice(0, ANNOUNCE.maxItems);
    const rest = this.queue.length - items.length;
    this.queue = [];
    this.lastAt = this.now();
    const text = items.join('. ');
    return rest > 0 ? `${text}. And ${plural(rest, 'more change')}.` : `${text}.`;
  }

  get size(): number {
    return this.queue.length;
  }
}
