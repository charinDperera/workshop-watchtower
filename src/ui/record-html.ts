/**
 * Fits the safe HTML from `/api/record` into a page. Pure string transforms over the
 * sanitiser's output (whose tags are always well formed: source HTML is escaped), so they
 * run the same on the server and in the live viewer. Owner: Luka.
 *
 * - Headings move down so the page keeps a single h1 and a clean outline. The record's own
 *   first h1 is dropped when the viewer already shows the title.
 * - Tables and code blocks become focusable scroll regions (keyboard users can scroll them).
 * - Relative links to other `.md` records open in the archive viewer instead of 404ing.
 */
import { recordHref } from './labels';

export interface FitOptions {
  /** Workstation-relative path of the record, used to resolve relative links. */
  path: string;
  /** Levels to move every heading down (h1 + 1 = h2). Capped at h6. */
  shift?: number;
  /** Drop a leading h1 (the viewer shows the title itself). */
  dropTitle?: boolean;
}

const LEADING_H1 = /^\s*<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>\s*/;

export function shiftHeadings(html: string, shift: number): string {
  if (shift <= 0) return html;
  return html.replace(/<(\/?)h([1-6])(\s[^>]*)?>/g, (_m, close: string, level: string, rest) => {
    const next = Math.min(6, Number(level) + shift);
    return `<${close}h${next}${(rest as string | undefined) ?? ''}>`;
  });
}

export function wrapScrollRegions(html: string): string {
  return html
    .replace(
      /<table>/g,
      '<div class="prose-scroll" role="region" tabindex="0" aria-label="Table, scrolls sideways">\n<table>',
    )
    .replace(/<\/table>/g, '</table>\n</div>')
    .replace(/<pre>/g, '<pre tabindex="0">');
}

/** Resolves `a/../b.md` style paths; `null` when the result leaves the workstation. */
export function joinRecordPath(fromPath: string, href: string): string | null {
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const encodeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function rewriteRecordLinks(html: string, fromPath: string): string {
  return html.replace(/<a href="([^"]*)"/g, (match, raw: string) => {
    const href = decode(raw);
    // Absolute, scheme-relative, mail and in-page links stay as they are.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) {
      return match;
    }
    const [target = ''] = href.split('#');
    if (!target.toLowerCase().endsWith('.md')) return match;
    let path: string;
    try {
      path = decodeURIComponent(target);
    } catch {
      return match;
    }
    const resolved = joinRecordPath(fromPath, path);
    return resolved ? `<a href="${encodeAttr(recordHref(resolved))}"` : match;
  });
}

export function fitRecordHtml(html: string, { path, shift = 1, dropTitle = true }: FitOptions) {
  const body = dropTitle ? html.replace(LEADING_H1, '') : html;
  return wrapScrollRegions(rewriteRecordLinks(shiftHeadings(body, shift), path));
}
