<!--
  @component
  A calm "nothing here yet" message. Used by every list when it has no items.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    title: string;
    message?: string;
    icon?: IconName;
    compact?: boolean;
    children?: Snippet;
  }
  let { title, message, icon = 'empty', compact = false, children }: Props = $props();
</script>

<div
  class="flex flex-col items-center gap-2 rounded-md border border-dashed border-line text-center {compact
    ? 'px-4 py-5'
    : 'px-6 py-10'}"
>
  <Icon name={icon} class="{compact ? 'size-6' : 'size-8'} text-gold" />
  <p class="font-display text-lg font-semibold text-ink">{title}</p>
  {#if message}
    <p class="max-w-prose text-sm text-ink-muted">{message}</p>
  {/if}
  {@render children?.()}
</div>
