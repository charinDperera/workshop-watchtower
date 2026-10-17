<!--
  @component
  The activity feed: hook events, newest first. Records only names, tools and times (the
  hook logger never stores prompts or inputs). Events from the last minute carry a small
  gold mark.
-->
<script lang="ts">
  import type { ActivityEvent } from '../shared/types';
  import type { AgentRef } from '../ui/format';
  import {
    agentNameFor,
    capitalise,
    eventPhrase,
    eventTone,
    isUnattributed,
    parseTime,
    toolLabel,
  } from '../ui/format';
  import { clock } from '../ui/live/store.svelte';
  import { agentHref } from '../ui/labels';
  import { eventKey } from '../ui/live/logic';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import LoadingState from './LoadingState.svelte';
  import RelativeTime from './RelativeTime.svelte';
  import Sigil from './Sigil.svelte';

  interface Props {
    events: ActivityEvent[] | null;
    /** Used for display names; unknown slugs are shown as they are. */
    agents?: AgentRef[] | null;
    now: number;
    limit?: number;
    /** Hide successful PostToolUse lines, which mostly repeat their PreToolUse. */
    hideToolEnds?: boolean;
    /** Hide the agent column (on an agent's own page). */
    showAgent?: boolean;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
    label?: string;
    emptyTitle?: string;
    emptyMessage?: string;
  }
  let {
    events,
    agents = null,
    now,
    limit = 20,
    hideToolEnds = false,
    showAgent = true,
    loading = false,
    error = null,
    retryHref = null,
    label = 'Activity',
    emptyTitle = 'All is quiet',
    emptyMessage = 'No activity yet. Events appear here as agents work.',
  }: Props = $props();

  const FRESH_MS = 60_000;

  const names = $derived(new Map((agents ?? []).map((a) => [a.slug, a.name])));
  const shown = $derived(
    (events ?? []).filter((e) => !(hideToolEnds && e.event === 'PostToolUse')).slice(0, limit),
  );
  const isToolEvent = (e: ActivityEvent) =>
    e.tool !== null &&
    (e.event === 'PreToolUse' || e.event === 'PostToolUse' || e.event === 'PostToolUseFailure');
  const VERB: Record<string, string> = {
    PreToolUse: 'began',
    PostToolUse: 'finished',
    PostToolUseFailure: 'failed at',
  };
  /** Lower case after a name ("Luke began"), capitalised when the name is hidden. */
  const verbFor = (e: ActivityEvent) => {
    const verb = VERB[e.event] ?? e.event;
    return showAgent ? verb : capitalise(verb);
  };
  const TONE = {
    neutral: 'text-ink-muted',
    active: 'text-active',
    info: 'text-info',
    fail: 'text-fail',
    warn: 'text-warn',
    gold: 'text-gold',
    retired: 'text-retired',
  } as const;
</script>

{#if error && !events}
  <ErrorState title="The activity log could not be read" message={error} {retryHref} compact />
{:else if loading || !events}
  <LoadingState label="Loading activity" rows={6} />
{:else if shown.length === 0}
  <EmptyState title={emptyTitle} message={emptyMessage} icon="feather" compact />
{:else}
  <ul class="divide-y divide-line" aria-label={label}>
    {#each shown as event (eventKey(event))}
      {@const tone = eventTone(event)}
      {@const fresh = (clock.now || now) - (parseTime(event.ts) ?? 0) < FRESH_MS}
      <li class="flex items-start gap-2.5 py-2 text-sm">
        {#if showAgent}
          <Sigil
            name={agentNameFor(event.agent, names)}
            anonymous={isUnattributed(event.agent)}
            class="mt-0.5 size-5"
          />
        {/if}
        <p class="min-w-0 flex-1 break-words">
          {#if showAgent}
            {#if names.has(event.agent)}
              <a href={agentHref(event.agent)} class="link-standalone font-semibold text-ink"
                >{agentNameFor(event.agent, names)}</a
              >
            {:else if isUnattributed(event.agent)}
              <span
                class="font-semibold text-ink-muted"
                title="A subagent whose type the hook payload did not name"
                >{agentNameFor(event.agent, names)}</span
              >
            {:else}
              <span class="font-semibold text-ink">{event.agent}</span>
            {/if}
          {/if}
          {#if isToolEvent(event)}
            <span class={TONE[tone]}>{verbFor(event)}</span>
            <code class="text-xs text-ink" title={event.tool}>{toolLabel(event.tool)}</code>
          {:else}
            <span class={TONE[tone]}
              >{showAgent ? eventPhrase(event) : capitalise(eventPhrase(event))}</span
            >
          {/if}
        </p>
        <span class="flex shrink-0 items-center gap-1.5 pt-px">
          {#if fresh}
            <span class="size-1.5 rounded-full bg-gold" aria-hidden="true"></span>
          {/if}
          <RelativeTime datetime={event.ts} {now} class="figure font-mono text-xs text-ink-faint" />
        </span>
      </li>
    {/each}
  </ul>
{/if}
