// The site's furniture: every static prop, built from painted primitives. No textures, no materials, no
// three.js lights here — buildProp() returns bare geometry that the level merges and lights itself (see
// docs/DESIGN.md 8.3). Randomness only ever comes from makeRng(), seeded from the kind and variant, so the
// same call always returns the same shape.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint as paintPart, place, box as boxPart, cyl as cylPart, merge } from './geo.js';
import { makeRng } from '../core/rng.js';
import { PROPS } from '../world/props.js';

// how far a glow lens sits proud of the solid surface under it, so the two never z-fight
const PROUD = 0.004;

// albedo paint, kept in the mid range (the night and its lamps do the rest)
const PAINT = {
  concrete: 0x8a8d88,
  concreteLow: 0x6d706b,
  steel: 0x5d6a70,
  steelLight: 0x76858c,
  steelDark: 0x454e53,
  gunmetal: 0x3a4348,
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
  glass: 0x161b1f,
  rubber: 0x34383a,
  chrome: 0xaab0b0,
  sand: 0x9a9080,
  brass: 0x8a7236,
  safetyRed: 0x832318,
  black: 0x17191a,
};

// What each of those paints is ON, in the second look's catalogue (gfx/matter.js) — 16 November 2026, the plan's
// second step, "a material on everything, by hand". The builders below were written when a part had a colour and
// nothing else, and they say what a thing is made of by which paint they reach for: the dark steel is always a
// frame or a fitting, the light one galvanised, the yellows and blues and olives a coat of paint on sheet steel.
// A part painted with one of these and saying nothing more is of this material; a part that says (`mat`) is of
// what it says; and a colour that is not in this table is still the rule's guess, and is counted as one.
const MADE_OF = new Map([
  [PAINT.concrete, 'concrete'],
  [PAINT.concreteLow, 'concrete'],
  [PAINT.steel, 'paint'],
  [PAINT.steelLight, 'galv'],
  [PAINT.steelDark, 'steel'],
  [PAINT.gunmetal, 'gunmetal'],
  [PAINT.yellow, 'paint'],
  [PAINT.yellowDark, 'paint'],
  [PAINT.blue, 'paint'],
  [PAINT.blueDark, 'paint'],
  [PAINT.rust, 'rust'],
  [PAINT.rustDark, 'rust'],
  [PAINT.olive, 'paint'],
  [PAINT.oliveDark, 'paint'],
  [PAINT.tan, 'wood'],
  [PAINT.tanDark, 'wood'],
  [PAINT.pale, 'enamel'],
  [PAINT.paleDark, 'enamel'],
  [PAINT.glass, 'glass'],
  [PAINT.rubber, 'rubber'],
  [PAINT.chrome, 'galv'],
  [PAINT.sand, 'concrete'],
  [PAINT.brass, 'brass'],
  [PAINT.safetyRed, 'paint'],
  [PAINT.black, 'polymer'],
  // …and the colours the palettes further down write out in full
  [0x5c4a30, 'wood'], // a wooden crate's battens and bands
  [0x6b7278, 'paint'], // a grey steel case
  [0x2b2e30, 'paint'], // the stencil on it
  [0x3c4650, 'paint'], // drums: blue-grey, olive, and the dark band round the yellow one
  [0x4f5a3c, 'paint'],
  [0x3a3a2e, 'paint'],
  [0x8a7148, 'wood'], // pallets
  [0x7c6440, 'wood'],
  [0x8f7850, 'wood'],
  [0x3c4042, 'steel'], // the third kind of rack's frame
]);
/** a part's shade with its material filled in from its paint, where it does not say and the table knows */
const madeOf = (color, shade) =>
  shade?.mat === undefined && MADE_OF.has(color) ? { ...shade, mat: MADE_OF.get(color) } : shade;
const paint = (geometry, color, shade) => paintPart(geometry, color, madeOf(color, shade));
const box = (w, h, d, color, at, rot, shade) => boxPart(w, h, d, color, at, rot, madeOf(color, shade));
const cyl = (radiusTop, radiusBottom, height, color, at, rot, segments, shade) =>
  cylPart(radiusTop, radiusBottom, height, color, at, rot, segments, madeOf(color, shade));

// light the prop gives off — plain (r, g, b) tuples, some above 1, so they must bypass THREE.Color's
// hex path (which assumes sRGB and would reinterpret them); a 3-number Color is copied verbatim instead.
const GLOW = {
  coldWhite: new THREE.Color(2.2, 2.4, 2.6),
  searchlight: new THREE.Color(2.6, 2.8, 3.0),
  sodium: new THREE.Color(3.0, 1.9, 0.7),
  sodiumWarm: new THREE.Color(2.6, 1.7, 0.7),
  obstruction: new THREE.Color(3.0, 0.25, 0.15),
  screenCyan: new THREE.Color(0.5, 1.2, 1.1),
  screenAmber: new THREE.Color(1.4, 0.9, 0.3),
  screenDim: new THREE.Color(0.3, 0.65, 0.7),
  ledGreen: new THREE.Color(0.4, 2.0, 0.6),
  ledAmber: new THREE.Color(2.2, 1.3, 0.25),
  ledRed: new THREE.Color(2.0, 0.25, 0.2),
  headlampDim: new THREE.Color(0.22, 0.22, 0.2),
  taillampDim: new THREE.Color(0.22, 0.03, 0.03),
};

