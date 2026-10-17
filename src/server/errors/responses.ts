import type { ApiError } from '../../shared/types';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function errorResponse(status: number, error: string): Response {
  const body: ApiError = { error, status };
  return jsonResponse(body, status);
}
