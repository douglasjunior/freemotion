/**
 * A deterministic pseudo-random number in [0, 1) for a given seed: the same seed gives the same
 * number in the studio, in every render tab and on every machine. Pass `null` to opt out and get
 * `Math.random()`.
 */
export function random(seed: string | number | null): number {
  if (seed === null) {
    return Math.random();
  }
  // FNV-1a hash of the seed, then one round of the mulberry32 mixer.
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  let t = (hash + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
