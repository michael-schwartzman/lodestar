// The mountain Site Hollow Nine is cut into, as arithmetic. No drawing and no browser in here: it is pinned by
// test/unit/mountain.test.mjs. world/map.js marks the grid from these shapes, world/build.js draws them, and
// main.js stands its cameras where this file says there is air to stand in.
//
// Three surfaces, all in metres, X east and Z south like the grid:
//   roofAt(x, z)      the rock over the main cavern, seen from underneath
//   mountainAt(x, z)  the ground outside, seen from above: 0 in the forecourt and down the road's valley
//   and between them, at one place only, the exhaust shaft — straight up from the lodestar pad to a bench.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, v) => smooth(clamp((v - a) / (b - a), 0, 1));
const lerp = (a, b, t) => a + (b - a) * t;

/** A number in 0..1 for a whole-number point, the same on every machine (no sines to round differently). */
function hash(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise, 0..1, that changes over about `size` metres. */
function noise(x, z, size, seed) {
  const fx = x / size;
  const fz = z / size;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const sx = smooth(fx - x0);
  const sz = smooth(fz - z0);
  const a = hash(x0 + seed, z0 - seed);
  const b = hash(x0 + 1 + seed, z0 - seed);
  const c = hash(x0 + seed, z0 + 1 - seed);
  const d = hash(x0 + 1 + seed, z0 + 1 - seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// ---------- the shapes the grid is marked from (edges, in metres; a cell x is the metre from x to x + 1) ----------

/** Outside the portal: the one place a player can stand under the sky. */
export const FORECOURT = { x0: 56, x1: 72, z0: 90, z1: 95 };
/** The road: through the tunnel, across the forecourt, and off the south edge of the map (z = 96). */
export const ROAD = { x0: 60, x1: 68 };
const MAP_SOUTH = 96;
const ROAD_MIDDLE = (ROAD.x0 + ROAD.x1) / 2;
/** how fast the road's valley widens south of the map: metres of half-width for every metre south */
const VALLEY_SPREAD = 0.6;

/** The exhaust shaft: a square straight up from the lodestar pad. `top` is where it comes out. */
export const SHAFT = { x0: 103, x1: 110, z0: 31, z1: 38, top: 58, collar: 2.6 };

/** The roof of the main cavern: its mean height, how much it swells, how rough it is, and its lattice. */
export const ROOF = { base: 12.6, swell: 1.5, grain: 0.5, lattice: 2 };

/** What the strike leaves: a hollow in the mountain over the facility. */
export const CRATER = { x: 86, z: 36, radius: 64, depth: 27 };

// ---------- the roof ----------

function roofNode(x, z) {
  return ROOF.base + (noise(x, z, 9, 11) - 0.5) * 2 * ROOF.swell + (hash(x + 7, z + 3) - 0.5) * 2 * ROOF.grain;
}

/**
 * How high the cavern's rock roof is over (x, z). It is given at the points of a two-metre lattice and runs
 * straight between them, so that anything built up to it — a wall, the shaft — meets it along an edge.
 */
export function roofAt(x, z) {
  const L = ROOF.lattice;
  const x0 = Math.floor(x / L) * L;
  const z0 = Math.floor(z / L) * L;
  const tx = (x - x0) / L;
  const tz = (z - z0) / L;
  const a = roofNode(x0, z0);
  const b = roofNode(x0 + L, z0);
  const c = roofNode(x0, z0 + L);
  const d = roofNode(x0 + L, z0 + L);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

// ---------- the ground outside ----------

/**
 * How far (x, z) is from the open cut — the forecourt, and the road's valley running south from it. 0 inside it.
 */
export function cutDistance(x, z) {
  const off = Math.abs(x - ROAD_MIDDLE);
  // the forecourt: a rectangle
  const fx = Math.max(0, off - (FORECOURT.x1 - FORECOURT.x0) / 2);
  const fz = Math.max(0, FORECOURT.z0 - z, z - FORECOURT.z1);
  const forecourt = Math.hypot(fx, fz);
  // the road south of it: as wide as the road to the edge of the map, then a valley that widens as it goes
  const half = (ROAD.x1 - ROAD.x0) / 2 + Math.max(0, z - MAP_SOUTH) * VALLEY_SPREAD;
  const slant = z > MAP_SOUTH ? 1 / Math.hypot(1, VALLEY_SPREAD) : 1;
  const road = Math.hypot(Math.max(0, off - half) * slant, Math.max(0, FORECOURT.z1 - z));
  return Math.min(forecourt, road);
}

/**
 * How high the ground outside is at (x, z). Flat (0) in the cut; a cliff at its edge; then the mountain: a ridge
 * that climbs northwards over the facility, rough with hills, with one levelled bench where the shaft comes out.
 */
export function mountainAt(x, z) {
  const d = cutDistance(x, z);
  if (d <= 0) return 0;
  const cliff = 20 * (1 - Math.exp(-d / 1.5));
  const ridge = 64 * smooth(clamp((104 - z) / 94, 0, 1)) * (1 - 0.45 * Math.min(1, ((x - 62) / 110) ** 2));
  const hills = (noise(x, z, 46, 5) - 0.5) * 22 + (noise(x, z, 17, 9) - 0.5) * 7;
  const wild = cliff + smoothstep(3, 45, d) * (ridge + hills);
  // the bench: level for nine metres round the middle of the shaft, blended back into the slope by twenty-four
  const from = Math.hypot(x - (SHAFT.x0 + SHAFT.x1) / 2, z - (SHAFT.z0 + SHAFT.z1) / 2);
  return lerp(SHAFT.top, wild, smoothstep(9, 24, from));
}

// ---------- where the pictures of the outside are taken from ----------
// Each returns the eye (x, y, z), what it looks at (tx, ty, tz) and the field of view. All of them stand in air.

export const STATIONS = {
  /** The title: on the road south of the forecourt, a little above head height, drifting; the portal dead ahead. */
  title(t) {
    return {
      x: 64 + Math.sin(t * 0.05) * 6,
      y: 5.2 + Math.sin(t * 0.031) * 0.9,
      z: 117 + Math.cos(t * 0.05) * 4,
      tx: 66,
      ty: 17,
      tz: 86,
      fov: 56,
    };
  },
  /** The ending, watched from down the valley: `drift` goes 0 → 1 over the length of it. */
  ending(drift) {
    return {
      x: 52 - drift * 6,
      y: 9 + drift * 5,
      z: 162 + drift * 8,
      tx: 80,
      ty: 30 + drift * 4,
      tz: 52,
      fov: 54,
    };
  },
  /** Behind the debrief: swinging slowly across the south of what is left, high enough to look down into it. */
  debrief(t) {
    const a = Math.sin(t * 0.02) * 0.9;
    return {
      x: CRATER.x + Math.sin(a) * 150,
      y: 74,
      z: CRATER.z + Math.cos(a) * 150,
      tx: CRATER.x,
      ty: 34,
      tz: CRATER.z,
      fov: 50,
    };
  },
};
