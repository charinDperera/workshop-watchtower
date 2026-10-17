<!--
  @component
  The Council as an illuminated hierarchy. The Overseers stand at the top; a gilded spine
  descends from them to the Order of Work, whose stations hang from a gilded bar in order
  (Build, Test, Review, Ship, Record, then any station it does not know). The Counsel stand
  beside the spine, joined to it by a dashed branch: connected, but not on the workers' line.

  When the tree is wide enough for every worker side by side, the stations hang in a row from
  the bar; otherwise they stack as tiers down the spine, so at 360 px the tree reads as a
  vertical lineage. "Wide enough" is measured on the tree itself (a container query) against
  how many workers and stations there are, so seven stations or twelve both fit gracefully.

  Accessible structure: one heading per tier (and per station) and a list of members under
  each, every name a link to the agent's page. Every line and ornament is aria-hidden.
  Fully data-driven: any number of overseers, counsel, workers and stations.
-->
<script lang="ts">
  import type { Agent, PipelineStage } from '../shared/types';
  import { councilTiers, numeral, tierTitle } from '../ui/council';
  import CouncilMember from './CouncilMember.svelte';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import LoadingState from './LoadingState.svelte';

  interface Props {
    agents: Agent[] | null;
    /** The Order of Work, for the order of the stations. */
    stages: Pick<PipelineStage, 'id' | 'title'>[] | null;
    now: number;
    /** Heading level of the tiers; stations sit one level below. */
    level?: 2 | 3;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
  }
  let {
    agents,
    stages,
    now,
    level = 3,
    loading = false,
    error = null,
    retryHref = null,
  }: Props = $props();

  const uid = $props.id();
  const tiers = $derived(agents ? councilTiers(agents, stages ?? []) : null);
  const tierTag = $derived(`h${level}`);
  const stationTag = $derived(`h${level + 1}`);
  // Counsel alternate sides of the spine, the first on the right.
  const counselRight = $derived(tiers?.counsel.filter((_, i) => i % 2 === 0) ?? []);
  const counselLeft = $derived(tiers?.counsel.filter((_, i) => i % 2 === 1) ?? []);

  /*
   * Whether the stations can hang in one row from the gilded bar: each worker needs about
   * MEMBER_REM of width and each station's niche STATION_REM more. The tree picks the first
   * container width in ROW_STEPS that holds them (see the container queries below); narrower
   * trees set the niches as a wrapping arcade, and phones stack them down the spine.
   */
  const MEMBER_REM = 7.75;
  const STATION_REM = 1.25;
  const ROW_STEPS = [60, 70, 80, 90] as const;
  const fit = $derived.by(() => {
    if (!tiers) return 'arcade';
    const members = tiers.stations.reduce((n, s) => n + s.members.length, 0);
    const need = members * MEMBER_REM + tiers.stations.length * STATION_REM;
    const step = ROW_STEPS.findIndex((w) => need <= w);
    return step === -1 ? 'arcade' : `row-${step + 1}`;
  });
</script>

