// What every piece of site furniture takes up on the ground.
//
// The world is a grid of one-metre cells. A prop stands on `w` cells across (X) by `d` cells deep (Z) when it is
// not turned; a quarter turn swaps the two. `h` is how tall the model is. `block` is how high it stops movement,
// sight and bullets (0: you walk straight through it — overhead pipes, lamps on walls). `thin` props stop movement
// but never sight or bullets (a lamp post, a lattice tower). `stand` props have a flat top at `block` that you can
// jump onto and stand on; everything else stops you however high you are.
//
// src/gfx/propModels.js builds a model for every kind listed here, sized to fit its box.
export const PROPS = {
  crate: { w: 1, d: 1, h: 1.0, block: 1.0, stand: true },
  crateTall: { w: 1, d: 1, h: 2.0, block: 2.0, stand: true },
  barrel: { w: 1, d: 1, h: 0.95, block: 0.95, stand: true },
  barrier: { w: 2, d: 1, h: 0.9, block: 0.9, stand: true },
  pallet: { w: 1, d: 1, h: 0.16, block: 0 },
  container: { w: 6, d: 2, h: 2.6, block: 2.6, stand: true },
  truck: { w: 3, d: 7, h: 3.0, block: 3.0 },
  forklift: { w: 2, d: 3, h: 2.1, block: 2.1 },
  generator: { w: 3, d: 2, h: 1.8, block: 1.8 },
  transformer: { w: 2, d: 2, h: 2.4, block: 2.4 },
  tank: { w: 2, d: 2, h: 3.4, block: 3.4 },
  cylinder: { w: 3, d: 1, h: 1.25, block: 1.25 },
  console: { w: 2, d: 1, h: 1.15, block: 1.15 },
  rack: { w: 1, d: 1, h: 2.1, block: 2.1 },
  switchgear: { w: 2, d: 1, h: 2.3, block: 2.3 },
  locker: { w: 2, d: 1, h: 1.9, block: 1.9 },
  desk: { w: 2, d: 1, h: 0.78, block: 0.78, stand: true },
  rock: { w: 2, d: 2, h: 1.7, block: 1.7 },
  lampPost: { w: 1, d: 1, h: 6.0, block: 6.0, thin: true },
  tower: { w: 3, d: 3, h: 9.0, block: 9.0, thin: true },
  ventStack: { w: 3, d: 3, h: 26.0, block: 26.0 },
  pipeRun: { w: 4, d: 1, h: 3.7, block: 0 },
  ceilingLight: { w: 1, d: 1, h: 0.14, block: 0 },
  wallLight: { w: 1, d: 1, h: 0.3, block: 0 },
  roofUnit: { w: 3, d: 2, h: 1.4, block: 1.4 },
  dish: { w: 2, d: 2, h: 2.6, block: 2.6 },
};

/** The cells a prop covers, as [width along X, depth along Z], for a number of quarter turns. */
export function footprint(kind, turns = 0) {
  const spec = PROPS[kind];
  if (!spec) throw new Error(`unknown prop: ${kind}`);
  return turns % 2 ? [spec.d, spec.w] : [spec.w, spec.d];
}
