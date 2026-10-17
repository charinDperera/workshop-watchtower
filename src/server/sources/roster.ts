/** The main agent's slug from the workstation's roster (the first Overseer). */
import { PATHS } from '../constants';
import { findMainSlug } from '../services/agents';
import { parseRoster } from './parse/registers';
import type { WorkstationFs } from './workstation-fs';

export async function readMainSlug(fs: WorkstationFs): Promise<string> {
  return findMainSlug(parseRoster(await fs.readText(PATHS.roster)).items);
}
