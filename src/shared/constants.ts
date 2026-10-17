/** Constants the client needs too. No Node imports: this module is bundled for the browser. */
import type { RecordStatus, RecordType } from './types';

export const RECORD_TYPES: readonly RecordType[] = [
  'chronicle',
  'audit',
  'decision',
  'feature',
  'caveat',
  'issue',
  'intel',
  'idea',
  'reliquary',
];

export const RECORD_STATUSES: readonly RecordStatus[] = [
  'open',
  'closed',
  'accepted',
  'superseded',
];
