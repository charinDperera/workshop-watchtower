import type { GitCommit } from '../../../shared/types';

/** Field and record separators used in the `git log --format` string. */
export const FIELD_SEP = '\x1f';
export const RECORD_SEP = '\x1e';
export const LOG_FORMAT = `%H${FIELD_SEP}%aI${FIELD_SEP}%an${FIELD_SEP}%s${RECORD_SEP}`;

/** Parses the output of `git log --format=LOG_FORMAT`. */
export function parseGitLog(output: string): GitCommit[] {
  return output
    .split(RECORD_SEP)
    .map((chunk) => chunk.replace(/^\r?\n/, ''))
    .filter((chunk) => chunk.trim() !== '')
    .flatMap((chunk): GitCommit[] => {
      const [hash, date, author, subject] = chunk.split(FIELD_SEP);
      if (!hash || !date || !/^[0-9a-f]{7,64}$/.test(hash)) return [];
      return [
        {
          hash,
          shortHash: hash.slice(0, 7),
          date,
          author: author ?? '',
          subject: (subject ?? '').trimEnd(),
        },
      ];
    });
}

/** Counts change entries in `git status --porcelain` output (v1, or v2 with `#` headers). */
export function countPorcelain(output: string): number {
  return output.split(/\r?\n/).filter((line) => line.trim() !== '' && !line.startsWith('#')).length;
}

export interface BranchTracking {
  /** e.g. `origin/main`; `null` when the branch has no upstream. */
  upstream: string | null;
  /** Commits not on the upstream; `null` without an upstream, or when it is gone. */
  ahead: number | null;
}

/**
 * Reads the `# branch.upstream` and `# branch.ab +A -B` headers of
 * `git status --porcelain=v2 --branch`. Git omits `branch.ab` when the upstream is gone.
 */
export function parseBranchTracking(output: string): BranchTracking {
  let upstream: string | null = null;
  let ahead: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    const up = /^# branch\.upstream (\S+)$/.exec(line);
    if (up) upstream = up[1] ?? null;
    const ab = /^# branch\.ab \+(\d+) -\d+$/.exec(line);
    if (ab) ahead = Number(ab[1]);
  }
  return { upstream, ahead: upstream === null ? null : ahead };
}
