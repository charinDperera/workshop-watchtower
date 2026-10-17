<!--
  @component
  One member of The Council in the tree: the sigil (with its rank ornament and live halo),
  the name as a link to the agent's page, the title as a gold epithet, a one-line role, the
  liveness in words and the strikes as quiet pips. The whole figure is the link's target.
-->
<script lang="ts">
  import type { Agent } from '../shared/types';
  import { agentLines } from '../ui/council';
  import { agentHref } from '../ui/labels';
  import HaloSigil from './HaloSigil.svelte';
  import LivenessLine from './LivenessLine.svelte';
  import StrikeMeter from './StrikeMeter.svelte';

  interface Props {
    agent: Agent;
    now: number;
  }
  let { agent, now }: Props = $props();

  const lines = $derived(agentLines(agent));
  const overseer = $derived(agent.rank === 'overseer');
</script>

<div
  class="group relative flex flex-col items-center gap-1 rounded-lg px-1 pb-2 text-center"
  data-agent={agent.slug}
>
  <HaloSigil name={agent.name} status={agent.status} rank={agent.rank} />
  <p
    class="mt-1 leading-tight {overseer
      ? 'text-2xl font-black sm:text-3xl'
      : 'text-lg font-black'} text-ink"
  >
    <a
      href={agentHref(agent.slug)}
      class="stretched-link link-standalone text-ink group-hover:text-gold-strong">{agent.name}</a
    >
  </p>
  {#if lines.epithet}
    <p class="epithet {overseer ? 'text-sm' : ''}">{lines.epithet}</p>
  {/if}
  {#if lines.summary}
    <p class="line-clamp-2 max-w-prose text-sm text-ink-muted">{lines.summary}</p>
  {/if}
  {#if !agent.inRoster}
    <p class="text-xs text-warn">Not in the roster</p>
  {/if}
  <div class="mt-1 flex flex-col items-center gap-1.5">
    <LivenessLine {agent} {now} />
    <StrikeMeter strikes={agent.strikes} limit={agent.strikeLimit} showCount={false} />
  </div>
</div>
