<!--
  @component
  The apps table, live. Owner: Luka.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppRepo } from '../../shared/types';
  import { live, useClock, useLive } from '../../ui/live/store.svelte';
  import AppTable from '../AppTable.svelte';

  interface Props {
    initial: AppRepo[] | null;
    now: number;
    error?: string | null;
    retryHref?: string | null;
  }
  let { initial, now, error = null, retryHref = null }: Props = $props();
  onMount(useLive);
  onMount(useClock);
</script>

<AppTable apps={live.snapshot?.apps ?? initial} {now} {error} {retryHref} />
