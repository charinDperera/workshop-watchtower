/**
 * Peter's attack suite for the markdown sanitiser (src/server/render/markdown.ts) and for the
 * page-side transforms that run on its output (src/ui/record-html.ts). Every vector must come
 * out inert: no executable element, no event handler attribute, no script-capable URL.
 *
 * Raw HTML in a record is escaped (shown as text), so an attack string may survive as TEXT
 * (`&lt;a href="javascript:..."&gt;`). Text is inert: escaped text never holds a literal `<`,
 * so the URL and attribute checks run on the real tags only (`liveTags`).
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown, SANITIZE_OPTIONS } from '../../src/server/render/markdown';
import { fitRecordHtml } from '../../src/ui/record-html';

/** Tags that must never appear as real elements in the output. */
const DANGEROUS_TAGS =
  /<(script|iframe|frame|frameset|object|embed|svg|math|img|image|video|audio|source|style|link|meta|base|form|button|textarea|select|details|dialog|template|noscript|applet|marquee|isindex|xmp|plaintext)\b/i;
/** Any on* handler written as an attribute of a real tag. */
const HANDLER_ATTR = /<[a-z][^>]*\son[a-z]+\s*=/i;
/** Any attribute value with a script-capable or data scheme. */
const BAD_URL =
  /\s(href|src|action|formaction|xlink:href|srcset|poster|background)\s*=\s*"?\s*(javascript|vbscript|data|livescript):/i;
const STYLE_ATTR = /<[a-z][^>]*\sstyle\s*=/i;

/** The real elements in the output (escaped text has no literal `<`). */
function liveTags(html: string): string[] {
  return [...html.matchAll(/<[a-z][^>]*>/gi)].map((m) => m[0]);
}

function assertInert(html: string): void {
  expect(html).not.toMatch(DANGEROUS_TAGS);
  // Attribute values are data: strip them before looking for handler attributes.
  const tags = [...html.matchAll(/<[a-z][^>]*>/gi)].map((m) =>
    m[0].replace(/"[^"]*"|'[^']*'/g, '""'),
  );
  for (const tag of tags) {
    expect(tag).not.toMatch(HANDLER_ATTR);
    expect(tag).not.toMatch(STYLE_ATTR);
  }
  const live = liveTags(html).join('\n');
  expect(live).not.toMatch(BAD_URL);
  // Every href left must use an allowed scheme or be relative.
  for (const [, href] of live.matchAll(/\shref="([^"]*)"/g)) {
    const decoded = (href ?? '').replace(/&amp;/g, '&');
    expect(decoded).not.toMatch(/^\s*(?!https?:|mailto:)[a-z][a-z0-9+.-]*:/i);
    expect(decoded.startsWith('//')).toBe(false);
  }
}

