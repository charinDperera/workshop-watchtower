<!--
  @component
  The newest page of the full timeline, live. Starts from the server's first page (which
  may reach further back than the snapshot holds) and adds streamed events that match the
  agent and event filters on top. Events older than the page's last one are left to the
  "Older" link, so paging never skips or repeats an event. Owner: Luka.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { ActivityEvent } from '../../shared/types';
  import { matchesActivity } from '../../ui/activity-page';
  import { agentRefs, parseTime, type AgentRef } from '../../ui/format';
  import { LIVE_ACTIVITY_CAP, mergeEvents } from '../../ui/live/logic';
  import { live, useClock, useLive } from '../../ui/live/store.svelte';
  import ActivityFeed from '../ActivityFeed.svelte';

  interface Props {
    /** The server's first page, newest first; null when it could not be read. */
    initial: ActivityEvent[] | null;
    agents: AgentRef[] | null;
    agent?: string | null;
    event?: string | null;
    /** Time of the page's oldest event when older pages exist; nothing older is shown. */
    floor?: string | null;
    now: number;
    error?: string | null;
    retryHref?: string | null;
    emptyTitle?: string;
    emptyMessage?: string;
  }
  let {
    initial,
    agents,
    agent = null,
    event = null,
    floor = null,
    now,
    error = null,
    retryHref = null,
    emptyTitle,
    emptyMessage,
  }: Props = $props();
  onMount(useLive);
  onMount(useClock);

  const floorMs = $derived(parseTime(floor));
  const events = $derived.by(() => {
    if (!initial && !live.snapshot) return null;
    const base = initial ?? [];
    const merged = mergeEvents(live.activity(base), base, base.length + LIVE_ACTIVITY_CAP);
    return merged.filter(
      (e) =>
        matchesActivity(e, { agent, event }) &&
        (floorMs === null || (parseTime(e.ts) ?? 0) >= floorMs),
    );
  });
</script>

<ActivityFeed
  {events}
  agents={live.snapshot ? agentRefs(live.snapshot.agents) : agents}
  {now}
  limit={events?.length ?? 0}
  showAgent={agent === null}
  {error}
  {retryHref}
  label="Activity timeline"
  {emptyTitle}
  {emptyMessage}
/>
