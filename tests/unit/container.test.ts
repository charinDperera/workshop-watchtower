import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
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
  readDistDir,
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
import { createExecGit, GIT_SAFETY_ARGS, gitArgs, gitEnv } from '../../src/server/sources/git';
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
      publicOrigin: null,
      distDir: join(APP_DIR, 'dist'),
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
      publicOrigin: null,
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

describe('behind the workstation gateway (WATCHTOWER_PUBLIC_ORIGIN)', () => {
  const ORIGIN = 'https://dev-watchtower.workshop.io';
  const gateway = () =>
    readServerEnv({
      WATCHTOWER_CONTAINER: '1',
      WATCHTOWER_TRUSTED_CLIENTS: '172.30.50.2',
      WATCHTOWER_PUBLIC_ORIGIN: ORIGIN,
    }) as ServerEnv;

  it('accepts a strict origin, normalised, and shows it in the startup summary', () => {
    expect(gateway().publicOrigin).toBe(ORIGIN);
    expect(
      readServerEnv({ WATCHTOWER_PUBLIC_ORIGIN: 'HTTPS://Dev-Watchtower.Workshop.io' })
        .publicOrigin,
    ).toBe(ORIGIN);
    expect(readServerEnv({ WATCHTOWER_PUBLIC_ORIGIN: 'http://localhost:8080' }).publicOrigin).toBe(
      'http://localhost:8080',
    );
    expect(summariseServerEnv(gateway())).toMatchObject({ publicOrigin: ORIGIN });
  });

  it.each([
    'https://dev-watchtower.workshop.io/',
    'https://dev-watchtower.workshop.io/app',
    'https://dev-watchtower.workshop.io?x=1',
    'https://dev-watchtower.workshop.io#top',
    'https://user:SECRET@dev-watchtower.workshop.io',
    'https://dev-watchtower.workshop.io:443',
    'ftp://dev-watchtower.workshop.io',
    'dev-watchtower.workshop.io',
    'SECRET-not-a-url',
  ])('rejects %s, by name only', (value) => {
    const result = loadEnv({ WATCHTOWER_PUBLIC_ORIGIN: value });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.variables).toEqual(['WATCHTOWER_PUBLIC_ORIGIN']);
      expect(result.error).toContain('must be an http or https origin with no path');
      expect(result.error).not.toContain('SECRET');
      expect(result.error).not.toContain('dev-watchtower');
    }
  });

  it('admits the gateway Host and the gateway peer, and nothing via X-Forwarded-*', () => {
    const policy = createRequestPolicy(gateway());
    const req = (host: string, address: string) => ({ host, address, aborted: false });
    // nginx (172.30.50.2) with Host: dev-watchtower.workshop.io
    expect(guardRequest(req('dev-watchtower.workshop.io', '172.30.50.2'), policy)).toEqual({
      allow: true,
    });
    // The same Host from any other peer is still refused: the peer check is the boundary.
    expect(guardRequest(req('dev-watchtower.workshop.io', '172.30.50.9'), policy)).toMatchObject({
      allow: false,
      status: 403,
    });
    // A port in the origin is part of the admitted Host.
    const ported = createRequestPolicy(
      readServerEnv({ WATCHTOWER_PUBLIC_ORIGIN: 'http://gw.test:8080' }) as ServerEnv,
    );
    expect(guardRequest(req('gw.test:8080', '127.0.0.1'), ported)).toEqual({ allow: true });
    expect(guardRequest(req('gw.test', '127.0.0.1'), ported)).toMatchObject({ allow: false });
    // Without the variable the gateway Host is refused.
    expect(
      guardRequest(
        req('dev-watchtower.workshop.io', '127.0.0.1'),
        createRequestPolicy(readServerEnv({}) as ServerEnv),
      ),
    ).toMatchObject({ allow: false });
  });
});

