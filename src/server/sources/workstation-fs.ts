/**
 * Read-only access to a workstation root. Every path in and out is workstation-relative
 * with `/` separators. Missing files and folders are `null` / empty, never thrown.
 * This module never writes.
 */
import { existsSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface WorkstationFs {
  readonly root: string;
  /** UTF-8 contents, or `null` when the file does not exist or is not readable. */
  readText(relPath: string): Promise<string | null>;
  /** Every `*.md` file below `relDir`, recursively, sorted. Skips dot-folders and `node_modules`. */
  listMarkdown(relDir: string): Promise<string[]>;
  /** Names of the immediate sub-folders of `relDir`, sorted. Skips dot-folders. */
  listDirs(relDir: string): Promise<string[]>;
  exists(relPath: string): boolean;
  isFile(relPath: string): boolean;
  /** Absolute path for a workstation-relative path. */
  absolute(relPath: string): string;
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function createWorkstationFs(root: string): WorkstationFs {
  const absolute = (relPath: string) => join(root, ...relPath.split('/'));

  const readText = async (relPath: string): Promise<string | null> => {
    try {
      return await readFile(absolute(relPath), 'utf8');
    } catch (err) {
      if (isMissing(err)) return null;
      console.warn(`[watchtower] cannot read ${relPath}: ${(err as Error).message}`);
      return null;
    }
  };

  const listMarkdown = async (relDir: string): Promise<string[]> => {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(absolute(dir), { withFileTypes: true });
      } catch (err) {
        if (!isMissing(err))
          console.warn(`[watchtower] cannot list ${dir}: ${(err as Error).message}`);
        return;
      }
      for (const entry of entries) {
        const child = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') await walk(child);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          found.push(child);
        }
      }
    };
    await walk(relDir);
    return found.sort();
  };

  const listDirs = async (relDir: string): Promise<string[]> => {
    try {
      const entries = await readdir(absolute(relDir), { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch (err) {
      if (!isMissing(err))
        console.warn(`[watchtower] cannot list ${relDir}: ${(err as Error).message}`);
      return [];
    }
  };

  const isFile = (relPath: string): boolean => {
    try {
      return statSync(absolute(relPath)).isFile();
    } catch {
      return false;
    }
  };

  return {
    root,
    readText,
    listMarkdown,
    listDirs,
    exists: (relPath) => existsSync(absolute(relPath)),
    isFile,
    absolute,
  };
}
