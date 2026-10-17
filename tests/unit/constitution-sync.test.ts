/**
 * The app's record header lists must match the Constitution exactly. Reads the REAL
 * workstation CLAUDE.md (read-only), so an amendment to the header block fails this test
 * until the app is updated, instead of drifting silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECORD_STATUSES, RECORD_TYPES } from '../../src/shared/constants';
import { validateHeader } from '../../src/server/sources/parse/record';
import { APP_DIR } from './helpers';

const CONSTITUTION = join(APP_DIR, '..', '..', 'CLAUDE.md');

/** The `key: a | b | c` line of the YAML header block in CLAUDE.md. */
function headerLine(markdown: string, key: string): string[] {
  const block = /```yaml\s*\n---\n([\s\S]*?)\n---\n```/.exec(markdown)?.[1];
  if (block === undefined) throw new Error('No ```yaml --- … --- ``` header block in CLAUDE.md');
  const line = block.split('\n').find((l) => l.startsWith(`${key}:`));
  if (line === undefined) throw new Error(`No "${key}:" line in the header block`);
  return line
    .slice(key.length + 1)
    .split('|')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

describe('the record header matches the Constitution', () => {
  const markdown = readFileSync(CONSTITUTION, 'utf8');

  it('has exactly the record types of CLAUDE.md, in its order', () => {
    expect([...RECORD_TYPES]).toEqual(headerLine(markdown, 'type'));
  });

  it('has exactly the record statuses of CLAUDE.md, in its order', () => {
    expect([...RECORD_STATUSES]).toEqual(headerLine(markdown, 'status'));
  });

  it('accepts a checkpoint record header (Joseph, Major 1)', () => {
    const { problems } = validateHeader({
      type: 'checkpoint',
      date: '2026-10-17',
      agents: ['Michael'],
      tags: ['watchtower'],
      status: 'open',
    });
    expect(problems).toEqual([]);
  });
});
