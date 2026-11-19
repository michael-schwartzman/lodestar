// A thrown magnet: LODESTONE, as rules. No drawing and no browser in here — src/wild/lodestone-live.js joins
// them to the game — so it runs under `node --test` (test/unit/wild-lodestone.test.mjs).
//
// The wild branch's experiment (docs/WILD.md, "The lodestone").
//
// 17 November 2026 — the owner, of the previous build: "the lodge stone doesn't seem to do anything fix it".
// It bounced off the first thing it hit and rolled away; cover any crate's height hid a machine behind it from
// the other half of a pair; thrown at real range it overshot by metres. This file is the rebuild: it STICKS
// where it lands (or CLAMPS straight onto a machine it flies close to), WAKES once, holds everything it can
// reach for a fixed few seconds, then CRUSHES the lot by how close each one got — see docs/WILD-lodestone.md.
//
// LOOP CONTRACT (test/unit/wild-lodestone.test.mjs holds every clause of this):
//   thrown → in flight for at most `flightMax` seconds → stuck (the first solid thing it meets, or clamped onto
//   a machine passed close to in flight, or simply out of time) → awake exactly `wakeDelay` seconds later →
//   awake for exactly `awake` seconds → gone.
//   'wake' fires exactly once per stone and 'crush' fires exactly once per stone, however long a single step()
//   is — a huge dt must not skip either, and must not repeat either.
//   Everything the stone is holding when it goes is let go of (stunT released to decay) before the stone itself
//   is removed: never a machine left frozen with nothing left holding it.
//   Never more than LODESTONE.carry stones alive in the world at once, independent of how many are carried as
//   ammunition (a cache taken while that many are already in the air must not allow a fourth).
//   A mission that ends, or begins again, leaves no stone behind and nothing still `carried`.
import { clamp01, damp, lerp } from '../core/math.js';

export const LODESTONE = {
  /** carried at the start of a mission, from each ammunition cache, and the most ever carried at once */
  start: 2,
  cache: 1,
  carry: 3,

  // thrown exactly like the EMP grenade (src/weapon.js, src/arms.js ARMS.grenades): same speed, same gravity,
  // same size for what it cannot pass through. Copied as plain numbers — arms.js is not on the short list of
  // what this file may import. Unlike the grenade it does not bounce: see stepFlight below.
  speed: 13,
  gravity: 12,
  radius: 0.06,

  /** it wakes at the very latest this long after leaving the hand, wherever it then is */
  flightMax: 1.6,
  /** ...and otherwise this long after it sticks or clamps */
  wakeDelay: 0.35,
  /** seconds the field holds, once woken */
  awake: 2.6,

  /** the field, once awake: a running machine this far off or nearer is taken, given a line to it (or see close) */
  reach: 10,
  /** within this many metres no line is needed at all — the EMP grenade's own rule (src/arms.js ARMS.grenades.close) */
  close: 3,
  /** in flight, close enough to CLAMP onto a machine outright: horizontal for one on its feet, full 3D for a drone */
  clamp: 0.9,
  clampDrone: 0.8,

  /** a held machine is dragged to within this of the stone, never past it */
  stop: 1.0,
  /** how fast (m/s) the drag runs once fully eased in */
  pullSpeedMax: 9,
  /** seconds to ease the drag in from nought, so nothing is snapped at full speed the instant it is taken */
  pullEase: 0.3,

  /** a drone held is drawn down to about this height, at this rate (core/math.js damp: exact, no overshoot) */
  waistY: 1.1,
  dropRate: 3,

  /** the crush: damage at crushNear metres or nearer, falling in a straight line to crushFarDamage at `reach` */
  crushNear: 1.5,
  crushNearDamage: 130,
  crushFarDamage: 50,
  /** a survivor let go of is left stunned this much longer, to decay by itself (an existing convention) */
  releaseStun: 0.8,
  /** how far the crush is heard (G.enemies.noise) */
  noiseRadius: 20,
};

/** @returns {{ count: number, stones: object[] }} how many are carried, and every stone alive in the world */
export function createLodestone() {
  return { count: LODESTONE.start, stones: [] };
}

/** A mission begins, or the title is shown: counted back to the start, every stone gone from the world. */
export function resetLodestone(state) {
  state.count = LODESTONE.start;
  state.stones.length = 0;
}

/** An ammunition cache: one more carried, never more than LODESTONE.carry. */
export function gainLodestone(state, amount = LODESTONE.cache) {
  state.count = Math.min(LODESTONE.carry, state.count + amount);
}

