/**
 * Pardons, end to end (compliance check 5; check 6 counts the same way). The decision:
 * - check 5 is `pass` when the roster counts agree with the strike logs that still count;
 *   every APPLIED pardon is listed as a detail line,
 *   "<path>: pardon of <agents> on <date> covers N strike log(s)";
 * - an UNAPPLIED pardon (no valid date, dated after today, naming nobody) is a `warn`,
 *   "<path>: Pardon not applied: <reason>", and forgives nothing;
 * - a mismatch is a `fail`, with the pardon lines after the failures.
 * Written into the disposable workstation, checked on /api/snapshot (and live on /laws),
 * and restored. The rules are unit-tested in tests/unit/derive.test.ts ("pardons").
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { ComplianceCheck, Snapshot } from '../../src/shared/types';
import { expect, markNoReload, test, waitForLive } from './support/test';
import { e2eRoot, isDisposable } from './support/workstation';

const root = e2eRoot();
const HALL = 'limforia/audit-hall';
const PARDON = `${HALL}/2026-10-03-peter-pardon.md`;
const SECOND_PARDON = `${HALL}/2026-10-04-second-pardon.md`;
const LATER_STRIKE = `${HALL}/2026-10-05-peter-strike-2.md`;
const WRITTEN = [PARDON, SECOND_PARDON, LATER_STRIKE];
const abs = (rel: string) => join(root, ...rel.split('/'));

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

/** Writes a pardon audit log; `pardons` null leaves the key out. */
function writePardon(rel: string, date: string, pardons: string[] | null, agents = ['Michael']) {
  writeFileSync(
    abs(rel),
    record(
      [
        'type: audit',
        `date: ${date}`,
        `agents: [${agents.join(', ')}]`,
        'tags: [pardon]',
        'status: closed',
        'outcome: pardon',
        ...(pardons ? [`pardons: [${pardons.join(', ')}]`] : []),
      ],
      `Audit Log: a pardon, e2e (${rel})`,
    ),
  );
}

async function strikeCheck(request: APIRequestContext): Promise<ComplianceCheck> {
  const snapshot = (await (await request.get('/api/snapshot')).json()) as Snapshot;
  const check = snapshot.compliance.checks.find((c) => c.id === 'strike-counts');
  if (!check) throw new Error('no strike-counts check in the snapshot');
  return check;
}

/** Polls check 5 until `ok` holds (the watcher debounces file changes), then returns it. */
async function settled(
  request: APIRequestContext,
  ok: (check: ComplianceCheck) => boolean,
  message: string,
): Promise<ComplianceCheck> {
  await expect
    .poll(async () => ok(await strikeCheck(request)), { message, timeout: 15_000 })
    .toBe(true);
  return strikeCheck(request);
}

const applied = (rel: string, agents: string, date: string, covers: number) =>
  `${rel}: pardon of ${agents} on ${date} covers ${covers} strike log(s)`;
const today = () => new Date().toISOString().slice(0, 10);

/** The fixture's check 5 before any pardon: one failure per flagged agent (Peter, Azazel). */
let baseline: ComplianceCheck;

test.beforeAll(async ({ request }) => {
  baseline = await strikeCheck(request);
});

test.afterEach(async ({ request }) => {
  for (const rel of WRITTEN) rmSync(abs(rel), { force: true });
  await settled(
    request,
    (c) => JSON.stringify(c.details) === JSON.stringify(baseline.details),
    'check 5 is back to the fixture state',
  );
});

test('the fixture fails check 5, without pardon lines', () => {
  expect(baseline.result).toBe('fail');
  expect(baseline.details).toContain('Peter: roster says 0, audit hall holds 1');
  expect(baseline.details.every((d) => /: roster says \d+, audit hall holds \d+$/.test(d))).toBe(
    true,
  );
});

