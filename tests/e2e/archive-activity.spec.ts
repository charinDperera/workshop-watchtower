/**
 * /limforia (filters, the record viewer, a bad path) and /activity (filters, Older paging,
 * unattributed subagent events).
 */
import type { ActivityPage, Snapshot } from '../../src/lib/types';
import { expect, OWN_STATUS, test, waitForLive } from './support/test';
import { SEEDED_AGENT, SEEDED_EVENTS, UNATTRIBUTED_EVENTS } from './support/workstation';

test.describe('/limforia', () => {
  test('lists every non-template record and filters by type, status, tag and agent', async ({
    page,
    request,
  }) => {
    const snapshot = (await (await request.get('/api/snapshot')).json()) as Snapshot;
    const real = snapshot.records.filter((r) => !r.isTemplate);

    await page.goto('/limforia');
    await waitForLive(page);
    const list = page.getByRole('list', { name: 'Records' });
    await expect(list.locator(':scope > li')).toHaveCount(real.length);

    const cases: [string, string, number][] = [
      ['Type', 'audit', real.filter((r) => r.header.type === 'audit').length],
      ['Status', 'accepted', real.filter((r) => r.header.status === 'accepted').length],
      [
        'Tag',
        'fixture',
        real.filter((r) => r.header.tags.map((t) => t.toLowerCase()).includes('fixture')).length,
      ],
      [
        'Agent',
        'paul',
        real.filter((r) => r.header.agents.map((a) => a.toLowerCase()).includes('paul')).length,
      ],
    ];
    for (const [label, value, count] of cases) {
      expect(count, `fixture has ${label}=${value}`).toBeGreaterThan(0);
      await page.goto('/limforia');
      await page.getByLabel(label, { exact: true }).selectOption(value);
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page).toHaveURL(new RegExp(`${label.toLowerCase()}=${value}`));
      await expect(list.locator(':scope > li')).toHaveCount(count);
      await expect(page.getByRole('link', { name: 'Clear filters' })).toBeVisible();
    }
  });

  test('the wing filter scopes records, and templates show only in their own wing', async ({
    page,
  }) => {
    await page.goto('/limforia?wing=templates');
    await expect(
      page.getByText('Templates are the forms new records are written from.'),
    ).toBeVisible();
    await page.goto('/limforia?wing=audit-hall');
    const list = page.getByRole('list', { name: 'Records' });
    await expect(list.getByRole('link', { name: /Audit Log/ })).toHaveCount(7);
  });

  test('an unknown filter value is reported, not applied', async ({ page }) => {
    await page.goto('/limforia?wing=__proto__');
    await expect(
      page.getByRole('status').filter({ hasText: 'Ignored an unknown filter' }),
    ).toContainText('__proto__');
  });

  test('the viewer shows a record with its header and safe body', async ({ page }) => {
    await page.goto('/limforia?record=limforia%2Fvault-of-ideas%2Fno-header.md');
    await waitForLive(page);
    const viewer = page.getByRole('region', { name: 'Record viewer' });
    await expect(viewer.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(viewer).toContainText('This record has no header.');
    // The fixture plants a script and a javascript: link; neither may become live.
    expect(await viewer.locator('script, iframe, img, svg').count()).toBe(0);
    for (const href of await viewer
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
      expect(href).not.toMatch(/^\s*javascript:/i);
    }
    let dialog = false;
    page.on('dialog', async (d) => {
      dialog = true;
      await d.dismiss();
    });
    await page.waitForTimeout(500);
    expect(dialog, 'no script from the record ran').toBe(false);
  });

  test('a record with a header shows its chips, and Close returns to the list', async ({
    page,
  }) => {
    await page.goto(
      '/limforia?record=limforia%2Faudit-hall%2F2026-10-01-paul-strike.md&type=audit',
    );
    const header = page.getByRole('definition').filter({ hasText: 'audit' }).first();
    await expect(header).toBeVisible();
    await expect(page.getByRole('link', { name: 'Paul' }).first()).toHaveAttribute(
      'href',
      '/host/paul',
    );
    await page.getByRole('link', { name: 'Close the record' }).click();
    await expect(page).toHaveURL(/\/limforia\?type=audit$/);
  });

  test('relative .md links inside a record open in the viewer', async ({ page }) => {
    await page.goto('/limforia?record=limforia%2FCATALOG.md');
    const link = page
      .getByRole('region', { name: 'Record viewer' })
      .getByRole('link', { name: 'first', exact: true });
    await expect(link).toHaveAttribute(
      'href',
      '/limforia?record=limforia%2Fchronicles%2F2026-10-01-first.md',
    );
  });

  for (const [name, record, status] of [
    ['traversal', '../ROSTER.md', 400],
    ['an app file', 'apps/demo-app/x.md', 400],
    ['a missing record', 'limforia/chronicles/nope.md', 404],
    ['a non-markdown file', 'limforia/CATALOG.txt', 400],
  ] as const) {
    test(`a bad path (${name}) shows an error state with status ${status}`, async ({
      page,
      allowConsoleErrors,
    }) => {
      // The page reports its own status, which the browser logs as a console error.
      allowConsoleErrors(OWN_STATUS(status));
      const response = await page.goto(`/limforia?record=${encodeURIComponent(record)}`);
      expect(response?.status()).toBe(status);
      const viewer = page.getByRole('region', { name: 'Record viewer' });
      await expect(viewer).toContainText(
        status === 404 ? 'No record at this path' : 'This record cannot be shown',
      );
      await expect(viewer).toContainText(record);
      await expect(viewer.getByRole('link', { name: 'Back to the archive' })).toBeVisible();
      // The rest of the archive still renders.
      await expect(page.getByRole('list', { name: 'Records' })).toBeVisible();
    });
  }

  test('two record parameters are refused', async ({ page, allowConsoleErrors }) => {
    allowConsoleErrors(OWN_STATUS(400));
    const response = await page.goto('/limforia?record=CLAUDE.md&record=ROSTER.md');
    expect(response?.status()).toBe(400);
    await expect(page.getByRole('region', { name: 'Record viewer' })).toContainText(
      'Give exactly one record',
    );
  });

  test('a hostile record parameter is shown as text, never as markup', async ({
    page,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(OWN_STATUS(400));
    const evil = '"><img src=x onerror=alert(1)>.md';
    await page.goto(`/limforia?record=${encodeURIComponent(evil)}`);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await expect(page.getByRole('region', { name: 'Record viewer' })).toContainText('<img src=x');
  });
});

test.describe('/activity', () => {
  async function apiPage(request: import('@playwright/test').APIRequestContext, query = '') {
    const res = await request.get(`/api/activity${query}`);
    expect(res.status()).toBe(200);
    return (await res.json()) as ActivityPage;
  }

  test('shows the newest 50 and pages Older until the oldest page', async ({ page, request }) => {
    const all = await apiPage(request, '?limit=500');
    expect(all.total).toBeGreaterThan(50);
    await page.goto('/activity');
    await waitForLive(page);
    await expect(page.getByText(`${all.total} events in the log.`)).toBeVisible();
    const timeline = page.getByRole('list', { name: 'Activity timeline' });
    await expect(timeline.locator(':scope > li')).toHaveCount(50);

    await page.getByRole('link', { name: /Older events/ }).click();
    await expect(page).toHaveURL(/before=/);
    await expect(page.getByRole('heading', { name: 'Older events' })).toBeVisible();
    await expect(page.getByText('This page is history and does not update.')).toBeVisible();
    const older = page.getByRole('list', { name: 'Older activity' });
    await expect(older.locator(':scope > li')).toHaveCount(Math.min(50, all.total - 50));
    if (all.total <= 100) await expect(page.getByText('This is the oldest page.')).toBeVisible();
    await page.getByRole('link', { name: 'Newest events' }).click();
    await expect(page).toHaveURL(/\/activity$/);
  });

  test('filters by agent and by event, agreeing with the API', async ({ page, request }) => {
    const uriel = await apiPage(request, `?agent=${SEEDED_AGENT}`);
    expect(uriel.total).toBeGreaterThanOrEqual(SEEDED_EVENTS);
    await page.goto('/activity');
    await page.getByLabel('Agent').selectOption(SEEDED_AGENT);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(new RegExp(`agent=${SEEDED_AGENT}`));
    await expect(
      page.getByText(`${uriel.total} events in the log match these filters.`),
    ).toBeVisible();

    const starts = await apiPage(request, '?event=SessionStart');
    await page.goto('/activity');
    await page.getByLabel('Event').selectOption('SessionStart');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    const timeline = page.getByRole('list', { name: 'Activity timeline' });
    await expect(timeline.locator(':scope > li')).toHaveCount(starts.total);

    await page.goto(`/activity?agent=${SEEDED_AGENT}&event=SessionEnd`);
    await expect(page.getByText('No matching events')).toBeVisible();
  });

  test('a filter that cannot be read is reported and ignored', async ({ page }) => {
    await page.goto('/activity?agent=..%2F..&event=Nope&before=yesterday');
    await expect(page.getByRole('status').filter({ hasText: 'Ignored a filter' })).toContainText(
      'agent, event, before',
    );
    await expect(page.getByRole('heading', { name: 'Newest events' })).toBeVisible();
  });
});

test.describe('unattributed subagent events', () => {
  test('show as "Unnamed subagent" without a /host link, on the overview and the timeline', async ({
    page,
  }) => {
    for (const path of ['/', '/activity']) {
      await page.goto(path);
      await waitForLive(page);
      await expect(page.getByText('Unnamed subagent', { exact: true })).toHaveCount(
        UNATTRIBUTED_EVENTS.length,
      );
      await expect(page.locator('a[href="/host/subagent"]')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Unnamed subagent' })).toHaveCount(0);
    }
  });

  test('do not count toward Michael', async ({ request }) => {
    const snapshot = (await (await request.get('/api/snapshot')).json()) as Snapshot;
    const michael = snapshot.agents.find((a) => a.slug === 'michael');
    expect(michael).toBeDefined();
    const ids = new Set(UNATTRIBUTED_EVENTS.map((e) => e.agentId));
    expect(michael?.recentEvents.filter((e) => e.agentId && ids.has(e.agentId))).toEqual([]);
    expect(michael?.lastSeen).not.toBe(UNATTRIBUTED_EVENTS[1]?.ts);
    expect(snapshot.agents.some((a) => a.slug === 'subagent')).toBe(false);
    const michaelPage = (await (
      await request.get('/api/activity?agent=michael&limit=500')
    ).json()) as ActivityPage;
    expect(michaelPage.events.filter((e) => e.agentId && ids.has(e.agentId))).toEqual([]);
    const anon = (await (await request.get('/api/activity?agent=subagent')).json()) as ActivityPage;
    expect(anon.total).toBe(UNATTRIBUTED_EVENTS.length);
  });

  test('the subagent slug is not an agent page', async ({ page, allowConsoleErrors }) => {
    allowConsoleErrors(OWN_STATUS(404));
    const response = await page.goto('/host/subagent');
    expect(response?.status()).toBe(404);
  });
});
