import { parse as parseYaml } from 'yaml';

/** Result of splitting a markdown file into its YAML header and body. Never throws. */
export interface FrontmatterResult {
  /** True when the file starts with a `---` fence. */
  present: boolean;
  /** Parsed mapping, or `null` when absent, unterminated, invalid YAML or not a mapping. */
  data: Record<string, unknown> | null;
  /** The markdown after the header (the whole text when there is no header). */
  body: string;
  /** Why `data` is `null` although a header is present. */
  error: string | null;
}

const OPEN_FENCE = /^---[ \t]*\r?\n/;
const CLOSE_FENCE = /^---[ \t]*$/m;

export function splitFrontmatter(text: string): FrontmatterResult {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const open = OPEN_FENCE.exec(source);
  if (!open) return { present: false, data: null, body: source, error: null };

  const rest = source.slice(open[0].length);
  const close = CLOSE_FENCE.exec(rest);
  if (!close) {
    return { present: true, data: null, body: source, error: 'Header has no closing ---' };
  }

  const yamlText = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length).replace(/^\r?\n/, '');

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { present: true, data: null, body, error: `Invalid YAML: ${message}` };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { present: true, data: null, body, error: 'Header is not a key/value mapping' };
  }
  return { present: true, data: parsed as Record<string, unknown>, body, error: null };
}

/** Normalises a YAML value that should be a list of strings (`[a, b]` or `a, b`). */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v).trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/** Normalises a YAML scalar to a trimmed string, or `null`. */
export function toOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}
