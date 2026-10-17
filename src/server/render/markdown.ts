/**
 * Markdown to safe HTML, in two layers. First, `marked` renders with every raw HTML block
 * and inline tag ESCAPED (records are markdown; raw HTML is shown as text, never rendered).
 * Second, `sanitize-html` enforces an explicit allowlist over marked's own output.
 * No images, no inline styles, no event handlers, and only http(s)/mailto/relative links.
 */
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  // Block HTML and inline tags both arrive here: show them as text.
  renderer: { html: ({ text }) => escapeHtml(text) },
});

export const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'blockquote',
    'ul',
    'ol',
    'li',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'input',
  ],
  allowedAttributes: {
    // rel is set by the transform below; source HTML is already escaped by marked.
    a: ['href', 'title', 'rel'],
    th: ['align'],
    td: ['align'],
    ol: ['start'],
    code: ['class'],
    input: ['type', 'checked', 'disabled'],
  },
  allowedClasses: { code: [/^language-[\w-]+$/] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'escape',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer' },
    }),
    input: (tagName, attribs) =>
      attribs.type === 'checkbox'
        ? { tagName, attribs: { ...attribs, disabled: '' } }
        : { tagName: 'span', attribs: {} },
  },
};

export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false });
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
