import { BadRequestError } from '../errors/app-error';

/** `GET /api/record?path=`: exactly one `path` (its content is checked by the record guard). */
export function recordPathParam(params: URLSearchParams): string | null {
  const paths = params.getAll('path');
  if (paths.length > 1) throw new BadRequestError('Give exactly one "path"');
  return paths[0] ?? null;
}
