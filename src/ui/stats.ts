/** The headline figures on the Overview, derived from a snapshot. Pure. */
import type { Snapshot } from '../shared/types';
import { TEMPLATES_WING } from '../shared/wings';
import type { Tone } from './format';
import { plural } from './format';

export interface Tile {
  id: string;
  label: string;
  value: string | number | null;
  hint: string | null;
  href: string | null;
  tone: Tone;
}

export function overviewTiles(snapshot: Snapshot): Tile[] {
  const agents = snapshot.agents.filter((a) => a.status !== 'retired');
  const active = agents.filter((a) => a.status === 'active');
  const strikes = agents.reduce((sum, a) => sum + (a.strikes ?? 0), 0);
  const struck = agents.filter((a) => (a.strikes ?? 0) > 0).map((a) => a.name);
  const records = snapshot.records.filter((r) => !r.isTemplate).length;
  const wingsInUse = snapshot.wings.filter((w) => w.id !== TEMPLATES_WING && w.count > 0).length;
  const { pass, warn, fail, checks } = snapshot.compliance;
  const repo = snapshot.git.workstation;

  return [
    {
      id: 'active',
      label: 'Active now',
      value: `${active.length} / ${agents.length}`,
      hint: active.length ? active.map((a) => a.name).join(', ') : 'All quiet',
      href: '/host',
      tone: active.length ? 'active' : 'neutral',
    },
    {
      id: 'strikes',
      label: 'Strikes',
      value: strikes,
      hint: struck.length ? `On ${struck.join(', ')}` : 'A clean record',
      href: '/host',
      tone: agents.some((a) => (a.strikes ?? 0) >= a.strikeLimit)
        ? 'fail'
        : strikes
          ? 'warn'
          : 'neutral',
    },
    {
      id: 'records',
      label: 'Records',
      value: records,
      hint: `Across ${plural(wingsInUse, 'wing')}`,
      href: '/limforia',
      tone: 'gold',
    },
    {
      id: 'laws',
      label: 'Laws kept',
      value: `${pass} / ${checks.length}`,
      hint: fail ? plural(fail, 'failure') : warn ? plural(warn, 'warning') : 'Every check passes',
      href: '/laws',
      tone: fail ? 'fail' : warn ? 'warn' : 'active',
    },
    {
      id: 'tree',
      label: 'Working tree',
      value: !repo.isRepo ? null : repo.dirty === 0 ? 'Clean' : repo.dirty,
      hint: !repo.isRepo
        ? 'Not a git repository'
        : `${repo.dirty ? `${plural(repo.dirty, 'change')} on ` : 'On '}${repo.branch ?? 'a detached head'}`,
      href: '/git',
      tone: !repo.isRepo || repo.error ? 'fail' : repo.dirty ? 'warn' : 'active',
    },
  ];
}
