// A small seeded random source, so that a level, a test and a bug report can all be replayed exactly.
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** a number in [0, 1) */
    next,
    /** a number in [a, b) */
    range: (a, b) => a + (b - a) * next(),
    /** a whole number in [a, b] */
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    /** true with the given chance */
    chance: (p) => next() < p,
    /** one item of a list */
    pick: (list) => list[Math.floor(next() * list.length)],
    /** -1..1 */
    signed: () => next() * 2 - 1,
  };
}
