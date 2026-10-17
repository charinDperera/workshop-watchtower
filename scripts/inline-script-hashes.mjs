// CSP hashes for `<script is:inline>` blocks. Astro hashes the scripts it processes, but
// leaves `is:inline` scripts (such as the pre-paint theme script) to the project. Astro emits
// their content byte for byte, so hashing the source gives the exact hash the browser checks.
// Every `.astro` file under `src/` is scanned, so a new inline script needs no config change.
// Dependency-free; used by astro.config.mjs at build time.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const INLINE_SCRIPT = /<script\b[^>]*\bis:inline\b[^>]*>([\s\S]*?)<\/script>/g;

/** `sha256-…` of a script's exact text, as CSP expects. */
export function cspHash(text) {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
}

/** The text of every `<script is:inline>` in one `.astro` source. */
export function inlineScriptsOf(source) {
  return [...source.matchAll(INLINE_SCRIPT)].map((m) => m[1] ?? '');
}

function astroFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...astroFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.astro')) files.push(path);
  }
  return files.sort();
}

/** Unique hashes of every inline script below `srcDir`. */
export function inlineScriptHashes(srcDir) {
  const hashes = new Set();
  for (const file of astroFiles(srcDir)) {
    for (const script of inlineScriptsOf(readFileSync(file, 'utf8'))) hashes.add(cspHash(script));
  }
  return [...hashes];
}
