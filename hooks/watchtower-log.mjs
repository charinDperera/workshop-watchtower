#!/usr/bin/env node
// The Watchtower hook logger (SPEC section 4). Dependency-free.
//
// Claude Code runs this for each hook event (async, exec form: `node <this file>`), with
// the hook payload as JSON on stdin. It appends ONE line to
// `${CLAUDE_PROJECT_DIR}/.watchtower/events.jsonl` (falling back to the payload's `cwd`).
//
// Privacy: only names, ids and timestamps are written. Never the prompt, tool input,
// tool response, error text or assistant messages.
// Safety: it never blocks or fails Claude. It always exits 0 and swallows every error.

import { appendFileSync, mkdirSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROTATE_BYTES = 5 * 1024 * 1024;
export const LOG_DIR = '.watchtower';
export const LOG_FILE = 'events.jsonl';
export const BACKUP_FILE = 'events.1.jsonl';
const LOCK_DIR = 'rotate.lock';
const STALE_LOCK_MS = 10_000;
const MAX_FIELD_LENGTH = 200;
const STDIN_TIMEOUT_MS = 3_000;

/** Keeps a value only if it is a short, printable string. */
function clean(value) {
  if (typeof value !== 'string' || value === '') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_FIELD_LENGTH);
  return text === '' ? undefined : text;
}

/** Written when a payload has a subagent id but no subagent type (e.g. an internal subagent). */
export const UNNAMED_SUBAGENT = 'subagent';
export const MAIN_AGENT = 'michael';

/**
 * The agent slug: the subagent type when given; `subagent` when only a subagent id is given
 * (some SubagentStop payloads carry no type); `michael` only when neither is present.
 */
export function agentOf(agentType, agentId) {
  if (agentType) return agentType.toLowerCase();
  return agentId ? UNNAMED_SUBAGENT : MAIN_AGENT;
}

/**
 * Builds the log line from a hook payload. Reads an explicit allowlist of fields only,
 * so nothing sensitive can leak in by accident. Returns `null` for unusable payloads.
 */
export function buildEvent(payload, now = new Date()) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = clean(payload.hook_event_name);
  if (!event) return null;

  const agentType = clean(payload.agent_type);
  const agentId = clean(payload.agent_id);
  const entry = {
    ts: now.toISOString(),
    event,
    session: clean(payload.session_id),
    agent: agentOf(agentType, agentId),
    agentId,
    tool: clean(payload.tool_name),
    toolUseId: clean(payload.tool_use_id),
    source: event === 'SessionStart' ? clean(payload.source) : undefined,
    reason: event === 'SessionEnd' ? clean(payload.reason) : undefined,
    mcpServer: clean(payload.mcp_server),
  };
  for (const key of Object.keys(entry)) {
    if (entry[key] === undefined) delete entry[key];
  }
  return entry;
}

/** The project folder: CLAUDE_PROJECT_DIR, else the payload's cwd. `null` when neither. */
export function projectDir(env, payload) {
  const fromEnv = clean(env.CLAUDE_PROJECT_DIR);
  if (fromEnv) return resolve(fromEnv);
  const cwd = payload && typeof payload === 'object' ? clean(payload.cwd) : undefined;
  return cwd ? resolve(cwd) : null;
}

function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Rotates `events.jsonl` to `events.1.jsonl` once it reaches the limit, keeping one backup.
 * Several hook processes run at once, so a lock directory (mkdir is atomic) makes sure
 * only one of them rotates; the size is checked again under the lock. A lock older than
 * STALE_LOCK_MS (a crashed rotator) is broken.
 */
export function rotateIfNeeded(dir, limit = ROTATE_BYTES, nowMs = Date.now()) {
  const file = join(dir, LOG_FILE);
  if (sizeOf(file) < limit) return false;

  const lock = join(dir, LOCK_DIR);
  try {
    mkdirSync(lock);
  } catch {
    try {
      if (nowMs - statSync(lock).mtimeMs > STALE_LOCK_MS) rmdirSync(lock);
    } catch {
      // Another process removed it first.
    }
    return false;
  }
  try {
    if (sizeOf(file) < limit) return false;
    renameSync(file, join(dir, BACKUP_FILE));
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      // Already gone.
    }
  }
}

/** Writes one event for one payload. Returns true when a line was appended. */
export function logEvent(payload, env = process.env, now = new Date(), limit = ROTATE_BYTES) {
  const entry = buildEvent(payload, now);
  const root = projectDir(env, payload);
  if (!entry || !root) return false;

  const dir = join(root, LOG_DIR);
  mkdirSync(dir, { recursive: true });
  rotateIfNeeded(dir, limit, now.getTime());
  // One appendFileSync per line: a single small O_APPEND write, so concurrent hooks
  // never interleave inside a line.
  appendFileSync(join(dir, LOG_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
  return true;
}

function readStdin() {
  return new Promise((resolveText) => {
    const chunks = [];
    const done = () => resolveText(Buffer.concat(chunks).toString('utf8'));
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    timer.unref();
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

async function main() {
  try {
    const text = await readStdin();
    logEvent(JSON.parse(text));
  } catch {
    // Never fail Claude: malformed input or a write error is ignored.
  }
  process.exit(0);
}

const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const invokedDirectly =
  process.argv[1] !== undefined &&
  samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  void main();
}
