<!--
  @component
  The compliance checks. `full` lists every check with its findings; `summary` shows the
  pass / warning / fail tally and only the checks that need attention. `showServes` adds
  the law each check serves: only the Laws page, where the rules are read, sets it.
  Owner: Luka.
-->
<script lang="ts">
  import type { CheckResult, ComplianceSummary } from '../shared/types';
  import { CHECK_LABEL } from '../ui/format';
  import EmptyState from './EmptyState.svelte';
  import ErrorState from './ErrorState.svelte';
  import Icon from './Icon.svelte';
  import LoadingState from './LoadingState.svelte';

  interface Props {
    compliance: ComplianceSummary | null;
    variant?: 'summary' | 'full';
    loading?: boolean;
    error?: string | null;
    retryHref?: string | null;
    /** Heading level for each check title in the full variant. */
    level?: 2 | 3 | 4;
    /** Show the law each check serves. Off by default; the Laws page turns it on. */
    showServes?: boolean;
  }
  let {
    compliance,
    variant = 'full',
    loading = false,
    error = null,
    retryHref = null,
    level = 3,
    showServes = false,
  }: Props = $props();

  const ICON = { pass: 'check', warn: 'warn', fail: 'fail' } as const;
  const TONE: Record<CheckResult, string> = {
    pass: 'text-active',
    warn: 'text-warn',
    fail: 'text-fail',
  };
  const ROW: Record<CheckResult, string> = {
    pass: 'border-line',
    warn: 'border-warn/50 bg-warn-soft',
    fail: 'border-fail/60 bg-fail-soft',
  };

  const checks = $derived(compliance?.checks ?? []);
  const shown = $derived(
    variant === 'summary' ? checks.filter((c) => c.result !== 'pass') : checks,
  );
  const total = $derived(checks.length);
</script>

{#if error && !compliance}
  <ErrorState title="The compliance checks could not be run" message={error} {retryHref} />
{:else if loading || !compliance}
  <LoadingState label="Running the compliance checks" rows={4} />
{:else if total === 0}
  <EmptyState title="No checks" message="No compliance checks were reported." compact />
{:else}
  <div class="space-y-3">
    <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span class="flex items-center gap-1.5 text-active">
        <Icon name="check" class="size-4" />
        <span class="figure font-semibold">{compliance.pass}</span> passed
      </span>
      <span class="flex items-center gap-1.5 {compliance.warn ? 'text-warn' : 'text-ink-faint'}">
        <Icon name="warn" class="size-4" />
        <span class="figure font-semibold">{compliance.warn}</span>
        {compliance.warn === 1 ? 'warning' : 'warnings'}
      </span>
      <span class="flex items-center gap-1.5 {compliance.fail ? 'text-fail' : 'text-ink-faint'}">
        <Icon name="fail" class="size-4" />
        <span class="figure font-semibold">{compliance.fail}</span> failed
      </span>
    </p>

    <div
      class="flex h-1.5 overflow-hidden rounded-full bg-surface-2"
      role="img"
      aria-label="{compliance.pass} of {total} checks pass"
    >
      <span class="bg-active" style:width="{(compliance.pass / total) * 100}%"></span>
      <span class="bg-warn" style:width="{(compliance.warn / total) * 100}%"></span>
      <span class="bg-fail" style:width="{(compliance.fail / total) * 100}%"></span>
    </div>

    {#if shown.length === 0}
      <p class="text-sm text-ink-muted">Every law is kept. All {total} checks pass.</p>
    {:else}
      <ol class="space-y-2">
        {#each shown as check (check.id)}
          <li class="rounded-md border p-3 {ROW[check.result]}">
            <div class="flex items-start gap-2.5">
              <Icon name={ICON[check.result]} class="mt-0.5 size-5 shrink-0 {TONE[check.result]}" />
              <div class="min-w-0 flex-1">
                <svelte:element
                  this={variant === 'full' ? `h${level}` : 'p'}
                  class="font-sans text-sm font-semibold tracking-normal text-pretty text-ink"
                >
                  <span class="sr-only">{CHECK_LABEL[check.result]}:</span>
                  <span class="figure text-ink-faint" aria-hidden="true">{check.order}.</span>
                  {check.title}
                </svelte:element>
                <p class="text-xs text-ink-faint">
                  {#if showServes && check.serves}Serves {check.serves} ·{/if}
                  <span class={TONE[check.result]}>{CHECK_LABEL[check.result]}</span>
                </p>
                {#if check.details.length > 0}
                  <ul class="mt-2 space-y-1 text-sm text-ink-muted">
                    {#each check.details as detail, i (i)}
                      <li class="break-words">{detail}</li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
{/if}
