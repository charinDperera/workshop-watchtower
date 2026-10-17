<!--
  @component
  Something could not be read. States what failed and offers a reload link (`retryHref`,
  normally the current URL), which works without JavaScript. Announced as an alert only when `alert` is set (live failures).
-->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    title?: string;
    message?: string | null;
    /** Where "Try again" goes, normally the current page. Omit to hide the link. */
    retryHref?: string | null;
    compact?: boolean;
    alert?: boolean;
  }
  let {
    title = 'This could not be read',
    message = null,
    retryHref = null,
    compact = false,
    alert = false,
  }: Props = $props();
</script>

<div
  class="flex items-start gap-3 rounded-md border border-fail/50 bg-fail-soft text-left {compact
    ? 'p-3'
    : 'p-4'}"
  role={alert ? 'alert' : undefined}
>
  <Icon name="fail" class="mt-0.5 size-5 shrink-0 text-fail" />
  <div class="min-w-0 space-y-1">
    <p class="font-semibold text-ink">{title}</p>
    {#if message}
      <p class="text-sm break-words text-ink-muted">{message}</p>
    {/if}
    {#if retryHref}
      <p class="text-sm"><a href={retryHref}>Try again</a></p>
    {/if}
  </div>
</div>
