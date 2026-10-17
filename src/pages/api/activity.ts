import { route } from '../../server/errors/route';
import { getActivity } from '../../server/handlers/activity';
import { activityQuery } from '../../server/schemas/activity-query';

/** One page of the whole activity log. Strict query: 400 for anything unexpected. */
export const GET = route(({ url }) => getActivity(activityQuery(url.searchParams)));
