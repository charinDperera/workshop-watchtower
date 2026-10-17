/**
 * Server-side helpers for pages: read the snapshot once per request without throwing,
 * so a page can always render (with an error state) and the live island can recover.
 */
import { getRuntime } from '../live/runtime';
import type { ActivityPage, RenderedRecord, Snapshot } from '../../shared/types';
import { AppError } from '../errors/app-error';
import { activityQuery } from '../schemas/activity-query';
import { getActivity } from './activity';
import { getRecord } from './record';
import { systemLog } from '../logging/logger';

export type SnapshotResult =
  { snapshot: Snapshot; error: null } | { snapshot: null; error: string };

export async function loadSnapshot(): Promise<SnapshotResult> {
  try {
    return { snapshot: await getRuntime().service.get(), error: null };
  } catch (err) {
    systemLog().error('page.snapshot_failed', 'Page snapshot failed', {
      err: (err as Error).message,
    });
    return { snapshot: null, error: 'The workstation snapshot could not be built.' };
  }
}

export type ActivityPageResult =
  { page: ActivityPage; error: null } | { page: null; error: string };

/** The activity page's data: the same logic and validation as `GET /api/activity`. */
export async function loadActivityPage(params: URLSearchParams): Promise<ActivityPageResult> {
  try {
    return { page: await getActivity(activityQuery(params)), error: null };
  } catch (err) {
    if (err instanceof AppError && err.status < 500) return { page: null, error: err.message };
    systemLog().error('page.activity_failed', 'Activity page data failed', { err });
    return { page: null, error: 'The activity log could not be read.' };
  }
}

export type PageRecordResult =
  | { record: RenderedRecord; status: 200; error: null }
  | { record: null; status: number; error: string };

/** One record for a page (laws, archive viewer); never throws. */
export async function loadPageRecord(path: string | null): Promise<PageRecordResult> {
  try {
    return { record: await getRecord(path), status: 200, error: null };
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      return { record: null, status: err.status, error: err.message };
    }
    systemLog().error('page.record_failed', 'Page record failed', { err });
    return { record: null, status: 500, error: 'Record unavailable' };
  }
}
