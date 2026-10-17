/**
 * Deterministic sigils. Every agent, including new and retired ones, gets a seal drawn
 * from its name alone: a star polygon {points/step}, a ring of marks and the initial.
 * Same name, same sigil, on the server and in the browser.
 */

/** 32-bit FNV-1a hash of the lower-cased, trimmed name. */
export function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: a tiny seeded generator, so one hash yields a stream of choices. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Star polygons that read well at small sizes: [points, step]. */
const STARS: readonly (readonly [number, number])[] = [
  [5, 2],
  [6, 2],
  [7, 2],
  [7, 3],
  [8, 3],
  [9, 2],
  [9, 4],
  [10, 3],
  [12, 5],
];

/** Sigils are drawn in a 64 x 64 box centred on 32, 32. */
export const SIGIL_BOX = 64;
const C = SIGIL_BOX / 2;
const R_OUTER = 30;
const R_MARKS = 26.5;
const R_STAR = 21;
const R_CORE = 10.5;

const round = (n: number) => Math.round(n * 100) / 100;

function polar(radius: number, angle: number): [number, number] {
  return [round(C + radius * Math.cos(angle)), round(C + radius * Math.sin(angle))];
}

export interface SigilGeometry {
  initial: string;
  /** One closed path per sub-polygon of the star. */
  star: string;
  /** Small marks around the ring. */
  marks: { x: number; y: number; r: number }[];
  /** Dash pattern for the inner ring, or null for a solid ring. */
  ringDash: string | null;
  outer: number;
  core: number;
  centre: number;
}

export function sigilFor(name: string): SigilGeometry {
  const random = seeded(hashName(name));
  const [points, step] = STARS[Math.floor(random() * STARS.length)] ?? [5, 2];
  const rotation = -Math.PI / 2 + (Math.floor(random() * 4) * Math.PI) / (2 * points);

  // A {p/q} star with gcd(p, q) = d is d separate polygons of p/d vertices each.
  const d = gcd(points, step);
  const perPolygon = points / d;
  const paths: string[] = [];
  for (let offset = 0; offset < d; offset++) {
    const vertices: string[] = [];
    for (let k = 0; k < perPolygon; k++) {
      const index = offset + k * step;
      const [x, y] = polar(R_STAR, rotation + (2 * Math.PI * index) / points);
      vertices.push(`${k === 0 ? 'M' : 'L'}${x} ${y}`);
    }
    paths.push(`${vertices.join(' ')} Z`);
  }

  const markCount = [8, 12, 16, 24][Math.floor(random() * 4)] ?? 12;
  const emphasis = 1 + Math.floor(random() * 3); // every nth mark is larger
  const marks = Array.from({ length: markCount }, (_, i) => {
    const [x, y] = polar(R_MARKS, rotation + (2 * Math.PI * i) / markCount);
    return { x, y, r: i % emphasis === 0 ? 1.4 : 0.8 };
  });

  const dashes = [null, '2 2', '4 2', '1 3'] as const;
  const ringDash = dashes[Math.floor(random() * dashes.length)] ?? null;
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  return {
    initial,
    star: paths.join(' '),
    marks,
    ringDash,
    outer: R_OUTER,
    core: R_CORE,
    centre: C,
  };
}
