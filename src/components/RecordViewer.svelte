<!--
  @component
  One rendered record in a panel: eyebrow, title, the YAML header as chips, the path, and the
  body in archive prose. The body is the sanitised HTML from `/api/record`, fitted to the
  page outline (src/ui/record-html.ts). Handles the error state for a bad or missing path.
  Owner: Luka. Used by /limforia (record viewer) and /laws (the Constitution).
-->
<script lang="ts">
  import type { ArchiveRecord, RenderedRecord } from '../shared/types';
  import type { KnownAgent } from '../ui/agent-title';
  import { formatDate } from '../ui/format';
  import { agentHref, STATUS_TONE } from '../ui/labels';
  import { wingTitle } from '../shared/wings';
  import { fitRecordHtml } from '../ui/record-html';
  import ErrorState from './ErrorState.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    record: RenderedRecord | null;
    /** Why the record could not be shown (bad path, missing file). */
    error?: string | null;
    errorStatus?: number | null;
    /** The path that was asked for, shown in the error state. */
    requested?: string | null;
    /** The archive's entry for this record, for wing and header warnings. */
    meta?: ArchiveRecord | null;
    /** Known agents: their chips link to `/host/[slug]` and show the title, if any. */
    knownAgents?: readonly KnownAgent[];
    /** Heading level of the title. The body's headings sit below it. */
    level?: 2 | 3;
    eyebrow?: string | null;
    /** The record left the disk while the page was open (live). */
    stale?: boolean;
    /** Shows a "Close" link back to the list. */
    closeHref?: string | null;
    headingId?: string;
  }
  let {
    record,
    error = null,
    errorStatus = null,
    requested = null,
    meta = null,
    knownAgents = [],
    level = 2,
    eyebrow = null,
    stale = false,
    closeHref = null,
    headingId = 'record-title',
  }: Props = $props();

  const known = $derived(new Map(knownAgents.map((a) => [a.slug, a])));
  const html = $derived(
    record ? fitRecordHtml(record.html, { path: record.path, shift: level - 1 }) : '',
  );
  const header = $derived(record?.header ?? null);
  /** Extra header keys with a plain value (e.g. `outcome` on audit logs). */
  const extras = $derived(
    Object.entries(header?.extra ?? {}).filter(
      (entry): entry is [string, string | number | boolean] =>
        ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  );
  const place = $derived(
    meta
      ? `${wingTitle(meta.wing)}${meta.subWing ? ` / ${meta.subWing}` : ''}`
      : (eyebrow ?? 'Record'),
  );
  const problem = $derived(
    meta && !meta.isTemplate && !meta.headerValid
      ? meta.hasHeader
        ? `Header problems: ${meta.headerProblems.join('; ')}`
        : 'This record has no header.'
      : null,
  );
</script>

{#if !record}
  <div class="space-y-3">
    <ErrorState
      title={errorStatus === 404 ? 'No record at this path' : 'This record cannot be shown'}
      message={`${error ?? 'The record could not be read.'}${requested ? ` (asked for "${requested}")` : ''}. Records are .md files in limforia/, intel/ or hueco-mundo/, or CLAUDE.md and ROSTER.md.`}
    />
    {#if closeHref}
      <p class="text-sm"><a href={closeHref}>Back to the archive</a></p>
    {/if}
  </div>
{:else}
  <article class="panel p-4 sm:p-6" aria-labelledby={headingId}>
    <header class="mb-5 flex flex-col gap-3 border-b border-line pb-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="eyebrow text-gold">{place}</p>
          <svelte:element
            this={`h${level}`}
            id={headingId}
            class="mt-1 text-xl text-ink sm:text-2xl">{record.title}</svelte:element
          >
        </div>
        {#if closeHref}
          <a href={closeHref} class="shrink-0 text-sm whitespace-nowrap"
            >Close<span class="sr-only"> the record</span></a
          >
        {/if}
      </div>

      {#if header}
        <dl class="flex flex-wrap items-center gap-1.5" aria-label="Record header">
          {#if header.type}
            <div class="contents">
              <dt class="sr-only">Type</dt>
              <dd class="chip border-gold/50 text-gold">{header.type}</dd>
            </div>
          {/if}
          {#if header.status}
            <div class="contents">
              <dt class="sr-only">Status</dt>
              <dd class="chip {STATUS_TONE[header.status] ?? ''}">{header.status}</dd>
            </div>
          {/if}
          {#if header.date}
            <div class="contents">
              <dt class="sr-only">Date</dt>
              <dd class="chip">
                <time datetime={header.date} class="figure">{formatDate(header.date)}</time>
              </dd>
            </div>
          {/if}
          {#each header.agents as agent (agent)}
            {@const slug = agent.trim().toLowerCase()}
            {@const ref = known.get(slug)}
            <div class="contents">
              <dt class="sr-only">Agent</dt>
              <dd class="chip">
                {#if ref}
                  <a href={agentHref(slug)} class="link-standalone text-ink"
                    >{agent}{#if ref.title}<span class="text-ink-faint"
                        ><span aria-hidden="true" class="mx-1">·</span><span class="sr-only"
                          >,
                        </span>{ref.title}</span
                      >{/if}</a
                  >
                {:else}
                  {agent}
                {/if}
              </dd>
            </div>
          {/each}
          {#each header.tags as tag (tag)}
            <div class="contents">
              <dt class="sr-only">Tag</dt>
              <dd class="chip font-mono">#{tag}</dd>
            </div>
          {/each}
          {#each extras as [key, value] (key)}
            <div class="contents">
              <dt class="sr-only">{key}</dt>
              <dd class="chip"><span aria-hidden="true">{key}:</span>&nbsp;{value}</dd>
            </div>
          {/each}
        </dl>
      {/if}

      {#if problem}
        <p class="flex items-center gap-1.5 text-xs text-warn">
          <Icon name="warn" class="size-3.5 shrink-0" />
          {problem}
        </p>
      {/if}
      {#if stale}
        <p class="rounded-md border border-warn/60 bg-warn-soft p-3 text-sm text-ink" role="status">
          This record is no longer on disk. The last known text is shown.
        </p>
      {/if}
      <p class="font-mono text-xs break-all text-ink-faint">{record.path}</p>
    </header>

    {#if html.trim()}
      <div class="prose">
        <!-- Sanitised by the server (src/server/render/markdown.ts): raw HTML is escaped. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html html}
      </div>
    {:else}
      <p class="text-sm text-ink-muted">This record has a header but no body.</p>
    {/if}
  </article>
{/if}
