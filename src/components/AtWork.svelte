<!--
  @component
  At work: the agents of The Council active now (sigil with its live halo, name, epithet,
  the tool in hand), then the most recently active others (when last seen, and how their
  last session ended), up to `limit` cards in all. When nobody is active, The Council rests
  and the most recent are shown; when nobody has ever been seen, an empty state.
  Selection is pure and data-driven (src/ui/at-work.ts). Each group has a heading and a list;
  every name links to the agent's page.
-->
<script lang="ts">
  import type { Agent } from '../shared/types';
  import { AT_WORK_LIMIT, atWork, END_LABEL } from '../ui/at-work';
  import { agentLines } from '../ui/council';
  import { plural, toolLabel } from '../ui/format';
  import { agentHref } from '../ui/labels';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import HaloSigil from './HaloSigil.svelte';
  import LoadingState from './LoadingState.svelte';
  import RelativeTime from './RelativeTime.svelte';

  interface Props {
    agents: Agent[] | null;
    now: number;
    limit?: number;
    /** Heading level of the two groups. */
    level?: 2 | 3;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
  }
  let {
    agents,
    now,
    limit = AT_WORK_LIMIT,
    level = 3,
    loading = false,
    error = null,
    retryHref = null,
  }: Props = $props();

  const uid = $props.id();
  const pick = $derived(agents ? atWork(agents, limit) : null);
  const tag = $derived(`h${level}`);
</script>

{#snippet card(agent: Agent, isActive: boolean)}
  {@const lines = agentLines(agent)}
  <li
    class="group relative flex items-center gap-4 rounded-lg border p-3 transition-[border-color,background-color] duration-(--duration-slow) ease-(--ease-standard) sm:p-4 lg:flex-col lg:text-center {isActive
      ? 'border-active/50 bg-active-soft'
      : 'border-line bg-surface-2 hover:border-line-strong'}"
    data-agent={agent.slug}
  >
    <HaloSigil name={agent.name} status={agent.status} rank={agent.rank} size="card" />
    <div class="min-w-0 flex-1 space-y-1 lg:flex-none">
      <p class="text-lg leading-tight font-black">
        <a
          href={agentHref(agent.slug)}
          class="stretched-link link-standalone text-ink group-hover:text-gold-strong"
          >{agent.name}</a
        >
      </p>
      {#if lines.epithet}<p class="epithet">{lines.epithet}</p>{/if}
      {#if isActive}
        <p class="flex flex-wrap items-center gap-x-1.5 text-sm lg:justify-center">
          <span class="relative inline-flex size-2" aria-hidden="true">
            <span class="absolute inset-0 animate-pulse-ring rounded-full bg-active"></span>
            <span class="relative size-2 rounded-full bg-active"></span>
          </span>
          <span class="font-bold text-active">Active</span>
          <span class="text-ink-faint" aria-hidden="true">·</span>
          {#if agent.currentTool}
            <code class="min-w-0 truncate text-active" title={agent.currentTool}
              >{toolLabel(agent.currentTool)}</code
            >
          {:else}
            <span class="text-active">Thinking</span>
          {/if}
        </p>
      {:else}
        <p class="text-sm text-ink-muted">
          Last seen <RelativeTime datetime={agent.lastSeen} {now} class="figure" />
        </p>
        {#if agent.lastEnd}
          <p
            class="text-xs {agent.lastEnd.outcome === 'completed'
              ? 'text-ink-faint'
              : 'text-ink-muted'}"
          >
            {END_LABEL[agent.lastEnd.outcome]},
            <RelativeTime datetime={agent.lastEnd.at} {now} class="figure" />
          </p>
        {/if}
      {/if}
    </div>
  </li>
{/snippet}

{#snippet caption(id: string, text: string, tone: 'active' | 'quiet')}
  <svelte:element
    this={tag}
    {id}
    class="mb-3 flex items-center gap-2 text-xs font-bold tracking-caps uppercase {tone === 'active'
      ? 'text-active'
      : 'text-ink-faint'}"
  >
    {text}
  </svelte:element>
{/snippet}

{#if error && !agents}
  <ErrorState title="The Council could not be read" message={error} {retryHref} />
{:else if loading || !pick}
  <LoadingState label="Loading who is at work" rows={2} shape="cards" />
{:else if pick.empty}
  <EmptyState
    title="No one has been seen yet"
    message="The Council appears here as soon as an agent's hook events reach the log."
    compact
  />
{:else}
  {#if pick.resting}
    <p class="mb-4 flex items-center gap-2 text-sm text-ink-muted" role="status">
      <span class="text-gold" aria-hidden="true">✦</span>
      The Council rests. No agent has been heard from in the last five minutes.
    </p>
  {/if}
  <div class="at-work grid gap-x-4 gap-y-6" style="--at-work-columns: {Math.max(1, limit)}">
    {#if pick.active.length > 0}
      <section
        aria-labelledby="{uid}-active"
        class="at-work-group"
        style="--span: {pick.active.length}"
      >
        {@render caption(
          `${uid}-active`,
          `At work now (${pick.active.length + pick.moreActive})`,
          'active',
        )}
        <ul class="at-work-list grid gap-3 sm:grid-cols-2">
          {#each pick.active as agent, i (`${agent.slug}-${i}`)}
            {@render card(agent, true)}
          {/each}
        </ul>
        {#if pick.moreActive > 0}
          <p class="mt-2 text-xs text-ink-muted">
            And {plural(pick.moreActive, 'more agent')} at work.
          </p>
        {/if}
      </section>
    {/if}
    {#if pick.recent.length > 0}
      <section
        aria-labelledby="{uid}-recent"
        class="at-work-group"
        style="--span: {pick.recent.length}"
      >
        {@render caption(`${uid}-recent`, 'Last active', 'quiet')}
        <ul class="at-work-list grid gap-3 sm:grid-cols-2">
          {#each pick.recent as agent, i (`${agent.slug}-${i}`)}
            {@render card(agent, false)}
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}

<style>
  /*
   * Wide screens: one row of cards across the panel, each group spanning as many columns as
   * it has cards (the total is the limit, so they share the row exactly).
   */
  @media (width >= 64rem) {
    .at-work {
      grid-template-columns: repeat(var(--at-work-columns, 4), minmax(0, 1fr));
    }
    .at-work-group {
      grid-column: span var(--span) / span var(--span);
    }
    .at-work-list {
      grid-template-columns: repeat(var(--span), minmax(0, 1fr));
    }
  }
</style>
