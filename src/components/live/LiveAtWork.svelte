<!--
  @component
  At work, live: server-rendered agents first, then the stream's. Agents move between
  "At work now" and "Last active" without a reload; the store already announces changes.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Agent } from '../../shared/types';
  import { live, useClock, useLive } from '../../ui/live/store.svelte';
  import AtWork from '../AtWork.svelte';

  interface Props {
    initial: Agent[] | null;
    now: number;
    limit?: number;
    error?: string | null;
    retryHref?: string | null;
  }
  let { initial, now, limit, error = null, retryHref = null }: Props = $props();
  onMount(useLive);
  onMount(useClock);
</script>

<AtWork agents={live.snapshot?.agents ?? initial} {now} {limit} {error} {retryHref} />
