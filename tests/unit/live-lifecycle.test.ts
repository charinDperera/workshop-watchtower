/**
 * The live layer's page lifecycle decisions (src/ui/live/logic.ts): close the stream on
 * purpose at `beforeunload` (before WebKit cancels it) and at `pagehide`, reopen it on a
 * back/forward-cache `pageshow` or when a navigation announced by `beforeunload` never
 * happened, and do nothing otherwise. The store applies them without touching the
 * connection state or announcing.
 */
import { describe, expect, it } from 'vitest';
import { CANCELLED_NAVIGATION_MS, lifecycleAction, wakeAction } from '../../src/ui/live/logic';

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

describe('beforeunload', () => {
  it('suspends an open stream as a navigation starts, once', () => {
    expect(lifecycleAction('beforeunload', false, open)).toBe('suspend');
    expect(lifecycleAction('beforeunload', false, suspended)).toBe('none');
    expect(lifecycleAction('beforeunload', false, idle)).toBe('none');
  });

  it('lets the following pagehide do nothing more', () => {
    expect(lifecycleAction('pagehide', false, suspended)).toBe('none');
  });
});

describe('wakeAction: a navigation that beforeunload announced but never happened', () => {
  const waiting = {
    users: 1,
    suspended: true,
    hiddenSinceSuspend: false,
    visible: true,
    timerPending: false,
  };

  it('reopens when the timer fires and the tab is shown', () => {
    expect(wakeAction('timer', waiting)).toBe('resume');
  });

  it('pauses, honestly, when the timer fires in a hidden tab, instead of staying closed in silence', () => {
    expect(wakeAction('timer', { ...waiting, visible: false })).toBe('pause');
  });

  it('reopens a paused stream when the tab is shown again', () => {
    expect(wakeAction('visible', waiting)).toBe('resume');
  });

  it('lets a running timer decide while the navigation may still happen', () => {
    expect(wakeAction('visible', { ...waiting, timerPending: true })).toBe('none');
  });

  it('leaves a page that really went to pageshow, and does nothing without a suspend or islands', () => {
    for (const event of ['timer', 'visible'] as const) {
      expect(wakeAction(event, { ...waiting, hiddenSinceSuspend: true })).toBe('none');
      expect(wakeAction(event, { ...waiting, suspended: false })).toBe('none');
      expect(wakeAction(event, { ...waiting, users: 0 })).toBe('none');
    }
  });

  it('never resumes a hidden tab on its own', () => {
    expect(wakeAction('visible', { ...waiting, visible: false })).toBe('none');
  });

  it('waits long enough for a real navigation to hide the page', () => {
    expect(CANCELLED_NAVIGATION_MS).toBeGreaterThanOrEqual(1_000);
  });
});
