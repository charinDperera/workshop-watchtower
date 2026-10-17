import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createClientMatcher,
  parseAllowedHost,
  parseClientEntry,
  readServerEnv,
  ServerEnvError,
} from '../../scripts/server-env.mjs';
import {
  createRequestPolicy,
  loadServerSettings,
  type ServerSettings,
} from '../../src/server/config/env';
import { guardRequest } from '../../src/server/security/request-guard';
import { gitEnv } from '../../src/server/sources/git';
import {
  diffTrees,
  pollWorkstation,
  scanTree,
  type TreeState,
} from '../../src/server/live/poll-watcher';
import { GET as health } from '../../src/pages/api/health';
import { APP_DIR, makeTempDir } from './helpers';

const runtimeSpy = vi.hoisted(() => ({ getRuntime: vi.fn() }));
vi.mock('../../src/server/live/runtime', () => runtimeSpy);

const START = fileURLToPath(new URL('../../scripts/start.mjs', import.meta.url));

describe('server settings from the environment', () => {
  it('defaults to the host behaviour', () => {
    expect(readServerEnv({})).toEqual({
      container: false,
      host: '127.0.0.1',
      port: 4321,
      trustedClients: [],
      allowedHosts: [],
      pollMs: null,
    });
  });

  it('ignores HOST outside container mode, but honours PORT', () => {
    expect(readServerEnv({ HOST: '0.0.0.0', PORT: '8080' })).toMatchObject({
      host: '127.0.0.1',
      port: 8080,
    });
  });

  it('honours HOST in container mode, defaulting to 0.0.0.0', () => {
    expect(readServerEnv({ WATCHTOWER_CONTAINER: '1' }).host).toBe('0.0.0.0');
    expect(readServerEnv({ WATCHTOWER_CONTAINER: '1', HOST: '::' }).host).toBe('::');
    expect(readServerEnv({ WATCHTOWER_CONTAINER: '0', HOST: '0.0.0.0' }).host).toBe('127.0.0.1');
  });

  it('reads every container setting', () => {
    expect(
      readServerEnv({
        WATCHTOWER_CONTAINER: '1',
        WATCHTOWER_TRUSTED_CLIENTS: ' 172.17.0.1 , 192.168.65.0/24,fd00::/8 ',
        WATCHTOWER_ALLOWED_HOSTS: 'localhost:8080,[::1]:8080',
        WATCHTOWER_POLL_MS: '2000',
      }),
    ).toMatchObject({
      trustedClients: [
        { address: '172.17.0.1', prefix: null, family: 4 },
        { address: '192.168.65.0', prefix: 24, family: 4 },
        { address: 'fd00::', prefix: 8, family: 6 },
      ],
      allowedHosts: ['localhost:8080', '[::1]:8080'],
      pollMs: 2000,
    });
  });

  it.each([
    [{ WATCHTOWER_CONTAINER: 'yes' }, /WATCHTOWER_CONTAINER must be 1 or 0/],
    [{ WATCHTOWER_CONTAINER: '1', HOST: 'my-host' }, /HOST must be an IP/],
    [{ PORT: '0' }, /PORT must be an integer from 1 to 65535/],
    [{ PORT: '65536' }, /PORT/],
    [{ PORT: '80.5' }, /PORT/],
    [{ WATCHTOWER_TRUSTED_CLIENTS: '172.17.0.1' }, /needs WATCHTOWER_CONTAINER=1/],
    [{ WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '172.17.0' }, /not an IP or CIDR/],
    [{ WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: 'docker.host' }, /not an IP or CIDR/],
    [{ WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '10.0.0.0/33' }, /bad prefix/],
    [
      { WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '10.0.0.0/8/1' },
      /not an IP or CIDR/,
    ],
    [
      { WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: 'fe80::1%eth0' },
      /not an IP or CIDR/,
    ],
    [{ WATCHTOWER_ALLOWED_HOSTS: 'localhost' }, /not a host:port/],
    [{ WATCHTOWER_ALLOWED_HOSTS: 'evil.test:99999' }, /not a host:port/],
    [{ WATCHTOWER_ALLOWED_HOSTS: 'a b:80' }, /not a host:port/],
    [{ WATCHTOWER_POLL_MS: '10' }, /250 to 60000/],
    [{ WATCHTOWER_POLL_MS: 'fast' }, /WATCHTOWER_POLL_MS/],
  ])('rejects %o', (env, message) => {
    expect(() => readServerEnv(env)).toThrow(ServerEnvError);
    expect(() => readServerEnv(env)).toThrow(message);
  });

  it('parses single entries', () => {
    expect(parseClientEntry('::1')).toEqual({ address: '::1', prefix: null, family: 6 });
    expect(parseAllowedHost('LocalHost:4321')).toBe('localhost:4321');
  });

  it('reports a bad environment as data for the middleware', () => {
    expect(loadServerSettings({ PORT: 'x' })).toEqual({
      ok: false,
      error: 'PORT must be an integer from 1 to 65535, not "x"',
    });
  });
});

