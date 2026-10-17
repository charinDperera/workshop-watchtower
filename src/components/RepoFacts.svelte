<!--
  @component
  The workstation repository at a glance: branch, upstream, commits ahead and the working
  tree, as stat tiles. Owner: Luka.
-->
<script lang="ts">
  import type { RepoState } from '../shared/types';
  import { plural, type Tone } from '../ui/format';
  import ErrorState from './ErrorState.svelte';
  import StatTile from './StatTile.svelte';

  interface Props {
    repo: RepoState | null;
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
  }
  let { repo, loading = false, error = null, retryHref = null }: Props = $props();

  interface Fact {
    label: string;
    value: string | number | null;
    hint: string | null;
    tone: Tone;
  }

  const facts = $derived.by((): Fact[] | null => {
    if (!repo || !repo.isRepo) return null;
    const { upstream, ahead } = repo;
    const head = repo.commits[0];
    return [
      {
        label: 'Branch',
        value: repo.branch ?? 'Detached',
        hint: head ? `HEAD at ${head.shortHash}` : 'No commits yet',
        tone: repo.branch ? 'gold' : 'warn',
      },
      {
        label: 'Upstream',
        value: upstream ?? 'None',
        hint: upstream ? 'The remote branch it tracks' : 'Not tracking a remote branch',
        tone: 'neutral',
      },
      {
        label: 'Ahead',
        value: ahead,
        hint:
          ahead === null
            ? upstream
              ? 'Could not be compared'
              : 'Nothing to compare without an upstream'
            : ahead === 0
              ? 'Level with the upstream'
              : `${plural(ahead, 'commit')} not yet pushed`,
        tone: ahead ? 'info' : 'neutral',
      },
      {
        label: 'Working tree',
        value: repo.dirty === null ? null : repo.dirty === 0 ? 'Clean' : repo.dirty,
        hint:
          repo.dirty === null
            ? 'Could not be read'
            : repo.dirty === 0
              ? 'Nothing uncommitted'
              : `${plural(repo.dirty, 'uncommitted change')}`,
        tone: repo.dirty === null ? 'neutral' : repo.dirty === 0 ? 'active' : 'warn',
      },
    ];
  });
  const problem = $derived(
    repo
      ? (repo.error ?? (repo.isRepo ? null : 'The workstation is not a git repository.'))
      : error,
  );
</script>

{#if problem && !facts}
  <ErrorState title="The workstation repository could not be read" message={problem} {retryHref} />
{:else if loading || !facts}
  <ul class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="The workstation repository">
    {#each ['Branch', 'Upstream', 'Ahead', 'Working tree'] as label (label)}
      <li><StatTile {label} value={null} loading /></li>
    {/each}
  </ul>
{:else}
  <div class="flex flex-col gap-3">
    {#if problem}
      <ErrorState title="Part of git could not be read" message={problem} compact />
    {/if}
    <ul class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="The workstation repository">
      {#each facts as fact (fact.label)}
        <li class="min-w-0">
          <StatTile label={fact.label} value={fact.value} hint={fact.hint} tone={fact.tone} />
        </li>
      {/each}
    </ul>
  </div>
{/if}
