// The next renderer path's yard furniture: a truck and a shipping container, built from painted primitives the
// same way src/gfx/propModels.js is, but each returns its own merged `solid`/`glow` plus `letters` — what is
// written on it, for a new renderer to draw as lit decals (gfx/next/lettering.js). No textures, no three.js
// lights, no materials here: just geometry and paint (geo.js), and what each part is made of (gfx/matter.js).
import * as THREE from 'three';
import { paint, place, box, cyl, merge, geoDetail } from '../geo.js';

// albedo paint, read from the models being replaced (src/gfx/propModels.js PAINT/GLOW) so that the same variant
// number still looks the same colour from above.
const PAINT = {
  steel: 0x5d6a70,
  steelLight: 0x76858c,
  steelDark: 0x454e53,
  gunmetal: 0x3a4348,
  yellow: 0xc9a227,
  blue: 0x2f5673,
  blueDark: 0x223f54,
  rust: 0x7a4a32,
  rustDark: 0x5c3826,
  olive: 0x5b5d3e,
  oliveDark: 0x454633,
  tanDark: 0x7c6c48,
  pale: 0x9aa39f,
  glass: 0x161b1f,
  rubber: 0x34383a,
  chrome: 0xaab0b0,
  safetyRed: 0x832318,
  black: 0x17191a,
  white: 0xc7c9c4,
};

const GLOW = {
  headlampDim: new THREE.Color(0.22, 0.22, 0.2),
  taillampDim: new THREE.Color(0.22, 0.03, 0.03),
  markerDim: new THREE.Color(0.3, 0.19, 0.04),
};

const wrap = (i, n) => ((i % n) + n) % n;
/** Picks an item of a palette by variant, wrapping so that any integer (including negatives) works. */
const pick = (list, variant) => list[wrap(variant, list.length)];

/** A box with sharp edges regardless of detail level — for small parts a bevel would be wasted on. */
function nub(w, h, d, color, at, rot, shade) {
  return box(w, h, d, color, at, rot, { ...shade, bevel: false });
}

/** A strap hinge: a pin with two knuckle wraps, axis along Y before `rot` turns it. One merged geometry. */
function hingeStrap(len, color, at, rot) {
  return place(
    merge([
      cyl(0.013, 0.013, len, PAINT.steelDark, [0, 0, 0], undefined, 6, { mat: 'steel', rough: 0.5, metal: 0.8 }),
      nub(0.03, len * 0.32, 0.03, color, [0, len * 0.27, 0], undefined, { mat: 'paint' }),
      nub(0.03, len * 0.32, 0.03, color, [0, -len * 0.27, 0], undefined, { mat: 'paint' }),
    ]),
    { at, rot },
  );
}

/** A ring of `n` small studs (wheel nuts, bolt heads) around a circle of radius `r` in the local XZ plane
 * (face +Y) before `rot` tilts it. One merged, already-placed geometry. */
function boltRing(n, r, size, color, at, rot, mat = 'galv') {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(
      cyl(size, size, size * 0.9, color, [r * Math.cos(a), 0, r * Math.sin(a)], undefined, 6, {
        mat,
        rough: 0.4,
        metal: 0.7,
      }),
    );
  }
  return place(merge(parts), { at, rot });
}

/**
 * A curved guard (a mudguard arch, a fender) approximated as `segments` flat plates following an arc of
 * `sweep` radians, `radius` out from `at`, starting at angle `from` (0 = local +Y, turning towards local +X).
 * Built in local XY before `rot` turns it (identity: the arc stands up from `at` and curls towards +X).
 */
function arcGuard(radius, sweep, from, width, thickness, color, at, rot, segments = 5, shade) {
  const parts = [];
  for (let i = 0; i < segments; i++) {
    const a0 = from + (sweep * i) / segments;
    const a1 = from + (sweep * (i + 1)) / segments;
    const am = (a0 + a1) / 2;
    const chord = 2 * radius * Math.sin((a1 - a0) / 2);
    parts.push(
      box(chord + 0.004, thickness, width, color, [radius * Math.sin(am), radius * Math.cos(am), 0], [0, 0, am], {
        ...shade,
        bevel: false,
      }),
    );
  }
  return place(merge(parts), { at, rot });
}

/** A thin rope or cable laced straight between consecutive points of `pts` (local space, already placed). */
function lace(pts, radius, color, mat = 'fabric') {
  const parts = [];
  for (let i = 0; i < pts.length - 1; i++) parts.push(strutBetween(pts[i], pts[i + 1], radius, color, mat));
  return parts;
}

