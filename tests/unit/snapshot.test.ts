import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../src/server/services/build-snapshot';
import { createWorkstationFs } from '../../src/server/sources/workstation-fs';
import { readAppRepo, readRepoState, GitError } from '../../src/server/sources/git';
import { CLEAN_FIXTURE, FIXTURE, copyFixture, fakeGit, makeTempDir } from './helpers';

const NOW = () => Date.parse('2026-10-01T12:00:30.000Z');
const noGit = fakeGit({});

function checks(snapshot: Awaited<ReturnType<typeof buildSnapshot>>) {
  return Object.fromEntries(snapshot.compliance.checks.map((c) => [c.id, c]));
}

describe('snapshot of the broken fixture workstation', async () => {
  const snapshot = await buildSnapshot({ fs: createWorkstationFs(FIXTURE), git: noGit, now: NOW });

  it('joins the host', () => {
    expect(snapshot.rootName).toBe('workstation');
    const slugs = snapshot.agents.map((a) => a.slug);
    expect(slugs).toEqual([
      'michael',
      'uriel',
      'paul',
      'peter',
      'thomas',
      'luke',
      'gabriel',
      'azazel',
      'broken',
      'raphiel',
    ]);
    expect(snapshot.agents.find((a) => a.slug === 'azazel')?.status).toBe('retired');
    expect(snapshot.agents.find((a) => a.slug === 'paul')).toMatchObject({
      strikes: 1,
      auditLogs: [
        'limforia/audit-hall/2026-10-01-paul-strike.md',
        'limforia/audit-hall/2026-10-02-paul-dismissed.md',
      ],
    });
    expect(snapshot.retired.map((r) => r.name)).toEqual(['Azazel']);
  });

  it('reads activity from the current and rotated logs, newest first, skipping bad lines', () => {
    expect(snapshot.activity).toMatchObject({ total: 13, skippedLines: 3 });
    expect(snapshot.activity.events[0]?.event).toBe('Stop');
    expect(snapshot.activity.events.at(-1)).toMatchObject({
      event: 'SessionStart',
      session: 's0',
    });
    // Paul's run stopped at 12:00:05 and Michael's turn at 12:00:06: both idle, completed.
    expect(snapshot.agents.find((a) => a.slug === 'paul')).toMatchObject({
      status: 'idle',
      activeReason: null,
      lastSeen: '2026-10-01T12:00:05.000Z',
      lastEnd: { at: '2026-10-01T12:00:05.000Z', outcome: 'completed' },
    });
    expect(snapshot.agents.find((a) => a.slug === 'michael')).toMatchObject({
      status: 'idle',
      lastEnd: { at: '2026-10-01T12:00:06.000Z', outcome: 'completed' },
    });
    // Nothing is open, so nothing will change on its own.
    expect(snapshot.validUntil).toBeNull();
  });

  it('reads rank, title and station, and builds the pipeline from the roster', () => {
    const agent = (slug: string) => snapshot.agents.find((a) => a.slug === slug);
    expect(agent('michael')).toMatchObject({ rank: 'overseer', isMain: true, stage: null });
    expect(agent('uriel')).toMatchObject({ rank: 'counsel', title: 'The Wizard', stage: null });
    expect(agent('peter')).toMatchObject({ rank: 'worker', station: 'Test', stage: 'test' });
    expect(agent('thomas')).toMatchObject({ title: null, station: 'Review' });
    // No title and no rank: a worker; his station `build` joins Paul's Build stage.
    expect(agent('gabriel')).toMatchObject({ title: null, rank: 'worker', stage: 'build' });
    // Unknown rank: a worker, reported.
    expect(agent('azazel')).toMatchObject({ rank: 'worker', stage: null });
    expect(snapshot.problems).toContainEqual({
      source: 'ROSTER.md',
      message: 'Unknown rank for Azazel: "Archangel" (treated as Worker)',
    });
    // A definition with no roster row is a worker outside the pipeline.
    expect(agent('raphiel')).toMatchObject({ rank: 'worker', title: null, station: null });
    expect(snapshot.pipeline.map((s) => [s.id, s.title, s.agents])).toEqual([
      ['build', 'Build', ['paul', 'gabriel']],
      ['test', 'Test', ['peter']],
      ['review', 'Review', ['thomas']],
      ['design', 'Design', ['luke']],
    ]);
  });

  it('gives each agent its own history from the whole log, newest first', () => {
    const recent = (slug: string) =>
      snapshot.agents.find((a) => a.slug === slug)?.recentEvents.map((e) => e.event);
    expect(recent('paul')).toEqual(['SubagentStop', 'PostToolUse', 'PreToolUse', 'SubagentStart']);
    // Peter only appears in the rotated file.
    expect(recent('peter')).toEqual([
      'SubagentStop',
      'PostToolUseFailure',
      'PreToolUse',
      'SubagentStart',
    ]);
    expect(recent('michael')).toEqual([
      'Stop',
      'UserPromptSubmit',
      'SessionStart',
      'SessionEnd',
      'SessionStart',
    ]);
    expect(recent('gabriel')).toEqual([]);
  });

  it('lists records by wing and excludes CATALOG.md', () => {
    const paths = snapshot.records.map((r) => r.path);
    expect(paths).not.toContain('limforia/CATALOG.md');
    expect(paths).toContain('limforia/templates/chronicle.md');
    const wing = (id: string) => snapshot.wings.find((w) => w.id === id)?.count;
    expect(wing('audit-hall')).toBe(7);
    expect(wing('chronicles')).toBe(2);
    expect(wing('intel')).toBe(2);
    expect(wing('reliquary')).toBe(0);
    expect(snapshot.records.find((r) => r.path.endsWith('first.md'))?.inCatalog).toBe(true);
  });

  it('fails each check for the planted reason', () => {
    const c = checks(snapshot);
    expect(c['roster-definitions']?.result).toBe('fail');
    expect(c['roster-definitions']?.details.join('\n')).toMatch(/Gabriel has no definition/);
    expect(c['roster-definitions']?.details.join('\n')).toMatch(/raphiel/);
    expect(c['unique-names']?.details).toEqual(
      expect.arrayContaining([
        '"luke" appears more than once in the roster',
        '"azazel" is active but bound in the Soul Binder',
      ]),
    );
    expect(c['record-headers']?.details.map((d) => d.split(':')[0])).toEqual([
      'limforia/scriptorium/issues/bad-header.md',
      'limforia/vault-of-ideas/no-header.md',
      'intel/broken-yaml.md',
    ]);
    expect(c['catalog-coverage']?.details).toEqual([
      'limforia/chronicles/2026-10-02-uncatalogued.md is not listed in CATALOG.md',
      'Link "scriptorium/features/does-not-exist.md" in Scriptorium does not resolve',
    ]);
    expect(c['strike-counts']?.details).toEqual([
      'Peter: roster says 0, audit hall holds 1',
      'Azazel: roster says 0, audit hall holds 1',
    ]);
    expect(c['three-strikes']?.details).toEqual(['Thomas has 3 / 3 strikes and is still active']);
    expect(c['clean-tree']).toMatchObject({
      result: 'warn',
      details: ['The workstation is not a git repository'],
    });
    expect(snapshot.compliance).toMatchObject({ pass: 0, warn: 1, fail: 6 });
  });

  it('lists apps, which are not repos here', () => {
    expect(snapshot.apps).toEqual([
      {
        name: 'demo-app',
        path: 'apps/demo-app',
        isRepo: false,
        branch: null,
        lastCommit: null,
        dirty: null,
        error: null,
      },
    ]);
    expect(snapshot.git.workstation).toMatchObject({ isRepo: false, ahead: null, upstream: null });
  });

  it('reports parse problems', () => {
    const sources = snapshot.problems.map((p) => p.source);
    expect(sources).toContain('.claude/agents/broken.md');
    expect(snapshot.problems).toEqual(
      expect.arrayContaining([
        { source: '.watchtower/events.1.jsonl', message: '1 malformed line(s) skipped' },
        { source: '.watchtower/events.jsonl', message: '2 malformed line(s) skipped' },
      ]),
    );
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('snapshot of the clean fixture workstation', () => {
  it('passes every check except the git warning', async () => {
    const snapshot = await buildSnapshot({
      fs: createWorkstationFs(CLEAN_FIXTURE),
      git: noGit,
      now: NOW,
    });
    expect(snapshot.compliance).toMatchObject({ pass: 6, warn: 1, fail: 0 });
    expect(snapshot.problems).toEqual([]);
    // Its roster is the legacy 5-column format: still read, Overseer inferred from the role.
    expect(snapshot.agents.map((a) => [a.slug, a.rank, a.isMain, a.title, a.station])).toEqual([
      ['michael', 'overseer', true, null, null],
      ['paul', 'worker', false, null, null],
    ]);
    expect(snapshot.pipeline).toEqual([]);
    expect(snapshot.activity).toEqual({ events: [], total: 0, skippedLines: 0 });
    // A strike for Paul, then a pardon of Paul: the roster's 0 / 3 is right (checks 5, 6 pass).
    const paul = snapshot.agents.find((a) => a.slug === 'paul');
    expect(paul).toMatchObject({ strikes: 0, pardonedAt: '2026-10-02' });
    expect(paul?.auditLogs).toEqual([
      'limforia/audit-hall/2026-10-01-paul-strike.md',
      'limforia/audit-hall/2026-10-02-pardon.md',
    ]);
    const check = (id: string) => snapshot.compliance.checks.find((c) => c.id === id)?.result;
    expect([check('strike-counts'), check('three-strikes')]).toEqual(['pass', 'pass']);
    expect(snapshot.agents.find((a) => a.slug === 'michael')?.pardonedAt).toBeNull();
  });

  it('sets validUntil to the 5-minute silence mark, then shows the run abandoned', async () => {
    const ws = copyFixture(CLEAN_FIXTURE);
    try {
      mkdirSync(join(ws.dir, '.watchtower'));
      writeFileSync(
        join(ws.dir, '.watchtower', 'events.jsonl'),
        '{"ts":"2026-10-01T12:00:00.000Z","event":"SubagentStart","session":"s","agent":"paul","agentId":"p1"}\n',
      );
      const at = (iso: string) =>
        buildSnapshot({ fs: createWorkstationFs(ws.dir), git: noGit, now: () => Date.parse(iso) });
      const open = await at('2026-10-01T12:01:00.000Z');
      expect(open.agents.find((a) => a.slug === 'paul')?.status).toBe('active');
      // The server rebuilds at validUntil, so the UI flips without a new event.
      expect(open.validUntil).toBe('2026-10-01T12:05:00.000Z');
      const silent = await at('2026-10-01T12:05:01.000Z');
      expect(silent.agents.find((a) => a.slug === 'paul')).toMatchObject({
        status: 'idle',
        lastEnd: { at: '2026-10-01T12:00:00.000Z', outcome: 'abandoned' },
      });
      expect(silent.validUntil).toBeNull();
    } finally {
      ws.cleanup();
    }
  });

  it('tolerates an empty folder as a workstation', async () => {
    const temp = makeTempDir();
    try {
      const snapshot = await buildSnapshot({
        fs: createWorkstationFs(temp.dir),
        git: noGit,
        now: NOW,
      });
      expect(snapshot.agents).toEqual([]);
      expect(snapshot.catalog.found).toBe(false);
      expect(snapshot.problems.map((p) => p.message)).toContain('File not found');
    } finally {
      temp.cleanup();
    }
  });
});

describe('git adapter', () => {
  let cleanup: () => void = () => {};
  afterEach(() => cleanup());

  function repoDir() {
    const temp = makeTempDir('repo-');
    cleanup = temp.cleanup;
    mkdirSync(join(temp.dir, '.git'));
    return temp.dir;
  }

  it('reads branch, commits and dirty count with fixed arguments', async () => {
    const hash = 'b'.repeat(40);
    const git = fakeGit({
      branch: 'main\n',
      log: `${hash}\x1f2026-10-16T00:00:00Z\x1fA\x1fs\x1e\n`,
      status: `# branch.oid ${hash}\n# branch.head main\n1 .M N... 100644 100644 100644 a a x\n? y\n`,
    });
    const state = await readRepoState(git, repoDir(), '.');
    expect(state).toMatchObject({
      isRepo: true,
      branch: 'main',
      dirty: 2,
      ahead: null,
      upstream: null,
      error: null,
    });
    expect(state.commits[0]?.hash).toBe(hash);
    expect(git.calls).toEqual(
      expect.arrayContaining([
        ['branch', '--show-current'],
        ['log', '-n50', expect.stringMatching(/^--format=%H/)],
        ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'],
      ]),
    );
  });

  it('reads the upstream and how far ahead of it the branch is', async () => {
    const git = fakeGit({
      branch: 'main\n',
      status:
        '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +3 -1\n',
    });
    const state = await readRepoState(git, repoDir(), '.');
    expect(state).toMatchObject({ dirty: 0, ahead: 3, upstream: 'origin/main', error: null });
  });

  it('keeps a gone upstream but does not invent an ahead count', async () => {
    const git = fakeGit({
      status: '# branch.oid abc\n# branch.head main\n# branch.upstream origin/gone\n',
    });
    const state = await readRepoState(git, repoDir(), '.');
    expect(state).toMatchObject({ ahead: null, upstream: 'origin/gone' });
  });

  it('carries no upstream for a folder that is not a repo', async () => {
    const temp = makeTempDir();
    cleanup = temp.cleanup;
    expect(await readRepoState(fakeGit({}), temp.dir, '.')).toMatchObject({
      isRepo: false,
      ahead: null,
      upstream: null,
    });
  });

  it('treats a repo without commits as empty, not broken', async () => {
    const git = fakeGit({
      log: new GitError(
        "fatal: your current branch 'main' does not have any commits yet",
        'failed',
      ),
    });
    const state = await readRepoState(git, repoDir(), '.');
    expect(state).toMatchObject({ isRepo: true, commits: [], branch: null, dirty: 0, error: null });
  });

  it('reports git failures as data', async () => {
    const git = fakeGit({ status: new GitError('git status timed out', 'timeout') });
    const app = await readAppRepo(git, repoDir(), 'x');
    expect(app).toMatchObject({ isRepo: true, error: 'git status timed out' });
  });

  it('does not run git in a folder without its own .git', async () => {
    const temp = makeTempDir();
    cleanup = temp.cleanup;
    const git = fakeGit({});
    expect((await readRepoState(git, temp.dir, 'apps/x')).isRepo).toBe(false);
    expect(git.calls).toEqual([]);
  });
});

describe('record revision', () => {
  it('changes when only the body of a record changes, so a new snapshot goes out', async () => {
    const ws = copyFixture();
    try {
      const path = 'limforia/chronicles/2026-10-01-first.md';
      const build = () =>
        buildSnapshot({ fs: createWorkstationFs(ws.dir), git: fakeGit({}), now: () => 0 });
      const before = await build();
      const again = await build();
      const file = join(ws.dir, ...path.split('/'));
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n\nLIVE-EDIT-MARKER\n`);
      const after = await build();
      const record = (s: Awaited<ReturnType<typeof build>>) =>
        s.records.find((r) => r.path === path);
      // Stable for unchanged text, so identical rebuilds are still not re-sent.
      expect(record(again)?.revision).toBe(record(before)?.revision);
      expect(record(before)?.revision).toMatch(/^[0-9a-f]{16}$/);
      // The body changed; title and header did not, yet the record (and the snapshot) did.
      expect(record(after)?.title).toBe(record(before)?.title);
      expect(record(after)?.header).toEqual(record(before)?.header);
      expect(record(after)?.revision).not.toBe(record(before)?.revision);
      const print = (s: Awaited<ReturnType<typeof build>>) =>
        JSON.stringify({ ...s, generatedAt: '' });
      expect(print(after)).not.toBe(print(before));
    } finally {
      ws.cleanup();
    }
  });
});

describe('snapshot updates with the workstation', () => {
  it('sees a newly written record', async () => {
    const ws = copyFixture();
    try {
      const fs = createWorkstationFs(ws.dir);
      const before = await buildSnapshot({ fs, git: noGit, now: NOW });
      writeFileSync(
        join(ws.dir, 'limforia', 'chronicles', '2026-10-03-new.md'),
        '---\ntype: chronicle\ndate: 2026-10-03\nagents: []\ntags: []\nstatus: open\n---\n# New\n',
      );
      const after = await buildSnapshot({ fs, git: noGit, now: NOW });
      expect(after.records.length).toBe(before.records.length + 1);
    } finally {
      ws.cleanup();
    }
  });
});
