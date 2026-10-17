/**
 * Attributes events to agents.
 *
 * - The hook logger writes `LOGGER_MAIN_AGENT` for a payload that names no agent. Such an
 *   event without an `agentId` is the main agent's: it gets the roster Overseer's slug.
 * - Some payloads (seen on `SubagentStop`) carry an `agent_id` but no `agent_type`. The logger
 *   writes those as `subagent`; older lines wrote them as `LOGGER_MAIN_AGENT`. Either way they
 *   must never count as the main agent. In log order:
 *   - an event with an `agentId` and a real agent name teaches that name for the id;
 *   - an event with an `agentId` but no real name takes the name learned so far for its id,
 *     else `UNATTRIBUTED_AGENT`.
 *
 * Learning only from earlier events keeps the result causal, so the snapshot (whole log) and
 * the live tail (new lines as they arrive) attribute every event the same way.
 */
import type { ActivityEvent } from '../../shared/types';
import { UNATTRIBUTED_AGENT } from '../../shared/types';
import { LOGGER_MAIN_AGENT } from '../constants';

export class AgentAttributor {
  private readonly names = new Map<string, string>();

  /** @param mainSlug the Overseer's slug now (read on every event, so it may change). */
  constructor(private readonly mainSlug: () => string = () => LOGGER_MAIN_AGENT) {}

  private isRealName(agent: string): boolean {
    return agent !== UNATTRIBUTED_AGENT && agent !== LOGGER_MAIN_AGENT && agent !== this.mainSlug();
  }

  attribute(event: ActivityEvent): ActivityEvent {
    const id = event.agentId;
    if (id === null) {
      const main = this.mainSlug();
      return event.agent === LOGGER_MAIN_AGENT && main !== LOGGER_MAIN_AGENT
        ? { ...event, agent: main }
        : event;
    }
    if (this.isRealName(event.agent)) {
      if (!this.names.has(id)) this.names.set(id, event.agent);
      return event;
    }
    const agent = this.names.get(id) ?? UNATTRIBUTED_AGENT;
    return agent === event.agent ? event : { ...event, agent };
  }
}

/** Attributes a whole log. `sorted` must be oldest first. */
export function attributeEvents(
  sorted: readonly ActivityEvent[],
  mainSlug: string = LOGGER_MAIN_AGENT,
): ActivityEvent[] {
  const attributor = new AgentAttributor(() => mainSlug);
  return sorted.map((event) => attributor.attribute(event));
}