describe('trusted clients', () => {
  it('matches addresses and subnets, including IPv4-mapped peers', () => {
    const match = createClientMatcher([
      parseClientEntry('172.17.0.1'),
      parseClientEntry('192.168.65.0/24'),
    ]);
    expect(match('172.17.0.1')).toBe(true);
    expect(match('::ffff:172.17.0.1')).toBe(true);
    expect(match('192.168.65.254')).toBe(true);
    expect(match('172.17.0.2')).toBe(false);
    expect(match('192.168.66.1')).toBe(false);
    expect(match('not-an-ip')).toBe(false);
    expect(createClientMatcher([])('172.17.0.1')).toBe(false);
  });
});

describe('request policy', () => {
  const settings = (over: Partial<ServerSettings> = {}): ServerSettings => ({
    ...(readServerEnv({}) as ServerSettings),
    ...over,
  });
  const req = (address: string, host = '127.0.0.1:4321') => ({ host, address, aborted: false });

  it('keeps the host policy by default', () => {
    const policy = createRequestPolicy(settings());
    expect(guardRequest(req('127.0.0.1'), policy)).toEqual({ allow: true });
    expect(guardRequest(req('172.17.0.1'), policy)).toMatchObject({ allow: false, status: 403 });
    expect(guardRequest(req('127.0.0.1', 'localhost:8080'), policy)).toMatchObject({
      allow: false,
      error: 'Host not allowed',
    });
  });

  it('admits the Docker gateway in container mode only when it is listed', () => {
    const env = { WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '172.17.0.1' };
    const policy = createRequestPolicy(readServerEnv(env) as ServerSettings);
    expect(guardRequest(req('172.17.0.1'), policy)).toEqual({ allow: true });
    expect(guardRequest(req('172.17.0.9'), policy)).toMatchObject({
      allow: false,
      log: 'rejected request from an untrusted address',
    });
    // The HEALTHCHECK from inside the container: loopback with Host localhost:4321.
    expect(guardRequest(req('127.0.0.1', 'localhost:4321'), policy)).toEqual({ allow: true });
    // A spoofed Host is still refused, even from a trusted peer.
    expect(guardRequest(req('172.17.0.1', 'evil.test:4321'), policy)).toMatchObject({
      allow: false,
      error: 'Host not allowed',
    });
  });

  it('never trusts listed clients outside container mode', () => {
    const policy = createRequestPolicy(
      settings({ trustedClients: [parseClientEntry('172.17.0.1')] }),
    );
    expect(guardRequest(req('172.17.0.1'), policy)).toMatchObject({ allow: false });
  });

  it('adds WATCHTOWER_ALLOWED_HOSTS to the fixed Host values', () => {
    const policy = createRequestPolicy(settings({ allowedHosts: ['localhost:8080'] }));
    expect(guardRequest(req('127.0.0.1', 'localhost:8080'), policy)).toEqual({ allow: true });
    expect(guardRequest(req('127.0.0.1', 'localhost:4321'), policy)).toEqual({ allow: true });
  });
});

describe('start script', () => {
  it('refuses to start on a bad environment, before loading the server', () => {
    const result = spawnSync(process.execPath, [START], {
      cwd: APP_DIR,
      env: { ...process.env, WATCHTOWER_TRUSTED_CLIENTS: '172.17.0.1', WATCHTOWER_CONTAINER: '' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refusing to start: WATCHTOWER_TRUSTED_CLIENTS needs/);
    expect(result.stdout).not.toMatch(/starting on/);
  });
});

describe('git in a container', () => {
  it('changes nothing on the host', () => {
    const env = gitEnv({ PATH: 'p' }, '/workstation', { safeDirectory: false });
    expect(env).toEqual({
      PATH: 'p',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    });
  });

  it('marks only the repository being read as safe, through env', () => {
    expect(gitEnv({}, '/workstation/apps/site', { safeDirectory: true })).toMatchObject({
      GIT_OPTIONAL_LOCKS: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '/workstation/apps/site',
    });
    expect(gitEnv({}, 'F:\\Projects', { safeDirectory: true }).GIT_CONFIG_VALUE_0).toBe(
      'F:/Projects',
    );
  });

  it('appends to GIT_CONFIG entries already in the environment', () => {
    const env = gitEnv(
      { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'cat' },
      '/w',
      { safeDirectory: true },
    );
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.pager',
      GIT_CONFIG_KEY_1: 'safe.directory',
      GIT_CONFIG_VALUE_1: '/w',
    });
  });

  it('is honoured by the real git as protected (command) configuration', () => {
    const result = spawnSync('git', ['config', '--show-scope', '--get-all', 'safe.directory'], {
      env: gitEnv(process.env, 'F:/does-not-matter', { safeDirectory: true }),
      encoding: 'utf8',
    });
    if (result.error) return; // git not installed: covered by the pure tests above
    expect(result.stdout).toMatch(/^command\tF:\/does-not-matter$/m);
  });
});

