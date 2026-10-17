/**
 * The archive page's filters (`/limforia?wing=&type=&status=&tag=&agent=`). Pure, so the
 * server render and the live island filter the same way. Owner: Luka.
 */
import { RECORD_STATUSES, RECORD_TYPES } from '../shared/constants';
import type { ArchiveRecord, WingId } from '../shared/types';
import { isWingId as isWellFormedWing } from '../shared/wings';

export interface ArchiveFilter {
  wing: WingId | null;
  type: string | null;
  status: string | null;
  tag: string | null;
  agent: string | null;
}

export const FILTER_KEYS = ['wing', 'type', 'status', 'tag', 'agent'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const EMPTY_FILTER: ArchiveFilter = {
  wing: null,
  type: null,
  status: null,
  tag: null,
  agent: null,
};

/** Longer query values are ignored: no header value in the archive is this long. */
const MAX_VALUE_LENGTH = 100;

function clean(value: string | null): string | null {
  const v = value?.trim();
  return v && v.length <= MAX_VALUE_LENGTH ? v : null;
}

/**
 * A wing the filter may use: a well-formed folder name and, when the archive's wings are
 * known (from the snapshot), one of them. Wings are discovered, never a fixed list.
 */
export function isWingId(value: string, known?: readonly string[]): value is WingId {
  return isWellFormedWing(value) && (known === undefined || known.includes(value));
}

export interface ParsedFilter {
  filter: ArchiveFilter;
  /** Query values that were not understood (shown to the user, never applied). */
  ignored: string[];
}

/** @param knownWings the archive's wing ids, when known; unknown wings are then ignored. */
export function parseArchiveFilter(
  params: URLSearchParams,
  knownWings?: readonly string[],
): ParsedFilter {
  const ignored: string[] = [];
  const rawWing = clean(params.get('wing'));
  let wing: WingId | null = null;
  if (rawWing && isWingId(rawWing, knownWings)) wing = rawWing;
  else if (rawWing) ignored.push(`wing "${rawWing}"`);
  return {
    filter: {
      wing,
      type: clean(params.get('type')),
      status: clean(params.get('status')),
      tag: clean(params.get('tag')),
      agent: clean(params.get('agent')),
    },
    ignored,
  };
}

export function hasFilter(filter: ArchiveFilter): boolean {
  return FILTER_KEYS.some((key) => filter[key] !== null);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Templates are not records: they show only when their own wing is chosen. */
function inScope(record: ArchiveRecord, filter: ArchiveFilter): boolean {
  return filter.wing === 'templates' ? record.isTemplate : !record.isTemplate;
}

export function matchesFilter(record: ArchiveRecord, filter: ArchiveFilter): boolean {
  const { header } = record;
  if (!inScope(record, filter)) return false;
  if (filter.wing && record.wing !== filter.wing) return false;
  if (filter.type && !(header.type && same(header.type, filter.type))) return false;
  if (filter.status && !(header.status && same(header.status, filter.status))) return false;
  if (filter.tag && !header.tags.some((t) => same(t, filter.tag ?? ''))) return false;
  if (filter.agent && !header.agents.some((a) => same(a, filter.agent ?? ''))) return false;
  return true;
}

/** Newest first by header date, then by title. Records without a date come last. */
export function compareRecords(a: ArchiveRecord, b: ArchiveRecord): number {
  const da = a.header.date ?? '';
  const db = b.header.date ?? '';
  if (da !== db) return da < db ? 1 : -1;
  return a.title.localeCompare(b.title, 'en-GB');
}

export function filterRecords(
  records: readonly ArchiveRecord[],
  filter: ArchiveFilter,
): ArchiveRecord[] {
  return records.filter((r) => matchesFilter(r, filter)).sort(compareRecords);
}

/** Records the filter could ever show (the denominator of "Showing n of m"). */
export function scopeCount(records: readonly ArchiveRecord[], filter: ArchiveFilter): number {
  return records.filter((r) => inScope(r, filter)).length;
}

export interface FilterOption {
  value: string;
  count: number;
}

export interface FilterOptions {
  type: FilterOption[];
  status: FilterOption[];
  tag: FilterOption[];
  agent: FilterOption[];
}

function tally(values: readonly string[], known: readonly string[] = []): FilterOption[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order = (v: string) => {
    const i = known.indexOf(v);
    return i === -1 ? known.length : i;
  };
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => order(a.value) - order(b.value) || a.value.localeCompare(b.value, 'en-GB'));
}

/** Values present in the archive, with counts, for the filter <select>s. */
export function filterOptions(records: readonly ArchiveRecord[]): FilterOptions {
  const real = records.filter((r) => !r.isTemplate);
  return {
    type: tally(
      real.flatMap((r) => (r.header.type ? [r.header.type] : [])),
      RECORD_TYPES,
    ),
    status: tally(
      real.flatMap((r) => (r.header.status ? [r.header.status] : [])),
      RECORD_STATUSES,
    ),
    tag: tally(real.flatMap((r) => r.header.tags)),
    agent: tally(real.flatMap((r) => r.header.agents)),
  };
}

/** Adds the selected value when the archive no longer holds it, so the form shows it. */
export function withSelected(options: FilterOption[], selected: string | null): FilterOption[] {
  if (!selected || options.some((o) => same(o.value, selected))) return options;
  return [{ value: selected, count: 0 }, ...options];
}

/** `?wing=…&type=…` for the given filter plus extra parameters; empty values are dropped. */
export function archiveQuery(
  filter: ArchiveFilter,
  extra: Record<string, string | null | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = filter[key];
    if (v) params.set(key, v);
  }
  for (const [key, v] of Object.entries(extra)) if (v) params.set(key, v);
  const text = params.toString();
  return text ? `?${text}` : '';
}
