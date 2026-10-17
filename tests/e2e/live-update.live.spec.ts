/**
 * Live updates, end to end: hook events and records are written into the disposable
 * workstation the server is running on, and the open page must change without a reload.
 * Every test restores what it wrote and waits for the server to settle, so other specs never
 * see these writes (the suite runs with one worker).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { Snapshot } from '../../src/shared/types';
import {
  atWorkCard,
  atWorkPanel,
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
const ROSTER = join(root, 'ROSTER.md');
/** A wing that is not in the fixture (nor in the CLAUDE.md wing table): a new folder. */
const NEW_WING_DIR = join(root, 'limforia', 'vigil-notes');
const NEW_WING_TITLE = 'Vigil Notes';
const SILENCE_MS = 5 * 60_000;

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

let restore: Record<'events' | 'soulBinder' | 'newRecord' | 'viewed' | 'roster', () => void>;
test.beforeEach(() => {
  restore = {
    events: preserve(EVENTS),
    soulBinder: preserve(SOUL_BINDER),
    newRecord: preserve(NEW_RECORD),
    viewed: preserve(VIEWED),
    roster: preserve(ROSTER),
  };
});
test.afterEach(async ({ request }) => {
  for (const put of Object.values(restore)) put();
  rmSync(NEW_RECORD, { force: true });
  rmSync(NEW_WING_DIR, { recursive: true, force: true });
  await settle(
    request,
    (s) =>
      s.agents.every((a) => a.status !== 'active') &&
      s.retired.length === 1 &&
      !s.records.some((r) => r.path.endsWith('2026-10-17-live-e2e.md')) &&
      !s.wings.some((w) => w.id === 'vigil-notes') &&
      !s.agents.some((a) => ['raguel', 'sariel', 'phanuel'].includes(a.slug)),
    'the workstation is back to the fixture state',
  );
});

