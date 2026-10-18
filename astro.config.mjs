// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { inlineScriptHashes } from './scripts/inline-script-hashes.mjs';
import { readDistDir } from './scripts/server-env.mjs';

// The Watchtower is local only (SPEC section 1). `server` applies to `astro dev`.
// Production runs through `scripts/start.mjs` (`pnpm start`), which owns the HTTP server: the
// adapter is in middleware mode, so the request guard and the security headers sit in front
// of every request, static files included, and the bind address is forced to 127.0.0.1 on
// the host (only container mode honours HOST). Never run `node dist/server/entry.mjs` directly.
//
// `security.csp`: Astro hashes the scripts and styles it emits and sends the policy as the
// `Content-Security-Policy` header of every on-demand page (not supported under `astro dev`).
// - No 'unsafe-inline' for scripts: `is:inline` scripts (the pre-paint theme script) are added
//   by hash, computed from the source (scripts/inline-script-hashes.mjs).
// - Styles: `<style>` elements and stylesheets stay restricted to 'self' and hashes. Only
//   `style=""` ATTRIBUTES are allowed inline (`style-src-attr`), because components render
//   server-computed widths (the compliance meter). Attributes cannot run script; the risk left
//   is CSS injection through an attribute, and those values are numbers.
export default defineConfig({
  output: 'server',
  // WATCHTOWER_DIST_DIR (default ./dist): the same parser start.mjs serves from.
  outDir: readDistDir(process.env),
  adapter: node({ mode: 'middleware' }),
  server: { host: '127.0.0.1', port: 4321 },
  integrations: [svelte()],
  session: false,
  // Records are rendered with marked (src/server/render/markdown.ts), never Astro markdown,
  // so Astro's highlighter is off. Shiki's inline styles would also clash with the CSP.
  markdown: { syntaxHighlight: false },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
      scriptDirective: {
        hashes: inlineScriptHashes(fileURLToPath(new URL('./src', import.meta.url))),
      },
      styleDirective: {
        resources: [{ resource: "'unsafe-inline'", kind: 'attribute' }],
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Never inline fonts as data: URIs: they must load from /_astro as 'self', because the
      // CSP keeps `font-src 'self'`. Other assets keep Vite's default limit (`undefined`).
      assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined),
    },
  },
});
