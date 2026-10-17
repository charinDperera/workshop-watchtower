<!--
  @component
  The record viewer, live: when a new snapshot arrives (something changed on disk), the
  record is fetched again from `/api/record` and replaced if it changed. If the file is gone,
  the last known text stays with a note. Error states (bad path) are not refreshed.
  Owner: Luka.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { ArchiveRecord, RenderedRecord } from '../../shared/types';
  import { knownAgents as toKnownAgents, type KnownAgent } from '../../ui/agent-title';
  import { live, useLive } from '../../ui/live/store.svelte';
  import RecordViewer from '../RecordViewer.svelte';

  interface Props {
    initial: RenderedRecord | null;
    /** Snapshot time of the server render: changes after it trigger a refresh. */
    generatedAt: string | null;
    error?: string | null;
    errorStatus?: number | null;
    requested?: string | null;
    meta?: ArchiveRecord | null;
    knownAgents?: KnownAgent[];
    level?: 2 | 3;
    eyebrow?: string | null;
    closeHref?: string | null;
    headingId?: string;
  }
  let {
    initial,
    generatedAt,
    error = null,
    errorStatus = null,
    requested = null,
    meta = null,
    knownAgents = [],
    level = 2,
    eyebrow = null,
    closeHref = null,
    headingId,
  }: Props = $props();

  /** Coalesces bursts of snapshots (agents at work) into one fetch. */
  const REFRESH_DELAY_MS = 1500;

  let fetched = $state.raw<RenderedRecord | null>(null);
  let stale = $state(false);
  let seen: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const record = $derived(fetched ?? initial);
  const liveMeta = $derived(
    live.snapshot && record
      ? (live.snapshot.records.find((r) => r.path === record.path) ?? null)
      : meta,
  );
  const liveAgents = $derived(live.snapshot ? toKnownAgents(live.snapshot.agents) : knownAgents);

  async function refresh(path: string): Promise<void> {
    timer = null;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    try {
      const res = await fetch(`/api/record?path=${encodeURIComponent(path)}`, {
        signal: mine.signal,
        headers: { accept: 'application/json' },
      });
      if (res.status === 404) {
        stale = true;
        return;
      }
      if (!res.ok) return;
      const next = (await res.json()) as RenderedRecord;
      stale = false;
      const current = fetched ?? initial;
      if (
        !current ||
        next.html !== current.html ||
        next.title !== current.title ||
        JSON.stringify(next.header) !== JSON.stringify(current.header)
      ) {
        fetched = next;
      }
    } catch {
      // Aborted or offline: keep what is on screen; the next snapshot tries again.
    }
  }

  onMount(useLive);
  onMount(() => () => {
    if (timer) clearTimeout(timer);
    controller?.abort();
  });

  $effect(() => {
    const at = live.snapshot?.generatedAt ?? null;
    const path = initial?.path ?? null;
    if (!at || !path) return;
    if (at === (seen ?? generatedAt)) return;
    seen = at;
    if (!timer) timer = setTimeout(() => void refresh(path), REFRESH_DELAY_MS);
  });
</script>

<RecordViewer
  {record}
  {error}
  {errorStatus}
  {requested}
  meta={liveMeta}
  knownAgents={liveAgents}
  {level}
  {eyebrow}
  {stale}
  {closeHref}
  {headingId}
/>
