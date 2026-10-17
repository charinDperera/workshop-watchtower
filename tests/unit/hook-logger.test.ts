import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_FILE,
  buildEvent,
  LOG_DIR,
  LOG_FILE,
  logEvent,
  projectDir,
  rotateIfNeeded,
} from '../../hooks/watchtower-log.mjs';
import { parseEventLine } from '../../src/server/sources/parse/events';
import { makeTempDir } from './helpers';

const SCRIPT = fileURLToPath(new URL('../../hooks/watchtower-log.mjs', import.meta.url));
const NOW = new Date('2026-10-16T12:00:00.000Z');

const SECRET = 'TOP-SECRET-VALUE';
const fullPayload = {
  session_id: 'sess-1',
  transcript_path: `C:/Users/x/${SECRET}.jsonl`,
  cwd: 'F:/Projects',
  permission_mode: 'default',
  hook_event_name: 'PostToolUse',
  agent_id: 'agent-abc',
  agent_type: 'Paul',
  tool_name: 'Bash',
  tool_use_id: 'toolu_1',
  tool_input: { command: SECRET },
  tool_response: { stdout: SECRET },
  prompt: SECRET,
  error: SECRET,
  last_assistant_message: SECRET,
};

describe('buildEvent', () => {
  it('keeps only allowlisted fields', () => {
    const event = buildEvent(fullPayload, NOW);
    expect(event).toEqual({
      ts: '2026-10-16T12:00:00.000Z',
      event: 'PostToolUse',
      session: 'sess-1',
      agent: 'paul',
      agentId: 'agent-abc',
      tool: 'Bash',
      toolUseId: 'toolu_1',
    });
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  it('defaults the agent to michael and records source and reason only where they belong', () => {
    expect(
      buildEvent({ hook_event_name: 'SessionStart', source: 'startup', reason: 'x' }, NOW),
    ).toEqual({
      ts: NOW.toISOString(),
      event: 'SessionStart',
      agent: 'michael',
      source: 'startup',
    });
    expect(
      buildEvent({ hook_event_name: 'SessionEnd', reason: 'logout', source: 'x' }, NOW),
    ).toMatchObject({
      reason: 'logout',
    });
    expect(
      buildEvent({ hook_event_name: 'PreToolUse', mcp_server: 'astro-docs' }, NOW),
    ).toMatchObject({
      mcpServer: 'astro-docs',
    });
  });

  it('rejects unusable payloads and strips control characters', () => {
    expect(buildEvent(null, NOW)).toBeNull();
    expect(buildEvent([], NOW)).toBeNull();
    expect(buildEvent({ session_id: 'x' }, NOW)).toBeNull();
    expect(buildEvent({ hook_event_name: 'Stop\n{"x":1}' }, NOW)?.event).toBe('Stop{"x":1}');
    expect(buildEvent({ hook_event_name: 'x'.repeat(500) }, NOW)?.event).toHaveLength(200);
  });

  it('writes "subagent" for a subagent id without a type, and "michael" only with neither', () => {
    // Real shape: an internal subagent's SubagentStop carries agent_id but no agent_type.
    expect(
      buildEvent(
        { hook_event_name: 'SubagentStop', session_id: 'b95411d0', agent_id: 'af39fa89631d0285a' },
        NOW,
      ),
    ).toEqual({
      ts: NOW.toISOString(),
      event: 'SubagentStop',
      session: 'b95411d0',
      agent: 'subagent',
      agentId: 'af39fa89631d0285a',
    });
    expect(
      buildEvent({ hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'Luke' }, NOW),
    ).toMatchObject({ agent: 'luke', agentId: 'x' });
    expect(buildEvent({ hook_event_name: 'Stop', agent_id: '' }, NOW)?.agent).toBe('michael');
    expect(buildEvent({ hook_event_name: 'Stop' }, NOW)?.agent).toBe('michael');
  });

  it('writes lines the server parses', () => {
    const event = buildEvent(fullPayload, NOW);
    expect(parseEventLine(JSON.stringify(event))).toMatchObject({
      agent: 'paul',
      toolUseId: 'toolu_1',
    });
  });
});

describe('projectDir', () => {
  it('prefers CLAUDE_PROJECT_DIR, then the payload cwd', () => {
    expect(projectDir({ CLAUDE_PROJECT_DIR: 'F:/Projects' }, { cwd: 'F:/Other' })).toMatch(
      /Projects$/,
    );
    expect(projectDir({}, { cwd: 'F:/Other' })).toMatch(/Other$/);
    expect(projectDir({}, {})).toBeNull();
  });
});

describe('logEvent and rotation', () => {
  it('creates the folder and appends one line per event', () => {
    const temp = makeTempDir('hook-');
    try {
      const env = { CLAUDE_PROJECT_DIR: temp.dir };
      expect(logEvent({ hook_event_name: 'Stop' }, env, NOW)).toBe(true);
      expect(logEvent({ hook_event_name: 'SessionEnd' }, env, NOW)).toBe(true);
      const lines = readFileSync(join(temp.dir, LOG_DIR, LOG_FILE), 'utf8')
        .trim()
        .split('\n');
      expect(lines.map((l) => JSON.parse(l).event)).toEqual(['Stop', 'SessionEnd']);
    } finally {
      temp.cleanup();
    }
  });

  it('rotates at the limit and keeps one backup', () => {
    const temp = makeTempDir('hook-');
    try {
      const env = { CLAUDE_PROJECT_DIR: temp.dir };
      const dir = join(temp.dir, LOG_DIR);
      logEvent({ hook_event_name: 'First' }, env, NOW, 100);
      writeFileSync(join(dir, LOG_FILE), 'x'.repeat(150) + '\n', { flag: 'a' });
      logEvent({ hook_event_name: 'AfterRotate' }, env, NOW, 100);
      expect(readFileSync(join(dir, BACKUP_FILE), 'utf8')).toContain('First');
      expect(readFileSync(join(dir, LOG_FILE), 'utf8')).toContain('AfterRotate');
      expect(readFileSync(join(dir, LOG_FILE), 'utf8')).not.toContain('First');
    } finally {
      temp.cleanup();
    }
  });

  it('does not rotate while another process holds the lock, and breaks a stale lock', () => {
    const temp = makeTempDir('hook-');
    try {
      const dir = temp.dir;
      writeFileSync(join(dir, LOG_FILE), 'x'.repeat(200));
      mkdirSync(join(dir, 'rotate.lock'));
      expect(rotateIfNeeded(dir, 100, Date.now())).toBe(false);
      expect(existsSync(join(dir, BACKUP_FILE))).toBe(false);
      // Ten minutes later the lock is stale: it is broken, and the next call rotates.
      const later = statSync(join(dir, 'rotate.lock')).mtimeMs + 600_000;
      expect(rotateIfNeeded(dir, 100, later)).toBe(false);
      expect(rotateIfNeeded(dir, 100, later)).toBe(true);
      expect(existsSync(join(dir, BACKUP_FILE))).toBe(true);
    } finally {
      temp.cleanup();
    }
  });
});

describe('the script as a process', () => {
  const run = (input: string, env: Record<string, string>) =>
    spawnSync(process.execPath, [SCRIPT], {
      input,
      env: { ...process.env, ...env },
      timeout: 10_000,
    });

  it('logs a payload from stdin and exits 0', () => {
    const temp = makeTempDir('hook-');
    try {
      const result = run(JSON.stringify(fullPayload), { CLAUDE_PROJECT_DIR: temp.dir });
      expect(result.status).toBe(0);
      const text = readFileSync(join(temp.dir, LOG_DIR, LOG_FILE), 'utf8');
      expect(JSON.parse(text)).toMatchObject({ event: 'PostToolUse', agent: 'paul' });
      expect(text).not.toContain(SECRET);
    } finally {
      temp.cleanup();
    }
  });

  it('exits 0 and writes nothing on garbage input', () => {
    const temp = makeTempDir('hook-');
    try {
      for (const input of ['', 'not json', '[]', '{"no":"event"}']) {
        expect(run(input, { CLAUDE_PROJECT_DIR: temp.dir }).status).toBe(0);
      }
      expect(existsSync(join(temp.dir, LOG_DIR, LOG_FILE))).toBe(false);
    } finally {
      temp.cleanup();
    }
  });

  it('exits 0 when the log cannot be written', () => {
    const temp = makeTempDir('hook-');
    try {
      // A file where the folder should be makes mkdir fail.
      writeFileSync(join(temp.dir, LOG_DIR), 'blocker');
      const result = run(JSON.stringify({ hook_event_name: 'Stop' }), {
        CLAUDE_PROJECT_DIR: temp.dir,
      });
      expect(result.status).toBe(0);
      expect(String(result.stderr)).toBe('');
    } finally {
      temp.cleanup();
    }
  });
});
