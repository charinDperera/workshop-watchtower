<!--
  @component
  Skeleton rows while data is on its way. Hidden from assistive tech except for one
  polite "Loading" label.
-->
<script lang="ts">
  interface Props {
    label?: string;
    rows?: number;
    /** `cards` draws a grid of blocks instead of rows. */
    shape?: 'rows' | 'cards';
  }
  let { label = 'Loading', rows = 3, shape = 'rows' }: Props = $props();
</script>

<div role="status" class="w-full">
  <span class="sr-only">{label}</span>
  {#if shape === 'cards'}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {#each { length: rows } as _, i (i)}
        <div class="skeleton h-36"></div>
      {/each}
    </div>
  {:else}
    <div class="space-y-3" aria-hidden="true">
      {#each { length: rows } as _, i (i)}
        <div class="skeleton h-4 {i % 3 === 2 ? 'w-2/3' : 'w-full'}"></div>
      {/each}
    </div>
  {/if}
</div>
