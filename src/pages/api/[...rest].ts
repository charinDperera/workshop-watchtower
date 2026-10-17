import { NotFoundError } from '../../server/errors/app-error';
import { route } from '../../server/errors/route';

/** Unknown API routes get a JSON 404 instead of an HTML page. */
export const ALL = route(() => {
  throw new NotFoundError('Unknown API route');
});
