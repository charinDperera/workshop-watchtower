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
  summariseServerEnv,
} from '../../scripts/server-env.mjs';
import {
  loadEnv,
  type ServerEnv,
  type ServerSettings,
  type TrustedClient,
} from '../../src/server/config/env';
import { createRequestPolicy, guardRequest } from '../../src/server/security/request-guard';
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

describe('server settings from the environment (the one validator)', () => {
  const ROOT_DEFAULT = join(APP_DIR, '..', '..');

  it('defaults to the host behaviour, the real root and its log folder', () => {
    const settings = readServerEnv({});
    expect(settings).toEqual({
      nodeEnv: 'development',
      container: false,
      host: '127.0.0.1',
      port: 4321,
      root: ROOT_DEFAULT,
      trustedClients: [],
      allowedHosts: [],
      pollMs: null,
      logLevel: 'info',
      logDir: join(ROOT_DEFAULT, 'limforia', 'logs', 'watchtower'),
    });
    expect(Object.isFrozen(settings)).toBe(true);
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

  it('treats empty values as unset', () => {
    expect(readServerEnv({ PORT: '', LOG_LEVEL: '  ', WATCHTOWER_POLL_MS: '' })).toMatchObject({
      port: 4321,
      logLevel: 'info',
      pollMs: null,
    });
  });

  it('reads every setting', () => {
    const temp = makeTempDir('root-');
    try {
      expect(
        readServerEnv({
          NODE_ENV: 'production',
          WATCHTOWER_CONTAINER: '1',
          WATCHTOWER_ROOT: temp.dir,
          WATCHTOWER_TRUSTED_CLIENTS: ' 172.17.0.1 , 192.168.65.0/24,fd00::/8 ',
          WATCHTOWER_ALLOWED_HOSTS: 'localhost:8080,[::1]:8080',
          WATCHTOWER_POLL_MS: '2000',
          LOG_LEVEL: 'debug',
          LOG_DIR: '/var/log/app',
        }),
      ).toMatchObject({
        nodeEnv: 'production',
        root: temp.dir,
        trustedClients: [
          { address: '172.17.0.1', prefix: null, family: 4 },
          { address: '192.168.65.0', prefix: 24, family: 4 },
          { address: 'fd00::', prefix: 8, family: 6 },
        ],
        allowedHosts: ['localhost:8080', '[::1]:8080'],
        pollMs: 2000,
        logLevel: 'debug',
        logDir: '/var/log/app',
      });
      // LOG_DIR follows the root when not set.
      expect(readServerEnv({ WATCHTOWER_ROOT: temp.dir }).logDir).toBe(
        join(temp.dir, 'limforia', 'logs', 'watchtower'),
      );
    } finally {
      temp.cleanup();
    }
  });

  it.each([
    [{ NODE_ENV: 'staging' }, 'NODE_ENV', /must be one of development, test, production/],
    [{ WATCHTOWER_CONTAINER: 'yes' }, 'WATCHTOWER_CONTAINER', /must be 1 or 0/],
    [{ WATCHTOWER_CONTAINER: '1', HOST: 'my-host' }, 'HOST', /must be an IP address/],
    [{ PORT: '0' }, 'PORT', /must be an integer from 1 to 65535/],
    [{ PORT: '65536' }, 'PORT', /from 1 to 65535/],
    [{ PORT: '80.5' }, 'PORT', /integer/],
    [{ WATCHTOWER_ROOT: 'F:/no/such/folder' }, 'WATCHTOWER_ROOT', /not an existing directory/],
    [
      { WATCHTOWER_TRUSTED_CLIENTS: '172.17.0.1' },
      'WATCHTOWER_TRUSTED_CLIENTS',
      /needs WATCHTOWER_CONTAINER=1/,
    ],
    [
      { WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '172.17.0' },
      'WATCHTOWER_TRUSTED_CLIENTS',
      /entry 1 is not an IP or CIDR/,
    ],
    [
      { WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '10.0.0.1,docker.host' },
      'WATCHTOWER_TRUSTED_CLIENTS',
      /entry 2 is not an IP or CIDR/,
    ],
    [
      { WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '10.0.0.0/33' },
      'WATCHTOWER_TRUSTED_CLIENTS',
      /not an IP or CIDR/,
    ],
    [
      { WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: 'fe80::1%eth0' },
      'WATCHTOWER_TRUSTED_CLIENTS',
      /not an IP or CIDR/,
    ],
    [{ WATCHTOWER_ALLOWED_HOSTS: 'localhost' }, 'WATCHTOWER_ALLOWED_HOSTS', /not a host:port/],
    [
      { WATCHTOWER_ALLOWED_HOSTS: 'evil.test:99999' },
      'WATCHTOWER_ALLOWED_HOSTS',
      /not a host:port/,
    ],
    [{ WATCHTOWER_POLL_MS: '10' }, 'WATCHTOWER_POLL_MS', /250 to 60000/],
    [{ LOG_LEVEL: 'loud' }, 'LOG_LEVEL', /must be one of fatal/],
  ])('fails fast on %o, naming the variable', (env, variable, message) => {
    let error: unknown;
    try {
      readServerEnv(env);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ServerEnvError);
    expect((error as ServerEnvError).variables).toContain(variable);
    expect((error as Error).message).toMatch(message);
    expect((error as Error).message).toContain(variable);
  });

  it('never echoes a value in its error, even a secret-looking one', () => {
    const planted = {
      NODE_ENV: 'SECRET-NODE-ENV',
      WATCHTOWER_CONTAINER: 'SECRET-FLAG',
      PORT: 'SECRET-PORT',
      WATCHTOWER_ROOT: 'SECRET-ROOT-PATH',
      WATCHTOWER_ALLOWED_HOSTS: 'SECRET-HOST',
      WATCHTOWER_POLL_MS: 'SECRET-POLL',
      LOG_LEVEL: 'SECRET-LEVEL',
    };
    for (const [name, value] of Object.entries(planted)) {
      const result = loadEnv({ [name]: value });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.variables).toEqual([name]);
        expect(result.error).not.toContain('SECRET');
      }
    }
    // Every problem at once, still by name only.
    const all = loadEnv(planted);
    expect(all.ok).toBe(false);
    if (!all.ok) expect(all.error).not.toContain('SECRET');
  });

  it('parses single entries', () => {
    expect(parseClientEntry('::1')).toEqual({ address: '::1', prefix: null, family: 6 });
    expect(parseClientEntry('no')).toBeNull();
    expect(parseAllowedHost('LocalHost:4321')).toBe('localhost:4321');
    expect(parseAllowedHost('nope')).toBeNull();
  });

  it('reports a bad environment as data for the middleware (fail closed)', () => {
    expect(loadEnv({ PORT: 'x' })).toEqual({
      ok: false,
      error: 'Invalid environment: PORT must be an integer from 1 to 65535',
      variables: ['PORT'],
    });
    expect(loadEnv({}).ok).toBe(true);
  });

  it('summarises the config for the startup log without values that could be secret', () => {
    const summary = summariseServerEnv(
      readServerEnv({ WATCHTOWER_CONTAINER: '1', WATCHTOWER_TRUSTED_CLIENTS: '172.17.0.1' }),
    );
    expect(summary).toEqual({
      nodeEnv: 'development',
      container: true,
      host: '0.0.0.0',
      port: 4321,
      trustedClients: 1,
      extraAllowedHosts: 0,
      watch: 'fs.watch',
      logLevel: 'info',
    });
  });
});

const entry = (text: string): TrustedClient => parseClientEntry(text) as TrustedClient;

describe('trusted clients', () => {
  it('matches addresses and subnets, including IPv4-mapped peers', () => {
    const match = createClientMatcher([entry('172.17.0.1'), entry('192.168.65.0/24')]);
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
    ...(readServerEnv({}) as ServerEnv),
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
    const policy = createRequestPolicy(readServerEnv(env) as ServerEnv);
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
    const policy = createRequestPolicy(settings({ trustedClients: [entry('172.17.0.1')] }));
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
    expect(result.stderr).toMatch(/refusing to start: .*WATCHTOWER_TRUSTED_CLIENTS needs/);
    expect(result.stdout).not.toMatch(/server.started/);
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
