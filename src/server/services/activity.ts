/**
 * Derives each agent's live state from the (attributed) hook event log. Pure: events and
 * "now" in. Nothing here names an agent: the main agent's slug is passed in.
 *
 * A run is one subagent instance (keyed by `agentId`, or by slug for legacy lines without
 * one) or one main-agent turn (keyed by session).
 * - Opened by `SubagentStart`, or `UserPromptSubmit` for the main agent. `SessionStart` alone
 *   opens nothing (an idle open session is not work).
 * - Closed by `SubagentStop` (completed), or `Stop` (completed) / `StopFailure` (failed): with
 *   an `agentId` these close that subagent, without one the main agent's turn.
 * - `SessionEnd` abandons every run still open in that session.
 * - An agent is `active` only while one of its runs is open AND that run was heard from within
 *   `ACTIVE_SILENCE_MS`. A run open but silent past the window is abandoned (for example a
 *   session killed by a usage limit), as of its last event.
 * - A tool is running from `PreToolUse` until `PostToolUse` or `PostToolUseFailure` with the
 *   same `toolUseId` (or, without ids, until the agent's next end of a tool of that name).
 */
import type { ActiveReason, ActivityEvent, AgentEnd, EndOutcome } from '../../shared/types';
import { ACTIVE_SILENCE_MS, LOGGER_MAIN_AGENT } from '../constants';

export interface LiveState {
  active: boolean;
  reason: ActiveReason;
  currentTool: string | null;
  lastSeen: string | null;
  lastEnd: AgentEnd | null;
  /** When the agent stops being active on its own (its runs fall silent), if active. */
  expiresAt: number | null;
}

interface OpenRun {
  agent: string;
  session: string | null;
  /** Last event of this run (epoch ms and as written). */
  lastMs: number;
  lastText: string;
}

interface RunningTool {
  tool: string | null;
  ts: number;
  session: string | null;
}

export function isToolStart(event: string): boolean {
  return event === 'PreToolUse';
}

/** `PostToolUse` and `PostToolUseFailure` both end a tool. */
export function isToolEnd(event: string): boolean {
  return event === 'PostToolUse' || event === 'PostToolUseFailure';
}

/** The run an event belongs to. */
export function runKey(event: ActivityEvent, mainSlug: string): string {
  if (event.agentId) return `id:${event.agentId}`;
  if (event.agent === mainSlug) return `main:${event.session ?? ''}`;
  return `agent:${event.agent}`;
}

/** Per-agent running tools, keyed by tool use id (or a per-agent placeholder without ids). */
class ToolTracker {
  private readonly running = new Map<string, Map<string, RunningTool>>();

  record(event: ActivityEvent, ts: number): void {
    const tools = this.running.get(event.agent) ?? new Map<string, RunningTool>();
    this.running.set(event.agent, tools);
    if (isToolStart(event.event)) {
      tools.set(event.toolUseId ?? `anon:${ts}:${tools.size}`, {
        tool: event.tool,
        ts,
        session: event.session,
      });
    } else if (event.toolUseId && tools.has(event.toolUseId)) {
      tools.delete(event.toolUseId);
    } else {
      // No id to match: the end belongs to the oldest running tool of the same name, if any.
      const match = [...tools.entries()].find(([, t]) => t.tool === event.tool);
      if (match) tools.delete(match[0]);
    }
  }

  endSession(session: string | null): void {
    for (const tools of this.running.values()) {
      for (const [key, tool] of tools) if (tool.session === session) tools.delete(key);
    }
  }

  /** The most recently started tool that is still running and not silent. */
  current(agent: string, now: number): string | null {
    const tools = [...(this.running.get(agent)?.values() ?? [])]
      .filter((t) => now - t.ts <= ACTIVE_SILENCE_MS)
      .sort((a, b) => b.ts - a.ts);
    return tools[0]?.tool ?? null;
  }
}

/** The ends of runs, latest per agent. */
class EndBook {
  private readonly ends = new Map<string, { ms: number; end: AgentEnd }>();

  note(agent: string, ms: number, at: string, outcome: EndOutcome): void {
    const previous = this.ends.get(agent);
    if (!previous || ms >= previous.ms) this.ends.set(agent, { ms, end: { at, outcome } });
  }

  get(agent: string): AgentEnd | null {
    return this.ends.get(agent)?.end ?? null;
  }
}

export function deriveLiveStates(
  events: ActivityEvent[],
  now: number,
  mainSlug: string = LOGGER_MAIN_AGENT,
): Map<string, LiveState> {
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const open = new Map<string, OpenRun>();
  const lastSeen = new Map<string, { ms: number; text: string }>();
  const tools = new ToolTracker();
  const ends = new EndBook();

  const close = (key: string, agent: string, ms: number, at: string, outcome: EndOutcome) => {
    const run = open.get(key);
    open.delete(key);
    ends.note(run?.agent ?? agent, ms, at, outcome);
  };

  for (const event of sorted) {
    const ms = Date.parse(event.ts);
    lastSeen.set(event.agent, { ms, text: event.ts });
    const key = runKey(event, mainSlug);
    const run = open.get(key);
    if (run) {
      run.lastMs = ms;
      run.lastText = event.ts;
    }
    const isMain = event.agent === mainSlug && !event.agentId;
    const start = (): void => {
      open.set(key, { agent: event.agent, session: event.session, lastMs: ms, lastText: event.ts });
    };

    if (isToolStart(event.event) || isToolEnd(event.event)) {
      tools.record(event, ms);
      continue;
    }
    switch (event.event) {
      case 'SubagentStart':
        if (!isMain) start();
        break;
      case 'UserPromptSubmit':
        if (isMain) start();
        break;
      case 'SubagentStop':
        if (!isMain) close(key, event.agent, ms, event.ts, 'completed');
        break;
      case 'Stop':
        close(key, event.agent, ms, event.ts, 'completed');
        break;
      case 'StopFailure':
        close(key, event.agent, ms, event.ts, 'failed');
        break;
      case 'SessionEnd':
        for (const [k, r] of open) {
          if (r.session === event.session) close(k, r.agent, ms, event.ts, 'abandoned');
        }
        tools.endSession(event.session);
        break;
      default:
        break;
    }
  }

  // Which agents are active, until when; which open runs are abandoned by silence.
  const activeUntil = new Map<string, number>();
  const silent: OpenRun[] = [];
  for (const run of open.values()) {
    if (now - run.lastMs <= ACTIVE_SILENCE_MS) {
      const until = run.lastMs + ACTIVE_SILENCE_MS;
      activeUntil.set(run.agent, Math.max(activeUntil.get(run.agent) ?? 0, until));
    } else {
      silent.push(run);
    }
  }
  for (const run of silent) {
    if (!activeUntil.has(run.agent)) ends.note(run.agent, run.lastMs, run.lastText, 'abandoned');
  }

  const states = new Map<string, LiveState>();
  for (const [agent, seen] of lastSeen) {
    const until = activeUntil.get(agent);
    const active = until !== undefined;
    states.set(agent, {
      active,
      reason: active ? 'open-session' : null,
      currentTool: active ? tools.current(agent, now) : null,
      lastSeen: seen.text,
      lastEnd: ends.get(agent),
      expiresAt: active ? until : null,
    });
  }
  return states;
}
