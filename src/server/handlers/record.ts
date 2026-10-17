import type { RenderedRecord } from '../../shared/types';
import { AppError, UnavailableError } from '../errors/app-error';
import { getRuntime } from '../live/runtime';
import { loadRenderedRecord } from '../render/record-service';

export interface RecordDeps {
  root: string;
}

const defaults = (): RecordDeps => ({ root: getRuntime().root });

/** One record, guarded and rendered to safe HTML. 400/404 for a bad or missing path. */
export async function getRecord(
  path: string | null,
  deps: RecordDeps = defaults(),
): Promise<RenderedRecord> {
  let result;
  try {
    result = await loadRenderedRecord(deps.root, path);
  } catch (err) {
    throw new UnavailableError('Record unavailable', err);
  }
  if (!result.ok) throw new AppError(result.status, result.error);
  return result.record;
}
