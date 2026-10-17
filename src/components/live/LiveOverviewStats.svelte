<!--
  @component
  The Overview's headline figures, live.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { live, useLive } from '../../ui/live/store.svelte';
  import { overviewTiles, type Tile } from '../../ui/stats';
  import StatTile from '../StatTile.svelte';

  interface Props {
    initial: Tile[] | null;
  }
  let { initial }: Props = $props();
  onMount(useLive);

  const PLACEHOLDERS = ['Active now', 'Strikes', 'Records', 'Laws kept', 'Working tree'];
  const tiles = $derived(live.snapshot ? overviewTiles(live.snapshot) : initial);
</script>

<ul class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="At a glance">
  {#if tiles}
    {#each tiles as tile (tile.id)}
      <li class={tile.id === 'active' ? 'col-span-2 md:col-span-1' : ''}>
        <StatTile
          label={tile.label}
          value={tile.value}
          hint={tile.hint}
          href={tile.href}
          tone={tile.tone}
        />
      </li>
    {/each}
  {:else}
    {#each PLACEHOLDERS as label, i (label)}
      <li class={i === 0 ? 'col-span-2 md:col-span-1' : ''}>
        <StatTile {label} value={null} loading />
      </li>
    {/each}
  {/if}
</ul>
