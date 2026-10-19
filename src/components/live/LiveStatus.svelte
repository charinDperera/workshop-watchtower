<!--
  @component
  The header's live indicator and the page's polite announcer. Opens the shared stream.
  States: connecting, live, reconnecting, disconnected (with "Retry now"), and paused (the
  stream was closed for a navigation that never happened while the tab was hidden; it resumes
  when the tab is shown, or at once with "Resume").
  Hidden without JavaScript (the layout shows a static note instead).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { clock, live, reconnectNow, useClock, useLive } from '../../ui/live/store.svelte';

  onMount(useLive);
  onMount(useClock);

  const LABEL = {
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
    paused: 'Paused',
  } as const;
  /** Shorter words for narrow screens, so the header stays on one row at 360 px. */
  const SHORT = {
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Retrying',
    disconnected: 'Offline',
    paused: 'Paused',
  } as const;

  const state = $derived(live.connection);
  const retryIn = $derived(
    live.retryAt && clock.now ? Math.max(0, Math.round((live.retryAt - clock.now) / 1000)) : null,
  );
  const tone = $derived(
    state === 'live'
      ? 'text-active border-active/50'
      : state === 'disconnected'
        ? 'text-fail border-fail/60'
        : state === 'paused'
          ? 'text-ink-muted border-line-strong'
          : 'text-warn border-warn/50',
  );
</script>

<div class="flex items-center gap-1.5 sm:gap-2">
  <p
    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 sm:gap-2 sm:px-2.5 text-xs font-medium {tone}"
    title={state === 'live'
      ? 'Receiving live updates from the workstation'
      : state === 'paused'
        ? 'Live updates are paused; they resume when you return to this tab'
        : 'Live updates are not flowing; the page shows the last known state'}
  >
    <span class="relative inline-flex size-2" aria-hidden="true">
      {#if state === 'live'}
        <span class="absolute inset-0 animate-pulse-ring rounded-full bg-active"></span>
        <span class="relative size-2 rounded-full bg-active"></span>
      {:else if state === 'disconnected'}
        <span class="size-2 rounded-full bg-fail"></span>
      {:else if state === 'paused'}
        <span class="size-2 rounded-full border border-ink-muted"></span>
      {:else}
        <span class="size-2 rounded-full border border-warn"></span>
      {/if}
    </span>
    <span>
      <span class="sr-only">Connection: </span>
      <span class="sr-only xs:not-sr-only">{LABEL[state]}</span>
      <span class="xs:hidden" aria-hidden="true">{SHORT[state]}</span>
    </span>
    {#if state === 'disconnected' && retryIn !== null && retryIn > 0}
      <span class="hidden text-ink-faint sm:inline">· retry in {retryIn} s</span>
    {/if}
  </p>
  {#if state === 'disconnected'}
    <button
      type="button"
      class="rounded-full border border-line-strong px-2 py-1 text-xs text-ink hover:border-gold hover:text-gold sm:px-2.5"
      onclick={reconnectNow}>Retry<span class="sr-only xs:not-sr-only"> now</span></button
    >
  {:else if state === 'paused'}
    <button
      type="button"
      class="rounded-full border border-line-strong px-2 py-1 text-xs text-ink hover:border-gold hover:text-gold sm:px-2.5"
      onclick={reconnectNow}>Resume<span class="sr-only"> live updates</span></button
    >
  {/if}
</div>
<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {live.announcement}
</div>
