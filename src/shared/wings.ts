/** Wing display names, shared by the server (snapshot) and the client (record lists). */

const SMALL_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on', 'for', 'to']);

/**
 * A wing's display name from its folder name: words split on `-` or `_`, capitalised,
 * small words lower-case unless first (`vault-of-ideas` -> `Vault of Ideas`).
 */
export function wingTitle(id: string): string {
  const words = id.split(/[-_]+/).filter((w) => w !== '');
  if (words.length === 0) return id;
  return words
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** A well-formed wing id (a folder name): used to validate `?wing=` before matching. */
export function isWingId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}