describe('WATCHTOWER_DIST_DIR (a separate build per user, e.g. e2e)', () => {
  it('defaults to <app>/dist, and resolves relative paths against the app folder', () => {
    expect(readDistDir({})).toBe(join(APP_DIR, 'dist'));
    expect(readDistDir({ WATCHTOWER_DIST_DIR: '  ' })).toBe(join(APP_DIR, 'dist'));
    expect(readDistDir({ WATCHTOWER_DIST_DIR: '.local/peter/e2e/dist' })).toBe(
      join(APP_DIR, '.local', 'peter', 'e2e', 'dist'),
    );
    const temp = makeTempDir('dist-');
    try {
      expect(readDistDir({ WATCHTOWER_DIST_DIR: temp.dir })).toBe(temp.dir);
      // The full config carries the same value.
      expect(readServerEnv({ WATCHTOWER_DIST_DIR: temp.dir }).distDir).toBe(temp.dir);
    } finally {
      temp.cleanup();
    }
  });

  it('refuses the app folder or anything above it (astro build empties outDir)', () => {
    for (const value of ['.', '..', APP_DIR, join(APP_DIR, '..', '..')]) {
      const result = loadEnv({ WATCHTOWER_DIST_DIR: value });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.variables).toEqual(['WATCHTOWER_DIST_DIR']);
        expect(result.error).toContain('must not be the app folder or a folder above it');
      }
    }
  });
});

describe('fail fast with a useful message', () => {
  it('in container mode, a missing workstation says how to run it', () => {
    const result = loadEnv({
      WATCHTOWER_CONTAINER: '1',
      WATCHTOWER_ROOT: 'F:/no/such/workstation',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.variables).toEqual(['WATCHTOWER_ROOT']);
      expect(result.error).toContain(
        'No workstation is mounted at /workstation. Run The Watchtower with `docker compose up` from apps/watchtower (see README).',
      );
      expect(result.error).not.toContain('no/such');
    }
    // On the host the message stays plain.
    const host = loadEnv({ WATCHTOWER_ROOT: 'F:/no/such/workstation' });
    expect(host.ok).toBe(false);
    if (!host.ok) expect(host.error).toContain('WATCHTOWER_ROOT is not an existing directory');
  });

  it('refuses a LOG_DIR that is the workstation root or above it', () => {
    const temp = makeTempDir('root-');
    try {
      for (const dir of [temp.dir, join(temp.dir, '..')]) {
        const result = loadEnv({ WATCHTOWER_ROOT: temp.dir, LOG_DIR: dir });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.variables).toEqual(['LOG_DIR']);
          expect(result.error).toContain('must not be the workstation root or a folder above it');
        }
      }
      // Inside the root (the default place) and outside it are both fine.
      expect(
        loadEnv({ WATCHTOWER_ROOT: temp.dir, LOG_DIR: join(temp.dir, 'limforia', 'logs') }).ok,
      ).toBe(true);
      expect(loadEnv({ WATCHTOWER_ROOT: temp.dir, LOG_DIR: '/var/log/app' }).ok).toBe(true);
    } finally {
      temp.cleanup();
    }
  });
});

describe('git in a container', () => {
  it('always runs git with fsmonitor off and no hooks, before the command', () => {
    expect(GIT_SAFETY_ARGS).toEqual([
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
    ]);
    expect(gitArgs(['status', '--porcelain=v2'])).toEqual([
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      'status',
      '--porcelain=v2',
    ]);
  });

  it('points hooks where no hook can ever exist (resolved by the real git)', async () => {
    let resolved: string;
    try {
      // The app folder is a git repository; rev-parse only reads.
      resolved = (
        await createExecGit()(APP_DIR, ['rev-parse', '--git-path', 'hooks/pre-commit'])
      ).trim();
    } catch (err) {
      if ((err as { kind?: string }).kind === 'missing-binary') return;
      throw err;
    }
    // POSIX: /dev/null/pre-commit (/dev/null is not a folder). Git for Windows: nul/pre-commit.
    expect(['/dev/null/pre-commit', 'nul/pre-commit']).toContain(resolved);
    expect(existsSync(resolved)).toBe(false);
    // Not the repository's hooks, and not the filesystem root (what an empty value gives).
    expect(resolved).not.toContain('.git/hooks');
    expect(resolved).not.toBe('/pre-commit');
  });

  it('runs the real git with those options', async () => {
    const temp = makeTempDir('git-');
    try {
      const out = await createExecGit()(temp.dir, ['--version']);
      expect(out).toMatch(/^git version /);
    } catch (err) {
      if ((err as { kind?: string }).kind !== 'missing-binary') throw err;
    } finally {
      temp.cleanup();
    }
  });

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