{#snippet caption(id: string, text: string)}
  <div class="flex items-center justify-center gap-3">
    <span class="h-px w-4 shrink-0 bg-gold/50 sm:w-10" aria-hidden="true"></span>
    <svelte:element
      this={tierTag}
      {id}
      class="font-sans text-xs font-bold tracking-caps whitespace-nowrap text-ink-faint uppercase"
    >
      {text}
    </svelte:element>
    <span class="h-px w-4 shrink-0 bg-gold/50 sm:w-10" aria-hidden="true"></span>
  </div>
{/snippet}

{#snippet counselSide(members: Agent[], side: 'left' | 'right')}
  <ul class="flex flex-col gap-6 {side === 'right' ? 'items-start' : 'items-end'}">
    {#each members as agent, i (`${agent.slug}-${i}`)}
      <li class="flex items-start {side === 'left' ? 'flex-row-reverse' : ''}">
        <span
          class="mt-14 w-4 shrink-0 border-t border-dashed border-gold/70 sm:mt-16 sm:w-10 lg:w-16"
          aria-hidden="true"
        ></span>
        <div class="w-32 sm:w-44"><CouncilMember {agent} {now} /></div>
      </li>
    {/each}
  </ul>
{/snippet}

{#if error && !agents}
  <ErrorState title="The Council could not be read" message={error} {retryHref} />
{:else if loading || !tiers}
  <LoadingState label="Loading The Council" rows={4} shape="cards" />
{:else if tiers.count === 0}
  <EmptyState
    title="The Council is empty"
    message="No agents are listed in ROSTER.md and no definitions were found in .claude/agents."
  />
{:else}
  <div class="council flex flex-col items-center" data-fit={fit}>
    {#if tiers.overseers.length > 0}
      <section aria-labelledby="{uid}-overseer" class="flex w-full flex-col items-center gap-2">
        {@render caption(`${uid}-overseer`, tierTitle('overseer', tiers.overseers.length))}
        <ul class="flex flex-wrap justify-center gap-x-10 gap-y-6">
          {#each tiers.overseers as agent, i (`${agent.slug}-${i}`)}
            <li class="w-64 max-w-full sm:w-80"><CouncilMember {agent} {now} /></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if tiers.counsel.length > 0}
      <section aria-labelledby="{uid}-counsel" class="council-counsel w-full">
        <!-- The spine runs down the middle column; the counsel stand to its sides. -->
        <div class="council-spine row-span-2" aria-hidden="true"></div>
        <div class="col-start-3 row-start-1 flex justify-start pt-4">
          <div class="pl-2 sm:pl-10 lg:pl-16">
            {@render caption(`${uid}-counsel`, tierTitle('counsel', tiers.counsel.length))}
          </div>
        </div>
        <div class="col-start-3 row-start-2 pb-4">{@render counselSide(counselRight, 'right')}</div>
        {#if counselLeft.length > 0}
          <div class="col-start-1 row-start-2 pb-4">{@render counselSide(counselLeft, 'left')}</div>
        {/if}
      </section>
    {:else if tiers.overseers.length > 0}
      <div class="council-spine h-10" aria-hidden="true"></div>
    {/if}

    {#if tiers.stations.length > 0}
      <section aria-labelledby="{uid}-work" class="flex w-full flex-col items-center">
        <div class="council-spine h-6" aria-hidden="true"></div>
        <div class="rounded-full border border-gold/50 bg-surface px-4 py-1.5">
          {@render caption(`${uid}-work`, 'The Order of Work')}
        </div>
        <div class="council-spine h-6" aria-hidden="true"></div>

        <ol class="council-stations w-full {fit}">
          {#each tiers.stations as station, i (station.key)}
            <li class="council-station" style="--members: {station.members.length}">
              <span class="council-bus" aria-hidden="true"></span>
              <span class="council-spine council-drop" aria-hidden="true"></span>
              <div class="council-niche">
                <div class="council-niche-head flex flex-col items-center gap-1">
                  <span
                    class="grid size-9 place-items-center rounded-full border border-gold/70 bg-surface text-sm font-bold text-gold"
                    aria-hidden="true"
                  >
                    {#if station.order !== null}{numeral(station.order)}{:else}✦{/if}
                  </span>
                  <svelte:element
                    this={stationTag}
                    id="{uid}-station-{i}"
                    class="text-lg font-bold text-ink"
                  >
                    {station.title}
                  </svelte:element>
                </div>
                <ul
                  class="council-members mt-3 flex flex-wrap justify-center gap-x-2 gap-y-6 sm:gap-x-4"
                  aria-labelledby="{uid}-station-{i}"
                >
                  {#each station.members as agent, j (`${agent.slug}-${j}`)}
                    <li class="council-member w-32 sm:w-44">
                      <CouncilMember {agent} {now} />
                    </li>
                  {/each}
                </ul>
              </div>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  </div>
{/if}

<style>
  /* A gilded line: the spine, the drops and the bar of the Order of Work. */
  .council-spine {
    width: 1px;
    margin-inline: auto;
    background-image: linear-gradient(
      to bottom,
      color-mix(in oklab, var(--color-gold) 75%, transparent),
      color-mix(in oklab, var(--color-gold) 45%, transparent)
    );
  }

  /* Counsel: three columns, the spine in the middle, members to either side. */
  .council-counsel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
    grid-template-rows: auto 1fr;
  }
  .council-counsel > .council-spine {
    grid-column: 2;
    grid-row: 1 / span 2;
    height: 100%;
  }

  /*
   * Each station is a niche with an arched head, the numeral set in the keystone. On phones
   * the niches stack down the spine, each hanging from a drop.
   */
  .council {
    container: council / inline-size;
  }
  .council-stations {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }
  .council-station {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }
  .council-drop {
    display: block;
    height: calc(var(--spacing) * 10);
  }
  .council-bus {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background-color: color-mix(in oklab, var(--color-gold) 55%, transparent);
  }
  .council-station:first-child > .council-bus {
    left: 50%;
  }
  .council-station:last-child > .council-bus {
    right: 50%;
  }
  .council-niche {
    padding: calc(var(--spacing) * 4) calc(var(--spacing) * 2) calc(var(--spacing) * 5);
    border: 1px solid color-mix(in oklab, var(--color-gold) 40%, transparent);
    border-radius: 50% 50% var(--radius-md) var(--radius-md) / calc(var(--spacing) * 14)
      calc(var(--spacing) * 14) var(--radius-md) var(--radius-md);
    background-image: linear-gradient(to bottom, var(--color-gold-soft), transparent 55%);
  }
  /* The numeral sits on the arch's apex. */
  .council-niche-head {
    margin-top: calc(var(--spacing) * -8.5);
  }
  .council-station:first-child > .council-drop {
    display: none;
  }

  /* A wider tree sets the niches as an arcade that wraps, row by row. */
  @container council (width >= 40rem) {
    .council-stations {
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      align-items: stretch;
      gap: calc(var(--spacing) * 12) calc(var(--spacing) * 4);
      padding-top: calc(var(--spacing) * 6);
    }
    .council-station {
      width: auto;
    }
    .council-drop {
      display: none;
    }
    .council-niche {
      height: 100%;
    }
  }

  /*
   * When every worker fits, the niches hang in one row from a single gilded bar, sized by
   * their members. The same rules at each of ROW_STEPS (the script), because a container
   * query cannot read data.
   */
  @container council (width >= 60rem) {
    .council-stations.row-1 {
      flex-wrap: nowrap;
      align-items: stretch;
      gap: 0;
    }
    .row-1 > .council-station {
      flex-grow: var(--members);
      flex-basis: 0;
      flex-shrink: 1;
      min-width: 0;
      padding-inline: calc(var(--spacing) * 1);
      padding-top: calc(var(--spacing) * 10);
    }
    .row-1 .council-drop {
      display: block;
      position: absolute;
      top: 0;
      left: 50%;
      height: calc(var(--spacing) * 6);
    }
    .row-1 .council-bus {
      display: block;
    }
    .row-1 .council-niche {
      height: 100%;
      padding-inline: calc(var(--spacing) * 1);
    }
    .row-1 .council-members {
      flex-wrap: nowrap;
      column-gap: calc(var(--spacing) * 1);
    }
    .row-1 .council-member {
      flex: 1 1 0;
      width: auto;
      min-width: 0;
      max-width: calc(var(--spacing) * 52);
    }
  }
  @container council (width >= 70rem) {
    .council-stations.row-2 {
      flex-wrap: nowrap;
      align-items: stretch;
      gap: 0;
    }
    .row-2 > .council-station {
      flex-grow: var(--members);
      flex-basis: 0;
      flex-shrink: 1;
      min-width: 0;
      padding-inline: calc(var(--spacing) * 1);
      padding-top: calc(var(--spacing) * 10);
    }
    .row-2 .council-drop {
      display: block;
      position: absolute;
      top: 0;
      left: 50%;
      height: calc(var(--spacing) * 6);
    }
    .row-2 .council-bus {
      display: block;
    }
    .row-2 .council-niche {
      height: 100%;
      padding-inline: calc(var(--spacing) * 1);
    }
    .row-2 .council-members {
      flex-wrap: nowrap;
      column-gap: calc(var(--spacing) * 1);
    }
    .row-2 .council-member {
      flex: 1 1 0;
      width: auto;
      min-width: 0;
      max-width: calc(var(--spacing) * 52);
    }
  }
  @container council (width >= 80rem) {
    .council-stations.row-3 {
      flex-wrap: nowrap;
      align-items: stretch;
      gap: 0;
    }
    .row-3 > .council-station {
      flex-grow: var(--members);
      flex-basis: 0;
      flex-shrink: 1;
      min-width: 0;
      padding-inline: calc(var(--spacing) * 1);
      padding-top: calc(var(--spacing) * 10);
    }
    .row-3 .council-drop {
      display: block;
      position: absolute;
      top: 0;
      left: 50%;
      height: calc(var(--spacing) * 6);
    }
    .row-3 .council-bus {
      display: block;
    }
    .row-3 .council-niche {
      height: 100%;
      padding-inline: calc(var(--spacing) * 1);
    }
    .row-3 .council-members {
      flex-wrap: nowrap;
      column-gap: calc(var(--spacing) * 1);
    }
    .row-3 .council-member {
      flex: 1 1 0;
      width: auto;
      min-width: 0;
      max-width: calc(var(--spacing) * 52);
    }
  }
  @container council (width >= 90rem) {
    .council-stations.row-4 {
      flex-wrap: nowrap;
      align-items: stretch;
      gap: 0;
    }
    .row-4 > .council-station {
      flex-grow: var(--members);
      flex-basis: 0;
      flex-shrink: 1;
      min-width: 0;
      padding-inline: calc(var(--spacing) * 1);
      padding-top: calc(var(--spacing) * 10);
    }
    .row-4 .council-drop {
      display: block;
      position: absolute;
      top: 0;
      left: 50%;
      height: calc(var(--spacing) * 6);
    }
    .row-4 .council-bus {
      display: block;
    }
    .row-4 .council-niche {
      height: 100%;
      padding-inline: calc(var(--spacing) * 1);
    }
    .row-4 .council-members {
      flex-wrap: nowrap;
      column-gap: calc(var(--spacing) * 1);
    }
    .row-4 .council-member {
      flex: 1 1 0;
      width: auto;
      min-width: 0;
      max-width: calc(var(--spacing) * 52);
    }
  }
</style>
