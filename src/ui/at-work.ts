/**
 * "At work": who of The Council is active now, and who was active last. Pure and
 * data-driven: no agent names. Used by the Overview, on the server and in the live island.
 */
import type { Agent, EndOutcome } from '../shared/types';
import { parseTime } from './format';

/** How many cards the Overview shows by default. */
export const AT_WORK_LIMIT = 4;

export interface AtWork {
  /** Active agents, most recently heard from first, at most `limit`. */
  active: Agent[];
  /** Active agents beyond the limit (counted, not shown). */
  moreActive: number;
  /** The most recently seen of the others, filling the cards left after `active`. */
  recent: Agent[];
  /** True when nobody is active but someone has been seen: The Council rests. */
  resting: boolean;
  /** True when no agent has ever been seen and none is active. */
  empty: boolean;
}

/** Newest `lastSeen` first; agents never seen go last; ties keep roster order (stable sort). */
function byLastSeen(a: Agent, b: Agent): number {
  const ta = parseTime(a.lastSeen) ?? -Infinity;
  const tb = parseTime(b.lastSeen) ?? -Infinity;
  if (ta === tb) return 0;
  return tb > ta ? 1 : -1;
}

/**
 * Picks the cards: every active agent first (up to `limit`), then the most recently seen of
 * the rest until `limit` cards are filled. Retired agents and agents never seen are left out
 * of "Last active".
 */
export function atWork(agents: readonly Agent[], limit = AT_WORK_LIMIT): AtWork {
  const cap = Math.max(0, Math.floor(limit));
  const serving = agents.filter((a) => a.status !== 'retired');
  const activeAll = serving.filter((a) => a.status === 'active').sort(byLastSeen);
  const active = activeAll.slice(0, cap);
  const recent = serving
    .filter((a) => a.status !== 'active' && parseTime(a.lastSeen) !== null)
    .sort(byLastSeen)
    .slice(0, Math.max(0, cap - active.length));
  return {
    active,
    moreActive: activeAll.length - active.length,
    recent,
    resting: activeAll.length === 0 && recent.length > 0,
    empty: activeAll.length === 0 && recent.length === 0,
  };
}

/** How a last session ended, in words. */
export const END_LABEL: Readonly<Record<EndOutcome, string>> = {
  completed: 'Ended cleanly',
  failed: 'Fell silent: stopped by an error',
  abandoned: 'Went quiet',
};
