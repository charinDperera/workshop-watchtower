<!--
  @component
  The live facts on an agent's page: status (honest: Active only when heard from in the last
  five minutes), what they are doing, how their last session ended, last seen and strikes.
  If the agent leaves the roster while the page is open, it says so and keeps the last
  known facts.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Agent } from '../../shared/types';
  import { liveness, silenceLabel } from '../../ui/council';
  import { toolLabel } from '../../ui/format';
  import { live, useClock, useLive } from '../../ui/live/store.svelte';
  import RelativeTime from '../RelativeTime.svelte';
  import StatusBadge from '../StatusBadge.svelte';
  import StrikeMeter from '../StrikeMeter.svelte';

  interface Props {
    initial: Agent;
    now: number;
  }
  let { initial, now }: Props = $props();
  onMount(useLive);
  onMount(useClock);

  const found = $derived(live.snapshot?.agents.find((a) => a.slug === initial.slug) ?? null);
  const gone = $derived(live.snapshot !== null && found === null);
  const agent = $derived(found ?? initial);
  const state = $derived(liveness(agent));
  const silence = $derived(silenceLabel(state));
  const OUTCOME = {
    completed: 'Ended cleanly',
    failed: 'Stopped by an error',
    abandoned: 'Went quiet',
  } as const;
</script>

<div class="space-y-4">
  {#if gone}
    <p class="rounded-md border border-warn/60 bg-warn-soft p-3 text-sm text-ink" role="status">
      {initial.name} is no longer in the live snapshot. These are the last known facts.
    </p>
  {/if}
  <dl class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
    <div class="panel p-4">
      <dt class="eyebrow">Status</dt>
      <dd class="mt-2 space-y-1">
        <StatusBadge status={agent.status} size="md" />
        {#if state.kind === 'active'}
          <p class="text-xs text-ink-muted">Heard from in the last five minutes</p>
        {:else if silence && 'at' in state}
          <p class="text-xs text-ink-muted">
            {silence}, <RelativeTime datetime={state.at} {now} class="figure" />
          </p>
        {/if}
      </dd>
    </div>
    <div class="panel p-4">
      <dt class="eyebrow">Doing now</dt>
      <dd class="mt-2 text-sm">
        {#if state.kind === 'active' && agent.currentTool}
          <code class="text-active" title={agent.currentTool}>{toolLabel(agent.currentTool)}</code>
        {:else if state.kind === 'active'}
          <span class="text-active">Thinking</span>
        {:else}
          <span class="text-ink-faint">Resting</span>
        {/if}
      </dd>
    </div>
    <div class="panel p-4">
      <dt class="eyebrow">Last session</dt>
      <dd class="mt-2 space-y-0.5 text-sm">
        {#if agent.lastEnd}
          <p class={agent.lastEnd.outcome === 'completed' ? 'text-ink' : 'text-ink-muted'}>
            {OUTCOME[agent.lastEnd.outcome]}
          </p>
          <RelativeTime datetime={agent.lastEnd.at} {now} class="figure text-xs text-ink-faint" />
        {:else}
          <span class="text-ink-faint">No ending recorded</span>
        {/if}
      </dd>
    </div>
    <div class="panel p-4">
      <dt class="eyebrow">Last seen</dt>
      <dd class="mt-2 text-sm">
        <RelativeTime datetime={agent.lastSeen} {now} fallback="Not seen yet" class="figure" />
      </dd>
    </div>
    <div class="panel col-span-2 p-4 lg:col-span-1">
      <dt class="eyebrow">Strikes</dt>
      <dd class="mt-2">
        <StrikeMeter strikes={agent.strikes} limit={agent.strikeLimit} size="md" />
      </dd>
    </div>
  </dl>
</div>
