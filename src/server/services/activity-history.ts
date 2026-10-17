/**
 * Views over the activity history: the newest events overall, per agent, and filtered pages
 * for `GET /api/activity`. Pure: events in, events out. Every function that takes `sorted`
 * expects the output of `sortOldestFirst`.
 */
import type { ActivityEvent, ActivityPage } from '../../shared/types';

/** Oldest first by timestamp. Stable, so events with equal timestamps keep their log order. */
export function sortOldestFirst(events: readonly ActivityEvent[]): ActivityEvent[] {
  return events
    .map((event, index) => ({ event, index, ms: Date.parse(event.ts) }))
    .sort((a, b) => a.ms - b.ms || a.index - b.index)
    .map((entry) => entry.event);
}

/** The newest `limit` events, newest first. */
export function newestFirst(sorted: readonly ActivityEvent[], limit: number): ActivityEvent[] {
  return sorted.slice(Math.max(0, sorted.length - limit)).reverse();
}

/** Each agent's newest `limit` events, newest first, keyed by agent slug. */
export function recentEventsByAgent(
  sorted: readonly ActivityEvent[],
  limit: number,
): Map<string, ActivityEvent[]> {
  const byAgent = new Map<string, ActivityEvent[]>();
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const event = sorted[i] as ActivityEvent;
    let list = byAgent.get(event.agent);
    if (!list) {
      list = [];
      byAgent.set(event.agent, list);
    }
    if (list.length < limit) list.push(event);
  }
  return byAgent;
}

/** A validated `GET /api/activity` query. */
export interface ActivityQuery {
  /** Agent slug, or `null` for every agent. */
  agent: string | null;
  /** Event names to keep; empty keeps every event. */
  events: readonly string[];
  /** Only events strictly older than this (epoch ms), or `null` for the newest. */
  before: number | null;
  limit: number;
}

/**
 * One page of matching events, newest first.
 *
 * Paging is by timestamp (`nextBefore`, exclusive), so a page never ends inside a group of
 * events that share a timestamp: such a trailing group is left for the next page. Only when
 * the whole page would be one timestamp is the page extended past `limit` to hold the group,
 * because no smaller page could make progress.
 */
export function pageActivity(sorted: readonly ActivityEvent[], query: ActivityQuery): ActivityPage {
  const wanted = query.events.length > 0 ? new Set(query.events) : null;
  const matches = sorted.filter(
    (e) => (query.agent === null || e.agent === query.agent) && (!wanted || wanted.has(e.event)),
  );
  const times = matches.map((e) => Date.parse(e.ts));

  let end = matches.length;
  if (query.before !== null) {
    const before = query.before;
    const first = times.findIndex((ms) => ms >= before);
    if (first !== -1) end = first;
  }
  let start = Math.max(0, end - query.limit);
  if (start > 0 && times[start - 1] === times[start]) {
    const boundary = times[start];
    let next = start;
    while (next < end && times[next] === boundary) next += 1;
    if (next < end) {
      start = next;
    } else {
      while (start > 0 && times[start - 1] === boundary) start -= 1;
    }
  }

  return {
    events: matches.slice(start, end).reverse(),
    nextBefore: start > 0 ? new Date(times[start] as number).toISOString() : null,
    total: matches.length,
  };
}
