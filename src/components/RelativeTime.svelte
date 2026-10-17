<!--
  @component
  A relative time ("3 min ago") in a <time> element with the exact time as a tooltip.
  Server-rendered against `now`; inside a live island it ticks with the shared clock.
-->
<script lang="ts">
  import { formatDateTime, relativeTime } from '../ui/format';
  import { clock } from '../ui/live/store.svelte';

  interface Props {
    datetime: string | null;
    /** Reference time from the server render (ms). Used until the shared clock starts. */
    now: number;
    /** Text when `datetime` is missing. */
    fallback?: string;
    class?: string;
  }
  let { datetime, now, fallback = 'never', class: className = '' }: Props = $props();

  const text = $derived(datetime ? relativeTime(datetime, clock.now || now) : fallback);
</script>

{#if datetime}
  <time class={className} {datetime} title={formatDateTime(datetime)}>{text}</time>
{:else}
  <span class={className}>{fallback}</span>
{/if}
