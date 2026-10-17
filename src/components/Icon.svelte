<!--
  @component
  The icon set: simple 24 x 24 line icons drawn in currentColor. Decorative by default
  (aria-hidden); pass `label` when the icon alone carries meaning.
-->
<script lang="ts" module>
  export type IconName =
    | 'check'
    | 'warn'
    | 'fail'
    | 'arrow-right'
    | 'arrow-down'
    | 'sun'
    | 'moon'
    | 'star'
    | 'scroll'
    | 'tower'
    | 'refresh'
    | 'branch'
    | 'commit'
    | 'feather'
    | 'empty';
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    /** Accessible name. Omit for decorative icons. */
    label?: string;
    class?: string;
  }
  let { name, label, class: className = 'size-4' }: Props = $props();
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {#if name === 'check'}
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16.5 9.5" />
  {:else if name === 'warn'}
    <path d="M12 3.5 21 19.5H3Z" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17" r="0.4" fill="currentColor" />
  {:else if name === 'fail'}
    <path d="M8.2 3.5h7.6l5.7 5.7v5.6l-5.7 5.7H8.2l-5.7-5.7V9.2Z" />
    <path d="m9.5 9.5 5 5m0-5-5 5" />
  {:else if name === 'arrow-right'}
    <path d="M4 12h15m-5-5 5 5-5 5" />
  {:else if name === 'arrow-down'}
    <path d="M12 4v15m-5-5 5 5 5-5" />
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4" />
    <path
      d="M12 2.5v2m0 15v2M2.5 12h2m15 0h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"
    />
  {:else if name === 'moon'}
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />
    <path d="M16.5 3.5v3m-1.5-1.5h3" />
  {:else if name === 'star'}
    <path d="m12 3 2.1 6.2H21l-5.5 4 2.1 6.3L12 15.6l-5.6 3.9 2.1-6.3L3 9.2h6.9Z" />
  {:else if name === 'scroll'}
    <path d="M7 4h11a2 2 0 0 1 0 4h-1v10a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h1V6a2 2 0 0 1 0-2Z" />
    <path d="M10 9h4m-4 3.5h4" />
  {:else if name === 'tower'}
    <path d="M9 21V10l3-3 3 3v11M7.5 21h9M12 7V4.5" />
    <path d="M10.5 13h3" />
    <circle cx="12" cy="3" r="0.9" fill="currentColor" />
  {:else if name === 'refresh'}
    <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8" />
    <path d="M4 4v4.5h4.5M20 20v-4.5h-4.5" />
  {:else if name === 'branch'}
    <circle cx="6" cy="5.5" r="2" />
    <circle cx="6" cy="18.5" r="2" />
    <circle cx="18" cy="7.5" r="2" />
    <path d="M6 7.5v9M18 9.5c0 4-6 3-11 7" />
  {:else if name === 'commit'}
    <circle cx="12" cy="12" r="3.5" />
    <path d="M3 12h5.5m7 0H21" />
  {:else if name === 'feather'}
    <path d="M20 4c-7 0-13 5-13 12v4M7 16h6.5M10 11.5h6" />
    <path d="M20 4c0 8-4.5 12-13 12" />
  {:else if name === 'empty'}
    <circle cx="12" cy="12" r="8.5" stroke-dasharray="2.2 2.6" />
    <path d="m12 8.5 1 2.4 2.5.2-1.9 1.6.6 2.5-2.2-1.4-2.2 1.4.6-2.5-1.9-1.6 2.5-.2Z" />
  {/if}
</svg>
