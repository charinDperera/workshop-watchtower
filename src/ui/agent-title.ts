/**
 * Agent titles (epithets, e.g. "The Scribe") for the pages that name agents: record chips
 * and the activity filter. `title` comes from the roster through the snapshot; while a
 * snapshot does not carry it yet, or a cell is empty, every helper falls back to the plain
 * name. Nothing here knows an agent by name. Owner: Luka.
 */

/** The fields these helpers read. `title` is optional so older snapshots still fit. */
export interface TitledAgentSource {
  slug: string;
  name: string;
  title?: string | null;
}

/** What a record chip needs: the slug to link and the title to show, if any. */
export interface KnownAgent {
  slug: string;
  title: string | null;
}

/** Roster placeholders for "no value". */
const EMPTY_CELLS = new Set(['', '-', '—', '–']);

/** The agent's title, trimmed, or null when there is none to show. */
export function agentTitle(agent: { title?: unknown }): string | null {
  if (typeof agent.title !== 'string') return null;
  const title = agent.title.trim();
  return EMPTY_CELLS.has(title) ? null : title;
}

/** Slugs and titles of the agents a record can link to. */
export function knownAgents(agents: readonly TitledAgentSource[]): KnownAgent[] {
  return agents.map((a) => ({ slug: a.slug, title: agentTitle(a) }));
}

/** "Name, Title" for a select option or a plain label; the name alone without a title. */
export function nameWithTitle(agent: TitledAgentSource): string {
  const title = agentTitle(agent);
  return title ? `${agent.name}, ${title}` : agent.name;
}
