<!--
  @component
  Live compliance checks.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { ComplianceSummary } from '../../shared/types';
  import { live, useLive } from '../../ui/live/store.svelte';
  import ComplianceList from '../ComplianceList.svelte';

  interface Props {
    initial: ComplianceSummary | null;
    variant?: 'summary' | 'full';
    error?: string | null;
    retryHref?: string | null;
    level?: 2 | 3 | 4;
    /** Show the law each check serves (the Laws page only). */
    showServes?: boolean;
  }
  let {
    initial,
    variant,
    error = null,
    retryHref = null,
    level,
    showServes = false,
  }: Props = $props();
  onMount(useLive);
</script>

<ComplianceList
  compliance={live.snapshot?.compliance ?? initial}
  {variant}
  {error}
  {retryHref}
  {level}
  {showServes}
/>
