/**
 * Every page renders against the fixture workstation, has one h1, and passes axe
 * (wcag2a, wcag2aa, wcag21aa, wcag22aa) in both the dark and the light theme.
 */
import {
  councilMember,
  expect,
  expectNoAxeViolations,
  OWN_STATUS,
  PAGES,
  test,
  waitForLive,
} from './support/test';

for (const { path, h1, status = 200 } of PAGES) {
  test.describe(`page ${path}`, () => {
    for (const colorScheme of ['dark', 'light'] as const) {
      test(`renders and passes axe (${colorScheme})`, async ({ page, allowConsoleErrors }) => {
        if (status !== 200) allowConsoleErrors(OWN_STATUS(status));
        await page.emulateMedia({ colorScheme });
        const response = await page.goto(path);
        expect(response?.status()).toBe(status);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1')).toHaveText(h1);
        await expect(page).toHaveTitle(/The Watchtower|Overview/);
        await expect(page.locator('main#main')).toBeVisible();
        await waitForLive(page);
        await expectNoAxeViolations(page, `${path} (${colorScheme})`);
      });
    }
  });
}

test.describe('overview content', () => {
  test('shows The Council, the Order of Work, the archive, the laws and activity', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForLive(page);
    for (const name of [
      'The Council',
      'The Order of Work',
      'The Great Archive',
      'Activity',
      'The Laws',
      'Latest commits',
    ]) {
      // Panel headings; the tree's tiers (h3) repeat "The Order of Work" by design.
      await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
    }
    // Every fixture agent is idle: the fixture's events are weeks old.
    const paul = councilMember(page, 'Paul');
    await expect(paul).toBeVisible();
    await expect(paul.getByText('Idle', { exact: true })).toBeVisible();
    for (const stage of ['Build', 'Test', 'Review']) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText('In progress', { exact: true })).toHaveCount(0);
  });
});

test.describe('agent pages', () => {
  test('/host lists every agent and links to each', async ({ page }) => {
    await page.goto('/host');
    for (const name of ['Michael', 'Uriel', 'Paul', 'Peter', 'Thomas']) {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
    }
    await page.getByRole('link', { name: 'Paul', exact: true }).first().click();
    await expect(page).toHaveURL(/\/host\/paul$/);
  });

  test('/host/paul shows role, tools, skills, strikes and audit logs', async ({ page }) => {
    await page.goto('/host/paul');
    await waitForLive(page);
    await expect(page.getByText('Backend Architect').first()).toBeVisible();
    await expect(page.getByText('Fixture definition for paul (test data).')).toBeVisible();
    const tools = page.getByRole('list', { name: 'Tools from the definition' });
    for (const tool of ['Read', 'Write', 'Bash'])
      await expect(tools.getByText(tool, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Preloaded skills' }).getByText('website-stack'),
    ).toBeVisible();
    const audits = page.getByRole('list', { name: 'Audit logs about Paul' });
    await expect(audits.getByRole('link')).not.toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Paul');
  });

  test('agent names are case-insensitive in the URL', async ({ page }) => {
    const response = await page.goto('/host/PAUL');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText('Paul');
  });

  for (const name of ['nobody', 'gabriel-x', '%2e%2e', 'a%2Fb', '<script>']) {
    test(`unknown agent "${name}" is a 404 page`, async ({ page, allowConsoleErrors }) => {
      allowConsoleErrors(OWN_STATUS(404));
      const response = await page.goto(`/host/${encodeURIComponent(name)}`);
      expect(response?.status()).toBe(404);
      await expect(page.locator('h1')).toHaveText('Nothing is kept here');
      await expect(page.locator('body')).not.toContainText('<script>alert');
    });
  }
});

test.describe('soul binder with an entry', () => {
  test('shows Azazel with the cause and a link to the audit log', async ({ page }) => {
    await page.goto('/soul-binder');
    const departed = page.getByRole('list', { name: 'The departed' });
    await expect(departed.getByRole('heading', { name: 'Azazel' })).toBeVisible();
    await expect(departed).toContainText('Three strikes');
    await departed.getByRole('link', { name: /audit/i }).click();
    await expect(page).toHaveURL(/record=limforia%2Faudit-hall%2F2026-09-30-azazel-executed\.md/);
    await expect(page.getByRole('heading', { name: 'Audit Log: Azazel, fixture' })).toBeVisible();
  });
});

test.describe('laws and git', () => {
  test('/laws shows the Constitution and all seven checks', async ({ page }) => {
    await page.goto('/laws');
    await expect(page.getByRole('region', { name: 'The Constitution' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compliance checks' })).toBeVisible();
    // The fixture breaks checks 1 to 6 and warns on 7.
    await expect(page.getByRole('img', { name: /^\d of 7 checks pass$/ }).first()).toBeVisible();
  });

  test('/git says the fixture is not a repository, without crashing', async ({ page }) => {
    const response = await page.goto('/git');
    expect(response?.status()).toBe(200);
    await expect(page.getByText(/not a git repository/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Apps' })).toBeVisible();
    await expect(page.getByText('demo-app').first()).toBeVisible();
  });
});

test.describe('unknown routes', () => {
  test('an unknown page is a 404 with a way back', async ({ page, allowConsoleErrors }) => {
    allowConsoleErrors(OWN_STATUS(404));
    const response = await page.goto('/no/such/page');
    expect(response?.status()).toBe(404);
    const nav = page.getByRole('navigation', { name: 'Where to go instead' });
    await nav.getByRole('link', { name: 'Overview' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
