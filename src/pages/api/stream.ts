import { route } from '../../server/errors/route';
import { openStream } from '../../server/handlers/stream';

/** Server-Sent Events: snapshots, activity, pings (SPEC section 5). */
export const GET = route(({ request }) => openStream(request.signal));
