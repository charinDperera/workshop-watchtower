// Serves the built client assets (`dist/client`) for `scripts/start.mjs`. The adapter runs
// in middleware mode, which (as documented) serves no files, so this small handler does,
// behind the request guard. Dependency-free.
//
// Only plain files directly below the client folder are served: no directories, no dotfiles,
// no symlinks, nothing outside the folder. Anything else falls through to Astro.

import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

/** Content types for what an Astro build emits. Unknown types are sent as bytes. */
export const CONTENT_TYPES = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
});

/** Hashed build output under `/_astro/` never changes, so it may be cached for good. */
export const IMMUTABLE_PREFIX = '/_astro/';

/**
 * The file a URL path names inside `root`, or `null` when it cannot be a static file.
 * Lexical only; the caller still checks the file on disk.
 */
export function staticPathFor(root, urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\')) return null;
  const segments = pathname.split('/').slice(1);
  if (segments.some((s) => s === '' || s.startsWith('.'))) return null;
  const base = resolve(root);
  const file = resolve(base, ...segments);
  return file.startsWith(base + sep) ? file : null;
}

/**
 * Returns `serve(req, res)`, which answers GET and HEAD for a file under `root` and resolves
 * to `true`, or resolves to `false` so the caller can hand the request to Astro.
 */
export function createStaticHandler(root) {
  return async function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const urlPath = (req.url ?? '/').split(/[?#]/, 1)[0];
    const file = staticPathFor(root, urlPath);
    if (file === null) return false;
    let info;
    try {
      info = await lstat(file);
    } catch {
      return false;
    }
    if (!info.isFile()) return false;

    res.statusCode = 200;
    res.setHeader(
      'Content-Type',
      CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    );
    res.setHeader('Content-Length', String(info.size));
    res.setHeader(
      'Cache-Control',
      urlPath.startsWith(IMMUTABLE_PREFIX) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await new Promise((done) => {
      const stream = createReadStream(file);
      stream.on('error', (err) => {
        console.error(`[watchtower] cannot send ${urlPath}: ${err.message}`);
        res.destroy(err);
        done();
      });
      stream.on('end', done);
      stream.pipe(res);
    });
    return true;
  };
}
