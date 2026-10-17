<!--
  @component
  The hero sigil on an agent's page, live: the halo follows the agent's status.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Agent } from '../../shared/types';
  import { live, useLive } from '../../ui/live/store.svelte';
  import HaloSigil from '../HaloSigil.svelte';

  interface Props {
    initial: Pick<Agent, 'slug' | 'name' | 'status' | 'rank'>;
  }
  let { initial }: Props = $props();
  onMount(useLive);

  const agent = $derived(live.snapshot?.agents.find((a) => a.slug === initial.slug) ?? initial);
</script>

<HaloSigil name={agent.name} status={agent.status} rank={agent.rank} size="hero" />
