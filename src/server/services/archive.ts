import type {
  ArchiveRecord,
  CatalogEntry,
  RecordHeader,
  WingId,
  WingSummary,
} from '../../shared/types';
import { wingTitle } from '../../shared/wings';
import { PATHS } from '../constants';
import type { RawCatalogEntry } from '../sources/parse/registers';
import { toStringList } from '../sources/parse/frontmatter';
import { slugOf } from './agents';

export interface WingFolder {
  id: WingId;
  description: string;
}

/**
 * The wings: every `limforia/` subfolder except `logs/` (application logs, not an archive
 * wing), then `intel`. Described folders come first, in CLAUDE.md's table order, then the
 * rest by name. Each takes its description from CLAUDE.md, else its folder name.
 */
export function discoverWings(
  limforiaFolders: readonly string[],
  descriptions: ReadonlyMap<string, string>,
): WingFolder[] {
  const logs = PATHS.logs.split('/').slice(1).join('/');
  const folders = limforiaFolders.filter((name) => name !== logs);
  const described = [...descriptions.keys()].filter((name) => folders.includes(name));
  const rest = folders.filter((name) => !descriptions.has(name)).sort();
  return [...described, ...rest, PATHS.intel].map((id) => ({
    id,
    description: descriptions.get(id) ?? id,
  }));
}

/** Record counts per wing, in the given order, including empty wings. */
export function countWings(records: ArchiveRecord[], wings: readonly WingFolder[]): WingSummary[] {
  return wings.map(({ id, description }) => {
    const inWing = records.filter((r) => r.wing === id);
    const subWings: Record<string, number> = {};
    for (const record of inWing) {
      if (record.subWing) subWings[record.subWing] = (subWings[record.subWing] ?? 0) + 1;
    }
    return { id, title: wingTitle(id), description, count: inWing.length, subWings };
  });
}

/** Marks records that the catalog links to, and catalog entries whose target exists. */
export function crossCheckCatalog(
  records: ArchiveRecord[],
  rawEntries: RawCatalogEntry[],
  exists: (path: string) => boolean,
): { records: ArchiveRecord[]; entries: CatalogEntry[] } {
  const linked = new Set(rawEntries.map((e) => e.path).filter((p): p is string => p !== null));
  return {
    records: records.map((record) => ({ ...record, inCatalog: linked.has(record.path) })),
    entries: rawEntries.map((entry) => ({
      ...entry,
      resolves: entry.path !== null && exists(entry.path),
    })),
  };
}

/**
 * Audit log outcomes the workstation uses (the `outcome` key of an audit log's header).
 * An audit log without an outcome is a strike. Other values are kept but count as nothing.
 * `note`: an error recorded during the building stage, by the User's ruling: no strike.
 */
export const AUDIT_OUTCOMES = ['strike', 'executed', 'dismissed', 'pardon', 'note'] as const;

/** Audit logs that count as strikes: outcome `strike` or `executed` (or none). */
export function isStrikeLog(header: RecordHeader): boolean {
  const outcome = header.extra.outcome;
  return outcome === undefined || outcome === 'strike' || outcome === 'executed';
}

/** A pardon (outcome `pardon`): it forgives earlier strikes and is never a strike itself. */
export function isPardonLog(header: RecordHeader): boolean {
  return header.extra.outcome === 'pardon';
}

/** The agents a pardon names: its `pardons` list, else its `agents`, as slugs. */
export function pardonedSlugs(header: RecordHeader): string[] {
  const named = toStringList(header.extra.pardons);
  return [...new Set((named.length > 0 ? named : header.agents).map(slugOf))].filter(
    (slug) => slug !== '',
  );
}

export interface AuditIndex {
  /** Every audit log about an agent, keyed by slug (for the agent pages); pardons included. */
  bySubject: Map<string, string[]>;
  /** The strike logs that still count (dated after the agent's latest pardon), for checks 5 and 6. */
  strikes: Map<string, string[]>;
  /** Each pardoned agent's latest pardon date (`YYYY-MM-DD`). */
  pardonedAt: Map<string, string>;
  unattributed: string[];
}

/**
 * Groups audit-hall records by the agent they are about, and applies pardons: a strike log
 * dated on or before the agent's latest pardon no longer counts. A strike log without a
 * valid date always counts (it cannot be shown to be covered).
 */
export function indexAuditLogs(
  audits: { record: ArchiveRecord; subject: string | null }[],
): AuditIndex {
  const bySubject = new Map<string, string[]>();
  const pardonedAt = new Map<string, string>();
  const strikeLogs: { slug: string; path: string; date: string | null }[] = [];
  const unattributed: string[] = [];
  const push = (map: Map<string, string[]>, key: string, path: string) => {
    if (!(map.get(key) ?? []).includes(path)) map.set(key, [...(map.get(key) ?? []), path]);
  };

  for (const { record, subject } of audits) {
    const { header } = record;
    if (isPardonLog(header)) {
      const slugs = pardonedSlugs(header);
      if (slugs.length === 0 || header.date === null) {
        unattributed.push(record.path);
        continue;
      }
      for (const slug of slugs) {
        push(bySubject, slug, record.path);
        const latest = pardonedAt.get(slug);
        if (latest === undefined || header.date > latest) pardonedAt.set(slug, header.date);
      }
      continue;
    }
    if (subject === null) {
      unattributed.push(record.path);
      continue;
    }
    const slug = slugOf(subject);
    push(bySubject, slug, record.path);
    if (isStrikeLog(header)) strikeLogs.push({ slug, path: record.path, date: header.date });
  }

  const strikes = new Map<string, string[]>();
  for (const { slug, path, date } of strikeLogs) {
    const pardon = pardonedAt.get(slug);
    // ISO dates compare as strings. "On or before the pardon's date" is covered.
    const covered = pardon !== undefined && date !== null && date <= pardon;
    if (!covered) push(strikes, slug, path);
  }
  return { bySubject, strikes, pardonedAt, unattributed };
}
