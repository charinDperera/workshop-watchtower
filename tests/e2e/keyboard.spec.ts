/**
 * Manual keyboard checks, automated: the skip link is first and works, the primary nav is
 * reachable in order, and every focused control shows a visible focus indicator.
 */
import type { Page } from '@playwright/test';
import { expect, PAGES, test, waitForLive } from './support/test';

const NAV_LABELS = [
  'Overview',
  'The Council',
  'Limforia',
  'Soul Binder',
  'Laws',
  'Activity',
  'Git',
];

/** A focus indicator: an outline wider than 0 that is not `none`, or a box-shadow ring. */
async function focusIndicator(
  page: Page,
): Promise<{ tag: string; text: string; visible: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'body', text: '', visible: false };
    const own = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    const ring = (s: CSSStyleDeclaration) =>
      (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
      (s.boxShadow !== 'none' && s.boxShadow !== '');
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60),
      visible: ring(own) || ring(after),
    };
  });
}

test.describe('keyboard', () => {
  test('the first Tab reaches a visible skip link that moves focus to main', async ({ page }) => {
    await page.goto('/');
    await waitForLive(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box && box.width > 1 && box.height > 1, 'skip link is visible when focused').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('Tab reaches every primary nav link in order, each with a visible focus ring', async ({
    page,
    browserName,
  }) => {
    // WebKit only tabs to links when "Press Tab to highlight each item" is on; Playwright's
    // WebKit enables it, but keep the assertion on what the user can reach.
    await page.goto('/');
    await waitForLive(page);
    const seen: string[] = [];
    for (let i = 0; i < 30 && seen.length < NAV_LABELS.length; i++) {
      await page.keyboard.press('Tab');
      const focus = await focusIndicator(page);
      expect(focus.visible, `focus ring on <${focus.tag}> "${focus.text}" (${browserName})`).toBe(
        true,
      );
      const inNav = await page.evaluate(
        () => !!document.activeElement?.closest('nav[aria-label="Primary"]'),
      );
      if (inNav) seen.push(focus.text);
    }
    expect(seen).toEqual(NAV_LABELS);
  });

  test('the current page is marked in the nav', async ({ page }) => {
    await page.goto('/laws');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Laws' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  for (const { path } of PAGES.filter((p) => !p.status)) {
    test(`every focusable element on ${path} shows focus`, async ({ page }) => {
      await page.goto(path);
      await waitForLive(page);
      const missing: string[] = [];
      let first: string | null = null;
      for (let i = 0; i < 120; i++) {
        await page.keyboard.press('Tab');
        const focus = await focusIndicator(page);
        const id = `${focus.tag}:${focus.text}`;
        if (i > 0 && id === first) break; // wrapped round
        if (i === 0) first = id;
        if (focus.tag === 'body') continue;
        if (!focus.visible) missing.push(id);
      }
      expect(missing, `focusable elements without a visible focus indicator on ${path}`).toEqual(
        [],
      );
    });
  }

  test('filters and paging work from the keyboard alone', async ({ page }) => {
    await page.goto('/activity');
    await waitForLive(page);
    await page.getByLabel('Agent').focus();
    await page.getByLabel('Agent').selectOption('uriel');
    await page.getByRole('button', { name: 'Apply filters' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/agent=uriel/);
    await page.getByRole('link', { name: /Older events/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/before=/);
  });
});
