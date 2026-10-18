/**
 * A render error in the real production server (Peter's earlier finding): when a page
 * cannot render, the client gets a plain 500 and LOG_DIR gets exactly ONE error line,
 * `request.failed`, with the error's type, message and stack, plus the usual
 * `request.completed`. The pipeline is unit-tested with a mocked logger in
 * tests/unit/render-errors.test.ts; this proves it end to end, through pino to the file.
 *
 * How: the e2e server serves its own build (WATCHTOWER_DIST_DIR, .local/peter/e2e/dist), so
 * this spec can hide the /git page's chunk, as a concurrent rebuild once did, and put it back.
 * It has its own Playwright project, `render-error` (chromium), declared first: the hidden
 * module only fails to load if this server process has not loaded it yet, so run it on its
 * own, `pnpm exec playwright test --project=render-error`. It also asserts the route recovers.
 */
import { readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './support/test';
import { E2E_DIST_DIR, E2E_LOG_DIR } from './support/workstation';

const CHUNKS = join(E2E_DIST_DIR, 'server', 'chunks');

function logLines(): Record<string, unknown>[] {
  const file = join(E2E_LOG_DIR, 'bff', `${new Date().toISOString().slice(0, 10)}.jsonl`);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('a page that cannot render is a plain 500 and one pino error line', async ({ request }) => {
  const chunks = readdirSync(CHUNKS).filter((n) => /^git_[\w-]+\.mjs$/.test(n));
  expect(chunks.length, `the /git chunk in ${CHUNKS}`).toBeGreaterThan(0);
  const hidden = chunks.map((n) => [join(CHUNKS, n), join(CHUNKS, `${n}.hidden`)] as const);
  for (const [from, to] of hidden) renameSync(from, to);
  try {
    const id = 'peter-render-error-0001';
    const res = await request.get('/git', { headers: { 'x-request-id': id } });
    // Node caches a page module once loaded: if another spec already rendered /git in this
    // server process, hiding the file changes nothing and this test proves nothing.
    test.skip(
      res.status() === 200,
      'the /git module was already loaded by this server process; run `--project=render-error` on its own',
    );
    expect(res.status()).toBe(500);
    const body = await res.text();
    // Plain to the client: no stack, no path, no module name.
    expect(body).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module|\.mjs|[A-Z]:\\|at \S+ \(/);
    expect(res.headers()['x-request-id']).toBe(id);
    expect(res.headers()['x-frame-options']).toBe('DENY');

    // Soft from here on: the recovery check below must run (and report) either way.
    await expect.soft
      .poll(
        () =>
          logLines()
            .filter((l) => l.requestId === id)
            .map((l) => l.event),
        {
          timeout: 5_000,
        },
      )
      .toEqual(expect.arrayContaining(['request.failed', 'request.completed']));
    const mine = logLines().filter((l) => l.requestId === id);
    const errors = mine.filter((l) => l.level === 'error');
    expect.soft(errors, 'exactly one error line for the request').toHaveLength(1);
    const failed = (errors[0] ?? {}) as {
      event: string;
      err?: { type?: string; message?: string; stack?: string };
    };
    expect.soft(failed.event).toBe('request.failed');
    expect.soft(failed.err?.type).toBeTruthy();
    expect.soft(failed.err?.message).toBeTruthy();
    expect.soft(failed.err?.stack).toBeTruthy();
    expect
      .soft(mine.filter((l) => l.event === 'request.completed'))
      .toMatchObject([{ level: 'info', status: 500, route: '/git' }]);
  } finally {
    for (const [from, to] of hidden) renameSync(to, from);
  }
  // The route recovers once the file is back (no cached failure, no restart needed).
  await expect
    .poll(async () => (await request.get('/git')).status(), { timeout: 10_000 })
    .toBe(200);
});
