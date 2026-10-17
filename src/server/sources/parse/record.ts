import { posix } from 'node:path';
import type { ArchiveRecord, RecordHeader, WingId } from '../../../shared/types';
import { LIMFORIA_WINGS, RECORD_STATUSES, RECORD_TYPES } from '../../constants';
import { splitFrontmatter, toOptionalString, toStringList } from './frontmatter';

const HEADER_KEYS = ['type', 'date', 'agents', 'tags', 'status'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as `YYYY-MM-DD`. */
export function isIsoDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** Text of the first `# ` heading outside the header, or `null`. */
export function firstHeading(body: string): string | null {
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Wing and sub-wing of a workstation-relative path. */
export function classifyPath(path: string): { wing: WingId; subWing: string | null } {
  const [top, second, third] = path.split('/');
  if (top === 'intel') return { wing: 'intel', subWing: null };
  if (top === 'limforia' && second && third !== undefined) {
    const wing = (LIMFORIA_WINGS as readonly string[]).includes(second)
      ? (second as WingId)
      : 'other';
    const isNested = wing === 'scriptorium' && path.split('/').length > 3;
    return { wing, subWing: isNested ? (third ?? null) : null };
  }
  return { wing: 'other', subWing: null };
}

/** Validates a parsed header mapping against the Constitution's record header. */
export function validateHeader(data: Record<string, unknown>): {
  header: RecordHeader;
  problems: string[];
} {
  const problems: string[] = [];
  for (const key of HEADER_KEYS) {
    if (!(key in data)) problems.push(`Missing "${key}"`);
  }

  const type = toOptionalString(data.type);
  if ('type' in data && (type === null || !(RECORD_TYPES as readonly string[]).includes(type))) {
    problems.push(`Unknown type "${type ?? ''}"`);
  }
  const date = toOptionalString(data.date);
  if ('date' in data && (date === null || !isIsoDate(date))) {
    problems.push(`Invalid date "${date ?? ''}" (expected YYYY-MM-DD)`);
  }
  const status = toOptionalString(data.status);
  if (
    'status' in data &&
    (status === null || !(RECORD_STATUSES as readonly string[]).includes(status))
  ) {
    problems.push(`Unknown status "${status ?? ''}"`);
  }
  for (const key of ['agents', 'tags'] as const) {
    if (key in data && !Array.isArray(data[key])) problems.push(`"${key}" must be a list`);
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!(HEADER_KEYS as readonly string[]).includes(key)) extra[key] = value;
  }

  return {
    header: {
      type,
      date,
      agents: toStringList(data.agents),
      tags: toStringList(data.tags),
      status,
      extra,
    },
    problems,
  };
}

const EMPTY_HEADER: RecordHeader = {
  type: null,
  date: null,
  agents: [],
  tags: [],
  status: null,
  extra: {},
};

/** Parses one archive record. `inCatalog` is filled in later by the snapshot builder. */
export function parseRecord(path: string, text: string): ArchiveRecord {
  const front = splitFrontmatter(text);
  const { wing, subWing } = classifyPath(path);

  let header: RecordHeader = { ...EMPTY_HEADER, agents: [], tags: [], extra: {} };
  const headerProblems: string[] = [];
  if (!front.present) headerProblems.push('No header');
  else if (front.error) headerProblems.push(front.error);
  if (front.data) {
    const validated = validateHeader(front.data);
    header = validated.header;
    headerProblems.push(...validated.problems);
  }

  return {
    path,
    wing,
    subWing,
    title: firstHeading(front.body) ?? posix.basename(path, '.md'),
    header,
    hasHeader: front.data !== null,
    headerValid: headerProblems.length === 0,
    headerProblems,
    isTemplate: wing === 'templates',
    inCatalog: false,
  };
}

/**
 * The agent an audit log is about: the body's `**Agent:**` line, else the header's
 * `agents` list when it names exactly one agent. `null` when it cannot be told.
 */
export function auditSubject(text: string, header: RecordHeader): string | null {
  const match = /^\s*[-*]\s*\*\*Agent:\*\*\s*(.+?)\s*$/m.exec(splitFrontmatter(text).body);
  const fromBody = match?.[1]?.replace(/[<>]/g, '').trim();
  if (fromBody) return fromBody;
  return header.agents.length === 1 ? (header.agents[0] ?? null) : null;
}
