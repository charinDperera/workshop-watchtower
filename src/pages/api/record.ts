import { route } from '../../server/errors/route';
import { getRecord } from '../../server/handlers/record';
import { recordPathParam } from '../../server/schemas/record-query';

/** One record rendered to safe HTML; the path guard decides 400/404. */
export const GET = route(({ url }) => getRecord(recordPathParam(url.searchParams)));
