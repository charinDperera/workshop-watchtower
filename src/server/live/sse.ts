/**
 * Server-Sent Events framing and the stream behind `GET /api/stream` (SPEC section 5):
 * a `snapshot` event on connect and on every change, an `activity` event per hook event,
 * a `: ping` comment every 15 s, and full cleanup when the client goes away.
 */
import type { ActivityEvent, Snapshot } from '../../shared/types';
import { SSE_PING_MS } from '../constants';
import type { Subscriber } from './snapshot-service';

/** Formats one SSE message. JSON never contains raw newlines, so one `data:` line suffices. */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_PING = ': ping\n\n';

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

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};
      let ping: NodeJS.Timeout | null = null;

      cleanup = () => {
        if (closed) return;
        closed = true;
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

      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });

      const subscriber: Subscriber = {
        onSnapshot: (snapshot: Snapshot) => send(formatSseEvent('snapshot', snapshot)),
        onActivity: (event: ActivityEvent) => send(formatSseEvent('activity', event)),
      };
      // Subscribe before the first snapshot so no change in between is lost.
      unsubscribe = source.subscribe(subscriber);
      ping = setInterval(() => send(SSE_PING), pingMs);

      send('retry: 3000\n\n');
      try {
        const snapshot = await source.get();
        source.markSent(snapshot);
        send(formatSseEvent('snapshot', snapshot));
      } catch (err) {
        console.error(`[watchtower] snapshot for stream failed: ${(err as Error).message}`);
        send(formatSseEvent('error', { error: 'Snapshot unavailable', status: 500 }));
      }
    },
    cancel() {
      cleanup();
    },
  });
}

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
