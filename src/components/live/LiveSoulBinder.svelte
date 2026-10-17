<!--
  @component
  The Soul Binder, live. Owner: Luka.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { RetiredAgent } from '../../shared/types';
  import { live, useLive } from '../../ui/live/store.svelte';
  import SoulBinderList from '../SoulBinderList.svelte';

  interface Props {
    initial: RetiredAgent[] | null;
    error?: string | null;
    retryHref?: string | null;
    level?: 2 | 3;
  }
  let { initial, error = null, retryHref = null, level }: Props = $props();
  onMount(useLive);
</script>

<SoulBinderList retired={live.snapshot?.retired ?? initial} {error} {retryHref} {level} />
