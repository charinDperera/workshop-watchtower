/**
 * Composition root: wires the real filesystem, git, watcher and tail into one
 * `SnapshotService` per process. Kept on `globalThis` so dev-server reloads do not
 * start a second watcher.
 */
import { isAbsolute, relative, sep } from 'node:path';
import { LOGGER_MAIN_AGENT, PATHS } from '../constants';
import { readEventLog } from '../sources/event-log';
import { readMainSlug } from '../sources/roster';
import { createExecGit } from '../sources/git';
import { createWorkstationFs } from '../sources/workstation-fs';
import { buildSnapshot } from '../services/build-snapshot';
import { EventTail } from './event-tail';
import { SnapshotService } from './snapshot-service';
import { serverEnv } from '../config/env';
import { systemLog } from '../logging/logger';
import { pollWorkstation, scanTree } from './poll-watcher';
import { isIgnoredChange } from './watch-filter';
import { watchWorkstation } from './watcher';

interface Runtime {
  root: string;
  service: SnapshotService;
}

const KEY = Symbol.for('watchtower.runtime');
type GlobalWithRuntime = typeof globalThis & { [KEY]?: Runtime };

export interface RuntimeOptions {
  /** Container mode: mark the mounted repositories safe for git (see `gitEnv`). */
  container: boolean;
  /** Poll the tree every N ms instead of `fs.watch`; `null` to watch. */
  pollMs: number | null;
  /** Where the app writes its logs; ignored by the watcher when it is inside `root`. */
  logDir?: string;
}

/** Workstation-relative prefixes the watcher must ignore besides the defaults. */
export function ignoredPrefixes(root: string, logDir: string | undefined): string[] {
  if (!logDir) return [];
  const rel = relative(root, logDir).split(sep).join('/');
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? [] : [rel];
}

export function createRuntime(
  root: string,
  options: RuntimeOptions = { container: false, pollMs: null },
): Runtime {
  const fs = createWorkstationFs(root);
  const git = createExecGit({ safeDirectory: options.container });
  const { pollMs } = options;
  const extra = ignoredPrefixes(root, options.logDir);
  const isIgnored = (relPath: string) => isIgnoredChange(relPath, extra);
  // The Overseer's slug as of the latest snapshot; the live tail attributes events with it.
  let mainSlug = LOGGER_MAIN_AGENT;
  const service = new SnapshotService({
    log: systemLog(),
    build: async () => {
      const snapshot = await buildSnapshot({ fs, git });
      mainSlug = snapshot.agents.find((a) => a.isMain)?.slug ?? LOGGER_MAIN_AGENT;
      return snapshot;
    },
    watch: (handlers) =>
      pollMs === null
        ? watchWorkstation(root, handlers, undefined, isIgnored)
        : pollWorkstation(root, handlers, pollMs, (dir) => scanTree(dir, isIgnored)),
    tail: new EventTail(
      fs.absolute(PATHS.events),
      async () => {
        mainSlug = await readMainSlug(fs);
        return (await readEventLog(fs, mainSlug)).events;
      },
      () => mainSlug,
    ),
  });
  return { root, service };
}

/** The process-wide runtime, created and started on first use. */
export function getRuntime(): Runtime {
  const holder = globalThis as GlobalWithRuntime;
  if (!holder[KEY]) {
    const env = serverEnv();
    const runtime = createRuntime(env.root, {
      container: env.container,
      pollMs: env.pollMs,
      logDir: env.logDir,
    });
    holder[KEY] = runtime;
    systemLog().info('watch.started', 'Watching the workstation', {
      root: runtime.root,
      mode: env.pollMs === null ? 'fs.watch' : `poll ${env.pollMs} ms`,
    });
    runtime.service.start().catch((err: unknown) => {
      systemLog().error('live.start_failed', 'Live updates failed to start', {
        err,
      });
    });
  }
  return holder[KEY];
}
