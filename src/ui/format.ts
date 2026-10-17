/**
 * Display formatting shared by server-rendered components and the live island.
 * Everything here is pure and locale-fixed (`en-GB`), so the server and the browser render
 * the same text and hydration never disagrees.
 */
import type { ActivityEvent, Agent, AgentStatus, CheckResult } from '../shared/types';
import { UNATTRIBUTED_AGENT } from '../shared/types';

/** The few agent fields lists need for names and sigils; keeps island props small. */
export type AgentRef = Pick<Agent, 'slug' | 'name' | 'status'>;

export function agentRefs(agents: readonly Agent[]): AgentRef[] {
  return agents.map(({ slug, name, status }) => ({ slug, name, status }));
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Below this age a time reads "just now". */
const JUST_NOW_MS = 45 * SECOND;

export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** "just now", "3 min ago", "2 h ago", "4 d ago", then a date. Future times read "just now". */
export function relativeTime(iso: string | null | undefined, now: number): string {
  const then = parseTime(iso);
  if (then === null) return 'never';
  const age = now - then;
  if (age < JUST_NOW_MS) return 'just now';
  if (age < HOUR) return `${Math.max(1, Math.round(age / MINUTE))} min ago`;
  if (age < DAY) return `${Math.round(age / HOUR)} h ago`;
  if (age < 30 * DAY) return `${Math.round(age / DAY)} d ago`;
  return formatDate(iso);
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** `16 Oct 2026`. Plain `YYYY-MM-DD` cells are shown as dates without a time-zone shift. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (plain) {
    const [, y, m, d] = plain;
    return DATE.format(new Date(Number(y), Number(m) - 1, Number(d)));
  }
  const ms = parseTime(iso);
  return ms === null ? iso : DATE.format(ms);
}

/** `22:31:07` in the local time zone. */
export function formatClock(iso: string | null | undefined): string {
  const ms = parseTime(iso);
  return ms === null ? '--:--:--' : CLOCK.format(ms);
}

/** `16 Oct 2026, 22:31:07`, used for tooltips and `title` attributes. */
export function formatDateTime(iso: string | null | undefined): string {
  const ms = parseTime(iso);
  return ms === null ? 'unknown time' : DATE_TIME.format(ms);
}

/** `mcp__playwright__browser_click` reads `playwright: browser_click`. */
export function toolLabel(tool: string | null | undefined): string {
  if (!tool) return 'a tool';
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) return `${mcp[1]}: ${mcp[2]}`;
  return tool;
}

/** What an event says, as a short verb phrase after the agent's name. */
export function eventPhrase(event: ActivityEvent): string {
  const tool = toolLabel(event.tool);
  switch (event.event) {
    case 'SessionStart':
      return event.source ? `opened a session (${event.source})` : 'opened a session';
    case 'SessionEnd':
      return event.reason ? `closed the session (${event.reason})` : 'closed the session';
    case 'UserPromptSubmit':
      return 'received a prompt';
    case 'PreToolUse':
      return `began ${tool}`;
    case 'PostToolUse':
      return `finished ${tool}`;
    case 'PostToolUseFailure':
      return `${tool} failed`;
    case 'SubagentStart':
      return 'was summoned';
    case 'SubagentStop':
      return 'handed back';
    case 'Stop':
      return 'finished the turn';
    case 'StopFailure':
      return 'stopped with an error';
    default:
      return event.event;
  }
}

export type Tone = 'neutral' | 'active' | 'warn' | 'fail' | 'gold' | 'retired' | 'info';

/** The tone an event is drawn in: failures in red, starts and summons in green. */
export function eventTone(event: ActivityEvent): Tone {
  if (event.event === 'PostToolUseFailure' || event.event === 'StopFailure') return 'fail';
  if (event.event === 'SubagentStart' || event.event === 'UserPromptSubmit') return 'active';
  if (event.event === 'SessionStart' || event.event === 'SessionEnd') return 'info';
  return 'neutral';
}

export const STATUS_LABEL: Readonly<Record<AgentStatus, string>> = {
  active: 'Active',
  idle: 'Idle',
  retired: 'Retired',
};

export const CHECK_LABEL: Readonly<Record<CheckResult, string>> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
};

/** Upper-cases the first letter. */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `1 record`, `3 records`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** How a subagent event whose type could not be resolved is named on screen. */
export const UNATTRIBUTED_LABEL = 'Unnamed subagent';

/** True for events the server could not attribute to a named subagent. */
export function isUnattributed(slug: string): boolean {
  return slug === UNATTRIBUTED_AGENT;
}

/**
 * Display name for an event's agent slug: the roster name when known, "Unnamed subagent"
 * for unattributed events, else the slug as written.
 */
export function agentNameFor(slug: string, names: ReadonlyMap<string, string>): string {
  if (isUnattributed(slug)) return UNATTRIBUTED_LABEL;
  return names.get(slug) ?? slug;
}
