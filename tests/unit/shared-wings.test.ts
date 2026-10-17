/** The templates wing id is derived once, in src/shared/wings.ts (Thomas M4). */
import { describe, expect, it } from 'vitest';
import { PATHS, wingIdOf } from '../../src/server/constants';
import { TEMPLATES_DIR, TEMPLATES_WING, wingTitle } from '../../src/shared/wings';

describe('TEMPLATES_WING', () => {
  it('is the folder after limforia/, the way the server derives wing ids', () => {
    expect(TEMPLATES_DIR).toBe('limforia/templates');
    expect(TEMPLATES_WING).toBe('templates');
    expect(wingTitle(TEMPLATES_WING)).toBe('Templates');
  });

  it('agrees with the server paths, so the two cannot drift apart', () => {
    expect(TEMPLATES_DIR).toBe(PATHS.templates);
    expect(TEMPLATES_WING).toBe(wingIdOf(PATHS.templates));
  });
});
