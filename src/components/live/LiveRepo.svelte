<!--
  @component
  The workstation repository facts, live. Owner: Luka.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { RepoState } from '../../shared/types';
  import { live, useLive } from '../../ui/live/store.svelte';
  import RepoFacts from '../RepoFacts.svelte';

  interface Props {
    initial: RepoState | null;
    error?: string | null;
    retryHref?: string | null;
  }
  let { initial, error = null, retryHref = null }: Props = $props();
  onMount(useLive);
</script>

<RepoFacts repo={live.snapshot?.git.workstation ?? initial} {error} {retryHref} />
