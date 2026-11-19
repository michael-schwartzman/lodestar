// A fallen machine is something the others can find — and something that can be dragged out of their sight.
// No drawing and no browser: pinned by test/unit/bodies.test.mjs.
//
// Decision of 16 November 2026 — the owner: "make the robots smarter, when they see a friend of their that died
// they need to trigger the site alarm you can add a feature where you can drag and hide the body so it won't be
// seen". Until then a machine that saw another go down came to look, and that was all it did; a wreck lying in
// the middle of a patrol's round meant nothing to the patrol.
//
// Now: a machine that has a fallen one in sight for a second knows what it is looking at, and raises the alarm —
// a machine's alarm, counted against the grade as one that found the player is. It sees a wreck as it sees the
// player: within reach of its eye, inside its cone, along a clear line — and how far that reach is goes by the
// LIGHT the wreck lies in, so that the dark hides a wreck as it hides the player (and a lamp shot out hides both).
// A wreck that went down while the alarm was already sounding, or in the blast, is no news to anybody; and the
// wrecks a retry clears away cannot be found at all.
// And a wreck can be taken hold of and dragged — into the dark, behind a container, into a room nobody walks.
import { angleDelta, clamp01, turnTowards, yawTo } from '../core/math.js';
import { moveBody } from '../world/collide.js';

export const BODY = {
  /** how far off a machine sees a fallen machine that lies in full light, in metres (on Operator) */
  view: 16,
  /** …and how much of that is left for one that lies in the pitch dark */
  dark: 0.25,
  /** how long it must have it in sight, unbroken, before it knows what it is looking at (seconds) */
  notice: 1,
  /** how high off the floor what is seen lies: where the line of sight is drawn to */
  height: 0.4,
  /** nearer than this a machine knows a wreck whichever way it faces: it is standing on it */
  underfoot: 1.6,
  /** dragging: how near the middle of a wreck must be to be taken hold of (m), and how squarely it must be faced */
  reach: 1.9,
  facing: 1.2,
  /** the hand has it by the collar, and where a wreck "is" is its feet: they follow this far behind the hand */
  rope: 2,
  /** a wreck that snags on a corner is let go of once the hand is this many rope lengths from it */
  snap: 1.6,
  /** how wide it is to a wall, how long a sentry lies, and how fast its head comes round to the hand (rad/s) */
  radius: 0.3,
  length: 1.75,
  turn: 5,
};

/**
 * How far off a fallen machine is seen, in metres.
 * @param {number} light how well lit the place it lies in is: 0 the dark … 1 under a lamp
 * @param {number} [setting=1] the setting's own stretch of it (difficulty.js `bodies`)
 */
export const bodyView = (light, setting = 1) => BODY.view * setting * (BODY.dark + (1 - BODY.dark) * clamp01(light));

/**
 * Can this machine see that wreck?
 * @param {{ x: number, z: number, eye: number, facing: number, cone: number }} unit where its eye is, which way it
 *   is looking (its body's turn and its head's), and how wide it sees either side of that
 * @param {{ x: number, z: number }} body
 * @param {number} light how well lit the place the wreck lies in is, 0 … 1
 * @param {(ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean} clear is the line
 *   between two points open? (world/grid.js `sight`)
 */
export function seesBody(unit, body, light, clear, setting = 1) {
  const d = Math.hypot(body.x - unit.x, body.z - unit.z);
  if (d > bodyView(light, setting)) return false;
  if (d > BODY.underfoot && Math.abs(angleDelta(unit.facing, yawTo(unit.x, unit.z, body.x, body.z))) > unit.cone)
    return false;
  return clear(unit.x, unit.eye, unit.z, body.x, BODY.height, body.z);
}

/** A fallen machine that can still be found: it lies where it fell, and nobody knows of it yet. */
export const findable = (unit) => unit.dead === true && !unit.gone && !unit.found;

/**
 * A tick of one wreck. `seen`: some machine has it in sight just now. Returns true on the tick it is FOUND — once.
 * `body.noticeT` is how long it has been looked at without a break; a glance away and it begins again.
 */
export function stepBody(body, seen, dt) {
  if (body.found) return false;
  body.noticeT = seen ? (body.noticeT || 0) + dt : 0;
  if (body.noticeT < BODY.notice - 1e-9) return false;
  body.found = true;
  return true;
}

/** Where the middle of a wreck is: a sentry falls forward and lies its own length from its feet; a drone is small. */
export function middleOf(unit) {
  if (unit.type !== 'sentry') return [unit.x, unit.z];
  const half = BODY.length * 0.5;
  return [unit.x - Math.sin(unit.yaw) * half, unit.z - Math.cos(unit.yaw) * half];
}

/**
 * A frame of dragging. The wreck follows the hand like a load on a rope: when the hand is further off than the
 * rope is long it is pulled after, along the floor, round whatever is in the way — never through it — and its
 * head comes round to the hand.
 * @param {{ x: number, z: number, yaw: number, type: string }} body changed in place
 * @param {{ x: number, z: number }} hand where the player stands
 * @returns {boolean} false if it has snagged and the hand has gone on without it: it is to be let go of
 */
export function haul(grid, body, hand, dt) {
  const rope = body.type === 'drone' ? BODY.rope * 0.5 : BODY.rope;
  let dx = hand.x - body.x;
  let dz = hand.z - body.z;
  let d = Math.hypot(dx, dz);
  if (d > rope) {
    moveBody(grid, body, (dx / d) * (d - rope), (dz / d) * (d - rope), BODY.radius);
    dx = hand.x - body.x;
    dz = hand.z - body.z;
    d = Math.hypot(dx, dz);
  }
  if (d > 0.2) body.yaw = turnTowards(body.yaw, yawTo(body.x, body.z, hand.x, hand.z), BODY.turn * dt);
  return d <= rope * BODY.snap;
}
