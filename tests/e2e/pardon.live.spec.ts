/**
 * Pardons, end to end (compliance checks 5 and 6 are pardon-aware): an audit log with
 * `outcome: pardon` and `pardons: [Peter]` covers Peter's strike dated on or before it, so
 * check 5 no longer flags him; a strike dated after the pardon counts again. Written into the disposable
 * workstation, checked on /api/snapshot and live on /laws, and restored.
 * The rules themselves are unit-tested in tests/unit/derive.test.ts ("pardons").
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { ComplianceCheck, Snapshot } from '../../src/shared/types';
import { expect, markNoReload, test, waitForLive } from './support/test';
import { e2eRoot, isDisposable } from './support/workstation';

const root = e2eRoot();
const AUDIT_HALL = join(root, 'limforia', 'audit-hall');
const PARDON = join(AUDIT_HALL, '2026-10-03-peter-pardon.md');
const LATER_STRIKE = join(AUDIT_HALL, '2026-10-05-peter-strike-2.md');

test.skip(
  !isDisposable(root),
  'refusing to write into a workstation that is not a disposable e2e copy',
);
test.describe.configure({ mode: 'serial' });

/** An audit log. `agent` writes the body's `- **Agent:**` line, which names its subject. */
const record = (header: string[], title: string, agent?: string) =>
  [
    '---',
    ...header,
    '---',
    '',
    `# ${title}`,
    '',
    ...(agent ? [`- **Agent:** ${agent}`] : []),
    'Test data.',
    '',
  ].join('\n');

async function strikeCheck(request: APIRequestContext): Promise<ComplianceCheck> {
  const snapshot = (await (await request.get('/api/snapshot')).json()) as Snapshot;
  const check = snapshot.compliance.checks.find((c) => c.id === 'strike-counts');
  if (!check) throw new Error('no strike-counts check in the snapshot');
  return check;
}

/** Check 5's findings about Peter (the fixture also flags Azazel, untouched here). */
const peterLines = async (request: APIRequestContext) =>
  (await strikeCheck(request)).details.filter((d) => d.startsWith('Peter:'));

test.afterEach(async ({ request }) => {
  rmSync(PARDON, { force: true });
  rmSync(LATER_STRIKE, { force: true });
  await expect
    .poll(async () => (await strikeCheck(request)).details.some((d) => d.startsWith('Peter:')), {
      message: 'the fixture state is back (Peter fails check 5 again)',
      timeout: 15_000,
    })
    .toBe(true);
});

test('a pardon makes check 5 pass, and a strike after it counts again', async ({
  page,
  request,
}) => {
  // The fixture fails check 5 for Peter (roster 0, audit hall 1), and for Azazel.
  const before = await strikeCheck(request);
  expect(before.result).toBe('fail');
  expect(await peterLines(request)).toEqual(['Peter: roster says 0, audit hall holds 1']);

  await page.goto('/laws');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const check5 = page.locator('li').filter({ hasText: before.title }).first();
  await expect(check5).toContainText('Peter: roster says 0');

  writeFileSync(
    PARDON,
    record(
      [
        'type: audit',
        'date: 2026-10-03',
        'agents: [Michael]',
        'tags: [pardon]',
        'status: closed',
        'outcome: pardon',
        'pardons: [Peter]',
      ],
      'Audit Log: Peter pardoned, e2e',
    ),
  );
  await expect.poll(async () => peterLines(request), { timeout: 15_000 }).toEqual([]);
  // Only the findings not about Peter remain.
  expect((await strikeCheck(request)).details).toEqual(
    before.details.filter((d) => !d.startsWith('Peter:')),
  );
  // The open /laws page follows, without a reload.
  await expect(check5).not.toContainText('Peter: roster says 0', { timeout: 15_000 });
  await noReload();

  // A strike dated after the pardon is counted (roster still says 0).
  writeFileSync(
    LATER_STRIKE,
    record(
      [
        'type: audit',
        'date: 2026-10-05',
        'agents: [Michael, Peter]',
        'tags: [strike]',
        'status: closed',
        'outcome: strike',
      ],
      'Audit Log: Peter, after the pardon, e2e',
      'Peter',
    ),
  );
  await expect
    .poll(async () => peterLines(request), { timeout: 15_000 })
    .toEqual(['Peter: roster says 0, audit hall holds 1 after the pardon of 2026-10-03']);
  await expect(check5).toContainText('after the pardon of', { timeout: 15_000 });
  await noReload();
});

test('a pardon dated before the strike does not cover it', async ({ request }) => {
  writeFileSync(
    PARDON,
    record(
      [
        'type: audit',
        'date: 2026-09-30',
        'agents: [Michael]',
        'status: closed',
        'outcome: pardon',
        'pardons: [Peter]',
      ],
      'Audit Log: Peter pardoned early, e2e',
    ),
  );
  await expect
    .poll(async () => peterLines(request), { timeout: 15_000 })
    .toEqual(['Peter: roster says 0, audit hall holds 1 after the pardon of 2026-09-30']);
});

test('pardoning every flagged agent makes check 5 pass', async ({ request }) => {
  const flagged = (await strikeCheck(request)).details.map((d) => d.split(':')[0] ?? '');
  expect(flagged.length).toBeGreaterThan(0);
  writeFileSync(
    PARDON,
    record(
      [
        'type: audit',
        'date: 2026-10-03',
        'agents: [Michael]',
        'status: closed',
        'outcome: pardon',
        `pardons: [${flagged.join(', ')}]`,
      ],
      'Audit Log: a general pardon, e2e',
    ),
  );
  await expect
    .poll(async () => (await strikeCheck(request)).result, { timeout: 15_000 })
    .toBe('pass');
  expect((await strikeCheck(request)).details).toEqual([]);
});
