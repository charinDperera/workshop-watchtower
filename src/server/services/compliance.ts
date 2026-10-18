/**
 * The seven compliance checks of the Laws panel (SPEC section 3). Each check is a small
 * pure function over already-parsed data, so each can be tested on its own.
 */
import type {
  AgentDefinition,
  ArchiveRecord,
  CatalogEntry,
  CheckResult,
  ComplianceCheck,
  ComplianceSummary,
  RepoState,
  RetiredAgent,
  RosterEntry,
} from '../../shared/types';
import { findMainSlug, slugOf } from './agents';

export interface ComplianceInput {
  roster: RosterEntry[];
  rosterFound: boolean;
  definitions: AgentDefinition[];
  retired: RetiredAgent[];
  records: ArchiveRecord[];
  catalog: CatalogEntry[];
  catalogFound: boolean;
  /** Audit logs that count as strikes, keyed by agent slug. */
  /** Strike logs that still count per agent: those dated after its latest pardon. */
  strikeLogs: Map<string, string[]>;
  /** Each pardoned agent's latest pardon date (optional; for the messages). */
  pardonedAt?: Map<string, string>;
  /** Audit logs whose subject agent could not be determined. */
  unattributedAudits: string[];
  workstationGit: RepoState;
}

type CheckBody = Pick<ComplianceCheck, 'result' | 'details'>;

function verdict(fails: string[], warns: string[] = []): CheckBody {
  const result: CheckResult = fails.length > 0 ? 'fail' : warns.length > 0 ? 'warn' : 'pass';
  return { result, details: [...fails, ...warns] };
}

/** Check 1 (C2): definitions and roster entries match one to one, except the main agent. */
export function checkRosterDefinitions(input: ComplianceInput): CheckBody {
  if (!input.rosterFound) return verdict(['ROSTER.md was not found']);
  const mainSlug = findMainSlug(input.roster);
  const rosterSlugs = new Set(input.roster.map((r) => slugOf(r.name)));
  const definitionSlugs = new Set(input.definitions.map((d) => slugOf(d.name)));
  const fails: string[] = [];
  for (const definition of input.definitions) {
    if (!rosterSlugs.has(slugOf(definition.name))) {
      fails.push(`Definition ${definition.file} (${definition.name}) has no roster entry`);
    }
    for (const problem of definition.problems) fails.push(`${definition.file}: ${problem}`);
  }
  for (const entry of input.roster) {
    const slug = slugOf(entry.name);
    if (slug !== mainSlug && !definitionSlugs.has(slug)) {
      fails.push(`Roster entry ${entry.name} has no definition in .claude/agents/`);
    }
  }
  return verdict(fails);
}

