/**
 * The live layer's page lifecycle decision (src/ui/live/logic.ts): close the stream on
 * purpose at `pagehide`, reopen it on a back/forward-cache `pageshow`, and do nothing
 * otherwise. The store applies it without touching the connection state or announcing.
 */
import { describe, expect, it } from 'vitest';
import { lifecycleAction } from '../../src/ui/live/logic';

const open = { users: 2, suspended: false };
const suspended = { users: 2, suspended: true };
const idle = { users: 0, suspended: false };

describe('lifecycleAction', () => {
  it('suspends an open stream on pagehide, whether or not the page enters the bfcache', () => {
    expect(lifecycleAction('pagehide', false, open)).toBe('suspend');
    expect(lifecycleAction('pagehide', true, open)).toBe('suspend');
  });

  it('does not suspend twice', () => {
    expect(lifecycleAction('pagehide', true, suspended)).toBe('none');
  });

  it('resumes only a suspended stream, and only on a pageshow from the bfcache', () => {
    expect(lifecycleAction('pageshow', true, suspended)).toBe('resume');
    expect(lifecycleAction('pageshow', false, suspended)).toBe('none');
    expect(lifecycleAction('pageshow', true, open)).toBe('none');
    expect(lifecycleAction('pageshow', false, open)).toBe('none');
  });

  it('does nothing when no island uses the stream', () => {
    expect(lifecycleAction('pagehide', false, idle)).toBe('none');
    expect(lifecycleAction('pageshow', true, { users: 0, suspended: true })).toBe('none');
  });
});
