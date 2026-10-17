/**
 * The disposable workstation the e2e server runs on. Peter's.
 *
 * `prepareWorkstation()` copies `tests/fixtures/workstation` to `.local/peter/e2e/ws` (inside
 * the app, ignored by git, inside F:\Projects), then adds what the browser tests need:
 * - 60 older hook events, so `/activity` has an "Older" page;
 * - a junction `limforia/escape` that points out of the workstation, for traversal tests;
 * - a marker file, so tests that write into the workstation refuse any other root.
 *
 * Never point WATCHTOWER_E2E_ROOT at the real workstation: the live specs write into it,
 * and they skip unless the marker is present.
 */
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = fileURLToPath(new URL('../../..', import.meta.url));
export const FIXTURE = join(APP_DIR, 'tests', 'fixtures', 'workstation');
export const E2E_BASE = join(APP_DIR, '.local', 'peter', 'e2e');
export const DEFAULT_ROOT = join(E2E_BASE, 'ws');
export const OUTSIDE_DIR = join(E2E_BASE, 'outside');
export const MARKER = '.watchtower-e2e-disposable';
export const OUTSIDE_SECRET = 'E2E-OUTSIDE-SECRET';

/** The e2e server: never 4321, which belongs to the User's server and Raphael's container. */
export const E2E_PORT = 4399;
export const E2E_HOST = `127.0.0.1:${E2E_PORT}`;
/** The e2e server's LOG_DIR (bff/ and client/ JSONL files), emptied for every run. */
export const E2E_LOG_DIR = join(E2E_BASE, 'logs');

/**
 * A second e2e server on the same workstation, as if behind the gateway: it has
 * WATCHTOWER_PUBLIC_ORIGIN set (the main server has it unset). HTTP-level tests only.
 */
export const GATEWAY_PORT = 4398;
export const GATEWAY_LOCAL_HOST = `127.0.0.1:${GATEWAY_PORT}`;
export const PUBLIC_ORIGIN = 'https://watchtower.e2e.test';
export const PUBLIC_HOST = 'watchtower.e2e.test';
export const GATEWAY_LOG_DIR = join(E2E_BASE, 'logs-gateway');

/** Older events seeded into the rotated log: Uriel searching, two per second apart. */
export const SEEDED_EVENTS = 60;
export const SEEDED_AGENT = 'uriel';

/**
 * Subagent events with an `agentId` but no named type, and no SubagentStart for that id:
 * one written the new way (`subagent`), one the legacy way (`michael`). Both must show as
 * "Unnamed subagent", never as Michael, and never link to /host/subagent.
 * Added to the e2e copy only, so the shared fixture's event counts (unit tests) stay put.
 */
export const UNATTRIBUTED_EVENTS = [
  {
    ts: '2026-10-01T12:30:00.000Z',
    event: 'SubagentStop',
    session: 's1',
    agent: 'subagent',
    agentId: 'agent-anon-new',
  },
  {
    ts: '2026-10-01T12:30:01.000Z',
    event: 'SubagentStop',
    session: 's1',
    agent: 'michael',
    agentId: 'agent-anon-legacy',
  },
];

function seededEvents(): string {
  const lines: string[] = [];
  for (let i = 0; i < SEEDED_EVENTS; i++) {
    const ts = new Date(Date.UTC(2026, 8, 29, 8, 0, i)).toISOString();
    lines.push(
      JSON.stringify({
        ts,
        event: i % 2 === 0 ? 'PreToolUse' : 'PostToolUse',
        session: 'seed',
        agent: SEEDED_AGENT,
        agentId: 'agent-seed',
        tool: 'WebSearch',
        toolUseId: `seed-${Math.floor(i / 2)}`,
      }),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Creates a fresh disposable workstation and returns its absolute path. */
export function prepareWorkstation(root: string = DEFAULT_ROOT): string {
  const target = resolve(root);
  if (!target.startsWith(resolve(E2E_BASE))) {
    throw new Error(`Refusing to prepare a workstation outside ${E2E_BASE}: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
  rmSync(OUTSIDE_DIR, { recursive: true, force: true });
  for (const dir of [E2E_LOG_DIR, GATEWAY_LOG_DIR]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(target, { recursive: true });
  cpSync(FIXTURE, target, { recursive: true });

  appendFileSync(join(target, '.watchtower', 'events.1.jsonl'), seededEvents());
  // Unattributed subagent events: the newest in the log, so the Overview feed shows them.
  appendFileSync(
    join(target, '.watchtower', 'events.jsonl'),
    UNATTRIBUTED_EVENTS.map((e) => `${JSON.stringify(e)}\n`).join(''),
  );

  mkdirSync(OUTSIDE_DIR, { recursive: true });
  writeFileSync(join(OUTSIDE_DIR, 'secret.md'), `# Outside\n\n${OUTSIDE_SECRET}\n`);
  try {
    symlinkSync(OUTSIDE_DIR, join(target, 'limforia', 'escape'), 'junction');
  } catch {
    // Junctions or symlinks unavailable: the junction test skips itself.
  }

  writeFileSync(join(target, MARKER), 'Disposable e2e workstation. Safe to delete.\n');
  return target;
}

/** The root the e2e server is running on (set by playwright.config.ts). */
export function e2eRoot(): string {
  const root = process.env.WATCHTOWER_E2E_ROOT;
  if (!root) throw new Error('WATCHTOWER_E2E_ROOT is not set; run through playwright.config.ts');
  return root;
}

/** True only for a workstation made by `prepareWorkstation` (safe to write into). */
export function isDisposable(root: string): boolean {
  return existsSync(join(root, MARKER));
}

export function hasEscapeJunction(root: string): boolean {
  return existsSync(join(root, 'limforia', 'escape', 'secret.md'));
}

/** Saves a file's content (or its absence) and returns a function that puts it back. */
export function preserve(file: string): () => void {
  const had = existsSync(file);
  const content = had ? readFileSync(file) : null;
  return () => {
    if (content !== null) writeFileSync(file, content);
    else rmSync(file, { force: true });
  };
}

/** Appends hook events the way the logger does: one whole line per write. */
export function appendEvents(root: string, events: Record<string, unknown>[]): void {
  const file = join(root, '.watchtower', 'events.jsonl');
  for (const event of events) appendFileSync(file, `${JSON.stringify(event)}\n`);
}
