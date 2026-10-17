import type { ActivityPage } from '../../shared/types';
import { UnavailableError } from '../errors/app-error';
import { getRuntime } from '../live/runtime';
import type { ActivityQuery } from '../services/activity-history';
import { pageActivity } from '../services/activity-history';
import { readEventLog } from '../sources/event-log';
import { readMainSlug } from '../sources/roster';
import { createWorkstationFs, type WorkstationFs } from '../sources/workstation-fs';

export interface ActivityDeps {
  fs: WorkstationFs;
}

const defaults = (): ActivityDeps => ({ fs: createWorkstationFs(getRuntime().root) });

/** One page of the whole activity log (current and rotated file), newest first. */
export async function getActivity(
  query: ActivityQuery,
  deps: ActivityDeps = defaults(),
): Promise<ActivityPage> {
  try {
    const log = await readEventLog(deps.fs, await readMainSlug(deps.fs));
    return pageActivity(log.events, query);
  } catch (err) {
    throw new UnavailableError('Activity unavailable', err);
  }
}
