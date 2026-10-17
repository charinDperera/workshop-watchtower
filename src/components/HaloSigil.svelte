<!--
  @component
  A sigil set for The Council. The rank sets the ornament: the Overseer stands in a radiance
  of gilded rays, the Counsel inside a dashed orbit, workers in the plain seal. While the
  agent is active a green halo breathes around the seal; under reduced motion it rests as a
  steady ring. Decorative throughout: the name and status are always written beside it.
-->
<script lang="ts">
  import type { Agent, AgentStatus } from '../shared/types';
  import Sigil from './Sigil.svelte';

  interface Props {
    name: string;
    status: AgentStatus;
    rank: Agent['rank'];
    /** `hero` is the agent page; the others are the tiers of the tree. */
    size?: 'hero' | 'tier';
  }
  let { name, status, rank, size = 'tier' }: Props = $props();

  const uid = $props.id();
  const active = $derived(status === 'active');

  /*
   * The frame (outer box) and the seal inside it, per rank and size. The Overseer's frame is
   * wider than the seal to hold the rays.
   */
  const FRAME = {
    overseer: { tier: 'size-52 sm:size-60', hero: 'size-48 sm:size-56' },
    counsel: { tier: 'size-28 sm:size-32', hero: 'size-36 sm:size-40' },
    worker: { tier: 'size-24 sm:size-28', hero: 'size-32 sm:size-36' },
  } as const;
  const SEAL = {
    overseer: { tier: 'size-28 sm:size-32', hero: 'size-26 sm:size-30' },
    counsel: { tier: 'size-22 sm:size-26', hero: 'size-28 sm:size-32' },
    worker: { tier: 'size-20 sm:size-24', hero: 'size-28 sm:size-32' },
  } as const;
  const frame = $derived(FRAME[rank][size]);
  const seal = $derived(SEAL[rank][size]);

  /* Rays in a 200 x 200 box around the centre: long and short, alternating. */
  const RAYS = 36;
  const INNER = 60;
  const round = (n: number) => Math.round(n * 100) / 100;
  const rays = Array.from({ length: RAYS }, (_, i) => {
    const angle = (2 * Math.PI * i) / RAYS - Math.PI / 2;
    const outer = i % 2 === 0 ? 99 : i % 4 === 1 ? 82 : 88;
    const half = i % 2 === 0 ? 0.03 : 0.02;
    const point = (r: number, a: number) =>
      `${round(100 + r * Math.cos(a))} ${round(100 + r * Math.sin(a))}`;
    return `M${point(INNER, angle - half)} L${point(outer, angle)} L${point(INNER, angle + half)} Z`;
  }).join(' ');
  const stars = Array.from({ length: 12 }, (_, i) => {
    const a = (2 * Math.PI * i) / 12 - Math.PI / 2 + Math.PI / 12;
    return { x: round(100 + 72 * Math.cos(a)), y: round(100 + 72 * Math.sin(a)) };
  });
</script>

<span
  class="relative inline-grid shrink-0 place-items-center {frame}"
  aria-hidden="true"
  data-rank={rank}
>
  {#if rank === 'overseer'}
    <svg
      class="absolute inset-0 size-full text-gold {status === 'retired' ? 'opacity-40' : ''}"
      viewBox="0 0 200 200"
      focusable="false"
    >
      <defs>
        <radialGradient id="rays-{uid}" gradientUnits="userSpaceOnUse" cx="100" cy="100" r="100">
          <stop offset="0.55" stop-color="currentColor" stop-opacity="0.95" />
          <stop offset="1" stop-color="currentColor" stop-opacity="0" />
        </radialGradient>
      </defs>
      <g class="origin-center animate-radiance">
        <path d={rays} fill="url(#rays-{uid})" />
      </g>
      <circle cx="100" cy="100" r="62" fill="none" stroke="currentColor" stroke-opacity="0.55" />
      <circle
        cx="100"
        cy="100"
        r="66.5"
        fill="none"
        stroke="currentColor"
        stroke-opacity="0.35"
        stroke-dasharray="1 3"
      />
      {#each stars as s (`${s.x}-${s.y}`)}
        <circle cx={s.x} cy={s.y} r="1.3" fill="currentColor" fill-opacity="0.8" />
      {/each}
    </svg>
  {/if}

  <span
    class="relative grid place-items-center rounded-full {seal} {rank === 'overseer'
      ? 'shadow-halo-gold'
      : ''}"
  >
    {#if rank === 'counsel'}
      <!-- Drawn past the seal's box (overflow visible), so the orbit rings it. -->
      <svg
        class="absolute inset-0 size-full overflow-visible text-gold"
        viewBox="0 0 100 100"
        focusable="false"
      >
        <circle
          cx="50"
          cy="50"
          r="60"
          fill="none"
          stroke="currentColor"
          stroke-opacity="0.7"
          stroke-width="0.8"
          stroke-dasharray="2 2.5"
        />
        <circle cx="50" cy="-10" r="2" fill="currentColor" />
        <circle cx="50" cy="110" r="2" fill="currentColor" />
      </svg>
    {/if}
    {#if active}
      <span class="absolute -inset-1 rounded-full shadow-halo-active"></span>
      <span class="absolute -inset-1 rounded-full border-2 border-active animate-halo"></span>
    {/if}
    <Sigil {name} {status} class="size-full" />
  </span>
</span>
