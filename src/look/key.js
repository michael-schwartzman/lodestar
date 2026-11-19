// The key light of the second look: one strong lamp to a space, which throws real shadows.
//
// This file is the arithmetic of how far its light reaches and how it fades — without shadows, which the picture
// gets from a depth map (look/keylight.js) and the game's own sums get from a sight line through the grid
// (world/build.js). The shader in gfx/materials.js does the same sum per pixel; test/unit/matter.test.mjs pins
// this one, and a browser test holds the picture to it. No three.js and no browser in here.
import { DOOR_SEE_THROUGH, KIND } from '../world/grid.js';
import { roofAt } from '../world/mountain.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far along its reach the light has half gone, as a share of the reach. */
export const KEY_HALF = 0.6;

/**
 * How much of a key light arrives at a point, before shadows and before the surface's own angle: 1 close to the
 * lamp in the middle of its beam, 0 outside the beam or beyond its reach.
 * @param {object} key  x, y, z: where it hangs; tx, ty, tz: what it is aimed at; inner, outer: the half-angles, in
 *   degrees, between which its beam fades out; range: how far it reaches, in metres
 */
export function keyReach(key, x, y, z) {
  const lx = x - key.x;
  const ly = y - key.y;
  const lz = z - key.z;
  const d = Math.hypot(lx, ly, lz);
  if (d >= key.range || d < 1e-6) return 0;
  const ax = key.tx - key.x;
  const ay = key.ty - key.y;
  const az = key.tz - key.z;
  const along = (lx * ax + ly * ay + lz * az) / (d * Math.hypot(ax, ay, az));
  const beam = smooth(Math.cos((key.outer * Math.PI) / 180), Math.cos((key.inner * Math.PI) / 180), along);
  if (beam <= 0) return 0;
  // the moon is as far away from one end of a yard as from the other: its light does not fade on the way (`even`)
  return beam * (key.even ? 1 : keyFade(d, key.range));
}

/** The fading with distance alone: gentle — a flood across a yard, not a bulb — and gone at the end of the reach. */
export function keyFade(d, range) {
  const k = d / range;
  if (k >= 1) return 0;
  const window = 1 - k * k * k * k;
  const half = range * KEY_HALF;
  return (window * window) / (1 + (d * d) / (half * half));
}

/**
 * At how many points round itself a pixel asks a key light's depth picture whether it is in shadow. A desk:
 * sixteen. A phone: four where its graphics card is KNOWN to blend the answers of neighbouring pixels by itself
 * (look/probe.js asks it) — and nine where it does not, or could not be asked: not knowing is not good news.
 * @param {object} o
 * @param {boolean} o.phone
 * @param {'blended' | 'nearest' | 'unknown'} [o.filter] what look/probe.js shadowFilter() found
 */
export function shadowTaps({ phone, filter }) {
  if (!phone) return 16;
  return filter === 'blended' ? 4 : 9;
}

/** How much a key light counts towards how well a body is seen, beside the light worked out beforehand. */
export const KEY_SEEN = 0.75;

/** How bright a key light is, as one number. */
export const keyLuma = (key) => key.r * 0.3 + key.g * 0.59 + key.b * 0.11;

/** how high the cavern's air is lit by the moon coming down the shaft: from about its roof */
const CAVERN_AIR = 12;

/**
 * The lit air under a key light — the dust and damp of a mountain, shone through: a cone from the lamp along its
 * beam (look/keylight.js makes it). `from`, `to`: where it begins and ends, in metres from the lamp along `dir`;
 * `radius(d)`: how wide it is there; `strength`: how bright beside the lamp's own colour; `keeps`: how much of
 * that is left at its end. A lamp's cone ends in mid-air and must be gone by then (0). The moon's is lit only
 * where there is a cavern round it, comes down to the floor, and is still there when it arrives. Under the open
 * sky there is no dark air for a beam to show in: null.
 */
