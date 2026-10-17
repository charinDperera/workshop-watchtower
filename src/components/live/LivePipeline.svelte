<!--
  @component
  Live Order of Work.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { PipelineStage } from '../../shared/types';
  import { agentRefs, type AgentRef } from '../../ui/format';
  import { live, useLive } from '../../ui/live/store.svelte';
  import PipelineFlow from '../PipelineFlow.svelte';

  interface Props {
    initial: { stages: PipelineStage[]; agents: AgentRef[] } | null;
    error?: string | null;
    retryHref?: string | null;
  }
  let { initial, error = null, retryHref = null }: Props = $props();
  onMount(useLive);
</script>

<PipelineFlow
  stages={live.snapshot?.pipeline ?? initial?.stages ?? null}
  agents={live.snapshot ? agentRefs(live.snapshot.agents) : (initial?.agents ?? null)}
  {error}
  {retryHref}
/>
