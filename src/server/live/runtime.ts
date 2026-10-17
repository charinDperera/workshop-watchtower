/**
 * Composition root: wires the real filesystem, git, watcher and tail into one
 * `SnapshotService` per process. Kept on `globalThis` so dev-server reloads do not
 * start a second watcher.
 */
import { resolveRoot } from '../config/root';
import { LOGGER_MAIN_AGENT, PATHS } from '../constants';
import { readEventLog } from '../sources/event-log';
import { readMainSlug } from '../sources/roster';
import { createExecGit } from '../sources/git';
import { createWorkstationFs } from '../sources/workstation-fs';
import { buildSnapshot } from '../services/build-snapshot';
import { EventTail } from './event-tail';
import { SnapshotService } from './snapshot-service';
import { serverSettings } from '../config/env';
import { pollWorkstation } from './poll-watcher';
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
}

export function createRuntime(
  root: string,
  options: RuntimeOptions = { container: false, pollMs: null },
): Runtime {
  const fs = createWorkstationFs(root);
  const git = createExecGit({ safeDirectory: options.container });
  const { pollMs } = options;
  // The Overseer's slug as of the latest snapshot; the live tail attributes events with it.
  let mainSlug = LOGGER_MAIN_AGENT;
  const service = new SnapshotService({
    build: async () => {
      const snapshot = await buildSnapshot({ fs, git });
      mainSlug = snapshot.agents.find((a) => a.isMain)?.slug ?? LOGGER_MAIN_AGENT;
      return snapshot;
    },
    watch: (handlers) =>
      pollMs === null ? watchWorkstation(root, handlers) : pollWorkstation(root, handlers, pollMs),
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
    const loaded = serverSettings();
    if (!loaded.ok) throw new Error(`invalid server settings: ${loaded.error}`);
    const { container, pollMs } = loaded.settings;
    const runtime = createRuntime(resolveRoot(), { container, pollMs });
    holder[KEY] = runtime;
    const mode = pollMs === null ? 'fs.watch' : `polling every ${pollMs} ms`;
    console.info(`[watchtower] watching workstation at ${runtime.root} (${mode})`);
    runtime.service.start().catch((err: unknown) => {
      console.error(`[watchtower] failed to start live updates: ${(err as Error).message}`);
    });
  }
  return holder[KEY];
}
