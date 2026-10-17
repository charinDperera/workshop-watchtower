/**
 * Which file changes matter (SPEC section 5). Pure, so the ignore rules are unit-tested.
 *
 * Ignored: any `node_modules`, any `dist`, any `.git/objects` (workstation and app repos),
 * plus this app's own build and tool caches, which are not workstation state.
 * `.git/HEAD` and `.git/logs/HEAD` are kept so commits refresh the snapshot.
 */

const IGNORED_SEGMENTS = new Set(['node_modules', 'dist']);
/** This app's generated folders: `.astro` (types), `.pnpm-store`, `.local` (caches). */
const IGNORED_APP_SEGMENTS = new Set([
  '.astro',
  '.pnpm-store',
  '.local',
  'test-results',
  'playwright-report',
]);

/** Normalises a path reported by `fs.watch` to `/`-separated workstation-relative form. */
export function normaliseWatchPath(filename: string): string {
  return filename.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isIgnoredChange(relPath: string): boolean {
  const segments = normaliseWatchPath(relPath).split('/');
  if (segments.some((s) => IGNORED_SEGMENTS.has(s) || IGNORED_APP_SEGMENTS.has(s))) return true;
  const gitIndex = segments.indexOf('.git');
  if (gitIndex !== -1 && segments[gitIndex + 1] === 'objects') return true;
  return false;
}

/** True when the change touches the hook event log (current or rotated). */
export function isEventLogChange(relPath: string): boolean {
  return /^\.watchtower\/events(\.1)?\.jsonl$/.test(normaliseWatchPath(relPath));
}
