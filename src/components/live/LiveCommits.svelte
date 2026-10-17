<!--
  @component
  Live workstation commits.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { GitCommit } from '../../shared/types';
  import { live, useClock, useLive } from '../../ui/live/store.svelte';
  import CommitList from '../CommitList.svelte';

  interface Props {
    initial: GitCommit[] | null;
    now: number;
    limit?: number;
    error?: string | null;
    retryHref?: string | null;
  }
  let { initial, now, limit, error = null, retryHref = null }: Props = $props();
  onMount(useLive);
  onMount(useClock);

  const repo = $derived(live.snapshot?.git.workstation ?? null);
  const commits = $derived(repo ? (repo.isRepo ? repo.commits : null) : initial);
  const repoError = $derived(
    repo
      ? (repo.error ?? (repo.isRepo ? null : 'The workstation is not a git repository.'))
      : error,
  );
</script>

<CommitList {commits} {now} {limit} error={repoError} {retryHref} label="Latest commits" />
