/**
 * Builds one `Snapshot` from a workstation root. This is the only place where the parsers,
 * the IO adapters and the derivations meet; each of them stays independent.
 */
import { basename } from 'node:path';
import type { AgentDefinition, ArchiveRecord, Snapshot, SourceProblem } from '../../shared/types';
import { ACTIVITY_LIMIT, AGENT_RECENT_EVENTS, PATHS } from '../constants';
import { deriveLiveStates } from './activity';
import { newestFirst, recentEventsByAgent } from './activity-history';
import { derivePipeline, findMainSlug, joinAgents, nextExpiry } from './agents';
import { countWings, crossCheckCatalog, indexAuditLogs } from './archive';
import { runComplianceChecks } from './compliance';
import { readEventLog } from '../sources/event-log';
import { readAppRepo, readRepoState, type GitRunner } from '../sources/git';
import type { WorkstationFs } from '../sources/workstation-fs';
import { parseAgentDefinition } from '../sources/parse/definition';
import { auditSubject, parseRecord } from '../sources/parse/record';
import { parseCatalog, parseRoster, parseSoulBinder } from '../sources/parse/registers';

export interface SnapshotDeps {
  fs: WorkstationFs;
  git: GitRunner;
  now?: () => number;
}

async function readDefinitions(fs: WorkstationFs): Promise<AgentDefinition[]> {
  const files = (await fs.listMarkdown(PATHS.agentsDir)).filter(
    (file) => file.split('/').length === PATHS.agentsDir.split('/').length + 1,
  );
  const definitions = await Promise.all(
    files.map(async (file) => parseAgentDefinition(file, (await fs.readText(file)) ?? '')),
  );
  return definitions;
}

interface LoadedRecord {
  record: ArchiveRecord;
  text: string;
}

async function readRecords(fs: WorkstationFs): Promise<LoadedRecord[]> {
  const files = [
    ...(await fs.listMarkdown(PATHS.limforia)).filter((f) => f !== PATHS.catalog),
    ...(await fs.listMarkdown(PATHS.intel)),
  ];
  return Promise.all(
    files.map(async (path) => {
      const text = (await fs.readText(path)) ?? '';
      return { record: parseRecord(path, text), text };
    }),
  );
}

export async function buildSnapshot(deps: SnapshotDeps): Promise<Snapshot> {
  const { fs, git } = deps;
  const now = (deps.now ?? Date.now)();

  // The roster comes first: it names the main agent, whom main-agent events belong to.
  const roster = parseRoster(await fs.readText(PATHS.roster));
  const mainSlug = findMainSlug(roster.items);
  const [soulText, catalogText, eventLog, definitions, loaded, appNames] = await Promise.all([
    fs.readText(PATHS.soulBinder),
    fs.readText(PATHS.catalog),
    readEventLog(fs, mainSlug),
    readDefinitions(fs),
    readRecords(fs),
    fs.listDirs(PATHS.apps),
  ]);

  const soulBinder = parseSoulBinder(soulText);
  const catalog = parseCatalog(catalogText);

  const crossed = crossCheckCatalog(
    loaded.map((l) => l.record),
    catalog.items,
    (path) => fs.isFile(path),
  );
  const records = crossed.records;

  const audits = loaded
    .filter((l) => l.record.wing === 'audit-hall')
    .map((l) => ({ record: l.record, subject: auditSubject(l.text, l.record.header) }));
  const auditIndex = indexAuditLogs(audits);

  const live = deriveLiveStates(eventLog.events, now, mainSlug);
  const agents = joinAgents({
    roster: roster.items,
    definitions,
    retired: soulBinder.items,
    live,
    auditLogs: auditIndex.bySubject,
    recentEvents: recentEventsByAgent(eventLog.events, AGENT_RECENT_EVENTS),
  });

  const [workstation, apps] = await Promise.all([
    readRepoState(git, fs.root, '.'),
    Promise.all(
      appNames.map((name) => readAppRepo(git, fs.absolute(`${PATHS.apps}/${name}`), name)),
    ),
  ]);

  const compliance = runComplianceChecks({
    roster: roster.items,
    rosterFound: roster.found,
    definitions,
    retired: soulBinder.items,
    records,
    catalog: crossed.entries,
    catalogFound: catalog.found,
    strikeLogs: auditIndex.strikes,
    unattributedAudits: auditIndex.unattributed,
    workstationGit: workstation,
  });

  const problems: SourceProblem[] = [
    ...roster.problems,
    ...soulBinder.problems,
    ...catalog.problems,
    ...definitions.flatMap((d) => d.problems.map((message) => ({ source: d.file, message }))),
    ...records
      .filter((r) => !r.headerValid && !r.isTemplate)
      .map((r) => ({ source: r.path, message: r.headerProblems.join('; ') })),
  ];
  for (const file of eventLog.files) {
    if (file.skippedLines > 0) {
      problems.push({
        source: file.path,
        message: `${file.skippedLines} malformed line(s) skipped`,
      });
    }
  }

  const expiry = nextExpiry(live);
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    rootName: basename(fs.root),
    validUntil: expiry === null ? null : new Date(expiry).toISOString(),
    agents,
    retired: soulBinder.items,
    records,
    wings: countWings(records),
    catalog: { entries: crossed.entries, found: catalog.found },
    compliance,
    pipeline: derivePipeline(agents),
    git: { workstation },
    apps,
    activity: {
      events: newestFirst(eventLog.events, ACTIVITY_LIMIT),
      total: eventLog.events.length,
      skippedLines: eventLog.skippedLines,
    },
    problems,
  };
}
