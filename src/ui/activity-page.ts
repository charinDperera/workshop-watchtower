/**
 * The activity timeline's filters and links (`/activity?agent=&event=&before=`). Pure.
 * Paging itself is Paul's (`GET /api/activity`, `src/server/services/activity-history.ts`); these
 * helpers only read the page's query and build its links. Owner: Luka.
 */
import { parseIsoTimestamp } from '../shared/iso-time';
import { HOOK_EVENTS, type ActivityEvent } from '../shared/types';

/** Plain words for the event filter. */
export const EVENT_LABELS: Readonly<Record<string, string>> = {
  SessionStart: 'Session opened',
  UserPromptSubmit: 'Prompt received',
  PreToolUse: 'Tool began',
  PostToolUse: 'Tool finished',
  PostToolUseFailure: 'Tool failed',
  SubagentStart: 'Subagent summoned',
  SubagentStop: 'Subagent handed back',
  Stop: 'Turn finished',
  StopFailure: 'Stopped with an error',
  SessionEnd: 'Session closed',
};

export const PAGE_SIZE = 50;

export interface ActivityFilter {
  /** Lower-case agent slug. */
  agent: string | null;
  /** One of `HOOK_EVENTS`. */
  event: string | null;
  /** ISO timestamp from the previous page's `nextBefore` (exclusive). */
  before: string | null;
}

export interface ParsedActivityFilter {
  filter: ActivityFilter;
  /** Parameters that were present but not understood; they are not applied. */
  ignored: string[];
}

/** Same shape as the API accepts (`src/server/schemas/activity-query.ts`). */
const SLUG = /^[a-z0-9][a-z0-9._:-]{0,199}$/;

export function parseActivityFilter(params: URLSearchParams): ParsedActivityFilter {
  const ignored: string[] = [];
  const read = (key: string) => {
    const values = params
      .getAll(key)
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length > 1) ignored.push(key);
    return values.length === 1 ? (values[0] ?? null) : null;
  };

  let agent = read('agent')?.toLowerCase() ?? null;
  if (agent && !SLUG.test(agent)) {
    ignored.push('agent');
    agent = null;
  }
  let event = read('event');
  if (event && !(HOOK_EVENTS as readonly string[]).includes(event)) {
    ignored.push('event');
    event = null;
  }
  let before = read('before');
  if (before && parseIsoTimestamp(before) === null) {
    ignored.push('before');
    before = null;
  }
  return { filter: { agent, event, before }, ignored: [...new Set(ignored)] };
}

export function matchesActivity(
  e: ActivityEvent,
  filter: Pick<ActivityFilter, 'agent' | 'event'>,
): boolean {
  if (filter.agent && e.agent !== filter.agent) return false;
  if (filter.event && e.event !== filter.event) return false;
  return true;
}

/** `?agent=…&event=…&before=…&limit=…`; empty values are dropped. */
export function activityQuery(filter: Partial<ActivityFilter> & { limit?: number }): string {
  const params = new URLSearchParams();
  if (filter.agent) params.set('agent', filter.agent);
  if (filter.event) params.set('event', filter.event);
  if (filter.before) params.set('before', filter.before);
  if (filter.limit) params.set('limit', String(filter.limit));
  const text = params.toString();
  return text ? `?${text}` : '';
}
