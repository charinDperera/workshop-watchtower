/**
 * The host as data: roster ⋈ definitions ⋈ live state, and the Order of Work pipeline.
 * Nothing here names an agent or a station: both come from ROSTER.md, so a new, renamed or
 * retired agent, or a new station, needs no change to the app.
 */
import type {
  ActivityEvent,
  Agent,
  AgentDefinition,
  PipelineStage,
  PipelineStageId,
  RetiredAgent,
  RosterEntry,
} from '../../shared/types';
import { LOGGER_MAIN_AGENT } from '../constants';
import type { LiveState } from './activity';

export function slugOf(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The main agent's slug: the first Overseer on the roster. Without one, the hook logger's
 * main-agent value, so main-agent events still have somewhere to go.
 */
export function findMainSlug(roster: RosterEntry[]): string {
  const main = roster.find((entry) => entry.rank === 'overseer');
  return main ? slugOf(main.name) : LOGGER_MAIN_AGENT;
}

/**
 * A station's stage id: trimmed, lower-cased, runs of anything but letters and digits as `-`
 * (`Build` -> `build`, `Data Ops` -> `data-ops`). `null` when nothing is left.
 */
export function stationId(station: string | null): PipelineStageId | null {
  if (station === null) return null;
  const id = station
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return id === '' ? null : id;
}

/** A worker's stage id; overseer and counsel stand outside the pipeline. */
function stageOf(entry: RosterEntry | null): PipelineStageId | null {
  return entry !== null && entry.rank === 'worker' ? stationId(entry.station) : null;
}

export interface AgentJoinInput {
  roster: RosterEntry[];
  definitions: AgentDefinition[];
  retired: RetiredAgent[];
  live: Map<string, LiveState>;
  /** Audit-hall record paths keyed by agent slug. */
  auditLogs: Map<string, string[]>;
  /** Each pardoned agent's latest pardon date (optional). */
  pardonedAt?: Map<string, string>;
  /** Each agent's newest events, newest first, keyed by agent slug. */
  recentEvents: Map<string, ActivityEvent[]>;
}

/**
 * Roster ⋈ definitions (SPEC section 3). Roster order first, then definitions that have
 * no roster row (as workers with no station). An agent whose name is in the Soul Binder gets
 * status `retired`.
 */
export function joinAgents(input: AgentJoinInput): Agent[] {
  const retiredSlugs = new Set(input.retired.map((r) => slugOf(r.name)));
  const definitions = new Map<string, AgentDefinition>();
  for (const definition of input.definitions) {
    const slug = slugOf(definition.name);
    if (!definitions.has(slug)) definitions.set(slug, definition);
  }

  const build = (slug: string, entry: RosterEntry | null, name: string): Agent => {
    const live = input.live.get(slug);
    const retired = retiredSlugs.has(slug);
    const active = !retired && live?.active === true;
    const rank = entry?.rank ?? 'worker';
    return {
      name,
      slug,
      title: entry?.title ?? null,
      rank,
      station: entry?.station ?? null,
      role: entry?.role ?? null,
      isMain: rank === 'overseer',
      inRoster: entry !== null,
      rosterTools: entry?.tools ?? null,
      created: entry?.created ?? null,
      strikes: entry?.strikes ?? null,
      strikeLimit: entry?.strikeLimit ?? 3,
      definition: definitions.get(slug) ?? null,
      status: retired ? 'retired' : active ? 'active' : 'idle',
      activeReason: active ? (live?.reason ?? null) : null,
      currentTool: active ? (live?.currentTool ?? null) : null,
      lastSeen: live?.lastSeen ?? null,
      lastEnd: live?.lastEnd ?? null,
      stage: stageOf(entry),
      auditLogs: input.auditLogs.get(slug) ?? [],
      pardonedAt: input.pardonedAt?.get(slug) ?? null,
      recentEvents: input.recentEvents.get(slug) ?? [],
    };
  };

  const agents: Agent[] = [];
  const seen = new Set<string>();
  for (const entry of input.roster) {
    const slug = slugOf(entry.name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    agents.push(build(slug, entry, entry.name));
  }
  const orphans = [...definitions.entries()]
    .filter(([slug]) => !seen.has(slug))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [slug, definition] of orphans) {
    const display = definition.name.charAt(0).toUpperCase() + definition.name.slice(1);
    agents.push(build(slug, null, display));
  }
  return agents;
}

/**
 * The Order of Work: one stage per distinct worker station, in the order the stations first
 * appear in the roster (matched trimmed and case-insensitively; the title is the first
 * spelling). A station that appears again later joins its first stage. A stage is lit when
 * one of its agents is active.
 */
export function derivePipeline(agents: Agent[]): PipelineStage[] {
  const stages = new Map<PipelineStageId, PipelineStage>();
  for (const agent of agents) {
    if (agent.stage === null || agent.station === null) continue;
    let stage = stages.get(agent.stage);
    if (!stage) {
      stage = {
        id: agent.stage,
        title: agent.station.trim(),
        agents: [],
        lit: false,
        activeAgents: [],
      };
      stages.set(agent.stage, stage);
    }
    stage.agents.push(agent.slug);
    if (agent.status === 'active') {
      stage.activeAgents.push(agent.slug);
      stage.lit = true;
    }
  }
  return [...stages.values()];
}

/** Earliest time an agent's derived status changes on its own, for scheduling a refresh. */
export function nextExpiry(live: Map<string, LiveState>): number | null {
  let next: number | null = null;
  for (const state of live.values()) {
    if (state.expiresAt !== null && (next === null || state.expiresAt < next)) {
      next = state.expiresAt;
    }
  }
  return next;
}
