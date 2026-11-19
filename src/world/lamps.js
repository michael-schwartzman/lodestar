// Lamps that can be put out: which are out, for how long, what a round meets, and what an EMP reaches.
//
// Decision of 16 November 2026 — the owner: "i want to have the ability to shoot at the light to turn it off …
// also emp needs to turn of the light in a room". A lamp that is SHOT is out for the rest of the mission; lamps an
// EMP TRIPS are out for a while and come back by themselves; the moon is neither. This file is the rules of that
// and nothing else: it keeps no picture and works out no light. world/build.js (the site's own lamps) and
// look/keylight.js (the second look's key lights) are told which lamps changed and do the rest; main.js joins
// them. Pinned by test/unit/lamps.test.mjs. No three.js and no browser in here.
import { KIND } from './grid.js';

/**
 * Where a ray enters a box: the distance along it, 0 if it starts inside, −1 if it misses or the box is further
 * off than `max`. The ray's direction need not be of length one — the answer is in its own units.
 * @param {number[]} box x0, y0, z0, x1, y1, z1
 */
export function rayBox(box, ox, oy, oz, dx, dy, dz, max) {
  let near = 0;
  let far = max;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = box[axis];
    const hi = box[axis + 3];
    if (Math.abs(d) < 1e-12) {
      // along this face: inside the slab all the way, or never
      if (o < lo || o > hi) return -1;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    if (a > near) near = a;
    if (b < far) far = b;
    if (near > far) return -1;
  }
  return near;
}

/**
 * The site's own lamps (world/map.js `lamps`) as this file wants them: where each hangs, the zone it hangs in,
 * whether that is under a built ceiling (a room) or in the open cavern, and whether it can be put out at all —
 * the glow of the sky down the shaft cannot. `box` is what a round must enter to break it: filled in by whoever
 * draws the lamp (world/build.js: the box round its own lens), and null until then.
 * @param {{ x: number, y: number, z: number, kind: string }[]} siteLamps
 * @param {import('./grid.js').Grid} grid
 */
export function lampsOf(siteLamps, grid) {
  return siteLamps.map((lamp) => {
    const cx = Math.min(grid.w - 1, Math.max(0, Math.floor(lamp.x)));
    const cz = Math.min(grid.h - 1, Math.max(0, Math.floor(lamp.z)));
    const cell = cz * grid.w + cx;
    return {
      x: lamp.x,
      y: lamp.y,
      z: lamp.z,
      zone: grid.zone[cell],
      room: grid.ceil[cell] > 0,
      fixed: lamp.kind === 'sky',
      // how far its light goes (metres)
      reach: lamp.radius,
      box: null,
    };
  });
}

/**
 * @param {{ x: number, y: number, z: number, zone: number, room: boolean, box?: number[] | null, fixed?: boolean }[]} list
 */
export function createLamps(list) {
  const count = list.length;
  /** 1: shot — out for good */
  const shot = new Uint8Array(count);
  /** tripped until this time on the clock below (0: not tripped) */
  const until = new Float64Array(count);
  let clock = 0;
  const isOut = (i) => shot[i] === 1 || until[i] > clock;

  return {
    count,
    list,
    isOut,

    /**
     * A round has broken lamp `i`.
     * @returns {number[]} the lamps that went dark by it: [i], or nothing if it was dark already or cannot be put out
     */
    shoot(i) {
      if (!(i >= 0 && i < count) || list[i].fixed || shot[i]) return [];
      const was = isOut(i);
      shot[i] = 1;
      return was ? [] : [i];
    },

    /**
     * An EMP has tripped these lamps: they are out for `seconds` from now — or for as long as an earlier one
     * said, if that is longer.
     * @returns {number[]} those of them that went dark by it
     */
    trip(indices, seconds) {
      const changed = [];
      for (const i of indices) {
        if (!(i >= 0 && i < count) || list[i].fixed) continue;
        const was = isOut(i);
        until[i] = Math.max(until[i], clock + seconds);
        if (!was) changed.push(i);
      }
      return changed;
    },

    /**
     * Time passes.
     * @returns {number[]} the lamps that came back on in it
     */
    update(dt) {
      const before = clock;
      clock += dt;
      const back = [];
      for (let i = 0; i < count; i++) {
        if (until[i] <= before || until[i] > clock) continue;
        until[i] = 0;
        if (!shot[i]) back.push(i);
      }
      return back;
    },

    /** What a checkpoint keeps: the lamps that have been shot. (What an EMP tripped is back by the time of a retry.) */
    save() {
      const kept = [];
      for (let i = 0; i < count; i++) if (shot[i]) kept.push(i);
      return kept;
    },

    /**
     * Puts the lamps as a checkpoint kept them: those shot, and nothing tripped.
     * @returns {number[]} the lamps that are lit or dark now and were not
     */
    load(kept) {
      const want = new Uint8Array(count);
      for (const i of kept || []) if (i >= 0 && i < count && !list[i].fixed) want[i] = 1;
      const changed = [];
      for (let i = 0; i < count; i++) {
        const was = isOut(i);
        shot[i] = want[i];
        until[i] = 0;
        if (was !== (shot[i] === 1)) changed.push(i);
      }
      return changed;
    },

    /** A new mission: every lamp alight. Returns the lamps that were not. */
    reset() {
      return this.load([]);
    },

    /**
     * What a round flying from (ox, oy, oz) along (dx, dy, dz) meets first, among the lamps that are whole —
     * one an EMP has tripped is dark but can still be broken; one that has been shot is glass on the floor.
     * @param {number} max how far the round gets before something else stops it
     * @returns {{ i: number, t: number } | null}
     */
    hit(ox, oy, oz, dx, dy, dz, max) {
      let best = null;
      for (let i = 0; i < count; i++) {
        const lamp = list[i];
        if (!lamp.box || lamp.fixed || shot[i]) continue;
        const t = rayBox(lamp.box, ox, oy, oz, dx, dy, dz, best ? best.t : max);
        if (t >= 0 && (!best || t < best.t)) best = { i, t };
      }
      return best;
    },

    /**
     * The lamps an EMP going off at (x, z) puts out. In a room — under a built ceiling — that room's, all of
     * them: the breaker that feeds them has gone. In the open cavern, those that hang in the open within
     * `radius` metres. Off the map or in the rock, none.
     * @param {import('./grid.js').Grid} grid
     * @param {{ radius: number }} spec src/arms.js ARMS.grenades.dark
     * @returns {number[]}
     */
    reach(x, z, grid, { radius }) {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (!grid.inside(cx, cz)) return [];
      const cell = cz * grid.w + cx;
      // nothing goes off inside a wall or the rock
      if (grid.kind[cell] === KIND.WALL || grid.kind[cell] === KIND.ROCK) return [];
      const room = grid.ceil[cell] > 0;
      const zone = grid.zone[cell];
      const reached = [];
      for (let i = 0; i < count; i++) {
        const lamp = list[i];
        if (lamp.fixed) continue;
        if (room ? lamp.room && lamp.zone === zone : !lamp.room && Math.hypot(lamp.x - x, lamp.z - z) <= radius)
          reached.push(i);
      }
      return reached;
    },
  };
}
