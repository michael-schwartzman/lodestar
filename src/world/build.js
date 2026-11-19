// Turns the site's data into things to draw, and works out — once — the light that falls on all of it.
//
// Every surface is cut into one-metre squares. For each corner of each square the light of every lamp that can
// reach it is added up (distance, angle, and a line-of-sight check through the grid, so walls and crates cast
// shadows), plus moonlight where there is sky, and the sum is stored as that corner's colour. After that a lamp
// costs nothing. The same sum taken at chest height in every cell is the "probe" that moving things — and the
// guards' eyes — use.
//
// The site is inside a mountain (world/mountain.js). What is over a cell is the grid's `sky`, not its `ceil`:
// a cell with no built ceiling is the main cavern (rock overhead: this file draws that roof), the forecourt
// (the sky) or the foot of the exhaust shaft. Only the forecourt gets the moon.
import * as THREE from 'three';
import { KIND, ROCK_HEIGHT } from './grid.js';
import { BLAST } from './blast.js';
import { CEILING_TEXTURES, FLOOR, FLOOR_TEXTURES, WALL_TEXTURES, WINDOW, ZONE } from './map.js';
import { cutDistance, mountainAt, roofAt } from './mountain.js';
import { PROPS, footprint } from './props.js';
import { lit, glow, beam, cloneMaterial, shared as sharedUniforms } from '../gfx/materials.js';
import { makeDetail } from '../gfx/detail.js';
import { createLightSum } from '../gfx/shade.js';
import { layerOf, matterOf } from '../gfx/matter.js';
import { GUESSED, guessedShare } from '../gfx/geo.js';
import { lampsOf } from './lamps.js';
import { skinOf, markSkin, turn as turnSkins } from './spin.js';
import { keySheet } from '../look/key.js';
import { noticed } from '../enemies/sight.js';
import { Billboards } from '../gfx/billboards.js';

/**
 * Surfaces are grouped into square tiles 2^TILE_SHIFT metres across, so that what is behind you is not drawn.
 * Big tiles: on a phone the number of separate things drawn costs more than the corners in them.
 */
const TILE_SHIFT = 6;

export const MOON_DIR = new THREE.Vector3(-0.42, 0.6, 0.68).normalize();

// linear light; GAIN scales the whole bake so that the tone curve has something to work with
const GAIN = 3.2;
const MOON = [0.05, 0.068, 0.11];
const SKY = [0.012, 0.017, 0.029];
const INDOOR = [0.007, 0.008, 0.011];
/** the main cavern: no sky, but a big space with a hundred lamps in it is never as dark as a shut room */
const CAVERN = [0.0105, 0.012, 0.0155];
/** What is over a point, as far as light goes: a ceiling, the sky, or the rock roof of the cavern. */
const AIR = { ROOM: 0, SKY: 1, CAVERN: 2 };

/** What a surface looks like when its texture is missing: a plain colour. */
const FALLBACK = {
  dirt: 0x6e6657,
  asphalt: 0x4a4d50,
  floorConcrete: 0x7f817d,
  floorTile: 0x868c8c,
  floorEpoxy: 0x6f7c74,
  floorPlate: 0x70777c,
  concrete: 0x868985,
  wallPanel: 0x8d968f,
  hallWall: 0x7f888a,
  ceiling: 0x8a8d8a,
  roof: 0x45474a,
  rock: 0x6a6258,
  fence: 0x9aa0a2,
  door: 0x7b8388,
};

/**
 * What each surface feels like: how deep its relief is, how rough it is and how much rougher in its cracks
 * (gfx/detail.js), how much like metal, and how wet it lies out of doors (0: it does not hold water).
 */
const LOOK = {
  dirt: { strength: 1.2, rough: 0.95, vary: 0.1, wet: 0.55 },
  asphalt: { strength: 1.5, rough: 0.8, vary: 0.3, wet: 1 },
  floorConcrete: { strength: 0.9, rough: 0.72, vary: 0.25, wet: 0.8 },
  floorTile: { strength: 0.8, rough: 0.32, vary: 0.6 },
  floorEpoxy: { strength: 0.35, rough: 0.2, vary: 0.3 },
  floorPlate: { strength: 1.6, rough: 0.38, vary: 0.3, metal: 0.7 },
  concrete: { strength: 1.0, rough: 0.82, vary: 0.2 },
  wallPanel: { strength: 0.9, rough: 0.5, vary: 0.3 },
  hallWall: { strength: 0.8, rough: 0.55, vary: 0.3 },
  ceiling: { strength: 0.6, rough: 0.85, vary: 0.1 },
  roof: { strength: 1.0, rough: 0.9, vary: 0.1 },
  rock: { strength: 2.0, rough: 0.93, vary: 0.1 },
  door: { strength: 1.0, rough: 0.42, vary: 0.3, metal: 0.55 },
};

const DIRS = [
  { dx: 0, dz: -1, nx: 0, nz: 1, lx: 0, lz: 0, rx: 1, rz: 0 },
  { dx: 0, dz: 1, nx: 0, nz: -1, lx: 1, lz: 1, rx: 0, rz: 1 },
  { dx: -1, dz: 0, nx: 1, nz: 0, lx: 0, lz: 1, rx: 0, rz: 0 },
  { dx: 1, dz: 0, nx: -1, nz: 0, lx: 1, lz: 0, rx: 1, rz: 1 },
];

const hash2 = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** How tall a cliff stands at a grid corner, where there is sky over it: the rock round the forecourt. */
const rockTop = (x, z) => ROCK_HEIGHT - 0.6 + hash2(x, z) * 1.7;

/**
 * @param {object} site what buildSite() returned
 * @param {object} o
 * @param {Record<string, THREE.Texture>} [o.textures]
 * @param {(kind: string, variant: number) => { solid: THREE.BufferGeometry, glow: THREE.BufferGeometry | null }} o.buildProp
 * @param {THREE.BufferGeometry} o.centrifugeGeometry
 * @param {boolean} [o.detail=true] make a bump map for every surface (gfx/detail.js)
 * @param {object|null} [o.look] the second look (src/look), when the address asks for it: `matter` — props carry
 *   what each part is made of, and what is written on them; `keys` — the key lights (look/key.js), which are not
 *   baked into anything here but do count towards how well a body can be seen
 */
