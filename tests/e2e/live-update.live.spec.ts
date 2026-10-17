/**
 * Live updates, end to end: hook events and records are written into the disposable
 * workstation the server is running on, and the open page must change without a reload.
 * Every test restores what it wrote and waits for the server to settle, so other specs never
 * see these writes (the suite runs with one worker).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { Snapshot } from '../../src/lib/types';
import {
  councilMember,
  expect,
  expectNoAxeViolations,
  markNoReload,
  test,
  waitForLive,
} from './support/test';
import { appendEvents, e2eRoot, isDisposable, preserve } from './support/workstation';

const root = e2eRoot();
const EVENTS = join(root, '.watchtower', 'events.jsonl');
const SOUL_BINDER = join(root, 'hueco-mundo', 'soul-binder', 'SOUL-BINDER.md');
const NEW_RECORD = join(root, 'limforia', 'chronicles', '2026-10-17-live-e2e.md');
const NEW_RECORD_TITLE = 'Chronicle: written while the page was open';
const VIEWED = join(root, 'limforia', 'chronicles', '2026-10-01-first.md');

test.skip(
  !isDisposable(root),
  'refusing to write into a workstation that is not a disposable e2e copy',
);

async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  return (await (await request.get('/api/snapshot')).json()) as Snapshot;
}

/** Polls the server until its snapshot satisfies `ok` (the watcher debounces 300 ms). */
async function settle(request: APIRequestContext, ok: (s: Snapshot) => boolean, what: string) {
  await expect
    .poll(async () => ok(await snapshot(request)), { message: what, timeout: 15_000 })
    .toBe(true);
}

let restore: Record<'events' | 'soulBinder' | 'newRecord' | 'viewed', () => void>;
test.beforeEach(() => {
  restore = {
    events: preserve(EVENTS),
    soulBinder: preserve(SOUL_BINDER),
    newRecord: preserve(NEW_RECORD),
    viewed: preserve(VIEWED),
  };
});
test.afterEach(async ({ request }) => {
  for (const put of Object.values(restore)) put();
  rmSync(NEW_RECORD, { force: true });
  await settle(
    request,
    (s) =>
      s.agents.every((a) => a.status !== 'active') &&
      s.retired.length === 1 &&
      !s.records.some((r) => r.path.endsWith('2026-10-17-live-e2e.md')),
    'the workstation is back to the fixture state',
  );
});

test('a summoned agent turns Active and lights its stage, without a reload', async ({ page }) => {
  await page.goto('/');
  await waitForLive(page);
  const noReload = await markNoReload(page);

  const peter = councilMember(page, 'Peter');
  const michael = councilMember(page, 'Michael');
  const pipeline = page.locator('section[aria-labelledby="pipeline-heading"]');
  const testStage = pipeline.locator('ol > li').filter({ hasText: 'Test' });
  await expect(peter.getByText('Idle', { exact: true })).toBeVisible();
  await expect(testStage.getByText('Quiet', { exact: true })).toBeVisible();

  const now = Date.now();
  const ts = (offset: number) => new Date(now + offset).toISOString();
  appendEvents(root, [
    { ts: ts(0), event: 'SubagentStart', session: 'live', agent: 'peter', agentId: 'agent-live' },
    {
      ts: ts(1),
      event: 'PreToolUse',
      session: 'live',
      agent: 'peter',
      agentId: 'agent-live',
      tool: 'Bash',
      toolUseId: 'live-1',
    },
    // Unattributed subagent tool use, new style and legacy: must not wake Michael.
    {
      ts: ts(2),
      event: 'PreToolUse',
      session: 'live',
      agent: 'subagent',
      agentId: 'anon-live-1',
      tool: 'Read',
      toolUseId: 'live-2',
    },
    {
      ts: ts(3),
      event: 'PreToolUse',
      session: 'live',
      agent: 'michael',
      agentId: 'anon-live-2',
      tool: 'Grep',
      toolUseId: 'live-3',
    },
  ]);

  await expect(peter.getByText('Active', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(peter.getByText('Bash')).toBeVisible();
  await expect(testStage.getByText('In progress', { exact: true })).toBeVisible();
  await expect(testStage.getByText('(active)')).toHaveCount(1);
  await expect(michael.getByText('Idle', { exact: true })).toBeVisible();
  const feed = page.getByRole('list', { name: 'Latest activity' });
  await expect(feed.getByText('Unnamed subagent', { exact: true }).first()).toBeVisible();
  await expect(page.locator('a[href="/host/subagent"]')).toHaveCount(0);
  await noReload();
});

test('a new record appears in the archive list, without a reload', async ({ page }) => {
  await page.goto('/limforia');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const list = page.getByRole('list', { name: 'Records' });
  await expect(list.getByRole('link', { name: NEW_RECORD_TITLE })).toHaveCount(0);

  writeFileSync(
    NEW_RECORD,
    [
      '---',
      'type: chronicle',
      'date: 2026-10-17',
      'agents: [Peter]',
      'tags: [e2e]',
      'status: open',
      '---',
      `# ${NEW_RECORD_TITLE}`,
      '',
      'Test data.',
      '',
    ].join('\n'),
  );

  await expect(list.getByRole('link', { name: NEW_RECORD_TITLE })).toBeVisible({ timeout: 15_000 });
  await noReload();
});

test('new activity appears at the top of the timeline, without a reload', async ({ page }) => {
  await page.goto('/activity');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  appendEvents(root, [
    {
      ts: new Date().toISOString(),
      event: 'PreToolUse',
      session: 'live',
      agent: 'thomas',
      tool: 'LiveProbeTool',
      toolUseId: 'live-t',
    },
  ]);
  const timeline = page.getByRole('list', { name: 'Activity timeline' });
  await expect(timeline.locator(':scope > li').first()).toContainText('LiveProbeTool', {
    timeout: 15_000,
  });
  await noReload();
});

test('the open record refreshes when its file changes, without a reload', async ({ page }) => {
  await page.goto('/limforia?record=limforia%2Fchronicles%2F2026-10-01-first.md');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const viewer = page.getByRole('region', { name: 'Record viewer' });
  writeFileSync(VIEWED, `${readFileSync(VIEWED, 'utf8')}\n\nLIVE-EDIT-MARKER\n`);
  await expect(viewer).toContainText('LIVE-EDIT-MARKER', { timeout: 15_000 });
  await noReload();
});

test('the Soul Binder: empty state, then an entry appears live', async ({ page, request }) => {
  writeFileSync(
    SOUL_BINDER,
    [
      '# The Soul Binder',
      '',
      '| Name | Role | Served | Cause of retirement | Audit log |',
      '|---|---|---|---|---|',
      '| — | — | — | — | — |',
      '',
    ].join('\n'),
  );
  await settle(request, (s) => s.retired.length === 0, 'the Soul Binder is empty');

  await page.goto('/soul-binder');
  await waitForLive(page);
  await expect(page.getByText('No name is bound here')).toBeVisible();
  await expectNoAxeViolations(page, '/soul-binder (empty)');

  const noReload = await markNoReload(page);
  restore.soulBinder(); // put Azazel back while the page is open
  await expect(
    page.getByRole('list', { name: 'The departed' }).getByRole('heading', { name: 'Azazel' }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await noReload();
});
