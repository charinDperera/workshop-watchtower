import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import type { RecordHeader, RenderedRecord } from '../../shared/types';
import { splitFrontmatter } from '../sources/parse/frontmatter';
import { firstHeading, validateHeader } from '../sources/parse/record';
import { resolveRecordFile, validateRecordPath } from '../security/record-path';
import { renderMarkdown } from './markdown';

export type RecordResult =
  { ok: true; record: RenderedRecord } | { ok: false; status: 400 | 404; error: string };

/** Guards, reads and renders one record. Never reads a path that failed the guard. */
export async function loadRenderedRecord(
  root: string,
  input: string | null,
): Promise<RecordResult> {
  const check = validateRecordPath(input);
  if (!check.ok) return { ok: false, status: check.status, error: check.reason };

  const resolved = await resolveRecordFile(root, check);
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.reason };

  const text = await readFile(resolved.absPath, 'utf8');
  const front = splitFrontmatter(text);
  const header: RecordHeader | null = front.data ? validateHeader(front.data).header : null;
  return {
    ok: true,
    record: {
      path: check.relPath,
      title: firstHeading(front.body) ?? posix.basename(check.relPath, '.md'),
      header,
      html: renderMarkdown(front.body),
    },
  };
}
