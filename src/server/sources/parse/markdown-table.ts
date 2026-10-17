/**
 * Minimal GitHub-style markdown table parser for the workstation's registers
 * (ROSTER, Soul Binder, Catalog). Pure: text in, data out.
 */

export interface MarkdownTable {
  /** The nearest preceding `## ` heading, or `null` when the table has none. */
  section: string | null;
  headers: string[];
  /** Data rows keyed by header. Placeholder rows (`| — | — |`) are dropped. */
  rows: Record<string, string>[];
}

const SEPARATOR_CELL = /^:?-{3,}:?$/;
/** Cells that mean "nothing here" in the registers. */
const EMPTY_CELL = /^(?:—|–|-|)$/;

/** Splits one `| a | b |` line into trimmed cells. Honours `\|` escapes. */
export function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith('|');
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

/** True when every cell is a placeholder such as `—`. */
export function isPlaceholderRow(cells: string[]): boolean {
  return cells.every((cell) => EMPTY_CELL.test(cell));
}

/** Parses every table in a markdown document, in order. */
export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let section: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) section = heading[1];

    const next = lines[i + 1];
    if (isTableLine(line) && next !== undefined && isSeparatorRow(splitRow(next))) {
      const headers = splitRow(line);
      const rows: Record<string, string>[] = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i] ?? '')) {
        const cells = splitRow(lines[i] ?? '');
        if (!isPlaceholderRow(cells)) {
          const row: Record<string, string> = {};
          headers.forEach((header, index) => {
            row[header] = cells[index] ?? '';
          });
          rows.push(row);
        }
        i += 1;
      }
      tables.push({ section, headers, rows });
      continue;
    }
    i += 1;
  }
  return tables;
}

/** Returns the first table whose headers include every name given (case-insensitive). */
export function findTable(
  tables: MarkdownTable[],
  requiredHeaders: string[],
): MarkdownTable | undefined {
  const wanted = requiredHeaders.map((h) => h.toLowerCase());
  return tables.find((table) => {
    const have = table.headers.map((h) => h.toLowerCase());
    return wanted.every((h) => have.includes(h));
  });
}

/** Reads a cell by header name, case-insensitively. */
export function cell(row: Record<string, string>, header: string): string {
  const key = Object.keys(row).find((k) => k.toLowerCase() === header.toLowerCase());
  return key === undefined ? '' : (row[key] ?? '');
}

export interface MarkdownLink {
  text: string;
  href: string;
}

/** Extracts `[text](href)` links from a cell. */
export function extractLinks(text: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const pattern = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(pattern)) {
    links.push({ text: match[1] ?? '', href: match[2] ?? '' });
  }
  return links;
}
