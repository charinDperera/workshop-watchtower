/**
 * Parsers for the workstation's three registers: ROSTER.md, SOUL-BINDER.md and CATALOG.md.
 * Pure functions; a missing file is passed in as `null` and yields an empty result.
 */
import { posix } from 'node:path';
import type { AgentRank, RetiredAgent, RosterEntry, SourceProblem } from '../../../shared/types';
import { PATHS } from '../../constants';
import { cell, extractLinks, findTable, parseMarkdownTables } from './markdown-table';

export interface Parsed<T> {
  items: T[];
  /** False when the source file does not exist. */
  found: boolean;
  problems: SourceProblem[];
}

/** Parses `n / 3`. Returns `null` for anything else. */
export function parseStrikes(text: string): { strikes: number | null; limit: number } {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
  if (!match) return { strikes: null, limit: 3 };
  return { strikes: Number(match[1]), limit: Number(match[2]) };
}

const RANKS: readonly AgentRank[] = ['overseer', 'counsel', 'worker'];
/** Placeholders the roster uses for "none". */
const NONE = /^(?:—|–|-)?$/;

/** A cell's text, or `null` when it is empty or a placeholder such as `—`. */
export function optionalCell(text: string): string | null {
  const value = text.trim();
  return NONE.test(value) ? null : value;
}

/**
 * The rank in a Rank cell, case-insensitive. Missing -> `worker`; unknown -> `worker` and
 * `unknown: true`, so the caller can report it.
 */
export function parseRank(text: string): { rank: AgentRank; unknown: boolean } {
  const value = optionalCell(text);
  if (value === null) return { rank: 'worker', unknown: false };
  const rank = RANKS.find((r) => r === value.toLowerCase());
  return rank ? { rank, unknown: false } : { rank: 'worker', unknown: true };
}

/** Legacy rosters (no Rank column) marked the main agent by its role. */
const LEGACY_MAIN_ROLE = /^main agent\b/i;

export function parseRoster(markdown: string | null): Parsed<RosterEntry> {
  const source = PATHS.roster;
  if (markdown === null) {
    return { items: [], found: false, problems: [{ source, message: 'File not found' }] };
  }
  const table = findTable(parseMarkdownTables(markdown), ['Name', 'Role']);
  if (!table) {
    return { items: [], found: true, problems: [{ source, message: 'No agent table found' }] };
  }

  const problems: SourceProblem[] = [];
  const hasRank = table.headers.some((h) => h.trim().toLowerCase() === 'rank');
  const items = table.rows
    .map((row): RosterEntry => {
      const name = cell(row, 'Name');
      const role = cell(row, 'Role');
      let rank: AgentRank;
      if (hasRank) {
        const parsed = parseRank(cell(row, 'Rank'));
        rank = parsed.rank;
        if (parsed.unknown) {
          problems.push({
            source,
            message: `Unknown rank for ${name}: "${cell(row, 'Rank')}" (treated as Worker)`,
          });
        }
      } else {
        rank = LEGACY_MAIN_ROLE.test(role) ? 'overseer' : 'worker';
      }
      const strikesCell = cell(row, 'Strikes');
      const { strikes, limit } = parseStrikes(strikesCell);
      if (strikes === null) {
        problems.push({ source, message: `Unreadable strike count for ${name}: "${strikesCell}"` });
      }
      return {
        name,
        title: optionalCell(cell(row, 'Title')),
        rank,
        station: optionalCell(cell(row, 'Station')),
        role,
        tools: cell(row, 'Tools'),
        created: cell(row, 'Created'),
        strikes,
        strikeLimit: limit,
      };
    })
    .filter((entry) => {
      if (entry.name !== '') return true;
      problems.push({ source, message: 'A roster row has no name' });
      return false;
    });
  return { items, found: true, problems };
}

/** Resolves a link written inside `fromFile` to a workstation-relative path, or `null`. */
export function resolveRelativeLink(fromFile: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  const target = href.split('#')[0]?.split('?')[0] ?? '';
  if (target === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return null;
  }
  const joined = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromFile), decoded.replace(/\\/g, '/')));
  if (joined.startsWith('..') || posix.isAbsolute(joined)) return null;
  return joined;
}

export function parseSoulBinder(markdown: string | null): Parsed<RetiredAgent> {
  const source = PATHS.soulBinder;
  if (markdown === null) {
    return { items: [], found: false, problems: [{ source, message: 'File not found' }] };
  }
  const table = findTable(parseMarkdownTables(markdown), ['Name']);
  if (!table) {
    return { items: [], found: true, problems: [{ source, message: 'No table found' }] };
  }
  const items = table.rows
    .filter((row) => cell(row, 'Name') !== '')
    .map((row): RetiredAgent => {
      const auditLog = cell(row, 'Audit log');
      const link = extractLinks(auditLog)[0];
      return {
        name: cell(row, 'Name'),
        role: cell(row, 'Role'),
        served: cell(row, 'Served'),
        cause: cell(row, 'Cause of retirement'),
        auditLog,
        auditLogPath: link ? resolveRelativeLink(source, link.href) : null,
      };
    });
  return { items, found: true, problems: [] };
}

/** A catalog link before it is checked against the filesystem. */
export interface RawCatalogEntry {
  section: string;
  date: string | null;
  label: string;
  href: string;
  path: string | null;
  cells: Record<string, string>;
}

export function parseCatalog(markdown: string | null): Parsed<RawCatalogEntry> {
  const source = PATHS.catalog;
  if (markdown === null) {
    return { items: [], found: false, problems: [{ source, message: 'File not found' }] };
  }
  const items: RawCatalogEntry[] = [];
  for (const table of parseMarkdownTables(markdown)) {
    for (const row of table.rows) {
      for (const value of Object.values(row)) {
        for (const link of extractLinks(value)) {
          items.push({
            section: table.section ?? '',
            date: cell(row, 'Date') || null,
            label: link.text,
            href: link.href,
            path: resolveRelativeLink(source, link.href),
            cells: { ...row },
          });
        }
      }
    }
  }
  return { items, found: true, problems: [] };
}
