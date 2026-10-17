<!--
  @component
  The archive's record list, filtered, live: the server renders the filtered list; the
  stream's snapshots are filtered the same way (src/ui/archive-filter.ts). Owner: Luka.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { ArchiveRecord } from '../../shared/types';
  import {
    filterRecords,
    hasFilter,
    scopeCount,
    type ArchiveFilter,
  } from '../../ui/archive-filter';
  import { plural } from '../../ui/format';
  import { live, useLive } from '../../ui/live/store.svelte';
  import RecordList from '../RecordList.svelte';

  interface Props {
    /** Already filtered on the server, or null when the snapshot failed. */
    initial: ArchiveRecord[] | null;
    /** Records in scope before filtering, for "n of m". */
    initialScope: number;
    filter: ArchiveFilter;
    current?: string | null;
    error?: string | null;
    retryHref?: string | null;
  }
  let {
    initial,
    initialScope,
    filter,
    current = null,
    error = null,
    retryHref = null,
  }: Props = $props();
  onMount(useLive);

  const records = $derived(live.snapshot ? filterRecords(live.snapshot.records, filter) : initial);
  const scope = $derived(live.snapshot ? scopeCount(live.snapshot.records, filter) : initialScope);
  const filtered = $derived(hasFilter(filter));
  const noun = $derived(filter.wing === 'templates' ? 'template' : 'record');
</script>

<div class="flex flex-col gap-3">
  {#if records}
    <p class="text-sm text-ink-muted">
      {#if filtered}
        Showing <span class="figure font-semibold text-ink">{records.length}</span> of {plural(
          scope,
          noun,
        )}.
      {:else}
        <span class="figure font-semibold text-ink">{plural(records.length, noun)}</span>, newest
        first.
      {/if}
    </p>
  {/if}
  <RecordList
    {records}
    {current}
    {error}
    {retryHref}
    showWing={!filter.wing}
    label="Archive records"
    emptyTitle={filtered ? 'No records match' : 'The archive is empty'}
    emptyMessage={filtered
      ? 'Nothing in the archive matches every filter. Clear a filter or choose another wing.'
      : 'No records have been written into Limforia or intel/ yet.'}
  />
</div>
