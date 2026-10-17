import type { ArchiveRecord, CatalogEntry, RecordHeader, WingId, WingSummary } from '../../shared/types';
import { LIMFORIA_WINGS } from '../constants';
import type { RawCatalogEntry } from '../sources/parse/registers';
import { slugOf } from './agents';

const WING_ORDER: readonly WingId[] = [...LIMFORIA_WINGS, 'intel'];

/** Record counts per wing, in a fixed order, including empty wings. */
export function countWings(records: ArchiveRecord[]): WingSummary[] {
  return WING_ORDER.map((id) => {
    const inWing = records.filter((r) => r.wing === id);
    const subWings: Record<string, number> = {};
    for (const record of inWing) {
      if (record.subWing) subWings[record.subWing] = (subWings[record.subWing] ?? 0) + 1;
    }
    return { id, count: inWing.length, subWings };
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

/** Audit logs that count as strikes: outcome `strike` or `executed`; `dismissed` does not. */
export function isStrikeLog(header: RecordHeader): boolean {
  const outcome = header.extra.outcome;
  return outcome === undefined || outcome === 'strike' || outcome === 'executed';
}

export interface AuditIndex {
  /** Every audit log about an agent, keyed by slug (for the agent pages). */
  bySubject: Map<string, string[]>;
  /** The subset that counts as strikes (for check 5). */
  strikes: Map<string, string[]>;
  unattributed: string[];
}

/** Groups audit-hall records by the agent they are about. */
export function indexAuditLogs(
  audits: { record: ArchiveRecord; subject: string | null }[],
): AuditIndex {
  const bySubject = new Map<string, string[]>();
  const strikes = new Map<string, string[]>();
  const unattributed: string[] = [];
  const push = (map: Map<string, string[]>, key: string, path: string) => {
    map.set(key, [...(map.get(key) ?? []), path]);
  };
  for (const { record, subject } of audits) {
    if (subject === null) {
      unattributed.push(record.path);
      continue;
    }
    const slug = slugOf(subject);
    push(bySubject, slug, record.path);
    if (isStrikeLog(record.header)) push(strikes, slug, record.path);
  }
  return { bySubject, strikes, unattributed };
}