export function buildWorld(site, { textures = {}, buildProp, centrifugeGeometry, detail = true, look = null }) {
  const t0 = performance.now();
  const grid = site.grid;
  const W = grid.w;
  const H = grid.h;
  const group = new THREE.Group();
  group.name = 'site';
  const tagged = !!look?.matter;
  const keyLights = look?.keys || [];

  // light leaks through doorways: bake with every door open
  for (const door of grid.doors) door.open = 1;

  // ---------- which lamps can matter where ----------
  const BUCKET = 8;
  const bucketsWide = Math.ceil(W / BUCKET);
  const buckets = new Map();
  for (const lamp of site.lamps) {
    lamp.r2 = lamp.radius * lamp.radius;
    const x0 = Math.floor((lamp.x - lamp.radius) / BUCKET);
    const x1 = Math.floor((lamp.x + lamp.radius) / BUCKET);
    const z0 = Math.floor((lamp.z - lamp.radius) / BUCKET);
    const z1 = Math.floor((lamp.z + lamp.radius) / BUCKET);
    for (let bz = z0; bz <= z1; bz++)
      for (let bx = x0; bx <= x1; bx++) {
        const key = bz * bucketsWide + bx;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(lamp);
      }
  }
  const NO_LAMPS = [];
  const lampsNear = (x, z) => buckets.get(Math.floor(z / BUCKET) * bucketsWide + Math.floor(x / BUCKET)) || NO_LAMPS;

  /** Can this point see the moon? */
  function skyOpen(x, y, z) {
    let s = (ROCK_HEIGHT + 4 - y) / MOON_DIR.y;
    if (MOON_DIR.x < 0) s = Math.min(s, (x - 0.5) / -MOON_DIR.x);
    else if (MOON_DIR.x > 0) s = Math.min(s, (W - 0.5 - x) / MOON_DIR.x);
    if (MOON_DIR.z < 0) s = Math.min(s, (z - 0.5) / -MOON_DIR.z);
    else if (MOON_DIR.z > 0) s = Math.min(s, (H - 0.5 - z) / MOON_DIR.z);
    if (s <= 0) return true;
    return grid.sight(x, y, z, x + MOON_DIR.x * s, y + MOON_DIR.y * s, z + MOON_DIR.z * s);
  }

  const L = [0, 0, 0];
  /** the arrow of the light last worked out: which way most of it came, as long as its share of the whole */
  const LD = [0, 0, 0];
  const sum = createLightSum();
  const S = {};
  // The second look: under a built ceiling the light worked out here is the FILL beside a key light, and is
  // turned down for it (`look.roomFill`, below 1). A room's own lamps light it brightly and from every side; a
  // key light laid over that added a seventh to what the eye saw and threw no shadow to speak of (16 November
  // 2026: in the corridor, one twentieth). Turned down, the room is about as bright as it was and has a side
  // the light comes from. Without the switch — and in the cavern, where the lamps are few — it is as it was.
  const roomFill = look?.roomFill ?? 1;
  const gainOf = (air) => (air === AIR.ROOM ? GAIN * roomFill : GAIN);
  const falloff = (d2, r2) => {
    const k = 1 - d2 / r2;
    return (k * k) / (1 + 0.045 * d2);
  };
  /**
   * The light arriving at a point, into L, and the arrow of it into LD.
   * @param {number} air what is over the point (AIR): only under the sky do the moon and the sky's own light count
   * @param {boolean} omni ignore which way the surface faces — for probes
   */
  function lightAt(x, y, z, nx, ny, nz, air, omni) {
    sum.reset();
    if (air === AIR.SKY) {
      const k = omni ? 1 : 0.6 + 0.4 * ny;
      sum.ambient(SKY[0] * k, SKY[1] * k, SKY[2] * k);
      const ndl = omni ? 0.6 : nx * MOON_DIR.x + ny * MOON_DIR.y + nz * MOON_DIR.z;
      if (ndl > 0 && skyOpen(x, y, z))
        sum.add(MOON[0] * ndl, MOON[1] * ndl, MOON[2] * ndl, MOON_DIR.x, MOON_DIR.y, MOON_DIR.z);
    } else if (air === AIR.CAVERN) sum.ambient(CAVERN[0], CAVERN[1], CAVERN[2]);
    else sum.ambient(INDOOR[0], INDOOR[1], INDOOR[2]);
    const lamps = lampsNear(x, z);
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      // one that has been shot out, or tripped by an EMP, gives nothing
      if (lamp.out) continue;
      const dx = lamp.x - x;
      const dy = lamp.y - y;
      const dz = lamp.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= lamp.r2) continue;
      const ndl = omni ? 0.75 : (nx * dx + ny * dy + nz * dz) / Math.sqrt(d2);
      if (ndl <= 0.02) continue;
      if (!grid.sight(x, y, z, lamp.x, lamp.y, lamp.z)) continue;
      const k = falloff(d2, lamp.r2) * ndl;
      sum.add(lamp.r * k, lamp.g * k, lamp.b * k, dx, dy, dz);
    }
    sum.finish(S);
    const k = gainOf(air);
    L[0] = S.r * k;
    L[1] = S.g * k;
    L[2] = S.b * k;
    LD[0] = S.dx;
    LD[1] = S.dy;
    LD[2] = S.dz;
  }

  // ---------- batches: one growing mesh per material per tile ----------
  const batches = new Map();
  /** a square's four corners as a mesh keeps them (`quad`) */
  const Q = new Float64Array(12);
  function batch(material, x, z) {
    const key = `${material}|${x >> TILE_SHIFT}|${z >> TILE_SHIFT}`;
    let b = batches.get(key);
    if (!b) {
      b = {
        material,
        pos: [],
        nor: [],
        uv: [],
        col: [],
        dir: [],
        paint: [],
        surf: [],
        mat: [],
        idx: [],
        count: 0,
        // what the light on it was worked out FROM, kept so that it can be worked out again when a lamp goes
        // out (further down, "lamps that go out"): for each square, what is over it and whether it is lit from
        // all round; for each thing, where it starts in the batch and where its lamps were looked for from
        air: [],
        models: [],
      };
      batches.set(key, b);
    }
    return b;
  }

  /** One lit square. P: four corners (x, y, z each), anticlockwise seen from the side it faces. `air`: AIR. */
  function quad(b, P, nx, ny, nz, UV, air, omni = false) {
    b.air.push(air | (omni ? 4 : 0));
    // The light is worked out from the corners as the mesh KEEPS them — rounded to the card's thirty-two bits —
    // and not as they were asked for, so that it can be worked out again from the mesh alone and come to the
    // same ("lamps that go out", further down). A mark laid at a slant grazes a wall's corner: a hair's breadth
    // of rounding there is a lamp seen or not seen.
    for (let k = 0; k < 12; k++) Q[k] = Math.fround(P[k]);
    nx = Math.fround(nx);
    ny = Math.fround(ny);
    nz = Math.fround(nz);
    const mx = (Q[0] + Q[3] + Q[6] + Q[9]) / 4;
    const my = (Q[1] + Q[4] + Q[7] + Q[10]) / 4;
    const mz = (Q[2] + Q[5] + Q[8] + Q[11]) / 4;
    for (let k = 0; k < 4; k++) {
      const x = Q[k * 3];
      const y = Q[k * 3 + 1];
      const z = Q[k * 3 + 2];
      // sample a little inside the square and off its face, so a corner on a wall line is not counted as in the wall
      lightAt(
        x + (mx - x) * 0.12 + nx * 0.05,
        Math.max(0.03, y + (my - y) * 0.12 + ny * 0.05),
        z + (mz - z) * 0.12 + nz * 0.05,
        nx,
        ny,
        nz,
        air,
        omni,
      );
      b.pos.push(x, y, z);
      b.nor.push(nx, ny, nz);
      b.uv.push(UV[k * 2], UV[k * 2 + 1]);
      b.col.push(L[0], L[1], L[2]);
      // something lit from all round (the wire) has no side for a highlight to be on
      if (omni) b.dir.push(0, 0, 0);
      else b.dir.push(LD[0], LD[1], LD[2]);
    }
    const n = b.count;
    b.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    b.count += 4;
  }

  // Tread plate's lozenges are a few centimetres long. The picture of it was drawn to be stretched over two metres,
  // which makes them the size of a hand — it reads as woven matting, close to (the tour pictures of 16 November
  // 2026). In the second look it is laid at its real size; the game as it is keeps what it had.
  const LAID = tagged ? { floorPlate: 0.7 } : {};
  const metresOf = (name) => LAID[name] || textures[name]?.userData?.metres || 4;

  /**
   * A strip of wall one cell wide on the side of cell (cx, cz) given by dir, from height y0 up to topL at its left
   * end and topR at its right (the same height, y1, unless given): whole metres as far as the lower end goes, and
   * one last piece shaped to both.
   */
  function wallFace(name, cx, cz, dir, y0, y1, air, topL = y1, topR = y1) {
    const m = metresOf(name);
    const lx = cx + dir.lx;
    const lz = cz + dir.lz;
    const rx = cx + dir.rx;
    const rz = cz + dir.rz;
    const alongX = dir.nz !== 0;
    const cl = alongX ? lx : lz;
    const cr = alongX ? rx : rz;
    const sign = cr > cl ? 1 : -1;
    const uL = (sign * cl) / m;
    const uR = (sign * cr) / m;
    const b = batch(`wall:${name}`, cx, cz);
    const low = Math.min(topL, topR);
    if (Math.max(topL, topR) <= y0 + 1e-6) return;
    let y = y0;
    for (; y + 1 < low - 1e-6; y += 1)
      quad(
        b,
        [lx, y, lz, rx, y, rz, rx, y + 1, rz, lx, y + 1, lz],
        dir.nx,
        0,
        dir.nz,
        [uL, y / m, uR, y / m, uR, (y + 1) / m, uL, (y + 1) / m],
        air,
      );
    const yl = Math.max(y, topL);
    const yr = Math.max(y, topR);
    quad(
      b,
      [lx, y, lz, rx, y, rz, rx, yr, rz, lx, yl, lz],
      dir.nx,
      0,
      dir.nz,
      [uL, y / m, uR, y / m, uR, yr / m, uL, yl / m],
      air,
    );
  }

  const open = (kind) => kind !== KIND.WALL && kind !== KIND.ROCK;
  /** What is over cell i, as far as light goes. (The foot of the shaft is lit as the cavern is, and by its lamps.) */
  const airOf = (i) => (grid.sky[i] === 1 ? AIR.SKY : grid.ceil[i] > 0 ? AIR.ROOM : AIR.CAVERN);
  /**
   * How high whatever bounds an open-topped cell stands at a grid corner: the cavern's roof under the mountain,
   * the cliff's top under the sky. Walls, rock faces and the pieces over doorways all come up to it, so that they
   * meet the roof — or one another — along an edge.
   */
  const crownAt = (x, z, sky) => (sky ? rockTop(x, z) : roofAt(x, z));

  // ---------- floors, ceilings, walls ----------
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const kind = grid.kind[i];
      // solid: nothing to draw from inside it. (What is over it is the mountain's business, further down.)
      if (kind === KIND.ROCK || kind === KIND.WALL) continue;

      const ceil = grid.ceil[i];
      const openTop = ceil === 0;
      const sky = grid.sky[i] === 1;
      const air = airOf(i);
      const floorName = FLOOR_TEXTURES[grid.floor[i]];
      const fm = metresOf(floorName);
      // ground that water gets to lies wet, and is drawn by a material of its own: under the sky it has been
      // rained on, the cavern's floor seeps, and the adit is a drain
      const wet = openTop || grid.zone[i] === ZONE.ADIT;
      quad(
        batch(`floor:${floorName}${wet ? ':wet' : ''}`, x, z),
        [x, 0, z, x, 0, z + 1, x + 1, 0, z + 1, x + 1, 0, z],
        0,
        1,
        0,
        [x / fm, z / fm, x / fm, (z + 1) / fm, (x + 1) / fm, (z + 1) / fm, (x + 1) / fm, z / fm],
        air,
      );
      if (ceil > 0) {
        // a built ceiling: panels in a room, bare rock or concrete in a passage bored through the mountain
        const ceilingName = CEILING_TEXTURES[grid.zone[i]] || 'ceiling';
        const cm = metresOf(ceilingName);
        quad(
          batch(`ceiling:${ceilingName}`, x, z),
          [x, ceil, z, x + 1, ceil, z, x + 1, ceil, z + 1, x, ceil, z + 1],
          0,
          -1,
          0,
          [x / cm, z / cm, (x + 1) / cm, z / cm, (x + 1) / cm, (z + 1) / cm, x / cm, (z + 1) / cm],
          AIR.ROOM,
        );
      }

      // a passage bored through the rock has rock for walls wherever its roof steps; a room has its own lining
      const wallName = openTop
        ? 'concrete'
        : CEILING_TEXTURES[grid.zone[i]] === 'rock'
          ? 'rock'
          : WALL_TEXTURES[grid.zone[i]];
      for (const dir of DIRS) {
        const bx = x + dir.dx;
        const bz = z + dir.dz;
        if (!grid.inside(bx, bz)) continue;
        const j = bz * W + bx;
        const other = grid.kind[j];
        // how high this side stands at its two ends: to the ceiling, or — with none — to the roof or the cliff top
        const topL = openTop ? crownAt(x + dir.lx, z + dir.lz, sky) : ceil;
        const topR = openTop ? crownAt(x + dir.rx, z + dir.rz, sky) : ceil;
        if (other === KIND.WALL) {
          // a hut stands free and has a top of its own; what is built into the rock goes up to the roof
          const flat = grid.top[j];
          if (openTop && flat > 0) wallFace(wallName, x, z, dir, 0, flat, air);
          else wallFace(wallName, x, z, dir, 0, topL, air, topL, topR);
        } else if (other === KIND.ROCK) {
          wallFace('rock', x, z, dir, 0, topL, air, topL, topR);
        } else {
          // the wall above a doorway or a tunnel's mouth, or wherever a low room opens into a taller space
          const low = grid.ceil[j];
          if (low > 0 && (openTop || ceil > low)) {
            const bored = openTop && CEILING_TEXTURES[grid.zone[j]] === 'rock';
            wallFace(bored ? 'rock' : wallName, x, z, dir, low, topL, air, topL, topR);
          }
        }
      }

      if (kind === KIND.FENCE) {
        const alongX =
          (grid.inside(x - 1, z) && grid.kind[i - 1] === KIND.FENCE) ||
          (grid.inside(x + 1, z) && grid.kind[i + 1] === KIND.FENCE);
        const alongZ =
          (grid.inside(x, z - 1) && grid.kind[i - W] === KIND.FENCE) ||
          (grid.inside(x, z + 1) && grid.kind[i + W] === KIND.FENCE);
        const b = batch('fence', x, z);
        const top = 2.6;
        if (alongX || !alongZ)
          quad(
            b,
            [x, 0, z + 0.5, x + 1, 0, z + 0.5, x + 1, top, z + 0.5, x, top, z + 0.5],
            0,
            1,
            0,
            [x, 0, x + 1, 0, x + 1, top, x, top],
            air,
            true,
          );
        if (alongZ)
          quad(
            b,
            [x + 0.5, 0, z, x + 0.5, 0, z + 1, x + 0.5, top, z + 1, x + 0.5, top, z],
            0,
            1,
            0,
            [z, 0, z + 1, 0, z + 1, top, z, top],
            air,
            true,
          );
      }
    }

  // ---------- the cavern's roof ----------
  // Rock, a long way up: one square over every cell that has no ceiling of its own and is not under the sky or
  // the shaft. Its corners are where mountain.js says — and so are the tops of the walls that come up to meet it.
  {
    const m = metresOf('rock');
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        if (!open(grid.kind[i]) || grid.ceil[i] > 0 || grid.sky[i] !== 0) continue;
        const h00 = roofAt(x, z);
        const h10 = roofAt(x + 1, z);
        const h11 = roofAt(x + 1, z + 1);
        const h01 = roofAt(x, z + 1);
        // the square's own slope, so that the lamps under it pick its facets out
        const sx = h10 - h00;
        const sz = h01 - h00;
        const len = Math.hypot(sx, 1, sz);
        quad(
          batch('roof:rock', x, z),
          [x, h00, z, x + 1, h10, z, x + 1, h11, z + 1, x, h01, z + 1],
          sx / len,
          -1 / len,
          sz / len,
          [x / m, z / m, (x + 1) / m, z / m, (x + 1) / m, (z + 1) / m, x / m, (z + 1) / m],
          AIR.CAVERN,
        );
      }
  }

  // ---------- the exhaust shaft ----------
  // Four walls of concrete straight up from the cavern's roof to a collar that stands a little proud of the bench
  // on the mountain; nothing across the top of it but the sky. Lit by its own rings of lamps (world/map.js), and
  // for its last few metres by the moon.
  if (site.shaft) {
    const s = site.shaft;
    const lip = s.top + s.collar;
    const m = metresOf('concrete');
    // each side as [x of its left end, z, x of its right end, z, normal x, normal z], left and right as you face it
    const sides = [];
    for (let x = s.x0; x < s.x1; x++) {
      sides.push([x, s.z0, x + 1, s.z0, 0, 1]);
      sides.push([x + 1, s.z1, x, s.z1, 0, -1]);
    }
    for (let z = s.z0; z < s.z1; z++) {
      sides.push([s.x0, z + 1, s.x0, z, 1, 0]);
      sides.push([s.x1, z, s.x1, z + 1, -1, 0]);
    }
    for (const [lx, lz, rx, rz, nx, nz] of sides) {
      const b = batch('wall:concrete', Math.min(lx, rx), Math.min(lz, rz));
      const alongX = nz !== 0;
      const uL = (alongX ? lx : lz) / m;
      const uR = (alongX ? rx : rz) / m;
      const footL = roofAt(lx, lz);
      const footR = roofAt(rx, rz);
      const first = Math.ceil(Math.max(footL, footR));
      const piece = (y0l, y0r, y1, air) =>
        quad(
          b,
          [lx, y0l, lz, rx, y0r, rz, rx, y1, rz, lx, y1, lz],
          nx,
          0,
          nz,
          [uL, y0l / m, uR, y0r / m, uR, y1 / m, uL, y1 / m],
          air,
        );
      piece(footL, footR, first, AIR.CAVERN);
      for (let y = first; y < lip - 1e-6; y += 2) {
        const y1 = Math.min(lip, y + 2);
        piece(y, y, y1, y1 > s.top - 5 ? AIR.SKY : AIR.CAVERN);
      }
      // the collar's outside, where it stands out of the bench: the same piece of wall seen from the other side
      quad(
        b,
        [rx, s.top - 0.6, rz, lx, s.top - 0.6, lz, lx, lip, lz, rx, lip, rz],
        -nx,
        0,
        -nz,
        [uR, 0, uL, 0, uL, (s.collar + 0.6) / m, uR, (s.collar + 0.6) / m],
        AIR.SKY,
      );
    }
  }

  // ---------- the mountain, from outside ----------
  // What the title, the ending and the forecourt see: the ground over all of it, as mountain.js gives it — coarse
  // (8 m) out to the horizon, to the metre round the forecourt and round the shaft's collar, where things meet it.
  // It is lit by the moon and the sky alone, and nothing under it can see it: it faces up.
  {
    const lines = (from, to, fine) => {
      const set = new Set();
      for (let v = from; v <= to; v += 8) set.add(v);
      for (const [a, b] of fine) for (let v = a; v <= b; v++) set.add(v);
      return [...set].sort((p, q) => p - q);
    };
    const shaft = site.shaft;
    const xs = lines(
      -216,
      344,
      shaft
        ? [
            [48, 80],
            [shaft.x0 - 3, shaft.x1 + 3],
          ]
        : [[48, 80]],
    );
    const zs = lines(
      -200,
      320,
      shaft
        ? [
            [84, 100],
            [shaft.z0 - 3, shaft.z1 + 3],
          ]
        : [[84, 100]],
    );
    const m = metresOf('rock') * 5;
    const P = [0, 0, 0, 0];
    const skyAt = (cx, cz) => (grid.inside(cx, cz) && grid.sky[cz * W + cx] === 1 ? 1 : 0);
    /** Is the grid corner (x, z) on the lip of the cut: sky on one side of it, rock on another? */
    const onLip = (x, z) => {
      if (z >= H) return false;
      const n = skyAt(x - 1, z - 1) + skyAt(x, z - 1) + skyAt(x - 1, z) + skyAt(x, z);
      return n > 0 && n < 4;
    };
    const at = (x, z) => {
      // on the lip the ground starts where the cliff's faces end (crownAt, under the sky): they meet along an edge
      if (onLip(x, z)) return rockTop(x, z);
      const h = mountainAt(x, z);
      if (h > 0) return h;
      // the valley's floor south of the map: level, and a little lower under the road that runs down it
      return x > 60 && x < 68 ? -0.4 : 0;
    };
    for (let zi = 0; zi + 1 < zs.length; zi++)
      for (let xi = 0; xi + 1 < xs.length; xi++) {
        const x0 = xs[xi];
        const x1 = xs[xi + 1];
        const z0 = zs[zi];
        const z1 = zs[zi + 1];
        // the shaft's mouth is a hole; and where the grid has a floor of its own under the sky there is no ground
        if (shaft && x0 >= shaft.x0 && x1 <= shaft.x1 && z0 >= shaft.z0 && z1 <= shaft.z1) continue;
        if (z1 <= H && cutDistance((x0 + x1) / 2, (z0 + z1) / 2) <= 0) continue;
        const corners = [
          [x0, z0],
          [x0, z1],
          [x1, z1],
          [x1, z0],
        ];
        for (let k = 0; k < 4; k++) P[k] = at(corners[k][0], corners[k][1]);
        const b = batch('terrain:rock', x0, z0);
        const n = b.count;
        for (let k = 0; k < 4; k++) {
          const [x, z] = corners[k];
          // which way the ground faces here, from the slope a metre either side
          const gx = mountainAt(x + 1, z) - mountainAt(x - 1, z);
          const gz = mountainAt(x, z + 1) - mountainAt(x, z - 1);
          const len = Math.hypot(gx, 2, gz);
          const nx = -gx / len;
          const ny = 2 / len;
          const nz = -gz / len;
          const moon = Math.max(0, nx * MOON_DIR.x + ny * MOON_DIR.y + nz * MOON_DIR.z);
          const sky = 0.6 + 0.4 * ny;
          b.pos.push(x, P[k], z);
          b.nor.push(nx, ny, nz);
          b.uv.push(x / m, z / m);
          b.col.push(
            (SKY[0] * sky + MOON[0] * moon) * GAIN,
            (SKY[1] * sky + MOON[1] * moon) * GAIN,
            (SKY[2] * sky + MOON[2] * moon) * GAIN,
          );
          b.dir.push(MOON_DIR.x * 0.6, MOON_DIR.y * 0.6, MOON_DIR.z * 0.6);
        }
        b.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
        b.count += 4;
      }
    // the road, going on down the valley
    const fm = metresOf('asphalt');
    for (let z = H; z < 320; z += 8)
      quad(
        batch('floor:asphalt:wet', 60, z),
        [60, 0, z, 60, 0, z + 8, 68, 0, z + 8, 68, 0, z],
        0,
        1,
        0,
        [60 / fm, z / fm, 60 / fm, (z + 8) / fm, 68 / fm, (z + 8) / fm, 68 / fm, z / fm],
        AIR.SKY,
      );
  }

  // ---------- roofs ----------
  // of the huts that stand free in the cavern: lit from below and beside, like everything else in it
  for (const roof of site.roofs) {
    const m = metresOf('roof');
    const x0 = roof.x0;
    const x1 = roof.x1 + 1;
    const z0 = roof.z0;
    const z1 = roof.z1 + 1;
    quad(
      batch('roof', roof.x0, roof.z0),
      [x0, roof.top, z0, x0, roof.top, z1, x1, roof.top, z1, x1, roof.top, z0],
      0,
      1,
      0,
      [x0 / m, z0 / m, x0 / m, z1 / m, x1 / m, z1 / m, x1 / m, z0 / m],
      AIR.CAVERN,
    );
  }

  // ---------- props: one painted, lit mesh per tile ----------
  const glowBatch = { pos: [], col: [], count: 0 };
  const propCache = new Map();
  const placeholder = () => {
    const g = new THREE.BoxGeometry(0.8, 0.8, 0.8).translate(0, 0.4, 0).toNonIndexed();
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.4), 3));
    return { solid: g, glow: null };
  };
  const propModel = (kind, variant) => {
    const key = `${kind}:${variant}`;
    if (!propCache.has(key)) {
      let model;
      try {
        model = buildProp(kind, variant);
        if (!model?.solid?.attributes?.position) throw new Error('no geometry');
        model.solid.computeBoundingBox();
      } catch (error) {
        console.warn(`prop ${kind} could not be built: ${error.message}`);
        model = placeholder();
        model.solid.computeBoundingBox();
      }
      propCache.set(key, model);
    }
    return propCache.get(key);
  };

  const visible = [];
  /** the second look: how many corners of what stands on the site say what they are made of, and how many are a guess */
  const said = { corners: 0, guessed: 0 };
  /**
   * Which lamps a thing can see is asked once, from just above it — (sx, sy, sz) — and kept in `visible`; each of
   * its corners then only does arithmetic. A lamp that is out is not among them.
   */
  function lampsSeenFrom(sx, sy, sz) {
    visible.length = 0;
    for (const lamp of lampsNear(sx, sz)) {
      if (lamp.out) continue;
      const reach = lamp.radius + 4;
      if ((lamp.x - sx) ** 2 + (lamp.z - sz) ** 2 > reach * reach) continue;
      if (grid.sight(sx, Math.min(sy, lamp.y), sz, lamp.x, lamp.y, lamp.z)) visible.push(lamp);
    }
  }
  /** The light on one corner of a thing, which faces (nx, ny, nz), by the lamps in `visible`: into S. */
  function cornerLight(x, y, z, nx, ny, nz, air, moonlit) {
    sum.reset();
    if (air === AIR.SKY) {
      const sky = 0.6 + 0.4 * ny;
      sum.ambient(SKY[0] * sky, SKY[1] * sky, SKY[2] * sky);
      const ndl = nx * MOON_DIR.x + ny * MOON_DIR.y + nz * MOON_DIR.z;
      if (moonlit && ndl > 0) sum.add(MOON[0] * ndl, MOON[1] * ndl, MOON[2] * ndl, MOON_DIR.x, MOON_DIR.y, MOON_DIR.z);
    } else if (air === AIR.CAVERN) sum.ambient(CAVERN[0], CAVERN[1], CAVERN[2]);
    else sum.ambient(INDOOR[0], INDOOR[1], INDOOR[2]);
    for (let v = 0; v < visible.length; v++) {
      const lamp = visible[v];
      const dx = lamp.x - x;
      const dy = lamp.y - y;
      const dz = lamp.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= lamp.r2) continue;
      // a little light wraps round to faces that look away, or their detail is lost altogether
      const ndl = (nx * dx + ny * dy + nz * dz) / Math.sqrt(d2);
      const wrap = ndl > 0 ? 0.12 + 0.88 * ndl : 0.12 * (1 + ndl);
      if (wrap <= 0) continue;
      const f = falloff(d2, lamp.r2) * wrap;
      sum.add(lamp.r * f, lamp.g * f, lamp.b * f, dx, dy, dz);
    }
    sum.finish(S);
  }
  function addModel(solid, glowGeo, px, py, pz, rot) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const box = solid.boundingBox;
    const cxLocal = (box.min.x + box.max.x) / 2;
    const czLocal = (box.min.z + box.max.z) / 2;
    const sx = px + cxLocal * cos + czLocal * sin;
    const sz = pz - cxLocal * sin + czLocal * cos;
    const sy = py + box.max.y + 0.25;
    const cellX = Math.min(W - 1, Math.max(0, Math.floor(sx)));
    const cellZ = Math.min(H - 1, Math.max(0, Math.floor(sz)));
    const air = airOf(cellZ * W + cellX);
    const gain = gainOf(air);
    const moonlit = air === AIR.SKY && skyOpen(sx, sy, sz);
    lampsSeenFrom(sx, sy, sz);

    const b = batch('props', cellX, cellZ);
    const pos = solid.attributes.position.array;
    const nor = solid.attributes.normal.array;
    const col = solid.attributes.color.array;
    const surf = solid.attributes.surf?.array;
    const matter = tagged ? solid.attributes.mat?.array : null;
    // a thing that was not built out of painted parts and does not say is given a material by its colour — a
    // guess, and marked as one
    const plain = tagged && !matter ? layerOf(matterOf(col[0], col[1], col[2], 0.6, 0)) + GUESSED : 0;
    const count = solid.attributes.position.count;
    if (tagged) {
      said.corners += count;
      said.guessed += matter ? Math.round(guessedShare(solid) * count) : count;
    }
    b.models.push({ start: b.count, count, sx, sy, sz, air });
    for (let k = 0; k < count; k++) {
      const lx = pos[k * 3];
      const ly = pos[k * 3 + 1];
      const lz = pos[k * 3 + 2];
      // as the mesh keeps them (see `quad`): the light is worked out from what it can be worked out from again
      const x = Math.fround(px + lx * cos + lz * sin);
      const y = Math.fround(py + ly);
      const z = Math.fround(pz - lx * sin + lz * cos);
      const nxl = nor[k * 3];
      const ny = nor[k * 3 + 1];
      const nzl = nor[k * 3 + 2];
      const nx = Math.fround(nxl * cos + nzl * sin);
      const nz = Math.fround(-nxl * sin + nzl * cos);
      cornerLight(x, y, z, nx, ny, nz, air, moonlit);
      b.pos.push(x, y, z);
      b.nor.push(nx, ny, nz);
      b.uv.push(0, 0);
      // light and paint are kept apart, so that the shader can tell a highlight from a colour
      b.col.push(S.r * gain, S.g * gain, S.b * gain);
      b.dir.push(S.dx, S.dy, S.dz);
      b.paint.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
      if (surf) b.surf.push(surf[k * 2], surf[k * 2 + 1]);
      else b.surf.push(0.6, 0);
      if (tagged) b.mat.push(matter ? matter[k] : plain);
      b.idx.push(b.count++);
    }

    if (glowGeo?.attributes?.position) {
      const gp = glowGeo.attributes.position.array;
      const gc = glowGeo.attributes.color?.array;
      for (let k = 0; k < glowGeo.attributes.position.count; k++) {
        const lx = gp[k * 3];
        const lz = gp[k * 3 + 2];
        glowBatch.pos.push(px + lx * cos + lz * sin, py + gp[k * 3 + 1], pz - lx * sin + lz * cos);
        if (gc) glowBatch.col.push(gc[k * 3], gc[k * 3 + 1], gc[k * 3 + 2]);
        else glowBatch.col.push(1, 1, 1);
        glowBatch.count++;
      }
    }
  }

  // ---------- the true shape of every thing that stops a round ----------
  // A prop is smaller than the cells it stands on. The grid stops a body, and a guard's eye, on those cells; a
  // round it stops on the prop's own triangles, kept here for that (Grid.shapes), or lets fly on through the gap.
  const shapeTris = [];
  const shapeBox = [];
  const cellShape = new Int32Array(W * H).fill(-1);
  function keepShape(p, solid, cells) {
    const spec = PROPS[p.kind];
    if (!cells && (!spec || !(spec.block > 0) || spec.thin || p.y !== 0)) return;
    const cos = Math.cos(p.rot);
    const sin = Math.sin(p.rot);
    const pos = solid.attributes.position.array;
    const index = solid.index?.array;
    const count = index ? index.length : solid.attributes.position.count;
    const tris = new Float32Array(count * 3);
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < count; k++) {
      const v = index ? index[k] : k;
      const lx = pos[v * 3];
      const lz = pos[v * 3 + 2];
      const x = p.x + lx * cos + lz * sin;
      const y = p.y + pos[v * 3 + 1];
      const z = p.z - lx * sin + lz * cos;
      tris[k * 3] = x;
      tris[k * 3 + 1] = y;
      tris[k * 3 + 2] = z;
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.min(box[2], z);
      box[3] = Math.max(box[3], x);
      box[4] = Math.max(box[4], y);
      box[5] = Math.max(box[5], z);
    }
    const id = shapeTris.length;
    shapeTris.push(tris);
    shapeBox.push(box);
    if (cells) {
      for (const [x, z] of cells) cellShape[z * W + x] = id;
      return;
    }
    const [fw, fd] = footprint(p.kind, Math.round(p.rot / (Math.PI / 2)));
    const x0 = Math.round(p.x - fw / 2);
    const z0 = Math.round(p.z - fd / 2);
    for (let z = z0; z < z0 + fd; z++)
      for (let x = x0; x < x0 + fw; x++) if (grid.inside(x, z) && grid.block[z * W + x] > 0) cellShape[z * W + x] = id;
  }

  // what each kind of prop weighs, how much of it says what it is made of, and how much is written on it
  const kinds = {};
  // what is written on props (the second look): each a lit square on the prop, drawn further down
  const lettering = [];
  // every thing that has a lens of its own (a light fitting, a screen): which corners of the glow are its
  const fittings = [];
  for (const p of site.props) {
    const model = propModel(p.kind, p.variant);
    const lensFrom = glowBatch.count;
    addModel(model.solid, model.glow, p.x, p.y, p.z, p.rot);
    if (glowBatch.count > lensFrom) fittings.push({ kind: p.kind, from: lensFrom, count: glowBatch.count - lensFrom });
    keepShape(p, model.solid);
    if (!kinds[p.kind]) {
      const mat = model.solid.attributes.mat;
      const corners = model.solid.attributes.position.count;
      let named = 0;
      if (mat) for (let k = 0; k < corners; k += 3) if (mat.array[k] >= 0) named++;
      const all = corners / 3 + (model.glow?.attributes?.position?.count || 0) / 3;
      kinds[p.kind] = {
        triangles: Math.round(all),
        tagged: corners ? named / (corners / 3) : 0,
        /** how much of it says what it is made of, where the rest is the rule's guess */
        named: mat ? 1 - guessedShare(model.solid) : 0,
        lettering: tagged ? model.letters?.length || 0 : 0,
      };
    }
    if (tagged && model.letters?.length) {
      const cos = Math.cos(p.rot);
      const sin = Math.sin(p.rot);
      for (const l of model.letters)
        lettering.push({
          ...l,
          x: p.x + l.at[0] * cos + l.at[2] * sin,
          y: p.y + l.at[1],
          z: p.z - l.at[0] * sin + l.at[2] * cos,
          nx: l.out[0] * cos + l.out[2] * sin,
          nz: -l.out[0] * sin + l.out[2] * cos,
        });
    }
  }

  // fence posts, the gate's two pillars and the window's sill, as plain painted boxes — each of what it is `made` of
  const boxModel = (w, h, d, color, made) => {
    const key = `box:${w}:${h}:${d}:${color}:${made || ''}`;
    if (!propCache.has(key)) {
      const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).toNonIndexed();
      const c = new THREE.Color(color);
      const paint = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < paint.length; k += 3) paint.set([c.r, c.g, c.b], k);
      g.setAttribute('color', new THREE.BufferAttribute(paint, 3));
      if (tagged && made)
        g.setAttribute(
          'mat',
          new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(layerOf(made)), 1),
        );
      g.computeBoundingBox();
      propCache.set(key, { solid: g, glow: null });
    }
    return propCache.get(key).solid;
  };
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (grid.kind[z * W + x] !== KIND.FENCE) continue;
      const corner =
        (grid.kind[z * W + x - 1] === KIND.FENCE || grid.kind[z * W + x + 1] === KIND.FENCE) &&
        (grid.kind[(z - 1) * W + x] === KIND.FENCE || grid.kind[(z + 1) * W + x] === KIND.FENCE);
      const end =
        [
          grid.kind[z * W + x - 1],
          grid.kind[z * W + x + 1],
          grid.kind[(z - 1) * W + x],
          grid.kind[(z + 1) * W + x],
        ].filter((k) => k === KIND.FENCE).length === 1;
      if (corner || end) addModel(boxModel(0.16, 3.0, 0.16, 0x8d9396, 'galv'), null, x + 0.5, 0, z + 0.5, 0);
      else if ((x + z) % 3 === 0) addModel(boxModel(0.07, 2.75, 0.07, 0x8d9396, 'galv'), null, x + 0.5, 0, z + 0.5, 0);
    }

  // the sill of the control room's window: the foot of the wall it is cut in, with a steel plate along the top.
  // A body is stopped by its cell, a round by the sill itself, and an eye by neither (world/map.js `window`).
  for (const [x, z] of site.window || []) {
    const sill = boxModel(1, WINDOW.sill, 1, 0x8a8d88, 'concrete');
    const at = { x: x + 0.5, y: 0, z: z + 0.5, rot: 0 };
    addModel(sill, null, at.x, 0, at.z, 0);
    addModel(boxModel(1.05, 0.04, 1, 0x5d6a70, 'steel'), null, at.x, WINDOW.sill, at.z, 0);
    keepShape(at, sill, [[x, z]]);
  }

  // ---------- words on the walls ----------
  // every sign is drawn once onto one canvas; each then becomes a lit square on its wall
  let signMaterial = null;
  if (site.signs?.length && typeof document !== 'undefined') {
    const ROW = 64;
    const sheet = document.createElement('canvas');
    sheet.width = 1024;
    sheet.height = 1024;
    const c = sheet.getContext('2d');
    c.textBaseline = 'middle';
    c.font = `700 ${ROW * 0.72}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    const placed = new Map();
    let cursorX = 0;
    let cursorY = 0;
    for (const s of site.signs) {
      const key = `${s.tone}:${s.text}`;
      if (placed.has(key)) continue;
      // letters are spaced out by hand: canvas letter-spacing is not everywhere yet
      const gap = ROW * 0.07;
      let width = 0;
      for (const ch of s.text) width += c.measureText(ch).width + gap;
      width = Math.ceil(width + ROW * 0.4);
      if (cursorX + width > sheet.width) {
        cursorX = 0;
        cursorY += ROW;
      }
      if (cursorY + ROW > sheet.height) break;
      c.fillStyle = s.tone === 'hazard' ? '#e2b93b' : '#e9e5d8';
      let x = cursorX + ROW * 0.2;
      for (const ch of s.text) {
        c.fillText(ch, x, cursorY + ROW * 0.52);
        x += c.measureText(ch).width + gap;
      }
      placed.set(key, {
        u0: cursorX / sheet.width,
        u1: (cursorX + width) / sheet.width,
        v0: 1 - (cursorY + ROW) / sheet.height,
        v1: 1 - cursorY / sheet.height,
        aspect: width / ROW,
      });
      cursorX += width;
    }
    // worn paint: knock small holes out of it
    c.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < 2600; n++) {
      c.globalAlpha = 0.25 + hash2(n, 3) * 0.5;
      c.fillRect(hash2(n, 1) * sheet.width, hash2(n, 2) * sheet.height, 1 + hash2(n, 4) * 3, 1 + hash2(n, 5) * 2);
    }
    const map = new THREE.CanvasTexture(sheet);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    signMaterial = lit({ baked: true, map, transparent: true });
    signMaterial.depthWrite = false;
    signMaterial.polygonOffset = true;
    signMaterial.polygonOffsetFactor = -2;
    signMaterial.polygonOffsetUnits = -2;

    const WALLS = { n: DIRS[0], s: DIRS[1], w: DIRS[2], e: DIRS[3] };
    for (const s of site.signs) {
      const at = placed.get(`${s.tone}:${s.text}`);
      if (!at) continue;
      const dir = WALLS[s.side];
      const half = (s.height * at.aspect) / 2;
      // the wall runs from its left end to its right end as you face it; `along` is measured that way
      const ax = dir.rx - dir.lx;
      const az = dir.rz - dir.lz;
      const mx = s.x + dir.lx + ax * s.along + dir.nx * 0.015;
      const mz = s.z + dir.lz + az * s.along + dir.nz * 0.015;
      const air = airOf(s.z * W + s.x);
      quad(
        batch('signs', s.x, s.z),
        [
          mx - ax * half,
          s.y,
          mz - az * half,
          mx + ax * half,
          s.y,
          mz + az * half,
          mx + ax * half,
          s.y + s.height,
          mz + az * half,
          mx - ax * half,
          s.y + s.height,
          mz - az * half,
        ],
        dir.nx,
        0,
        dir.nz,
        [at.u0, at.v0, at.u1, at.v0, at.u1, at.v1, at.u0, at.v1],
        air,
      );
    }
  }

  // ---------- words on things (the second look) ----------
  // What a prop's builder says is written on it — a container's number, a truck's — drawn the same way as the
  // words on the walls: every text once onto one canvas, each then a lit square standing just off its surface.
  let letterMaterial = null;
  if (lettering.length && typeof document !== 'undefined') {
    const ROW = 48;
    const sheet = document.createElement('canvas');
    sheet.width = 1024;
    sheet.height = 1024;
    const c = sheet.getContext('2d');
    c.textBaseline = 'middle';
    c.font = `700 ${ROW * 0.74}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    // "white" is old stencil paint, not paper: under a flood, paint as white as paper burns out and looks lit from
    // inside. It reflects about half of what falls on it — no more than the concrete behind it.
    const INK = { white: '#bdb9ad', hazard: '#d3ab35', black: '#15171a', red: '#a83428' };
    const placed = new Map();
    let cursorX = 0;
    let cursorY = 0;
    for (const l of lettering) {
      const key = `${l.tone}:${l.text}`;
      if (placed.has(key)) continue;
      const gap = ROW * 0.05;
      let width = 0;
      for (const ch of l.text) width += c.measureText(ch).width + gap;
      width = Math.ceil(width + ROW * 0.3);
      if (cursorX + width > sheet.width) {
        cursorX = 0;
        cursorY += ROW;
      }
      if (cursorY + ROW > sheet.height) break;
      c.fillStyle = INK[l.tone] || INK.white;
      let x = cursorX + ROW * 0.15;
      for (const ch of l.text) {
        c.fillText(ch, x, cursorY + ROW * 0.52);
        x += c.measureText(ch).width + gap;
      }
      placed.set(key, {
        u0: cursorX / sheet.width,
        u1: (cursorX + width) / sheet.width,
        v0: 1 - (cursorY + ROW) / sheet.height,
        v1: 1 - cursorY / sheet.height,
        aspect: width / ROW,
      });
      cursorX += width;
    }
    // stencilled paint on a working thing: chipped, and scuffed along its length
    c.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < 5200; n++) {
      c.globalAlpha = 0.3 + hash2(n, 13) * 0.6;
      c.fillRect(hash2(n, 11) * sheet.width, hash2(n, 12) * sheet.height, 1 + hash2(n, 14) * 5, 1 + hash2(n, 15) * 2);
    }
    const map = new THREE.CanvasTexture(sheet);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    letterMaterial = lit({ baked: true, map, transparent: true });
    letterMaterial.depthWrite = false;
    letterMaterial.polygonOffset = true;
    letterMaterial.polygonOffsetFactor = -2;
    letterMaterial.polygonOffsetUnits = -2;
    for (const l of lettering) {
      const at = placed.get(`${l.tone}:${l.text}`);
      if (!at) continue;
      const half = (l.height * at.aspect) / 2;
      // along the surface, to the right as the text is read: the facing turned a quarter to the reader's right
      const ax = l.nz;
      const az = -l.nx;
      const mx = l.x + l.nx * 0.012;
      const mz = l.z + l.nz * 0.012;
      const cx = Math.min(W - 1, Math.max(0, Math.floor(mx + l.nx * 0.3)));
      const cz = Math.min(H - 1, Math.max(0, Math.floor(mz + l.nz * 0.3)));
      quad(
        batch('letters', cx, cz),
        [
          mx - ax * half,
          l.y - l.height / 2,
          mz - az * half,
          mx + ax * half,
          l.y - l.height / 2,
          mz + az * half,
          mx + ax * half,
          l.y + l.height / 2,
          mz + az * half,
          mx - ax * half,
          l.y + l.height / 2,
          mz - az * half,
        ],
        l.nx,
        0,
        l.nz,
        [at.u0, at.v0, at.u1, at.v0, at.u1, at.v1, at.u0, at.v1],
        airOf(cz * W + cx),
      );
    }
  }

  // ---------- marks (the second look) ----------
  // What is painted, spilt and worn on the floors and walls, and the dark under what stands on them
  // (look/marks.js says where; look/marksheet.js draws the one picture they are all squares of). Each is a lit
  // square a few millimetres off its surface, lit as that surface is, and laid in the order given: stains, paint
  // over them, the dark over both.
  let markMaterial = null;
  const marked = { squares: 0, kinds: {} };
  if (look?.marks?.map) {
    // where a thing meets the floor: the box round the part of it that is within a hand's breadth of the ground
    const bases = new Map();
    const baseOf = (p) => {
      const key = `${p.kind}:${p.variant}`;
      if (!bases.has(key)) {
        const at = propModel(p.kind, p.variant).solid.attributes.position;
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (let k = 0; k < at.count; k++) {
          if (at.getY(k) > 0.22) continue;
          x0 = Math.min(x0, at.getX(k));
          x1 = Math.max(x1, at.getX(k));
          z0 = Math.min(z0, at.getZ(k));
          z1 = Math.max(z1, at.getZ(k));
        }
        bases.set(key, x1 - x0 > 0.05 && z1 - z0 > 0.05 ? [x0, z0, x1, z1] : null);
      }
      return bases.get(key);
    };
    markMaterial = lit({ baked: true, map: look.marks.map, transparent: true, rough: 0.95 });
    // a stain, or the dark under a thing, mirrors nothing: with a bright place captured round it, a mark that
    // mirrored it was a fifth brighter than the floor it lay on let through (16 November 2026: 0.81 at a crate's
    // foot where the dark itself is 0.52)
    delete markMaterial.defines.LODE_ENVCUBE;
    markMaterial.depthWrite = false;
    markMaterial.polygonOffset = true;
    markMaterial.polygonOffsetFactor = -1;
    markMaterial.polygonOffsetUnits = -1;
    const LIFT = { contact: 0.009, threshold: 0.007, line: 0.007, number: 0.007, dash: 0.007 };
    const WALLS = { n: DIRS[0], s: DIRS[1], w: DIRS[2], e: DIRS[3] };
    const cellOf = (v, most) => Math.min(most - 1, Math.max(0, Math.floor(v)));
    for (const m of look.marks.lay(site, { baseOf })) {
      marked.squares++;
      marked.kinds[m.kind] = (marked.kinds[m.kind] || 0) + 1;
      if (m.on === 'floor') {
        const y = LIFT[m.kind] ?? 0.005;
        const cx = cellOf((m.P[0] + m.P[4]) / 2, W);
        const cz = cellOf((m.P[1] + m.P[5]) / 2, H);
        quad(
          batch('marks', cx, cz),
          [m.P[0], y, m.P[1], m.P[2], y, m.P[3], m.P[4], y, m.P[5], m.P[6], y, m.P[7]],
          0,
          1,
          0,
          m.uv,
          airOf(cz * W + cx),
        );
        continue;
      }
      const dir = WALLS[m.side];
      const ax = dir.rx - dir.lx;
      const az = dir.rz - dir.lz;
      const mx = m.x + dir.lx + ax * m.along + dir.nx * 0.012;
      const mz = m.z + dir.lz + az * m.along + dir.nz * 0.012;
      const half = m.w / 2;
      quad(
        batch('marks', m.x, m.z),
        [
          mx - ax * half,
          m.y,
          mz - az * half,
          mx + ax * half,
          m.y,
          mz + az * half,
          mx + ax * half,
          m.y + m.h,
          mz + az * half,
          mx - ax * half,
          m.y + m.h,
          mz - az * half,
        ],
        dir.nx,
        0,
        dir.nz,
        m.uv,
        airOf(m.z * W + m.x),
      );
    }
  }

  // ---------- make the meshes ----------
  const materials = new Map();
  const details = new Map();
  /** The bump map of a surface, made the first time it is asked for. */
  const detailFor = (name) => {
    if (!detail || !LOOK[name] || !textures[name]) return null;
    if (!details.has(name)) details.set(name, makeDetail(textures[name], LOOK[name]));
    return details.get(name);
  };
  const materialFor = (key) => {
    if (materials.has(key)) return materials.get(key);
    let material;
    if (key === 'props') material = lit({ baked: true, painted: true });
    else if (key === 'signs') material = signMaterial;
    else if (key === 'letters') material = letterMaterial;
    else if (key === 'marks') material = markMaterial;
    else {
      const name = key.includes(':') ? key.split(':')[1] : key;
      const map = textures[name] || null;
      const look = LOOK[name] || {};
      material = lit({
        baked: true,
        map,
        detail: detailFor(name),
        rough: look.rough ?? 0.8,
        metal: look.metal ?? 0,
        wet: key.endsWith(':wet') ? look.wet || 0 : 0,
        glint: key.startsWith('floor:'),
        color: map ? 0xffffff : FALLBACK[name] || 0x808080,
        alphaTest: key === 'fence' && !!map,
        side: key === 'fence' ? THREE.DoubleSide : THREE.FrontSide,
      });
    }
    materials.set(key, material);
    return material;
  };

  let vertices = 0;
  let triangles = 0;
  for (const b of batches.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.nor), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
    geometry.setAttribute('ldir', new THREE.BufferAttribute(new Float32Array(b.dir), 3));
    if (b.paint.length) {
      geometry.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(b.paint), 3));
      geometry.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(b.surf), 2));
    }
    if (b.mat.length) geometry.setAttribute('mat', new THREE.BufferAttribute(new Float32Array(b.mat), 1));
    geometry.setIndex(b.count > 65535 ? new THREE.BufferAttribute(new Uint32Array(b.idx), 1) : b.idx);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materialFor(b.material));
    mesh.name = b.material;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    vertices += b.count;
    triangles += b.idx.length / 3;
    // What is kept of a batch, for when a lamp goes out: its mesh, and what its light was worked out from. Only
    // a batch that was lit by `quad` throughout, or is of things, can be lit again (the mountain's outside is lit
    // by the moon alone, and never changes). The lists it was gathered in are let go: they are large.
    b.mesh = mesh;
    b.quads = b.air.length * 4 === b.count ? Uint8Array.from(b.air) : null;
    b.again = b.quads !== null || (b.models.length > 0 && !b.air.length);
    b.pos = b.nor = b.uv = b.col = b.dir = b.paint = b.surf = b.mat = b.idx = b.air = null;
  }

  /** the lenses of the site's lamps: one mesh, a colour to a corner — and those colours as they were made */
  let glowMesh = null;
  let glowWas = null;
  if (glowBatch.count) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glowBatch.pos), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(glowBatch.col), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(glowBatch.count * 2), 2));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, glow({ vertexColors: true }));
    mesh.name = 'glow';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    triangles += glowBatch.count / 3;
    glowMesh = mesh;
    glowWas = Float32Array.from(glowBatch.col);
  }

  // ---------- the probe: light at chest height in every cell, and the arrow of it ----------
  const probe = new Float32Array(W * H * 3);
  const probeArrow = new Float32Array(W * H * 3);
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (!open(grid.kind[i])) continue;
      lightAt(x + 0.5, 1.3, z + 0.5, 0, 1, 0, airOf(i), true);
      probe[i * 3] = L[0];
      probe[i * 3 + 1] = L[1];
      probe[i * 3 + 2] = L[2];
      probeArrow[i * 3] = LD[0];
      probeArrow[i * 3 + 1] = LD[1];
      probeArrow[i * 3 + 2] = LD[2];
    }

  // ---------- the key lights, as the game counts them (the second look) ----------
  // A key light is not in the probe above: the picture adds it pixel by pixel, with its real shadow. But a body
  // standing in it can be seen, so how much of it reaches chest height in each cell — past walls and props, as
  // coarsely as a guard's eye sees — is kept beside the probe, for `visibility` alone.
  // one sheet to a key light (look/key.js keySheet — the doors stand open here, as for the lamps above), and one
  // of all of them together: the one the game reads
  const keySheets = keyLights.map((key) => keySheet(grid, key));
  const keySum = keyLights.length ? new Float32Array(W * H) : null;
  /** which key lights are out — shot, or tripped (see "lamps that go out", further down): they are in no sum */
  const keyOut = new Uint8Array(keyLights.length);
  function sumKeys() {
    if (!keySum) return;
    keySum.fill(0);
    keySheets.forEach((sheet, k) => {
      if (!keyOut[k]) for (let i = 0; i < sheet.length; i++) keySum[i] += sheet[i];
    });
  }
  sumKeys();

  /** How well lit a body is, 0 (pitch dark) to 1 (under a lamp), by the light on it as one number. */
  const seenBy = (lum) => Math.min(1, Math.max(0, (lum - 0.09) / 1.1) ** 0.6);

  // …and how watchful each space is. A machine that can see somebody gains awareness of them by how well lit
  // they are (enemies/sight.js `noticed`). With a strong lamp in every space that sum would be larger everywhere:
  // over the floor of the main cavern, 1.65 times what it is without the switch (16 November 2026) — the site
  // would be that much harder to cross, for no reason but that it looks better. So each space is held to being
  // AS WATCHFUL AS IT WAS, on the whole. By the light of a flood an eye is stopped down — a machine's as much
  // as yours: it sees what stands in the flood, and less than it did of what stands in the dark beside it. The
  // light on a body is multiplied, zone by zone, by the one number that makes the sum over the zone's floor what
  // it is by the lamps alone. Light counts for more than it did; it is the dark that is darker. One number to a
  // cell: its zone's.
  const watch = keySum ? new Float32Array(W * H).fill(1) : null;
  if (watch) {
    // for each zone: the light on a body in every cell of its floor, as it is now — and what a machine's
    // attention came to over that floor by the lamps alone
    const zones = new Map();
    for (let i = 0; i < W * H; i++) {
      if (!grid.walkable(i % W, Math.floor(i / W))) continue;
      const lum = probe[i * 3] * 0.3 + probe[i * 3 + 1] * 0.59 + probe[i * 3 + 2] * 0.11;
      const zone = zones.get(grid.zone[i]) || { was: 0, now: [] };
      // by the lamps alone: as they are without the switch, before a room's were turned down for its key light
      zone.was += noticed(seenBy(airOf(i) === AIR.ROOM ? lum / roomFill : lum));
      zone.now.push(lum + keySum[i]);
      zones.set(grid.zone[i], zone);
    }
    for (const zone of zones.values()) {
      const sum = (stop) => zone.now.reduce((s, lum) => s + noticed(seenBy(lum * stop)), 0);
      // between a twentieth and four times: found by halving, the sum rising with the number
      let lo = 0.05;
      let hi = 4;
      for (let step = 0; step < 26; step++) {
        const mid = (lo + hi) / 2;
        if (sum(mid) > zone.was) hi = mid;
        else lo = mid;
      }
      zone.stop = (lo + hi) / 2;
    }
    for (let i = 0; i < W * H; i++) {
      const zone = zones.get(grid.zone[i]);
      if (zone) watch[i] = zone.stop;
    }
  }

  /** A sheet of one number to a cell, read at (x, z): blended between the cells round it, walls left out. */
  function sheetAt(sheet, x, z, otherwise = 0) {
    const fx = x - 0.5;
    const fz = z - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    let sum = 0;
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const cx = x0 + (k & 1);
      const cz = z0 + (k >> 1);
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue;
      const i = cz * W + cx;
      if (!open(grid.kind[i])) continue;
      const w = (k & 1 ? tx : 1 - tx) * (k >> 1 ? tz : 1 - tz);
      sum += sheet[i] * w;
      total += w;
    }
    return total > 1e-4 ? sum / total : otherwise;
  }

  /**
   * How much key light, as brightness, reaches a body at (x, z): blended between the cells round it.
   * @param {number} [only=-1] one key light's share (its place in look/keys.js); left out, all of them together
   */
  function keyAt(x, z, only = -1) {
    // a key light that is out reaches nobody
    if (only >= 0 && keyOut[only]) return 0;
    const sheet = only < 0 ? keySum : keySheets[only];
    return sheet ? sheetAt(sheet, x, z) : 0;
  }

  /**
   * The light at (x, z), blended between the cells around it; walls are left out of the blend.
   * @param {THREE.Color} out how much light
   * @param {THREE.Vector3} [arrow] which way most of it comes from, as long as its share of the whole
   */
  function probeAt(x, z, out, arrow) {
    const fx = x - 0.5;
    const fz = z - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    let r = 0;
    let g = 0;
    let b = 0;
    let ax = 0;
    let ay = 0;
    let az = 0;
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const cx = x0 + (k & 1);
      const cz = z0 + (k >> 1);
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) continue;
      const i = cz * W + cx;
      if (!open(grid.kind[i])) continue;
      const w = (k & 1 ? tx : 1 - tx) * (k >> 1 ? tz : 1 - tz);
      r += probe[i * 3] * w;
      g += probe[i * 3 + 1] * w;
      b += probe[i * 3 + 2] * w;
      ax += probeArrow[i * 3] * w;
      ay += probeArrow[i * 3 + 1] * w;
      az += probeArrow[i * 3 + 2] * w;
      total += w;
    }
    if (total > 1e-4) {
      out.setRGB(r / total, g / total, b / total);
      arrow?.set(ax / total, ay / total, az / total);
    } else {
      out.setRGB(INDOOR[0] * GAIN, INDOOR[1] * GAIN, INDOOR[2] * GAIN);
      arrow?.set(0, 0.3, 0);
    }
    return out;
  }

  // ---------- the cascade: hundreds of casings, one draw ----------
  let cascadeMesh = null;
  /** the colours of a casing's corners with the streaks on its skin, and without them (`cascade.still`) */
  let cascadeColours = null;
  if (centrifugeGeometry && site.centrifuges.length) {
    // The skin of each casing turns (world/spin.js, and the vertex shader: gfx/materials.js LODE_SPIN). Its
    // corners are told that they are skin; it is given the streaks the turning is seen by; and each casing draws
    // a lot, which is how fast it turns and where round it began.
    const corners = centrifugeGeometry.attributes;
    const skin = skinOf(corners.position.array, corners.normal.array);
    centrifugeGeometry.setAttribute('spin', new THREE.BufferAttribute(skin, 1));
    if (corners.color) {
      const marked = corners.color;
      // (as they were, kept beside them: a picture of the hall that is KEPT is taken without the streaks)
      const plain = marked.clone();
      markSkin(corners.position.array, marked.array, skin);
      marked.needsUpdate = true;
      cascadeColours = { marked, plain };
    }
    centrifugeGeometry.setAttribute(
      'spinLot',
      new THREE.InstancedBufferAttribute(
        Float32Array.from(site.centrifuges, ([x, z]) => hash2(x * 2.3 + 5, z * 3.7 + 1)),
        1,
      ),
    );
    // bare metal casings, lit from the roof of the hall: the geometry's own guess (white, so paint) is set aside
    const cascadeMaterial = lit({ vertexColors: true, surf: false, rough: 0.36, metal: 0.72, spin: true });
    cascadeMaterial.uniforms.uProbeDir.value.set(0.12, 0.8, 0.1);
    const mesh = new THREE.InstancedMesh(centrifugeGeometry, cascadeMaterial, site.centrifuges.length);
    cascadeMesh = mesh;
    mesh.name = 'cascade';
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    site.centrifuges.forEach(([x, z], n) => {
      m.makeRotationY(hash2(x, z) * Math.PI * 2).setPosition(x, 0, z);
      mesh.setMatrixAt(n, m);
      lightAt(x, 2.2, z, 0, 1, 0, AIR.ROOM, true);
      mesh.setColorAt(n, c.setRGB(L[0], L[1], L[2]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    triangles +=
      ((centrifugeGeometry.index?.count ?? centrifugeGeometry.attributes.position.count) / 3) * site.centrifuges.length;
  }

  // ---------- what a round meets (Grid.shapes) ----------
  // The casings of the cascade stand two to a cell: for a round each is an upright cylinder, for as long as it
  // stands. Every other thing is the triangles kept above.
  const casing = { radius: 0.12, top: 3.3, standing: true };
  const cascadeCells = new Map();
  if (centrifugeGeometry && site.centrifuges.length) {
    const p = centrifugeGeometry.attributes.position;
    const index = centrifugeGeometry.index;
    const corners = index ? index.count : p.count;
    const corner = (k) => (index ? index.getX(k) : k);
    // The body of the casing is its tallest straight-sided part: of all the upright faces that keep one distance
    // from the axis, the ones that reach furthest up and down are the skin. (Not the widest thing on it — that is
    // a band or the flange at its foot — and not what happens to have a corner at some chosen height.)
    const tallest = new Map();
    let top = 0;
    for (let k = 0; k + 2 < corners; k += 3) {
      let near = Infinity;
      let far = 0;
      let low = Infinity;
      let high = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = corner(k + c);
        const r = Math.hypot(p.getX(v), p.getZ(v));
        near = Math.min(near, r);
        far = Math.max(far, r);
        low = Math.min(low, p.getY(v));
        high = Math.max(high, p.getY(v));
      }
      top = Math.max(top, high);
      if (far - near > 0.004 || far < 0.05) continue;
      const key = Math.round(far * 1000);
      tallest.set(key, Math.max(tallest.get(key) || 0, high - low));
    }
    let radius = 0;
    let span = 0;
    for (const [key, height] of tallest)
      if (height > span) {
        span = height;
        radius = key / 1000;
      }
    if (radius > 0) casing.radius = radius;
    if (top > 0) casing.top = top;
    for (const [x, z] of site.centrifuges) {
      const i = Math.floor(z) * W + Math.floor(x);
      if (!cascadeCells.has(i)) cascadeCells.set(i, []);
      cascadeCells.get(i).push(x, z);
    }
  }
  const CASINGS = shapeTris.length;
  /** Where a ray meets the triangles of thing `id`: the nearest, from either side. */
  function rayTriangles(id, ox, oy, oz, dx, dy, dz, out) {
    const box = shapeBox[id];
    // the slab test: does the ray pass through the thing's box at all
    let t0 = 0;
    let t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      const o = a === 0 ? ox : a === 1 ? oy : oz;
      const d = a === 0 ? dx : a === 1 ? dy : dz;
      if (Math.abs(d) < 1e-9) {
        if (o < box[a] - 1e-4 || o > box[a + 3] + 1e-4) return false;
      } else {
        let near = (box[a] - 1e-4 - o) / d;
        let far = (box[a + 3] + 1e-4 - o) / d;
        if (near > far) [near, far] = [far, near];
        t0 = Math.max(t0, near);
        t1 = Math.min(t1, far);
        if (t0 > t1) return false;
      }
    }
    const v = shapeTris[id];
    let best = Infinity;
    let at = -1;
    for (let k = 0; k < v.length; k += 9) {
      const e1x = v[k + 3] - v[k];
      const e1y = v[k + 4] - v[k + 1];
      const e1z = v[k + 5] - v[k + 2];
      const e2x = v[k + 6] - v[k];
      const e2y = v[k + 7] - v[k + 1];
      const e2z = v[k + 8] - v[k + 2];
      const hx = dy * e2z - dz * e2y;
      const hy = dz * e2x - dx * e2z;
      const hz = dx * e2y - dy * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (det > -1e-10 && det < 1e-10) continue;
      const f = 1 / det;
      const sx = ox - v[k];
      const sy = oy - v[k + 1];
      const sz = oz - v[k + 2];
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const w = f * (dx * qx + dy * qy + dz * qz);
      if (w < 0 || u + w > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t > 1e-4 && t < best) {
        best = t;
        at = k;
      }
    }
    if (at < 0) return false;
    let nx = (v[at + 4] - v[at + 1]) * (v[at + 8] - v[at + 2]) - (v[at + 5] - v[at + 2]) * (v[at + 7] - v[at + 1]);
    let ny = (v[at + 5] - v[at + 2]) * (v[at + 6] - v[at]) - (v[at + 3] - v[at]) * (v[at + 8] - v[at + 2]);
    let nz = (v[at + 3] - v[at]) * (v[at + 7] - v[at + 1]) - (v[at + 4] - v[at + 1]) * (v[at + 6] - v[at]);
    const len = Math.hypot(nx, ny, nz) || 1;
    // the side of it that faces the round
    const face = nx * dx + ny * dy + nz * dz > 0 ? -1 / len : 1 / len;
    nx *= face;
    ny *= face;
    nz *= face;
    out.t = best;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    return true;
  }
  /** Where a ray meets the casings that stand in one cell. */
  function rayCasings(cell, ox, oy, oz, dx, dy, dz, out) {
    const list = cascadeCells.get(cell);
    const R = casing.radius;
    const a = dx * dx + dz * dz;
    let best = Infinity;
    for (let k = 0; k < list.length; k += 2) {
      const px = ox - list[k];
      const pz = oz - list[k + 1];
      if (a < 1e-12) {
        // straight down (or up): only its top can be met
        if (dy < 0 && oy > casing.top && px * px + pz * pz <= R * R) {
          const t = (casing.top - oy) / dy;
          if (t < best) {
            best = t;
            out.nx = 0;
            out.ny = 1;
            out.nz = 0;
          }
        }
        continue;
      }
      const b = px * dx + pz * dz;
      const disc = b * b - a * (px * px + pz * pz - R * R);
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t > 1e-4 && y >= 0 && y <= casing.top) {
        if (t < best) {
          best = t;
          out.nx = (px + dx * t) / R;
          out.ny = 0;
          out.nz = (pz + dz * t) / R;
        }
      } else if (dy < 0 && oy > casing.top) {
        // over the rim and down onto the top of it
        const tTop = (casing.top - oy) / dy;
        const qx = px + dx * tTop;
        const qz = pz + dz * tTop;
        if (qx * qx + qz * qz <= R * R && tTop < best) {
          best = tTop;
          out.nx = 0;
          out.ny = 1;
          out.nz = 0;
        }
      }
    }
    if (best === Infinity) return false;
    out.t = best;
    // It says that it is a casing: its skin turns (world/spin.js), and a round's mark would stand still on it —
    // so, like a door, it keeps none.
    out.what = 'casing';
    return true;
  }
  /**
   * Where a ray meets what is left of the casings in one cell once they are down: a low heap, the cell wide.
   * It says that it is wreckage, so that no mark is left on it — the heap is not what is drawn, the casings are.
   */
  function rayRubble(cell, ox, oy, oz, dx, dy, dz, out) {
    const lo = [cell % W, 0, Math.floor(cell / W)];
    const hi = [lo[0] + 1, BLAST.rubble, lo[2] + 1];
    const o = [ox, oy, oz];
    const d = [dx, dy, dz];
    let t0 = -Infinity;
    let t1 = Infinity;
    let side = -1;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < lo[a] || o[a] > hi[a]) return false;
        continue;
      }
      let near = (lo[a] - o[a]) / d[a];
      let far = (hi[a] - o[a]) / d[a];
      if (near > far) [near, far] = [far, near];
      if (near > t0) {
        t0 = near;
        side = a;
      }
      t1 = Math.min(t1, far);
      if (t0 > t1) return false;
    }
    // from inside the heap a round simply leaves it
    if (t0 <= 1e-4 || side < 0) return false;
    out.t = t0;
    out.nx = side === 0 ? -Math.sign(dx) : 0;
    out.ny = side === 1 ? -Math.sign(dy) : 0;
    out.nz = side === 2 ? -Math.sign(dz) : 0;
    out.what = 'wreck';
    return true;
  }
  const RUBBLE = CASINGS + W * H;
  grid.shapes = {
    at: (i) => (cellShape[i] >= 0 ? cellShape[i] : cascadeCells.has(i) ? (casing.standing ? CASINGS : RUBBLE) + i : -1),
    ray: (id, ox, oy, oz, dx, dy, dz, out) =>
      id < CASINGS
        ? rayTriangles(id, ox, oy, oz, dx, dy, dz, out)
        : id < RUBBLE
          ? rayCasings(id - CASINGS, ox, oy, oz, dx, dy, dz, out)
          : rayRubble(id - RUBBLE, ox, oy, oz, dx, dy, dz, out),
  };

  // ---------- bringing the cascade down ----------
  // The charges go off one after another, each at one end of a double row. From each a wave runs down its row,
  // and every casing it reaches goes over — inwards, onto the rest of its own bank, and a little towards the
  // other row of its pair — so that the wreck lies where the cascade stood and nothing ends up across an aisle,
  // where it could be walked through. Where a casing ends up is worked out once, from its place alone: the blast
  // runs towards that, and a checkpoint puts it there at once — so the wreck you come back to is the one you made.
  const cascade = (() => {
    const n = cascadeMesh ? site.centrifuges.length : 0;
    const state = { down: 0, blown: false, seconds: -1 };
    /** the turning of the skins (world/spin.js): how far round it has got, and how much of its speed is left */
    const spinning = { angle: 0, speed: 1 };
    if (!n)
      return {
        state,
        spinning,
        duration: 0,
        begin() {},
        pose() {},
        wreck() {},
        reset() {},
        spin() {},
        still() {},
        strain() {},
      };
    const base = new Float32Array(n * 3); // where it stands (x, z) and the turn it stands at
    const lit0 = new Float32Array(n * 3); // the light on it as it stands
    // when it starts to go, how long it takes, how far over it ends, which way (x, z), and how burnt it is left
    const fall = new Float32Array(n * 6);
    const colour = new THREE.Color();
    let duration = 0;
    // the banks: the runs of casings along the rows, between the aisles that cross the hall
    const banks = [];
    for (const x of [...new Set(site.centrifuges.map(([cx]) => cx))].sort((a, b) => a - b)) {
      const last = banks[banks.length - 1];
      if (last && x - last[1] < 1.01) last[1] = x;
      else banks.push([x, x]);
    }
    // the charge on each casing's rows — the nearest one across the rows — and the line down the middle of them
    const chargeOf = site.centrifuges.map(([, z]) => {
      let k = 0;
      for (let c = 1; c < site.charges.length; c++)
        if (Math.abs(site.charges[c].z - z) < Math.abs(site.charges[k].z - z)) k = c;
      return k;
    });
    const middle = site.charges.map((_, k) => {
      const rows = site.centrifuges.filter((_c, i) => chargeOf[i] === k);
      return rows.reduce((sum, [, z]) => sum + z, 0) / (rows.length || 1);
    });
    site.centrifuges.forEach(([x, z], i) => {
      base.set([x, z, hash2(x, z) * Math.PI * 2], i * 3);
      cascadeMesh.getColorAt(i, colour);
      lit0.set([colour.r, colour.g, colour.b], i * 3);
      const k = chargeOf[i];
      const from = site.charges[k] || { x, z };
      const bank = banks.find(([x0, x1]) => x >= x0 && x <= x1);
      const h1 = hash2(x * 3.1 + 7, z * 1.7 + 3);
      const h2 = hash2(x * 5.3 + 1, z * 2.9 + 11);
      const h3 = hash2(x * 1.3 + 17, z * 7.1 + 5);
      const start = BLAST.first + k * BLAST.gap + Math.abs(x - from.x) / BLAST.speed + h1 * 0.08;
      const takes = 0.7 + h2 * 0.35;
      // most go right over onto the next one; a few are left leaning on the wreckage
      const over = h3 < 0.12 ? 0.4 + h1 * 0.4 : 1.25 + h2 * 0.27;
      const way = x < (bank[0] + bank[1]) / 2 ? 1 : -1;
      const sideways = (Math.sign(middle[k] - z) || 1) * (h1 * 0.6 - 0.1);
      const length = Math.hypot(way, sideways);
      fall.set([start, takes, over, way / length, sideways / length, 0.2 + h2 * 0.32], i * 6);
      duration = Math.max(duration, start + takes);
    });
    const matrix = new THREE.Matrix4();
    const tilt = new THREE.Quaternion();
    const turn = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const upward = new THREE.Vector3(0, 1, 0);
    const at = new THREE.Vector3();
    const whole = new THREE.Vector3(1, 1, 1);
    function pose(seconds) {
      let down = 0;
      for (let i = 0; i < n; i++) {
        const u = Math.min(1, Math.max(0, (seconds - fall[i * 6]) / fall[i * 6 + 1]));
        // it starts slowly and comes down fast
        const k = u * u;
        if (u >= 1) down++;
        // tipped about the line on the floor that lies across the way it falls
        axis.set(fall[i * 6 + 4], 0, -fall[i * 6 + 3]);
        tilt.setFromAxisAngle(axis, fall[i * 6 + 2] * k);
        turn.setFromAxisAngle(upward, base[i * 3 + 2]);
        tilt.multiply(turn);
        at.set(base[i * 3], -0.03 * k, base[i * 3 + 1]);
        cascadeMesh.setMatrixAt(i, matrix.compose(at, tilt, whole));
        const burnt = 1 - k * (1 - fall[i * 6 + 5]);
        // one in twelve is left with a dull heat in it where it tore
        const ember = hash2(base[i * 3] * 9.7, base[i * 3 + 1] * 4.3) < 0.085 ? k : 0;
        cascadeMesh.setColorAt(
          i,
          colour.setRGB(
            lit0[i * 3] * burnt + ember * 0.5,
            lit0[i * 3 + 1] * burnt + ember * 0.14,
            lit0[i * 3 + 2] * burnt + ember * 0.03,
          ),
        );
      }
      cascadeMesh.instanceMatrix.needsUpdate = true;
      cascadeMesh.instanceColor.needsUpdate = true;
      state.down = down / n;
      state.seconds = seconds;
    }
    const stood = grid.block[cascadeCells.keys().next().value];
    const rows = (height) => {
      for (const cell of cascadeCells.keys()) grid.block[cell] = height;
    };
    return {
      state,
      /** seconds from the first charge to the last casing coming to rest */
      duration,
      /** The moment the charges are fired: from now the rows are wreckage, to a guard's eye and to a round. */
      begin() {
        state.blown = true;
        casing.standing = false;
        rows(BLAST.rubble);
      },
      /** Puts every casing where it is `seconds` after that. */
      pose,
      /** The cascade as it ends up, at once (a checkpoint after the blast). */
      wreck() {
        this.begin();
        pose(Infinity);
        // what lies in the wreck lies still
        spinning.speed = 0;
      },
      /** Every casing standing, as it was built. */
      reset() {
        state.blown = false;
        casing.standing = true;
        rows(stood);
        pose(-1);
      },
      /** how far round the skins' turning has got (radians, inside SPIN.wrap), and how much of its speed is left */
      spinning,
      /**
       * A frame of the skins' turning: steady while the cascade stands, run down over a few seconds once the
       * charges are fired, still in the wreck. The shader does the turning; this is the one number it is given.
       */
      spin(dt) {
        turnSkins(spinning, dt, casing.standing);
        cascadeMesh.material.uniforms.uSpin.value = spinning.angle;
      },
      /**
       * For a picture that is KEPT — what metal mirrors in the second look (look/mirror.js): the skins without
       * the streaks they are seen to turn by. A plain drum looks the same wherever it has got to; a streak in a
       * picture that is kept would stand still in it, beside a skin that turns. `false` puts the streaks back.
       * @param {boolean} on
       */
      still(on) {
        if (cascadeColours)
          cascadeMesh.geometry.setAttribute('color', on ? cascadeColours.plain : cascadeColours.marked);
      },
      /**
       * The casings as they stand, under strain: `k` 0 … 1 (the experiment's overspeed, src/wild/overspeed.js —
       * nothing else asks for it). Each shakes in its seat about its own foot, by an amount of its own that grows
       * as the square of `k`, and glows with the heat of it; 0 puts every one back as it was built. Only while
       * the cascade stands: once the charges are fired the blast has them. The light on a casing is the light
       * that is on it now (`relight`), so a lamp that goes out meanwhile is not forgotten.
       * @param {number} t the moment the shaking is worked out for, in seconds
       */
      strain(k, t) {
        if (!casing.standing) return;
        if (k <= 0) return pose(-1);
        for (let i = 0; i < n; i++) {
          const lot = hash2(base[i * 3] * 9.7, base[i * 3 + 1] * 4.3);
          axis.set(Math.cos(t * (31 + lot * 23) + i), 0, Math.sin(t * (31 + lot * 23) + i));
          tilt.setFromAxisAngle(axis, k * k * 0.06 * (0.35 + lot) * Math.sin(t * (43 + lot * 29) + i * 1.7));
          turn.setFromAxisAngle(upward, base[i * 3 + 2]);
          tilt.multiply(turn);
          at.set(base[i * 3], 0, base[i * 3 + 1]);
          cascadeMesh.setMatrixAt(i, matrix.compose(at, tilt, whole));
          const heat = k * k * (0.25 + 0.75 * lot);
          cascadeMesh.setColorAt(
            i,
            colour.setRGB(lit0[i * 3] + heat * 0.55, lit0[i * 3 + 1] + heat * 0.16, lit0[i * 3 + 2] + heat * 0.03),
          );
        }
        cascadeMesh.instanceMatrix.needsUpdate = true;
        cascadeMesh.instanceColor.needsUpdate = true;
      },
      /**
       * The light on the casings within reach of these lamps, worked out again: one of them has gone out, or come
       * back. (Called with the doors held open, as all light is worked out: "lamps that go out", further down.)
       */
      relight(lamps) {
        let any = false;
        for (let i = 0; i < n; i++) {
          const x = base[i * 3];
          const z = base[i * 3 + 1];
          if (!lamps.some((lamp) => (lamp.x - x) ** 2 + (lamp.z - z) ** 2 < lamp.r2)) continue;
          lightAt(x, 2.2, z, 0, 1, 0, AIR.ROOM, true);
          lit0[i * 3] = L[0];
          lit0[i * 3 + 1] = L[1];
          lit0[i * 3 + 2] = L[2];
          any = true;
        }
        if (any) pose(state.seconds);
      },
    };
  })();

  // ---------- every lamp shines ----------
  // Up to three pictures to a lamp, all of them added to what is behind them. The CORE is small and brighter than
  // white, so that the finishing passes make it bloom (gfx/post.js); the HALO is the soft light round it; and
  // the GLINT is what a lens makes of a point of light at night — a thin line across it. Each is [metres across,
  // how bright]. Decision of 12 November 2026 — the owner: "lights that are shining".
  const SHINE = {
    post: { core: [0.5, 3.4], halo: [2.6, 0.5], glint: [5.5, 0.36] },
    wall: { core: [0.34, 2.8], halo: [1.6, 0.42], glint: [2.4, 0.2] },
    ceiling: { core: [0.4, 2.2], halo: [1.4, 0.3] },
    flood: { core: [0.75, 4.2], halo: [3.8, 0.7], glint: [8, 0.46] },
  };
  const lit_ = site.lamps.filter((l) => SHINE[l.kind]);
  let flareBoard = null;
  let glintBoard = null;
  /** A lamp's own shine, written where it has its places among the flares: as it is when lit, or nothing. */
  function setShine(lamp, on) {
    const shine = SHINE[lamp.kind];
    if (!shine || !flareBoard || lamp.flareAt === undefined) return;
    const peak = Math.max(lamp.r, lamp.g, lamp.b, 1e-6);
    const y = lamp.y + (lamp.kind === 'ceiling' ? 0.18 : 0);
    const k = on ? 1 : 0;
    let n = lamp.flareAt;
    for (const [size, strength] of [shine.halo, shine.core])
      flareBoard.set(
        n++,
        lamp.x,
        y,
        lamp.z,
        size,
        (lamp.r / peak) * strength * k,
        (lamp.g / peak) * strength * k,
        (lamp.b / peak) * strength * k,
        1,
      );
    if (glintBoard && lamp.glintAt >= 0)
      glintBoard.set(
        lamp.glintAt,
        lamp.x,
        y,
        lamp.z,
        shine.glint[0],
        (lamp.r / peak) * shine.glint[1] * k,
        (lamp.g / peak) * shine.glint[1] * k,
        (lamp.b / peak) * shine.glint[1] * k,
        1,
      );
  }
  if (textures.flare && lit_.length) {
    const flares = new Billboards({ capacity: lit_.length * 2, map: textures.flare });
    const starred = lit_.filter((l) => SHINE[l.kind].glint);
    const glints =
      textures.glint && starred.length ? new Billboards({ capacity: starred.length, map: textures.glint }) : null;
    flareBoard = flares;
    glintBoard = glints;
    let n = 0;
    let g = 0;
    for (const lamp of lit_) {
      lamp.flareAt = n;
      n += 2;
      lamp.glintAt = glints && SHINE[lamp.kind].glint ? g++ : -1;
      setShine(lamp, true);
    }
    flares.commit(n);
    flares.mesh.name = 'flares';
    group.add(flares.mesh);
    if (glints) {
      glints.commit(g);
      glints.mesh.name = 'glints';
      group.add(glints.mesh);
    }
  }

  // ---------- the air under the lamps ----------
  // A lamp at night lights up the haze beneath it. One cone of faint light per lamp that hangs high enough for
  // there to be air to light: posts and floodlights outside, strip lights under a high roof.
  /** the cones, one mesh; and each as it was made (its colours), so that a lamp that comes back has its haze again */
  let beamMesh = null;
  let beamWas = null;
  {
    const SEGMENTS = 20;
    // how far the cone spreads for every metre it falls, and how bright it is
    const SPREAD = { post: [0.62, 1], flood: [1.15, 0.5], ceiling: [0.5, 0.55] };
    const pos = [];
    const nor = [];
    const col = [];
    const uv = [];
    const idx = [];
    for (const lamp of site.lamps) {
      const shape = SPREAD[lamp.kind];
      // any lamp with a man's height of air under it and to spare: the strip lights of the rooms as well as the
      // ones under the high roofs
      if (!shape || lamp.y < 3) continue;
      const top = lamp.y - 0.15;
      const r0 = 0.22;
      const r1 = r0 + top * shape[0];
      const peak = Math.max(lamp.r, lamp.g, lamp.b, 1e-6);
      const base = pos.length / 3;
      // where this lamp's cone is among the corners of them all
      lamp.cone = [base, (SEGMENTS + 1) * 2];
      for (let s = 0; s <= SEGMENTS; s++) {
        const a = (s / SEGMENTS) * Math.PI * 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        // the side of a cone leans outwards and a little upwards
        const lean = Math.hypot(top, r1 - r0);
        for (const [r, y, along] of [
          [r0, top, 0],
          [r1, 0.04, 1],
        ]) {
          pos.push(lamp.x + cos * r, y, lamp.z + sin * r);
          nor.push((cos * top) / lean, (r1 - r0) / lean, (sin * top) / lean);
          col.push((lamp.r / peak) * shape[1], (lamp.g / peak) * shape[1], (lamp.b / peak) * shape[1]);
          uv.push(s / SEGMENTS, along);
        }
        if (s < SEGMENTS) {
          const i = base + s * 2;
          idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
        }
      }
    }
    if (idx.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      geometry.setIndex(idx);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, beam({ intensity: 0.11 }));
      mesh.name = 'beams';
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 3;
      group.add(mesh);
      triangles += idx.length / 3;
      beamMesh = mesh;
      beamWas = Float32Array.from(col);
    }
  }

  // ---------- doors ----------
  const doorMaterial = lit({
    map: textures.door || null,
    detail: detailFor('door'),
    rough: LOOK.door.rough,
    metal: LOOK.door.metal,
    color: textures.door ? 0xffffff : FALLBACK.door,
  });
  const tint = new THREE.Color();
  const arrow = new THREE.Vector3();
  const doors = grid.doors.map((door) => {
    const alongX = door.along === 'x';
    const length = alongX ? door.x1 - door.x0 + 1 : door.z1 - door.z0 + 1;
    const leafLength = length / 2;
    const material = cloneMaterial(doorMaterial);
    const leaves = [-1, 1].map((side) => {
      const geometry = new THREE.BoxGeometry(alongX ? leafLength : 0.14, 2.6, alongX ? 0.14 : leafLength);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.side = side;
      mesh.userData.home = (side * leafLength) / 2;
      mesh.position.set(door.x, 1.3, door.z);
      group.add(mesh);
      return mesh;
    });
    const entry = { door, leaves, alongX, travel: leafLength * 0.96, moving: 0 };
    return entry;
  });
  /** A door is lit by the light where it stands — asked again when a lamp near it goes out or comes back. */
  function tintDoor(entry) {
    const uniforms = entry.leaves[0].material.uniforms;
    probeAt(entry.door.x, entry.door.z, tint, arrow);
    uniforms.uProbe.value.copy(tint).multiplyScalar(1.15);
    uniforms.uProbeDir.value.copy(arrow);
  }
  doors.forEach(tintDoor);
  function placeDoor(entry) {
    for (const leaf of entry.leaves) {
      const offset = leaf.userData.home + leaf.userData.side * entry.travel * entry.door.open;
      if (entry.alongX) leaf.position.x = entry.door.x + offset;
      else leaf.position.z = entry.door.z + offset;
    }
  }

  for (const door of grid.doors) door.open = 0;
  doors.forEach(placeDoor);

  /**
   * Opens every door that has somebody near it and shuts the rest.
   * @param {{ x: number, z: number }[]} bodies
   * @param {(door: object, opening: boolean) => void} [onMove] called when a door starts to open or to shut
   */
  function updateDoors(dt, bodies, onMove) {
    for (const entry of doors) {
      const door = entry.door;
      let wanted = 0;
      for (let k = 0; k < bodies.length; k++) {
        const dx = bodies[k].x - door.x;
        const dz = bodies[k].z - door.z;
        if (dx * dx + dz * dz < 7.3) {
          wanted = 1;
          break;
        }
      }
      if (wanted !== entry.moving && door.open !== wanted) {
        entry.moving = wanted;
        onMove?.(door, wanted === 1);
      }
      if (door.open === wanted) continue;
      door.open = wanted ? Math.min(1, door.open + dt * 3.2) : Math.max(0, door.open - dt * 2.4);
      placeDoor(entry);
    }
  }

  const SURFACE = ['dirt', 'concrete', 'concrete', 'concrete', 'concrete', 'metal'];

  // ---------- the lamps whose reflections the floors show ----------
  // A wet yard at night is mostly reflections of lamps. A floor's shader draws one for each lamp in a short
  // list (materials.js shared.uGlint): the brightest, nearest lamps that the eye can see at this moment. A lamp
  // the eye cannot see is behind a wall, and so is its reflection. Lamps fade into and out of the list rather
  // than jump, and the line-of-sight questions are only asked a few times a second.
  const glinting = site.lamps.filter((lamp) => lamp.kind !== 'screen');
  for (const lamp of glinting) {
    lamp.glint = 0;
    lamp.seen = false;
    lamp.score = 0;
  }
  let glintT = 0;
  const shown = [];
  function updateGlints(eye, dt) {
    glintT -= dt;
    const ask = glintT <= 0;
    if (ask) glintT = 0.15;
    shown.length = 0;
    for (const lamp of glinting) {
      const d2 = (lamp.x - eye.x) ** 2 + (lamp.y - eye.y) ** 2 + (lamp.z - eye.z) ** 2;
      // (a lamp that is out is reflected in nothing)
      if (ask) lamp.seen = !lamp.out && d2 < 70 * 70 && grid.sight(eye.x, eye.y, eye.z, lamp.x, lamp.y, lamp.z);
      lamp.glint += ((lamp.seen ? 1 : 0) - lamp.glint) * Math.min(1, dt * 5);
      if (lamp.glint < 0.01) continue;
      lamp.score = ((lamp.r + lamp.g + lamp.b) * lamp.glint) / (1 + d2 * 0.004);
      shown.push(lamp);
    }
    shown.sort((a, b) => b.score - a.score);
    const at = sharedUniforms.uGlint.value;
    const colour = sharedUniforms.uGlintCol.value;
    for (let n = 0; n < at.length; n++) {
      const lamp = shown[n];
      if (lamp) {
        at[n].set(lamp.x, lamp.y, lamp.z, lamp.radius);
        colour[n].set(lamp.r, lamp.g, lamp.b).multiplyScalar(lamp.glint * 2.2);
      } else colour[n].set(0, 0, 0);
    }
    return shown.length;
  }

  // ---------- lamps that go out ----------
  // Decision of 16 November 2026 — the owner: "i want to have the ability to shoot at the light to turn it off …
  // also emp needs to turn of the light in a room". Until then the light of the site's own lamps was worked out
  // once, above, and nothing could change it. Which lamps are out, and for how long, is world/lamps.js's business
  // (and main.js's, which joins it to the game); what is done here is what a lamp going out, or coming back,
  // does to the level:
  //   at once  the light at chest height in the cells it reaches (the probe: what machines, the gun and the light
  //            meter go by — the game's count is right in the same frame), the casings of the cascade, the doors;
  //            and the lamp's own shine: its lens, its flares, its glint, the haze under it;
  //   in turn  the corners of every surface and thing within its reach, worked out again exactly as they were
  //            made — a few milliseconds of them a frame (`step`), so that nothing stutters: a flood reaches
  //            some forty thousand corners.
  // Nothing is kept of what each lamp gave to each corner (that would be the memory the bake was written to do
  // without): the light is worked out again from what it was worked out FROM, with the lamps that are out left
  // out of the sum.
  const lampList = lampsOf(site.lamps, grid);
  // Each lamp's own lens — what is drawn of it, and what a round must hit to break it. A lamp is a point the
  // light is counted from (map.js), a hand's breadth to three metres from the fitting that is drawn for it, so
  // the two are joined here: nearest first, each fitting to one lamp, by what kind of thing lights what kind of
  // lamp. The box round the lens is grown a little: a lens is a small thing to hit.
  const FITTING = { ceiling: 'ceilingLight', wall: 'wallLight', post: 'lampPost', flood: 'tower', screen: 'console' };
  const FITTING_REACH = 4;
  const LENS_GROW = 0.12;
  /** how much of the light that falls on it a lens that is out gives back: it is frosted glass, and no more */
  const LENS_DEAD = 0.4;
  if (glowMesh) {
    const at = glowMesh.geometry.attributes.position.array;
    for (const f of fittings) {
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let k = f.from * 3; k < (f.from + f.count) * 3; k += 3)
        for (let c = 0; c < 3; c++) {
          box[c] = Math.min(box[c], at[k + c]);
          box[c + 3] = Math.max(box[c + 3], at[k + c]);
        }
      f.box = box;
    }
    const pairs = [];
    site.lamps.forEach((lamp, n) => {
      for (const f of fittings) {
        if (f.kind !== FITTING[lamp.kind]) continue;
        const far = Math.hypot(
          (f.box[0] + f.box[3]) / 2 - lamp.x,
          (f.box[1] + f.box[4]) / 2 - lamp.y,
          (f.box[2] + f.box[5]) / 2 - lamp.z,
        );
        if (far < FITTING_REACH) pairs.push({ lamp, n, f, far });
      }
    });
    pairs.sort((a, b) => a.far - b.far);
    for (const { lamp, n, f } of pairs) {
      if (lamp.lens || f.taken) continue;
      f.taken = true;
      lamp.lens = [f.from, f.count];
      // the brightest number of its glow: what its colours are a share of
      let peak = 1e-6;
      for (let k = f.from * 3; k < (f.from + f.count) * 3; k++) peak = Math.max(peak, glowWas[k]);
      lamp.lensPeak = peak;
      lampList[n].box = f.box.map((v, c) => v + (c < 3 ? -LENS_GROW : LENS_GROW));
    }
  }
  /**
   * A lamp's lens: glowing as it was made — or, when the lamp is out, glass in the light of the place it hangs
   * in (which is why every dead lens is asked again whenever a lamp near it goes out or comes back).
   */
  function setLens(lamp) {
    if (!lamp.lens) return;
    const colour = glowMesh.geometry.attributes.color;
    const [from, count] = lamp.lens;
    if (lamp.out) {
      probeAt(lamp.x, lamp.z, tint);
      const k = LENS_DEAD / lamp.lensPeak;
      for (let v = from * 3; v < (from + count) * 3; v += 3) {
        colour.array[v] = glowWas[v] * k * tint.r;
        colour.array[v + 1] = glowWas[v + 1] * k * tint.g;
        colour.array[v + 2] = glowWas[v + 2] * k * tint.b;
      }
    } else for (let k = from * 3; k < (from + count) * 3; k++) colour.array[k] = glowWas[k];
    colour.addUpdateRange(from * 3, count * 3);
    colour.needsUpdate = true;
  }
  function setCone(lamp, on) {
    if (!lamp.cone || !beamMesh) return;
    const colour = beamMesh.geometry.attributes.color;
    const [from, count] = lamp.cone;
    for (let k = from * 3; k < (from + count) * 3; k++) colour.array[k] = on ? beamWas[k] : 0;
    colour.needsUpdate = true;
  }

  /** the batches whose light can be worked out again: every one but the mountain's outside */
  const relit = [...batches.values()].filter((b) => b.again);
  for (const b of relit) {
    b.waiting = b.quads ? new Uint8Array(b.quads.length) : null;
    // the run of corners written since the picture was last told (`touch`)
    b.from = b.to = -1;
  }
  /** what waits to be lit again: a batch and then which of its squares (or things), two entries each */
  const queue = [];
  let queueHead = 0;
  const doorWas = new Float64Array(grid.doors.length);
  /**
   * Light is worked out with every door standing open, as it was when the site was built (it leaks through
   * doorways) — for the length of `work` and not a moment longer: nothing else runs meanwhile, so no machine
   * sees through a door by it and no door is drawn open.
   */
  function doorsOpen(work) {
    grid.doors.forEach((door, n) => {
      doorWas[n] = door.open;
      door.open = 1;
    });
    try {
      return work();
    } finally {
      grid.doors.forEach((door, n) => {
        door.open = doorWas[n];
      });
    }
  }

  /**
   * The light on the four corners of square `q` of a batch, worked out as `quad` worked it out. Written, or only
   * compared. Returns how far any number of it is from what is there.
   */
  function lightQuad(b, q, write) {
    const at = b.mesh.geometry.attributes;
    const pos = at.position.array;
    const nor = at.normal.array;
    const col = at.color.array;
    const dir = at.ldir.array;
    const v = q * 12;
    const mx = (pos[v] + pos[v + 3] + pos[v + 6] + pos[v + 9]) / 4;
    const my = (pos[v + 1] + pos[v + 4] + pos[v + 7] + pos[v + 10]) / 4;
    const mz = (pos[v + 2] + pos[v + 5] + pos[v + 8] + pos[v + 11]) / 4;
    const nx = nor[v];
    const ny = nor[v + 1];
    const nz = nor[v + 2];
    const air = b.quads[q] & 3;
    const omni = (b.quads[q] & 4) !== 0;
    let moved = 0;
    for (let k = 0; k < 4; k++) {
      const i = v + k * 3;
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      lightAt(
        x + (mx - x) * 0.12 + nx * 0.05,
        Math.max(0.03, y + (my - y) * 0.12 + ny * 0.05),
        z + (mz - z) * 0.12 + nz * 0.05,
        nx,
        ny,
        nz,
        air,
        omni,
      );
      for (let c = 0; c < 3; c++) {
        const way = omni ? 0 : LD[c];
        moved = Math.max(moved, Math.abs(col[i + c] - L[c]), Math.abs(dir[i + c] - way));
        if (write) {
          col[i + c] = L[c];
          dir[i + c] = way;
        }
      }
    }
    return moved;
  }

  /** …and on every corner of one thing, as `addModel` worked it out. */
  function lightModel(b, m, write) {
    const at = b.mesh.geometry.attributes;
    const pos = at.position.array;
    const nor = at.normal.array;
    const col = at.color.array;
    const dir = at.ldir.array;
    const gain = gainOf(m.air);
    const moonlit = m.air === AIR.SKY && skyOpen(m.sx, m.sy, m.sz);
    lampsSeenFrom(m.sx, m.sy, m.sz);
    let moved = 0;
    for (let k = m.start; k < m.start + m.count; k++) {
      const i = k * 3;
      cornerLight(pos[i], pos[i + 1], pos[i + 2], nor[i], nor[i + 1], nor[i + 2], m.air, moonlit);
      const r = S.r * gain;
      const g = S.g * gain;
      const bl = S.b * gain;
      moved = Math.max(
        moved,
        Math.abs(col[i] - r),
        Math.abs(col[i + 1] - g),
        Math.abs(col[i + 2] - bl),
        Math.abs(dir[i] - S.dx),
        Math.abs(dir[i + 1] - S.dy),
        Math.abs(dir[i + 2] - S.dz),
      );
      if (write) {
        col[i] = r;
        col[i + 1] = g;
        col[i + 2] = bl;
        dir[i] = S.dx;
        dir[i + 1] = S.dy;
        dir[i + 2] = S.dz;
      }
    }
    return moved;
  }

  /** Tells the picture that corners `from` … of a batch have new light: only those are sent to the card. */
  function touch(b, from, count) {
    for (const name of ['color', 'ldir']) {
      const attribute = b.mesh.geometry.attributes[name];
      attribute.addUpdateRange(from * 3, count * 3);
      attribute.needsUpdate = true;
    }
  }
  const stirred = new Set();
  /** Notes that corners `from` … have been written: runs that follow on from one another are told as one. */
  function wrote(b, from, count) {
    if (b.to >= 0 && from >= b.from && from <= b.to + 64) b.to = Math.max(b.to, from + count);
    else {
      if (b.to >= 0) touch(b, b.from, b.to - b.from);
      b.from = from;
      b.to = from + count;
    }
    stirred.add(b);
  }

  /** Puts in the queue every square and thing that any of these lamps can reach. */
  function stir(lamps) {
    for (const b of relit) {
      if (b.quads) {
        const pos = b.mesh.geometry.attributes.position.array;
        for (let q = 0; q < b.quads.length; q++) {
          if (b.waiting[q]) continue;
          const v = q * 12;
          const mx = (pos[v] + pos[v + 3] + pos[v + 6] + pos[v + 9]) / 4;
          const my = (pos[v + 1] + pos[v + 4] + pos[v + 7] + pos[v + 10]) / 4;
          const mz = (pos[v + 2] + pos[v + 5] + pos[v + 8] + pos[v + 11]) / 4;
          // how far the square reaches from its own middle: a corner, and the one across from it
          const size = Math.max(
            Math.hypot(pos[v] - mx, pos[v + 1] - my, pos[v + 2] - mz),
            Math.hypot(pos[v + 6] - mx, pos[v + 7] - my, pos[v + 8] - mz),
          );
          for (const lamp of lamps) {
            // a corner is lit from a point a little inside the square and a little off it (`quad`): no further
            // from its middle than the square reaches, and a hand's breadth for the lift
            const reach = lamp.radius + size + 0.1;
            if ((lamp.x - mx) ** 2 + (lamp.y - my) ** 2 + (lamp.z - mz) ** 2 >= reach * reach) continue;
            b.waiting[q] = 1;
            queue.push(b, q);
            break;
          }
        }
      } else
        b.models.forEach((m, n) => {
          if (m.waiting) return;
          for (const lamp of lamps) {
            // as far as a thing looks for its lamps (lampsSeenFrom)
            const reach = lamp.radius + 4;
            if ((lamp.x - m.sx) ** 2 + (lamp.z - m.sz) ** 2 > reach * reach) continue;
            m.waiting = true;
            queue.push(b, n);
            break;
          }
        });
    }
  }

  /**
   * Works through what waits, for about `ms` milliseconds (Infinity: all of it, now). Once a frame.
   * @returns {number} how many squares and things still wait
   */
  function step(ms = 4) {
    if (queueHead >= queue.length) return 0;
    const began = performance.now();
    doorsOpen(() => {
      let done = 0;
      while (queueHead < queue.length) {
        const b = queue[queueHead];
        const which = queue[queueHead + 1];
        queueHead += 2;
        if (b.quads) {
          b.waiting[which] = 0;
          lightQuad(b, which, true);
          wrote(b, which * 4, 4);
        } else {
          const m = b.models[which];
          m.waiting = false;
          lightModel(b, m, true);
          wrote(b, m.start, m.count);
        }
        if ((++done & 15) === 0 && performance.now() - began > ms) break;
      }
    });
    for (const b of stirred) {
      touch(b, b.from, b.to - b.from);
      b.from = b.to = -1;
    }
    stirred.clear();
    if (queueHead >= queue.length) {
      queue.length = 0;
      queueHead = 0;
    }
    return (queue.length - queueHead) / 2;
  }

  const cellSeen = new Uint32Array(W * H);
  let cellStamp = 0;
  /**
   * Makes the level agree with which lamps are out: `isOut(i)` is asked of each lamp in `indices` (its place in
   * the site's list), and for those that have changed everything above is done.
   * @param {Iterable<number>} indices
   * @param {(i: number) => boolean} isOut
   * @returns {number} how many of them changed
   */
  function sync(indices, isOut) {
    const changed = [];
    for (const i of indices) {
      const lamp = site.lamps[i];
      if (!lamp) continue;
      const out = !!isOut(i);
      if (!!lamp.out === out) continue;
      lamp.out = out;
      changed.push(lamp);
      setShine(lamp, !out);
      setCone(lamp, !out);
      if (out) lamp.seen = false;
    }
    if (!changed.length) return 0;
    flareBoard?.commit(flareBoard.count);
    glintBoard?.commit(glintBoard.count);
    doorsOpen(() => {
      // the light at chest height in every cell any of them reaches, once each
      cellStamp++;
      for (const lamp of changed) {
        const x0 = Math.max(0, Math.floor(lamp.x - lamp.radius));
        const x1 = Math.min(W - 1, Math.floor(lamp.x + lamp.radius));
        const z0 = Math.max(0, Math.floor(lamp.z - lamp.radius));
        const z1 = Math.min(H - 1, Math.floor(lamp.z + lamp.radius));
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            const i = z * W + x;
            if (cellSeen[i] === cellStamp || !open(grid.kind[i])) continue;
            cellSeen[i] = cellStamp;
            lightAt(x + 0.5, 1.3, z + 0.5, 0, 1, 0, airOf(i), true);
            probe[i * 3] = L[0];
            probe[i * 3 + 1] = L[1];
            probe[i * 3 + 2] = L[2];
            probeArrow[i * 3] = LD[0];
            probeArrow[i * 3 + 1] = LD[1];
            probeArrow[i * 3 + 2] = LD[2];
          }
      }
      cascade.relight(changed);
    });
    // every lens: lit, or the glass of a lamp that is out — in the light there is now where it hangs
    for (const lamp of site.lamps) if (lamp.out || changed.includes(lamp)) setLens(lamp);
    for (const entry of doors)
      if (changed.some((lamp) => Math.hypot(lamp.x - entry.door.x, lamp.z - entry.door.z) < lamp.radius + 2))
        tintDoor(entry);
    stir(changed);
    return changed.length;
  }

  return {
    group,
    grid,
    site,
    doors,
    updateDoors,
    updateGlints,
    /** The light falling on a body at (x, z), as a colour. */
    probe: probeAt,
    /**
     * How well lit a body at (x, z) is, 0 (pitch dark) to 1 (under a lamp). In the second look the key lights
     * count too, and the eye that looks is stopped down for them, so that each space is as watchful as it was
     * (see `watch`, above).
     * @param {number} [without=-1] leave one key light out of the sum (its place in look/keys.js): how well lit
     *   the body would be if that lamp were dark
     */
    visibility(x, z, without = -1) {
      probeAt(x, z, tint);
      let lum = tint.r * 0.3 + tint.g * 0.59 + tint.b * 0.11 + keyAt(x, z);
      if (without >= 0) lum -= keyAt(x, z, without);
      return seenBy(watch ? lum * sheetAt(watch, x, z, 1) : lum);
    },
    /** …and the same before that scaling: what the light alone says (the second look, for tests). */
    lit(x, z) {
      probeAt(x, z, tint);
      return seenBy(tint.r * 0.3 + tint.g * 0.59 + tint.b * 0.11 + keyAt(x, z));
    },
    /** The second look. keys: what look/keylight.js says of each key light; keyAt: how much of them reaches (x, z). */
    keys: [],
    keyAt,
    /**
     * Key light `k` (its place in look/keys.js) has gone out, or come back: it is left out of what the game
     * counts of the key lights — how well a body is seen, how the picture is exposed — or put back in.
     */
    setKeyOut(k, dead) {
      if (!(k >= 0 && k < keyOut.length) || !!keyOut[k] === !!dead) return;
      keyOut[k] = dead ? 1 : 0;
      sumKeys();
    },
    /** …and each key light's own sheet of how much of it reaches every cell (look/slots.js reads where each shines) */
    keySheets,
    /** …and what it captured for metal to mirror, and the pictures things are made of (set by src/look). */
    env: null,
    matter: null,
    zoneAt(x, z) {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      return grid.inside(cx, cz) ? grid.zone[cz * W + cx] : 0;
    },
    indoors(x, z) {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      return grid.inside(cx, cz) && grid.ceil[cz * W + cx] > 0;
    },
    /** Is (x, z) under the open sky? Off the map — down the valley, where the pictures are taken — it is. */
    openSky(x, z) {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      return grid.inside(cx, cz) ? grid.sky[cz * W + cx] === 1 : true;
    },
    /** What is overhead at (x, z), as world/grid.js `sky` has it: 0 rock, 1 open sky, 2 the foot of the shaft. */
    skyAt(x, z) {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      return grid.inside(cx, cz) ? grid.sky[cz * W + cx] : 1;
    },
    /** How high the ground outside is over (x, z), and how high the cavern's roof (world/mountain.js). */
    mountainAt,
    roofAt,
    /**
     * What rounds stop on besides walls: how many things have a shape of their own, and the cascade's casings
     * (`casing.standing`: false once they have been brought down, and then they are rubble in a box again).
     */
    shapes: {
      things: shapeTris.length,
      casing,
      /** The box round the thing whose shape fills cell (x, z): [x0, y0, z0, x1, y1, z1], or null. */
      boxOf(x, z) {
        const id = grid.inside(x, z) ? cellShape[z * W + x] : -1;
        return id >= 0 ? shapeBox[id].slice() : null;
      },
    },
    /** The cascade of centrifuges, and bringing it down: begin(), pose(seconds), wreck(), reset(), state, duration. */
    cascade,
    /**
     * The site's own lamps, as things that can be put out (see "lamps that go out", above).
     * list:    what world/lamps.js `createLamps` wants of each, in the site's order — `box` is what a round must
     *          enter to break it (null: nothing of it is drawn, and it cannot be shot)
     * sync:    (indices, isOut) makes the level agree with which of those lamps are out
     * step:    (ms) works through the surfaces that wait to be lit again; returns how many still wait
     * check:   for tests — works out the light on every corner again and says how far the furthest is from what
     *          is there. With nothing waiting, that is nothing: the level is lit as its lamps say.
     */
    lamps: {
      list: lampList,
      sync,
      step,
      /** how many surfaces and things still wait to be lit again */
      waiting: () => (queue.length - queueHead) / 2,
      check() {
        let worst = 0;
        let corners = 0;
        /** the mesh the furthest corner is of */
        let where = '';
        const note = (b, moved) => {
          if (moved <= worst) return;
          worst = moved;
          where = b.mesh.name;
        };
        doorsOpen(() => {
          for (const b of relit) {
            if (b.quads)
              for (let q = 0; q < b.quads.length; q++) {
                note(b, lightQuad(b, q, false));
                corners += 4;
              }
            else
              for (const m of b.models) {
                note(b, lightModel(b, m, false));
                corners += m.count;
              }
          }
        });
        return {
          corners,
          worst,
          where,
          waiting: (queue.length - queueHead) / 2,
          // what is never lit again, by name: the mountain's outside, which no lamp of the site lights
          left: [...new Set([...batches.values()].filter((b) => !b.again).map((b) => b.mesh.name))].sort(),
        };
      },
    },
    /** Shows or hides everything that shines of its own accord: the flares, the haze under lamps, lit fittings. */
    setLamps(on) {
      for (const name of ['flares', 'glints', 'beams', 'glow']) {
        const mesh = group.getObjectByName(name);
        if (mesh) mesh.visible = on;
      }
    },
    /** What the ground at (x, z) sounds like underfoot: dirt | concrete | metal. */
    surfaceAt(x, z) {
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      return grid.inside(cx, cz) ? SURFACE[grid.floor[cz * W + cx]] : 'dirt';
    },
    stats: {
      vertices,
      triangles: Math.round(triangles),
      meshes: group.children.length,
      bakeMs: Math.round(performance.now() - t0),
      kinds,
      /** the second look's marks: how many squares, and of what */
      marks: marked,
      /** …and of the corners of what stands on the site, how many say what they are made of */
      named: said,
    },
  };
}

export { FLOOR };
