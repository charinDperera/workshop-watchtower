import { posix } from 'node:path';
import type { AgentDefinition } from '../../../shared/types';
import { splitFrontmatter, toOptionalString, toStringList } from './frontmatter';

/**
 * Parses `.claude/agents/<file>.md`. Malformed frontmatter is reported in `problems`;
 * the name falls back to the file name so the agent can still be joined to the roster.
 */
export function parseAgentDefinition(file: string, text: string): AgentDefinition {
  const fallbackName = posix.basename(file, '.md');
  const front = splitFrontmatter(text);
  const problems: string[] = [];

  if (!front.present) problems.push('No frontmatter');
  if (front.error) problems.push(front.error);

  const data = front.data ?? {};
  const name = toOptionalString(data.name);
  if (front.data && name === null) problems.push('Missing "name"');
  const description = toOptionalString(data.description);
  if (front.data && description === null) problems.push('Missing "description"');

  return {
    file,
    name: name ?? fallbackName,
    description,
    tools: toStringList(data.tools),
    skills: toStringList(data.skills),
    model: toOptionalString(data.model),
    problems,
  };
}
