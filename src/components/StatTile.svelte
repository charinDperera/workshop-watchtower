<!--
  @component
  One figure with a label and an optional hint. Becomes a link when `href` is set.
  Loading shows a skeleton; a null value shows an em dash and "unavailable".
-->
<script lang="ts">
  import type { Tone } from '../ui/format';

  interface Props {
    label: string;
    value: string | number | null;
    hint?: string | null;
    href?: string | null;
    tone?: Tone;
    loading?: boolean;
  }
  let {
    label,
    value,
    hint = null,
    href = null,
    tone = 'neutral',
    loading = false,
  }: Props = $props();

  const TONES: Record<Tone, string> = {
    neutral: 'text-ink',
    active: 'text-active',
    warn: 'text-warn',
    fail: 'text-fail',
    gold: 'text-gold',
    retired: 'text-retired',
    info: 'text-info',
  };
</script>

<div
  class="panel relative flex h-full flex-col gap-1 p-4 {href
    ? 'transition-colors duration-(--duration-fast) hover:border-line-strong'
    : ''}"
>
  <p class="eyebrow">
    {#if href}
      <a {href} class="stretched-link link-standalone text-ink-faint">{label}</a>
    {:else}
      {label}
    {/if}
  </p>
  {#if loading}
    <span class="skeleton mt-1 h-8 w-16" aria-hidden="true"></span>
    <span class="sr-only">Loading</span>
  {:else}
    <p class="figure font-display text-2xl leading-none font-semibold {TONES[tone]}">
      {value ?? '—'}
      {#if value === null}<span class="sr-only">unavailable</span>{/if}
    </p>
  {/if}
  {#if hint}
    <p class="text-xs text-ink-muted">{hint}</p>
  {/if}
</div>
