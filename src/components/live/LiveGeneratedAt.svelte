<!--
  @component
  Footer line: when the snapshot on screen was generated. Follows the live snapshot.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { formatClock } from '../../ui/format';
  import { live, useLive } from '../../ui/live/store.svelte';
  import RelativeTime from '../RelativeTime.svelte';

  interface Props {
    initial: string | null;
    now: number;
  }
  let { initial, now }: Props = $props();
  onMount(useLive);

  const at = $derived(live.snapshot?.generatedAt ?? initial);
</script>

{#if at}
  Snapshot generated at <time datetime={at} class="figure font-mono">{formatClock(at)}</time>
  (<RelativeTime datetime={at} {now} />).
{:else}
  No snapshot is available yet.
{/if}