function duplicates(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(slugOf(name), (counts.get(slugOf(name)) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([slug]) => slug);
}

/** Check 2 (C2): no duplicate active names; no active name is in the Soul Binder. */
export function checkUniqueNames(input: ComplianceInput): CheckBody {
  const fails: string[] = [];
  for (const slug of duplicates(input.roster.map((r) => r.name))) {
    fails.push(`"${slug}" appears more than once in the roster`);
  }
  for (const slug of duplicates(input.definitions.map((d) => d.name))) {
    fails.push(`"${slug}" is defined by more than one file in .claude/agents/`);
  }
  const bound = new Set(input.retired.map((r) => slugOf(r.name)));
  const active = new Set([
    ...input.roster.map((r) => slugOf(r.name)),
    ...input.definitions.map((d) => slugOf(d.name)),
  ]);
  for (const slug of active) {
    if (bound.has(slug)) fails.push(`"${slug}" is active but bound in the Soul Binder`);
  }
  return verdict(fails);
}

/** Check 3 (C5): every record in Limforia and intel/ has a valid header. Templates excluded. */
export function checkRecordHeaders(input: ComplianceInput): CheckBody {
  const fails = input.records
    .filter((r) => !r.isTemplate && !r.headerValid)
    .map((r) => `${r.path}: ${r.headerProblems.join('; ')}`);
  return verdict(fails);
}

/** Check 4 (C5): every Limforia record is in CATALOG.md and every catalog link resolves. */
export function checkCatalogCoverage(input: ComplianceInput): CheckBody {
  if (!input.catalogFound) return verdict(['limforia/CATALOG.md was not found']);
  const fails: string[] = [];
  const warns: string[] = [];
  for (const record of input.records) {
    if (record.path.startsWith('limforia/') && !record.isTemplate && !record.inCatalog) {
      fails.push(`${record.path} is not listed in CATALOG.md`);
    }
  }
  for (const entry of input.catalog) {
    if (entry.path === null)
      warns.push(`Link "${entry.href}" in ${entry.section} is not a local file`);
    else if (!entry.resolves)
      fails.push(`Link "${entry.href}" in ${entry.section} does not resolve`);
  }
  return verdict(fails, warns);
}

/** Check 5 (C4): roster strike counts equal the number of strike audit logs per agent. */
export function checkStrikeCounts(input: ComplianceInput): CheckBody {
  const fails: string[] = [];
  const rosterSlugs = new Set<string>();
  for (const entry of input.roster) {
    const slug = slugOf(entry.name);
    rosterSlugs.add(slug);
    const logged = input.strikeLogs.get(slug)?.length ?? 0;
    if (entry.strikes === null) {
      fails.push(`${entry.name}: strike count is unreadable`);
    } else if (entry.strikes !== logged) {
      const since = input.pardonedAt?.get(slug);
      const scope = since ? ` after the pardon of ${since}` : '';
      fails.push(`${entry.name}: roster says ${entry.strikes}, audit hall holds ${logged}${scope}`);
    }
  }
  for (const [slug, logs] of input.strikeLogs) {
    const retired = input.retired.some((r) => slugOf(r.name) === slug);
    if (!rosterSlugs.has(slug) && !retired) {
      fails.push(
        `Audit logs name "${slug}", who is neither on the roster nor in the Soul Binder: ${logs.join(', ')}`,
      );
    }
  }
  const warns = input.unattributedAudits.map(
    (path) => `${path}: cannot tell which agent it is about`,
  );
  return verdict(fails, warns);
}

/**
 * Check 6 (First Law): no agent at the strike limit is still on the roster. Counts the
 * strike logs that still count (after the agent's latest pardon), the same count as check 5.
 */
export function checkThreeStrikes(input: ComplianceInput): CheckBody {
  const fails = input.roster
    .map((entry) => ({ entry, count: input.strikeLogs.get(slugOf(entry.name))?.length ?? 0 }))
    .filter(({ entry, count }) => count >= entry.strikeLimit)
    .map(
      ({ entry, count }) =>
        `${entry.name} has ${count} / ${entry.strikeLimit} strikes and is still active`,
    );
  return verdict(fails);
}

/** Check 7 (C5, git): the workstation working tree is clean. Warn, never fail. */
export function checkCleanTree(input: ComplianceInput): CheckBody {
  const git = input.workstationGit;
  if (!git.isRepo) return verdict([], ['The workstation is not a git repository']);
  if (git.error !== null || git.dirty === null) {
    return verdict([], [`Git state unknown: ${git.error ?? 'no status'}`]);
  }
  if (git.dirty > 0) return verdict([], [`${git.dirty} uncommitted change(s)`]);
  return verdict([]);
}

const CHECKS: readonly {
  id: ComplianceCheck['id'];
  title: string;
  serves: string;
  run: (input: ComplianceInput) => CheckBody;
}[] = [
  {
    id: 'roster-definitions',
    title: 'Every definition has a roster entry, and every roster entry has a definition',
    serves: 'Commandment 2: The Naming',
    run: checkRosterDefinitions,
  },
  {
    id: 'unique-names',
    title: 'No duplicate names, and no active name is in the Soul Binder',
    serves: 'Commandment 2: The Naming',
    run: checkUniqueNames,
  },
  {
    id: 'record-headers',
    title: 'Every record in Limforia and intel/ has a valid header',
    serves: 'Commandment 5: The Great Archive Limforia',
    run: checkRecordHeaders,
  },
  {
    id: 'catalog-coverage',
    title: 'Every Limforia record is in CATALOG.md, and every catalog link resolves',
    serves: 'Commandment 5: The Great Archive Limforia',
    run: checkCatalogCoverage,
  },
  {
    id: 'strike-counts',
    title: 'Roster strike counts match the audit logs',
    serves: 'Commandment 4: The Reckoning',
    run: checkStrikeCounts,
  },
  {
    id: 'three-strikes',
    title: 'No agent at 3 strikes is still active',
    serves: 'The First Law: Judgment',
    run: checkThreeStrikes,
  },
  {
    id: 'clean-tree',
    title: 'The workstation working tree is clean',
    serves: 'Commandment 5: The Great Archive Limforia',
    run: checkCleanTree,
  },
];

export function runComplianceChecks(input: ComplianceInput): ComplianceSummary {
  const checks: ComplianceCheck[] = CHECKS.map((check, index) => {
    let body: CheckBody;
    try {
      body = check.run(input);
    } catch (err) {
      body = {
        result: 'fail',
        details: [`Check crashed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
    return { id: check.id, order: index + 1, title: check.title, serves: check.serves, ...body };
  });
  return {
    checks,
    pass: checks.filter((c) => c.result === 'pass').length,
    warn: checks.filter((c) => c.result === 'warn').length,
    fail: checks.filter((c) => c.result === 'fail').length,
  };
}
