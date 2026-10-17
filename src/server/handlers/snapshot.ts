import type { Snapshot } from '../../shared/types';
import { UnavailableError } from '../errors/app-error';
import { getRuntime } from '../live/runtime';

export interface SnapshotDeps {
  service: { get(): Promise<Snapshot> };
}

const defaults = (): SnapshotDeps => ({ service: getRuntime().service });

/** The current snapshot (cached by the live service). */
export async function getSnapshot(deps: SnapshotDeps = defaults()): Promise<Snapshot> {
  try {
    return await deps.service.get();
  } catch (err) {
    throw new UnavailableError('Snapshot unavailable', err);
  }
}
