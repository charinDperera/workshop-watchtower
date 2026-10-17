<!--
  @component
  An agent's liveness in words, honestly: Active (heard from in the last five minutes, with
  the tool in hand), Idle (with when last seen), or, for a silent agent whose last session
  ended badly, "Fell silent: stopped by an error" or "Went quiet", with when.
  The words carry the meaning; the dot only echoes them.
-->
<script lang="ts">
  import type { Agent } from '../shared/types';
  import { liveness, silenceLabel } from '../ui/council';
  import { toolLabel } from '../ui/format';
  import RelativeTime from './RelativeTime.svelte';

  interface Props {
    agent: Pick<Agent, 'status' | 'lastEnd' | 'lastSeen' | 'currentTool'>;
    now: number;
    /** `center` for the tree, `start` for lists and the agent page. */
    align?: 'center' | 'start';
    size?: 'xs' | 'sm';
  }
  let { agent, now, align = 'center', size = 'xs' }: Props = $props();

  const state = $derived(liveness(agent));
  const silence = $derived(silenceLabel(state));
</script>

<p
  class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 {align === 'center'
    ? 'justify-center text-center'
    : ''} {size === 'sm' ? 'text-sm' : 'text-xs'}"
>
  {#if state.kind === 'active'}
    <span class="relative inline-flex size-2" aria-hidden="true">
      <span class="absolute inset-0 animate-pulse-ring rounded-full bg-active"></span>
      <span class="relative size-2 rounded-full bg-active"></span>
    </span>
    <span class="font-bold text-active">Active</span>
    {#if agent.currentTool}
      <span class="text-ink-faint" aria-hidden="true">·</span>
      <code class="min-w-0 truncate text-active" title={agent.currentTool}
        >{toolLabel(agent.currentTool)}</code
      >
    {/if}
  {:else if state.kind === 'retired'}
    <span class="size-2 rounded-full border border-retired" aria-hidden="true"></span>
    <span class="text-retired">Retired</span>
  {:else if silence && 'at' in state}
    <span class="size-2 rotate-45 border border-ink-faint" aria-hidden="true"></span>
    <span class="text-ink-muted">{silence}</span>
    <RelativeTime datetime={state.at} {now} class="figure text-ink-faint" />
  {:else}
    <span class="size-2 rounded-full bg-ink-faint" aria-hidden="true"></span>
    <span class="text-ink-muted">Idle</span>
    {#if agent.lastSeen}
      <span class="whitespace-nowrap text-ink-faint"
        ><span aria-hidden="true" class="mr-1">·</span>seen <RelativeTime
          datetime={agent.lastSeen}
          {now}
          class="figure"
        /></span
      >
    {/if}
  {/if}
</p>
