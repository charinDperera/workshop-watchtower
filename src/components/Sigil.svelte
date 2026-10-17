<!--
  @component
  A deterministic seal for an agent, drawn from the name alone (src/ui/sigil.ts), so new and
  retired agents get one too. Decorative: the name is always written next to it.
-->
<script lang="ts">
  import type { AgentStatus } from '../shared/types';
  import { SIGIL_BOX, sigilFor } from '../ui/sigil';

  interface Props {
    name: string;
    status?: AgentStatus;
    /** A neutral seal for an agent without a name (unattributed subagent events). */
    anonymous?: boolean;
    /** Tailwind size utility, e.g. `size-12`. */
    class?: string;
  }
  let { name, status = 'idle', anonymous = false, class: className = 'size-12' }: Props = $props();

  const g = $derived(sigilFor(name));
  const tone = $derived(
    status === 'retired' ? 'text-retired' : status === 'active' ? 'text-gold-strong' : 'text-gold',
  );
</script>

{#if anonymous}
  <svg
    class="{className} shrink-0 text-ink-faint"
    viewBox="0 0 {SIGIL_BOX} {SIGIL_BOX}"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      cx={SIGIL_BOX / 2}
      cy={SIGIL_BOX / 2}
      r="30"
      fill="var(--color-surface-sunken)"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-dasharray="3 3"
    />
    <text
      x={SIGIL_BOX / 2}
      y={SIGIL_BOX / 2}
      dy="0.36em"
      text-anchor="middle"
      fill="currentColor"
      font-family="var(--font-display)"
      font-weight="900"
      font-size="26">?</text
    >
  </svg>
{:else}
  <svg
    class="{className} {tone} shrink-0"
    viewBox="0 0 {SIGIL_BOX} {SIGIL_BOX}"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      cx={g.centre}
      cy={g.centre}
      r={g.outer}
      fill="var(--color-surface-sunken)"
      stroke="currentColor"
      stroke-width="1.25"
    />
    <circle
      cx={g.centre}
      cy={g.centre}
      r={g.outer - 6}
      fill="none"
      stroke="currentColor"
      stroke-opacity="0.45"
      stroke-width="0.75"
      stroke-dasharray={g.ringDash ?? undefined}
    />
    {#each g.marks as mark (`${mark.x}-${mark.y}`)}
      <circle cx={mark.x} cy={mark.y} r={mark.r} fill="currentColor" fill-opacity="0.8" />
    {/each}
    <path
      d={g.star}
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      stroke-opacity={status === 'retired' ? 0.5 : 0.85}
      stroke-linejoin="round"
    />
    <circle
      cx={g.centre}
      cy={g.centre}
      r={g.core}
      fill="var(--color-surface)"
      stroke="currentColor"
      stroke-width="1"
    />
    <text
      x={g.centre}
      y={g.centre}
      dy="0.36em"
      text-anchor="middle"
      fill="currentColor"
      font-family="var(--font-display)"
      font-weight="900"
      font-size="14">{g.initial}</text
    >
  </svg>
{/if}
