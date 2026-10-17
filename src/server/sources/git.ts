/**
 * Git access through `execFile` with fixed arguments: no shell, no user input in the
 * argument list, a timeout on every call (SPEC section 5).
 *
 * `GIT_OPTIONAL_LOCKS=0` stops `git status` from refreshing the index, so reading git
 * never writes into the workstation.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppRepo, RepoState } from '../../shared/types';
import { COMMIT_LIMIT, GIT_TIMEOUT_MS } from '../constants';
import {
  countPorcelain,
  LOG_FORMAT,
  parseBranchTracking,
  parseGitLog,
  type BranchTracking,
} from './parse/git';

export type GitRunner = (cwd: string, args: readonly string[]) => Promise<string>;

export class GitError extends Error {
  constructor(
    message: string,
    readonly kind: 'missing-binary' | 'timeout' | 'failed',
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitEnvOptions {
  /**
   * Container mode: the mounted repositories belong to another uid, so git would refuse them
   * ("dubious ownership"). Marks only the repository being read (`cwd`) as safe, through
   * `GIT_CONFIG_COUNT/KEY/VALUE` (command scope, which git honours for `safe.directory`),
   * so no gitconfig is ever written. Entries already in the environment are kept.
   */
  safeDirectory: boolean;
}

/** The environment for one git call. Pure, so it is unit-tested. */
export function gitEnv(
  base: NodeJS.ProcessEnv,
  cwd: string,
  options: GitEnvOptions,
): NodeJS.ProcessEnv {
  // GIT_OPTIONAL_LOCKS=0: reading never writes, so a read-only mount works.
  const env: NodeJS.ProcessEnv = {
    ...base,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
  if (!options.safeDirectory) return env;
  const existing = /^\d+$/.test(base.GIT_CONFIG_COUNT ?? '') ? Number(base.GIT_CONFIG_COUNT) : 0;
  env[`GIT_CONFIG_KEY_${existing}`] = 'safe.directory';
  env[`GIT_CONFIG_VALUE_${existing}`] = cwd.replace(/\\/g, '/');
  env.GIT_CONFIG_COUNT = String(existing + 1);
  return env;
}

/** A runner over the real git binary. Arguments are passed as an array; nothing is interpolated. */
export function createExecGit(options: GitEnvOptions = { safeDirectory: false }): GitRunner {
  return (cwd, args) => runGit(cwd, args, gitEnv(process.env, cwd, options));
}

/** The host runner. */
export const execGit: GitRunner = createExecGit();

const runGit = (cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const err = error as NodeJS.ErrnoException & { killed?: boolean };
        if (err.code === 'ENOENT')
          return reject(new GitError('git is not installed', 'missing-binary'));
        if (err.killed) return reject(new GitError(`git ${args[0]} timed out`, 'timeout'));
        const detail = String(stderr).trim().split('\n')[0] || err.message;
        reject(new GitError(detail, 'failed'));
      },
    );
  });

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** True when `dir` has its own `.git` (folder, or file for worktrees and submodules). */
export function hasOwnGitDir(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

async function readBranch(run: GitRunner, dir: string): Promise<string | null> {
  const branch = (await run(dir, ['branch', '--show-current'])).trim();
  return branch === '' ? null : branch;
}

async function readCommits(run: GitRunner, dir: string, limit: number) {
  try {
    return parseGitLog(await run(dir, ['log', `-n${limit}`, `--format=${LOG_FORMAT}`]));
  } catch (err) {
    // A repository with no commits yet makes `git log` fail; that is not an error state.
    if (
      err instanceof GitError &&
      err.kind === 'failed' &&
      /does not have any commits|bad default revision/i.test(err.message)
    ) {
      return [];
    }
    throw err;
  }
}

/** One `git status` call gives both the change count and the upstream tracking. */
async function readStatus(
  run: GitRunner,
  dir: string,
): Promise<BranchTracking & { dirty: number }> {
  const output = await run(dir, [
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=normal',
  ]);
  return { dirty: countPorcelain(output), ...parseBranchTracking(output) };
}

/** Reads one repository. Non-repos and git failures come back as data, not exceptions. */
export async function readRepoState(
  run: GitRunner,
  absDir: string,
  relPath: string,
  limit: number = COMMIT_LIMIT,
): Promise<RepoState> {
  const empty: RepoState = {
    path: relPath,
    isRepo: false,
    branch: null,
    commits: [],
    dirty: null,
    ahead: null,
    upstream: null,
    error: null,
  };
  if (!hasOwnGitDir(absDir)) return empty;
  try {
    const [branch, commits, status] = await Promise.all([
      readBranch(run, absDir),
      readCommits(run, absDir, limit),
      readStatus(run, absDir),
    ]);
    return { path: relPath, isRepo: true, branch, commits, ...status, error: null };
  } catch (err) {
    return { ...empty, isRepo: true, error: messageOf(err) };
  }
}

/** Reads an app folder under `apps/`. */
export async function readAppRepo(run: GitRunner, absDir: string, name: string): Promise<AppRepo> {
  const state = await readRepoState(run, absDir, `apps/${name}`, 1);
  return {
    name,
    path: state.path,
    isRepo: state.isRepo,
    branch: state.branch,
    lastCommit: state.commits[0] ?? null,
    dirty: state.dirty,
    error: state.error,
  };
}
