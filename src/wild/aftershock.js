// Aftershocks: once the cascades are gone the mountain does not hold still. When the next one comes and how hard
// it is. Rules only — no drawing, no sound and no browser in here; src/wild/aftershock-live.js joins them to the
// game — so it runs under `node --test` (test/unit/wild-aftershock.test.mjs).
//
// The wild build (docs/WILD.md, "Aftershocks"). The owner, 17 November 2026: "make things even wilder". Until
// then the charges went off, the hall burned, and the rest of the site stood as if nothing had happened to the
// rock it is cut into; the run out was a clock and a corridor. Now the hall goes on tearing itself apart behind
// you: the floor jumps, dust comes down off the roof, something else goes up in the hall — seldom at first, and
// faster and harder as the strike you called comes nearer. It hurts nobody. It is the mountain telling you to run.
import { clamp, lerp } from '../core/math.js';

export const AFTERSHOCK = {
  /** seconds after the cascades go before the first: the blast has the floor to itself */
  first: 6,
  /** seconds between two: when nothing presses, and when the strike is a moment away */
  gap: [11, 2.6],
  /** …give or take this part of itself, so that they cannot be counted in */
  jitter: 0.25,
  /** how hard one is, 0 … 1: when nothing presses, and at the last */
  strength: [0.35, 1],
  /** how pressed things are before the lodestar is up, 0 … 1 (after it: by the clock) */
  idle: 0.15,
  /** how much the camera is rattled: by the weakest there could be, and by the hardest (0.2 is a near miss) */
  shake: [0.06, 0.34],
  /** falls of dust off the roof: for the weakest, and for the hardest */
  falls: [2, 7],
  /** …and how near the player they come down, and how far off, in metres */
  ring: [2.5, 10],
  /** from this strength up, something in the hall goes off as well */
  secondary: 0.7,
};

/**
 * How pressed things are, 0 … 1 — or null: the cascades still stand, and the mountain is still.
 * @param {object} m the mission
 * @param {boolean} m.blown the cascades are gone
 * @param {string} m.phase
 * @param {number} m.clock seconds to the strike, once the lodestar is up
 * @param {number} clock0 what the clock stood at when the lodestar went up
 */
export function urgency(m, clock0) {
  if (!m || !m.blown) return null;
  if (m.phase !== 'exfil') return AFTERSHOCK.idle;
  return clamp(1 - m.clock / Math.max(1, clock0), AFTERSHOCK.idle, 1);
}

/** (a small generator of its own, so that a mission's aftershocks are the same every time it is given the same seed) */
function next(a) {
  a.seed = (a.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a.seed ^ (a.seed >>> 15), 1 | a.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** @returns {{ seed: number, wait: number, count: number }} seconds to the next one, and how many there have been */
export function createAftershock(seed = 1) {
  return { seed: seed | 0 || 1, wait: AFTERSHOCK.first, count: 0 };
}

/**
 * A step of the mountain: null, or the aftershock that comes now —
 *   strength  0 … 1
 *   shake     what the camera is rattled by
 *   falls     where dust comes down, each [dx, dz] from the player in metres
 *   secondary something in the hall goes off as well
 * @param {number} u how pressed things are (`urgency`): null and nothing comes, nor does the wait run
 */
export function stepAftershock(a, dt, u) {
  if (u === null) return null;
  a.wait -= dt;
  if (a.wait > 0) return null;
  const A = AFTERSHOCK;
  a.count++;
  a.wait = lerp(A.gap[0], A.gap[1], u) * (1 + A.jitter * (2 * next(a) - 1));
  const strength = clamp(lerp(A.strength[0], A.strength[1], u) * (0.85 + 0.25 * next(a)), 0, 1);
  const falls = [];
  const n = Math.round(lerp(A.falls[0], A.falls[1], strength));
  for (let i = 0; i < n; i++) {
    const turn = next(a) * Math.PI * 2;
    const far = lerp(A.ring[0], A.ring[1], next(a));
    falls.push([Math.sin(turn) * far, Math.cos(turn) * far]);
  }
  // (the camera is rattled by the square of how hard it is: the early ones are felt, the last ones are meant)
  return {
    strength,
    shake: lerp(A.shake[0], A.shake[1], strength * strength),
    falls,
    secondary: strength >= A.secondary,
  };
}
