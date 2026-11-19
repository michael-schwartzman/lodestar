// The slide: run, drop, and go on along the floor — and whatever machine is in the way goes over. Rules only — no
// drawing and no browser in here; src/wild/slide-live.js joins them to the game — so it runs under `node --test`
// (test/unit/wild-slide.test.mjs).
//
// The wild branch's experiment (docs/WILD.md, "The slide"). Crouch asked for at a run does not stop the run: the
// body drops and is carried on, low, for three quarters of a second and four or five metres. It cannot be
// steered. A sentry in its way is knocked off its feet — helpless for a couple of seconds, as one stopped by an
// EMP is: it can be shut down by hand from any side, or taken by the uplink.
import { clamp01, lerp } from '../core/math.js';

export const SLIDE = {
  /** how long it lasts, in the player's own seconds */
  seconds: 0.75,
  /** metres a second the body must be going for its run to count as one (a run is 6.6, a walk 4.3) */
  from: 5,
  /** metres a second as it begins and as it ends: it is all let run off, none is added */
  speed: 8.8,
  end: 3.2,
  /** seconds after one ends before another can begin */
  rest: 0.6,
  /** how far a machine hears it, in metres (a walk is 3.5, a run 9) */
  noise: 6,
  /** what the field of view is multiplied by while it lasts */
  fov: 1.05,
  /** how much lower than a crouch the eye goes, in metres */
  low: 0.24,
  /**
   * a sentry in its way: within so many metres and ahead; stopped for so many seconds, and shoved so many metres
   * on along the slide
   */
  knock: { reach: 1.0, stun: 2.5, shove: 0.6 },
  /** it has met a wall when it is going slower than this much of what it should be */
  stopped: 0.35,
};

/** How fast it goes `t` seconds in: let run off slowly at first, then quickly. */
export const speedAt = (t) => lerp(SLIDE.speed, SLIDE.end, clamp01(t / SLIDE.seconds) ** 2);

/** How far the whole of it carries the body, in metres, with nothing in its way. */
export function slideLength(dt = 1 / 120) {
  let far = 0;
  for (let t = 0; t < SLIDE.seconds; t += dt) far += speedAt(t) * dt;
  return far;
}

/**
 * Whether one can begin: at a run and really going, the feet on the ground, the hands free — and the last one
 * rested from.
 * @param {{ running: boolean, speed: number, grounded: boolean, holding: boolean, alive: boolean, rest: number }} body
 *   rest: seconds still to go before another may begin
 */
export const canSlide = ({ running, speed, grounded, holding, alive, rest }) =>
  running && speed >= SLIDE.from && grounded && !holding && alive && rest <= 0;

/**
 * Whether something at (x, z) is in the way of a body at (px, pz) sliding along `dir` ([x, z], of length one):
 * within reach, and ahead of it rather than beside or behind.
 */
export function inTheWay(px, pz, dir, x, z) {
  const dx = x - px;
  const dz = z - pz;
  const d = Math.hypot(dx, dz);
  if (d > SLIDE.knock.reach) return false;
  return d < 1e-6 || (dx * dir[0] + dz * dir[1]) / d > 0.5;
}
