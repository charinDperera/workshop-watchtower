/**
 * The Watchtower data contract.
 *
 * `Snapshot` is the single typed document served by `GET /api/snapshot` and pushed as the
 * `snapshot` SSE event. `ActivityEvent` is pushed as the `activity` SSE event.
 * Every timestamp is an ISO 8601 string (UTC). Every path is workstation-relative and uses `/`.
 */

import type { RECORD_STATUSES, RECORD_TYPES } from './constants';

/* ------------------------------------------------------------------ */
/* Shared                                                             */
/* ------------------------------------------------------------------ */

/** A non-fatal problem found while reading a source. Reported, never thrown (SPEC section 2). */
export interface SourceProblem {
  /** Workstation-relative path of the source, e.g. `ROSTER.md`. */
  source: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Activity (hook events)                                             */
/* ------------------------------------------------------------------ */

/** Hook event names the logger may write. Unknown names are kept as plain strings. */
export type KnownHookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Stop'
  | 'StopFailure'
  | 'SessionEnd';

/** The hook events registered in the workstation's `.claude/settings.json`, in lifecycle order. */
export const HOOK_EVENTS: readonly KnownHookEvent[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'SessionEnd',
];

/**
 * The `agent` of a subagent event that names no agent type and whose `agentId` was never seen
 * with one (for example an internal subagent's `SubagentStop`). Never counted as the main
 * agent; the UI can label it "Unnamed subagent".
 */
export const UNATTRIBUTED_AGENT = 'subagent';

/** One line of `.watchtower/events.jsonl`. Only names, ids and timestamps (SPEC section 4). */
export interface ActivityEvent {
  ts: string;
  /** Hook event name, usually a `KnownHookEvent`. */
  event: string;
  session: string | null;
  /**
   * Lower-case agent slug: the subagent type, the Overseer's slug for the main agent, or
   * `UNATTRIBUTED_AGENT` (`subagent`) for a subagent event whose type could not be resolved.
   */
  agent: string;
  /** Subagent instance id, when the hook payload has one. */
  agentId: string | null;
  /** Tool name for tool events. */
  tool: string | null;
  /** Pairs a PreToolUse with its PostToolUse or PostToolUseFailure. */
  toolUseId: string | null;
  /** SessionStart only: `startup`, `resume`, `clear`, `compact`, `fork`. */
  source: string | null;
  /** SessionEnd only: `clear`, `resume`, `logout`, `prompt_input_exit`, `other`. */
  reason: string | null;
  /** MCP server name, for MCP tool events. */
  mcpServer: string | null;
}

export interface ActivitySummary {
  /** Newest first, capped at `ACTIVITY_LIMIT`. */
  events: ActivityEvent[];
  /** Number of valid events in the log. */
  total: number;
  /** Lines that were not valid events and were skipped. */
  skippedLines: number;
}

/**
 * One page of `GET /api/activity`, newest first. Query: `agent` (slug), `event` (a
 * `HOOK_EVENTS` name, repeatable), `before` (ISO timestamp, exclusive), `limit` (1-500,
 * default 100). Covers the whole log: the current file and the rotated one.
 */
export interface ActivityPage {
  events: ActivityEvent[];
  /**
   * Pass as `before` to get the next (older) page; `null` when there is none. Events that
   * share the boundary timestamp are never split across pages.
   */
  nextBefore: string | null;
  /** Events matching `agent` and `event` over the whole log (`before` is not applied). */
  total: number;
}

/* ------------------------------------------------------------------ */
/* Agents                                                             */
/* ------------------------------------------------------------------ */

/**
 * Place in The Council's hierarchy, from the roster's Rank column: the `overseer` leads and
 * oversees all, `counsel` advises from outside the Order of Work, `worker` serves on it.
 */
export type AgentRank = 'overseer' | 'counsel' | 'worker';

/** A row of the table in `ROSTER.md`. */
export interface RosterEntry {
  name: string;
  /** The agent's epithet; `null` when empty or `—`. */
  title: string | null;
  /**
   * Case-insensitive Rank cell. Missing or unknown -> `worker` (unknown also reports a
   * problem). A legacy roster with no Rank column infers `overseer` from a role starting
   * "Main agent".
   */
  rank: AgentRank;
  /** Station cell as written (e.g. `Build`); `null` when empty or `—`. */
  station: string | null;
  role: string;
  /** Raw "Tools" cell. */
  tools: string;
  /** Raw "Created" cell, normally `YYYY-MM-DD`. */
  created: string;
  /** Parsed from `n / 3`. `null` when the cell cannot be parsed. */
  strikes: number | null;
  strikeLimit: number;
}

/** Frontmatter of `.claude/agents/<file>.md`. */
export interface AgentDefinition {
  /** Workstation-relative path. */
  file: string;
  /** `name` key, or the file name without extension when missing. */
  name: string;
  description: string | null;
  tools: string[];
  skills: string[];
  model: string | null;
  /** Problems found in the frontmatter (empty when valid). */
  problems: string[];
}

/** A row of the table in `SOUL-BINDER.md`. */
export interface RetiredAgent {
  name: string;
  role: string;
  served: string;
  cause: string;
  /** Raw "Audit log" cell. */
  auditLog: string;
  /** Workstation-relative path of the audit log, when the cell holds a link. */
  auditLogPath: string | null;
}

export type AgentStatus = 'active' | 'idle' | 'retired';

/**
 * Why an agent counts as active. Only `open-session` is produced: an agent is active only
 * while its session is open and it was heard from within `ACTIVE_SILENCE_MS`.
 * `recent-tool` is kept for compatibility and is no longer produced.
 */
export type ActiveReason = 'open-session' | 'recent-tool' | null;

/** How an agent's last run ended. */
export type EndOutcome = 'completed' | 'failed' | 'abandoned';

export interface AgentEnd {
  /**
   * When it ended: the closing event's time; for a run still open but silent, its last
   * event's time (when it was last heard from).
   */
  at: string;
  /**
   * `completed`: SubagentStop, or Stop. `failed`: StopFailure. `abandoned`: still open but
   * silent past `ACTIVE_SILENCE_MS`, or closed by SessionEnd.
   */
  outcome: EndOutcome;
}

/** An agent of the host: the roster joined with its definition and live activity. */
export interface Agent {
  /** Display name, as on the roster. */
  name: string;
  /** Lower-case id used in URLs (`/host/[slug]`) and in hook events. */
  slug: string;
  /** Epithet from the roster; `null` when empty, `—`, or not on the roster. */
  title: string | null;
  /** From the roster; an agent with a definition but no roster row is a `worker`. */
  rank: AgentRank;
  /** Station from the roster as written (e.g. `Build`); `null` for `—` or no roster row. */
  station: string | null;
  role: string | null;
  /** `rank === 'overseer'`: the main agent, who has no definition file by design. */
  isMain: boolean;
  inRoster: boolean;
  /** Raw "Tools" cell of the roster. */
  rosterTools: string | null;
  created: string | null;
  strikes: number | null;
  strikeLimit: number;
  definition: AgentDefinition | null;
  status: AgentStatus;
  activeReason: ActiveReason;
  /** Tool in use right now (a PreToolUse without its PostToolUse), only while active. */
  currentTool: string | null;
  /** Timestamp of the latest event for this agent. */
  lastSeen: string | null;
  /** How the agent's last run ended; `null` when it has never ended (or never ran). */
  lastEnd: AgentEnd | null;
  /** Id of the pipeline stage of a worker's station; `null` for overseer, counsel or none. */
  stage: PipelineStageId | null;
  /** Paths of audit-hall records about this agent. */
  auditLogs: string[];
  /**
   * This agent's newest events (at most `AGENT_RECENT_EVENTS`, 25), newest first, from the
   * whole log (current and rotated file), independent of the snapshot's activity cap.
   */
  recentEvents: ActivityEvent[];
}

/* ------------------------------------------------------------------ */
/* Archive                                                            */
/* ------------------------------------------------------------------ */

/** A record type of the Constitution's header (see `RECORD_TYPES`). */
export type RecordType = (typeof RECORD_TYPES)[number];

/** A record status of the Constitution's header (see `RECORD_STATUSES`). */
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/**
 * A wing: the name of a `limforia/` subfolder (discovered, so a new wing needs no app
 * change; `logs/` is not a wing), `intel` for Uriel's reports, or `other` for a record
 * directly in `limforia/`.
 */
export type WingId = string;

/** The YAML header of a record. Fields are `null` or empty when missing or invalid. */
export interface RecordHeader {
  type: string | null;
  date: string | null;
  agents: string[];
  tags: string[];
  status: string | null;
  /** Any other keys, e.g. `outcome` on audit logs. Values are YAML scalars, lists or maps. */
  extra: Record<string, unknown>;
}

/** One `.md` file in `limforia/` or `intel/`. */
export interface ArchiveRecord {
  path: string;
  wing: WingId;
  /** The subfolder inside the wing, e.g. `decisions` in `scriptorium/decisions/`. */
  subWing: string | null;
  /** Text of the first `# ` heading, or the file name when there is none. */
  title: string;
  header: RecordHeader;
  hasHeader: boolean;
  /** True when the header has every required key with a valid value. */
  headerValid: boolean;
  headerProblems: string[];
  /** Templates are not records: they are excluded from the compliance checks. */
  isTemplate: boolean;
  /** Present in `CATALOG.md` (always false for intel and templates). */
  inCatalog: boolean;
  /**
   * Changes whenever the file's text changes (a short content hash), so an edit to the body
   * alone still changes the snapshot and the live record viewer refetches.
   */
  revision: string;
}

export interface WingSummary {
  id: WingId;
  /** Display name from the folder, e.g. `Vault of Ideas` (see `wingTitle`). */
  title: string;
  /**
   * What the wing holds, from the folder tables in CLAUDE.md (the Limforia wing table, or
   * the Realms table for `intel`); the folder name when it is not described there.
   */
  description: string;
  /** Number of records (templates count only in the `templates` wing). */
  count: number;
  /** Per sub-wing counts, e.g. `{ decisions: 1 }`. */
  subWings: Record<string, number>;
}

/** A linked entry in `CATALOG.md`. */
export interface CatalogEntry {
  /** The `## ` section heading, e.g. `Chronicles`. */
  section: string;
  /** The "Date" cell, when present. */
  date: string | null;
  /** Link text. */
  label: string;
  /** Link target as written (relative to `limforia/`). */
  href: string;
  /** Workstation-relative target, or `null` for external or unsafe links. */
  path: string | null;
  /** True when `path` exists on disk. */
  resolves: boolean;
  /** All cells of the row, keyed by column header. */
  cells: Record<string, string>;
}

export interface CatalogSummary {
  entries: CatalogEntry[];
  found: boolean;
}

/* ------------------------------------------------------------------ */
/* Compliance                                                         */
/* ------------------------------------------------------------------ */

export type CheckResult = 'pass' | 'warn' | 'fail';

export type ComplianceCheckId =
  | 'roster-definitions'
  | 'unique-names'
  | 'record-headers'
  | 'catalog-coverage'
  | 'strike-counts'
  | 'three-strikes'
  | 'clean-tree';

export interface ComplianceCheck {
  id: ComplianceCheckId;
  /** 1 to 7, the order in SPEC section 3. */
  order: number;
  title: string;
  /** The law it serves, e.g. `Commandment 2: The Naming` or `The First Law`. */
  serves: string;
  result: CheckResult;
  /** One line per finding. Empty on a clean pass. */
  details: string[];
}

export interface ComplianceSummary {
  checks: ComplianceCheck[];
  pass: number;
  warn: number;
  fail: number;
}

/* ------------------------------------------------------------------ */
/* Order of Work                                                      */
/* ------------------------------------------------------------------ */

/**
 * A pipeline stage id: the slug of a worker station from the roster (lower-cased, trimmed,
 * runs of other characters as `-`; e.g. `Build` -> `build`, `Data Ops` -> `data-ops`).
 */
export type PipelineStageId = string;

/**
 * One stage of the Order of Work. The stages are the distinct Station values of the roster's
 * worker rows, in the order they first appear in ROSTER.md.
 */
export interface PipelineStage {
  id: PipelineStageId;
  /** The station as first written in the roster, e.g. `Build`. */
  title: string;
  /** Agent slugs in this stage. */
  agents: string[];
  /** True when one of its agents is active. */
  lit: boolean;
  /** Slugs of its agents that are active right now. */
  activeAgents: string[];
}

/* ------------------------------------------------------------------ */
/* Git                                                                */
/* ------------------------------------------------------------------ */

export interface GitCommit {
  hash: string;
  shortHash: string;
  /** Author date, ISO 8601 with offset. */
  date: string;
  author: string;
  subject: string;
}

export interface RepoState {
  /** Workstation-relative path of the repository (`.` for the workstation). */
  path: string;
  isRepo: boolean;
  /** `null` when detached or not a repo. */
  branch: string | null;
  /** Newest first. Empty for a repo with no commits. */
  commits: GitCommit[];
  /** Number of uncommitted changes (porcelain entries). `null` if unknown. */
  dirty: number | null;
  /** Commits on the branch not on its upstream. `null` without an upstream or when unknown. */
  ahead: number | null;
  /** Upstream branch, e.g. `origin/main`. `null` when none is configured. */
  upstream: string | null;
  /** Set when git could not be read (missing binary, timeout, corrupt repo). */
  error: string | null;
}

/** One folder under `apps/`. */
export interface AppRepo {
  name: string;
  path: string;
  isRepo: boolean;
  branch: string | null;
  lastCommit: GitCommit | null;
  dirty: number | null;
  error: string | null;
}

export interface GitSummary {
  /** The workstation repository with its last 50 commits. */
  workstation: RepoState;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                           */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  /** Contract version. Bumped on breaking changes. */
  version: 1;
  generatedAt: string;
  /** Base name of the workstation root, e.g. `Projects`. */
  rootName: string;
  /**
   * When the derived agent status will change on its own (a `recent-tool` activity
   * expiring), or `null`. The server re-sends the snapshot at that time.
   */
  validUntil: string | null;
  /**
   * Agents in roster order, then definitions without a roster entry. An agent still listed
   * here whose name is in the Soul Binder has status `retired` (and fails check 2).
   * The properly retired live in `retired`.
   */
  agents: Agent[];
  retired: RetiredAgent[];
  records: ArchiveRecord[];
  wings: WingSummary[];
  catalog: CatalogSummary;
  compliance: ComplianceSummary;
  pipeline: PipelineStage[];
  git: GitSummary;
  apps: AppRepo[];
  activity: ActivitySummary;
  /** Parse problems across every source. */
  problems: SourceProblem[];
}

/** The rendered record returned by `GET /api/record`. */
export interface RenderedRecord {
  path: string;
  title: string;
  /** Present when the file starts with a YAML header. */
  header: RecordHeader | null;
  /** Safe HTML: raw HTML in the source is escaped, unsafe link schemes are dropped. */
  html: string;
}

/** Body of every 4xx/5xx JSON response. */
export interface ApiError {
  error: string;
  status: number;
}
