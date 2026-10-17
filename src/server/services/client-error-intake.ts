/**
 * Rate limiting and de-duplication of client error reports, so one broken page cannot flood
 * the log. In-memory and speed-only (ADR-004 Order 1): losing it on a restart only resets
 * the limits. Memory is bounded: old entries are pruned and the maps are capped.
 */
import type { ClientErrorReport } from '../schemas/client-error';

export interface IntakeOptions {
  /** Reports accepted per client per window. */
  limit?: number;
  windowMs?: number;
  /** The same report (code, where, msg, page) is written once per this long. */
  dedupeMs?: number;
  /** Most clients and report keys remembered at once. */
  maxEntries?: number;
  now?: () => number;
}

export type IntakeResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'limited'; retryAfterSeconds: number };

export class ClientErrorIntake {
  private readonly hits = new Map<string, number[]>();
  private readonly seen = new Map<string, number>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly dedupeMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: IntakeOptions = {}) {
    this.limit = options.limit ?? 10;
    this.windowMs = options.windowMs ?? 60_000;
    this.dedupeMs = options.dedupeMs ?? 5 * 60_000;
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? Date.now;
  }

  submit(clientKey: string, report: ClientErrorReport): IntakeResult {
    const now = this.now();
    const recent = (this.hits.get(clientKey) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(clientKey, recent);
      const oldest = recent[0] ?? now;
      return {
        outcome: 'limited',
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.remember(this.hits, clientKey, recent);

    const key = [report.errorCode, report.where, report.msg, report.page].join('\u0000');
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.dedupeMs) return { outcome: 'duplicate' };
    this.remember(this.seen, key, now);
    return { outcome: 'accepted' };
  }

  /** Sets a value, keeping the map within `maxEntries` (oldest inserted entries go first). */
  private remember<V>(map: Map<string, V>, key: string, value: V): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}
