import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GitRunner } from '../../src/server/sources/git';

export const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURE = join(APP_DIR, 'tests', 'fixtures', 'workstation');
export const CLEAN_FIXTURE = join(APP_DIR, 'tests', 'fixtures', 'clean-workstation');

/**
 * Temp folders live inside the app's ignored `.local/` (never the OS temp folder),
 * so tests never write outside the workstation.
 */
const TMP_BASE = join(APP_DIR, '.local', 'test-tmp');

export function makeTempDir(prefix = 'wt-'): { dir: string; cleanup: () => void } {
  mkdirSync(TMP_BASE, { recursive: true });
  const dir = mkdtempSync(join(TMP_BASE, prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A writable copy of a fixture workstation. */
export function copyFixture(source = FIXTURE): { dir: string; cleanup: () => void } {
  const temp = makeTempDir('ws-');
  cpSync(source, temp.dir, { recursive: true });
  return temp;
}

/** A git runner that answers from a table and records the calls. */
export function fakeGit(answers: Record<string, string | Error>): GitRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const run = (async (_cwd: string, args: readonly string[]) => {
    calls.push([...args]);
    const answer = answers[args[0] ?? ''];
    if (answer instanceof Error) throw answer;
    return answer ?? '';
  }) as GitRunner & { calls: string[][] };
  run.calls = calls;
  return run;
}
