// The arithmetic behind the picture that is not a shader: what the light bake remembers, what a part is made of
// when nobody said, the shape of a box with its edges taken off, and when the finishing passes are used.
// No three.js and no browser in here — this file runs under `node --test` (test/unit/shade.test.mjs).

const lum = (r, g, b) => r * 0.3 + g * 0.59 + b * 0.11;

/**
 * Adds up the light that arrives at one point, and remembers where most of it came from.
 *
 * The bake stores two things for every corner of every surface: how much light falls on it (a colour), and an
 * arrow pointing the way most of that light came, as long as the share of the light it stands for (0 = light
 * from everywhere, 1 = one lamp). The arrow is what lets the shader put a bump or a highlight in the right place
 * afterwards without knowing anything about the lamps.
 */
export function createLightSum() {
  let r = 0;
  let g = 0;
  let b = 0;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  return {
    reset() {
      r = g = b = dx = dy = dz = 0;
    },
    /** Light with no direction: the sky, the last of the light in a dark room. */
    ambient(ar, ag, ab) {
      r += ar;
      g += ag;
      b += ab;
    },
    /** Light (lr, lg, lb) arriving from the direction (x, y, z), which may be of any length. */
    add(lr, lg, lb, x, y, z) {
      r += lr;
      g += lg;
      b += lb;
      const length = Math.hypot(x, y, z);
      if (length < 1e-9) return;
      const weight = lum(lr, lg, lb) / length;
      dx += x * weight;
      dy += y * weight;
      dz += z * weight;
    },
    /** Writes r, g, b (all the light) and dx, dy, dz (the arrow) into `out`, and returns it. */
    finish(out) {
      const total = lum(r, g, b);
      const k = total > 1e-9 ? 1 / total : 0;
      out.r = r;
      out.g = g;
      out.b = b;
      out.dx = dx * k;
      out.dy = dy * k;
      out.dz = dz * k;
      return out;
    },
  };
}

/** A surface that the light only grazed is not allowed to divide by nearly nothing. The shader uses the same floor. */
export const RELIGHT_FLOOR = 0.25;

/**
 * How much brighter or darker a pixel is than the flat surface it sits on, once its own tilt is known.
 * The shader does exactly this (LIT_FRAG in materials.js); it is written out here so that it can be tested.
 * @param {number} geo how squarely the flat surface faced the light when the light was worked out, 0..1
 * @param {number} per how squarely this pixel faces it, 0..1
 * @param {number} k   how much of the light has a direction at all, 0..1
 */
export function relight(geo, per, k) {
  const v = 1 + k * (per / Math.max(geo, RELIGHT_FLOOR) - 1);
  return v < 0 ? 0 : v > 2 ? 2 : v;
}

/**
 * What a painted part is taken to be made of when its builder did not say: how rough, and how much like metal.
 * The colour is in linear light, as three.js holds it. Near-black is rubber or polymer; dark and nearly grey is
 * steel; pale and grey is bare or galvanised; anything with real colour in it is paint.
 * @returns {{ rough: number, metal: number }}
 */
export function surfaceOf(r, g, b) {
  const value = Math.max(r, g, b);
  const sat = value > 1e-6 ? (value - Math.min(r, g, b)) / value : 0;
  if (value < 0.012) return { rough: 0.82, metal: 0.05 };
  if (sat < 0.45 && value < 0.16) return { rough: 0.42, metal: 0.75 };
  if (sat < 0.25) return { rough: 0.55, metal: 0.25 };
  return { rough: 0.5, metal: 0 };
}

/**
 * A box with its edges and corners taken off, centred on the origin.
 *
 * It has the 24 corners a plain box has (four to a face, moved in from the edges by the bevel) and 44 triangles:
 * two for each face, two for the strip along each of the twelve edges, one for each of the eight corners. Every
 * corner keeps the normal of its face, so across a strip the normal turns smoothly from one face to the next —
 * which is what makes an edge catch the light the way a real one does.
 * @returns {{ position: Float32Array, normal: Float32Array, index: Uint16Array }}
 */
