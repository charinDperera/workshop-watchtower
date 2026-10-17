/**
 * Strict validation of the `GET /api/activity` query string. Anything not in the contract is
 * rejected with a message, rather than ignored, so a typo never silently widens a filter.
 */
import { ACTIVITY_PAGE_DEFAULT, ACTIVITY_PAGE_MAX } from '../constants';
import type { ActivityQuery } from '../services/activity-history';
import { HOOK_EVENTS } from '../../shared/types';
import { parseIsoTimestamp } from '../../shared/iso-time';
import { BadRequestError } from '../errors/app-error';

export { parseIsoTimestamp };

export type ActivityQueryResult = { ok: true; query: ActivityQuery } | { ok: false; error: string };

const PARAMS = new Set(['agent', 'event', 'before', 'limit']);

/**
 * Agent slugs as the hook logger writes them: the lower-cased subagent type (which may carry
 * a `plugin:` prefix), capped at the logger's 200 characters.
 */
const SLUG = /^[a-z0-9][a-z0-9._:-]{0,199}$/;

const LIMIT = /^[1-9]\d{0,2}$/;

/** The single value of a parameter that may appear at most once. */
function single(params: URLSearchParams, name: string): { value: string | null } | string {
  const values = params.getAll(name);
  if (values.length > 1) return `Give "${name}" at most once`;
  return { value: values[0] ?? null };
}

export function parseActivityQuery(params: URLSearchParams): ActivityQueryResult {
  for (const name of new Set(params.keys())) {
    if (!PARAMS.has(name)) return { ok: false, error: `Unknown parameter "${name}"` };
  }

  const agent = single(params, 'agent');
  if (typeof agent === 'string') return { ok: false, error: agent };
  if (agent.value !== null && !SLUG.test(agent.value)) {
    return { ok: false, error: '"agent" must be a lower-case agent slug' };
  }

  const events = params.getAll('event');
  const known: readonly string[] = HOOK_EVENTS;
  const unknown = events.find((name) => !known.includes(name));
  if (unknown !== undefined) {
    return { ok: false, error: `"event" must be one of: ${HOOK_EVENTS.join(', ')}` };
  }

  const before = single(params, 'before');
  if (typeof before === 'string') return { ok: false, error: before };
  let beforeMs: number | null = null;
  if (before.value !== null) {
    beforeMs = parseIsoTimestamp(before.value);
    if (beforeMs === null) {
      return { ok: false, error: '"before" must be an ISO 8601 timestamp with a time zone' };
    }
  }

  const limit = single(params, 'limit');
  if (typeof limit === 'string') return { ok: false, error: limit };
  let limitValue = ACTIVITY_PAGE_DEFAULT;
  if (limit.value !== null) {
    limitValue = LIMIT.test(limit.value) ? Number(limit.value) : NaN;
    if (!(limitValue >= 1 && limitValue <= ACTIVITY_PAGE_MAX)) {
      return { ok: false, error: `"limit" must be an integer from 1 to ${ACTIVITY_PAGE_MAX}` };
    }
  }

  return {
    ok: true,
    query: {
      agent: agent.value,
      events: [...new Set(events)],
      before: beforeMs,
      limit: limitValue,
    },
  };
}

/** `parseActivityQuery`, throwing a `BadRequestError` for bad input (for handlers). */
export function activityQuery(params: URLSearchParams): ActivityQuery {
  const parsed = parseActivityQuery(params);
  if (!parsed.ok) throw new BadRequestError(parsed.error);
  return parsed.query;
}
