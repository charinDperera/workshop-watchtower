import { route } from '../../server/errors/route';
import { getHealth } from '../../server/handlers/health';

/** Cheap liveness for the container HEALTHCHECK (no snapshot). */
export const GET = route(() => getHealth());
