// The "second look" yard furniture: crates, drums, barriers, pallets, a UF6 transport cylinder, a process
// tank and an overhead pipe run, built the way `next/props.js` and `next/drone.js` build their models —
// painted primitives merged into one BufferGeometry, every part naming what it is made of. These replace
// the far cruder builders of the same name in `propModels.js`; variant colour families are kept so the
// site still reads the same from a distance.
import * as THREE from 'three';
import { paint, place, box, cyl, merge, sides, geoDetail } from '../geo.js';

const wrap = (i, n) => ((i % n) + n) % n;
const pick = (list, variant) => list[wrap(variant, list.length)];

// Copied verbatim from `propModels.js` so a given (kind, variant) always seeds the same way everywhere.
function seedFor(kind, variant) {
  let h = 0x811c9dc5;
  const s = `${kind}:${variant | 0}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
void seedFor; // kept available for any builder that wants seeded jitter; none currently need it

// ---- palette (hex values mirror propModels.js's PAINT so colour families still match) ----------------
const PAINT = {
  concrete: 0x8a8d88,
  concreteLow: 0x6d706b,
  steel: 0x5d6a70,
  steelLight: 0x76858c,
  steelDark: 0x454e53,
  gunmetal: 0x343c41,
  yellow: 0xc9a227,
  yellowDark: 0x836a1e,
  blue: 0x2f5673,
  blueDark: 0x223f54,
  rust: 0x7a4a32,
  rustDark: 0x5c3826,
  olive: 0x5b5d3e,
  oliveDark: 0x454633,
  tan: 0x9c8a5c,
  tanDark: 0x7c6c48,
  pale: 0x9aa39f,
  paleDark: 0x7a837f,
  white: 0xdfdecf,
  black: 0x17191a,
  wood: 0x8a7148,
  woodDark: 0x6c5a38,
};

// ---- shade presets: every part below spreads one of these so `mat` is always explicit -----------------
const sPaint = { mat: 'paint', rough: 0.55, metal: 0 };
const sSteel = { mat: 'steel', rough: 0.45, metal: 0.6 };
const sGalv = { mat: 'galv', rough: 0.32, metal: 0.82 };
const sRust = { mat: 'rust', rough: 0.78, metal: 0.2 };
const sGun = { mat: 'gunmetal', rough: 0.32, metal: 0.8 };
const sWood = { mat: 'wood', rough: 0.82, metal: 0 };
const sConcrete = { mat: 'concrete', rough: 0.85, metal: 0 };
const sRubber = { mat: 'rubber', rough: 0.9, metal: 0 };
const sPoly = { mat: 'polymer', rough: 0.55, metal: 0.05 };
const sEnamel = { mat: 'enamel', rough: 0.35, metal: 0 };
const sGlass = { mat: 'glass', rough: 0.1, metal: 0.15 };
const sFabric = { mat: 'fabric', rough: 0.88, metal: 0 };
const sCanvas = { mat: 'canvas', rough: 0.85, metal: 0 };

// ---- small shape helpers (self-contained: yard.js does not import from props.js/drone.js) -------------

/** An un-bevelled box: for small repeated fittings where 44 bevel triangles apiece would be wasteful. */
function nub(w, h, d, color, at, rot, shade) {
  return box(w, h, d, color, at, rot, { ...shade, bevel: false });
}

/** An open-ended cylinder shell (no caps): hoops, chimes, collars, flange rings. */
function ring(radius, height, color, at, rot, segments, shade) {
  return place(paint(new THREE.CylinderGeometry(radius, radius, height, sides(segments), 1, true), color, shade), {
    at,
    rot,
  });
}

/** `n` small bolt heads spaced evenly around a circle of radius `r`, in the local XZ plane at `at`. */
function boltRing(n, r, size, color, at, rot, shade) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(nub(size, size * 0.8, size, color, [r * Math.cos(a), 0, r * Math.sin(a)], undefined, shade));
  }
  return place(merge(parts), { at, rot });
}

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
/** The Euler tuple that turns a local +Y axis to point from `a` toward `b` (for `span`). */
function axisEuler(a, b) {
  _p0.set(a[0], a[1], a[2]);
  _p1.set(b[0], b[1], b[2]);
  _dir.subVectors(_p1, _p0).normalize();
  _quat.setFromUnitVectors(_up, _dir);
  _euler.setFromQuaternion(_quat);
  return [_euler.x, _euler.y, _euler.z];
}
/** A tapered cylinder spanning two points: hanger rods, braces, pipe stubs. */
function span(a, b, r1, r2, color, shade, segments = 8) {
  const len = Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return cyl(r1, r2, len, color, mid, axisEuler(a, b), segments, shade);
}

/** A lathed body of revolution around local +Y from `[radius, y]` profile points. */
function lathe(profile, color, shade, segments = 16) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return paint(new THREE.LatheGeometry(pts, sides(segments)), color, shade);
}

/** A half-loop of rope/webbing standing proud of a vertical face: anchors at `at ± [r,0,0]` (local),
 * bulging out along local +Y before `rot` is applied. `rot = [±PI/2, 0, 0]` puts the bulge on ±Z (the
 * crate's front/back faces) while leaving the anchor spread on world X. */
function ropeLoop(radius, tube, color, at, rot, shade) {
  const g = new THREE.TorusGeometry(radius, tube, Math.max(4, Math.round(5 * geoDetail.round)), sides(9), Math.PI);
  return place(paint(g, color, shade), { at, rot });
}

/** A swept prism along X between `-length/2` and `length/2`, whose Y-Z cross-section is the polygon traced
 * by `profile` (a list of `[y, zHalf]`, y increasing from the ground up, mirrored onto -Z automatically).
 * Flat shaded (hard edges at every profile break), both ends capped. Used for the barrier's real Jersey
 * profile, which plain `box()`/tapered boxes cannot give in one piece. */
function prismX(profile, length, color, at, shade) {
  const loop = profile.map(([y, z]) => [y, z]);
  for (let i = profile.length - 2; i >= 0; i--) loop.push([profile[i][0], -profile[i][1]]);
  const hx = length / 2;
  const verts = [];
  const push3 = (p) => verts.push(p[0], p[1], p[2]);
  const quad = (a, b, c, d) => {
    push3(a);
    push3(b);
    push3(c);
    push3(a);
    push3(c);
    push3(d);
  };
  for (let i = 0; i < loop.length; i++) {
    const [y0, z0] = loop[i];
    const [y1, z1] = loop[(i + 1) % loop.length];
    quad([-hx, y0, z0], [hx, y0, z0], [hx, y1, z1], [-hx, y1, z1]);
  }
  for (const s of [-1, 1]) {
    const x = s * hx;
    for (let i = 1; i < loop.length - 1; i++) {
      const p0 = [x, loop[0][0], loop[0][1]];
      const p1 = [x, loop[i][0], loop[i][1]];
      const p2 = [x, loop[i + 1][0], loop[i + 1][1]];
      if (s > 0) {
        push3(p0);
        push3(p1);
        push3(p2);
      } else {
        push3(p0);
        push3(p2);
        push3(p1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return place(paint(g, color, shade), { at });
}

// =========================================================================================================
// CRATE / CRATE TALL
// =========================================================================================================

const CRATE_PALETTES = [
  { body: PAINT.olive, dark: PAINT.oliveDark, trim: PAINT.steelDark, band: PAINT.steelDark, wood: false },
  { body: PAINT.wood, dark: PAINT.woodDark, trim: PAINT.woodDark, band: PAINT.steelDark, wood: true },
  { body: 0x6b7278, dark: 0x51575c, trim: PAINT.gunmetal, band: PAINT.yellow, wood: false },
  { body: PAINT.rust, dark: PAINT.rustDark, trim: PAINT.steelDark, band: PAINT.steelDark, wood: false },
];
const CRATE_BRANDS = ['MINE FREIGHT', 'HOLLOW LINE'];

/**
 * One crate tier: a painted or planked carcass, a proud lid cap (its step gives the lid seam for free),
 * four bevelled corner battens, two plank-seam bands, one or two banding straps with a buckle, cast corner
 * feet, and on the `rich` tier a rope handle and a hasp. Spans exactly y in [0, h]: the lid cap's own top
 * face IS y = h. `size` is the square footprint (kept well inside the 1 m box by the margins below).
 */
function crateUnit(size, h, c, rich, variant) {
  const bodyH = h * 0.84;
  const lidH = h - bodyH;
  const bodyHalf = size / 2 - 0.09;
  const battenHalf = 0.028;
  const battenCenter = bodyHalf + 0.013;
  const lidHalf = battenCenter + battenHalf;
  const bandHalf = bodyHalf + 0.012;
  const bandLen = bodyHalf * 2 * 0.92;
  const bodyMat = c.wood ? sWood : sPaint;
  const edgeMat = c.wood ? { ...sWood, rough: 0.76 } : { ...sSteel, rough: 0.55, metal: 0.4 };
  const parts = [];
  parts.push(
    box(bodyHalf * 2, bodyH, bodyHalf * 2, c.body, [0, bodyH / 2, 0], undefined, { ...bodyMat, bottom: 0.7, top: 1 }),
  );
  parts.push(
    box(lidHalf * 2, lidH, lidHalf * 2, c.dark, [0, bodyH + lidH / 2, 0], undefined, {
      ...bodyMat,
      bottom: 0.85,
      top: 1,
    }),
  );
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      parts.push(
        box(
          battenHalf * 2,
          bodyH,
          battenHalf * 2,
          c.trim,
          [sx * battenCenter, bodyH / 2, sz * battenCenter],
          undefined,
          edgeMat,
        ),
      );
  // plank/panel seams: slim bands wrapping all four faces, a hair proud of the body panel
  for (const t of [0.33, 0.67]) {
    const y = bodyH * t;
    for (const sz of [-1, 1])
      parts.push(nub(bandLen, 0.018, 0.012, c.dark, [0, y, sz * (bodyHalf + 0.007)], undefined, edgeMat));
    for (const sx of [-1, 1])
      parts.push(nub(0.012, 0.018, bandLen, c.dark, [sx * (bodyHalf + 0.007), y, 0], undefined, edgeMat));
  }
  // galvanised banding straps with a buckle at one corner
  const bandYs = rich ? [bodyH * 0.22, bodyH + lidH * 0.45] : [bodyH + lidH * 0.45];
  for (const y of bandYs) {
    for (const sz of [-1, 1]) parts.push(nub(bandLen, 0.055, 0.03, c.band, [0, y, sz * bandHalf], undefined, sGalv));
    for (const sx of [-1, 1]) parts.push(nub(0.03, 0.055, bandLen, c.band, [sx * bandHalf, y, 0], undefined, sGalv));
    parts.push(nub(0.05, 0.075, 0.05, PAINT.steelDark, [bandHalf - 0.01, y, -bandHalf + 0.01], undefined, sSteel));
  }
  // cast corner feet, flush with the floor
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      parts.push(nub(0.06, 0.026, 0.06, c.trim, [sx * battenCenter, 0.013, sz * battenCenter], undefined, edgeMat));
  if (rich) {
    parts.push(
      ropeLoop(0.075, 0.014, PAINT.tan, [0, bodyH * 0.56, -(bodyHalf + 0.001)], [-Math.PI / 2, 0, 0], sFabric),
    );
    // recessed handholds on both ends
    for (const sx of [-1, 1])
      parts.push(nub(0.016, 0.1, 0.22, PAINT.black, [sx * (bodyHalf + 0.004), bodyH * 0.55, 0], undefined, sRubber));
    // hasp and staple on the back face, over the lid seam
    parts.push(nub(0.05, 0.1, 0.02, PAINT.steelDark, [0, bodyH + 0.01, bodyHalf + 0.008], undefined, sSteel));
    parts.push(nub(0.075, 0.03, 0.03, PAINT.steelDark, [0, bodyH - 0.05, bodyHalf + 0.012], undefined, sSteel));
  }
  // stencil placard backing
  parts.push(nub(0.3, 0.15, 0.012, PAINT.pale, [0, bodyH * 0.6, -(bodyHalf + 0.004)], undefined, sEnamel));

  const lot = `LOT ${((Math.abs(variant | 0) * 137 + 4021) % 8999) + 1000}`;
  const letters = [
    {
      text: lot,
      at: [0, bodyH * 0.6, -(bodyHalf + 0.01)],
      out: [0, 0, -1],
      height: 0.065,
      tone: c.wood ? 'black' : 'hazard',
    },
    {
      text: pick(CRATE_BRANDS, variant),
      at: [bodyHalf + 0.01, bodyH * 0.38, 0],
      out: [1, 0, 0],
      height: 0.042,
      tone: 'white',
    },
  ];
  return { parts, letters };
}

export function buildCrate(variant = 0) {
  const c = pick(CRATE_PALETTES, variant);
  const { parts, letters } = crateUnit(1, 1.0, c, true, variant);
  return { solid: merge(parts), glow: null, letters };
}

export function buildCrateTall(variant = 0) {
  const cA = pick(CRATE_PALETTES, variant);
  const cB = pick(CRATE_PALETTES, variant + 1);
  const hB = 1.1;
  const hT = 2.0 - hB;
  const bottom = crateUnit(1, hB, cA, true, variant);
  const top = crateUnit(0.86, hT, cB, false, variant + 5);
  const parts = [...bottom.parts, ...top.parts.map((g) => place(g, { at: [0, hB, 0] }))];
  const letters = [...bottom.letters, ...top.letters.map((l) => ({ ...l, at: [l.at[0], l.at[1] + hB, l.at[2]] }))];
  return { solid: merge(parts), glow: null, letters };
}

// =========================================================================================================
// BARREL
// =========================================================================================================

const BARREL_PALETTES = [
  { body: PAINT.olive, hoop: PAINT.steelLight, hoopMat: sGalv, content: 'COOLANT', hazard: 'CORROSIVE' },
  { body: PAINT.blueDark, hoop: PAINT.steelLight, hoopMat: sGalv, content: 'SOLVENT', hazard: 'FLAMMABLE' },
  { body: 0x55564a, hoop: PAINT.steelDark, hoopMat: sSteel, content: 'DIESEL', hazard: 'FLAMMABLE' },
  { body: PAINT.rust, hoop: PAINT.steelDark, hoopMat: sSteel, content: 'WASTE OIL', hazard: 'TOXIC' },
];

export function buildBarrel(variant = 0) {
  const c = pick(BARREL_PALETTES, variant);
  const R = 0.3;
  const H = 0.95;
  const parts = [];
  parts.push(cyl(R, R, H, c.body, [0, H / 2, 0], undefined, 18, { ...sPaint, bottom: 0.55, top: 1.05 }));
  // dished lid: recessed centre, flat outer rim band (wide enough to carry both bungs)
  parts.push(
    lathe(
      [
        [0, H - 0.017],
        [R * 0.4, H - 0.013],
        [R * 0.68, H - 0.004],
        [R * 0.72, H - 0.001],
        [R * 0.72, H],
        [R, H],
      ],
      c.body,
      { ...sPaint, bottom: 1, top: 1 },
      18,
    ),
  );
  // rolling hoops + top/bottom chimes
  parts.push(ring(R + 0.016, 0.05, c.hoop, [0, 0.27, 0], undefined, 18, c.hoopMat));
  parts.push(ring(R + 0.016, 0.05, c.hoop, [0, 0.6, 0], undefined, 18, c.hoopMat));
  parts.push(ring(R + 0.013, 0.045, c.hoop, [0, 0.032, 0], undefined, 18, c.hoopMat));
  parts.push(ring(R + 0.013, 0.045, c.hoop, [0, H - 0.032, 0], undefined, 18, c.hoopMat));
  parts.push(boltRing(16, R + 0.015, 0.012, c.hoop, [0, H - 0.07, 0], undefined, c.hoopMat));
  parts.push(boltRing(16, R + 0.012, 0.011, c.hoop, [0, 0.07, 0], undefined, c.hoopMat));
  // two bungs, flush with the rim band
  const bungR1 = 0.038;
  const bungH1 = 0.012;
  parts.push(cyl(bungR1, bungR1, bungH1, PAINT.gunmetal, [0.21, H - bungH1 / 2, 0.08], undefined, 10, sGun));
  const bungR2 = 0.022;
  const bungH2 = 0.01;
  parts.push(cyl(bungR2, bungR2, bungH2, PAINT.gunmetal, [0.17, H - bungH2 / 2, -0.16], undefined, 10, sGun));
  // stencil placard
  parts.push(nub(0.2, 0.26, 0.01, PAINT.pale, [0, 0.46, -(R + 0.004)], undefined, sEnamel));

  const letters = [
    { text: c.content, at: [0, 0.54, -(R + 0.01)], out: [0, 0, -1], height: 0.055, tone: 'white' },
    { text: c.hazard, at: [0, 0.38, -(R + 0.01)], out: [0, 0, -1], height: 0.045, tone: 'hazard' },
  ];
  return { solid: merge(parts), glow: null, letters };
}

// =========================================================================================================
// BARRIER (Jersey concrete barrier)
// =========================================================================================================

const BARRIER_PALETTES = [
  { body: PAINT.concrete, low: PAINT.concreteLow, stripe: PAINT.yellow },
  { body: PAINT.paleDark, low: PAINT.concreteLow, stripe: PAINT.yellow },
  { body: PAINT.concrete, low: PAINT.concreteLow, stripe: PAINT.white },
];

export function buildBarrier(variant = 0) {
  const c = pick(BARRIER_PALETTES, variant);
  const length = 1.94;
  const hx = length / 2;
  // real Jersey profile: vertical toe, two slopes with chamfered breaks (chipped arrises), a narrow flat top
  const profile = [
    [0.08, 0.3],
    [0.11, 0.28],
    [0.4, 0.17],
    [0.42, 0.163],
    [0.8, 0.075],
    [0.84, 0.063],
    [0.9, 0.052],
  ];
  const parts = [];
  parts.push(prismX(profile, length, c.body, [0, 0, 0], { ...sConcrete, bottom: 0.8, top: 1 }));
  // toe/foot in three segments with real gaps between them (drain cut-outs)
  const toeSegs = 3;
  const gap = 0.12;
  const segLen = (length - gap * (toeSegs - 1)) / toeSegs;
  for (let i = 0; i < toeSegs; i++) {
    const xc = -hx + segLen / 2 + i * (segLen + gap);
    parts.push(box(segLen, 0.08, 0.6, c.body, [xc, 0.04, 0], undefined, { ...sConcrete, bottom: 0.85, top: 0.95 }));
  }
  // steel hazard cap plate, let in just below the true flat top so the concrete ridge stays the highest point
  parts.push(nub(length - 0.1, 0.012, 0.09, PAINT.steelDark, [0, 0.893, 0], undefined, sSteel));
  // bolts holding the plate down, two rows along its length
  const plateLen = length - 0.1;
  for (const bz of [-0.03, 0.03])
    for (let i = 0; i < 8; i++) {
      const bx = -plateLen / 2 + 0.08 + (i * (plateLen - 0.16)) / 7;
      parts.push(nub(0.016, 0.01, 0.016, PAINT.steelDark, [bx, 0.894, bz], undefined, sGalv));
    }
  // a steel grate bar across each drain gap
  for (let i = 0; i < toeSegs - 1; i++) {
    const xc = -hx + segLen + gap / 2 + i * (segLen + gap);
    for (const bz of [-0.15, 0.15])
      parts.push(nub(gap - 0.02, 0.015, 0.02, PAINT.steelDark, [xc, 0.015, bz], undefined, sSteel));
  }
  // lifting slot recesses near each end
  for (const sx of [-1, 1])
    parts.push(nub(0.1, 0.05, 0.03, PAINT.black, [sx * (hx - 0.22), 0.6, 0], undefined, sSteel));
  // hazard stripes, reflector and tow socket on each end cap
  for (const sx of [-1, 1]) {
    const x = sx * (hx - 0.05);
    parts.push(nub(0.08, 0.22, 0.5, c.stripe, [x, 0.3, 0], undefined, sPaint));
    parts.push(nub(0.08, 0.22, 0.5, PAINT.black, [x - sx * 0.09, 0.3, 0], undefined, sPaint));
    parts.push(cyl(0.025, 0.025, 0.012, 0xb33b2a, [x + sx * 0.001, 0.55, 0], [0, 0, Math.PI / 2], 10, sPoly));
    parts.push(cyl(0.02, 0.025, 0.04, PAINT.steelDark, [x + sx * 0.001, 0.2, 0.15], [0, 0, Math.PI / 2], 8, sSteel));
  }

  const unit = `UNIT ${((Math.abs(variant | 0) * 53 + 112) % 89) + 10}`;
  const letters = [
    { text: unit, at: [0, 0.04, -0.301], out: [0, 0, -1], height: 0.055, tone: 'white' },
    { text: unit, at: [0, 0.04, 0.301], out: [0, 0, 1], height: 0.055, tone: 'white' },
  ];
  return { solid: merge(parts), glow: null, letters };
}

// =========================================================================================================
// PALLET
// =========================================================================================================

const PALLET_PALETTES = [PAINT.wood, PAINT.woodDark, 0x93835a];

export function buildPallet(variant = 0) {
  const wood = pick(PALLET_PALETTES, variant);
  const parts = [];
  // bottom boards run along Z, three of them
  const zPos = [-0.37, 0, 0.37];
  for (const z of zPos) parts.push(nub(0.9, 0.022, 0.1, wood, [0, 0.011, z], undefined, sWood));
  // nine blocks in a 3x3 grid
  for (const x of [-0.3, 0, 0.3])
    for (const z of zPos) parts.push(box(0.12, 0.078, 0.12, wood, [x, 0.061, z], undefined, sWood));
  // top deck boards run along X, five of them, with real gaps between
  const xPos = [-0.4, -0.2, 0, 0.2, 0.4];
  for (const x of xPos) parts.push(box(0.16, 0.038, 0.92, wood, [x, 0.119, 0], undefined, { ...sWood, rough: 0.78 }));
  // a steel corner gusset
  parts.push(nub(0.1, 0.02, 0.02, PAINT.steelDark, [-0.4, 0.108, -0.46], undefined, sSteel));

  const letters = [{ text: 'MINE FREIGHT', at: [0.4 + 0.004, 0.119, 0], out: [1, 0, 0], height: 0.028, tone: 'black' }];
  return { solid: merge(parts), glow: null, letters };
}

// =========================================================================================================
// CYLINDER (UF6 transport cylinder in a cradle)
// =========================================================================================================

const CYLINDER_BANDS = [
  { band: PAINT.yellow, tone: 'hazard' },
  { band: PAINT.blue, tone: 'white' },
  { band: PAINT.rust, tone: 'white' },
];

export function buildCylinder(variant = 0) {
  const c = pick(CYLINDER_BANDS, variant);
  const Rc = 0.38;
  const axisY = 0.62;
  const parts = [];
  // one seamless lathed vessel: dished head, shoulder, straight shell, shoulder, dished head
  const profile = [
    [0, -1.25],
    [0.17, -1.19],
    [0.3, -1.1],
    [0.365, -1.0],
    [Rc, -0.92],
    [Rc, 0.92],
    [0.365, 1.0],
    [0.3, 1.1],
    [0.17, 1.19],
    [0, 1.25],
  ];
  parts.push(
    place(lathe(profile, PAINT.pale, { ...sSteel, rough: 0.4 }, 24), { at: [0, axisY, 0], rot: [0, 0, Math.PI / 2] }),
  );
  // stiffening rings at the shoulders and flanking the colour band
  for (const x of [-0.92, -0.4, 0.4, 0.92])
    parts.push(ring(Rc + 0.02, 0.07, PAINT.pale, [x, axisY, 0], [0, 0, Math.PI / 2], 20, sSteel));
  // colour band, a hair proud of the shell so it doesn't fight the same surface
  parts.push(
    cyl(Rc + 0.004, Rc + 0.004, 0.32, c.band, [0, axisY, 0], [0, 0, Math.PI / 2], 20, { ...sPaint, bottom: 1, top: 1 }),
  );
  // bolted valve cover under a tapered hood at +X end, with a hand-wheel on its face
  parts.push(ring(0.2, 0.02, PAINT.steelDark, [1.26, axisY, 0], [0, 0, Math.PI / 2], 16, sSteel));
  parts.push(boltRing(12, 0.21, 0.015, PAINT.steelDark, [1.26, axisY, 0], [0, 0, Math.PI / 2], sGalv));
  parts.push(cyl(0.19, 0.15, 0.22, PAINT.gunmetal, [1.37, axisY, 0], [0, 0, Math.PI / 2], 14, sGun));
  parts.push(ring(0.1, 0.025, PAINT.gunmetal, [1.49, axisY, 0], [0, 0, Math.PI / 2], 12, sGun));
  parts.push(nub(0.03, 0.03, 0.05, PAINT.gunmetal, [1.47, axisY, 0], undefined, sGun));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(
      span(
        [1.47, axisY, 0],
        [1.49, axisY + 0.1 * Math.cos(a), 0.1 * Math.sin(a)],
        0.009,
        0.009,
        PAINT.gunmetal,
        sGun,
        5,
      ),
    );
  }
  // small stub nozzles near the valve end
  for (const dz of [-0.14, 0.14]) {
    parts.push(
      span([0, axisY + Rc * 0.85, dz], [0.95, axisY + Rc * 0.85 + 0.05, dz], 0.03, 0.03, PAINT.pale, sSteel, 8),
    );
    parts.push(ring(0.045, 0.015, PAINT.pale, [0.95, axisY + Rc * 0.85 + 0.05, dz], [0, 0, Math.PI / 2], 10, sSteel));
  }
  // lifting lugs near both shoulders
  for (const x of [-0.72, 0.72]) {
    parts.push(nub(0.06, 0.1, 0.03, PAINT.steelDark, [x, axisY + Rc + 0.03, 0], undefined, sSteel));
    const g = new THREE.TorusGeometry(0.045, 0.014, 6, sides(10));
    parts.push(place(paint(g, PAINT.steelDark, sSteel), { at: [x, axisY + Rc + 0.09, 0], rot: [Math.PI / 2, 0, 0] }));
  }
  // nameplate, flush on the shell at the 9 o'clock line
  parts.push(nub(0.16, 0.12, 0.001, PAINT.pale, [-0.55, axisY + 0.05, -(Rc + 0.0015)], undefined, sEnamel));
  // welded steel cradle: two rails, cross braces, two saddle rings (each bolted) and timber saddle blocks
  parts.push(box(2.6, 0.1, 0.1, PAINT.steelDark, [0, 0.05, -0.28], undefined, sSteel));
  parts.push(box(2.6, 0.1, 0.1, PAINT.steelDark, [0, 0.05, 0.28], undefined, sSteel));
  for (const x of [-1.15, -0.4, 0.4, 1.15])
    parts.push(nub(0.08, 0.08, 0.5, PAINT.steelDark, [x, 0.07, 0], undefined, sSteel));
  for (const sx of [-1, 1])
    parts.push(nub(0.18, 0.1, 0.12, PAINT.steelDark, [sx * 1.2, 0.12, 0.25], [0, Math.PI / 4, 0], sSteel));
  for (const sx of [-1, 1]) {
    const x = sx * 0.75;
    parts.push(ring(Rc + 0.03, 0.09, PAINT.steelDark, [x, axisY, 0], [0, 0, Math.PI / 2], 20, sSteel));
    parts.push(boltRing(10, Rc + 0.05, 0.013, PAINT.steelDark, [x, axisY, 0], [0, 0, Math.PI / 2], sGalv));
    const topY = axisY - Rc + 0.03;
    const blockH = topY - 0.1;
    parts.push(box(0.46, blockH, 0.58, PAINT.woodDark, [x, 0.1 + blockH / 2, 0], undefined, sWood));
  }

  const serial = `CYL ${((Math.abs(variant | 0) * 61 + 301) % 899) + 100}`;
  const tare = `TARE ${1500 + ((Math.abs(variant | 0) * 37) % 400)} KG`;
  const letters = [
    { text: 'UF6', at: [-0.32, axisY, -(Rc + 0.01)], out: [0, 0, -1], height: 0.13, tone: 'hazard' },
    { text: serial, at: [0, axisY, Rc + 0.01], out: [0, 0, 1], height: 0.06, tone: 'white' },
    { text: tare, at: [0.32, axisY, -(Rc + 0.01)], out: [0, 0, -1], height: 0.055, tone: 'white' },
  ];
  return { solid: merge(parts), glow: null, letters };
}

// =========================================================================================================
// TANK (standing process tank)
// =========================================================================================================

const TANK_PALETTES = [
  { body: PAINT.pale, trim: PAINT.paleDark },
  { body: PAINT.paleDark, trim: PAINT.steelDark },
  { body: 0x7f8f84, trim: PAINT.steelDark },
];

export function buildTank(variant = 0) {
  const c = pick(TANK_PALETTES, variant);
  const Rt = 0.72;
  const parts = [];
  parts.push(box(1.9, 0.08, 1.9, PAINT.concrete, [0, 0.04, 0], undefined, sConcrete));
  // skirt
  const skirtTop = 0.58;
  parts.push(cyl(Rt * 0.92, Rt * 0.98, skirtTop - 0.08, c.trim, [0, (skirtTop + 0.08) / 2, 0], undefined, 24, sSteel));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(
      nub(0.16, 0.02, 0.015, PAINT.black, [Rt * 0.95 * Math.cos(a), 0.3, Rt * 0.95 * Math.sin(a)], [0, -a, 0], sSteel),
    );
  }
  parts.push(nub(0.34, 0.46, 0.02, c.trim, [0, 0.33, Rt * 0.95], undefined, sSteel));
  for (const y of [0.15, 0.5]) parts.push(nub(0.1, 0.02, 0.03, PAINT.steelDark, [0.2, y, Rt * 0.97], undefined, sGun));
  // anchor bolts around the plinth
  parts.push(boltRing(16, Rt * 0.98, 0.016, PAINT.steelDark, [0, 0.08, 0], undefined, sGalv));
  // shell
  const shellH = 2.3;
  const shellY0 = skirtTop;
  parts.push(
    cyl(Rt, Rt, shellH, c.body, [0, shellY0 + shellH / 2, 0], undefined, 28, { ...sPaint, bottom: 0.7, top: 0.9 }),
  );
  for (const y of [shellY0 + 0.5, shellY0 + shellH - 0.3])
    parts.push(ring(Rt + 0.015, 0.05, c.trim, [0, y, 0], undefined, 28, sSteel));
  // dome: a true hemisphere cap (not a full ball) so it costs half the triangles and has no hidden underside;
  // built and flattened at the origin, then placed — scaling after `place()` would scale around world origin
  const domeY0 = shellY0 + shellH;
  const domeSegs = sides(28);
  const domeGeo = new THREE.SphereGeometry(
    Rt,
    domeSegs,
    Math.max(4, Math.round(domeSegs * 0.18)),
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  domeGeo.scale(1, 0.5, 1);
  paint(domeGeo, c.body, { ...sPaint, bottom: 0.9, top: 1 });
  parts.push(place(domeGeo, { at: [0, domeY0, 0] }));
  // relief stack on the dome apex (kept a safe margin under the 3.4 m ceiling)
  const apex = domeY0 + Rt * 0.5;
  parts.push(cyl(0.05, 0.05, 0.12, PAINT.steelDark, [0, apex + 0.06, 0], undefined, 10, sSteel));
  parts.push(cyl(0.07, 0.055, 0.025, PAINT.steelDark, [0, apex + 0.1325, 0], undefined, 10, sSteel));
  // a second small inspection hatch on the dome shoulder
  parts.push(ring(0.14, 0.02, c.trim, [0.4, domeY0 + 0.18, 0.4], [Math.PI / 4, Math.PI / 4, 0], 16, sSteel));
  parts.push(
    boltRing(8, 0.15, 0.012, PAINT.steelDark, [0.4, domeY0 + 0.18, 0.4], [Math.PI / 4, Math.PI / 4, 0], sGalv),
  );
  parts.push(cyl(0.13, 0.13, 0.02, c.trim, [0.43, domeY0 + 0.21, 0.43], [Math.PI / 4, Math.PI / 4, 0], 16, sSteel));
  // manway with boltring, and a small grated walkway with a handrail below it
  const manY = shellY0 + 0.35;
  parts.push(ring(0.22, 0.03, c.trim, [0, manY, Rt], [Math.PI / 2, 0, 0], 20, sSteel));
  parts.push(boltRing(16, 0.23, 0.014, PAINT.steelDark, [0, manY, Rt], [Math.PI / 2, 0, 0], sGalv));
  parts.push(cyl(0.2, 0.2, 0.025, c.trim, [0, manY, Rt + 0.015], [Math.PI / 2, 0, 0], 20, sSteel));
  const walkY = manY - 0.35;
  parts.push(box(0.6, 0.02, 0.22, PAINT.steelDark, [0, walkY, Rt + 0.11], undefined, { ...sGalv, rough: 0.6 }));
  for (const dx of [-0.28, 0.28])
    parts.push(nub(0.02, 0.22, 0.02, PAINT.steelDark, [dx, walkY + 0.12, Rt + 0.21], undefined, sGalv));
  parts.push(
    span([-0.28, walkY + 0.22, Rt + 0.21], [0.28, walkY + 0.22, Rt + 0.21], 0.014, 0.014, PAINT.steelDark, sGalv, 6),
  );
  // ladder with rungs, rising to a safety cage near the top
  const ladderX = -Rt - 0.02;
  for (const dz of [-0.18, 0.18])
    parts.push(
      span([ladderX, 0.2, dz], [ladderX, shellY0 + shellH - 0.1, dz], 0.016, 0.016, PAINT.steelDark, sGalv, 6),
    );
  for (let i = 0; i < 11; i++) {
    const y = 0.3 + i * 0.26;
    if (y > shellY0 + shellH - 0.1) break;
    parts.push(span([ladderX, y, -0.18], [ladderX, y, 0.18], 0.012, 0.012, PAINT.steelDark, sGalv, 6));
  }
  for (const y of [shellY0 + shellH - 0.7, shellY0 + shellH - 0.3])
    parts.push(ring(0.22, 0.016, PAINT.steelDark, [ladderX, y, 0], [0, 0, Math.PI / 2], 16, sGalv));
  // level gauge: two flanges, a glass tube and brackets
  const gaugeX = Rt * 0.3;
  const gaugeZ = Rt * 0.93;
  parts.push(ring(0.04, 0.03, c.trim, [gaugeX, shellY0 + 0.2, gaugeZ], [Math.PI / 2, 0, 0], 10, sSteel));
  parts.push(ring(0.04, 0.03, c.trim, [gaugeX, shellY0 + shellH - 0.2, gaugeZ], [Math.PI / 2, 0, 0], 10, sSteel));
  parts.push(cyl(0.022, 0.022, shellH - 0.4, 0xbfd8d6, [gaugeX, shellY0 + shellH / 2, gaugeZ], undefined, 10, sGlass));
  for (const y of [shellY0 + 0.2, shellY0 + shellH - 0.2])
    parts.push(nub(0.03, 0.03, 0.05, PAINT.steelDark, [gaugeX, y, gaugeZ - 0.04], undefined, sSteel));
  // nozzles with flanges around the shell
  const nozzleAngles = [0.6, 2.1, -2.0, -0.55];
  for (let i = 0; i < nozzleAngles.length; i++) {
    const a = nozzleAngles[i];
    const y = shellY0 + 0.55 + i * 0.4;
    const nx = Math.cos(a) * Rt;
    const nz = Math.sin(a) * Rt;
    const ex = Math.cos(a) * (Rt + 0.16);
    const ez = Math.sin(a) * (Rt + 0.16);
    parts.push(span([nx, y, nz], [ex, y, ez], 0.05, 0.05, c.trim, sSteel, 12));
    parts.push(ring(0.07, 0.02, c.trim, [ex, y, ez], [0, -a, Math.PI / 2], 12, sSteel));
  }
  // base drain valve with a 5-spoke hand-wheel
  parts.push(span([0, 0.3, Rt * 0.97], [0, 0.3, Rt + 0.1], 0.035, 0.035, c.trim, sSteel, 10));
  parts.push(cyl(0.05, 0.05, 0.05, PAINT.gunmetal, [0, 0.3, Rt + 0.14], [Math.PI / 2, 0, 0], 10, sGun));
  parts.push(ring(0.09, 0.016, PAINT.steelDark, [0, 0.3, Rt + 0.2], [Math.PI / 2, 0, 0], 14, sSteel));
  parts.push(nub(0.025, 0.025, 0.04, PAINT.gunmetal, [0, 0.3, Rt + 0.17], undefined, sGun));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(
      span(
        [0, 0.3, Rt + 0.2],
        [0.09 * Math.cos(a), 0.3 + 0.09 * Math.sin(a), Rt + 0.2],
        0.008,
        0.008,
        PAINT.steelDark,
        sGalv,
        5,
      ),
    );
  }
  // nameplate
  parts.push(nub(0.001, 0.14, 0.2, PAINT.pale, [Rt + 0.0005, shellY0 + 1.0, 0.35], [0, Math.PI / 2 - 0.9, 0], sEnamel));

  const tankNo = `TANK ${((Math.abs(variant | 0) * 7 + 11) % 89) + 10}`;
  const capacity = `CAP ${20 + ((Math.abs(variant | 0) * 3) % 30)} M3`;
  const letters = [
    { text: tankNo, at: [Rt + 0.01, shellY0 + 1.3, 0], out: [1, 0, 0], height: 0.11, tone: 'white' },
    { text: capacity, at: [0.01, shellY0 + 1.0, Rt + 0.01], out: [0, 0, 1], height: 0.06, tone: 'black' },
  ];
  return { solid: merge(parts), glow: null, letters };
}

// =========================================================================================================
// PIPE RUN (outdoor rack, posts to the ground)
// =========================================================================================================

const PIPE_SPECS = [
  { r: 0.1, y: 3.55, z: -0.33 },
  { r: 0.075, y: 3.58, z: -0.11 },
  { r: 0.06, y: 3.56, z: 0.12 },
  { r: 0.045, y: 3.62, z: 0.32 },
];
const PIPE_PALETTES = [
  [
    { color: PAINT.pale, mat: sSteel },
    { color: PAINT.steel, mat: sSteel },
    { color: PAINT.steelLight, mat: sGalv },
    { color: PAINT.pale, mat: sSteel },
  ],
  [
    { color: PAINT.blue, mat: sPaint },
    { color: PAINT.steel, mat: sSteel },
    { color: PAINT.rust, mat: sRust },
    { color: PAINT.steel, mat: sSteel },
  ],
];

// segments per pipe, largest bore first — matched to each pipe's own collar/lagging rings so the
// biggest, most-looked-at line stays roundest while the small ones spend fewer triangles
const PIPE_SEGS = [12, 10, 8, 6];

export function buildPipeRun(variant = 0) {
  const palette = pick(PIPE_PALETTES, variant);
  const hasValve = wrap(variant, 2) === 0;
  const parts = [];
  for (let i = 0; i < PIPE_SPECS.length; i++) {
    const { r, y, z } = PIPE_SPECS[i];
    const p = palette[i];
    const segs = PIPE_SEGS[i];
    parts.push(cyl(r, r, 4, p.color, [0, y, z], [0, 0, Math.PI / 2], segs, { ...p.mat, bottom: 1, top: 1 }));
    // a flanged collar at the upstream end only (the far end runs on into the next bay)
    parts.push(ring(r + 0.012, 0.04, PAINT.steelDark, [-2 + 0.02, y, z], [0, 0, Math.PI / 2], segs, sSteel));
    if (i < 2)
      parts.push(ring(r + 0.01, 0.05, PAINT.tan, [i === 0 ? -0.6 : 0.6, y, z], [0, 0, Math.PI / 2], segs, sCanvas));
  }
  // flanged mid-span joint on the main pipe, with bolts
  const main = PIPE_SPECS[0];
  for (const x of [-0.08, 0.08])
    parts.push(ring(main.r + 0.02, 0.025, PAINT.steelDark, [x, main.y, main.z], [0, 0, Math.PI / 2], 10, sSteel));
  parts.push(boltRing(6, main.r + 0.03, 0.012, PAINT.steelDark, [0, main.y, main.z], [0, 0, Math.PI / 2], sGalv));
  // mid-span tie strap between the pipes
  parts.push(nub(0.045, 0.016, 0.72, PAINT.steelDark, [0, 3.68, 0], undefined, sSteel));
  // valve wheel on some variants, on the main pipe
  if (hasValve) {
    parts.push(
      span(
        [0, main.y - main.r - 0.01, main.z],
        [0, main.y - main.r - 0.18, main.z],
        0.02,
        0.02,
        PAINT.gunmetal,
        sGun,
        6,
      ),
    );
    parts.push(ring(0.12, 0.03, PAINT.gunmetal, [0, main.y - main.r - 0.2, main.z], [Math.PI / 2, 0, 0], 10, sGun));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(
        span(
          [0, main.y - main.r - 0.2, main.z],
          [0.1 * Math.cos(a), main.y - main.r - 0.2, main.z + 0.1 * Math.sin(a)],
          0.008,
          0.008,
          PAINT.gunmetal,
          sGun,
          4,
        ),
      );
    }
  }
  // two full-height posts to the ground, with base plates, a crossbeam and drop-rod hangers (a trapeze) to two pipes
  for (const sx of [-1, 1]) {
    const x = sx * 1.5;
    parts.push(nub(0.1, 3.66, 0.1, PAINT.steelDark, [x, 3.66 / 2, 0], undefined, sSteel));
    parts.push(nub(0.22, 0.02, 0.22, PAINT.steelDark, [x, 0.01, 0], undefined, sSteel));
    parts.push(nub(0.09, 0.02, 0.9, PAINT.steelDark, [x, 3.68, 0], undefined, sSteel));
    for (const dz of [-0.25, 0.25])
      parts.push(span([x, 3.565, dz], [x, 3.67, dz], 0.009, 0.009, PAINT.steelDark, sGalv, 4));
  }
  // flow-arrow band on the main pipe
  parts.push(nub(0.3, 0.014, main.r * 2 + 0.03, PAINT.yellow, [-1.6, main.y, main.z], undefined, sPaint));

  const lineTag = `LINE ${pick(['UF6-4', 'CW-2', 'N2-1'], variant)}`;
  const letters = [{ text: lineTag, at: [1.5 + 0.011, 3.68, 0], out: [1, 0, 0], height: 0.05, tone: 'black' }];
  return { solid: merge(parts), glow: null, letters };
}
