<!--
  @component
  The Council tree, live: server-rendered agents first, then the stream's.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Agent, PipelineStage } from '../../shared/types';
  import { live, useClock, useLive } from '../../ui/live/store.svelte';
  import CouncilTree from '../CouncilTree.svelte';

  interface Props {
    initial: { agents: Agent[]; stages: Pick<PipelineStage, 'id' | 'title'>[] } | null;
    now: number;
    error?: string | null;
    retryHref?: string | null;
    /** Heading level of the tiers. */
    level?: 2 | 3;
  }
  let { initial, now, error = null, retryHref = null, level = 3 }: Props = $props();
  onMount(useLive);
  onMount(useClock);
</script>

<CouncilTree
  agents={live.snapshot?.agents ?? initial?.agents ?? null}
  stages={live.snapshot?.pipeline ?? initial?.stages ?? null}
  {now}
  {level}
  {error}
  {retryHref}
/>
