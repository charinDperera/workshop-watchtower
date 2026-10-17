/**
 * Peter's process-level tests for the hook logger (hooks/watchtower-log.mjs): many real
 * `node` processes at once, as Claude Code runs them, and rotation at the real 5 MB limit.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BACKUP_FILE, LOG_DIR, LOG_FILE, ROTATE_BYTES } from '../../hooks/watchtower-log.mjs';
import { parseEventLine } from '../../src/server/sources/parse/events';
import { makeTempDir } from './helpers';

const SCRIPT = fileURLToPath(new URL('../../hooks/watchtower-log.mjs', import.meta.url));
const WRITERS = 20;

/** Runs the hook once with `payload` on stdin; resolves with the exit code and stderr. */
function runHook(
  payload: string,
  projectDir: string,
): Promise<{ code: number | null; stderr: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr, ms: Date.now() - started }));
    child.stdin.end(payload);
  });
}

/** A payload whose fields are at the logger's 200-character cap, so each line is long. */
function payload(i: number): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: `session-${i}-`.padEnd(200, 's'),
    agent_type: `writer-${i}-`.padEnd(200, 'a'),
    agent_id: `agent-${i}-`.padEnd(200, 'i'),
    tool_name: `Tool${i}`.padEnd(200, 't'),
    tool_use_id: `use-${i}-`.padEnd(200, 'u'),
    tool_input: { command: 'SECRET'.repeat(1000) },
  });
}

function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  expect(text === '' || text.endsWith('\n')).toBe(true);
  return text.split('\n').filter((l) => l !== '');
}

describe('hook logger: concurrent processes', () => {
  it(`${WRITERS} parallel writers, 3 rounds: every line whole, none lost, nothing leaked`, async () => {
    const temp = makeTempDir('hook-par-');
    try {
      const rounds = 3;
      for (let round = 0; round < rounds; round++) {
        const results = await Promise.all(
          Array.from({ length: WRITERS }, (_, i) =>
            runHook(payload(round * WRITERS + i), temp.dir),
          ),
        );
        for (const r of results) {
          expect(r.code).toBe(0);
          expect(r.stderr).toBe('');
        }
      }
      const file = join(temp.dir, LOG_DIR, LOG_FILE);
      const lines = readLines(file);
      expect(lines).toHaveLength(rounds * WRITERS);
      const writers = new Set<string>();
      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, string>;
        expect(parseEventLine(line)).not.toBeNull();
        expect(parsed.agent).toHaveLength(200);
        writers.add(parsed.agent ?? '');
      }
      expect(writers.size).toBe(rounds * WRITERS);
      expect(readFileSync(file, 'utf8')).not.toContain('SECRET');
    } finally {
      temp.cleanup();
    }
  }, 120_000);
});

describe('hook logger: rotation as a real process', () => {
  /** Fills the log past the real limit with valid, recognisable lines. */
  function fillPastLimit(dir: string): number {
    mkdirSync(dir, { recursive: true });
    const line = `${JSON.stringify({ ts: '2026-09-01T00:00:00.000Z', event: 'Filler', agent: 'filler' })}\n`;
    const count = Math.ceil(ROTATE_BYTES / line.length) + 1;
    writeFileSync(join(dir, LOG_FILE), line.repeat(count));
    expect(statSync(join(dir, LOG_FILE)).size).toBeGreaterThanOrEqual(ROTATE_BYTES);
    return count;
  }

  it('rotates at 5 MB: the old log becomes events.1.jsonl and the new line starts a fresh file', async () => {
    const temp = makeTempDir('hook-rot-');
    try {
      const dir = join(temp.dir, LOG_DIR);
      const filler = fillPastLimit(dir);
      writeFileSync(join(dir, BACKUP_FILE), 'old backup\n');
      const r = await runHook(
        JSON.stringify({ hook_event_name: 'Stop', session_id: 'after' }),
        temp.dir,
      );
      expect(r.code).toBe(0);
      expect(readLines(join(dir, BACKUP_FILE))).toHaveLength(filler);
      const current = readLines(join(dir, LOG_FILE));
      expect(current).toHaveLength(1);
      expect(JSON.parse(current[0] ?? '{}')).toMatchObject({ event: 'Stop', session: 'after' });
      // Only one backup is kept, and the lock is gone.
      expect(readdirSync(dir).sort()).toEqual([BACKUP_FILE, LOG_FILE].sort());
    } finally {
      temp.cleanup();
    }
  }, 60_000);

  it('does not rotate below the limit', async () => {
    const temp = makeTempDir('hook-rot-');
    try {
      const dir = join(temp.dir, LOG_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, LOG_FILE), 'x'.repeat(ROTATE_BYTES - 1000) + '\n');
      await runHook(JSON.stringify({ hook_event_name: 'Stop' }), temp.dir);
      expect(existsSync(join(dir, BACKUP_FILE))).toBe(false);
    } finally {
      temp.cleanup();
    }
  }, 60_000);

  it(`${WRITERS} parallel writers racing at the limit: one rotation at most, no line lost or torn`, async () => {
    const temp = makeTempDir('hook-race-');
    try {
      const dir = join(temp.dir, LOG_DIR);
      const filler = fillPastLimit(dir);
      const results = await Promise.all(
        Array.from({ length: WRITERS }, (_, i) => runHook(payload(i), temp.dir)),
      );
      for (const r of results) expect(r.code).toBe(0);

      const backup = readLines(join(dir, BACKUP_FILE));
      const current = readLines(join(dir, LOG_FILE));
      const all = [...backup, ...current];
      const fillers = all.filter((l) => l.includes('"Filler"'));
      const written = all.filter((l) => l.includes('"PreToolUse"'));
      // The 5 MB of history survives exactly once, wherever it ended up.
      expect(fillers).toHaveLength(filler);
      expect(written).toHaveLength(WRITERS);
      for (const line of all) expect(() => JSON.parse(line)).not.toThrow();
      expect(existsSync(join(dir, 'rotate.lock'))).toBe(false);
      // Rotation must have happened: at least one writer reached the lock first.
      expect(existsSync(join(dir, BACKUP_FILE))).toBe(true);
    } finally {
      temp.cleanup();
    }
  }, 120_000);

  it('finishes fast even with no stdin end (never blocks Claude)', async () => {
    const temp = makeTempDir('hook-fast-');
    try {
      const started = Date.now();
      const code = await new Promise<number | null>((resolve) => {
        const child = spawn(process.execPath, [SCRIPT], {
          env: { ...process.env, CLAUDE_PROJECT_DIR: temp.dir },
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        child.stdin.write('{"hook_event_name":"Stop"'); // never ended
        child.on('close', resolve);
      });
      expect(code).toBe(0);
      // The logger gives stdin 3 s; allow for process start-up on a busy machine.
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      temp.cleanup();
    }
  }, 30_000);
});
