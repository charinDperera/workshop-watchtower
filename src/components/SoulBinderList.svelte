<!--
  @component
  The departed, from the Soul Binder: a retired sigil, the name (linked to its page), the
  role, when they served, the cause and the audit log. While nobody has been retired, a
  quiet, plain empty state. Owner: Luka.
-->
<script lang="ts">
  import type { RetiredAgent } from '../shared/types';
  import { agentHref, recordHref } from '../ui/labels';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import LoadingState from './LoadingState.svelte';
  import Sigil from './Sigil.svelte';
  import StatusBadge from './StatusBadge.svelte';

  interface Props {
    retired: RetiredAgent[] | null;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
    level?: 2 | 3;
  }
  let { retired, loading = false, error = null, retryHref = null, level = 2 }: Props = $props();

  const slugOf = (name: string) => name.trim().toLowerCase();
</script>

{#if error && !retired}
  <ErrorState title="The Soul Binder could not be read" message={error} {retryHref} />
{:else if loading || !retired}
  <LoadingState label="Opening the Soul Binder" rows={3} shape="cards" />
{:else if retired.length === 0}
  <EmptyState
    title="No name is bound here"
    message="No member of The Council has been retired. Names bound here are never given again."
    icon="star"
  />
{:else}
  <ol class="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="The departed">
    {#each retired as agent, i (`${agent.name}-${i}`)}
      {@const id = `departed-${i}`}
      <li>
        <article
          class="panel flex h-full flex-col gap-4 border-retired/40 p-4 sm:p-5"
          aria-labelledby={id}
        >
          <header class="flex items-start gap-4">
            <Sigil name={agent.name} status="retired" class="size-14" />
            <div class="min-w-0 flex-1 space-y-1">
              <svelte:element
                this={`h${level}`}
                {id}
                class="font-display text-xl leading-tight font-semibold"
              >
                <a href={agentHref(slugOf(agent.name))} class="link-standalone text-ink"
                  >{agent.name}</a
                >
              </svelte:element>
              <p class="text-sm text-ink-muted">{agent.role || 'No role recorded'}</p>
              <StatusBadge status="retired" />
            </div>
          </header>
          <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm xs:grid-cols-[auto_1fr]">
            <dt class="text-ink-faint">Served</dt>
            <dd class="figure text-ink">{agent.served || 'Not recorded'}</dd>
            <dt class="mt-2 text-ink-faint xs:mt-0">Cause</dt>
            <dd class="break-words text-ink">{agent.cause || 'Not recorded'}</dd>
            <dt class="mt-2 text-ink-faint xs:mt-0">Audit log</dt>
            <dd class="min-w-0 break-words">
              {#if agent.auditLogPath}
                <a href={recordHref(agent.auditLogPath)}
                  >{agent.auditLog || 'Read the audit log'}<span class="sr-only">
                    for {agent.name}</span
                  ></a
                >
              {:else if agent.auditLog}
                <span class="text-ink-muted">{agent.auditLog}</span>
              {:else}
                <span class="text-ink-faint">None linked</span>
              {/if}
            </dd>
          </dl>
          <p class="mt-auto text-xs text-ink-faint">The name {agent.name} is never given again.</p>
        </article>
      </li>
    {/each}
  </ol>
{/if}
