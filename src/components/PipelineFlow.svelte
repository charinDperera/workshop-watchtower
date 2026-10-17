<!--
  @component
  The Order of Work, built from the stages in the snapshot (the stations of the roster, in
  order). A stage is lit (gold) while one of its agents is active. The stages flow in a
  grid that fits as many per row as the width allows, numbered so the order survives any
  wrap; an ordered list with the state in words.
-->
<script lang="ts">
  import type { PipelineStage } from '../shared/types';
  import { numeral } from '../ui/council';
  import type { AgentRef } from '../ui/format';
  import { agentHref } from '../ui/labels';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import LoadingState from './LoadingState.svelte';
  import Sigil from './Sigil.svelte';

  interface Props {
    stages: PipelineStage[] | null;
    agents: AgentRef[] | null;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
  }
  let { stages, agents, loading = false, error = null, retryHref = null }: Props = $props();

  const bySlug = $derived(new Map((agents ?? []).map((a) => [a.slug, a])));
  const nameOf = (slug: string) => bySlug.get(slug)?.name ?? slug;
</script>

{#if error && !stages}
  <ErrorState title="The Order of Work could not be read" message={error} {retryHref} />
{:else if loading || !stages}
  <LoadingState label="Loading the Order of Work" rows={2} />
{:else if stages.length === 0}
  <EmptyState
    title="No stations"
    message="No worker in ROSTER.md has a station, so the Order of Work is empty."
    compact
  />
{:else}
  <ol class="pipeline grid gap-3">
    {#each stages as stage, i (stage.id)}
      <li
        class="flex flex-col gap-3 rounded-md border p-3 transition-[border-color,box-shadow,background-color] duration-(--duration-slow) ease-(--ease-standard) {stage.lit
          ? 'border-gold bg-gold-soft shadow-glow-gold'
          : 'border-line bg-surface-2'}"
      >
        <div class="flex flex-col gap-0.5">
          <p class="flex items-baseline gap-2">
            <span class="text-sm font-bold text-gold" aria-hidden="true">{numeral(i + 1)}</span>
            <span class="text-md font-bold text-ink">{stage.title}</span>
          </p>
          <span
            class="text-xs font-bold tracking-wide uppercase {stage.lit
              ? 'text-gold'
              : 'text-ink-faint'}">{stage.lit ? 'In progress' : 'Quiet'}</span
          >
        </div>
        {#if stage.agents.length === 0}
          <p class="text-xs text-ink-faint">No agents</p>
        {:else}
          <ul class="flex flex-col gap-1.5">
            {#each stage.agents as slug, k (`${slug}-${k}`)}
              {@const isActive = stage.activeAgents.includes(slug)}
              <li class="flex min-w-0 items-center gap-1.5">
                <Sigil
                  name={nameOf(slug)}
                  status={isActive ? 'active' : (bySlug.get(slug)?.status ?? 'idle')}
                  class="size-6"
                />
                <a
                  href={agentHref(slug)}
                  class="link-standalone truncate text-sm {isActive
                    ? 'font-bold text-active'
                    : 'text-ink-muted hover:text-ink'}">{nameOf(slug)}</a
                >
                {#if isActive}<span class="sr-only">(active)</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  /* As many stages per row as fit at a readable width, then wrap; numerals keep the order. */
  .pipeline {
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--spacing) * 26), 1fr));
  }
</style>
