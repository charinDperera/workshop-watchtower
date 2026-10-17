/** Constants the client needs too. No Node imports: this module is bundled for the browser. */
/**
 * The record types of the Constitution's record header (CLAUDE.md, Commandment 5), in its
 * order. `RecordType` derives from this list, and a unit test checks it against the real
 * CLAUDE.md, so an amendment cannot drift silently.
 */
export const RECORD_TYPES = [
  'chronicle',
  'audit',
  'decision',
  'feature',
  'caveat',
  'issue',
  'intel',
  'idea',
  'reliquary',
  'checkpoint',
] as const;

/** The record statuses of the same header, in its order (checked the same way). */
export const RECORD_STATUSES = ['open', 'closed', 'accepted', 'superseded'] as const;
