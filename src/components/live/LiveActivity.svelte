<!--
  @component
  Live activity feed: snapshot events merged with events streamed since. With `agent`, it
  shows that agent's own history (`Agent.recentEvents`, independent of the snapshot's
  global activity cap) merged with that agent's streamed events.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { ActivityEvent } from '../../shared/types';
  import { agentRefs, type AgentRef } from '../../ui/format';
  import { mergeEvents } from '../../ui/live/logic';
  import { live, useClock, useLive } from '../../ui/live/store.svelte';
  import ActivityFeed from '../ActivityFeed.svelte';

  interface Props {
    initial: { events: ActivityEvent[]; agents: AgentRef[] } | null;
    now: number;
    /** Only this agent's events (slug). */
    agent?: string | null;
    limit?: number;
    hideToolEnds?: boolean;
    error?: string | null;
    retryHref?: string | null;
    label?: string;
    emptyTitle?: string;
    emptyMessage?: string;
  }
  let {
    initial,
    now,
    agent = null,
    limit,
    hideToolEnds,
    error = null,
    retryHref = null,
    label,
    emptyTitle,
    emptyMessage,
  }: Props = $props();
  onMount(useLive);
  onMount(useClock);

  /** The agent's own history from the live snapshot, when it still lists the agent. */
  const own = $derived(
    agent ? (live.snapshot?.agents.find((a) => a.slug === agent)?.recentEvents ?? null) : null,
  );
  const events = $derived.by(() => {
    if (!initial && !live.snapshot) return null;
    if (!agent) return live.activity(initial?.events ?? []);
    const streamed = live.liveEvents.filter((e) => e.agent === agent);
    return mergeEvents(streamed, own ?? initial?.events ?? []);
  });
</script>

<ActivityFeed
  {events}
  agents={live.snapshot ? agentRefs(live.snapshot.agents) : (initial?.agents ?? null)}
  {now}
  {limit}
  {hideToolEnds}
  showAgent={agent === null}
  {error}
  {retryHref}
  {label}
  {emptyTitle}
  {emptyMessage}
/>
