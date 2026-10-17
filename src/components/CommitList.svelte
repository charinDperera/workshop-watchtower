<!--
  @component
  Git commits, newest first: subject, short hash, author and relative time.
-->
<script lang="ts">
  import type { GitCommit } from '../shared/types';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import Icon from './Icon.svelte';
  import LoadingState from './LoadingState.svelte';
  import RelativeTime from './RelativeTime.svelte';

  interface Props {
    commits: GitCommit[] | null;
    now: number;
    limit?: number;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
    label?: string;
  }
  let {
    commits,
    now,
    limit = 50,
    loading = false,
    error = null,
    retryHref = null,
    label = 'Commits',
  }: Props = $props();

  const shown = $derived((commits ?? []).slice(0, limit));
</script>

{#if error && !commits}
  <ErrorState title="Git could not be read" message={error} {retryHref} compact />
{:else if loading || !commits}
  <LoadingState label="Loading commits" rows={3} />
{:else if shown.length === 0}
  <EmptyState
    title="No commits yet"
    message="The repository has no history yet."
    icon="commit"
    compact
  />
{:else}
  <ol class="space-y-0" aria-label={label}>
    {#each shown as commit, i (commit.hash)}
      <li class="relative flex gap-3 pb-3 last:pb-0">
        <span class="relative flex w-4 justify-center" aria-hidden="true">
          {#if i < shown.length - 1}
            <span class="absolute top-5 bottom-0 w-px bg-line"></span>
          {/if}
          <Icon name="commit" class="relative mt-0.5 size-4 text-gold" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm break-words text-ink">{commit.subject}</p>
          <p class="flex flex-wrap gap-x-2 text-xs text-ink-faint">
            <code class="text-gold" title={commit.hash}>{commit.shortHash}</code>
            <span>{commit.author}</span>
            <RelativeTime datetime={commit.date} {now} class="figure" />
          </p>
        </div>
      </li>
    {/each}
  </ol>
{/if}
