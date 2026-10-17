/** Names and short descriptions for the parts of the workstation, in one place. */
import type { WingId } from '../shared/types';

export interface WingLabel {
  title: string;
  holds: string;
}

/** From the table in CLAUDE.md, Commandment 5. */
export const WING_LABELS: Readonly<Record<WingId, WingLabel>> = {
  chronicles: { title: 'Chronicles', holds: 'Records of archived chats and contexts' },
  'audit-hall': { title: 'Audit Hall', holds: 'Audit logs of strikes and executions' },
  reliquary: { title: 'Reliquary', holds: 'Definitions and data of retired agents' },
  'vault-of-ideas': { title: 'Vault of Ideas', holds: 'Old and shelved project ideas' },
  scriptorium: { title: 'Scriptorium', holds: 'Features, decisions, caveats and issues' },
  templates: { title: 'Templates', holds: 'Templates for chronicles and audit logs' },
  intel: { title: 'Intel', holds: "Uriel's research reports" },
  other: { title: 'Other', holds: 'Records outside the named wings' },
};

/**
 * Chip tones for a record's `status` header (Commandment 5). Unknown statuses get none.
 * Every tone pairs the word with a colour, never the colour alone.
 */
export const STATUS_TONE: Readonly<Record<string, string>> = {
  open: 'border-warn/60 text-warn',
  closed: 'border-line-strong text-ink-muted',
  accepted: 'border-active/60 text-active',
  superseded: 'border-retired/60 text-retired',
};

export interface NavItem {
  href: string;
  label: string;
  /** Matches the current path for `aria-current`. */
  match: (path: string) => boolean;
}

const exact = (href: string) => (path: string) => path === href || path === `${href}/`;
const section = (href: string) => (path: string) => path === href || path.startsWith(`${href}/`);

/** Every route in SPEC section 6, in order. */
export const NAV: readonly NavItem[] = [
  { href: '/', label: 'Overview', match: exact('/') },
  { href: '/host', label: 'The Council', match: section('/host') },
  { href: '/limforia', label: 'Limforia', match: section('/limforia') },
  { href: '/soul-binder', label: 'Soul Binder', match: section('/soul-binder') },
  { href: '/laws', label: 'Laws', match: section('/laws') },
  { href: '/activity', label: 'Activity', match: section('/activity') },
  { href: '/git', label: 'Git', match: section('/git') },
];

/** Link to a record in the archive viewer (owned by Luka's `/limforia` page). */
export function recordHref(path: string): string {
  return `/limforia?record=${encodeURIComponent(path)}`;
}

export function agentHref(slug: string): string {
  return `/host/${encodeURIComponent(slug)}`;
}