export function shaftOf(key) {
  if (key.sky) return null;
  const length = Math.hypot(key.tx - key.x, key.ty - key.y, key.tz - key.z);
  const dir = [(key.tx - key.x) / length, (key.ty - key.y) / length, (key.tz - key.z) / length];
  // how far along its beam the floor is, for a lamp that is aimed downwards at all
  const floor = dir[1] < -1e-3 ? key.y / -dir[1] : Infinity;
  if (key.kind === 'moon') {
    const spread = Math.tan((((key.inner + key.outer) / 2) * Math.PI) / 180);
    const from = Math.max(0, (key.y - CAVERN_AIR) / -dir[1]);
    // what comes down a shaft is as wide as the shaft (`column`), all the way down
    const radius = key.column ? () => key.column : (d) => d * spread;
    return { dir, from, to: floor, radius, strength: 1, keeps: 0.45 };
  }
  const flood = key.kind === 'flood';
  // narrower than the beam: the thick of it, which is what shows
  const spread = Math.tan((Math.min(key.inner * 0.8, 20) * Math.PI) / 180);
  const to = Math.max(1.5, Math.min(flood ? 16 : 6, floor * 0.96, key.range * 0.5));
  const from = 0.2;
  const mouth = flood ? 0.55 : 0.2;
  return { dir, from, to, radius: (d) => mouth + (d - from) * spread, strength: flood ? 0.8 : 0.7, keeps: 0 };
}

/**
 * Where a straight line from a point towards a key light is to be followed to: the lamp itself, or — for one that
 * hangs outside the map (the moon: `sky: true`) — the place where the line leaves it. Into `out` (x, y, z).
 * @param {{ w: number, h: number }} grid
 */
export function keyEnd(grid, key, x, y, z, out) {
  let s = 1;
  if (key.sky) {
    const dx = key.x - x;
    const dy = key.y - y;
    const dz = key.z - z;
    if (dx < 0) s = Math.min(s, (0.5 - x) / dx);
    else if (dx > 0) s = Math.min(s, (grid.w - 0.5 - x) / dx);
    if (dz < 0) s = Math.min(s, (0.5 - z) / dz);
    else if (dz > 0) s = Math.min(s, (grid.h - 0.5 - z) / dz);
    // above this nothing on the map stands (world/grid.js ROCK_HEIGHT is 10; the roof of the cavern is rock)
    if (dy > 0) s = Math.min(s, (14 - y) / dy);
    s = Math.max(0, s);
  }
  out.x = x + (key.x - x) * s;
  out.y = y + (key.y - y) * s;
  out.z = z + (key.z - z) * s;
  return out;
}

const END = { x: 0, y: 0, z: 0 };
const SHAPE = { t: 0, nx: 0, ny: 0, nz: 0, what: 'prop' };

/**
 * Whether light gets from a lamp to a point: a straight line between them, followed cell by cell from the point.
 * It is the map's own question (world/grid.js sight, raycast) with what those two leave out, because a guard
 * never looks down through a roof and a round is never fired over one — and light does both:
 *   - a built ceiling stops a line that crosses its height over the room; a line that comes in under it from the
 *     side (through a doorway, over a fence) or passes over the whole building is not stopped by it;
 *   - a building's walls stop it up to their top, and not above;
 *   - the rock is solid, and so is what is over a cavern (world/mountain.js roofAt) — except over the forecourt,
 *     which is under the sky, and at the foot of the exhaust shaft, which is open far above;
 *   - a shut door stops it; wire does not;
 *   - a thing that stands in a cell stops it: by its box (`fine` false — as coarsely as a guard's eye sees), or
 *     by its true shape (`fine` true — what world/build.js keeps for rounds, and what a depth picture draws).
 * The point's own cell never stops it.
 * @param {object} grid world/grid.js
 * @param {object} key  look/keys.js
 */