const VECTORS: [string, string][] = [
  ['markdown javascript: link', '[x](javascript:alert(1))'],
  ['mixed-case scheme', '[x](JaVaScRiPt:alert(1))'],
  ['leading spaces in the URL', '[x](<  javascript:alert(1)>)'],
  ['decimal entity inside the scheme', '[x](java&#115;cript:alert(1))'],
  ['hex entity first letter', '[x](&#x6A;avascript:alert(1))'],
  ['entity without semicolon', '[x](&#106avascript:alert(1))'],
  ['tab entity inside the scheme', '[x](jav&#x09;ascript:alert(1))'],
  ['newline entity inside the scheme', '[x](jav&#10;ascript:alert(1))'],
  ['percent-encoded colon', '[x](javascript%3Aalert(1))'],
  ['vbscript link', '[x](vbscript:msgbox(1))'],
  ['data: HTML link', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ['data: image', '![x](data:image/svg+xml,<svg onload=alert(1)>)'],
  ['markdown image with onerror title', '![x](https://x.test/a.png "a\\" onerror=\\"alert(1)")'],
  ['reference-style javascript link', '[x][r]\n\n[r]: javascript:alert(1)'],
  ['autolink with javascript', '<javascript:alert(1)>'],
  ['raw anchor with javascript', '<a href="javascript:alert(1)">x</a>'],
  ['raw anchor with entity-split scheme', '<a href="jav&#x09;ascript:alert(1)">x</a>'],
  ['raw anchor with handler', '<a href="https://x.test" onmouseover="alert(1)">x</a>'],
  ['raw anchor with bare handler', '<a href="https://x.test" onclick>x</a>'],
  ['protocol-relative link', '<a href="//evil.test/x">x</a>'],
  ['markdown protocol-relative link', '[x](//evil.test/x)'],
  ['raw script', '<script>alert(1)</script>'],
  ['script split across a comment', '<scr<!-- -->ipt>alert(1)</script>'],
  ['raw img onerror', '<img src=x onerror=alert(1)>'],
  ['svg onload', '<svg onload=alert(1)><circle r="1"/></svg>'],
  ['svg with nested script', '<svg><script>alert(1)</script></svg>'],
  [
    'svg use with javascript href',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  ],
  ['iframe javascript', '<iframe src="javascript:alert(1)"></iframe>'],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object data', '<object data="javascript:alert(1)"></object>'],
  ['embed', '<embed src="data:text/html,<script>alert(1)</script>">'],
  ['html comment hiding a script', '<!--><script>alert(1)</script>-->'],
  ['conditional comment', '<!--[if IE]><script>alert(1)</script><![endif]-->'],
  ['comment that closes early', '<!-- --!><img src=x onerror=alert(1)> -->'],
  ['CDATA', '<![CDATA[<script>alert(1)</script>]]>'],
  ['style tag', '<style>body{background:url(javascript:alert(1))}</style>'],
  ['inline style', '<p style="background:url(javascript:alert(1))">x</p>'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ['base href', '<base href="javascript:alert(1)//">'],
  ['link stylesheet', '<link rel="stylesheet" href="javascript:alert(1)">'],
  ['form action', '<form action="javascript:alert(1)"><button>go</button></form>'],
  ['button formaction', '<button formaction="javascript:alert(1)">x</button>'],
  ['details ontoggle', '<details open ontoggle=alert(1)><summary>x</summary></details>'],
  ['math mXSS', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
  ['noscript mXSS', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  [
    'checkbox with handlers',
    '<input type="checkbox" onclick="alert(1)" autofocus onfocus="alert(1)">',
  ],
  ['image input', '<input type="image" src="x" onerror="alert(1)">'],
  ['text input', '<input type="text" value="x" onfocus="alert(1)" autofocus>'],
  ['code class injection', '<code class="language-js x" onmouseover="alert(1)">x</code>'],
  ['td with handler', '<table><tr><td onclick="alert(1)" align="left">x</td></tr></table>'],
  ['entity-encoded tag', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['double-encoded tag', '&amp;lt;script&amp;gt;alert(1)'],
  ['null byte in tag', '<scr\u0000ipt>alert(1)</script>'],
  ['unicode escape in scheme', '[x](javascript:alert(1))'],
  ['link title breaks out', '[x](https://x.test "t\\" onmouseover=\\"alert(1)")'],
  ['target and srcdoc attributes', '<a href="https://x.test" target="_blank" srcdoc="x">x</a>'],
];

describe('markdown sanitiser: XSS vectors', () => {
  it.each(VECTORS)('neutralises %s', (_name, source) => {
    const html = renderMarkdown(source);
    assertInert(html);
    // The same output fitted into a page must stay inert too.
    assertInert(fitRecordHtml(html, { path: 'limforia/chronicles/a.md' }));
  });

  it('drops the href (or the whole link) for every javascript: variant', () => {
    for (const source of [
      '[x](javascript:alert(1))',
      '[x](java&#115;cript:alert(1))',
      '[x](&#x6A;avascript:alert(1))',
      '<a href="jav&#x09;ascript:alert(1)">x</a>',
    ]) {
      const html = renderMarkdown(source);
      expect(liveTags(html).join('\n')).not.toMatch(/href="[^"]*script/i);
    }
  });

  it('keeps no unknown attributes on links and forces rel', () => {
    // Raw HTML is shown as text, so a raw anchor never becomes a link at all.
    const raw = renderMarkdown(
      '<a href="https://x.test" target="_blank" ping="https://t.test">x</a>',
    );
    expect(liveTags(raw).filter((tag) => tag.startsWith('<a'))).toEqual([]);
    expect(liveTags(raw).join('\n')).not.toMatch(/target=|ping=/);
    expect(renderMarkdown('[x](https://x.test "t")')).toContain('rel="noopener noreferrer"');
  });

  it('shows raw HTML as text, block and inline', () => {
    expect(renderMarkdown('<div><strong>x</strong></div>')).toBe(
      '&lt;div&gt;&lt;strong&gt;x&lt;/strong&gt;&lt;/div&gt;',
    );
    expect(renderMarkdown('a <em onclick="x">b</em> c')).toBe(
      // sanitize-html writes text quotes literally: inert, since this is text, not a tag.
      '<p>a &lt;em onclick="x"&gt;b&lt;/em&gt; c</p>\n',
    );
    // Markdown itself still renders, and code spans stay escaped once (not twice).
    expect(renderMarkdown('**b** and `<i>`')).toBe(
      '<p><strong>b</strong> and <code>&lt;i&gt;</code></p>\n',
    );
  });

  it('turns non-checkbox inputs into empty spans and disables checkboxes', () => {
    expect(renderMarkdown('<input type="text" value="x">')).not.toMatch(/<input/);
    const box = renderMarkdown('- [ ] task');
    expect(box).toMatch(/<input[^>]*disabled/);
  });

  it('allows only language-* classes on code', () => {
    const html = renderMarkdown('```js\nx\n```\n\n<code class="evil language-x">y</code>');
    expect(html).toContain('class="language-js"');
    expect(liveTags(html).join('\n')).not.toContain('evil');
  });

  it('allowlist has no tag that can run script or load a resource', () => {
    const allowed = SANITIZE_OPTIONS.allowedTags as string[];
    for (const tag of [
      'script',
      'iframe',
      'img',
      'svg',
      'style',
      'object',
      'embed',
      'form',
      'math',
    ]) {
      expect(allowed).not.toContain(tag);
    }
    expect(SANITIZE_OPTIONS.allowedSchemes).toEqual(['http', 'https', 'mailto']);
    expect(SANITIZE_OPTIONS.allowProtocolRelative).toBe(false);
  });
});

describe('record-html link rewriting on hostile input', () => {
  it('cannot be tricked into building an attribute break-out', () => {
    // An href whose decoded value contains quotes and ends in .md.
    const html = renderMarkdown('[x](a%22%20onmouseover=%22alert(1)%22%20x=%22.md)');
    const fitted = fitRecordHtml(html, { path: 'limforia/chronicles/a.md' });
    assertInert(fitted);
    expect(fitted).not.toMatch(/"\s*onmouseover/);
  });

  it('leaves a sanitised entity-encoded quote as data, never as markup', () => {
    const fitted = fitRecordHtml('<a href="a&quot; onclick=&quot;x.md">x</a>', {
      path: 'limforia/a.md',
    });
    expect(fitted).not.toMatch(/<a[^>]*\sonclick=/);
  });

  it('does not rewrite links that leave the workstation', () => {
    const fitted = fitRecordHtml('<a href="../../../../etc/x.md">x</a>', { path: 'limforia/a.md' });
    expect(fitted).toContain('href="../../../../etc/x.md"');
  });
});
