/**
 * Runtime configuration from the environment. The only setting is the workstation root:
 * `WATCHTOWER_ROOT`, defaulting to the folder two levels above the app (SPEC section 2).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_PACKAGE_NAME = 'watchtower';

/** Walks up from `start` to the folder holding this app's package.json. */
export function findAppDir(start: string): string | null {
  let dir = start;
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
        if (name === APP_PACKAGE_NAME) return dir;
      } catch {
        // Not our manifest; keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolves and validates the workstation root. Throws a clear error when the configured
 * root is not an existing directory, because nothing can work without it.
 */
export function resolveRoot(
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
): string {
  const fromEnv = env.WATCHTOWER_ROOT?.trim();
  let root: string;
  if (fromEnv) {
    root = isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
  } else {
    const appDir =
      findAppDir(dirname(fileURLToPath(moduleUrl))) ?? findAppDir(process.cwd()) ?? process.cwd();
    root = resolve(appDir, '..', '..');
  }
  let isDir: boolean;
  try {
    isDir = statSync(root).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`Workstation root is not a directory: ${root} (set WATCHTOWER_ROOT)`);
  }
  return root;
}
