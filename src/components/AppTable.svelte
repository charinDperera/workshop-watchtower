<!--
  @component
  The apps under `apps/` and their repositories: a table on wide screens, a stack of
  cards on narrow ones (only one of the two is ever displayed, so assistive tech meets it
  once). State is always a word in a chip, never colour alone. Owner: Luka.
-->
<script lang="ts">
  import type { AppRepo } from '../shared/types';
  import { plural } from '../ui/format';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import Icon from './Icon.svelte';
  import LoadingState from './LoadingState.svelte';
  import RelativeTime from './RelativeTime.svelte';

  interface Props {
    apps: AppRepo[] | null;
    now: number;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
  }
  let { apps, now, loading = false, error = null, retryHref = null }: Props = $props();

  interface Chip {
    text: string;
    tone: string;
  }
  const repoChip = (app: AppRepo): Chip =>
    app.error
      ? { text: 'Unreadable', tone: 'border-fail/60 text-fail' }
      : app.isRepo
        ? { text: 'Own repo', tone: 'border-active/60 text-active' }
        : { text: 'No repo', tone: 'border-warn/60 text-warn' };
  const treeChip = (app: AppRepo): Chip =>
    !app.isRepo || app.dirty === null
      ? { text: 'Unknown', tone: '' }
      : app.dirty === 0
        ? { text: 'Clean', tone: 'border-active/60 text-active' }
        : { text: plural(app.dirty, 'change'), tone: 'border-warn/60 text-warn' };
</script>

{#snippet commit(app: AppRepo)}
  {#if app.lastCommit}
    <p class="text-sm break-words text-ink">{app.lastCommit.subject}</p>
    <p class="flex flex-wrap gap-x-2 text-xs text-ink-faint">
      <code class="text-gold" title={app.lastCommit.hash}>{app.lastCommit.shortHash}</code>
      <span>{app.lastCommit.author}</span>
      <RelativeTime datetime={app.lastCommit.date} {now} class="figure" />
    </p>
  {:else}
    <p class="text-sm text-ink-faint">{app.isRepo ? 'No commits yet' : 'Not a repository'}</p>
  {/if}
{/snippet}

{#snippet chip(c: Chip)}
  <span class="chip {c.tone}">{c.text}</span>
{/snippet}

{#if error && !apps}
  <ErrorState title="The apps could not be read" message={error} {retryHref} compact />
{:else if loading || !apps}
  <LoadingState label="Loading the apps" rows={3} />
{:else if apps.length === 0}
  <EmptyState
    title="No apps yet"
    message="Nothing has been built in apps/ yet."
    icon="tower"
    compact
  />
{:else}
  <div class="hidden md:block">
    <table class="w-full border-collapse text-left text-sm">
      <caption class="sr-only">Apps in apps/ and the state of their repositories</caption>
      <thead>
        <tr class="border-b border-line-strong text-xs text-ink-faint">
          <th scope="col" class="py-2 pr-4 font-semibold">App</th>
          <th scope="col" class="py-2 pr-4 font-semibold">Repository</th>
          <th scope="col" class="py-2 pr-4 font-semibold">Branch</th>
          <th scope="col" class="py-2 pr-4 font-semibold">Last commit</th>
          <th scope="col" class="py-2 font-semibold">Working tree</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        {#each apps as app (app.path)}
          <tr class="align-top">
            <th scope="row" class="py-3 pr-4 font-normal">
              <span class="block font-display text-md font-semibold text-ink">{app.name}</span>
              <code class="text-xs text-ink-faint">{app.path}</code>
            </th>
            <td class="py-3 pr-4">
              {@render chip(repoChip(app))}
              {#if app.error}
                <p class="mt-1 max-w-56 text-xs break-words text-ink-muted">{app.error}</p>
              {/if}
            </td>
            <td class="py-3 pr-4">
              {#if app.branch}
                <span class="inline-flex items-center gap-1.5 font-mono text-xs text-ink">
                  <Icon name="branch" class="size-3.5 text-gold" />{app.branch}
                </span>
              {:else}
                <span class="text-xs text-ink-faint">{app.isRepo ? 'Detached' : '—'}</span>
              {/if}
            </td>
            <td class="min-w-0 py-3 pr-4">{@render commit(app)}</td>
            <td class="py-3">{@render chip(treeChip(app))}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <ul class="flex flex-col gap-3 md:hidden" aria-label="Apps">
    {#each apps as app (app.path)}
      <li class="rounded-md border border-line bg-surface-2 p-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="font-display text-md font-semibold text-ink">{app.name}</p>
            <code class="text-xs break-all text-ink-faint">{app.path}</code>
          </div>
          {@render chip(repoChip(app))}
        </div>
        {#if app.error}
          <p class="mt-2 text-xs break-words text-ink-muted">{app.error}</p>
        {/if}
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt class="text-ink-faint">Branch</dt>
          <dd class="min-w-0 font-mono text-xs break-all text-ink">
            {app.branch ?? (app.isRepo ? 'Detached' : '—')}
          </dd>
          <dt class="text-ink-faint">Tree</dt>
          <dd>{@render chip(treeChip(app))}</dd>
          <dt class="text-ink-faint">Last</dt>
          <dd class="min-w-0">{@render commit(app)}</dd>
        </dl>
      </li>
    {/each}
  </ul>
{/if}
