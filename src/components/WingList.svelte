<!--
  @component
  The wings of Limforia (plus intel) with their record counts. Each wing links to the
  archive filtered to it.
-->
<script lang="ts">
  import type { WingId, WingSummary } from '../shared/types';
  import { plural } from '../ui/format';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import LoadingState from './LoadingState.svelte';

  interface Props {
    wings: WingSummary[] | null;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
    /** The wing the page is filtered to: marked with aria-current and a gold border. */
    current?: WingId | null;
  }
  let { wings, loading = false, error = null, retryHref = null, current = null }: Props = $props();
</script>

{#if error && !wings}
  <ErrorState title="The archive could not be read" message={error} {retryHref} compact />
{:else if loading || !wings}
  <LoadingState label="Loading the archive" rows={4} />
{:else if wings.length === 0}
  <EmptyState title="The archive is empty" message="No wings were found in limforia/." compact />
{:else}
  <ul class="grid grid-cols-1 gap-2 xs:grid-cols-2">
    {#each wings as wing (wing.id)}
      {@const subs = Object.entries(wing.subWings)}
      {@const chosen = current === wing.id}
      <li
        class="relative flex items-start justify-between gap-3 rounded-md border p-3 transition-colors duration-(--duration-fast) {chosen
          ? 'border-gold bg-gold-soft shadow-glow-gold'
          : 'border-line bg-surface-2 hover:border-line-strong'}"
      >
        <div class="min-w-0">
          <p class="font-display text-md font-semibold">
            <a
              href="/limforia?wing={encodeURIComponent(wing.id)}"
              aria-current={chosen ? 'page' : undefined}
              class="stretched-link link-standalone text-ink">{wing.title}</a
            >
          </p>
          <p class="text-xs text-ink-faint">{wing.description}</p>
          {#if subs.length > 0}
            <p class="mt-1 text-xs text-ink-muted">
              {subs.map(([name, n]) => `${name} ${n}`).join(' · ')}
            </p>
          {/if}
        </div>
        <p
          class="figure font-display text-xl leading-none font-semibold {wing.count
            ? 'text-gold'
            : 'text-ink-faint'}"
        >
          <span aria-hidden="true">{wing.count}</span>
          <span class="sr-only">{plural(wing.count, 'record')}</span>
        </p>
      </li>
    {/each}
  </ul>
{/if}
