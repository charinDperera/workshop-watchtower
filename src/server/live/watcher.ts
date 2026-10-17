/**
 * Watches the whole workstation with Node's recursive `fs.watch` and reports debounced
 * changes. Event-log changes are reported separately and immediately, so activity is live.
 */
import { watch, type FSWatcher } from 'node:fs';
import { WATCH_DEBOUNCE_MS } from '../constants';
import { isEventLogChange, isIgnoredChange, normaliseWatchPath } from './watch-filter';

export interface WatcherHandlers {
  /** Called once per burst of relevant changes, after `debounceMs` of quiet. */
  onChange: (paths: string[]) => void;
  /** Called on every change of `.watchtower/events*.jsonl`. */
  onEventLog: () => void;
  onError: (error: Error) => void;
}

export interface WorkstationWatcher {
  close(): void;
}

/** Collects calls and fires once after `ms` of quiet. */
export function debounce<T>(ms: number, fire: (items: T[]) => void) {
  let timer: NodeJS.Timeout | null = null;
  let pending: T[] = [];
  return {
    push(item: T) {
      pending.push(item);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const items = pending;
        pending = [];
        timer = null;
        fire(items);
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = [];
    },
  };
}

export function watchWorkstation(
  root: string,
  handlers: WatcherHandlers,
  debounceMs: number = WATCH_DEBOUNCE_MS,
): WorkstationWatcher {
  const burst = debounce<string>(debounceMs, (paths) => handlers.onChange([...new Set(paths)]));
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true, persistent: false }, (_type, filename) => {
      // Some platforms omit the name; treat that as "something changed".
      const rel = filename ? normaliseWatchPath(String(filename)) : '';
      if (rel !== '' && isIgnoredChange(rel)) return;
      if (rel !== '' && isEventLogChange(rel)) handlers.onEventLog();
      burst.push(rel);
    });
  } catch (err) {
    handlers.onError(err as Error);
    return { close: () => burst.cancel() };
  }
  watcher.on('error', (err) => handlers.onError(err));
  return {
    close() {
      burst.cancel();
      watcher.close();
    },
  };
}
