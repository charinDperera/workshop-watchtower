/**
 * Server-Sent Events framing and the stream behind `GET /api/stream` (SPEC section 5):
 * a `snapshot` event on connect and on every change, an `activity` event per hook event,
 * a `: ping` comment every 15 s, and full cleanup when the client goes away.
 *
 * Backpressure: while the stream's queue is full, only the newest snapshot is kept and sent
 * when the client catches up; activity events and pings are dropped once
 * `MAX_QUEUED_CHUNKS` are waiting (the next snapshot carries the recent activity anyway).
 *
 * UPSTREAM LIMIT (Astro 7.4): Astro's Node `writeResponse` reads this stream as fast as it
 * produces and calls `res.write()` without waiting for 'drain', so the queue never fills and
 * the logic above does not engage in production; a slow client is buffered by Node's socket
 * instead. Accepted, not worked around: snapshots are debounced (300 ms) and identical ones
 * are never re-sent, and the only clients are the gateway and a local browser. Serving the
 * stream from the Node edge instead would split one route into two implementations. The
 * logic stays (unit-tested) and takes effect as soon as Astro honours backpressure.
 */
import type { ActivityEvent, Snapshot } from '../../shared/types';
import { systemLog } from '../logging/logger';
import { SSE_PING_MS } from '../constants';
import type { Subscriber } from './snapshot-service';

/** Formats one SSE message. JSON never contains raw newlines, so one `data:` line suffices. */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_PING = ': ping\n\n';

/** Chunks the stream queues before it counts as backed up (snapshots then wait). */
export const STREAM_HIGH_WATER = 8;
/** Beyond this many queued chunks, small events (activity, pings) are dropped too. */
export const MAX_QUEUED_CHUNKS = 64;

export interface StreamSource {
  get(): Promise<Snapshot>;
  subscribe(subscriber: Subscriber): () => void;
  markSent(snapshot: Snapshot): void;
}

export function createEventStream(
  source: StreamSource,
  signal: AbortSignal,
  pingMs: number = SSE_PING_MS,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};
  let flushPending: () => void = () => {};

  return new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        let closed = false;
        let unsubscribe: () => void = () => {};
        let ping: NodeJS.Timeout | null = null;
        /** The newest snapshot not yet sent because the client was behind. */
        let pending: string | null = null;

        cleanup = () => {
          if (closed) return;
          closed = true;
          pending = null;
          unsubscribe();
          if (ping) clearInterval(ping);
          signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // Already closed by the runtime; nothing left to release.
          }
        };
        const send = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        const room = () => controller.desiredSize ?? 0;
        /** Chunks waiting for the client (desiredSize counts down from the high water). */
        const queued = () => STREAM_HIGH_WATER - room();
        const sendSnapshot = (text: string) => {
          if (room() > 0) {
            pending = null;
            send(text);
          } else {
            pending = text; // replaces any older snapshot still waiting
          }
        };
        const sendSmall = (text: string) => {
          if (queued() < MAX_QUEUED_CHUNKS) send(text);
        };
        flushPending = () => {
          if (pending !== null && room() > 0) {
            const text = pending;
            pending = null;
            send(text);
          }
        };

        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });

        const subscriber: Subscriber = {
          onSnapshot: (snapshot: Snapshot) => sendSnapshot(formatSseEvent('snapshot', snapshot)),
          onActivity: (event: ActivityEvent) => sendSmall(formatSseEvent('activity', event)),
        };
        // Subscribe before the first snapshot so no change in between is lost.
        unsubscribe = source.subscribe(subscriber);
        ping = setInterval(() => sendSmall(SSE_PING), pingMs);

        send('retry: 3000\n\n');
        try {
          const snapshot = await source.get();
          source.markSent(snapshot);
          sendSnapshot(formatSseEvent('snapshot', snapshot));
        } catch (err) {
          systemLog().error('stream.snapshot_failed', 'Snapshot for a new stream failed', {
            err,
          });
          send(formatSseEvent('error', { error: 'Snapshot unavailable', status: 500 }));
        }
      },
      pull() {
        // The client took data: send the newest snapshot it missed, if any.
        flushPending();
      },
      cancel() {
        cleanup();
      },
    },
    new CountQueuingStrategy({ highWaterMark: STREAM_HIGH_WATER }),
  );
}

/** `X-Accel-Buffering: no` stops a proxy (nginx) from buffering the stream. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
