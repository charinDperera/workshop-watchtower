import { route } from '../../server/errors/route';
import { getSnapshot } from '../../server/handlers/snapshot';

/** The full derived state (SPEC section 5). */
export const GET = route(() => getSnapshot());
