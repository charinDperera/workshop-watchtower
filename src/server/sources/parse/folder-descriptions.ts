/**
 * What each workstation folder is for, from CLAUDE.md's folder tables: the Limforia wing
 * table (`| \`chronicles/\` | Records of archived chats and contexts |`) and the Realms
 * table (`| \`intel/\` | Uriel's research reports |`). Any table whose first cell is a single
 * backticked folder name counts; the first description of a folder wins.
 */
import { parseMarkdownTables } from './markdown-table';

const FOLDER_CELL = /^`([^`/\s]+)\/`$/;

/** Folder name -> description, in the order the tables list them. */
export function parseFolderDescriptions(markdown: string | null): Map<string, string> {
  const descriptions = new Map<string, string>();
  if (markdown === null) return descriptions;
  for (const table of parseMarkdownTables(markdown)) {
    const [first, second] = table.headers;
    if (first === undefined || second === undefined) continue;
    for (const row of table.rows) {
      const folder = FOLDER_CELL.exec((row[first] ?? '').trim())?.[1];
      const text = (row[second] ?? '').replace(/`/g, '').trim();
      if (folder && text !== '' && !descriptions.has(folder)) descriptions.set(folder, text);
    }
  }
  return descriptions;
}
