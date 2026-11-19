// Exposure that adapts (the second look; docs/DESIGN.md, "The second look").
//
// With a strong lamp in every space the site is no longer of one brightness: a yard under floods is ten times as
// bright as the passage that leads to it. A picture exposed for the one is black in the other, or white. So the
// exposure follows the place, as an eye does: stopped down in the light, opened up in the dark — and slowly,
// faster towards the light than towards the dark.
//
// It is NOT read off the picture. Reading a picture back from the graphics card stops the card, and some phones
// will not do it for a picture of this kind; and what the picture holds for a moment — a muzzle flash, a lamp's
// face — is not what an eye adapts to. The game already knows how much light there is at every cell of the map,
// by the lamps (world/build.js `probe`) and by the key lights with their shadows (`keyAt`). What the eye is
// looking at is taken to be: where it stands, and three places along its line of sight.
//
// Loop contract: `update` is called once a frame; the value it gives is always between `min` and `max`, and moves
// no faster than its two rates — unless told the eye has jumped (`snap`), when it is set, not crept.
// No three.js and no browser in here: test/unit/exposure.test.mjs pins it.

/** how far along the line of sight the light is asked for, in metres */
export const LOOKS = [4, 9, 16];
/** the light at which a picture is exposed as it always was: the yard by its own lamps, a room by its own */
export const MID = 0.6;

const TINT = { r: 0, g: 0, b: 0, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } }; // prettier-ignore
const HIT = {};

/**
 * How much light there is where the eye is looking, as one number.
 * @param {object} world   world/build.js: `grid`, `probe(x, z, colour)`, `keyAt(x, z)`
 * @param {{ x: number, y: number, z: number }} eye
 * @param {{ x: number, z: number }} forward the way it looks, on the map (need not be of length one)
 */
export function sceneLight(world, eye, forward) {
  const at = (x, z) => {
    world.probe(x, z, TINT);
    return TINT.r * 0.3 + TINT.g * 0.59 + TINT.b * 0.11 + world.keyAt(x, z);
  };
  const grid = world.grid;
  const here = at(eye.x, eye.z);
  const length = Math.hypot(forward.x, forward.z);
  if (length < 1e-6) return here;
  const fx = forward.x / length;
  const fz = forward.z / length;
  // how far the eye can see that way before a wall stops it
  const open = grid.raycast(eye.x, 1.5, eye.z, fx, 0, fz, LOOKS[LOOKS.length - 1], HIT) ? HIT.t : Infinity;
  let sum = 0;
  for (const far of LOOKS) {
    const d = Math.min(far, Math.max(0, open - 0.6));
    const x = eye.x + fx * d;
    const z = eye.z + fz * d;
    // a place that is off the map, or in the rock, has no light worked out for it: where the eye stands has
    sum +=
      grid.inside(Math.floor(x), Math.floor(z)) && !grid.solidAt(Math.floor(x), Math.floor(z), 1.5) ? at(x, z) : here;
  }
  return here * 0.3 + (sum / LOOKS.length) * 0.7;
}

/**
 * The exposure a place of a given brightness asks for: 1 at MID, less in more light, more in less — by the square
 * root, so that a bright place still looks brighter than a dark one, and held between `min` and `max`.
 */
export function exposureFor(light, { min = 0.62, max = 1.5 } = {}) {
  return Math.min(max, Math.max(min, Math.sqrt(MID / Math.max(light, 0.01))));
}

/**
 * @param {object} [o]
 * @param {number} [o.min=0.62]  the least the picture is ever exposed (in the middle of a flood)
 * @param {number} [o.max=1.5]   the most (in the dark)
 * @param {number} [o.down=2.2]  how fast it closes for more light: so much of the way a second
 * @param {number} [o.up=0.7]    how fast it opens for less
 */
export function createExposure({ min = 0.62, max = 1.5, down = 2.2, up = 0.7 } = {}) {
  const state = {
    value: 1,
    min,
    max,
    /**
     * @param {number} light sceneLight just now
     * @param {number} dt seconds since the last call
     * @param {boolean} [snap=false] the eye has jumped: set, do not creep
     * @returns {number} the exposure to draw this frame at
     */
    update(light, dt, snap = false) {
      const target = exposureFor(light, { min, max });
      if (snap || !(dt > 0)) {
        if (snap) state.value = target;
        return state.value;
      }
      const rate = target < state.value ? down : up;
      state.value += (target - state.value) * (1 - Math.exp(-rate * Math.min(dt, 0.25)));
      state.value = Math.min(max, Math.max(min, state.value));
      return state.value;
    },
  };
  return state;
}
