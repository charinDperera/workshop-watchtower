/**
 * Shared e2e helpers: a `test` that fails on unexpected browser console errors, axe with the
 * stack's WCAG tags, and waiting for the live connection.
 */
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** Every route in SPEC section 6, with what its h1 says. */
export const PAGES: { path: string; h1: RegExp; status?: number }[] = [
  { path: '/', h1: /The Council at a glance/ },
  { path: '/host', h1: /^The Council$/ },
  { path: '/host/paul', h1: /^Paul$/ },
  { path: '/limforia', h1: /^Limforia$/ },
  { path: '/limforia?record=limforia%2Faudit-hall%2F2026-10-01-paul-strike.md', h1: /^Limforia$/ },
  { path: '/soul-binder', h1: /The Soul Binder/ },
  { path: '/laws', h1: /The Laws/ },
  { path: '/activity', h1: /^Activity$/ },
  { path: '/git', h1: /^Git$/ },
  { path: '/404', h1: /Nothing is kept here/, status: 404 },
];

/** Chromium logs the document's own error status as a console error. */
export const OWN_STATUS = (status: number) =>
  new RegExp(`Failed to load resource: the server responded with a status of ${status}`);

interface Fixtures {
  /** Console errors matching one of these are expected for this test. */
  allowConsoleErrors: (pattern: RegExp) => void;
  /**
   * Every Content-Security-Policy violation the page reported (all browsers, every document
   * of the test). Any violation fails the test; a test may read the list to assert on it.
   */
  cspViolations: string[];
}

export const test = base.extend<Fixtures>({
  allowConsoleErrors: [
    async ({ page }, use) => {
      // No standing allowances: the live stream closes on pagehide, so navigations produce
      // no stream errors in any browser (WebKit's "access control checks" included).
      const allowed: RegExp[] = [];
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      await use((pattern) => {
        allowed.push(pattern);
      });
      const unexpected = errors.filter((text) => !allowed.some((p) => p.test(text)));
      expect(unexpected, 'unexpected browser console errors').toEqual([]);
    },
    { auto: true },
  ],
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      // A binding survives navigations; the listener is installed in every new document.
      // Without JavaScript nothing runs, and a page without scripts cannot be blocked from one.
      await page.exposeBinding('__wtCspViolation', (_source, text: string) => {
        violations.push(text);
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          const report = (window as unknown as { __wtCspViolation?: (t: string) => void })
            .__wtCspViolation;
          report?.(
            `${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} on ${location.pathname}`,
          );
        });
      });
      await use(violations);
      expect(violations, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

/** Waits until the header says the stream is live (islands hydrated, SSE open). */
export async function waitForLive(page: Page): Promise<void> {
  await expect(page.getByText('Connection: Live')).toBeVisible({ timeout: 15_000 });
}

/** Sets a marker on `window`; if the page reloads, the marker is gone. */
export async function markNoReload(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    (window as unknown as { __wtNoReload: boolean }).__wtNoReload = true;
  });
  return async () => {
    const still = await page.evaluate(
      () => (window as unknown as { __wtNoReload?: boolean }).__wtNoReload === true,
    );
    expect(still, 'the page must update without a reload').toBe(true);
  };
}

/**
 * An agent's figure in the Council tree (Overview and /host): the innermost list item that
 * holds the link to the agent's page, inside the tree's region.
 */
export function councilMember(page: Page, name: string) {
  return page
    .locator('.council')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .last();
}

/** The Overview's "At work" panel. */
export function atWorkPanel(page: Page) {
  return page.getByRole('region', { name: 'At work', exact: true });
}

/**
 * An agent's card in the Overview's "At work" panel, in whichever group it stands
 * ("At work now" or "Last active"): the list item holding the link to the agent's page.
 */
export function atWorkCard(page: Page, name: string) {
  return atWorkPanel(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
}
