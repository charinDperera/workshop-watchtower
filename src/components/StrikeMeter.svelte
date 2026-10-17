<!--
  @component
  Strikes as pips. Filled pips are strikes; the tone deepens as the count
  nears the limit. Unknown counts show dashed pips and say so.
-->
<script lang="ts">
  interface Props {
    strikes: number | null;
    limit?: number;
    /** Show the "n / 3" figure next to the pips. */
    showCount?: boolean;
    size?: 'sm' | 'md';
  }
  let { strikes, limit = 3, showCount = true, size = 'sm' }: Props = $props();

  const known = $derived(strikes !== null);
  const count = $derived(Math.max(0, Math.min(limit, strikes ?? 0)));
  const label = $derived(
    known ? `${strikes} of ${limit} strikes` : `Strikes unknown (limit ${limit})`,
  );
  const fill = $derived(
    count >= limit ? 'bg-fail border-fail' : count > 0 ? 'bg-warn border-warn' : '',
  );
  const pip = $derived(size === 'md' ? 'h-2.5 w-5' : 'h-2 w-3.5');
</script>

<span class="inline-flex items-center gap-2" role="img" aria-label={label} title={label}>
  <span class="inline-flex gap-1" aria-hidden="true">
    {#each { length: limit } as _, i (i)}
      <span
        class="{pip} rounded-full border {known
          ? i < count
            ? fill
            : 'border-line-strong'
          : 'border-dashed border-line-strong'}"
      ></span>
    {/each}
  </span>
  {#if showCount}
    <span
      class="figure font-mono text-xs {count >= limit
        ? 'text-fail'
        : count > 0
          ? 'text-warn'
          : 'text-ink-faint'}"
      aria-hidden="true">{known ? `${strikes} / ${limit}` : `? / ${limit}`}</span
    >
  {/if}
</span>
