/**
 * Reads the whole hook event log: the rotated backup (older) and the current file (newer).
 * The hook logger renames `events.jsonl` to `events.1.jsonl` at 5 MB, so the two files never
 * overlap. Missing files are empty, never errors (SPEC section 2).
 */
import type { ActivityEvent } from '../../shared/types';
import { LOGGER_MAIN_AGENT, PATHS } from '../constants';
import { sortOldestFirst } from '../services/activity-history';
import { attributeEvents } from '../services/attribution';
import { parseEvents } from './parse/events';
import type { WorkstationFs } from './workstation-fs';

export interface EventLogFile {
  /** Workstation-relative path. */
  path: string;
  /** Lines that were not valid events and were skipped. */
  skippedLines: number;
}

export interface EventLog {
  /**
   * Every valid event of both files, oldest first (file order kept for equal timestamps),
   * with subagent events attributed (see `derive/attribution`).
   */
  events: ActivityEvent[];
  /** One entry per file read, backup first. */
  files: EventLogFile[];
  skippedLines: number;
}

/** The log files, oldest first. */
const LOG_FILES = [PATHS.eventsBackup, PATHS.events] as const;

/**
 * @param mainSlug the roster Overseer's slug, which main-agent events are attributed to
 *   (see `derive/attribution`). Defaults to the logger's own main-agent value.
 */
export async function readEventLog(
  fs: WorkstationFs,
  mainSlug: string = LOGGER_MAIN_AGENT,
): Promise<EventLog> {
  const texts = await Promise.all(LOG_FILES.map((path) => fs.readText(path)));
  const events: ActivityEvent[] = [];
  const files: EventLogFile[] = [];
  LOG_FILES.forEach((path, index) => {
    const parsed = parseEvents(texts[index] ?? '');
    events.push(...parsed.events);
    files.push({ path, skippedLines: parsed.skippedLines });
  });
  return {
    events: attributeEvents(sortOldestFirst(events), mainSlug),
    files,
    skippedLines: files.reduce((sum, file) => sum + file.skippedLines, 0),
  };
}
