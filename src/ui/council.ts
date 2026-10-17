/**
 * The Council as a hierarchy, derived from the agents alone: the Overseers at the top, the
 * Counsel set apart, and the workers grouped by station in the Order of Work.
 * Pure and data-driven: no agent or station names are written here.
 */
import type { Agent, PipelineStage } from '../shared/types';
import { relativeTime } from './format';

export interface CouncilStation {
  /** Stable key, the lower-cased station name (`''` for workers without a station). */
  key: string;
  /** Display name, e.g. `Build`, or the label for workers without a station. */
  title: string;
  /** 1-based place in the Order of Work, or null for a station outside it. */
  order: number | null;
  members: Agent[];
}

export interface CouncilTiers {
  overseers: Agent[];
  counsel: Agent[];
  stations: CouncilStation[];
  /** Every agent placed in the tree (not retired), in tree order. */
  count: number;
}

/** Shown for workers whose roster row has no station. */
export const UNSTATIONED_TITLE = 'Awaiting a station';

const keyOf = (text: string) => text.trim().toLowerCase();

/**
 * Splits the agents into tiers. Retired agents are left out (they rest in the Soul Binder).
 * Stations follow the Order of Work (`stages`, matched on id or title); stations it does not
 * know come next, in roster order; workers without a station come last.
 */
export function councilTiers(
  agents: readonly Agent[],
  stages: readonly Pick<PipelineStage, 'id' | 'title'>[] = [],
): CouncilTiers {
  const placed = agents.filter((a) => a.status !== 'retired');
  const overseers = placed.filter((a) => a.rank === 'overseer');
  const counsel = placed.filter((a) => a.rank === 'counsel');
  const workers = placed.filter((a) => a.rank !== 'overseer' && a.rank !== 'counsel');

  // Order of Work positions, by both id and title.
  const known = new Map<string, { title: string; order: number }>();
  stages.forEach((stage, i) => {
    const entry = { title: stage.title, order: i + 1 };
    known.set(keyOf(stage.id), entry);
    known.set(keyOf(stage.title), entry);
  });

  const groups = new Map<string, CouncilStation>();
  for (const agent of workers) {
    const raw = agent.station?.trim() ?? '';
    const match =
      (agent.stage ? known.get(keyOf(agent.stage)) : undefined) ??
      (raw ? known.get(keyOf(raw)) : undefined);
    const key = match ? keyOf(match.title) : keyOf(raw);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: match?.title ?? (raw || UNSTATIONED_TITLE),
        order: match?.order ?? null,
        members: [],
      };
      groups.set(key, group);
    }
    group.members.push(agent);
  }

  // Map iteration keeps first-seen (roster) order, which breaks ties among unknown stations.
  const rank = (s: CouncilStation) =>
    s.key === '' ? Number.MAX_SAFE_INTEGER : (s.order ?? stages.length + 1);
  const stations = [...groups.values()]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => s);

  return {
    overseers,
    counsel,
    stations,
    count: overseers.length + counsel.length + workers.length,
  };
}

/** The first clause of a role: `Backend Architect: business logic` reads `Backend Architect`. */
export function firstClause(text: string | null | undefined): string | null {
  if (!text) return null;
  const clause = text.split(/\s*(?:[:;,.(]|\s[-–—]\s)\s*/)[0]?.trim() ?? '';
  return clause || null;
}

/** The text after the first clause, or null when there is none. */
function afterFirstClause(text: string): string | null {
  const match = /^[^:;,.(]*?(?:[:;,.(]|\s[-–—]\s)\s*(.+)$/.exec(text.trim());
  const rest = match?.[1]?.trim() ?? '';
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
}

/**
 * What the tree writes under a sigil: the epithet (gold tag) and a one-line role.
 * Without a title, the role's first clause becomes the epithet and the rest of the role
 * the line beneath, so nothing is said twice.
 */
export function agentLines(agent: Pick<Agent, 'title' | 'role'>): {
  epithet: string | null;
  summary: string | null;
} {
  const title = agent.title?.trim() || null;
  if (title) return { epithet: title, summary: firstClause(agent.role) };
  return {
    epithet: firstClause(agent.role),
    summary: agent.role ? afterFirstClause(agent.role) : null,
  };
}

/** Where the agent stands, in words: "Overseer of The Council", "Serves at Build". */
export function rankLabel(agent: Pick<Agent, 'rank' | 'station'>): string {
  if (agent.rank === 'overseer') return 'Overseer of The Council';
  if (agent.rank === 'counsel') return 'Counsel to The Council';
  const station = agent.station?.trim();
  return station ? `Serves at ${station}` : 'Serves The Council, awaiting a station';
}

/** Tier headings, singular or plural by count. */
export function tierTitle(tier: 'overseer' | 'counsel', count: number): string {
  if (tier === 'overseer') return count === 1 ? 'The Overseer' : 'The Overseers';
  return 'The Counsel';
}

export type Liveness =
  | { kind: 'active' }
  | { kind: 'idle' }
  | { kind: 'retired' }
  | { kind: 'failed'; at: string }
  | { kind: 'abandoned'; at: string };

/**
 * The honest state of an agent. Only `status === 'active'` (open and heard from in the last
 * five minutes) reads Active. A silent agent whose last session ended badly says how.
 */
export function liveness(agent: Pick<Agent, 'status' | 'lastEnd'>): Liveness {
  if (agent.status === 'active') return { kind: 'active' };
  if (agent.status === 'retired') return { kind: 'retired' };
  const end = agent.lastEnd;
  if (end?.outcome === 'failed') return { kind: 'failed', at: end.at };
  if (end?.outcome === 'abandoned') return { kind: 'abandoned', at: end.at };
  return { kind: 'idle' };
}

/** The words for a silent agent's last end; the time is shown next to them. */
export function silenceLabel(state: Liveness): string | null {
  if (state.kind === 'failed') return 'Fell silent: stopped by an error';
  if (state.kind === 'abandoned') return 'Went quiet';
  return null;
}

/** The whole note as one line of text, e.g. for announcements or a plain list. */
export function silenceNote(state: Liveness, now: number): string | null {
  const label = silenceLabel(state);
  return label && 'at' in state ? `${label}, ${relativeTime(state.at, now)}` : null;
}

/** Roman numerals for station order (I to XXXIX is plenty), else the number. */
export function numeral(n: number): string {
  if (n < 1 || n > 39) return String(n);
  const tens = ['', 'X', 'XX', 'XXX'][Math.floor(n / 10)] ?? '';
  const ones = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n % 10] ?? '';
  return tens + ones;
}

/**
 * What the tree island needs from a snapshot to render first: the agents without their
 * event history (the stream brings everything else), and the stages for the order.
 */
export function councilSeed(snapshot: {
  agents: readonly Agent[];
  pipeline: readonly Pick<PipelineStage, 'id' | 'title'>[];
}): { agents: Agent[]; stages: Pick<PipelineStage, 'id' | 'title'>[] } {
  return {
    agents: snapshot.agents.map((agent) => ({ ...agent, recentEvents: [] })),
    stages: snapshot.pipeline.map(({ id, title }) => ({ id, title })),
  };
}