const _strutDir = new THREE.Vector3();
const _strutMid = new THREE.Vector3();
/** A thin round bar between two points, however they are angled — a rope, a cable, a tie rod. */
const _strutUp = new THREE.Vector3(0, 1, 0);
const _strutQuat = new THREE.Quaternion();
const _strutEuler = new THREE.Euler();
function strutBetween(p0, p1, radius, color, mat = 'galv') {
  _strutDir.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = _strutDir.length() || 1e-6;
  _strutDir.normalize();
  _strutMid.set((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
  // cyl() builds along local Y: align by quaternion (not hand trig, which loses a component whenever the
  // strut has both a sideways and a lengthways lean) then convert back to the XYZ-Euler `rot` place() expects
  _strutQuat.setFromUnitVectors(_strutUp, _strutDir);
  _strutEuler.setFromQuaternion(_strutQuat);
  return cyl(
    radius,
    radius,
    len,
    color,
    [_strutMid.x, _strutMid.y, _strutMid.z],
    [_strutEuler.x, _strutEuler.y, _strutEuler.z],
    6,
    {
      mat,
      rough: 0.6,
    },
  );
}

/**
 * A ribbed panel: the cross-section follows `profile` — a list of [along, depth] pairs (depth 0 at a crest,
 * negative recessed into a groove) — held between each neighbouring pair of `stations` on the other axis.
 * `point(along, depth, station)` maps one (profile point, station) pair to model space [x, y, z]. Flat-shaded
 * on purpose (a non-indexed triangle soup, each quad split into two unshared triangles): a strong low lamp
 * rakes across a real corrugated panel one facet at a time, and this is what lets it.
 */
function ribbedPanel(profile, stations, point) {
  const verts = [];
  for (let s = 0; s < stations.length - 1; s++) {
    const st0 = stations[s];
    const st1 = stations[s + 1];
    for (let i = 0; i < profile.length - 1; i++) {
      const [a0, d0] = profile[i];
      const [a1, d1] = profile[i + 1];
      const p00 = point(a0, d0, st0);
      const p10 = point(a1, d1, st0);
      const p11 = point(a1, d1, st1);
      const p01 = point(a0, d0, st1);
      verts.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A trapezoid-wave rib profile from `start` to `end`: flat at 0 (the crest, `flat` wide), a ramp down over
 * `ramp`, flat at `-depth` (the groove), a ramp back up — repeated every `period`, clipped at the end (so a
 * run that is not a whole number of periods ends part-way through a facet, like a real pressed panel butted
 * against a frame). Callers thin the ribs on a phone by passing a wider `period` (fewer, broader ribs), not
 * by calling this differently — it always builds a clean profile.
 */
function ribProfile(start, end, period, depth, flat, ramp) {
  const groove = period - flat - 2 * ramp;
  const pts = [[start, 0]];
  let x = start;
  while (x < end - 1e-6) {
    const flatEnd = Math.min(x + flat, end);
    pts.push([flatEnd, 0]);
    if (flatEnd >= end) break;
    const rampEnd = Math.min(flatEnd + ramp, end);
    pts.push([rampEnd, -depth * ((rampEnd - flatEnd) / ramp)]);
    if (rampEnd >= end) break;
    const grooveEnd = Math.min(rampEnd + groove, end);
    pts.push([grooveEnd, -depth]);
    if (grooveEnd >= end) break;
    const ramp2End = Math.min(grooveEnd + ramp, end);
    pts.push([ramp2End, -depth * (1 - (ramp2End - grooveEnd) / ramp)]);
    x = ramp2End;
  }
  if (pts[pts.length - 1][0] < end - 1e-6) pts.push([end, pts[pts.length - 1][1]]);
  return pts;
}

// ---------------------------------------------------------------------------------------------------------
// truck — a flatbed cargo truck standing in the yard, front towards -Z (matching the model it replaces).
// A conventional (bonneted) cab on a ladder chassis, with a real round wheel — tyre, rim, hub and nuts —
// in place of the octagonal cylinder it replaces.

const TRUCK_PALETTES = [
  { body: PAINT.olive, canvas: PAINT.oliveDark, deck: PAINT.steelDark },
  { body: PAINT.steel, canvas: PAINT.gunmetal, deck: PAINT.tanDark },
  { body: PAINT.rust, canvas: PAINT.tanDark, deck: PAINT.steelDark },
];

const TRUCK_IDS = [
  { unit: 'UNIT 114', plate: 'LDS 2201' },
  { unit: 'UNIT 228', plate: 'LDS 4487' },
  { unit: 'UNIT 356', plate: 'LDS 6693' },
];

/**
 * One road wheel, built axle-along-Y in its own local frame centred on the hub, then placed with the one
 * `rot` that lays the axle wherever the chassis needs it ([0, 0, PI/2] for an axle along X, the usual
 * case). `face` (+1 or -1 along local Y, before `rot`) says which end is outward, for the hub and nuts.
 * A shoulder/tread/shoulder tyre carries a ring of tread lugs; a steel rim, hub cap and nut ring sit proud
 * of the outward face.
 */
function roadWheel(radius, width, at, rot, face, tireColor) {
  const parts = [];
  const shoulderR = radius * 0.97;
  const shoulderW = width * 0.22;
  const treadW = width - 2 * shoulderW;
  for (const off of [-(treadW / 2 + shoulderW / 2), treadW / 2 + shoulderW / 2])
    parts.push(
      cyl(shoulderR, shoulderR, shoulderW, tireColor, [0, off, 0], undefined, 16, { mat: 'rubber', rough: 0.92 }),
    );
  parts.push(cyl(radius, radius, treadW, tireColor, [0, 0, 0], undefined, 16, { mat: 'rubber', rough: 0.92 }));
  const lugN = geoDetail.bevel ? 16 : 0; // tread lugs are the kind of small part that skips itself on a phone
  for (let i = 0; i < lugN; i++) {
    const a = (i / lugN) * Math.PI * 2;
    parts.push(
      box(
        0.035,
        treadW * 0.8,
        radius * 0.17,
        tireColor,
        [(radius - 0.02) * Math.cos(a), 0, (radius - 0.02) * Math.sin(a)],
        [0, -a, 0],
        { mat: 'rubber', rough: 0.92, bevel: false },
      ),
    );
  }
  parts.push(
    cyl(radius * 0.62, radius * 0.66, width * 0.92, PAINT.steelLight, [0, 0, 0], undefined, 16, {
      mat: 'steel',
      rough: 0.4,
      metal: 0.7,
    }),
  );
  const hubY = face * (width / 2 - 0.016);
  parts.push(
    cyl(radius * 0.25, radius * 0.29, 0.09, PAINT.steelDark, [0, hubY, 0], undefined, 12, {
      mat: 'steel',
      rough: 0.35,
      metal: 0.75,
    }),
  );
  parts.push(
    boltRing(
      8,
      radius * 0.16,
      0.022,
      PAINT.pale,
      [0, hubY + face * 0.05, 0],
      face > 0 ? undefined : [Math.PI, 0, 0],
      'galv',
    ),
  );
  return place(merge(parts), { at, rot });
}

export function buildTruck(variant = 0) {
  const c = pick(TRUCK_PALETTES, variant);
  const id = pick(TRUCK_IDS, variant);
  const solid = [];
  const glow = [];
  const letters = [];

  const R = 0.5; // tyre radius: also the hub/axle height, since the tyre stands on the ground at y = 0
  const railX = 0.75,
    railY = 0.8,
    railH = 0.14; // chassis rails: the spine every other part hangs off
  const CH = 0.92; // body floor: just above the rail top, where the painted bodywork starts
  const hubX = 1.08; // wheel track (half), shared by the front pair and both rear dual pairs
  const dualOff = 0.175; // half the spacing between a rear axle's inner and outer tyre
  const frontZ = -2.7,
    rearZ1 = 1.55,
    rearZ2 = 2.55,
    gearboxZ = -1.5;

  // wheels — one tyre at the front, twins on each rear axle, all the same round wheel
  for (const sx of [-1, 1])
    solid.push(roadWheel(R, 0.36, [sx * hubX, R, frontZ], [0, 0, Math.PI / 2], -sx, PAINT.rubber));
  for (const z of [rearZ1, rearZ2])
    for (const sx of [-1, 1])
      for (const sub of [-1, 1])
        solid.push(roadWheel(R, 0.27, [sx * (hubX + sub * dualOff), R, z], [0, 0, Math.PI / 2], -sx, PAINT.rubber));

  // running gear under the chassis line: three visible axles, a leaf-spring pack at each, a propeller
  // shaft from the gearbox to the first rear axle, and the two rails tying it all together
  for (const z of [frontZ, rearZ1, rearZ2])
    solid.push(
      cyl(0.07, 0.07, hubX * 2 - 0.3, PAINT.steelDark, [0, R, z], [0, 0, Math.PI / 2], 10, {
        mat: 'steel',
        rough: 0.5,
        metal: 0.6,
      }),
    );
  for (const z of [frontZ, rearZ1, rearZ2])
    for (const sx of [-1, 1])
      solid.push(
        nub(
          0.1,
          railY - R - 0.07 + railH / 2,
          0.5,
          PAINT.steelDark,
          [sx * (railX + 0.08), (R + railY - railH / 2) / 2, z],
          undefined,
          {
            mat: 'steel',
            rough: 0.6,
          },
        ),
      ); // leaf-spring pack
  solid.push(
    cyl(
      0.05,
      0.05,
      rearZ1 - gearboxZ,
      PAINT.steelLight,
      [0, R + 0.08, (gearboxZ + rearZ1) / 2],
      [Math.PI / 2, 0, 0],
      8,
      {
        mat: 'steel',
        rough: 0.35,
        metal: 0.7,
      },
    ),
  );
  for (const sx of [-1, 1])
    solid.push(nub(0.1, 0.1, 6.0, PAINT.steelDark, [sx * railX, railY, 0.1], undefined, { mat: 'steel', rough: 0.55 }));
  for (const z of [-2.6, -0.6, 1.0, 2.0, 3.0])
    solid.push(
      nub(railX * 2 + 0.1, 0.07, 0.1, PAINT.steelDark, [0, railY - 0.02, z], undefined, { mat: 'steel', rough: 0.55 }),
    );

  // front end: bumper, slatted grille, headlamps and indicators, a modest bonnet
  solid.push(box(2.5, 0.16, 0.1, PAINT.black, [0, 0.55, -3.38], undefined, { mat: 'polymer', rough: 0.55 }));
  solid.push(
    box(2.1, 0.5, 0.08, PAINT.gunmetal, [0, 0.9, -3.3], undefined, { mat: 'gunmetal', rough: 0.5, metal: 0.4 }),
  );
  for (let i = 0; i < 4; i++)
    solid.push(
      nub(2.0, 0.04, 0.02, PAINT.steelLight, [0, 0.72 + i * 0.12, -3.33], undefined, {
        mat: 'gunmetal',
        rough: 0.4,
        metal: 0.5,
      }),
    );
  for (const sx of [-1, 1]) {
    solid.push(box(0.22, 0.2, 0.08, PAINT.black, [sx * 0.85, 0.75, -3.36], undefined, { mat: 'polymer', rough: 0.5 }));
    solid.push(
      box(0.16, 0.14, 0.015, PAINT.glass, [sx * 0.85, 0.75, -3.405], undefined, {
        mat: 'glass',
        rough: 0.15,
        metal: 0.1,
      }),
    );
    glow.push(box(0.12, 0.1, 0.01, GLOW.headlampDim, [sx * 0.85, 0.75, -3.414]));
    solid.push(box(0.08, 0.08, 0.02, PAINT.yellow, [sx * 1.05, 0.75, -3.4], undefined, { mat: 'glass', rough: 0.3 })); // indicator lens
  }
  solid.push(box(2.1, 0.5, 0.65, c.body, [0, CH + 0.25, -2.95], undefined, { mat: 'paint', rough: 0.55 })); // bonnet

  // windscreen, raked back from the bonnet's rear-top edge to the cab's front-top edge, with wipers resting
  const wsY0 = CH + 0.5,
    wsZ0 = -2.72,
    wsY1 = CH + 1.78,
    wsZ1 = -2.5;
  const wsLen = Math.hypot(wsY1 - wsY0, wsZ1 - wsZ0);
  const wsAng = Math.atan2(wsZ1 - wsZ0, wsY1 - wsY0);
  solid.push(
    box(2.1, wsLen, 0.03, PAINT.glass, [0, (wsY0 + wsY1) / 2, (wsZ0 + wsZ1) / 2], [wsAng, 0, 0], {
      mat: 'glass',
      rough: 0.1,
      metal: 0.05,
    }),
  );
  for (const sx of [-1, 1])
    solid.push(
      nub(0.38, 0.02, 0.025, PAINT.steelDark, [sx * 0.5, wsY0 + 0.03, wsZ0 + 0.015], [wsAng, 0, 0], {
        mat: 'steel',
        rough: 0.5,
        metal: 0.4,
      }),
    );

  // cab: separate doors (seam, hinge, handle), a window each side, mirrors on arms, steps below
  const halfCabW = 1.15,
    cabZ0 = -2.5,
    cabZ1 = -1.55,
    cabY1 = CH + 1.78;
  solid.push(
    box(2 * halfCabW, cabY1 - CH, cabZ1 - cabZ0, c.body, [0, (CH + cabY1) / 2, (cabZ0 + cabZ1) / 2], undefined, {
      mat: 'paint',
      rough: 0.55,
    }),
  );
  for (const sx of [-1, 1]) {
    const doorZ0 = cabZ0 + 0.08,
      doorZ1 = cabZ1 - 0.08;
    solid.push(
      box(
        0.012,
        cabY1 - CH - 0.12,
        0.012,
        PAINT.steelDark,
        [sx * (halfCabW + 0.006), (CH + cabY1) / 2, doorZ0],
        undefined,
        { mat: 'steel', rough: 0.6, bevel: false },
      ),
    ); // door seam, front edge
    solid.push(
      hingeStrap(cabY1 - CH - 0.3, c.body, [sx * (halfCabW + 0.01), (CH + cabY1) / 2, doorZ0 + 0.04], undefined),
    );
    solid.push(
      nub(0.04, 0.035, 0.14, PAINT.pale, [sx * (halfCabW + 0.03), CH + 1.0, doorZ1 - 0.12], undefined, {
        mat: 'galv',
        rough: 0.4,
        metal: 0.6,
      }),
    ); // handle
    solid.push(
      box(0.03, 0.45, 0.42, PAINT.glass, [sx * (halfCabW + 0.006), CH + 1.35, (doorZ0 + doorZ1) / 2], undefined, {
        mat: 'glass',
        rough: 0.15,
        metal: 0.1,
      }),
    );
    solid.push(
      nub(0.05, 0.035, 0.42, c.body, [sx * (halfCabW + 0.01), CH + 1.6, (doorZ0 + doorZ1) / 2], undefined, {
        mat: 'paint',
        rough: 0.55,
      }),
    ); // window frame top
    solid.push(
      nub(0.14, 0.04, 0.55, PAINT.steelDark, [sx * (halfCabW + 0.08), CH - 0.12, doorZ1 - 0.1], undefined, {
        mat: 'steel',
        rough: 0.6,
        metal: 0.3,
      }),
    ); // step
    solid.push(
      nub(0.05, 0.03, 0.3, PAINT.steelDark, [sx * (halfCabW + 0.02), CH + 1.72, cabZ0 + 0.02], undefined, {
        mat: 'steel',
        rough: 0.5,
        metal: 0.5,
      }),
    ); // mirror arm
    solid.push(
      box(0.04, 0.2, 0.13, PAINT.steelDark, [sx * (halfCabW + 0.22), CH + 1.72, cabZ0 - 0.04], undefined, {
        mat: 'polymer',
        rough: 0.45,
      }),
    ); // mirror housing
    solid.push(
      box(0.012, 0.16, 0.1, PAINT.glass, [sx * (halfCabW + 0.245), CH + 1.72, cabZ0 - 0.04], undefined, {
        mat: 'glass',
        rough: 0.1,
        metal: 0.2,
      }),
    );
    letters.push({
      text: id.unit,
      at: [sx * (halfCabW + 0.007), CH + 0.95, (doorZ0 + doorZ1) / 2 + 0.35],
      out: [sx, 0, 0],
      height: 0.11,
      tone: 'white',
    });
  }

  // exhaust stack, beside the cab, and a fuel tank with straps and a filler cap on the other
  solid.push(
    cyl(0.05, 0.055, 1.95, PAINT.steelDark, [1.3, 1.92, -1.7], undefined, 12, {
      mat: 'steel',
      rough: 0.4,
      metal: 0.65,
    }),
  );
  solid.push(
    nub(0.09, 0.07, 0.09, PAINT.steelDark, [1.3, 2.9, -1.7], undefined, { mat: 'steel', rough: 0.5, metal: 0.5 }),
  ); // rain cap
  solid.push(
    cyl(0.22, 0.22, 0.7, PAINT.steelLight, [-1.0, 0.95, -0.55], [Math.PI / 2, 0, 0], 14, {
      mat: 'steel',
      rough: 0.45,
      metal: 0.6,
    }),
  );
  for (const z of [-0.78, -0.32])
    solid.push(nub(0.3, 0.025, 0.1, PAINT.pale, [-1.0, 1.28, z], undefined, { mat: 'galv', rough: 0.5, metal: 0.5 })); // strap
  solid.push(
    cyl(0.05, 0.05, 0.06, PAINT.steelDark, [-1.0, 1.18, -0.55], undefined, 8, { mat: 'steel', rough: 0.4, metal: 0.6 }),
  ); // filler cap
  for (const z of [0.0, 0.4])
    solid.push(
      cyl(0.14, 0.14, 0.45, PAINT.steelLight, [0.95, 0.95, z], [Math.PI / 2, 0, 0], 12, {
        mat: 'steel',
        rough: 0.45,
        metal: 0.55,
      }),
    ); // air tanks

  // load bed: a wood deck on the chassis, low drop-side rails, a ridge-tent canvas tilt roped down over it
  const halfBedW = 1.25,
    bedZ0 = -1.3,
    bedZ1 = 3.1;
  const bedZm = (bedZ0 + bedZ1) / 2,
    bedLen = bedZ1 - bedZ0;
  solid.push(box(2 * halfBedW, 0.08, bedLen, c.deck, [0, CH + 0.04, bedZm], undefined, { mat: 'wood', rough: 0.85 }));
  for (const sx of [-1, 1])
    solid.push(
      box(0.04, 0.3, bedLen, c.body, [sx * halfBedW, CH + 0.23, bedZm], undefined, { mat: 'paint', rough: 0.55 }),
    );

  const eaveX = 1.05,
    eaveY = CH + 0.42,
    ridgeY = CH + 1.42;
  const roofSlopeLen = Math.hypot(eaveX, ridgeY - eaveY);
  for (const sx of [-1, 1]) {
    const ang = Math.atan2(sx * eaveX, ridgeY - eaveY); // tilts local +Y to lie along the eave->ridge line
    solid.push(
      box(0.04, roofSlopeLen, bedLen, c.canvas, [(sx * eaveX) / 2, (eaveY + ridgeY) / 2, bedZm], [0, 0, ang], {
        mat: 'fabric',
        rough: 0.9,
      }),
    );
  }
  solid.push(
    nub(eaveX * 2, ridgeY - eaveY, 0.03, c.canvas, [0, (eaveY + ridgeY) / 2, bedZ0 + 0.015], undefined, {
      mat: 'fabric',
      rough: 0.9,
    }),
  ); // gable
  solid.push(
    nub(eaveX * 2, ridgeY - eaveY, 0.03, c.canvas, [0, (eaveY + ridgeY) / 2, bedZ1 - 0.015], undefined, {
      mat: 'fabric',
      rough: 0.9,
    }),
  );
  for (const sx of [-1, 1]) {
    const ang = Math.atan2(sx * eaveX, ridgeY - eaveY);
    for (const z of [bedZ0 + bedLen * 0.2, bedZm, bedZ0 + bedLen * 0.8])
      solid.push(
        nub(0.05, roofSlopeLen, 0.05, PAINT.black, [(sx * eaveX) / 2, (eaveY + ridgeY) / 2, z], [0, 0, ang], {
          mat: 'fabric',
          rough: 0.8,
        }),
      ); // tie-down rope over the tilt
  }
  for (const z of [bedZ0 + 0.3, bedZ1 - 0.3])
    solid.push(
      ...lace(
        [
          [-eaveX * 0.9, eaveY - 0.05, z],
          [0, CH + 0.3, z],
          [eaveX * 0.9, eaveY - 0.05, z],
        ],
        0.014,
        PAINT.black,
        'fabric',
      ),
    ); // rope lashing the gable down to the rail

  // tailgate, hung on two bottom hinges with a centre latch, the registration plate and dim tail lamps
  const tailZ = 3.22;
  solid.push(box(2 * halfBedW, 0.3, 0.07, c.body, [0, CH + 0.23, tailZ], undefined, { mat: 'paint', rough: 0.55 }));
  for (const sx of [-1, 1])
    solid.push(hingeStrap(0.26, PAINT.steelDark, [sx * (halfBedW - 0.15), CH + 0.08, tailZ], [0, 0, Math.PI / 2]));
  solid.push(
    nub(0.18, 0.05, 0.03, PAINT.pale, [0, CH + 0.33, tailZ + 0.04], undefined, { mat: 'galv', rough: 0.4, metal: 0.6 }),
  );
  for (const sx of [-1, 1]) {
    solid.push(
      box(0.13, 0.13, 0.04, PAINT.black, [sx * 1.0, CH + 0.23, tailZ + 0.035], undefined, {
        mat: 'polymer',
        rough: 0.5,
      }),
    );
    glow.push(box(0.09, 0.09, 0.015, GLOW.taillampDim, [sx * 1.0, CH + 0.23, tailZ + 0.057]));
  }
  solid.push(
    box(0.38, 0.14, 0.012, PAINT.white, [0, CH + 0.23, tailZ + 0.037], undefined, { mat: 'paint', rough: 0.4 }),
  ); // plate backing
  letters.push({ text: id.plate, at: [0, CH + 0.23, tailZ + 0.044], out: [0, 0, 1], height: 0.1, tone: 'black' });

  // front registration plate, on the bumper
  solid.push(box(0.38, 0.14, 0.012, PAINT.white, [0, 0.55, -3.43], undefined, { mat: 'paint', rough: 0.4 }));
  letters.push({ text: id.plate, at: [0, 0.55, -3.437], out: [0, 0, -1], height: 0.1, tone: 'black' });

  // a hazard/load marking on both sides of the body, under the drop-side rail, on the clear run of panel
  // ahead of the rear wheel arches
  for (const sx of [-1, 1])
    letters.push({
      text: 'MAX LOAD 8 000 KG',
      at: [sx * (halfBedW + 0.007), CH + 0.1, -0.3],
      out: [sx, 0, 0],
      height: 0.08,
      tone: 'hazard',
    });

  // mud guards: an arched fender over each front wheel, one over each rear dual pair (wide enough for both
  // tyres of the pair), and a flap hanging behind the rearmost axle
  for (const sx of [-1, 1])
    solid.push(
      arcGuard(
        R + 0.08,
        Math.PI * 0.95,
        -Math.PI * 0.475,
        0.4,
        0.025,
        c.body,
        [sx * hubX, R, frontZ],
        [0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
        7,
        {
          mat: 'paint',
          rough: 0.55,
        },
      ),
    );
  for (const z of [rearZ1, rearZ2])
    for (const sx of [-1, 1])
      solid.push(
        arcGuard(
          R + 0.1,
          Math.PI * 0.95,
          -Math.PI * 0.475,
          0.68,
          0.025,
          PAINT.steelDark,
          [sx * hubX, R, z],
          [0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0],
          7,
          {
            mat: 'paint',
            rough: 0.55,
          },
        ),
      );
  for (const sx of [-1, 1])
    solid.push(
      nub(0.28, 0.32, 0.02, PAINT.black, [sx * hubX, R - 0.28, rearZ2 + 0.35], undefined, {
        mat: 'polymer',
        rough: 0.6,
      }),
    ); // flap

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}

// ---------------------------------------------------------------------------------------------------------
// container — a 20ft-style shipping container standing in the yard. Long axis (6 m) along X, the door end
// at -X (matching the model it replaces). Corrugated walls are flat-shaded ribbed panels (ribbedPanel) with
// a plain painted backer sheet just inside the grooves, so the shell reads as a real corrugated box from
// every angle and still closes as a solid.

const CONTAINER_PALETTES = [
  { base: PAINT.blue, dark: PAINT.blueDark },
  { base: PAINT.rust, dark: PAINT.rustDark },
  { base: PAINT.olive, dark: PAINT.oliveDark },
  { base: PAINT.steelLight, dark: PAINT.steelDark },
];

// invented shipping lines (no real company) — the owner code is the prefix ISO 6346 gives a line's boxes
const CONTAINER_LINES = [
  { name: 'HOLLOW LINE', owner: 'HLWU' },
  { name: 'NINE FREIGHT', owner: 'NFTU' },
];

const ISO6346_VALUE = {};
{
  // the ISO 6346 letter-to-value table is built by counting up from 10, skipping multiples of 11
  let v = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    while (v % 11 === 0) v++;
    ISO6346_VALUE[ch] = v;
    v++;
  }
}

/** The ISO 6346 check digit for a 4-character owner+category code followed by a 6-digit serial. */
function containerCheckDigit(code10) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = code10[i];
    const v = ch >= '0' && ch <= '9' ? Number(ch) : ISO6346_VALUE[ch];
    sum += v * 2 ** i;
  }
  const mod = sum % 11;
  return mod === 10 ? 0 : mod;
}

/** A line name and a full owner code + serial + check digit, both varying by variant. */
function containerNumber(variant) {
  const line = pick(CONTAINER_LINES, variant);
  const serial = String((204551 + Math.abs(variant) * 73129) % 1000000).padStart(6, '0');
  const check = containerCheckDigit(line.owner + serial);
  return { line: line.name, number: `${line.owner} ${serial} ${check}` };
}

/**
 * A corrugated sheet: a wave of period/depth/flat/ramp runs along `waveAxis` (0=x, 1=y, 2=z) over
 * `waveRange`, swept between `stationRange` along `stationAxis`. `fixedAxis` is held at
 * `outward * (fixedValue + depth)` — `outward` (+-1) says which way the crest (depth 0) faces.
 */
function corrugatedSheet({
  waveAxis,
  waveRange,
  period,
  depth,
  flat,
  ramp,
  fixedAxis,
  fixedValue,
  outward,
  stationAxis,
  stationRange,
  stations = 2,
}) {
  const profile = ribProfile(waveRange[0], waveRange[1], period, depth, flat, ramp);
  const stationVals = [];
  for (let i = 0; i < stations; i++)
    stationVals.push(stationRange[0] + ((stationRange[1] - stationRange[0]) * i) / (stations - 1));
  const point = (along, d, station) => {
    const p = [0, 0, 0];
    p[waveAxis] = along;
    p[stationAxis] = station;
    p[fixedAxis] = outward * (fixedValue + d);
    return p;
  };
  return ribbedPanel(profile, stationVals, point);
}

export function buildContainer(variant = 0) {
  const c = pick(CONTAINER_PALETTES, variant);
  const low = !geoDetail.bevel;

  const halfW = 3,
    halfD = 1,
    H = 2.6;
  const postW = 0.09;
  const railH = 0.22; // tall enough for a forklift pocket to read inside it
  const topRailH = 0.1;
  const wallY0 = railH,
    wallY1 = H - topRailH; // 0.22 .. 2.5
  const ribDepth = 0.035;
  const period = low ? 0.6 : 0.3;
  const flat = period * 0.3,
    ramp = period * 0.2;
  const roofDepth = 0.02;
  const roofPeriod = low ? 0.9 : 0.45;
  const roofFlat = roofPeriod * 0.35,
    roofRamp = roofPeriod * 0.2;

  const solid = [];
  const glow = null; // parked, underground, unlit — a container has no lamps of its own
  const letters = [];
  const shade = (mat, rough = 0.75, metal = 0) => ({ mat, rough, metal });

  // four corner posts, full height, flush with both the side-wall crest and the end-wall/door crest
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      solid.push(
        box(
          postW,
          H,
          postW,
          c.base,
          [sx * (halfW - postW / 2), H / 2, sz * (halfD - postW / 2)],
          undefined,
          shade('paint', 0.7),
        ),
      );

  // side walls: corrugated skin with a plain backer just inside the grooves so the shell is a closed solid
  for (const sz of [-1, 1]) {
    solid.push(
      paint(
        corrugatedSheet({
          waveAxis: 0,
          waveRange: [-(halfW - postW), halfW - postW],
          period,
          depth: ribDepth,
          flat,
          ramp,
          fixedAxis: 2,
          fixedValue: halfD,
          outward: sz,
          stationAxis: 1,
          stationRange: [wallY0, wallY1],
        }),
        c.base,
        shade('paint', 0.75),
      ),
    );
    solid.push(
      box(
        2 * (halfW - postW),
        wallY1 - wallY0,
        0.02,
        c.dark,
        [0, (wallY0 + wallY1) / 2, sz * (halfD - ribDepth - 0.01)],
        undefined,
        {
          ...shade('paint', 0.85),
          bevel: false,
        },
      ),
    );
    // bottom rail, split around the two forklift pockets; top rail, unbroken
    const pocketXs = [-1.1, 1.1];
    const pocketW = 0.4;
    const spans = [
      [-(halfW - postW), pocketXs[0] - pocketW / 2],
      [pocketXs[0] + pocketW / 2, pocketXs[1] - pocketW / 2],
      [pocketXs[1] + pocketW / 2, halfW - postW],
    ];
    for (const [x0, x1] of spans)
      solid.push(
        box(
          x1 - x0,
          railH,
          postW,
          c.base,
          [(x0 + x1) / 2, railH / 2, sz * (halfD - postW / 2)],
          undefined,
          shade('paint', 0.7),
        ),
      );
    solid.push(
      box(
        2 * (halfW - postW),
        topRailH,
        postW,
        c.base,
        [0, H - topRailH / 2, sz * (halfD - postW / 2)],
        undefined,
        shade('paint', 0.7),
      ),
    );
  }
  // forklift pocket tunnels: a ceiling and a floor plate through the full width, where the rail gap is
  for (const px of [-1.1, 1.1]) {
    solid.push(
      box(0.4, 0.02, 2 * halfD, PAINT.steelDark, [px, railH - 0.02, 0], undefined, {
        ...shade('steel', 0.8, 0.3),
        bevel: false,
      }),
    );
    solid.push(
      box(0.4, 0.02, 2 * halfD, PAINT.steelDark, [px, 0.03, 0], undefined, {
        ...shade('steel', 0.8, 0.3),
        bevel: false,
      }),
    );
  }

  // end wall at +X (opposite the doors): corrugated skin plus a backer, same technique as the side walls
  solid.push(
    paint(
      corrugatedSheet({
        waveAxis: 2,
        waveRange: [-(halfD - postW), halfD - postW],
        period,
        depth: ribDepth,
        flat,
        ramp,
        fixedAxis: 0,
        fixedValue: halfW,
        outward: 1,
        stationAxis: 1,
        stationRange: [wallY0, wallY1],
      }),
      c.base,
      shade('paint', 0.75),
    ),
  );
  solid.push(
    box(
      0.02,
      wallY1 - wallY0,
      2 * (halfD - postW),
      c.dark,
      [halfW - ribDepth - 0.01, (wallY0 + wallY1) / 2, 0],
      undefined,
      {
        ...shade('paint', 0.85),
        bevel: false,
      },
    ),
  );
  solid.push(
    box(
      postW,
      topRailH,
      2 * (halfD - postW),
      c.base,
      [halfW - postW / 2, H - topRailH / 2, 0],
      undefined,
      shade('paint', 0.7),
    ),
  );
  solid.push(
    box(postW, railH, 2 * (halfD - postW), c.base, [halfW - postW / 2, railH / 2, 0], undefined, shade('paint', 0.7)),
  );

  // roof: shallow corrugation flush at y = H everywhere (the crest), never above it
  solid.push(
    paint(
      corrugatedSheet({
        waveAxis: 0,
        waveRange: [-(halfW - postW), halfW - postW],
        period: roofPeriod,
        depth: roofDepth,
        flat: roofFlat,
        ramp: roofRamp,
        fixedAxis: 1,
        fixedValue: H,
        outward: 1,
        stationAxis: 2,
        stationRange: [-(halfD - postW), halfD - postW],
      }),
      c.base,
      shade('paint', 0.7),
    ),
  );
  solid.push(
    box(2 * (halfW - postW), 0.02, 2 * (halfD - postW), c.dark, [0, H - roofDepth - 0.02, 0], undefined, {
      ...shade('paint', 0.85),
      bevel: false,
    }),
  );

  // corner castings: eight, top and bottom, flush with the roofline / the ground, a recess suggesting the
  // oval twist-lock hole in the outward-facing face — safely inside the casting, never past y=0 or y=H
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const cx = sx * (halfW - postW / 2);
      const cz = sz * (halfD - postW / 2);
      solid.push(box(0.17, 0.14, 0.15, PAINT.steelDark, [cx, 0.07, cz], undefined, shade('steel', 0.6, 0.5)));
      solid.push(box(0.17, 0.14, 0.15, PAINT.steelDark, [cx, H - 0.07, cz], undefined, shade('steel', 0.6, 0.5)));
      solid.push(box(0.09, 0.02, 0.045, PAINT.black, [cx, 0.011, cz], undefined, shade('steel', 0.4, 0.2)));
      solid.push(box(0.09, 0.02, 0.045, PAINT.black, [cx, H - 0.011, cz], undefined, shade('steel', 0.4, 0.2)));
    }
  // a rivet line along every rail and post — cheap studs that read as a bolted-together hull up close
  const rivet = (at) =>
    solid.push(
      cyl(0.012, 0.012, 0.018, PAINT.steelDark, at, [Math.PI / 2, 0, 0], 6, {
        ...shade('steel', 0.4, 0.6),
        bevel: false,
      }),
    );
  for (const sz of [-1, 1]) {
    const rz = sz * (halfD - postW / 2 - 0.02);
    for (let i = 0; i < (low ? 0 : 10); i++)
      rivet([-halfW + postW + (2 * (halfW - postW) * (i + 0.5)) / 10, railH - 0.03, rz]);
    for (let i = 0; i < (low ? 0 : 10); i++)
      rivet([-halfW + postW + (2 * (halfW - postW) * (i + 0.5)) / 10, H - topRailH + 0.03, rz]);
  }
  for (const sx of [-1, 1]) {
    const rx = sx * (halfW - postW / 2 - 0.02);
    for (let i = 0; i < (low ? 0 : 8); i++)
      rivet([rx, railH - 0.03, -(halfD - postW) + (2 * (halfD - postW) * (i + 0.5)) / 8]);
    for (let i = 0; i < (low ? 0 : 8); i++)
      rivet([rx, H - topRailH + 0.03, -(halfD - postW) + (2 * (halfD - postW) * (i + 0.5)) / 8]);
  }
  // a vertical rivet line and a diagonal gusset bracing each corner post into the top rail
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = sx * (halfW - postW / 2);
      const pz = sz * (halfD - postW / 2);
      if (!low) for (let i = 0; i < 6; i++) rivet([px + sx * (postW / 2 + 0.01), railH + 0.18 + i * 0.38, pz]);
      solid.push(
        box(
          0.22,
          0.02,
          0.05,
          PAINT.steelDark,
          [px - sx * 0.09, H - topRailH - 0.09, pz],
          [0, 0, (-sx * Math.PI) / 4],
          shade('steel', 0.55, 0.5),
        ),
      );
    }
  // a CSC-style data plate, upper-left of the door end, and pale placard backings — proud of the crest by
  // a few mm, like a smooth patch riveted over the ribs — behind the owner-code and weights text
  solid.push(
    box(0.012, 0.16, 0.24, PAINT.pale, [-(halfW + 0.02), H - 0.42, -halfD + 0.45], undefined, shade('steel', 0.5, 0.2)),
  );
  solid.push(
    box(
      0.006,
      0.13,
      0.21,
      PAINT.steelDark,
      [-(halfW + 0.012), H - 0.42, -halfD + 0.45],
      undefined,
      shade('steel', 0.5, 0.2),
    ),
  );
  for (const sz of [-1, 1])
    solid.push(
      box(1.3, 0.26, 0.012, PAINT.pale, [1.1, 1.25, sz * (halfD + 0.006)], undefined, {
        ...shade('paint', 0.6),
        bevel: false,
      }),
    );
  solid.push(
    box(0.012, 0.22, 0.7, PAINT.pale, [-(halfW + 0.006), 2.0, 0.5], undefined, {
      ...shade('paint', 0.6),
      bevel: false,
    }),
  );
  solid.push(
    box(0.012, 0.5, 0.7, PAINT.pale, [-(halfW + 0.006), 0.42, 0.5], undefined, {
      ...shade('paint', 0.6),
      bevel: false,
    }),
  );
  // a strip of plank flooring, glimpsed just inside the door opening
  const plankN = low ? 3 : 7;
  const plankSpan = 2 * (halfD - postW) - 0.04;
  const plankW = plankSpan / plankN - 0.01;
  for (let i = 0; i < plankN; i++) {
    const pz = -plankSpan / 2 + plankW / 2 + i * (plankSpan / plankN);
    solid.push(
      box(0.46, 0.04, plankW, PAINT.tanDark, [-halfW + 0.26, wallY0 + 0.03, pz], undefined, {
        mat: 'wood',
        rough: 0.85,
      }),
    );
  }

  // door end at -X: two leaves, each a corrugated skin of its own, hung on hinges at the outer (post) edge,
  // with lock rods, cams, keepers and handles near the gap, and a rubber gasket around the opening
  const doorY0 = wallY0,
    doorY1 = wallY1;
  solid.push(
    box(
      postW,
      topRailH,
      2 * (halfD - postW),
      c.base,
      [-(halfW - postW / 2), H - topRailH / 2, 0],
      undefined,
      shade('paint', 0.7),
    ),
  ); // header
  solid.push(
    box(
      postW,
      railH,
      2 * (halfD - postW),
      c.base,
      [-(halfW - postW / 2), railH / 2, 0],
      undefined,
      shade('paint', 0.7),
    ),
  ); // sill
  const gapHalf = 0.08;
  const doorPeriod = low ? 0.8 : 0.4;
  const doorFlat = doorPeriod * 0.3,
    doorRamp = doorPeriod * 0.2;
  for (const sz of [-1, 1]) {
    const inner = sz * gapHalf;
    const outer = sz * (halfD - postW);
    solid.push(
      paint(
        corrugatedSheet({
          waveAxis: 2,
          waveRange: sz > 0 ? [inner, outer] : [outer, inner],
          period: doorPeriod,
          depth: ribDepth,
          flat: doorFlat,
          ramp: doorRamp,
          fixedAxis: 0,
          fixedValue: halfW,
          outward: -1,
          stationAxis: 1,
          stationRange: [doorY0, doorY1],
        }),
        c.base,
        shade('paint', 0.75),
      ),
    );
    solid.push(
      box(
        0.02,
        doorY1 - doorY0,
        Math.abs(outer - inner),
        c.dark,
        [-(halfW - ribDepth - 0.01), (doorY0 + doorY1) / 2, (inner + outer) / 2],
        undefined,
        {
          ...shade('paint', 0.85),
          bevel: false,
        },
      ),
    );
    // the pin stands vertical (cyl()'s own Y axis), parallel to the door's own swing axis — no rot needed
    for (const y of low ? [0.4, 2.15] : [0.35, 1.3, 2.2])
      solid.push(hingeStrap(0.26, PAINT.steelDark, [-(halfW - 0.01), y, outer]));
    for (const lz of [sz * (gapHalf + 0.18), sz * (gapHalf + 0.5)]) {
      solid.push(
        cyl(
          0.018,
          0.018,
          doorY1 - doorY0 - 0.1,
          PAINT.pale,
          [-(halfW - 0.05), (doorY0 + doorY1) / 2, lz],
          undefined,
          8,
          shade('galv', 0.4, 0.7),
        ),
      );
      for (const y of [doorY0 + 0.06, doorY1 - 0.06]) {
        solid.push(
          nub(0.05, 0.07, 0.03, PAINT.steelDark, [-(halfW - 0.07), y, lz], undefined, shade('steel', 0.5, 0.6)),
        ); // cam
        solid.push(
          nub(
            0.04,
            0.05,
            0.05,
            PAINT.steelDark,
            [-(halfW - 0.08), y + sz * 0.06, lz],
            undefined,
            shade('steel', 0.5, 0.6),
          ),
        ); // keeper
      }
    }
    // a handle lever on the rod nearest the gap, at a reachable height
    solid.push(
      nub(
        0.04,
        0.22,
        0.03,
        PAINT.pale,
        [-(halfW - 0.1), 1.3, sz * (gapHalf + 0.18)],
        undefined,
        shade('galv', 0.4, 0.7),
      ),
    );
  }
  // gasket: a thin rubber loop just inside the opening frame
  for (const sz of [-1, 1])
    solid.push(
      box(
        0.03,
        doorY1 - doorY0,
        0.03,
        PAINT.rubber,
        [-(halfW - 0.1), (doorY0 + doorY1) / 2, sz * (halfD - postW - 0.02)],
        undefined,
        { ...shade('rubber', 0.9), bevel: false },
      ),
    );
  solid.push(
    box(0.03, 0.03, 2 * (halfD - postW - 0.02), PAINT.rubber, [-(halfW - 0.1), doorY1, 0], undefined, {
      ...shade('rubber', 0.9),
      bevel: false,
    }),
  );
  solid.push(
    box(0.03, 0.03, 2 * (halfD - postW - 0.02), PAINT.rubber, [-(halfW - 0.1), doorY0, 0], undefined, {
      ...shade('rubber', 0.9),
      bevel: false,
    }),
  );

  const num = containerNumber(variant);
  // -0.47 and 1.33 are both rib crests (not a flank or groove) at every detail level's rib period (0.6 at
  // low, 0.3 at medium/high) — the profile is anchored at the wall's -X edge, so only an x that is a whole
  // number of the longer (low-detail) period from that edge is guaranteed a crest at every period
  letters.push(
    { text: num.line, at: [-0.47, 1.85, halfD], out: [0, 0, 1], height: 0.4, tone: 'white' },
    { text: num.line, at: [-0.47, 1.85, -halfD], out: [0, 0, -1], height: 0.4, tone: 'white' },
    { text: num.number, at: [1.33, 1.25, halfD], out: [0, 0, 1], height: 0.16, tone: 'white' },
    { text: num.number, at: [1.33, 1.25, -halfD], out: [0, 0, -1], height: 0.16, tone: 'white' },
    { text: num.number, at: [-halfW, 2.0, 0.5], out: [-1, 0, 0], height: 0.14, tone: 'white' },
    { text: 'MAX GROSS 30 480 KG', at: [-halfW, 0.5, 0.5], out: [-1, 0, 0], height: 0.08, tone: 'black' },
    { text: 'TARE 2 250 KG', at: [-halfW, 0.32, 0.5], out: [-1, 0, 0], height: 0.08, tone: 'black' },
  );

  return { solid: merge(solid), glow, letters };
}