test('a summoned agent turns Active and lights its stage, without a reload', async ({ page }) => {
  await page.goto('/');
  await waitForLive(page);
  const noReload = await markNoReload(page);

  // At work on the Overview: nobody is at work in the fixture, so the group is absent.
  const peter = atWorkCard(page, 'Peter');
  const atWorkNow = atWorkPanel(page).getByRole('region', { name: /^At work now/ });
  const pipeline = page.locator('section[aria-labelledby="pipeline-heading"]');
  const testStage = pipeline.locator('ol > li').filter({ hasText: 'Test' });
  await expect(atWorkNow).toHaveCount(0);
  await expect(atWorkPanel(page).getByText(/The Council rests/)).toBeVisible();
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
  // Unattributed tool use must not wake Michael: he is not at work.
  await expect(atWorkNow.getByRole('link', { name: 'Peter', exact: true })).toBeVisible();
  await expect(atWorkNow.getByRole('link', { name: 'Michael', exact: true })).toHaveCount(0);
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

test('the open record refreshes when its file changes, without a reload', async ({
  page,
  request,
}) => {
  await page.goto('/limforia?record=limforia%2Fchronicles%2F2026-10-01-first.md');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const viewer = page.getByRole('region', { name: 'Record viewer' });
  writeFileSync(VIEWED, `${readFileSync(VIEWED, 'utf8')}\n\nLIVE-EDIT-MARKER\n`);
  // The server reads the new text at once; what is under test is that the page is told.
  await expect
    .poll(async () =>
      (
        await (
          await request.get('/api/record?path=limforia%2Fchronicles%2F2026-10-01-first.md')
        ).text()
      ).includes('LIVE-EDIT-MARKER'),
    )
    .toBe(true);
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

test('Active lapses to Idle after 5 minutes of silence, without a reload', async ({ page }) => {
  // A run last heard from 4 min 54 s ago: Active now, and due to lapse in about 6 s. The
  // server's validUntil timer must rebuild the snapshot then and push it; no clock is faked.
  const heard = new Date(Date.now() - SILENCE_MS + 6_000).toISOString();
  appendEvents(root, [
    { ts: heard, event: 'SubagentStart', session: 'quiet', agent: 'peter', agentId: 'agent-quiet' },
  ]);
  await page.goto('/');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const peter = atWorkCard(page, 'Peter');
  await expect(peter.getByText('Active', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(peter.getByText('Active', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  // The run was never closed, so it lapsed (abandoned): the line says so instead of "Idle".
  await expect(peter.getByText('Went quiet')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Peter is now idle' })).toHaveCount(1);
  await noReload();
});

test('a run that ends in StopFailure reads "Fell silent", live', async ({ page }) => {
  await page.goto('/');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const now = Date.now();
  appendEvents(root, [
    {
      ts: new Date(now).toISOString(),
      event: 'SubagentStart',
      session: 'fail',
      agent: 'peter',
      agentId: 'agent-fail',
    },
    {
      ts: new Date(now + 1).toISOString(),
      event: 'StopFailure',
      session: 'fail',
      agent: 'peter',
      agentId: 'agent-fail',
    },
  ]);
  // The most recent run moves Peter into "Last active", saying how it ended.
  const peter = atWorkCard(page, 'Peter');
  await expect(peter.getByText(/Fell silent: stopped by an error/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(peter.getByText('Active', { exact: true })).toHaveCount(0);
  await noReload();
});

test('the Council tree follows the roster: new counsel, an unknown station, no title', async ({
  page,
  request,
}) => {
  await page.goto('/host');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const extra = [
    '| Raguel | Friend of God | Counsel | — | Watcher: keeps an eye on the watchers | Read | 2026-10-17 | 0 / 3 |',
    '| Sariel | The Vigilant | Worker | Vigil | Night watch: guards the archive at rest | Read | 2026-10-17 | 0 / 3 |',
    '| Phanuel | — | Worker | Test | Second tester: checks the checks | Read | 2026-10-17 | 0 / 3 |',
  ];
  writeFileSync(ROSTER, `${readFileSync(ROSTER, 'utf8').trimEnd()}\n${extra.join('\n')}\n`);
  await settle(request, (s) => s.agents.some((a) => a.slug === 'sariel'), 'the new roster is read');

  for (const live of [true, false]) {
    if (!live) {
      await page.reload();
      await waitForLive(page);
    }
    // The Counsel stand at the Overseer's hands: the first at his right, the next at his left.
    const rightHand = page.getByRole('list', { name: 'The Counsel, at the right hand' });
    const leftHand = page.getByRole('list', { name: 'The Counsel, at the left hand' });
    await expect(leftHand.getByRole('link', { name: 'Raguel', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(rightHand.getByRole('link', { name: 'Uriel', exact: true })).toBeVisible();
    // An unknown station gets its own niche, titled as written, after the Order of Work.
    const vigil = page.getByRole('list', { name: 'Vigil' });
    await expect(vigil.getByRole('link', { name: 'Sariel', exact: true })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Test' }).getByRole('link', { name: 'Phanuel', exact: true }),
    ).toBeVisible();
    // No title: the role's first clause stands in as the epithet.
    await expect(
      councilMember(page, 'Phanuel').getByText('Second tester', { exact: true }),
    ).toBeVisible();
    if (live) await noReload();
  }
  const response = await page.goto('/host/sariel');
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText('Sariel');
});

test('a new wing folder appears in the archive, without a reload', async ({ page }) => {
  await page.goto('/limforia');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const wings = page.locator('section[aria-labelledby="wings-heading"]');
  await expect(wings.getByRole('link', { name: new RegExp(NEW_WING_TITLE) })).toHaveCount(0);
  mkdirSync(NEW_WING_DIR, { recursive: true });
  writeFileSync(
    join(NEW_WING_DIR, '2026-10-17-first-watch.md'),
    [
      '---',
      'type: chronicle',
      'date: 2026-10-17',
      'agents: [Peter]',
      'tags: [e2e]',
      'status: open',
      '---',
      '# The first watch',
      '',
      'Test data.',
      '',
    ].join('\n'),
  );
  await expect(wings.getByRole('link', { name: new RegExp(NEW_WING_TITLE) })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole('list', { name: 'Records' }).getByRole('link', { name: 'The first watch' }),
  ).toBeVisible();
  await noReload();
  await wings.getByRole('link', { name: new RegExp(NEW_WING_TITLE) }).click();
  await expect(page).toHaveURL(/wing=vigil-notes/);
  await expect(page.getByRole('list', { name: 'Records' }).locator(':scope > li')).toHaveCount(1);
});
