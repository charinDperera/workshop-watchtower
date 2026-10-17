import type { ActivityEvent } from '../../../shared/types';
import { LOGGER_MAIN_AGENT } from '../../constants';

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Parses one JSONL line. Returns `null` for blank, malformed or incomplete lines. */
export function parseEventLine(line: string): ActivityEvent | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const ts = optionalString(record.ts);
  const event = optionalString(record.event);
  if (ts === null || event === null || Number.isNaN(Date.parse(ts))) return null;

  return {
    ts,
    event,
    session: optionalString(record.session),
    agent: (optionalString(record.agent) ?? LOGGER_MAIN_AGENT).toLowerCase(),
    agentId: optionalString(record.agentId),
    tool: optionalString(record.tool),
    toolUseId: optionalString(record.toolUseId),
    source: optionalString(record.source),
    reason: optionalString(record.reason),
    mcpServer: optionalString(record.mcpServer),
  };
}

export interface ParsedEvents {
  /** In file order (oldest first). */
  events: ActivityEvent[];
  skippedLines: number;
}

/** Parses a whole JSONL document, skipping bad lines. */
export function parseEvents(text: string): ParsedEvents {
  const events: ActivityEvent[] = [];
  let skippedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEventLine(line);
    if (event) events.push(event);
    else skippedLines += 1;
  }
  return { events, skippedLines };
}

/**
 * Splits a chunk appended to the log into complete lines and the trailing partial line,
 * so a tail reader never parses half a line.
 */
export function splitCompleteLines(buffered: string): { lines: string[]; rest: string } {
  const lastBreak = buffered.lastIndexOf('\n');
  if (lastBreak === -1) return { lines: [], rest: buffered };
  return {
    lines: buffered.slice(0, lastBreak).split(/\r?\n/),
    rest: buffered.slice(lastBreak + 1),
  };
}
