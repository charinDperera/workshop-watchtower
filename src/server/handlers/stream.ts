import { UnavailableError } from '../errors/app-error';
import { getRuntime } from '../live/runtime';
import { createEventStream, SSE_HEADERS, type StreamSource } from '../live/sse';

export interface StreamDeps {
  service: StreamSource;
}

const defaults = (): StreamDeps => ({ service: getRuntime().service });

/** The live SSE stream, closed when the client goes away. */
export function openStream(signal: AbortSignal, deps?: StreamDeps): Response {
  let service: StreamSource;
  try {
    service = (deps ?? defaults()).service;
  } catch (err) {
    throw new UnavailableError('Live updates unavailable', err);
  }
  return new Response(createEventStream(service, signal), { headers: SSE_HEADERS });
}