describe('polling watcher', () => {
  it('scans files, skipping ignored folders before entering them', async () => {
    const temp = makeTempDir('poll-');
    try {
      mkdirSync(join(temp.dir, 'apps', 'site', 'node_modules', 'deep'), { recursive: true });
      mkdirSync(join(temp.dir, '.git', 'objects', 'ab'), { recursive: true });
      mkdirSync(join(temp.dir, '.watchtower'));
      writeFileSync(join(temp.dir, 'ROSTER.md'), 'x');
      writeFileSync(join(temp.dir, 'apps', 'site', 'node_modules', 'deep', 'a.js'), 'x');
      writeFileSync(join(temp.dir, '.git', 'HEAD'), 'ref');
      writeFileSync(join(temp.dir, '.git', 'objects', 'ab', 'cd'), 'x');
      writeFileSync(join(temp.dir, '.watchtower', 'events.jsonl'), '');
      const state = await scanTree(temp.dir);
      expect([...state.keys()].sort()).toEqual([
        '.git/HEAD',
        '.watchtower/events.jsonl',
        'ROSTER.md',
      ]);
    } finally {
      temp.cleanup();
    }
  });

  it('diffs by mtime and size, including added and removed files', () => {
    const before: TreeState = new Map([
      ['a', '1:1'],
      ['b', '1:1'],
      ['c', '1:1'],
    ]);
    const after: TreeState = new Map([
      ['a', '1:1'],
      ['b', '2:1'],
      ['d', '1:1'],
    ]);
    expect(diffTrees(before, after)).toEqual(['b', 'c', 'd']);
    expect(diffTrees(after, after)).toEqual([]);
  });

  it('reports changes and event-log changes on the next tick, never on the first scan', async () => {
    vi.useFakeTimers();
    try {
      const states: TreeState[] = [
        new Map([['ROSTER.md', '1:1']]),
        new Map([['ROSTER.md', '1:1']]),
        new Map([
          ['ROSTER.md', '2:1'],
          ['.watchtower/events.jsonl', '1:9'],
        ]),
      ];
      let calls = 0;
      const scan = async () => states[Math.min(calls++, states.length - 1)] as TreeState;
      const handlers = { onChange: vi.fn(), onEventLog: vi.fn(), onError: vi.fn() };
      const watcher = pollWorkstation('/root', handlers, 1000, scan);
      await vi.advanceTimersByTimeAsync(0);
      expect(handlers.onChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(handlers.onChange).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(handlers.onChange).toHaveBeenCalledWith(['.watchtower/events.jsonl', 'ROSTER.md']);
      expect(handlers.onEventLog).toHaveBeenCalledTimes(1);
      watcher.close();
      const before = calls;
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling after a failed scan', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const scan = async (): Promise<TreeState> => {
        calls += 1;
        if (calls === 2) throw new Error('EACCES');
        return new Map([['x', `${calls}:1`]]);
      };
      const handlers = { onChange: vi.fn(), onEventLog: vi.fn(), onError: vi.fn() };
      const watcher = pollWorkstation('/root', handlers, 100, scan);
      await vi.advanceTimersByTimeAsync(350);
      watcher.close();
      expect(handlers.onError).toHaveBeenCalledWith(new Error('EACCES'));
      expect(handlers.onChange).toHaveBeenCalledWith(['x']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sees real edits, appends and deletions', async () => {
    const temp = makeTempDir('poll-');
    try {
      mkdirSync(join(temp.dir, '.watchtower'));
      const roster = join(temp.dir, 'ROSTER.md');
      const log = join(temp.dir, '.watchtower', 'events.jsonl');
      writeFileSync(roster, 'a');
      writeFileSync(log, '');
      const before = await scanTree(temp.dir);
      appendFileSync(log, '{}\n');
      utimesSync(roster, new Date(2000, 0, 1), new Date(2000, 0, 1));
      writeFileSync(join(temp.dir, 'new.md'), 'n');
      const middle = await scanTree(temp.dir);
      expect(diffTrees(before, middle)).toEqual([
        '.watchtower/events.jsonl',
        'ROSTER.md',
        'new.md',
      ]);
      rmSync(join(temp.dir, 'new.md'));
      expect(diffTrees(middle, await scanTree(temp.dir))).toEqual(['new.md']);
    } finally {
      temp.cleanup();
    }
  });
});

describe('GET /api/health', () => {
  it('answers ok with the version, without building a snapshot', async () => {
    const response = await health({} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { version } = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(await response.json()).toEqual({ ok: true, version });
    expect(runtimeSpy.getRuntime).not.toHaveBeenCalled();
  });
});
