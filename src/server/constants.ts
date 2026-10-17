import type { WingId } from '../shared/types';

export { RECORD_STATUSES, RECORD_TYPES } from '../shared/constants';

/** Fixed workstation-relative locations of the sources (SPEC section 2). */
export const PATHS = {
  roster: 'ROSTER.md',
  constitution: 'CLAUDE.md',
  agentsDir: '.claude/agents',
  soulBinder: 'hueco-mundo/soul-binder/SOUL-BINDER.md',
  limforia: 'limforia',
  intel: 'intel',
  catalog: 'limforia/CATALOG.md',
  auditHall: 'limforia/audit-hall',
  templates: 'limforia/templates',
  apps: 'apps',
  events: '.watchtower/events.jsonl',
  /** The hook logger rotates `events.jsonl` here at 5 MB, keeping one backup (SPEC section 4). */
  eventsBackup: '.watchtower/events.1.jsonl',
} as const;

/** The only Host header values answered by default (defined with the guard). */
export { DEFAULT_ALLOWED_HOSTS as ALLOWED_HOSTS } from './security/request-guard';

export const LIMFORIA_WINGS: readonly WingId[] = [
  'chronicles',
  'audit-hall',
  'reliquary',
  'vault-of-ideas',
  'scriptorium',
  'templates',
];

/**
 * The slug the hook logger writes for the main agent (a payload naming no agent). This is the
 * logger's protocol value, not an agent: events carrying it are attributed to the roster's
 * Overseer, whoever that is.
 */
export const LOGGER_MAIN_AGENT = 'michael';

/**
 * An open session (a subagent started and not stopped, or a main-agent turn) counts as
 * `active` only while its agent was heard from within this window. Past it, the run is
 * treated as abandoned (for example a session killed by a usage limit).
 */
export const ACTIVE_SILENCE_MS = 300_000;

/** Number of newest activity events carried in a snapshot. */
export const ACTIVITY_LIMIT = 200;

/** Number of newest events carried per agent in `Agent.recentEvents`. */
export const AGENT_RECENT_EVENTS = 25;

/** `GET /api/activity` page size: default and the largest allowed `limit`. */
export const ACTIVITY_PAGE_DEFAULT = 100;
export const ACTIVITY_PAGE_MAX = 500;

/** Number of workstation commits carried in a snapshot. */
export const COMMIT_LIMIT = 50;

/** Every git call is killed after this long. */
export const GIT_TIMEOUT_MS = 5_000;

/** Debounce for file-change bursts before a new snapshot is built (SPEC section 5). */
export const WATCH_DEBOUNCE_MS = 300;

/** SSE keep-alive comment interval (SPEC section 5). */
export const SSE_PING_MS = 15_000;
