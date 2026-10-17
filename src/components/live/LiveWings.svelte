<!--
  @component
  Live archive wing counts.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { WingId, WingSummary } from '../../shared/types';
  import { live, useLive } from '../../ui/live/store.svelte';
  import WingList from '../WingList.svelte';

  interface Props {
    initial: WingSummary[] | null;
    error?: string | null;
    retryHref?: string | null;
    current?: WingId | null;
  }
  let { initial, error = null, retryHref = null, current = null }: Props = $props();
  onMount(useLive);
</script>

<WingList wings={live.snapshot?.wings ?? initial} {error} {retryHref} {current} />
