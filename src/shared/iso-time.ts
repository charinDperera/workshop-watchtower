/** Strict ISO 8601 timestamps, shared by the activity query (server) and the activity page (client). */

/** `YYYY-MM-DDTHH:MM:SS[.mmm]` with `Z` or `±HH:MM`. A zone is required: no local-time guess. */
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Epoch ms of a strict ISO 8601 timestamp, or `null`. Checks the calendar itself because
 * `Date.parse` rolls `2026-02-31` over into March and accepts hour 24.
 */
export function parseIsoTimestamp(text: string): number | null {
  const m = ISO_TIMESTAMP.exec(text);
  if (!m) return null;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = m
    .slice(1, 7)
    .map(Number);
  const offsetHour = Number(m[7] ?? 0);
  const offsetMinute = Number(m[8] ?? 0);
  const valid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59;
  if (!valid) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}