/** The forward and right of the eye (src/weapon.js eyeAxes — only what a throw needs of it). */
function eyeAxes(player) {
  const cp = Math.cos(player.pitch);
  return {
    fx: -Math.sin(player.yaw) * cp,
    fy: Math.sin(player.pitch),
    fz: -Math.cos(player.yaw) * cp,
    rx: Math.cos(player.yaw),
    rz: -Math.sin(player.yaw),
  };
}

/** Whether a lodestone may be thrown right now: one carried, room for it in the world, hands free, alive. */
export function canThrowLodestone(state, player) {
  return state.count > 0 && state.stones.length < LODESTONE.carry && !!player.alive && !player.holding;
}

/**
 * Throws one lodestone from the eye, exactly as the EMP grenade leaves the hand (src/weapon.js stepLob): the
 * same spawn offset (out of the left hand, unless that is inside a wall, when it leaves from the head instead
 * — which never is), the same velocity, a little up. `solidAt(cellX, cellZ, y0, y1)` is the grid's own; unit
 * tests fake it, the live wiring passes `G.world.grid.solidAt`.
 * @returns {object|null} the stone thrown, or null if it could not be (see canThrowLodestone)
 */
export function throwLodestone(state, player, solidAt) {
  if (!canThrowLodestone(state, player)) return null;
  const { fx, fy, fz, rx, rz } = eyeAxes(player);
  const hx = player.headX ?? player.x;
  const hz = player.headZ ?? player.z;
  let x = hx + fx * 0.45 - rx * 0.18;
  const y = player.eye - 0.12 + fy * 0.45;
  let z = hz + fz * 0.45 - rz * 0.18;
  if (solidAt(Math.floor(x), Math.floor(z), y - 0.06, y + 0.06)) {
    x = hx;
    z = hz;
  }
  const stone = {
    x,
    y,
    z,
    vx: fx * LODESTONE.speed + (player.vx || 0),
    vy: fy * LODESTONE.speed + 2.6,
    vz: fz * LODESTONE.speed + (player.vz || 0),
    t: 0,
    stuck: false,
    stuckAt: 0,
    awake: false,
  };
  state.count--;
  state.stones.push(stone);
  return stone;
}

/**
 * Freezes a stone exactly where it is — the same effect as flying into something solid — for the one case this
 * module cannot see for itself (it knows nothing of machines): the live wiring calls this the instant its own
 * scan finds one within clamping distance, still in flight. No-op once a stone is already stuck.
 */
export function stickLodestone(stone, x = stone.x, y = stone.y, z = stone.z) {
  if (stone.stuck) return false;
  stone.x = x;
  stone.y = y;
  stone.z = z;
  stone.vx = stone.vy = stone.vz = 0;
  stone.stuck = true;
  stone.stuckAt = stone.t;
  return true;
}

/**
 * Whether a stone still in flight is, right now, close enough to clamp onto `machine` ({x, y, z, flying}): within
 * `clampDrone` metres in full 3D of a drone wherever it is in the air, or within `clamp` metres horizontally of a
 * sentry while the stone is somewhere between the floor and 1.9 m (a sentry's own height). Purely the geometry —
 * the live wiring is the one that knows which machines exist, and whether each may be taken at all (not held as
 * a shield, flown, turned, or already clamped by another stone).
 */
export function clamps(stone, machine) {
  if (machine.flying) {
    return Math.hypot(stone.x - machine.x, stone.y - machine.y, stone.z - machine.z) <= LODESTONE.clampDrone;
  }
  if (stone.y < 0 || stone.y > 1.9) return false;
  return Math.hypot(stone.x - machine.x, stone.z - machine.z) <= LODESTONE.clamp;
}

/**
 * Whether a machine at (ux, uy, uz) is, once the field is awake, within its reach — and either close enough
 * (`close`) that no line is needed at all, just as the EMP grenade asks nothing of what is next to it, or in
 * clear sight of it from whichever is higher of 1.4 m above the floor or the stone's own height (so cover lower
 * than about 1.3 m no longer hides anything — a wall still does). `sight(ax, ay, az, bx, by, bz)` is the grid's
 * own (G.world.grid.sight); unit tests fake it.
 */
export function inField(stone, ux, uy, uz, sight) {
  const d3 = Math.hypot(ux - stone.x, uy - stone.y, uz - stone.z);
  if (d3 > LODESTONE.reach) return false;
  if (d3 <= LODESTONE.close) return true;
  const eyeY = Math.max(1.4, stone.y);
  return sight(stone.x, eyeY, stone.z, ux, uy, uz);
}

