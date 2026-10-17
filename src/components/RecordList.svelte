<!--
  @component
  A list of archive records: title (linked to the record viewer), type, status, date,
  agents and tags. Records with an invalid header say so. Used on agent pages (audit logs)
  and by the Limforia page.
-->
<script lang="ts">
  import type { ArchiveRecord } from '../shared/types';
  import { formatDate } from '../ui/format';
  import { recordHref, STATUS_TONE, WING_LABELS } from '../ui/labels';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import Icon from './Icon.svelte';
  import LoadingState from './LoadingState.svelte';

  interface Props {
    records: ArchiveRecord[] | null;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
    /** Show which wing each record lives in. */
    showWing?: boolean;
    /** Path of the record currently open in a viewer, marked with aria-current. */
    current?: string | null;
    label?: string;
    emptyTitle?: string;
    emptyMessage?: string;
  }
  let {
    records,
    loading = false,
    error = null,
    retryHref = null,
    showWing = true,
    current = null,
    label = 'Records',
    emptyTitle = 'No records',
    emptyMessage = 'Nothing has been written here yet.',
  }: Props = $props();
</script>

{#if error && !records}
  <ErrorState title="The archive could not be read" message={error} {retryHref} />
{:else if loading || !records}
  <LoadingState label="Loading records" rows={4} />
{:else if records.length === 0}
  <EmptyState title={emptyTitle} message={emptyMessage} icon="scroll" compact />
{:else}
  <ul class="divide-y divide-line" aria-label={label}>
    {#each records as record (record.path)}
      <li class="py-3">
        <div class="flex items-start gap-3">
          <Icon name="scroll" class="mt-0.5 size-5 shrink-0 text-gold" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <p class="font-medium break-words">
              <a
                href={recordHref(record.path)}
                aria-current={current === record.path ? 'page' : undefined}
                class="link-standalone text-ink hover:text-gold-strong">{record.title}</a
              >
            </p>
            <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
              {#if record.header.type}<span class="chip">{record.header.type}</span>{/if}
              {#if record.header.status}
                <span class="chip {STATUS_TONE[record.header.status] ?? ''}"
                  >{record.header.status}</span
                >
              {/if}
              {#if record.header.date}
                <time datetime={record.header.date} class="figure"
                  >{formatDate(record.header.date)}</time
                >
              {/if}
              {#if showWing}
                <span
                  >in {WING_LABELS[record.wing].title}{record.subWing
                    ? ` / ${record.subWing}`
                    : ''}</span
                >
              {/if}
              {#if record.header.agents.length > 0}
                <span>by {record.header.agents.join(', ')}</span>
              {/if}
            </p>
            {#if record.header.tags.length > 0}
              <ul class="flex flex-wrap gap-1" aria-label="Tags">
                {#each record.header.tags as tag (tag)}
                  <li class="font-mono text-xs text-ink-muted">#{tag}</li>
                {/each}
              </ul>
            {/if}
            {#if !record.isTemplate && (!record.headerValid || (!record.inCatalog && record.wing !== 'intel'))}
              <p class="flex items-center gap-1.5 text-xs text-warn">
                <Icon name="warn" class="size-3.5" />
                {!record.headerValid
                  ? record.hasHeader
                    ? `Header problems: ${record.headerProblems.join('; ')}`
                    : 'No header'
                  : 'Not listed in CATALOG.md'}
              </p>
            {/if}
            <p class="font-mono text-xs break-all text-ink-faint">{record.path}</p>
          </div>
        </div>
      </li>
    {/each}
  </ul>
{/if}