export function chamferBox(w, h, d, bevel) {
  const half = [w / 2, h / 2, d / 2];
  const b = Math.max(0, Math.min(bevel, 0.3 * Math.min(w, h, d)));
  const position = new Float32Array(72);
  const normal = new Float32Array(72);
  // the corner of face (axis a, side s) nearest the (su, sv) corner of that face; u and v are the next two axes
  const id = (a, s, su, sv) => a * 8 + (s > 0 ? 4 : 0) + (su > 0 ? 2 : 0) + (sv > 0 ? 1 : 0);
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const s of [-1, 1])
      for (const su of [-1, 1])
        for (const sv of [-1, 1]) {
          const i = id(a, s, su, sv) * 3;
          position[i + a] = s * half[a];
          position[i + u] = su * (half[u] - b);
          position[i + v] = sv * (half[v] - b);
          normal[i + a] = s;
        }
  }
  const index = [];
  // a triangle, wound so that it faces the way `out` points
  const tri = (i0, i1, i2, out) => {
    const p = (i, k) => position[i * 3 + k];
    const ux = p(i1, 0) - p(i0, 0);
    const uy = p(i1, 1) - p(i0, 1);
    const uz = p(i1, 2) - p(i0, 2);
    const vx = p(i2, 0) - p(i0, 0);
    const vy = p(i2, 1) - p(i0, 1);
    const vz = p(i2, 2) - p(i0, 2);
    const facing = (uy * vz - uz * vy) * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * out[2];
    if (facing >= 0) index.push(i0, i1, i2);
    else index.push(i0, i2, i1);
  };
  const axis = (a, s) => [a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0];
  // faces
  for (let a = 0; a < 3; a++)
    for (const s of [-1, 1]) {
      const out = axis(a, s);
      tri(id(a, s, -1, -1), id(a, s, 1, -1), id(a, s, 1, 1), out);
      tri(id(a, s, -1, -1), id(a, s, 1, 1), id(a, s, -1, 1), out);
    }
  // the strip along each edge: the edge runs along axis c, between a face of axis a and a face of axis a2
  for (let c = 0; c < 3; c++) {
    const a = (c + 1) % 3;
    const a2 = (c + 2) % 3;
    for (const s of [-1, 1])
      for (const s2 of [-1, 1]) {
        const out = axis(a, s);
        out[a2] = s2;
        const a0 = id(a, s, s2, -1);
        const a1 = id(a, s, s2, 1);
        const b0 = id(a2, s2, -1, s);
        const b1 = id(a2, s2, 1, s);
        tri(a0, a1, b1, out);
        tri(a0, b1, b0, out);
      }
  }
  // the corners
  for (const s0 of [-1, 1])
    for (const s1 of [-1, 1])
      for (const s2 of [-1, 1]) tri(id(0, s0, s1, s2), id(1, s1, s2, s0), id(2, s2, s0, s1), [s0, s1, s2]);
  return { position, normal, index: new Uint16Array(index) };
}

/**
 * The sizes of the bloom's steps for a picture of width × height: each half the one before, none under 2 pixels.
 * @returns {[number, number][]}
 */
export function bloomChain(width, height, levels) {
  const out = [];
  let w = width;
  let h = height;
  for (let n = 0; n < levels; n++) {
    w = Math.max(2, Math.floor(w / 2));
    h = Math.max(2, Math.floor(h / 2));
    out.push([w, h]);
  }
  return out;
}

/**
 * Whether the finishing passes (bloom, grade, grain) are used, and how edges are smoothed.
 * They need a place to keep values brighter than white; without one the game draws straight to the screen, as
 * it always could.
 * @param {{ post: boolean, msaa: number }} level     the detail level's row of QUALITY (renderer.js)
 * @param {{ webgl2: boolean, halfFloat: boolean }} can what the device offers
 * @param {boolean} wanted                             false when the address says ?post=0
 * @returns {{ enabled: boolean, samples: number, fxaa: boolean }}
 */
export function postPlan(level, can, wanted) {
  const enabled = !!(wanted && level.post && can.webgl2 && can.halfFloat);
  const samples = enabled ? level.msaa || 0 : 0;
  return { enabled, samples, fxaa: enabled && samples === 0 };
}