/**
 * One stone's flight: falls, and sticks dead on the first solid thing it meets — no bounce — sub-stepped so it
 * cannot pass through a wall one cell thick in a single step.
 */
function stepFlight(stone, dt, solidAt) {
  if (stone.stuck) return;
  const R = LODESTONE.radius;
  const STEP = 0.02;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(left, STEP);
    const vy = stone.vy - LODESTONE.gravity * h;
    const nx = stone.x + stone.vx * h;
    const nz = stone.z + stone.vz * h;
    const ny = stone.y + vy * h;
    const wallX = solidAt(Math.floor(nx), Math.floor(stone.z), stone.y - R, stone.y + R);
    const wallZ = !wallX && solidAt(Math.floor(stone.x), Math.floor(nz), stone.y - R, stone.y + R);
    const floor = ny < R;
    const ceiling = !floor && solidAt(Math.floor(stone.x), Math.floor(stone.z), ny - R, ny + R);
    if (wallX || wallZ || floor || ceiling) {
      // it stops dead, exactly where it was a moment ago — on the floor alone, at the floor's own height; on a
      // wall or a casing, whatever height it had reached when it met it
      if (floor && !wallX && !wallZ && !ceiling) stone.y = R;
      stone.vx = stone.vy = stone.vz = 0;
      stone.stuck = true;
      stone.stuckAt = stone.t + (dt - left);
      return;
    }
    stone.x = nx;
    stone.z = nz;
    stone.y = ny;
    stone.vy = vy;
    left -= h;
  }
}

/**
 * One step of every stone alive: its flight, and its clock. See the loop contract above the LODESTONE constant.
 * @returns {{type: 'wake'|'crush', stone: object}[]} what happened, in order
 */
export function stepLodestone(state, dt, solidAt) {
  const events = [];
  for (const stone of state.stones) {
    stepFlight(stone, dt, solidAt);
    stone.t += dt;
    if (!stone.stuck && stone.t >= LODESTONE.flightMax) {
      // however long it has had, it goes no further: wherever it is becomes where it stuck
      stone.vx = stone.vy = stone.vz = 0;
      stone.stuck = true;
      stone.stuckAt = LODESTONE.flightMax;
    }
    if (!stone.stuck) continue;
    const wakeAt = stone.stuckAt + LODESTONE.wakeDelay;
    if (!stone.awake && stone.t >= wakeAt) {
      stone.awake = true;
      events.push({ type: 'wake', stone });
    }
    if (stone.awake && stone.t >= wakeAt + LODESTONE.awake) {
      events.push({ type: 'crush', stone });
      stone.gone = true;
    }
  }
  for (let i = state.stones.length - 1; i >= 0; i--) if (state.stones[i].gone) state.stones.splice(i, 1);
  return events;
}

/**
 * How fast (m/s) the field drags something it has taken, `heldFor` seconds after it was: eased in from nought
 * up to `pullSpeedMax` over `pullEase` seconds, so nothing is snapped at full speed the instant it is taken.
 */
export function pullSpeed(heldFor) {
  return LODESTONE.pullSpeedMax * clamp01(heldFor / LODESTONE.pullEase);
}

/**
 * How far (metres, never negative) to move a held machine this tick, `d` metres from the stone, `heldFor`
 * seconds after it was taken: the eased speed for `dt` — but never further than the room left before the stop
 * line, however big `dt` is. This is what keeps the pull from ever overshooting, at any frame rate.
 */
export function pullStep(heldFor, d, dt) {
  const room = Math.max(0, d - LODESTONE.stop);
  return Math.min(pullSpeed(heldFor) * Math.max(0, dt), room);
}

/** A drone's height, drawn down towards about waist height while held (core/math.js damp: exact, no overshoot,
 * the same whatever the frame rate). The live wiring uses the same call, with `b` back at its own height, to
 * climb back once let go. */
export function pullDroneY(y, dt) {
  return damp(y, LODESTONE.waistY, LODESTONE.dropRate, dt);
}

/**
 * The crush's damage at distance `d` (metres) from the stone when the awake seconds run out: crushNearDamage
 * at crushNear metres or nearer, falling in a straight line to crushFarDamage at `reach` itself — nothing was
 * ever held further off than that.
 */
export function crushDamage(d) {
  if (d <= LODESTONE.crushNear) return LODESTONE.crushNearDamage;
  if (d >= LODESTONE.reach) return LODESTONE.crushFarDamage;
  const t = (d - LODESTONE.crushNear) / (LODESTONE.reach - LODESTONE.crushNear);
  return lerp(LODESTONE.crushNearDamage, LODESTONE.crushFarDamage, clamp01(t));
}
