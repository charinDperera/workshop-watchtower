/**
 * Compatibility re-export for Peter's e2e specs (`tests/e2e/*.spec.ts` import this path).
 * The contract lives in `src/shared/types.ts`. Remove this file once the specs import that.
 */
export type * from '../shared/types';
export { HOOK_EVENTS, UNATTRIBUTED_AGENT } from '../shared/types';