/** A 32-bit seed from a kind and a variant, so every (kind, variant) pair gets its own fixed rng stream. */
function seedFor(kind, variant) {
  let h = 0x811c9dc5;
  const s = `${kind}:${variant | 0}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const wrap = (i, n) => ((i % n) + n) % n;
/** Picks an item of a palette by variant, wrapping so that any integer (including negatives) works. */
const pick = (list, variant) => list[wrap(variant, list.length)];

/** A thin open-ended collar (a hoop, flange or stiffening ring) wrapped around something solid. */
function collar(radius, height, color, at, rot, segments = 10) {
  const g = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
  return place(paint(g, color), { at, rot });
}

/**
 * A box whose Z-depth tapers linearly from `dBottom` (at y=0) to `dTop` (at y=h) while its X-width `w`
 * stays constant — a true wide-foot-narrow-top wedge, not a stack of steps. Flat-shaded (six planar faces).
 */
function frustumBox(w, h, dBottom, dTop, color, at, rot, shade) {
  const hw = w / 2;
  const b0 = [-hw, 0, -dBottom],
    b1 = [hw, 0, -dBottom],
    b2 = [hw, 0, dBottom],
    b3 = [-hw, 0, dBottom];
  const t0 = [-hw, h, -dTop],
    t1 = [hw, h, -dTop],
    t2 = [hw, h, dTop],
    t3 = [-hw, h, dTop];
  const quad = (a, b, c, d) => [a, b, c, a, c, d];
  const verts = [
    ...quad(b0, b1, b2, b3), // bottom
    ...quad(t0, t3, t2, t1), // top
    ...quad(b1, b0, t0, t1), // front -Z
    ...quad(b3, b2, t2, t3), // back +Z
    ...quad(b0, b3, t3, t0), // left -X
    ...quad(b2, b1, t1, t2), // right +X
  ];
  const position = new Float32Array(verts.length * 3);
  verts.forEach((p, i) => position.set(p, i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.computeVertexNormals();
  return place(paint(g, color, shade), { at, rot });
}

/** A flat right-triangle decal (a warning sign), default normal +Z; pass rot [0, Math.PI, 0] to face -Z. */
function flatTriangle(w, h, color, at, rot) {
  const hw = w / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-hw, 0, 0, hw, 0, 0, 0, h, 0]), 3));
  g.computeVertexNormals();
  return place(paint(g, color), { at, rot });
}

/**
 * Two rails and a run of rungs standing on `at`, rising along Y. Shared by the tank, the tower and the
 * vent stack. The rungs sit centred on `at`'s Z — place `at` a touch proud of whatever it is bolted to.
 */
function ladder(height, width, color, at, { rungGap = 0.3, from = 0.14, rung = 0.75 } = {}) {
  const parts = [];
  const railX = width / 2;
  parts.push(box(0.035, height, 0.03, color, [at[0] - railX, at[1] + height / 2, at[2]]));
  parts.push(box(0.035, height, 0.03, color, [at[0] + railX, at[1] + height / 2, at[2]]));
  for (let y = from; y < height - 0.05; y += rungGap) {
    parts.push(box(width * rung, 0.022, 0.025, color, [at[0], at[1] + y, at[2]]));
  }
  return parts;
}

/**
 * A shallow concave bowl (a satellite dish): a fan of triangles from a pulled-back centre to a rim
 * circle, facing +Y by default (flat and "tilted up" already) before `rot` leans it over. Built by hand,
 * not CylinderGeometry, because a dish must show its CONCAVE face — a closed/capped cylinder never does.
 */
function dishFan(radius, depth, color, at, rot, segments = 12, shade) {
  const verts = [];
  const apex = [0, -depth, 0];
  const rim = (i) => {
    const a = (i / segments) * Math.PI * 2;
    return [radius * Math.cos(a), 0, radius * Math.sin(a)];
  };
  for (let i = 0; i < segments; i++) {
    // apex, rim[i+1], rim[i] — this winding faces the normal +Y (checked by hand, see geo notes)
    verts.push(...apex, ...rim(i + 1), ...rim(i));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return place(paint(g, color, shade), { at, rot });
}

const _strutDir = new THREE.Vector3();
const _strutUp = new THREE.Vector3(0, 1, 0);
const _strutQuat = new THREE.Quaternion();
/**
 * A painted box strut running straight between two points (each [x, y, z]) — used for angled lattice
 * members (tower legs and braces) that a simple axis-aligned `rot` would need brittle hand trig for.
 * Aligns by quaternion instead, so it is correct for any pair of points. `p0` is shaded as the "bottom".
 */
function strut(p0, p1, thickness, color, shade) {
  _strutDir.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const length = _strutDir.length();
  _strutDir.normalize();
  _strutQuat.setFromUnitVectors(_strutUp, _strutDir);
  const g = paint(new THREE.BoxGeometry(thickness, length, thickness), color, shade);
  g.applyQuaternion(_strutQuat);
  g.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
  return g;
}

/**
 * A small flat-shaded box — always 12 triangles, at any detail level, because it skips chamferBox's bevel
 * strip entirely. A bolt head, a hinge leaf or a vent slat is never seen closely enough for a bevel to read,
 * so greebles like these are built with `nub`, which buys far more of them inside the same triangle budget
 * than `box` would. Every piece of `glow` geometry uses it too: the glow shader never reads `normal`, so a
 * bevel on a lens or an LED is triangles spent on nothing (see materials.js GLOW_VERT/GLOW_FRAG).
 */
function nub(w, h, d, color, at, rot, shade) {
  return box(w, h, d, color, at, rot, { ...shade, bevel: false });
}

/** A stack of `n` thin slits (a louvre or grille), evenly spaced along Y and centred on `at`. */
function louvres(n, w, slitH, depth, gap, color, at, rot) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const y = at[1] + (i - (n - 1) / 2) * gap;
    parts.push(nub(w, slitH, depth, color, [at[0], y, at[2]], rot));
  }
  return parts;
}

/**
 * A run of cable or conduit between two points, sagging a little at the middle: a chain of `segments`
 * cheap struts (always 12 triangles each, like `strut` itself, however long the run is) — used to dress
 * equipment with the one thing every real cabinet, tank and transformer has and a box of primitives does
 * not grow on its own.
 */
function cableRun(p0, p1, sag, segments, radius, color) {
  const parts = [];
  let prev = p0;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const point = [
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t - sag * Math.sin(Math.PI * t),
      p0[2] + (p1[2] - p0[2]) * t,
    ];
    parts.push(strut(prev, point, radius, color));
    prev = point;
  }
  return parts;
}

const _wheelOffset = new THREE.Vector3();
const _wheelEuler = new THREE.Euler();
/** A tyre with a hub proud of one face, axis along Y before `rot` turns it (commonly [0, 0, PI/2] for an
 * axle along X) — shared by the truck and the forklift. `face` picks which end the hub sits proud of
 * (+1 or -1 along the local pre-`rot` Y axis, i.e. the outer side once `rot` has turned it to an axle). */
function wheel(radius, width, at, rot, { tire = PAINT.rubber, hub = PAINT.chrome, hubRadius = 0.55, face = 1 } = {}) {
  _wheelOffset.set(0, (width / 2) * face, 0);
  if (rot) _wheelOffset.applyEuler(_wheelEuler.set(rot[0] || 0, rot[1] || 0, rot[2] || 0));
  const hubAt = [at[0] + _wheelOffset.x, at[1] + _wheelOffset.y, at[2] + _wheelOffset.z];
  return [
    cyl(radius, radius, width, tire, at, rot, 10),
    cyl(radius * hubRadius, radius * hubRadius, width * 0.1 + 0.018, hub, hubAt, rot, 6),
  ];
}

/**
 * A wire guard cage around a lamp lens: two open rings joined by `bars` straight uprights, built along
 * local +Y from 0 to `len` and then placed — so `rot` turns the whole cage the same way `cyl`'s does
 * (identity for a light that hangs, [-PI/2, 0, 0] for one that stands out from a wall towards -Z).
 * Returns one merged, already-placed geometry (push it straight into a `solid`/`glow` list).
 */
function cage(radius, len, bars, color, at, rot) {
  const parts = [
    collar(radius, 0.012, color, [0, 0, 0], undefined, 10),
    collar(radius, 0.012, color, [0, len, 0], undefined, 10),
  ];
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    const x = radius * Math.cos(a),
      z = radius * Math.sin(a);
    parts.push(strut([x, 0, z], [x, len, z], 0.012, color));
  }
  return place(merge(parts), { at, rot });
}

/** A ring of `n` small bolt heads around a circle of radius `r`, built in the local XZ plane (face +Y)
 * before `rot` tilts it, matching the convention `cyl`/`collar` use. One merged, already-placed geometry. */
function boltRing(n, r, size, color, at, rot) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(nub(size, size * 0.7, size, color, [r * Math.cos(a), 0, r * Math.sin(a)], undefined));
  }
  return place(merge(parts), { at, rot });
}

/** A strap hinge: a pin with two knuckle wraps, axis along Y before `rot` turns it. One merged geometry. */
function hinge(len, color, at, rot) {
  return place(
    merge([
      cyl(0.014, 0.014, len, PAINT.steelDark, [0, 0, 0], undefined, 6),
      nub(0.032, len * 0.3, 0.032, color, [0, len * 0.28, 0]),
      nub(0.032, len * 0.3, 0.032, color, [0, -len * 0.28, 0]),
    ]),
    { at, rot },
  );
}

// ---------------------------------------------------------------------------------------------------------
// crate / crateTall — a steel-edged transport case; variants differ in colour, banding and a stencil mark.

const CRATE_PALETTES = [
  { body: 0x5b5d3e, edge: PAINT.steelDark, band: PAINT.steelDark, mark: PAINT.yellow }, // olive military case
  { body: 0x9c8a5c, edge: 0x5c4a30, band: 0x5c4a30, mark: 0x7a4a32 }, // wooden crate
  { body: 0x6b7278, edge: 0x3a4348, band: 0xc9a227, mark: 0x2b2e30 }, // grey steel case, yellow band
  { body: 0x7a4a32, edge: PAINT.steelDark, band: PAINT.steelDark, mark: PAINT.yellow }, // rust-red case
];

/**
 * The shared body of a crate: a painted box, bevelled corner battens (the main silhouette read), optional
 * flat-shaded corner castings, a banding strap with a buckle, a stencil mark and a hasp. `size` is the plan
 * footprint (X/Z); `bh` is the body height, independent so a single crate can stand close to its full box
 * height while a stacked unit can stay cube-ish. The box always spans exactly y in [0, bh] with nothing
 * proud of bh, so a stand prop built from it has a true flat top to land on.
 */
function crateUnit(
  rng,
  size,
  bh,
  colors,
  { bands = 1, stencil = false, hasp = false, castings = false, handholds = false } = {},
) {
  const parts = [];
  const hx = size / 2 - 0.01;
  parts.push(box(size * 0.94, bh, size * 0.94, colors.body, [0, bh / 2, 0], undefined, { bottom: 0.72, top: 1 }));
  const bx0 = hx + 0.008; // every corner/edge fitting below keeps clear of the 1-cell footprint (margin checked)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) parts.push(box(0.055, bh, 0.055, colors.edge, [sx * bx0, bh / 2, sz * bx0]));
  if (castings) {
    // cast corner feet, flush with the body's own bottom — never below y = 0, same footprint as the post above
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) parts.push(nub(0.055, 0.026, 0.055, colors.edge, [sx * bx0, 0.013, sz * bx0]));
  }
  if (handholds) {
    // a recessed hand-hold on each long side, flush (not a real hole — nothing to see through)
    for (const sx of [-1, 1]) parts.push(nub(0.12, 0.07, 0.01, colors.edge, [sx * (hx - 0.03), bh * 0.52, hx + 0.001]));
  }
  const bx = hx + 0.015;
  const bandYs = bands >= 2 ? [bh * 0.3, bh * 0.68] : bands >= 1 ? [bh * 0.5] : [];
  for (const y of bandYs) {
    for (const sz of [-1, 1]) parts.push(nub(size * 0.96, 0.065, 0.04, colors.band, [0, y, sz * bx]));
    for (const sx of [-1, 1]) parts.push(nub(0.04, 0.065, size * 0.96, colors.band, [sx * bx, y, 0]));
    parts.push(nub(0.04, 0.085, 0.04, PAINT.steelDark, [bx, y, -bx])); // buckle, sitting on the band corner itself
  }
  if (stencil) {
    const markY = bands >= 2 ? bh * 0.5 : bh * 0.72;
    parts.push(box(size * 0.3, bh * 0.15, 0.012, colors.mark, [rng.range(-0.1, 0.1), markY, -hx - 0.018]));
    parts.push(nub(size * 0.18, bh * 0.09, 0.01, colors.mark, [rng.range(-0.1, 0.1), bh * 0.28, -hx - 0.016]));
  }
  if (hasp) {
    parts.push(nub(0.05, 0.1, 0.018, PAINT.steelDark, [0, bh * 0.42, -hx - 0.02]));
    parts.push(nub(0.075, 0.03, 0.03, PAINT.steelDark, [0, bh * 0.36, -hx - 0.02]));
  }
  return parts;
}

export function buildCrate(rng, variant) {
  const colors = pick(CRATE_PALETTES, variant);
  const solid = crateUnit(rng, 0.94, 1.0, colors, {
    bands: 1,
    stencil: true,
    hasp: true,
    castings: true,
    handholds: true,
  });
  return { solid, glow: [] };
}

export function buildCrateTall(rng, variant) {
  const bottomH = 1.02,
    topH = 2.0 - bottomH; // flush top at exactly 2.0, matching block
  const bottom = merge(crateUnit(rng, 0.94, bottomH, pick(CRATE_PALETTES, variant), { bands: 1, stencil: true }));
  const top = merge(crateUnit(rng, 0.8, topH, pick(CRATE_PALETTES, variant + 1), { bands: 1, stencil: true }));
  place(top, { at: [0, bottomH, 0], rot: [0, rng.range(0.08, 0.16), 0] }); // flush on the crate below, not floating
  return { solid: [bottom, top], glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// barrel — a 0.95 m drum with rolled top/bottom chimes, two rolling hoops, a bung and a stencilled label.
// The body is a single capped cylinder the full stand height, so its top cap IS the flat surface the
// player lands on — nothing here rises more than a bung's own small height above it.

const BARREL_PALETTES = [
  { body: 0x3c4650, hoop: PAINT.steelLight }, // blue-grey, bare steel hoops
  { body: 0x4f5a3c, hoop: PAINT.steelLight }, // olive, bare steel hoops
  { body: PAINT.yellow, hoop: 0x3a3a2e }, // yellow with a dark band
];

export function buildBarrel(rng, variant) {
  const colors = pick(BARREL_PALETTES, variant);
  const r = 0.34,
    H = 0.95; // flush with block
  const solid = [
    cyl(r, r, H, colors.body, [0, H / 2, 0], undefined, 12, { bottom: 0.64, top: 1.08 }),
    collar(r + 0.012, 0.05, colors.hoop, [0, 0.045, 0], undefined, 12), // bottom chime
    collar(r + 0.015, 0.06, colors.hoop, [0, H - 0.05, 0], undefined, 12), // top chime, just under the lid
    collar(r + 0.017, 0.07, colors.hoop, [0, 0.29, 0], undefined, 12), // rolling hoop
    collar(r + 0.017, 0.07, colors.hoop, [0, 0.6, 0], undefined, 12), // rolling hoop
    boltRing(6, r + 0.016, 0.018, PAINT.steelDark, [0, H - 0.05, 0]), // rivets along the top chime
    cyl(0.07, 0.07, 0.016, PAINT.steelDark, [0.1, H - 0.01, -0.04], undefined, 8), // bung, big — flush with the top
    cyl(0.035, 0.035, 0.014, PAINT.steelDark, [-0.13, H - 0.009, 0.09], undefined, 6), // bung, small — flush too
    nub(0.22, 0.16, 0.012, PAINT.pale, [0, 0.47, -r - 0.004]), // stencilled label patch
  ];
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// barrier — a concrete traffic barrier, wide foot to narrow top, with a faded hazard end.

export function buildBarrier(rng, variant) {
  const solid = [frustumBox(1.9, 0.9, 0.23, 0.06, PAINT.concrete, [0, 0, 0], undefined, { bottom: 0.6, top: 1 })];
  const stripeColors = variant % 2 === 0 ? [PAINT.yellow, PAINT.gunmetal] : [PAINT.gunmetal, PAINT.yellow];
  // hazard bands sit on the flat end cap (x = ±0.95, constant for every y since the taper is in Z only),
  // low down where the taper is still wide enough for a flat decal to lie mostly flush with a hair proud
  for (const sx of [-0.96, 0.96]) {
    solid.push(box(0.03, 0.2, 0.22, stripeColors[0], [sx, 0.17, 0]));
    solid.push(box(0.03, 0.2, 0.22, stripeColors[1], [sx, 0.37, 0]));
    solid.push(nub(0.025, 0.1, 0.08, PAINT.steelDark, [sx * 0.975, 0.5, 0])); // tow/link socket, cast in the end face
  }
  // a cast rub rail down each long side with an amber reflector stud, following the taper at its own
  // height so the short, shallow shapes stay flush against the slope without gapping or poking through
  const depthAt = (y) => 0.23 + (0.06 - 0.23) * (y / 0.9);
  for (const sz of [-1, 1]) {
    solid.push(nub(1.3, 0.09, 0.012, PAINT.concreteLow, [0, 0.4, sz * (depthAt(0.4) - 0.006)]));
    solid.push(nub(0.06, 0.05, 0.016, PAINT.yellow, [0, 0.4, sz * (depthAt(0.4) - 0.002)]));
  }
  solid.push(nub(1.86, 0.02, 0.1, PAINT.steelDark, [0, 0.89, 0])); // steel cap rail let into the top edge
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// pallet — a wooden pallet: three skids under six deck boards.

export function buildPallet(rng, variant) {
  const wood = pick([0x8a7148, 0x7c6440, 0x8f7850], variant);
  const solid = [];
  for (const z of [-0.38, 0, 0.38]) solid.push(box(0.92, 0.1, 0.1, wood, [0, 0.05, z], undefined, { bottom: 0.75 }));
  for (let i = 0; i < 5; i++) {
    const x = -0.37 + i * 0.185;
    solid.push(box(0.16, 0.03, 0.92, wood, [x, 0.115, 0]));
  }
  solid.push(nub(0.12, 0.1, 0.012, PAINT.steelDark, [-0.4, 0.06, -0.4])); // steel corner gusset at the skid/deck joint
  solid.push(nub(0.16, 0.05, 0.01, PAINT.rust, [0.08, 0.133, 0.05])); // stencilled ink stamp on the deck boards
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// ceilingLight — a strip-light housing hung from the ceiling. Built around a fixing point, not a footprint:
// top at y = 0, hanging down to about y = -0.12, long axis along X (see the task's exceptions).

const CEILING_LIGHT_HOUSING = [0xaab0ac, 0x6d706b, 0x76858c];

export function buildCeilingLight(rng, variant) {
  const housing = pick(CEILING_LIGHT_HOUSING, variant);
  const solid = [
    box(0.18, 0.02, 0.26, PAINT.steelDark, [0, -0.01, 0]), // ceiling mounting plate
    box(0.025, 0.05, 0.035, PAINT.steel, [-0.42, -0.045, 0]), // suspension bracket
    box(0.025, 0.05, 0.035, PAINT.steel, [0.42, -0.045, 0]),
    box(1.16, 0.09, 0.26, housing, [0, -0.075, 0], undefined, { bottom: 0.78, top: 1, mat: 'enamel' }), // housing
    // cable gland, a little proud of one end — the conduit entry
    cyl(0.032, 0.032, 0.02, PAINT.steelDark, [0.588, -0.075, 0], [0, 0, Math.PI / 2], 6),
  ];
  const glow = [box(1.0, 0.01, 0.2, GLOW.coldWhite, [0, -0.128, 0])]; // lens, proud of the housing underside
  return { solid, glow };
}

// ---------------------------------------------------------------------------------------------------------
// wallLight — a bulkhead lamp on a wall. Built around a fixing point: back in the plane z = 0, standing
// out towards -Z by about 0.14, centred on the origin in X and Y (see the task's exceptions).

const WALL_LIGHT_HOUSING = [0x5d6a70, 0x454e53, 0x5c5236];

export function buildWallLight(rng, variant) {
  const housing = pick(WALL_LIGHT_HOUSING, variant);
  const solid = [
    box(0.16, 0.22, 0.02, PAINT.steelDark, [0, 0, -0.01], undefined, { bottom: 0.8, top: 1 }), // backplate
    nub(0.03, 0.045, 0.025, PAINT.steelDark, [0, 0.14, -0.015]), // conduit entry, down the wall into the top
    cyl(0.085, 0.05, 0.09, housing, [0, 0, -0.065], [-Math.PI / 2, 0, 0], 8, { bottom: 0.7, top: 1, mat: 'paint' }), // dome
    collar(0.075, 0.012, PAINT.steelDark, [0, 0, -0.11], [-Math.PI / 2, 0, 0], 8), // bezel
    // wire guard crossing the lens, two bars between opposite points on the bezel rim
    strut([0.053, 0.053, -0.116], [-0.053, -0.053, -0.116], 0.01, PAINT.steelDark),
    strut([0.053, -0.053, -0.116], [-0.053, 0.053, -0.116], 0.01, PAINT.steelDark),
  ];
  const glow = [cyl(0.062, 0.062, 0.008, GLOW.sodiumWarm, [0, 0, -0.123], [-Math.PI / 2, 0, 0], 8)];
  return { solid, glow };
}

// ---------------------------------------------------------------------------------------------------------
// pipeRun — overhead corridor pipework. Built around a fixing point: a 4 m run along X (x in [-2, 2]),
// everything between y = 3.15 and y = 3.7, z in [-0.45, 0.45], nothing below 3.1 (see the task's exceptions).

const PIPE_RUN_SPECS = [
  { r: 0.1, y: 3.55, z: -0.33 },
  { r: 0.075, y: 3.58, z: -0.11 },
  { r: 0.06, y: 3.56, z: 0.12 },
  { r: 0.045, y: 3.62, z: 0.32 },
];
const PIPE_PALETTES = [
  [PAINT.pale, PAINT.steel, PAINT.steelLight, PAINT.pale], // process pipes, pale/stainless
  [PAINT.blue, PAINT.steel, PAINT.rust, PAINT.steel], // mixed service lines
];

export function buildPipeRun(rng, variant) {
  const colors = pick(PIPE_PALETTES, variant);
  const solid = [];
  PIPE_RUN_SPECS.forEach((p, i) => {
    solid.push(cyl(p.r, p.r, 4, colors[i], [0, p.y, p.z], [0, 0, Math.PI / 2], 8, { bottom: 0.65, top: 1 }));
    for (const x of [-1.1, 1.1]) {
      solid.push(collar(p.r + 0.018, 0.05, PAINT.steelDark, [x, p.y, p.z], [0, 0, Math.PI / 2], 8));
    }
  });
  // a bolted flange joint partway along the main pipe, and a mid-span hanger strap
  const main = PIPE_RUN_SPECS[0];
  for (const x of [-0.55, 0.55]) {
    solid.push(collar(main.r + 0.018, 0.08, PAINT.steelDark, [x, main.y, main.z], [0, 0, Math.PI / 2], 6));
  }
  solid.push(box(0.05, 0.02, 0.75, PAINT.steelDark, [0, 3.68, 0])); // mid-span strap
  for (const hx of [-1.5, 1.5]) {
    solid.push(box(0.06, 0.02, 0.9, PAINT.steelDark, [hx, 3.68, 0])); // ceiling strap
    solid.push(box(0.018, 0.23, 0.018, PAINT.steelDark, [hx, 3.565, -0.25]));
    solid.push(box(0.018, 0.23, 0.018, PAINT.steelDark, [hx, 3.565, 0.25]));
  }
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// desk — a steel desk with a drawer pedestal, a keyboard and a small terminal (screen glow, dim).

const DESK_PALETTES = [
  { body: PAINT.steel, dark: PAINT.steelDark },
  { body: PAINT.olive, dark: PAINT.oliveDark },
];

export function buildDesk(rng, variant) {
  const c = pick(DESK_PALETTES, variant);
  // envelope height h = block = 0.78 bounds the WHOLE prop, desktop included — like the file's own prior
  // art (keyboard + terminal already sat on the desktop under that ceiling) rather than a bare flat plane,
  // since nothing above a desk's own clutter is where a player is expected to stand.
  const legH = 0.68;
  const topY = legH + 0.04; // desktop surface
  const solid = [
    box(1.86, 0.04, 0.84, c.body, [0, legH + 0.02, 0], undefined, { bottom: 0.8, top: 1 }), // top
    box(0.18, legH, 0.8, c.dark, [-0.84, legH / 2, 0]), // solid end panel
    box(0.4, legH, 0.8, c.body, [0.74, legH / 2, 0], undefined, { bottom: 0.75, top: 1 }), // drawer pedestal
    nub(0.4, 0.05, 0.8, c.dark, [0.74, 0.025, 0]), // recessed toe-kick base
    nub(0.03, legH - 0.1, 0.03, c.dark, [0.1, (legH - 0.1) / 2, -0.37]), // open-end leg, front
    nub(0.03, legH - 0.1, 0.03, c.dark, [0.1, (legH - 0.1) / 2, 0.37]), // open-end leg, back
    nub(1.0, 0.03, 0.03, c.dark, [0.1, legH - 0.12, -0.37]), // stretcher rail tying the legs together
  ];
  // two proud drawer fronts instead of flat seams, each with its own recessed handle
  for (const dy of [legH * 0.68, legH * 0.34]) {
    solid.push(box(0.34, legH * 0.28, 0.025, c.dark, [0.74, dy, -0.4125], undefined, { bottom: 0.85, top: 1 }));
    solid.push(nub(0.12, 0.022, 0.015, c.body, [0.74, dy, -0.433])); // handle, recessed pull
  }
  solid.push(box(0.32, 0.018, 0.13, PAINT.gunmetal, [-0.1, topY + 0.009, -0.15])); // keyboard
  solid.push(nub(0.22, 0.01, 0.07, PAINT.pale, [-0.1, topY + 0.005, 0.05])); // notepad beside the keyboard
  solid.push(nub(0.05, 0.05, 0.05, c.dark, [0.42, topY + 0.025, -0.15])); // mug
  solid.push(box(0.28, 0.055, 0.17, PAINT.steelDark, [0.1, topY + 0.0275, 0.2])); // terminal body
  solid.push(nub(0.02, 0.02, 0.05, c.body, [0.52, topY + 0.01, -0.46])); // lamp base
  solid.push(nub(0.1, 0.025, 0.07, c.body, [0.52, topY + 0.0425, -0.46])); // lamp shade
  const glow = [
    box(0.22, 0.05, 0.012, GLOW.screenDim, [0.1, topY + 0.0275, 0.2 - 0.089]),
    nub(0.06, 0.01, 0.04, GLOW.sodiumWarm, [0.52, topY + 0.033, -0.46]), // lamp pool
  ];
  return { solid, glow };
}

// ---------------------------------------------------------------------------------------------------------
// console — a sloped control desk: buttons on the panel, two monitors on top, screens glow.

const CONSOLE_PALETTES = [
  { body: PAINT.steelDark, panel: PAINT.steel },
  { body: PAINT.gunmetal, panel: PAINT.steelDark },
];
const CONSOLE_BUTTON_GLOW = [null, null, GLOW.screenCyan, null, GLOW.screenAmber, null];

export function buildConsole(rng, variant) {
  const c = pick(CONSOLE_PALETTES, variant);
  const cabH = 0.74;
  const solid = [box(1.86, cabH, 0.86, c.body, [0, cabH / 2, 0], undefined, { bottom: 0.72, top: 1 })];
  const glow = [];

  // sloped panel: a box tilted about X so its face looks up and toward -Z, like a dashboard
  const angle = -0.35;
  const panelAt = [0, cabH + 0.08, -0.22];
  const hd = 0.21; // panel half-thickness before rotation (its "face" is the +Z side)
  solid.push(box(1.8, 0.05, hd * 2, c.panel, panelAt, [angle, 0, 0], { bottom: 0.85, top: 1 }));
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  const onPanel = (lx, ly) => [
    panelAt[0] + lx,
    panelAt[1] + ly * ca - (hd + PROUD) * sa,
    panelAt[2] + ly * sa + (hd + PROUD) * ca,
  ];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 6; i++) {
      const lx = -0.75 + i * 0.3,
        ly = row === 0 ? -0.09 : 0.09;
      const at = onPanel(lx, ly);
      const glowColor = CONSOLE_BUTTON_GLOW[(i + row * 3) % CONSOLE_BUTTON_GLOW.length];
      if (glowColor) glow.push(box(0.05, 0.015, 0.05, glowColor, at, [angle, 0, 0]));
      else solid.push(box(0.055, 0.02, 0.055, PAINT.gunmetal, at, [angle, 0, 0]));
    }
  }

  // two monitors standing on the cabinet's rear deck, behind the panel
  for (const mx of [-0.42, 0.42]) {
    const my = cabH + 0.16;
    solid.push(box(0.05, 0.1, 0.05, PAINT.steelDark, [mx, cabH + 0.05, 0.32])); // neck
    solid.push(box(0.34, 0.3, 0.05, PAINT.steelDark, [mx, my, 0.32]));
    glow.push(box(0.28, 0.24, 0.012, GLOW.screenCyan, [mx, my, 0.32 - 0.031]));
  }

  solid.push(nub(1.88, 0.08, 0.88, PAINT.black, [0, 0.04, 0])); // recessed toe-kick plinth
  for (const sx of [-1, 1]) solid.push(nub(0.04, cabH - 0.02, 0.04, PAINT.steelDark, [sx * 0.92, cabH / 2, 0.41])); // corner trim post
  for (const sx of [-1, 1])
    solid.push(...louvres(4, 0.012, 0.025, 0.5, 0.075, PAINT.steelDark, [sx * 0.936, cabH * 0.42, 0])); // cabinet-side vents
  solid.push(nub(1.6, 0.03, 0.03, c.panel, [0, cabH - 0.1, 0.44])); // operator grab rail along the front edge
  solid.push(nub(0.05, 0.08, 0.05, PAINT.steelDark, [0.75, cabH + 0.04, 0.1])); // conduit stub feeding the panel
  // a control stalk beside the panel: base, short arm, ball-top joystick
  solid.push(nub(0.05, 0.02, 0.05, PAINT.steelDark, [-0.75, cabH + 0.01, 0.1]));
  solid.push(nub(0.02, 0.1, 0.02, PAINT.steelDark, [-0.75, cabH + 0.07, 0.1]));
  solid.push(nub(0.045, 0.045, 0.045, PAINT.safetyRed, [-0.75, cabH + 0.14, 0.1]));
  glow.push(nub(1.3, 0.012, 0.02, GLOW.ledAmber, [0, cabH - 0.01, 0.435])); // status lightbar under the front edge
  return { solid, glow };
}

// ---------------------------------------------------------------------------------------------------------
// rack — an open two-post relay rack (always found by a console, switchgear or feed-room tank, never with
// stacked goods): equipment units mounted to bare front rails with a real gap of open air between each one,
// not a cabinet with a door. Rows of tiny LEDs (glow), a cable loom down one rail to a base gland.

const RACK_PALETTES = [PAINT.steelDark, PAINT.gunmetal, 0x3c4042];
const RACK_UNIT_COLORS = [PAINT.steel, PAINT.steelLight, PAINT.gunmetal];

export function buildRack(rng, variant) {
  const body = pick(RACK_PALETTES, variant);
  const railZ = -0.2;
  const faceZ = railZ - 0.03; // the front face every unit is flush with, whatever its own depth
  const greebleZ = faceZ - 0.006; // just proud of that face, so handles/LEDs/vents are never swallowed
  const solid = [
    box(0.58, 0.04, 0.3, body, [0, 0.02, railZ]), // base plinth joining the two rails
    box(0.58, 0.035, 0.3, body, [0, 2.0, railZ]), // top cap
  ];
  for (const sx of [-1, 1]) solid.push(box(0.05, 1.98, 0.06, body, [sx * 0.26, 1.0, railZ])); // the two mounting rails

  // equipment units: mounted flush to the rails, each a different depth/height, with a real open gap of
  // bare air above and below — so a sightline (or soon, a bullet) from the side passes clean through.
  const units = [
    { y: 0.3, h: 0.3, d: 0.32 },
    { y: 0.74, h: 0.28, d: 0.28 },
    { y: 1.16, h: 0.26, d: 0.26 },
    { y: 1.58, h: 0.3, d: 0.3 },
    { y: 1.92, h: 0.14, d: 0.22 },
  ];
  units.forEach((u, i) => {
    const color = pick(RACK_UNIT_COLORS, variant + i);
    solid.push(box(0.5, u.h, u.d, color, [0, u.y, faceZ + u.d / 2]));
  });
  solid.push(nub(0.03, 0.14, 0.02, PAINT.steelDark, [0.2, units[1].y, greebleZ])); // handle, unit 2
  solid.push(nub(0.03, 0.12, 0.02, PAINT.steelDark, [-0.18, units[3].y, greebleZ])); // handle, unit 4
  solid.push(...louvres(3, 0.3, 0.013, 0.02, 0.05, PAINT.black, [-0.05, units[0].y, greebleZ])); // vent, unit 1
  solid.push(nub(0.1, 0.09, 0.01, PAINT.pale, [0.15, units[2].y, greebleZ])); // nameplate, unit 3
  solid.push(nub(0.08, 0.08, 0.06, PAINT.steelDark, [0.3, 0.08, railZ + 0.22])); // base cable gland, trailing side
  solid.push(...cableRun([0.26, 1.9, railZ + 0.03], [0.3, 0.14, railZ + 0.2], 0.0, 3, 0.012, PAINT.black)); // loom down the rail to the gland

  const glow = [
    nub(0.02, 0.02, 0.006, GLOW.ledGreen, [-0.15, units[1].y, greebleZ]),
    nub(0.02, 0.02, 0.006, GLOW.ledAmber, [0.1, units[3].y, greebleZ]),
    nub(0.02, 0.02, 0.006, GLOW.ledGreen, [-0.08, units[2].y, greebleZ]),
  ];
  return { solid, glow };
}

// ---------------------------------------------------------------------------------------------------------
// switchgear — two electrical cubicles: doors, meters, warning triangles, indicator lamps (glow).

const SWITCHGEAR_PALETTES = [
  { body: PAINT.steelDark, door: PAINT.steel },
  { body: PAINT.gunmetal, door: PAINT.steelLight },
];

/** One cubicle of the switchgear line-up, centred at x = cx. */
function switchgearCubicle(cx, c) {
  const solid = [
    box(0.92, 2.2, 0.86, c.body, [cx, 1.1, 0], undefined, { bottom: 0.75, top: 1 }),
    box(0.84, 2.05, 0.04, c.door, [cx, 1.1, -0.445], undefined, { bottom: 0.8, top: 1 }),
    nub(0.02, 0.25, 0.03, PAINT.steelDark, [cx + 0.32, 1.1, -0.47]), // handle
    cyl(0.07, 0.07, 0.02, PAINT.pale, [cx - 0.22, 1.55, -0.47], [Math.PI / 2, 0, 0], 10), // meter
    box(0.16, 0.14, 0.006, PAINT.gunmetal, [cx, 1.85, -0.465]), // warning sign backing
    nub(0.09, 0.1, 0.012, PAINT.pale, [cx - 0.3, 0.55, -0.465]), // nameplate
    nub(0.04, 0.3, 0.02, PAINT.steelDark, [cx - 0.42, 0.75, -0.44]), // door edge trim, hinge side
    nub(0.025, 0.09, 0.025, PAINT.steelDark, [cx - 0.42, 1.65, -0.46]), // hinge strap, upper
    nub(0.025, 0.09, 0.025, PAINT.steelDark, [cx - 0.42, 0.55, -0.46]), // hinge strap, lower
  ];
  solid.push(...louvres(3, 0.6, 0.02, 0.012, 0.14, PAINT.gunmetal, [cx, 0.4, -0.465])); // intake louvres
  solid.push(cyl(0.045, 0.045, 0.08, PAINT.steelDark, [cx + 0.15, 0.04, 0.3], [Math.PI / 2, 0, 0], 8)); // cable gland, base entry
  solid.push(flatTriangle(0.13, 0.11, PAINT.yellow, [cx, 1.805, -0.47], [0, Math.PI, 0]));
  const glow = [
    nub(0.024, 0.024, 0.006, GLOW.ledRed, [cx - 0.15, 2.05, -0.47]),
    nub(0.024, 0.024, 0.006, GLOW.ledGreen, [cx + 0.15, 2.05, -0.47]),
  ];
  return { solid, glow };
}

export function buildSwitchgear(rng, variant) {
  const c = pick(SWITCHGEAR_PALETTES, variant);
  const a = switchgearCubicle(-0.49, c);
  const b = switchgearCubicle(0.49, c);
  return { solid: [...a.solid, ...b.solid], glow: [...a.glow, ...b.glow] };
}

// ---------------------------------------------------------------------------------------------------------
// locker — a row of four steel lockers with vents and handles.

const LOCKER_PALETTES = [PAINT.steel, PAINT.olive, PAINT.blueDark];

export function buildLocker(rng, variant) {
  const body = pick(LOCKER_PALETTES, variant);
  const xs = [-0.75, -0.25, 0.25, 0.75];
  const solid = [
    box(1.96, 0.03, 0.9, PAINT.steelDark, [0, 1.875, 0]), // unifying cornice across the row
    box(1.96, 0.08, 0.84, PAINT.steelDark, [0, 0.04, 0]), // continuous kick plate along the base
  ];
  xs.forEach((x, i) => {
    solid.push(box(0.44, 1.85, 0.86, body, [x, 0.925, 0], undefined, { bottom: 0.68, top: 1 }));
    solid.push(nub(0.025, 1.1, 0.03, PAINT.steelDark, [x - 0.2, 1.3, -0.448])); // hinge-side trim strip
    solid.push(nub(0.03, 0.14, 0.03, PAINT.steelDark, [x + 0.16, 1.1, -0.45])); // handle
    solid.push(nub(0.05, 0.05, 0.02, PAINT.steelDark, [x + 0.16, 1.03, -0.455])); // latch
    solid.push(nub(0.09, 0.055, 0.006, PAINT.pale, [x - 0.1, 1.65, -0.436])); // nameplate
  });
  solid.push(...louvres(3, 0.32, 0.018, 0.012, 0.14, PAINT.steelDark, [-0.75, 1.56, -0.435]));
  solid.push(...louvres(3, 0.32, 0.018, 0.012, 0.14, PAINT.steelDark, [-0.25, 1.56, -0.435]));
  solid.push(...louvres(3, 0.32, 0.018, 0.012, 0.14, PAINT.steelDark, [0.25, 1.56, -0.435]));
  solid.push(...louvres(3, 0.32, 0.018, 0.012, 0.14, PAINT.steelDark, [0.75, 1.56, -0.435]));
  solid.push(nub(0.045, 0.07, 0.02, PAINT.gunmetal, [-0.59, 1.03, -0.455])); // padlock hasp, far-left locker
  solid.push(nub(0.03, 0.03, 0.03, PAINT.black, [-0.59, 0.99, -0.46])); // padlock body
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// generator — a skid-mounted diesel genset: louvred enclosure, exhaust stack, control panel, fuel tank base.

const GENERATOR_PALETTES = [PAINT.steel, PAINT.oliveDark, PAINT.steelDark];

export function buildGenerator(rng, variant) {
  const body = pick(GENERATOR_PALETTES, variant);
  const baseTop = 0.25,
    boxTop = baseTop + 1.15;
  const solid = [
    box(2.8, 0.25, 1.8, PAINT.steelDark, [0, baseTop / 2, 0], undefined, { bottom: 0.6, top: 0.9 }), // fuel tank skid
    box(2.9, 0.06, 0.15, PAINT.gunmetal, [0, 0.03, 0.72]), // skid rails
    box(2.9, 0.06, 0.15, PAINT.gunmetal, [0, 0.03, -0.72]),
    box(2.7, 1.15, 1.7, body, [0, (baseTop + boxTop) / 2, 0], undefined, { bottom: 0.78, top: 1 }), // enclosure
    cyl(0.07, 0.08, 0.32, PAINT.steelDark, [1.0, boxTop + 0.16, 0.55], undefined, 10), // exhaust stack
    cyl(0.1, 0.1, 0.03, PAINT.rust, [1.0, boxTop + 0.335, 0.55], undefined, 10), // rain cap
    nub(0.05, 0.05, 0.05, PAINT.steelDark, [1.0, boxTop + 0.06, 0.55]), // exhaust base clamp
    box(0.4, 0.35, 0.04, PAINT.gunmetal, [-0.9, boxTop - 0.3, -0.87]), // control panel
    nub(0.08, 0.06, 0.012, PAINT.pale, [0.3, boxTop - 0.9, -0.871]), // rating plate
    nub(0.16, 0.03, 0.04, PAINT.steelDark, [-0.3, boxTop - 0.6, -0.88]), // access door grab handle
    nub(0.11, 0.08, 0.025, PAINT.steelDark, [1.2, baseTop - 0.04, 0.68]), // battery box, on the skid
    nub(0.09, 0.03, 0.09, PAINT.steelLight, [-1.0, boxTop + 0.02, 0.3]), // roof breather cap
  ];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      solid.push(box(0.02, 0.08, 1.5, PAINT.steelDark, [side * 1.36, baseTop + 0.2 + i * 0.22, 0]));
    }
    solid.push(nub(0.025, 1.15, 0.025, PAINT.steelDark, [side * 1.345, (baseTop + boxTop) / 2, -0.835])); // corner post, front
    solid.push(nub(0.025, 1.15, 0.025, PAINT.steelDark, [side * 1.345, (baseTop + boxTop) / 2, 0.835])); // corner post, rear
    solid.push(nub(0.07, 0.05, 0.012, PAINT.steelDark, [side * 1.1, boxTop + 0.02, -0.84])); // lifting eye plate
  }
  for (const x of [-0.45, 0.45])
    solid.push(nub(0.012, 1.15, 0.006, PAINT.steelDark, [x, (baseTop + boxTop) / 2, -0.851])); // door seams
  const glow = [
    nub(0.05, 0.05, 0.01, GLOW.ledGreen, [-0.78, boxTop - 0.2, -0.895]),
    nub(0.05, 0.05, 0.01, GLOW.ledAmber, [-0.78, boxTop - 0.38, -0.895]),
  ];
  return { solid, glow };
}

// ---------------------------------------------------------------------------------------------------------
// transformer — an outdoor power transformer: tank with radiator fins, ribbed insulators, conservator drum.

const TRANSFORMER_PALETTES = [PAINT.steel, PAINT.steelDark];

export function buildTransformer(rng, variant) {
  const body = pick(TRANSFORMER_PALETTES, variant);
  const tankTop = 1.7;
  const solid = [
    box(1.9, 0.15, 1.9, PAINT.concreteLow, [0, 0.075, 0], undefined, { bottom: 0.6, top: 0.9 }), // plinth
    box(1.8, 1.55, 1.8, body, [0, 0.15 + 0.775, 0], undefined, { bottom: 0.75, top: 1 }), // tank
    cyl(0.22, 0.22, 0.6, PAINT.steelLight, [0, tankTop + 0.22, 0.35], [0, 0, Math.PI / 2], 10), // conservator
    nub(0.11, 0.09, 0.012, PAINT.pale, [0.6, 0.9, -0.911]), // rating plate
    nub(0.1, 0.07, 0.07, PAINT.gunmetal, [-0.7, 0.3, -0.911]), // cable entry / terminal box
    nub(0.025, 0.18, 0.025, PAINT.gunmetal, [-0.7, 0.15, -0.911]), // conduit stub, running down to the plinth
    collar(0.05, 0.03, PAINT.steelDark, [0.3, tankTop + 0.09, -0.6], undefined, 8), // pressure relief valve, on top
    nub(0.05, 0.14, 0.02, PAINT.steelDark, [-0.911, 0.4, 0]), // grounding lug strap
  ];
  // vertical fin blades, spread apart along Z (not just stacked in X) so the ribbing still reads as
  // separate fins — not one flat panel — even viewed face-on, straight along the tank's side.
  for (const side of [-1, 1]) {
    for (const z of [-0.6, -0.3, 0, 0.3, 0.6]) {
      solid.push(box(0.05, 1.3, 0.1, PAINT.steelDark, [side * 0.925, 0.15 + 0.775, z]));
    }
    solid.push(nub(0.02, 1.52, 0.02, PAINT.steelDark, [side * 0.895, 0.15 + 0.775, -0.895])); // corner post, front
    solid.push(nub(0.02, 1.52, 0.02, PAINT.steelDark, [side * 0.895, 0.15 + 0.775, 0.895])); // corner post, rear
    solid.push(nub(0.11, 0.025, 0.08, PAINT.steelDark, [side * 0.6, tankTop + 0.02, 0.6])); // lifting lug, top
  }
  for (const x of [-0.55, 0, 0.55]) {
    solid.push(cyl(0.06, 0.08, 0.45, PAINT.pale, [x, tankTop + 0.225, -0.35], undefined, 6));
    solid.push(collar(0.09, 0.02, PAINT.pale, [x, tankTop + 0.16, -0.35], undefined, 6));
    solid.push(collar(0.09, 0.02, PAINT.pale, [x, tankTop + 0.34, -0.35], undefined, 6));
  }
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// tank — a vertical process vessel on legs: domed top, a ladder, a pipe with a valve wheel, a gauge.

const TANK_PALETTES = [PAINT.pale, PAINT.paleDark];

export function buildTank(rng, variant) {
  const body = pick(TANK_PALETTES, variant);
  const vesselBottom = 0.5,
    vesselTop = 2.8,
    radius = 0.75;
  const solid = [
    box(1.6, 0.04, 1.6, PAINT.concreteLow, [0, 0.02, 0]), // base pad
    cyl(radius, radius, vesselTop - vesselBottom, body, [0, (vesselBottom + vesselTop) / 2, 0], undefined, 10, {
      bottom: 0.78,
      top: 1,
    }),
    cyl(0.04, 0.04, 0.2, PAINT.steel, [-0.85, 1.5, 0], [0, 0, Math.PI / 2], 8), // side pipe
    collar(0.09, 0.025, PAINT.steelDark, [-0.97, 1.5, 0], [0, 0, Math.PI / 2], 8), // valve wheel
    cyl(0.07, 0.07, 0.02, PAINT.pale, [0.3, 2.2, -radius - 0.01], [Math.PI / 2, 0, 0], 8), // gauge
    collar(radius + 0.012, 0.05, PAINT.steelDark, [0, 1.1, 0], undefined, 10), // reinforcing ring, lower
    collar(radius + 0.012, 0.05, PAINT.steelDark, [0, 2.1, 0], undefined, 10), // reinforcing ring, upper
    nub(0.1, 0.07, 0.012, PAINT.pale, [-0.45, 0.85, -radius - 0.005]), // nameplate
    nub(0.025, 0.1, 0.025, PAINT.steelDark, [-0.78, 1.42, 0]), // pipe support clip
    collar(0.11, 0.015, PAINT.steelDark, [0, 0.55, radius + 0.005], [Math.PI / 2, 0, 0], 10), // manway hatch
    boltRing(8, 0.1, 0.015, PAINT.steelLight, [0, 0.55, radius + 0.012], [Math.PI / 2, 0, 0]), // hatch bolts
    cyl(0.025, 0.025, 0.12, PAINT.steelDark, [0.3, 0.06, radius - 0.1], undefined, 6), // drain valve stub, near the base
    nub(0.05, 0.03, 0.05, PAINT.steelDark, [0.3, 0.015, radius - 0.1]), // drain valve body
  ];
  for (const sx of [-0.39, 0.39])
    for (const sz of [-0.39, 0.39])
      solid.push(box(0.09, vesselBottom, 0.09, PAINT.steelDark, [sx, vesselBottom / 2, sz]));
  solid.push(...ladder(2.0, 0.3, PAINT.steelDark, [0, vesselBottom, radius + 0.03], { rungGap: 0.5 }));
  // only the top hemisphere is needed — a full sphere would bury its other half, unseen, inside the vessel
  const dome = place(
    paint(new THREE.SphereGeometry(radius, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), body, { bottom: 0.85, top: 1 }),
    { at: [0, vesselTop, 0], scale: [1, 0.5, 1] },
  );
  solid.push(dome);
  solid.push(cyl(0.02, 0.02, 0.18, PAINT.steelDark, [0, vesselTop + radius * 0.5 + 0.09, 0], undefined, 6)); // relief valve stack, on the dome
  solid.push(nub(0.045, 0.02, 0.045, PAINT.rust, [0, vesselTop + radius * 0.5 + 0.19, 0])); // relief valve cap
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// cylinder — a horizontal transport cylinder on two saddles, with stiffening rings and a valve guard.

const CYLINDER_BANDS = [PAINT.yellow, PAINT.blue, PAINT.rust];

export function buildCylinder(rng, variant) {
  const band = pick(CYLINDER_BANDS, variant);
  const radius = 0.4,
    axisY = 0.75,
    rot = [0, 0, Math.PI / 2];
  const solid = [
    cyl(radius, radius, 1.05, PAINT.pale, [-0.675, axisY, 0], rot, 12), // left body segment
    cyl(radius, radius, 0.3, band, [0, axisY, 0], rot, 12), // colour band
    cyl(radius, radius, 0.85, PAINT.pale, [0.575, axisY, 0], rot, 12), // right body segment
    collar(radius + 0.025, 0.1, PAINT.steelDark, [1.05, axisY, 0], rot, 10), // valve guard bumper
    cyl(0.05, 0.05, 0.15, PAINT.steel, [1.2, axisY, 0], rot, 8), // valve stub
    box(0.3, 0.35, 0.5, PAINT.steelDark, [-0.75, 0.175, 0]), // saddles
    box(0.3, 0.35, 0.5, PAINT.steelDark, [0.6, 0.175, 0]),
    box(0.18, 0.1, 0.012, PAINT.pale, [-0.9, axisY, -radius - 0.006]), // label plate
    nub(0.2, 0.1, 0.012, PAINT.pale, [0.75, axisY, radius + 0.006]), // second label plate, opposite side
    collar(radius + 0.01, 0.07, PAINT.steelDark, [-0.75, axisY, 0], rot, 12), // hold-down strap, left saddle
    collar(radius + 0.01, 0.07, PAINT.steelDark, [0.6, axisY, 0], rot, 12), // hold-down strap, right saddle
    nub(0.09, 0.09, 0.012, PAINT.safetyRed, [0.78, axisY, -radius - 0.006]), // hazard tag, near the valve end
  ];
  for (const x of [-0.9, -0.3, 0.4, 0.9])
    solid.push(collar(radius + 0.02, 0.05, PAINT.steelLight, [x, axisY, 0], rot, 12));
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// roofUnit — a rooftop air-handling unit: box with a fan grille on top and louvres.

const ROOF_UNIT_PALETTES = [PAINT.pale, PAINT.steel];

export function buildRoofUnit(rng, variant) {
  const body = pick(ROOF_UNIT_PALETTES, variant);
  const solid = [
    box(2.8, 1.15, 1.8, body, [0, 0.575, 0], undefined, { bottom: 0.8, top: 1 }),
    cyl(0.58, 0.58, 0.1, PAINT.steelDark, [0, 1.2, 0], undefined, 12), // fan housing drum
  ];
  for (const r of [0.48, 0.33, 0.18]) solid.push(collar(r, 0.02, PAINT.steelLight, [0, 1.26, 0], undefined, 10));
  for (let i = 0; i < 4; i++)
    solid.push(box(0.5, 0.015, 0.02, PAINT.steelLight, [0, 1.28, 0], [0, (i * Math.PI) / 4, 0]));
  for (const y of [0.3, 0.5, 0.7, 0.9]) solid.push(box(2.6, 0.04, 0.03, PAINT.steelDark, [0, y, -0.91]));
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// dish — a satellite dish on a pedestal, tilted up.

const DISH_PALETTES = [PAINT.pale, PAINT.paleDark];

export function buildDish(rng, variant) {
  const color = pick(DISH_PALETTES, variant);
  const mastTop = 1.85,
    mountAt = [0, 1.92, 0];
  const tilt = 0.4,
    spin = rng.range(-0.6, 0.6);
  // the fan is a surface of revolution about its own local Y, so a spin baked in together with the tilt
  // (one Euler rot) would cancel out before the tilt ever broke that symmetry. Tilt first, as its own
  // geometry, then spin + place the already-tilted shape — two place() passes, composed in that order.
  const faceUp = (geom) => place(geom, { at: mountAt, rot: [0, spin, 0] });
  const solid = [
    box(0.5, 0.06, 0.5, PAINT.concrete, [0, 0.03, 0]),
    cyl(0.07, 0.12, 1.75, PAINT.steelDark, [0, 0.06 + 0.875, 0], undefined, 10),
    box(0.14, 0.18, 0.14, PAINT.steelDark, [0, mastTop, 0]), // yoke where the mast meets the dish
    faceUp(dishFan(0.9, 0.22, color, [0, 0, 0], [tilt, 0, 0], 14, { bottom: 0.82, top: 1 })),
    faceUp(collar(0.915, 0.03, PAINT.steelLight, [0, 0, 0], [tilt, 0, 0], 14)), // rim lip
    // feed-horn mast: rises from the dish's own vertex, straight out along its boresight, to the focus
    faceUp(cyl(0.015, 0.02, 0.56, PAINT.steelDark, [0, 0.06, 0], [tilt, 0, 0], 6)),
    faceUp(box(0.07, 0.07, 0.07, PAINT.pale, [0, 0.34, 0], [tilt, 0, 0])), // feed head
  ];
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// rock — a boulder: an icosahedron displaced per vertex by seeded noise, flat-shaded, wider than tall.
// Every vertex of a unit IcosahedronGeometry sits at radius exactly 1, so scaling each one by at most
// 1.15 * 0.78 before squashing keeps the whole lump inside radius ~0.9 — safely inside the 2x2 footprint
// for *any* rng sequence, not just the ones tried here.

const ROCK_PAINTS = [0x8f8a7a, 0x7d8078, 0x978c76]; // sandstone-grey, a few ways

/**
 * A noisy, flat-shaded icosahedral lump, placed to stand on y = `at[1]` with whatever tilt the noise
 * gave it. Shared by the main boulder (icosahedronDetail 1, 80 faces) and the small satellite pebbles
 * around its base (icosahedronDetail 0, 20 faces) — same displace-and-flat-shade recipe, cheaper mesh.
 */
function rockLump(rng, icosahedronDetail, radiusScale, squash, color, at, rotY) {
  // IcosahedronGeometry is built non-indexed (its own doc: "build non-indexed geometry") — each face owns
  // private copies of its corners. Weld matching corners into shared vertices first (dropping normal/uv,
  // which would otherwise stop points at the UV seam from welding) so neighbouring facets keep meeting at
  // the same displaced point; split them apart again afterwards so the shading below comes out flat.
  const base = new THREE.IcosahedronGeometry(1, icosahedronDetail);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const welded = mergeVertices(base);
  const pos = welded.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = rng.range(0.82, 1.15) * radiusScale; // per-vertex radial noise is the lump's facets
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * squash, pos.getZ(i) * k);
  }
  pos.needsUpdate = true;
  const g = welded.toNonIndexed(); // split the shared verts back apart so normals come out flat, not smooth
  g.computeVertexNormals();
  paint(g, color, { bottom: 0.68, top: 1.05, mat: 'rock' });
  const floorY = at[1] - g.boundingBox.min.y; // stand it on at[1] however the noise happened to tip it
  return place(g, { at: [at[0], floorY, at[2]], rot: [0, rotY, 0] });
}

export function buildRock(rng, variant) {
  const color = pick(ROCK_PAINTS, variant);
  const squash = rng.range(0.5, 0.68); // wider than tall
  const scale = rng.range(0.68, 0.78);
  // 42 shared verts / 80 faces once welded — safely inside the 2x2 footprint for *any* rng sequence.
  const solid = [rockLump(rng, 1, scale, squash, color, [0, 0, 0], rng.range(0, Math.PI * 2))];
  // a couple of small satellite pebbles chipped off the main boulder, breaking up the single-lump
  // silhouette the way loose scree really sits around a boulder — cheap (20 faces, icosahedronDetail 0).
  for (const [px, pz] of [
    [0.55, 0.42],
    [-0.5, -0.5],
  ]) {
    const a = rng.range(0, Math.PI * 2),
      r = rng.range(0.05, 0.1);
    solid.push(
      rockLump(
        rng,
        0,
        rng.range(0.16, 0.24),
        rng.range(0.6, 0.85),
        color,
        [px + r * Math.cos(a), 0, pz + r * Math.sin(a)],
        a,
      ),
    );
  }
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// container — a 20ft-style shipping container: corrugated long sides, corner castings, a door at one end.
// Its long axis (6 m) runs along X; the 2 m ends are at +-X, matching a real container's end-door face.

const CONTAINER_PALETTES = [
  { base: PAINT.blue, dark: PAINT.blueDark },
  { base: PAINT.rust, dark: PAINT.rustDark },
  { base: PAINT.olive, dark: PAINT.oliveDark },
  { base: PAINT.steelLight, dark: PAINT.steelDark },
];

export function buildContainer(rng, variant) {
  const c = pick(CONTAINER_PALETTES, variant);
  const bw = 5.8,
    bh = 2.5,
    bd = 1.8;
  // the shell is painted the DARK half of the pair — it reads as the recess behind the ribs even where
  // the preview's lamps don't rake across it, since paint is albedo and doesn't depend on light direction.
  const solid = [box(bw, bh, bd, c.dark, [0, bh / 2, 0], undefined, { bottom: 0.75, top: 1 })];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * 2.88,
        cz = sz * 0.88;
      solid.push(box(0.16, 0.14, 0.16, PAINT.steelDark, [cx, 0.07, cz])); // bottom casting
      solid.push(box(0.16, 0.14, 0.16, PAINT.steelDark, [cx, 2.46, cz])); // top casting
    }
  for (const sz of [-1, 1]) {
    const z = sz * 0.93;
    solid.push(box(bw, 0.12, 0.06, c.base, [0, 0.1, z])); // bottom rail
    solid.push(box(bw, 0.12, 0.06, c.base, [0, 2.46, z])); // top rail
    for (let i = 0; i < 12; i++) {
      const x = -2.6 + (i * 5.2) / 11;
      solid.push(box(0.1, 2.2, 0.05, c.base, [x, 1.25, z], undefined, { bottom: 0.85, top: 1.05 }));
    }
  }
  // door end at -X: two leaves, each with a locking bar, a pair of cam handles, and hinges on its outer
  // edge (the edge away from the central gap, where a real door leaf actually swings from)
  for (const sz of [-1, 1]) {
    const z = sz * 0.45;
    solid.push(box(0.05, 2.2, 0.82, c.base, [-2.93, 1.25, z]));
    solid.push(cyl(0.02, 0.02, 2.0, PAINT.steelDark, [-2.96, 1.25, z], undefined, 8));
    solid.push(box(0.06, 0.08, 0.04, PAINT.steelDark, [-2.95, 0.45, z]));
    solid.push(box(0.06, 0.08, 0.04, PAINT.steelDark, [-2.95, 2.05, z]));
    for (const y of [0.55, 1.95]) solid.push(hinge(0.3, PAINT.steelDark, [-2.96, y, sz * 0.86]));
  }
  solid.push(nub(0.012, 0.14, 0.22, PAINT.pale, [-2.96, 2.2, -0.65])); // CSC data plate, top-left of the door end
  solid.push(nub(0.2, 0.16, 0.01, PAINT.pale, [2.0, 1.3, -0.961])); // placard holder frame, long side
  solid.push(nub(0.17, 0.13, 0.004, c.dark, [2.0, 1.3, -0.964])); // placard backing, recessed behind the frame
  return { solid, glow: [] };
}

// ---------------------------------------------------------------------------------------------------------
// truck — a heavy cargo truck parked facing -Z: cab, bonnet, canvas-tilted bed, six wheels, dim lamps
// (it is parked with its lights off, so lenses only get a faint glow). Long axis (7 m) runs along Z.

const TRUCK_PALETTES = [
  { body: PAINT.olive, canvas: PAINT.oliveDark, deck: PAINT.steelDark },
  { body: PAINT.steel, canvas: PAINT.gunmetal, deck: PAINT.tanDark },
  { body: PAINT.rust, canvas: PAINT.tanDark, deck: PAINT.steelDark },
];

export function buildTruck(rng, variant) {
  const c = pick(TRUCK_PALETTES, variant);
  const CH = 0.92; // chassis line: underside of the cab/bonnet/deck, well clear of the wheel tops below
  const solid = [];
  const glow = [];

  // front end: bumper, slatted grille, headlamps (faint — parked, lights off), bonnet
  solid.push(box(2.7, 0.16, 0.12, PAINT.steelDark, [0, 0.5, -3.35]));
  solid.push(box(2.3, 0.55, 0.1, PAINT.gunmetal, [0, 0.85, -3.2]));
  for (const y of [0.65, 0.85, 1.05]) solid.push(box(2.2, 0.045, 0.025, PAINT.steelLight, [0, y, -3.254]));
  for (const sx of [-1, 1]) {
    solid.push(box(0.22, 0.18, 0.06, PAINT.steelDark, [sx * 0.85, 0.68, -3.37]));
    glow.push(box(0.16, 0.13, 0.02, GLOW.headlampDim, [sx * 0.85, 0.68, -3.404]));
  }
  solid.push(...louvres(3, 0.5, 0.03, 0.02, 0.09, PAINT.gunmetal, [0, 0.68, -3.255])); // radiator slats between the lamps
  solid.push(nub(0.16, 0.08, 0.05, PAINT.steelDark, [0, 0.38, -3.4])); // tow plate under the bumper
  solid.push(collar(0.055, 0.02, PAINT.steelDark, [0, 0.3, -3.43], [Math.PI / 2, 0, 0], 8)); // tow hook loop
  solid.push(box(2.5, 0.5, 0.7, c.body, [0, CH + 0.25, -2.8], undefined, { bottom: 0.82, top: 1 }));

  // windscreen: a dark glass pane raked back from the bonnet's top-rear edge to the cab's roof-front edge
  const wsY0 = CH + 0.5,
    wsZ0 = -2.45;
  const wsY1 = CH + 1.7,
    wsZ1 = -2.15;
  const wsLen = Math.hypot(wsY1 - wsY0, wsZ1 - wsZ0);
  const wsAng = Math.atan2(wsZ1 - wsZ0, wsY1 - wsY0);
  solid.push(box(2.5, wsLen, 0.04, PAINT.glass, [0, (wsY0 + wsY1) / 2, (wsZ0 + wsZ1) / 2], [wsAng, 0, 0]));
  for (const sx of [-1, 1])
    solid.push(nub(0.4, 0.025, 0.03, PAINT.steelDark, [sx * 0.55, wsY0 + 0.04, wsZ0 + 0.02], [wsAng, 0, 0])); // wiper blades resting on the screen

  // cab, with an inset window on each side, mirrors, and an exhaust stack run up alongside it
  solid.push(box(2.5, 1.7, 0.9, c.body, [0, CH + 0.85, -1.7], undefined, { bottom: 0.82, top: 1 }));
  for (const sx of [-1, 1]) {
    solid.push(box(0.03, 0.4, 0.5, PAINT.glass, [sx * 1.24, 2.12, -1.85]));
    solid.push(box(0.05, 0.03, 0.35, PAINT.steelDark, [sx * 1.3, 2.07, -2.05])); // mirror arm
    solid.push(box(0.04, 0.22, 0.16, PAINT.steelDark, [sx * 1.42, 2.07, -2.12])); // mirror housing
    solid.push(nub(0.04, 0.04, 0.1, PAINT.chrome, [sx * 1.255, 1.75, -1.9])); // door handle
    solid.push(nub(0.14, 0.05, 0.55, PAINT.steelDark, [sx * 1.3, 0.72, -1.95])); // running board / step
  }
  solid.push(cyl(0.055, 0.065, 1.9, PAINT.steelDark, [1.32, CH + 0.95, -1.5], undefined, 10));
  solid.push(nub(0.1, 0.06, 0.1, PAINT.steelDark, [1.32, CH + 1.93, -1.5])); // rain cap on the exhaust stack

  // load bed: deck, low side rails, a ridge-tent canvas tilt (two sloped panels + triangular gable ends)
  const bedZ0 = -1.05,
    bedZ1 = 3.25;
  const bedZm = (bedZ0 + bedZ1) / 2,
    bedLen = bedZ1 - bedZ0;
  solid.push(box(2.8, 0.08, bedLen, c.deck, [0, 0.88, bedZm]));
  for (const sx of [-1, 1]) solid.push(box(0.05, 0.3, bedLen, c.body, [sx * 1.42, 1.07, bedZm]));

  // ladder chassis: two rails under the body plus a few cross-members, so the cab/deck never reads as
  // floating free of the running gear; a slung fuel tank, a spare wheel and a tool box hang off it
  for (const sx of [-1, 1]) solid.push(nub(0.12, 0.14, 6.3, PAINT.steelDark, [sx * 0.9, 0.78, 0.15]));
  for (const z of [-2.0, 0.3, 2.6]) solid.push(nub(1.68, 0.1, 0.12, PAINT.steelDark, [0, 0.78, z]));
  solid.push(cyl(0.18, 0.18, 1.0, PAINT.steelLight, [1.05, 0.55, 0.1], [Math.PI / 2, 0, 0], 10));
  for (const z of [-0.32, 0.52]) solid.push(nub(0.05, 0.28, 0.06, PAINT.steelDark, [1.05, 0.65, z]));
  solid.push(
    ...wheel(0.3, 0.22, [0, 0.46, -0.35], undefined, { face: -1 }),
    nub(0.06, 0.21, 0.06, PAINT.steelDark, [0, 0.675, -0.35]),
  ); // spare wheel, bolted flat under the frame
  solid.push(nub(0.22, 0.22, 0.32, PAINT.steelDark, [-0.9, 0.96, -1.0])); // tool box sitting astride the left rail
  solid.push(nub(0.16, 0.025, 0.03, PAINT.chrome, [-0.9, 1.08, -1.0])); // tool box handle

  const eaveX = 1.42,
    eaveY = CH + 0.3,
    ridgeY = eaveY + 1.1;
  const roofSlopeLen = Math.hypot(eaveX, ridgeY - eaveY);
  for (const sx of [-1, 1]) {
    const ang = Math.atan2(sx * eaveX, ridgeY - eaveY); // tilts local +Y to lie along the eave->ridge line
    solid.push(box(0.05, roofSlopeLen, bedLen, c.canvas, [(sx * eaveX) / 2, (eaveY + ridgeY) / 2, bedZm], [0, 0, ang]));
  }
  solid.push(flatTriangle(eaveX * 2, ridgeY - eaveY, c.canvas, [0, eaveY, bedZ0], [0, Math.PI, 0]));
  solid.push(flatTriangle(eaveX * 2, ridgeY - eaveY, c.canvas, [0, eaveY, bedZ1]));
  for (const sx of [-1, 1]) {
    const ang = Math.atan2(sx * eaveX, ridgeY - eaveY);
    for (const z of [bedZ0 + bedLen * 0.18, bedZm, bedZ0 + bedLen * 0.82])
      solid.push(nub(0.07, roofSlopeLen, 0.07, PAINT.black, [(sx * eaveX) / 2, (eaveY + ridgeY) / 2, z], [0, 0, ang])); // tie-down strap over the tilt
  }

  // tailgate, hung on two bottom hinges with a centre latch, and dim tail lamps
  solid.push(box(2.8, 0.3, 0.1, c.body, [0, 1.07, 3.3]));
  for (const sx of [-1, 1]) solid.push(hinge(0.3, PAINT.steelDark, [sx * 1.3, 0.92, 3.3], [0, 0, Math.PI / 2]));
  solid.push(nub(0.2, 0.06, 0.04, PAINT.chrome, [0, 1.17, 3.33]));
  for (const sx of [-1, 1]) {
    solid.push(box(0.14, 0.14, 0.04, PAINT.steelDark, [sx * 1.2, 1.07, 3.33]));
    glow.push(box(0.1, 0.1, 0.02, GLOW.taillampDim, [sx * 1.2, 1.07, 3.354]));
  }

  // six wheels on three axles; the hub sits a hair below the chassis line so the body never clips them.
  // A chrome hubcap proud of the outer sidewall stops them reading as plain dark discs.
  for (const z of [-2.65, 1.3, 2.3])
    for (const sx of [-1, 1]) {
      solid.push(...wheel(0.4, 0.3, [sx * 1.25, 0.4, z], [0, 0, Math.PI / 2], { face: -sx }));
      if (z === 2.3) solid.push(nub(0.3, 0.32, 0.025, PAINT.black, [sx * 1.25, 0.2, z + 0.33])); // mud flap behind the rearmost axle
    }

  return { solid, glow };
}

// forklift — counterbalance rider: mast and forks at -Z, overhead guard and counterweight in safety colour

const FORKLIFT_PALETTES = [
  { body: PAINT.yellow, accent: PAINT.yellowDark }, // classic safety yellow
  { body: PAINT.steelLight, accent: PAINT.steelDark }, // worn grey working unit
  { body: PAINT.olive, accent: PAINT.oliveDark }, // military-industrial olive
];

/** Counterbalance forklift: mast and forks at -Z, overhead guard over the seat, counterweight at +Z. */
export function buildForklift(rng, variant) {
  const c = pick(FORKLIFT_PALETTES, variant);
  const solid = [];
  const glow = [];

  // body is kept narrower than the wheel track so the wheels read as exposed, not boxed-in
  solid.push(box(1.1, 0.3, 2.2, c.body, [0, 0.3, 0.35]));
  solid.push(nub(0.01, 0.1, 0.12, PAINT.pale, [0.56, 0.5, 0.3])); // data/rating plate, right side

  // mast: two rails with top/mid braces; the carriage sits proud of the chassis front so no faces coincide
  for (const sx of [-1, 1]) solid.push(box(0.08, 1.85, 0.1, PAINT.steelDark, [sx * 0.42, 1.075, -0.78]));
  solid.push(box(0.9, 0.06, 0.08, PAINT.steelDark, [0, 2.0, -0.78]));
  solid.push(box(0.9, 0.06, 0.08, PAINT.steelDark, [0, 1.0, -0.78]));
  solid.push(box(0.75, 0.5, 0.08, PAINT.steelDark, [0, 0.4, -0.82])); // carriage, parked low
  for (const sx of [-1, 1])
    solid.push(cyl(0.05, 0.05, 0.07, PAINT.steelLight, [sx * 0.42, 0.4, -0.8], [0, 0, Math.PI / 2], 6)); // carriage rollers riding the rails
  for (const sx of [-1, 1])
    solid.push(...cableRun([sx * 0.25, 1.95, -0.78], [sx * 0.25, 0.65, -0.82], 0.02, 4, 0.013, PAINT.steelDark)); // lift chains

  // hydraulic tilt ram: a thick cylinder base and a thinner chrome rod, angled up to the mid-mast brace
  solid.push(strut([0, 0.45, -0.65], [0, 0.725, -0.71], 0.06, PAINT.steelDark));
  solid.push(strut([0, 0.725, -0.71], [0, 1.0, -0.77], 0.035, PAINT.chrome));

  // forks: bare steel, reaching forward from the carriage, resting near the ground, with a heel plate
  // behind each blade rising to meet the carriage (the hook that actually hangs the fork on it)
  for (const sx of [-1, 1]) {
    solid.push(box(0.12, 0.08, 0.8, PAINT.steel, [sx * 0.3, 0.14, -1.08]));
    solid.push(nub(0.12, 0.5, 0.1, PAINT.steel, [sx * 0.3, 0.4, -0.72]));
  }

  // headlamps low on the chassis front (dim — parked, lights off), either side of the mast
  for (const sx of [-1, 1]) {
    solid.push(nub(0.08, 0.08, 0.04, PAINT.steelDark, [sx * 0.6, 0.5, -0.76]));
    glow.push(nub(0.06, 0.06, 0.02, GLOW.headlampDim, [sx * 0.6, 0.5, -0.785]));
  }

  // overhead guard: four posts and a flat roof over the seat, painted with the body
  for (const sx of [-1, 1])
    for (const sz of [-0.15, 0.55]) solid.push(box(0.06, 1.55, 0.06, c.body, [sx * 0.5, 1.225, sz]));
  solid.push(box(1.2, 0.05, 1.0, c.body, [0, 2.025, 0.2]));

  // seat, with a steering column/wheel and two control levers at the driver's right hand
  solid.push(box(0.4, 0.08, 0.4, PAINT.rubber, [0, 0.49, 0.15]));
  solid.push(box(0.4, 0.35, 0.08, PAINT.rubber, [0, 0.675, 0.32]));
  solid.push(strut([0, 0.45, 0.05], [0, 0.95, -0.1], 0.035, PAINT.steelDark));
  solid.push(collar(0.16, 0.025, PAINT.steelDark, [0, 0.95, -0.1], [1.9, 0, 0], 10));
  solid.push(nub(0.02, 0.22, 0.02, PAINT.black, [0.22, 0.62, 0.0]));
  solid.push(nub(0.02, 0.16, 0.02, PAINT.black, [0.3, 0.56, 0.05]));

  // counterweight: the heavy rear mass, raised clear of the rear wheels, with a darker rear trim panel
  solid.push(box(1.8, 0.8, 0.75, c.body, [0, 0.82, 1.08]));
  solid.push(box(1.5, 0.3, 0.02, c.accent, [0, 0.9, 1.465]));
  solid.push(cyl(0.025, 0.025, 0.4, PAINT.steelDark, [0.45, 1.1, 0.85], undefined, 6)); // exhaust stack
  solid.push(nub(0.06, 0.03, 0.06, PAINT.steelDark, [0.45, 1.3, 0.85])); // exhaust cap

  // wheels: wide load-bearing pair up front, narrower steering pair under the counterweight; the hub
  // sits proud of the outer sidewall so neither pair reads as a plain dark disc
  for (const sx of [-1, 1]) {
    solid.push(...wheel(0.28, 0.22, [sx * 0.75, 0.28, -0.5], [0, 0, Math.PI / 2], { hubRadius: 0.357, face: -sx }));
    solid.push(...wheel(0.2, 0.18, [sx * 0.7, 0.2, 1.15], [0, 0, Math.PI / 2], { hubRadius: 0.4, face: -sx }));
  }

  return { solid, glow };
}

// lampPost — a yard light on a tapered pole. Its arm deliberately reaches past the 1x1 footprint cell
// towards -Z so the lamp hangs over the roadway beside the post, not over the post's own base; this is
// well above head height so it does not create a walk-through or an invisible wall (see tools/preview and
// the final report).

const LAMP_PALETTES = [
  { pole: PAINT.steel, head: PAINT.steelDark },
  { pole: PAINT.steelDark, head: PAINT.gunmetal },
  { pole: PAINT.concreteLow, head: PAINT.steelDark }, // old galvanised-look pole
];

/** Yard lamp post: tapered pole on a concrete foot, arm to -Z, sodium lamp head with a wire guard. */
export function buildLampPost(rng, variant) {
  const c = pick(LAMP_PALETTES, variant);
  const solid = [
    cyl(0.3, 0.32, 0.18, PAINT.concrete, [0, 0.09, 0], undefined, 10), // concrete foot
    cyl(0.1, 0.1, 0.05, c.pole, [0, 0.2, 0], undefined, 10), // base flange
    cyl(0.045, 0.07, 5.35, c.pole, [0, 2.875, 0], undefined, 10), // tapered pole
    cyl(0.05, 0.05, 0.08, c.pole, [0, 5.59, 0], undefined, 8), // cap where the arm meets the pole
    nub(0.07, 0.07, 0.1, c.pole, [0, 5.65, -0.05]), // conduit entry clamp, where the feed exits the pole
    cyl(0.035, 0.035, 1.1, c.pole, [0, 5.65, -0.55], [Math.PI / 2, 0, 0], 8), // arm, reaching -Z
    box(0.34, 0.22, 0.4, c.head, [0, 5.7, -1.1]), // lamp head housing
    cage(0.14, 0.12, 4, PAINT.steelDark, [0, 5.47, -1.1]), // wire guard hanging under the housing
  ];
  const glow = [box(0.26, 0.02, 0.32, GLOW.sodium, [0, 5.577, -1.1])]; // lens, proud of the housing underside
  return { solid, glow };
}

// tower — a lattice guard tower: 4 tapering legs with braces, a ladder, a manned cabin with a searchlight.

const TOWER_PALETTES = [
  { frame: PAINT.steelDark, cabin: PAINT.steel }, // standard steel-grey tower
  { frame: PAINT.gunmetal, cabin: PAINT.steelDark }, // darker gunmetal tower
  { frame: PAINT.steelDark, cabin: PAINT.concreteLow }, // weathered cabin cladding
];

/** Guard tower: 4 lattice legs taper from a wide foot up to a manned cabin with a searchlight. */
export function buildTower(rng, variant) {
  const c = pick(TOWER_PALETTES, variant);
  const LB = 1.3; // leg half-spread at the ground
  const LT = 0.95; // leg half-spread where they meet the cabin floor
  const FLOOR = 6.0; // cabin floor height
  const spread = (y) => LB + (LT - LB) * (y / FLOOR);
  const legAt = (sx, sz, y) => {
    const s = spread(y);
    return [sx * s, y, sz * s];
  };
  const solid = [];
  const glow = [];

  // 4 corner footings and the legs themselves, tapering in as they rise to the cabin floor
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      solid.push(box(0.3, 0.15, 0.3, PAINT.concrete, [sx * LB, 0.075, sz * LB]));
      solid.push(strut(legAt(sx, sz, 0), legAt(sx, sz, FLOOR), 0.11, c.frame, { bottom: 0.65, top: 1 }));
    }

  // two square bracing rings, and a zig-zag of diagonals between them on each of the four sides
  for (const y of [2.0, 4.0]) {
    const s = spread(y);
    for (const sx of [-1, 1]) solid.push(strut([sx * s, y, s], [sx * s, y, -s], 0.07, PAINT.steel));
    for (const sz of [-1, 1]) solid.push(strut([s, y, sz * s], [-s, y, sz * s], 0.07, PAINT.steel));
  }
  let flip = false;
  // braces start a little above y=0 (not exactly at it) because a steeply tilted strut's flat end-cap has
  // corners that dip slightly below its own centreline endpoint — this keeps them clear of the ground.
  for (const sx of [-1, 1])
    for (const y0 of [0.06, 2.06]) {
      solid.push(strut(legAt(sx, flip ? 1 : -1, y0), legAt(sx, flip ? -1 : 1, y0 + 2), 0.055, PAINT.steel));
      flip = !flip;
    }
  for (const sz of [-1, 1])
    for (const y0 of [0.06, 2.06]) {
      solid.push(strut(legAt(flip ? 1 : -1, sz, y0), legAt(flip ? -1 : 1, sz, y0 + 2), 0.055, PAINT.steel));
      flip = !flip;
    }

  // ladder up the back face, arriving at the cabin floor
  solid.push(...ladder(FLOOR, 0.4, c.frame, [0, 0, 1.0], { rungGap: 0.45 }));

  // cabin: a steel-plate floor overhanging the legs a little, walls set in from its edge (a catwalk gap),
  // a roof and a short aerial; window openings are dark decals proud of the wall, not real holes
  const PLAT = 1.15;
  const WALL = 0.9;
  solid.push(box(PLAT * 2, 0.1, PLAT * 2, c.frame, [0, FLOOR + 0.05, 0]));
  solid.push(box(WALL * 2, 2.2, WALL * 2, c.cabin, [0, FLOOR + 1.2, 0], undefined, { bottom: 0.8, top: 1.05 }));
  solid.push(box(2.0, 0.15, 2.0, c.frame, [0, FLOOR + 2.375, 0]));
  solid.push(box(0.03, 0.5, 0.03, c.frame, [0, FLOOR + 2.7, 0]));
  for (const sx of [-1, 1]) solid.push(box(0.02, 0.6, 1.3, PAINT.glass, [sx * (WALL + 0.02), FLOOR + 1.3, 0]));
  for (const sz of [-1, 1]) solid.push(box(1.3, 0.6, 0.02, PAINT.glass, [0, FLOOR + 1.3, sz * (WALL + 0.02)]));
  solid.push(nub(0.05, 0.05, 0.05, PAINT.steelDark, [0.7, FLOOR + 2.47, 0.7])); // beacon housing on the roof corner
  glow.push(nub(0.035, 0.035, 0.03, GLOW.obstruction, [0.7, FLOOR + 2.47, 0.7]));

  // door on the +Z wall below the window, reached by the ladder that arrives on the same face
  solid.push(nub(0.7, 0.85, 0.02, c.frame, [0, FLOOR + 0.545, WALL + 0.01]));
  solid.push(nub(0.03, 0.03, 0.04, PAINT.chrome, [0.25, FLOOR + 0.545, WALL + 0.03]));

  // conduit run: power for the cabin and searchlight, clipped to the inside face of one leg
  solid.push(strut([1.18, 0.1, 1.18], [0.83, FLOOR - 0.1, 0.83], 0.025, c.frame));
  solid.push(nub(0.08, 0.08, 0.06, c.frame, [0.83, FLOOR + 0.05, 0.83]));

  // catwalk rail around the platform edge, on posts, with a toe-board at the base and the searchlight
  // mounted on the front (-Z) rail
  const railY = FLOOR + 1.0;
  const railZ = -(PLAT - 0.05);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      solid.push(box(0.04, 0.9, 0.04, c.frame, [sx * (PLAT - 0.05), FLOOR + 0.55, sz * (PLAT - 0.05)]));
  for (const sx of [-1, 1]) solid.push(box(0.05, 0.05, PLAT * 2 - 0.1, c.frame, [sx * (PLAT - 0.05), railY, 0]));
  for (const sz of [-1, 1]) solid.push(box(PLAT * 2 - 0.1, 0.05, 0.05, c.frame, [0, railY, sz * (PLAT - 0.05)]));
  for (const sx of [-1, 1]) solid.push(nub(0.03, 0.08, PLAT * 2 - 0.1, c.frame, [sx * (PLAT - 0.05), FLOOR + 0.15, 0]));
  for (const sz of [-1, 1]) solid.push(nub(PLAT * 2 - 0.1, 0.08, 0.03, c.frame, [0, FLOOR + 0.15, sz * (PLAT - 0.05)]));
  solid.push(cyl(0.09, 0.09, 0.22, c.frame, [0, railY + 0.18, railZ], [-Math.PI / 2, 0, 0], 8));
  glow.push(
    cyl(0.075, 0.075, PROUD * 2, GLOW.searchlight, [0, railY + 0.18, railZ - 0.11 - PROUD], [-Math.PI / 2, 0, 0], 8),
  );

  return { solid, glow };
}

// ventStack — the site's vent stack: a tapering concrete chimney with a ladder, two ring platforms and red
// obstruction lights at the top and at mid-height. The tallest thing on site, seen from everywhere.

const VENTSTACK_TONES = [PAINT.concrete, PAINT.concreteLow, PAINT.pale];

/** Vent stack: tapering concrete chimney, a taper-following ladder, two platform rings, obstruction lights. */
export function buildVentStack(rng, variant) {
  const tone = pick(VENTSTACK_TONES, variant);
  const H = 26.0;
  const RB = 1.3; // radius at the foot (2.6 m across)
  const RT = 0.8; // radius at the top (1.6 m across)
  const radiusAt = (y) => RB + (RT - RB) * (y / H);
  const solid = [
    cyl(RB, 1.45, 0.6, PAINT.concreteLow, [0, 0.3, 0], undefined, 12), // flared concrete foot
    cyl(RT, RB, H, tone, [0, H / 2, 0], undefined, 12, { bottom: 0.7, top: 1 }), // the stack itself
    collar(RT + 0.05, 0.3, PAINT.concreteLow, [0, H - 0.15, 0], undefined, 12), // coping at the top
  ];
  const glow = [];

  // ladder, its rails following the taper so they stay flush against the concrete along the whole run
  const ladderTop = 24.5;
  const railHalf = 0.22;
  for (const sx of [-1, 1])
    solid.push(
      strut(
        [sx * railHalf, 0.2, radiusAt(0.2) + 0.1],
        [sx * railHalf, ladderTop, radiusAt(ladderTop) + 0.1],
        0.045,
        PAINT.steelDark,
        { bottom: 0.7, top: 1 },
      ),
    );
  for (let y = 0.5; y < ladderTop; y += 1.4)
    solid.push(box(railHalf * 1.7, 0.05, 0.05, PAINT.steelDark, [0, y, radiusAt(y) + 0.1]));

  // two ring platforms with a pipe-rail wall, doubling as the cage around the ladder
  for (const y of [12, 21]) {
    const r = radiusAt(y) + 0.4;
    solid.push(collar(r, 0.1, PAINT.steelDark, [0, y, 0], undefined, 14));
    solid.push(collar(r, 0.7, PAINT.steelDark, [0, y + 0.45, 0], undefined, 14));
  }

  // red obstruction lights: a ring of four at the top and a ring of four at mid-height
  const obstructionRing = (y) => {
    const r = radiusAt(y);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      solid.push(box(0.12, 0.12, 0.12, PAINT.steelDark, [dx * (r + 0.1), y, dz * (r + 0.1)]));
      glow.push(box(0.08, 0.08, 0.08, GLOW.obstruction, [dx * (r + 0.17), y, dz * (r + 0.17)]));
    }
  };
  obstructionRing(25.6);
  obstructionRing(12);

  return { solid, glow };
}

// ---------------------------------------------------------------------------------------------------------
// dispatch

const BUILDERS = {
  crate: buildCrate,
  crateTall: buildCrateTall,
  barrel: buildBarrel,
  barrier: buildBarrier,
  pallet: buildPallet,
  ceilingLight: buildCeilingLight,
  wallLight: buildWallLight,
  pipeRun: buildPipeRun,
  desk: buildDesk,
  console: buildConsole,
  rack: buildRack,
  switchgear: buildSwitchgear,
  locker: buildLocker,
  generator: buildGenerator,
  transformer: buildTransformer,
  tank: buildTank,
  cylinder: buildCylinder,
  roofUnit: buildRoofUnit,
  dish: buildDish,
  rock: buildRock,
  container: buildContainer,
  truck: buildTruck,
  forklift: buildForklift,
  lampPost: buildLampPost,
  tower: buildTower,
  ventStack: buildVentStack,
};

/** Every kind buildProp() can build — always exactly the keys of PROPS. */
export const PROP_KINDS = Object.keys(PROPS);

/**
 * @param {string} kind one of the keys of PROPS in src/world/props.js
 * @param {number} variant 0, 1, 2 … a different-looking copy where that makes sense. Any integer works.
 * @returns {{ solid: THREE.BufferGeometry, glow: THREE.BufferGeometry | null }}
 */
export function buildProp(kind, variant = 0) {
  const fn = BUILDERS[kind];
  if (!fn) throw new Error(`propModels: no builder for prop kind "${kind}"`);
  const rng = makeRng(seedFor(kind, variant));
  const { solid, glow } = fn(rng, variant | 0);
  return { solid: merge(solid), glow: glow && glow.length ? merge(glow) : null };
}
