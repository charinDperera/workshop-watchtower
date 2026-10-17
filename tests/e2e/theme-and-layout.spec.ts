/**
 * Theme toggle persistence, 360 px layout without horizontal overflow, reduced motion, and
 * rendering with JavaScript disabled.
 */
import { councilMember, expect, OWN_STATUS, PAGES, test, waitForLive } from './support/test';

test.describe('theme toggle', () => {
  test('switches theme, persists across reloads and navigation, and labels itself', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await waitForLive(page);
    const html = page.locator('html');
    const toggle = page.getByRole('button', { name: 'Switch to the light theme' });
    await expect(toggle).toBeVisible();
    await expect(html).not.toHaveAttribute('data-theme', /./);

    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Switch to the dark theme' })).toBeVisible();
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).not.toBe(darkBg);
    expect(await page.evaluate(() => localStorage.getItem('watchtower-theme'))).toBe('light');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Laws' })
      .click();
    await expect(page).toHaveURL(/\/laws$/);
    await expect(html).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Switch to the dark theme' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('an explicit choice wins over the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('watchtower-theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Switch to the light theme' })).toBeVisible();
  });

  test('a bad stored value is ignored', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() =>
      localStorage.setItem('watchtower-theme', '"><img src=x onerror=alert(1)>'),
    );
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  });
});

test.describe('360 px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const { path, status } of PAGES) {
    test(`${path} has no horizontal overflow`, async ({ page, allowConsoleErrors }) => {
      if (status) allowConsoleErrors(OWN_STATUS(status));
      await page.goto(path);
      await waitForLive(page);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide = [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            // Elements inside a horizontal scroll region are allowed to be wider.
            return r.right > doc.clientWidth + 1 && !el.closest('.prose-scroll, [data-scroll-x]');
          })
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')}`);
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide };
      });
      expect(overflow.scrollWidth, `overflowing: ${overflow.wide.join(', ')}`).toBeLessThanOrEqual(
        overflow.clientWidth,
      );
    });
  }
});

test.describe('reduced motion', () => {
  test('pulse animations stop under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForLive(page);
    const running = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
          const s = getComputedStyle(el);
          return (
            s.animationName !== 'none' &&
            parseFloat(s.animationDuration) > 0.01 &&
            s.animationIterationCount === 'infinite'
          );
        }).length,
    );
    expect(running).toBe(0);
  });
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  for (const { path, h1, status = 200 } of PAGES) {
    test(`${path} renders its content server-side`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(status);
      await expect(page.locator('h1')).toHaveText(h1);
      await expect(page.locator('html')).toHaveClass(/no-js/);
      await expect(page.getByText('Static snapshot')).toBeVisible();
      // JS-only controls are hidden, and nothing is stuck on a loading placeholder.
      await expect(page.locator('[data-theme-toggle]')).toBeHidden();
      await expect(page.getByText(/^Loading /)).toHaveCount(0);
    });
  }

  test('overview shows the agents and the archive without JavaScript', async ({ page }) => {
    await page.goto('/');
    await expect(councilMember(page, 'Paul')).toBeVisible();
    await expect(page.getByText('Chronicles').first()).toBeVisible();
  });

  test('archive filters and the record viewer work as plain GET forms', async ({ page }) => {
    await page.goto('/limforia');
    await page.getByLabel('Type').selectOption('audit');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/type=audit/);
    const list = page.getByRole('list', { name: 'Records' });
    await expect(list.getByRole('link').first()).toBeVisible();
    await list.getByRole('link', { name: 'Audit Log: Paul, fixture' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Audit Log: Paul, fixture', level: 2 }),
    ).toBeVisible();
  });

  test('activity paging works with plain links', async ({ page }) => {
    await page.goto('/activity');
    await page.getByRole('link', { name: /Older events/ }).click();
    await expect(page).toHaveURL(/before=/);
    await expect(page.getByRole('heading', { name: 'Older events' })).toBeVisible();
  });
});
