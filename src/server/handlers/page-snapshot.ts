/**
 * Server-side helpers for pages: read the snapshot once per request without throwing,
 * so a page can always render (with an error state) and the live island can recover.
 */
import { getRuntime } from '../live/runtime';
import type { Snapshot } from '../../shared/types';

export type SnapshotResult =
  { snapshot: Snapshot; error: null } | { snapshot: null; error: string };

export async function loadSnapshot(): Promise<SnapshotResult> {
  try {
    return { snapshot: await getRuntime().service.get(), error: null };
  } catch (err) {
    console.error(`[watchtower] page snapshot failed: ${(err as Error).message}`);
    return { snapshot: null, error: 'The workstation snapshot could not be built.' };
  }
}