export function lightReaches(grid, key, x, y, z, fine = false) {
  keyEnd(grid, key, x, y, z, END);
  const dx = END.x - x;
  const dy = END.y - y;
  const dz = END.z - z;
  let cx = Math.floor(x);
  let cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= grid.w || cz >= grid.h) return false;
  const ex = Math.floor(END.x);
  const ez = Math.floor(END.z);
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - x : x - cx) * tDeltaX : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? cz + 1 - z : z - cz) * tDeltaZ : Infinity;
  let t = 0;
  const length = Math.hypot(dx, dy, dz);
  let missed = -1;
  for (let guard = 0; guard < 600; guard++) {
    const tExit = Math.min(tMaxX, tMaxZ, 1);
    const i = cz * grid.w + cx;
    const kind = grid.kind[i];
    const y0 = y + dy * t;
    const y1 = y + dy * tExit;
    const low = Math.min(y0, y1);
    const high = Math.max(y0, y1);
    if (kind === KIND.ROCK) return false;
    if (kind === KIND.WALL) {
      const top = grid.top[i];
      if (!(top > 0) || low < top) return false;
    } else if (kind === KIND.DOOR) {
      // a doorway: its leaf below the lintel when it is shut, and above the lintel the wall, as high as the
      // building's walls go — light that passes over the whole building passes over its doors too
      const lintel = grid.ceil[i] > 0 ? grid.ceil[i] : Infinity;
      const top = grid.top[i] > 0 ? grid.top[i] : Infinity;
      if (grid.doors[grid.doorAt[i]].open < DOOR_SEE_THROUGH && low < lintel) return false;
      if (high > lintel && low < top) return false;
    } else {
      const ceil = grid.ceil[i];
      // a built ceiling: crossed from below to above, or from above to below
      if (ceil > 0 ? low < ceil && high > ceil : grid.sky[i] === 0 && high > roofAt(cx + 0.5, cz + 0.5)) return false;
      if (guard > 0 && kind !== KIND.FENCE && !grid.thin[i] && grid.block[i] > 0) {
        const shape = fine && grid.shapes ? grid.shapes.at(i) : -1;
        if (shape >= 0) {
          if (shape !== missed) {
            if (grid.shapes.ray(shape, x, y, z, dx / length, dy / length, dz / length, SHAPE) && SHAPE.t < length - 0.3)
              return false;
            missed = shape;
          }
        } else if (low < grid.block[i]) return false;
      }
    }
    if (tExit >= 1 || (cx === ex && cz === ez)) return true;
    if (tMaxX < tMaxZ) {
      cx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else {
      cz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
    if (cx < 0 || cz < 0 || cx >= grid.w || cz >= grid.h) return !!key.sky;
  }
  return false;
}

/**
 * Whether a key light can be seen from a point, as coarsely as a guard's eye sees: by the boxes of things, not
 * their shapes (lightReaches).
 * @param {object} grid world/grid.js
 */
export const keySight = (grid, key, x, y, z) => lightReaches(grid, key, x, y, z, false);

/**
 * How much of one key light, as brightness, reaches chest height in every cell of the map: its reach, where the
 * lamp can be seen from there, weighed as the game weighs it (KEY_SEEN). One number to a cell; rock and walls
 * are zero.
 * @returns {Float32Array} grid.w × grid.h
 */
export function keySheet(grid, key) {
  const sheet = new Float32Array(grid.w * grid.h);
  const luma = keyLuma(key) * KEY_SEEN;
  const x0 = Math.max(0, Math.floor(key.x - key.range));
  const x1 = Math.min(grid.w - 1, Math.ceil(key.x + key.range));
  const z0 = Math.max(0, Math.floor(key.z - key.range));
  const z1 = Math.min(grid.h - 1, Math.ceil(key.z + key.range));
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const kind = grid.kind[z * grid.w + x];
      if (kind === KIND.WALL || kind === KIND.ROCK) continue;
      const reach = keyReach(key, x + 0.5, 1.3, z + 0.5);
      if (reach <= 0.002) continue;
      if (!keySight(grid, key, x + 0.5, 1.3, z + 0.5)) continue;
      sheet[z * grid.w + x] = luma * reach;
    }
  return sheet;
}

/**
 * The key lights as lamps that can be put out (world/lamps.js `createLamps`), in the order they are given. A
 * key light is fixed to a wall, and a wall is in no room: the space it is the lamp OF is the first open ground
 * along its beam — its zone, and whether that is under a built ceiling. The moon is no lamp: it cannot be put
 * out. `box` — what a round must enter to break it — is whoever draws the fitting's to give (look/keylight.js).
 * @param {object[]} keys look/keys.js
 * @param {object} grid world/grid.js
 */
export function keyLampsOf(keys, grid) {
  return keys.map((key) => {
    const length = Math.hypot(key.tx - key.x, key.ty - key.y, key.tz - key.z) || 1;
    let cell = -1;
    for (let along = 0; along <= length && cell < 0; along += 0.25) {
      const cx = Math.floor(key.x + ((key.tx - key.x) * along) / length);
      const cz = Math.floor(key.z + ((key.tz - key.z) * along) / length);
      if (!grid.inside(cx, cz)) continue;
      const kind = grid.kind[cz * grid.w + cx];
      if (kind !== KIND.WALL && kind !== KIND.ROCK) cell = cz * grid.w + cx;
    }
    return {
      x: key.x,
      y: key.y,
      z: key.z,
      zone: cell < 0 ? 0 : grid.zone[cell],
      room: cell >= 0 && grid.ceil[cell] > 0,
      fixed: key.kind === 'moon',
      // how far its light goes: what is captured within that of it is stale when it goes out
      reach: key.range,
      box: null,
    };
  });
}
