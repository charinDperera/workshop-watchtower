/**
 * Strict guard for `GET /api/record?path=` (SPEC section 5).
 *
 * Two stages, both must pass:
 * 1. `validateRecordPath` (pure, lexical): a relative `.md` path with no `..`, no drive or
 *    absolute prefix, no control or reserved characters, inside an allowed area.
 * 2. `resolveRecordFile` (IO): the real path on disk (symlinks and junctions resolved) is
 *    still inside the real workstation root and inside the same allowed area.
 */
import { realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** Folders whose `.md` files may be shown. */
export const ALLOWED_RECORD_DIRS: readonly string[] = ['limforia', 'intel', 'hueco-mundo'];
/** Single files at the root that may be shown. */
export const ALLOWED_RECORD_FILES: readonly string[] = ['CLAUDE.md', 'ROSTER.md'];

export const MAX_RECORD_PATH_LENGTH = 512;

export type PathCheck =
  | { ok: true; relPath: string; segments: string[] }
  | { ok: false; status: 400 | 404; reason: string };

// Control characters, Windows-reserved characters and `:` (drive letters, NTFS streams).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

function deny(status: 400 | 404, reason: string): PathCheck {
  return { ok: false, status, reason };
}

export function validateRecordPath(input: string | null | undefined): PathCheck {
  if (typeof input !== 'string' || input.trim() === '') return deny(400, 'Missing "path"');
  if (input.length > MAX_RECORD_PATH_LENGTH) return deny(400, 'Path is too long');
  if (FORBIDDEN_CHARS.test(input)) return deny(400, 'Path contains forbidden characters');

  const normalised = input.replace(/\\/g, '/');
  if (normalised.startsWith('/')) return deny(400, 'Path must be relative to the workstation');

  const segments = normalised.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return deny(400, 'Path must not contain empty, "." or ".." segments');
    }
    if (segment !== segment.trim() || segment.endsWith('.')) {
      return deny(400, 'Path segments must not end in spaces or dots');
    }
    if (WINDOWS_DEVICE.test(segment)) return deny(400, 'Path names a reserved device');
  }

  const last = segments[segments.length - 1] ?? '';
  if (!last.endsWith('.md')) return deny(400, 'Only .md files can be shown');

  const relPath = segments.join('/');
  const inAllowedDir = segments.length > 1 && ALLOWED_RECORD_DIRS.includes(segments[0] ?? '');
  const isAllowedFile = segments.length === 1 && ALLOWED_RECORD_FILES.includes(last);
  if (!inAllowedDir && !isAllowedFile) {
    return deny(400, 'Path is outside limforia/, intel/, hueco-mundo/, CLAUDE.md and ROSTER.md');
  }
  return { ok: true, relPath, segments };
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Compares paths the way the filesystem does (case-insensitive on Windows). */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when `child` is `parent` or below it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === '') return true;
  return !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel);
}

/**
 * Resolves a validated path to an absolute file on disk, or a 404 when it does not exist,
 * is not a regular file, or escapes its allowed area through a link.
 */
export async function resolveRecordFile(
  root: string,
  check: Extract<PathCheck, { ok: true }>,
): Promise<{ ok: true; absPath: string } | { ok: false; status: 404; reason: string }> {
  const notFound = { ok: false as const, status: 404 as const, reason: 'Record not found' };
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await realpath(root);
    realFile = await realpath(join(root, ...check.segments));
  } catch (err) {
    if (isMissing(err)) return notFound;
    throw err;
  }

  const area = check.segments.length > 1 ? join(realRoot, check.segments[0] ?? '') : realRoot;
  const rel = relative(realRoot, realFile).split(sep);
  const staysInArea =
    check.segments.length > 1
      ? isInside(area, realFile) && samePath(rel[0] ?? '', check.segments[0] ?? '')
      : rel.length === 1 && samePath(rel[0] ?? '', check.segments[0] ?? '');
  if (!isInside(realRoot, realFile) || !staysInArea) return notFound;

  const info = await stat(realFile);
  if (!info.isFile()) return notFound;
  // A hard link has no "real" location to check: the same file may live outside the area
  // (for example in an app). Records are never hard-linked, so any extra link is refused.
  // NTFS reports nlink for real hard links too.
  if (info.nlink > 1) return notFound;
  return { ok: true, absPath: realFile };
}
