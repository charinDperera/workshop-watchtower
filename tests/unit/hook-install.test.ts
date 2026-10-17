/**
 * Thomas's N6: the hook logger Claude Code actually runs (`F:\Projects\.claude\hooks\
 * watchtower-log.mjs`, installed in the workstation) must be the app's reviewed copy
 * (`apps/watchtower/hooks/watchtower-log.mjs`). Peter's.
 *
 * Two modes, one check:
 * - Normal gate (`pnpm test`): while the installed copy is absent or still the old one, the
 *   comparison is SKIPPED with a message saying which, because the copy is replaced only
 *   after approval. A skip is visible in the report; it never passes silently.
 * - Install check, after the copy is installed: run
 *     WATCHTOWER_REQUIRE_HOOK_INSTALLED=1 pnpm exec vitest run tests/unit/hook-install.test.ts
 *   Then a missing or different copy FAILS.
 *
 * Line endings are normalised (a git checkout may write CRLF); any other byte counts.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_DIR } from './helpers';

const APP_COPY = join(APP_DIR, 'hooks', 'watchtower-log.mjs');
const INSTALLED_COPY = join(APP_DIR, '..', '..', '.claude', 'hooks', 'watchtower-log.mjs');
const REQUIRED = process.env.WATCHTOWER_REQUIRE_HOOK_INSTALLED === '1';

const normalised = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

const appText = normalised(APP_COPY);
const installedText = existsSync(INSTALLED_COPY) ? normalised(INSTALLED_COPY) : null;

/** Why the comparison cannot pass today, or null when the copies match. */
const mismatch =
  installedText === null
    ? `the installed hook ${INSTALLED_COPY} is absent`
    : installedText !== appText
      ? `the installed hook differs from the app's copy (installed ${sha(installedText)}, app ${sha(appText)}); install the reviewed copy after approval`
      : null;

describe('hook logger install (N6)', () => {
  it('the app copy exists and is the logger', () => {
    expect(appText).toMatch(/export function buildEvent/);
    expect(appText).toMatch(/export function logEvent/);
  });

  it.skipIf(mismatch !== null && !REQUIRED)(
    `the installed copy is identical to the app copy${mismatch && !REQUIRED ? ` (SKIPPED: ${mismatch})` : ''}`,
    () => {
      expect(mismatch, mismatch ?? '').toBeNull();
      expect(installedText).toBe(appText);
    },
  );
});
