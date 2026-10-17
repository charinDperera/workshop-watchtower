/**
 * Polling fallback for `watchWorkstation`, for when file events do not arrive (a Windows
 * folder bind-mounted into a Linux container never reaches inotify). Every `intervalMs` it
 * stat-scans the tree and compares each file's mtime and size with the previous scan: no
 * hashing, no reads. Ignored folders (the same list as the watcher) are skipped before they
 * are entered. Scans never overlap: the next one is scheduled when the last one ends.
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isEventLogChange, isIgnoredChange } from './watch-filter';
import type { WatcherHandlers, WorkstationWatcher } from './watcher';

/** Workstation-relative path to `mtimeMs:size`. */
export type TreeState = Map<string, string>;

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** One stat-scan of the tree below `root`. Files that vanish mid-scan are skipped. */
export async function scanTree(root: string): Promise<TreeState> {
  const state: TreeState = new Map();
  const walk = async (rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(rel === '' ? root : join(root, rel), { withFileTypes: true });
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (isIgnoredChange(child)) continue;
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        try {
          const info = await stat(join(root, child));
          state.set(child, `${info.mtimeMs}:${info.size}`);
        } catch (err) {
          if (!isMissing(err)) throw err;
        }
      }
    }
  };
  await walk('');
  return state;
}

/** Paths added, removed or changed between two scans, sorted. */
export function diffTrees(before: TreeState, after: TreeState): string[] {
  const changed = new Set<string>();
  for (const [path, print] of after) if (before.get(path) !== print) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

export function pollWorkstation(
  root: string,
  handlers: WatcherHandlers,
  intervalMs: number,
  scan: (root: string) => Promise<TreeState> = scanTree,
): WorkstationWatcher {
  let previous: TreeState | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  const tick = async (): Promise<void> => {
    try {
      const current = await scan(root);
      if (closed) return;
      if (previous !== null) {
        const changed = diffTrees(previous, current);
        if (changed.some(isEventLogChange)) handlers.onEventLog();
        if (changed.length > 0) handlers.onChange(changed);
      }
      previous = current;
    } catch (err) {
      // Keep polling: one failed scan (a permission error, say) is reported, not fatal.
      if (!closed) handlers.onError(err as Error);
    } finally {
      if (!closed) {
        timer = setTimeout(() => void tick(), intervalMs);
        timer.unref?.();
      }
    }
  };
  void tick();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