test('an applied pardon is listed after the failures, and a strike after it counts again', async ({
  page,
  request,
}) => {
  await page.goto('/laws');
  await waitForLive(page);
  const noReload = await markNoReload(page);
  const check5 = page.locator('li').filter({ hasText: baseline.title }).first();
  await expect(check5).toContainText('Peter: roster says 0');

  writePardon(PARDON, '2026-10-03', ['Peter']);
  const others = baseline.details.filter((d) => !d.startsWith('Peter:'));
  const pardonLine = applied(PARDON, 'peter', '2026-10-03', 1);
  const after = await settled(
    request,
    (c) => c.details.includes(pardonLine),
    'the pardon is applied',
  );
  // Peter is forgiven; the other failures stay (so: fail), and the pardon line comes last.
  expect(after.details).toEqual([...others, pardonLine]);
  expect(after.result).toBe(others.length > 0 ? 'fail' : 'pass');
  await expect(check5).not.toContainText('Peter: roster says 0', { timeout: 15_000 });
  await expect(check5).toContainText('pardon of peter on 2026-10-03 covers 1 strike log(s)');
  await noReload();

  // A strike dated after the pardon counts again (the roster still says 0).
  writeFileSync(
    abs(LATER_STRIKE),
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
  const again = await settled(
    request,
    (c) => c.details.some((d) => d.startsWith('Peter:')),
    'the later strike counts',
  );
  expect(again.result).toBe('fail');
  expect(again.details).toEqual([
    ...baseline.details.map((d) =>
      d.startsWith('Peter:')
        ? 'Peter: roster says 0, audit hall holds 1 after the pardon of 2026-10-03'
        : d,
    ),
    pardonLine,
  ]);
  await expect(check5).toContainText('after the pardon of 2026-10-03', { timeout: 15_000 });
  await noReload();
});

test('pardoning every flagged agent makes check 5 pass, with the pardon listed', async ({
  page,
  request,
}) => {
  const flagged = baseline.details.map((d) => d.split(':')[0] ?? '');
  expect(flagged.length).toBeGreaterThan(0);
  writePardon(PARDON, '2026-10-03', flagged);
  const line = applied(
    PARDON,
    flagged.map((n) => n.toLowerCase()).join(', '),
    '2026-10-03',
    flagged.length,
  );
  const check = await settled(request, (c) => c.result === 'pass', 'check 5 passes');
  expect(check.details).toEqual([line]);

  // /laws shows the pass with its pardon line.
  await page.goto('/laws');
  await waitForLive(page);
  const check5 = page.locator('li').filter({ hasText: baseline.title }).first();
  await expect(check5).toContainText(line.slice(PARDON.length + 2));
});

test('a future-dated pardon is a warning and forgives nothing', async ({ request }) => {
  writePardon(PARDON, '2099-01-01', ['Peter']);
  const warning = `${PARDON}: Pardon not applied: it is dated 2099-01-01, after today (${today()})`;
  const check = await settled(request, (c) => c.details.includes(warning), 'the warning appears');
  // Peter still fails (nothing forgiven), the warning follows the failures, no pardon line.
  expect(check.result).toBe('fail');
  expect(check.details).toEqual([...baseline.details, warning]);
});

test('an unapplied pardon alone turns a passing check 5 into a warning', async ({ request }) => {
  const flagged = baseline.details.map((d) => d.split(':')[0] ?? '');
  writePardon(PARDON, '2026-10-03', flagged);
  writePardon(SECOND_PARDON, '2099-01-01', ['Peter']);
  const warning = `${SECOND_PARDON}: Pardon not applied: it is dated 2099-01-01, after today (${today()})`;
  const check = await settled(request, (c) => c.result === 'warn', 'check 5 warns');
  expect(check.details).toEqual([
    warning,
    applied(PARDON, flagged.map((n) => n.toLowerCase()).join(', '), '2026-10-03', flagged.length),
  ]);
});

for (const [name, date] of [
  ['an impossible date', '2026-13-45'],
  ['no date at all', ''],
  ['a date that is not YYYY-MM-DD', '3 Oct 2026'],
] as const) {
  test(`a pardon with ${name} is a warning and forgives nothing`, async ({ request }) => {
    if (date === '') {
      writeFileSync(
        abs(PARDON),
        record(
          [
            'type: audit',
            'agents: [Michael]',
            'status: closed',
            'outcome: pardon',
            'pardons: [Peter]',
          ],
          'Audit Log: an undated pardon, e2e',
        ),
      );
    } else {
      writePardon(PARDON, date, ['Peter']);
    }
    const warning = `${PARDON}: Pardon not applied: it has no valid date (YYYY-MM-DD)`;
    const check = await settled(request, (c) => c.details.includes(warning), 'the warning appears');
    expect(check.result).toBe('fail');
    expect(check.details).toEqual([...baseline.details, warning]);
  });
}

test('a pardon naming nobody is a warning and forgives nothing', async ({ request }) => {
  writePardon(PARDON, '2026-10-03', null, []);
  const warning = `${PARDON}: Pardon not applied: it names no agent (pardons or agents)`;
  const check = await settled(request, (c) => c.details.includes(warning), 'the warning appears');
  expect(check.details).toEqual([...baseline.details, warning]);
});

test('a pardon dated before the strike covers nothing', async ({ request }) => {
  writePardon(PARDON, '2026-09-30', ['Peter']);
  const line = applied(PARDON, 'peter', '2026-09-30', 0);
  const check = await settled(request, (c) => c.details.includes(line), 'the pardon is listed');
  expect(check.details).toEqual([
    ...baseline.details.map((d) =>
      d.startsWith('Peter:')
        ? 'Peter: roster says 0, audit hall holds 1 after the pardon of 2026-09-30'
        : d,
    ),
    line,
  ]);
});
