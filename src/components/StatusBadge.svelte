<!--
  @component
  An agent's status as a word and a dot. Active agents get a calm pulse ring, which stops
  under prefers-reduced-motion. The word always carries the meaning, never the colour.
-->
<script lang="ts">
  import type { ActiveReason, AgentStatus } from '../shared/types';
  import { STATUS_LABEL } from '../ui/format';

  interface Props {
    status: AgentStatus | null;
    reason?: ActiveReason;
    size?: 'sm' | 'md';
  }
  let { status, reason = null, size = 'sm' }: Props = $props();

  const label = $derived(status ? STATUS_LABEL[status] : 'Unknown');
  const detail = $derived(
    reason === 'open-session' ? 'at work' : reason === 'recent-tool' ? 'recent tool use' : null,
  );
  const colour = $derived(
    status === 'active'
      ? 'text-active border-active/40 bg-active-soft'
      : status === 'retired'
        ? 'text-retired border-retired/40'
        : 'text-ink-muted border-line',
  );
</script>

<span
  class="inline-flex items-center gap-2 rounded-full border {colour} {size === 'md'
    ? 'px-3 py-1 text-sm'
    : 'px-2 py-0.5 text-xs'} font-medium"
  title={detail ? `${label}: ${detail}` : label}
>
  <span class="relative inline-flex size-2" aria-hidden="true">
    {#if status === 'active'}
      <span class="absolute inset-0 rounded-full bg-active animate-pulse-ring"></span>
      <span class="relative size-2 rounded-full bg-active"></span>
    {:else if status === 'retired'}
      <span class="size-2 rounded-full border border-retired"></span>
    {:else}
      <span class="size-2 rounded-full bg-ink-faint"></span>
    {/if}
  </span>
  {label}
</span>
