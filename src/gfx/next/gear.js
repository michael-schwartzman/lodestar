// The next renderer path's site furniture: a counterbalance forklift, an operator's control console and a
// switchgear line-up, built from painted primitives the same way src/gfx/propModels.js is, but each returns
// its own merged `solid`/`glow` plus `letters` — what is written on it, for a new renderer to draw as lit
// decals (gfx/next/lettering.js) — exactly as src/gfx/next/props.js does for the truck and the container.
// No textures, no three.js lights, no materials here: just geometry and paint (geo.js), and what each part is
// made of (gfx/matter.js). A model stands on y = 0, centred on its footprint (src/world/props.js), and faces
// the same way the builder it replaces does (src/gfx/propModels.js): forks, the instrument panel and the
// cubicle doors all towards -Z, checked by eye against tools/preview/props.html.
import * as THREE from 'three';
import { paint, place, box, cyl, ball, merge, geoDetail, sides } from '../geo.js';

// albedo paint, kept in the mid range (<~0.8): a faded forklift livery and dark running gear, and the pale
// enamel the plan calls for on the console and the switchgear ("pale grey-green or light grey enamel") —
// lighter than the dark steel the old builders used, so the new detail actually catches the key light.
const PAINT = {
  steel: 0x5d6a70,
  steelLight: 0x76858c,
  steelDark: 0x454e53,
  gunmetal: 0x3a4348,
  yellow: 0xb8973c,
  orange: 0xac6326,
  oliveDrab: 0x6a6b49,
  rubber: 0x2e3234,
  glass: 0x161b1f,
  chrome: 0xaeb4b4,
  brass: 0x8a7236,
  pale: 0x9aa39f,
  white: 0xc7c9c4,
  black: 0x17191a,
  safetyRed: 0x832318,
  rust: 0x6e4327,
  enamelSage: 0x8e9892,
  enamelGrey: 0xacb0ab,
  enamelBlue: 0x8d9aa1,
  panelSage: 0x585e5a,
  panelGrey: 0x6b6d6a,
  panelBlue: 0x575f64,
};

const GLOW = {
  headlampDim: new THREE.Color(0.22, 0.22, 0.2),
  taillampDim: new THREE.Color(0.22, 0.03, 0.03),
  beaconAmber: new THREE.Color(3.0, 1.6, 0.2),
  screenCyan: new THREE.Color(0.45, 1.1, 1.05),
  annunciator: new THREE.Color(1.1, 0.95, 0.35),
  ledGreen: new THREE.Color(0.35, 1.8, 0.55),
  ledAmber: new THREE.Color(2.0, 1.2, 0.22),
  ledRed: new THREE.Color(1.8, 0.22, 0.18),
};

// how far a glow lens sits proud of the solid under it, so the two never z-fight (propModels.js's PROUD)
const PROUD = 0.004;

const wrap = (i, n) => ((i % n) + n) % n;
/** Picks an item of a palette by variant, wrapping so that any integer (including negatives) works. */
const pick = (list, variant) => list[wrap(variant, list.length)];

/** A box with sharp edges regardless of detail level — for small parts, and every glow face, a bevel would
 * be wasted on (the glow shader never reads normal). */
function nub(w, h, d, color, at, rot, shade) {
  return box(w, h, d, color, at, rot, { ...shade, bevel: false });
}

/** A strap hinge: a pin with two knuckle wraps, axis along Y before `rot` turns it (so a door hinged on a
 * vertical edge needs no rotation at all). One merged, already-placed geometry. */
function hingeStrap(len, color, at, rot, mat) {
  return place(
    merge([
      cyl(0.012, 0.012, len, PAINT.steelDark, [0, 0, 0], undefined, 6, { mat: 'steel', rough: 0.4, metal: 0.8 }),
      nub(0.03, len * 0.3, 0.028, color, [0, len * 0.28, 0], undefined, { mat, rough: 0.5 }),
      nub(0.03, len * 0.3, 0.028, color, [0, -len * 0.28, 0], undefined, { mat, rough: 0.5 }),
    ]),
    { at, rot },
  );
}

/** A ring of `n` small studs (bolt heads, wheel nuts) around a circle of radius `r` in the local XZ plane
 * (face +Y) before `rot` tilts it. One merged, already-placed geometry. */
function boltRing(n, r, size, color, at, rot, mat = 'galv') {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(
      cyl(size, size, size * 0.85, color, [r * Math.cos(a), 0, r * Math.sin(a)], undefined, 6, {
        mat,
        rough: 0.4,
        metal: 0.75,
      }),
    );
  }
  return place(merge(parts), { at, rot });
}

/** A bank of `count` angled vent slats across a `w` (across) by `h` (top to bottom) opening, facing ±Z
 * (`axis` 'z', the usual case) or ±X (`axis` 'x') before `rot`. */
function louvreBank(count, w, h, color, at, rot, mat, axis = 'z') {
  const parts = [];
  const slatH = h / count;
  for (let i = 0; i < count; i++) {
    const ly = -h / 2 + slatH * (i + 0.5);
    if (axis === 'z') parts.push(nub(w, slatH * 0.7, 0.01, color, [0, ly, 0], [0.55, 0, 0], { mat, rough: 0.6 }));
    else parts.push(nub(0.01, slatH * 0.7, w, color, [0, ly, 0], [0, 0, 0.55], { mat, rough: 0.6 }));
  }
  return place(merge(parts), { at, rot });
}

const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
/** A thin round bar between two points, however they are angled — a rope, a hose, a tie rod: cyl() builds
 * along local Y, aligned by quaternion (not hand trig, which loses a component whenever the bar leans both
 * sideways and lengthways) then converted back to the XYZ-Euler `rot` place() expects. */
function strutBetween(p0, p1, radius, color, mat) {
  _dir.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = _dir.length() || 1e-6;
  _dir.normalize();
  _mid.set((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
  _quat.setFromUnitVectors(_up, _dir);
  _euler.setFromQuaternion(_quat);
  return cyl(radius, radius, len, color, [_mid.x, _mid.y, _mid.z], [_euler.x, _euler.y, _euler.z], 6, {
    mat,
    rough: 0.7,
  });
}

/** A hose or cable laced straight between consecutive points of `pts` — a drooping polyline, not one taut
 * line, so a run with a sagging middle point looks like it hangs under its own weight. */
function lace(pts, radius, color, mat) {
  const parts = [];
  for (let i = 0; i < pts.length - 1; i++) parts.push(strutBetween(pts[i], pts[i + 1], radius, color, mat));
  return parts;
}

/** A lathe profile (points are [radius, height] pairs, radius >= 0) revolved around local Y before `rot`
 * turns it — dished hubs, domed lenses, bollards: the one shape builder box()/cyl() cannot make. */
function lathe(profile, color, at, rot, segments, shade) {
  const g = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    sides(segments),
  );
  return place(paint(g, color, shade), { at, rot });
}

/** Like `lathe()`, but only sweeping `phiLength` radians from `phiStart` (phi=0 is local +Z, turning towards
 * local +X as phi grows) instead of the full circle — one continuously-curved surface for a mudguard or a
 * roof corner, so it reads as a smooth arch instead of the fan of flat facets a ring of boxes would make. */
function latheArc(profile, phiStart, phiLength, color, at, rot, segments, shade) {
  const g = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    sides(segments),
    phiStart,
    phiLength,
  );
  return place(paint(g, color, shade), { at, rot });
}

/** A ring (or partial ring) standing in the local XY plane, hole-axis Z, before `rot` turns it — the default
 * orientation already suits a lifting eye or a steering-wheel rim; rot=[Math.PI/2,0,0] lays it flat, for a
 * bus-bar loop or a horizontal handle. */
function torus(radius, tube, color, at, rot, radialSeg, tubularSeg, arc, shade) {
  const g = new THREE.TorusGeometry(
    radius,
    tube,
    sides(radialSeg),
    Math.max(6, Math.round(tubularSeg * geoDetail.round)),
    arc ?? Math.PI * 2,
  );
  return place(paint(g, color, shade), { at, rot });
}

/** One tapered fork blade, heel at local origin, running out towards local -Z (so it needs no rotation to
 * point the way forks always have) — a hand-built, flat-shaded, 12-triangle prism: thick at the heel, thin
 * at the tip, constant width. */
function forkBlade(length, heelThick, tipThick, width, color, at, mat) {
  const w = width / 2;
  const H_TL = [-w, heelThick / 2, 0];
  const H_TR = [w, heelThick / 2, 0];
  const H_BL = [-w, -heelThick / 2, 0];
  const H_BR = [w, -heelThick / 2, 0];
  const T_TL = [-w, tipThick / 2, -length];
  const T_TR = [w, tipThick / 2, -length];
  const T_BL = [-w, -tipThick / 2, -length];
  const T_BR = [w, -tipThick / 2, -length];
  const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const verts = [
    ...quad(H_TL, H_TR, T_TR, T_TL), // top
    ...quad(H_BR, H_BL, T_BL, T_BR), // bottom
    ...quad(H_BL, H_TL, T_TL, T_BL), // left (-X)
    ...quad(H_TR, H_BR, T_BR, T_TR), // right (+X)
    ...quad(H_BL, H_BR, H_TR, H_TL), // heel end
    ...quad(T_TL, T_TR, T_BR, T_BL), // tip end
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return place(paint(g, color, { mat, rough: 0.35, metal: 0.55 }), { at, rot: [0, 0, 0] });
}

// ---------------------------------------------------------------------------------------------------------
// forklift — a counterbalance lift truck standing in the loading dock, forks towards -Z (matching the model
// it replaces: propModels.js's buildForklift places "mast and forks at -Z … counterweight at +Z").

const FORKLIFT_LIVERIES = [
  { body: PAINT.yellow, diesel: true },
  { body: PAINT.orange, diesel: false },
  { body: PAINT.oliveDrab, diesel: true },
];
const FORKLIFT_IDS = [
  { fleet: 'FLT 07', cap: 'CAP 1500 KG' },
  { fleet: 'FLT 12', cap: 'CAP 2000 KG' },
  { fleet: 'FLT 03', cap: 'CAP 1500 KG' },
];

/** One forklift road wheel, axle along local Y, placed with the one `rot` that lays the axle wherever the
 * chassis needs it ([0, 0, Math.PI / 2] for the usual axle-along-X case). `face` (+1 or -1 along local Y
 * before `rot`) says which end is outward, for the dished hub and its ring of wheel nuts. */
function wheel(radius, width, at, rot, face, tireColor) {
  const parts = [];
  const shoulderR = radius * 0.96;
  const shoulderW = width * 0.24;
  const treadW = width - 2 * shoulderW;
  for (const off of [-(treadW / 2 + shoulderW / 2), treadW / 2 + shoulderW / 2])
    parts.push(
      cyl(shoulderR, shoulderR, shoulderW, tireColor, [0, off, 0], undefined, 16, { mat: 'rubber', rough: 0.92 }),
    );
  parts.push(cyl(radius, radius, treadW, tireColor, [0, 0, 0], undefined, 16, { mat: 'rubber', rough: 0.92 }));
  const lugN = geoDetail.bevel ? Math.round(10 * geoDetail.round) : 0; // tread lugs skip themselves at low detail
  for (let i = 0; i < lugN; i++) {
    const a = (i / lugN) * Math.PI * 2;
    parts.push(
      nub(
        0.03,
        treadW * 0.78,
        radius * 0.15,
        tireColor,
        [(radius - 0.017) * Math.cos(a), 0, (radius - 0.017) * Math.sin(a)],
        [0, -a, 0],
        { mat: 'rubber', rough: 0.92 },
      ),
    );
  }
  parts.push(
    cyl(radius * 0.64, radius * 0.68, width * 0.9, PAINT.steelLight, [0, 0, 0], undefined, 16, {
      mat: 'steel',
      rough: 0.4,
      metal: 0.7,
    }),
  );
  const hubY = face * (width / 2 - 0.02);
  // dished hub cap: a shallow lathe dish, the one shape a stack of cylinders cannot make convincingly
  parts.push(
    lathe(
      [
        [0, 0.09],
        [radius * 0.12, 0.095],
        [radius * 0.3, 0.05],
        [radius * 0.46, 0],
      ],
      PAINT.steelDark,
      [0, hubY, 0],
      face > 0 ? [0, 0, 0] : [Math.PI, 0, 0],
      16,
      { mat: 'steel', rough: 0.35, metal: 0.75 },
    ),
  );
  parts.push(
    boltRing(
      8,
      radius * 0.17,
      0.02,
      PAINT.pale,
      [0, hubY + face * 0.045, 0],
      face > 0 ? undefined : [Math.PI, 0, 0],
      'galv',
    ),
  );
  return place(merge(parts), { at, rot });
}

export function buildForklift(variant = 0) {
  const liv = pick(FORKLIFT_LIVERIES, variant);
  const id = pick(FORKLIFT_IDS, variant);
  const body = liv.body;
  const dark = PAINT.steelDark; // mast and counterweight: dark grey regardless of livery
  const solid = [];
  const glow = [];
  const letters = [];

  // geometry plan (Y up, -Z front where the forks are, +Z back where the counterweight sits):
  //   wheels: front (load) axle z=-0.30, rear (steer) axle z=0.74
  //   mast channels z=-0.76, forks reach from the carriage at z=-0.58 to their tips at z=-1.46
  //   chassis hull z=-0.50..0.95, counterweight z=0.95..1.42, overhead guard roof y=1.90
  const R_F = 0.3,
    W_F = 0.22,
    X_F = 0.66,
    Z_F = -0.3;
  const R_R = 0.21,
    W_R = 0.17,
    X_R = 0.58,
    Z_R = 0.74;
  const hullY0 = 0.08,
    hullY1 = 0.4;

  for (const sx of [-1, 1]) {
    solid.push(wheel(R_F, W_F, [sx * X_F, R_F, Z_F], [0, 0, Math.PI / 2], -sx, PAINT.rubber));
    solid.push(wheel(R_R, W_R, [sx * X_R, R_R, Z_R], [0, 0, Math.PI / 2], -sx, PAINT.rubber));
  }
  solid.push(
    cyl(0.05, 0.05, X_F * 2 - 0.26, dark, [0, R_F, Z_F], [0, 0, Math.PI / 2], 10, {
      mat: 'steel',
      rough: 0.5,
      metal: 0.6,
    }),
  );
  solid.push(
    cyl(0.04, 0.04, X_R * 2 - 0.22, dark, [0, R_R, Z_R], [0, 0, Math.PI / 2], 10, {
      mat: 'steel',
      rough: 0.5,
      metal: 0.6,
    }),
  );
  // front mudguards: one smooth lathed arc each (axle-aligned, same rot as the wheel it shields) rather than
  // a fan of flat plates, so the curve reads as one continuous sheet-metal surface and not a stack of shingles
  const fenderHW = (W_F + 0.1) / 2;
  const fenderSweep = Math.PI * 0.92;
  const fenderProfile = [
    [R_F + 0.05, -fenderHW],
    [R_F + 0.09, -fenderHW * 0.9],
    [R_F + 0.09, fenderHW * 0.9],
    [R_F + 0.05, fenderHW],
  ];
  for (const sx of [-1, 1])
    solid.push(
      latheArc(
        fenderProfile,
        Math.PI / 2 - fenderSweep / 2,
        fenderSweep,
        body,
        [sx * X_F, R_F, Z_F],
        [0, 0, Math.PI / 2],
        16,
        { mat: 'paint', rough: 0.55 },
      ),
    );

  // chassis hull: the painted "floor" the operator stands/sits on, between the mast and the counterweight
  const hullZ0 = -0.5,
    hullZ1 = 0.95;
  solid.push(
    box(0.96, hullY1 - hullY0, hullZ1 - hullZ0, body, [0, (hullY0 + hullY1) / 2, (hullZ0 + hullZ1) / 2], undefined, {
      mat: 'paint',
      rough: 0.6,
    }),
  );
  for (const sx of [-1, 1])
    solid.push(
      box(0.26, 0.03, 0.34, PAINT.steel, [sx * 0.56, hullY0 + 0.05, -0.05], undefined, {
        mat: 'chequer',
        rough: 0.6,
        metal: 0.3,
      }),
    ); // chequer-plate step, ahead of the front wheel

  // mast: two C-channel uprights (a web and two flanges each), a base crossbeam and a top crossbeam
  const mastZ = -0.76,
    mastX = 0.34,
    mastY0 = 0.12,
    mastY1 = 1.9;
  for (const sx of [-1, 1]) {
    solid.push(
      box(0.05, mastY1 - mastY0, 0.1, dark, [sx * mastX, (mastY0 + mastY1) / 2, mastZ], undefined, {
        mat: 'steel',
        rough: 0.45,
        metal: 0.55,
      }),
    );
    for (const fz of [-0.045, 0.045])
      solid.push(
        box(0.09, mastY1 - mastY0, 0.02, dark, [sx * mastX, (mastY0 + mastY1) / 2, mastZ + fz], undefined, {
          mat: 'steel',
          rough: 0.45,
          metal: 0.55,
        }),
      );
  }
  solid.push(
    box(mastX * 2 + 0.1, 0.08, 0.14, dark, [0, mastY1, mastZ], undefined, { mat: 'steel', rough: 0.45, metal: 0.55 }),
  );
  solid.push(
    box(mastX * 2 + 0.1, 0.08, 0.12, dark, [0, mastY0 + 0.12, mastZ], undefined, {
      mat: 'steel',
      rough: 0.45,
      metal: 0.55,
    }),
  );

  // lift cylinders (polished steel rods) between the mast uprights, a tilt ram each side, and chains from
  // the mast top down to the carriage
  for (const sx of [-1, 1]) {
    solid.push(
      cyl(0.028, 0.028, 1.5, dark, [sx * 0.1, 0.9, mastZ - 0.05], undefined, 10, {
        mat: 'steel',
        rough: 0.45,
        metal: 0.6,
      }),
    );
    solid.push(
      cyl(0.013, 0.013, 0.5, PAINT.chrome, [sx * 0.1, 1.45, mastZ - 0.05], undefined, 8, {
        mat: 'steel',
        rough: 0.12,
        metal: 0.95,
      }),
    );
    solid.push(strutBetween([sx * 0.26, 0.35, -0.46], [sx * 0.26, 1.0, mastZ + 0.02], 0.022, dark, 'steel'));
    const chainP0 = [sx * 0.26, mastY1 - 0.05, mastZ + 0.05];
    const chainP1 = [sx * 0.26, 0.74, -0.6];
    solid.push(strutBetween(chainP0, chainP1, 0.014, PAINT.steelLight, 'galv'));
    for (let k = 1; k <= 6; k++) {
      const t = k / 7;
      solid.push(
        ball(
          0.023,
          PAINT.steelLight,
          [
            chainP0[0] + (chainP1[0] - chainP0[0]) * t,
            chainP0[1] + (chainP1[1] - chainP0[1]) * t,
            chainP0[2] + (chainP1[2] - chainP0[2]) * t,
          ],
          6,
          { mat: 'galv', rough: 0.45, metal: 0.7 },
        ),
      ); // chain links, beaded along the rod so it reads as a chain and not a bar
    }
  }

  // carriage, backrest grid and the two forks
  const carZ = -0.58;
  solid.push(box(0.9, 0.62, 0.05, dark, [0, 0.42, carZ], undefined, { mat: 'steel', rough: 0.5, metal: 0.5 }));
  for (let i = 0; i < 5; i++)
    solid.push(
      nub(0.9, 0.025, 0.03, dark, [0, 0.78 + i * 0.1, carZ - 0.02], undefined, {
        mat: 'steel',
        rough: 0.5,
        metal: 0.5,
      }),
    );
  for (const sx of [-1, 1])
    solid.push(
      nub(0.025, 0.5, 0.03, dark, [sx * 0.42, 1.0, carZ - 0.02], undefined, { mat: 'steel', rough: 0.5, metal: 0.5 }),
    );
  for (const sx of [-1, 1]) {
    solid.push(
      nub(0.14, 0.09, 0.1, dark, [sx * 0.22, 0.14, carZ - 0.04], undefined, { mat: 'steel', rough: 0.4, metal: 0.6 }),
    );
    solid.push(forkBlade(0.8, 0.09, 0.025, 0.1, dark, [sx * 0.22, 0.095, carZ - 0.08], 'steel'));
  }

  // overhead guard: four round-tube posts rising from the chassis, a rectangular roof frame with a ball
  // joint at each corner (so the tube frame reads as continuous without four separately-mitred bends), a
  // flat roof panel sitting proud of the frame, and a beacon
  const postX = 0.4,
    postZF = -0.05,
    postZR = 0.6,
    roofY = 1.9,
    tubeR = 0.026;
  for (const sx of [-1, 1])
    for (const pz of [postZF, postZR])
      solid.push(
        cyl(tubeR, tubeR, roofY - hullY1, dark, [sx * postX, (hullY1 + roofY) / 2, pz], undefined, 10, {
          mat: 'steel',
          rough: 0.4,
          metal: 0.6,
        }),
      );
  for (const sx of [-1, 1])
    solid.push(
      cyl(tubeR, tubeR, postZR - postZF, dark, [sx * postX, roofY, (postZF + postZR) / 2], [Math.PI / 2, 0, 0], 10, {
        mat: 'steel',
        rough: 0.4,
        metal: 0.6,
      }),
    );
  for (const pz of [postZF, postZR])
    solid.push(
      cyl(tubeR, tubeR, postX * 2, dark, [0, roofY, pz], [0, 0, Math.PI / 2], 10, {
        mat: 'steel',
        rough: 0.4,
        metal: 0.6,
      }),
    );
  for (const sx of [-1, 1])
    for (const pz of [postZF, postZR])
      solid.push(ball(tubeR * 1.2, dark, [sx * postX, roofY, pz], 8, { mat: 'steel', rough: 0.4, metal: 0.6 }));
  solid.push(
    box(
      postX * 2 + 0.1,
      0.03,
      postZR - postZF + 0.1,
      body,
      [0, roofY + tubeR + 0.015, (postZF + postZR) / 2],
      undefined,
      {
        mat: 'paint',
        rough: 0.55,
      },
    ),
  );
  const beaconZ = (postZF + postZR) / 2,
    beaconY0 = roofY + tubeR + 0.03;
  solid.push(
    cyl(0.04, 0.045, 0.05, PAINT.black, [0, beaconY0 + 0.025, beaconZ], undefined, 10, { mat: 'polymer', rough: 0.4 }),
  );
  solid.push(
    lathe(
      [
        [0, 0],
        [0.038, 0],
        [0.03, 0.05],
        [0, 0.06],
      ],
      PAINT.orange,
      [0, beaconY0 + 0.05, beaconZ],
      undefined,
      10,
      { mat: 'glass', rough: 0.25, metal: 0 },
    ),
  );
  glow.push(ball(0.032, GLOW.beaconAmber, [0, beaconY0 + 0.05, beaconZ], 8, { mat: 'glass' }));

  // seat, backrest, steering column and wheel, control levers
  const seatZ = 0.3,
    seatY = hullY1 + 0.17;
  solid.push(box(0.34, 0.09, 0.32, PAINT.black, [0, seatY, seatZ], undefined, { mat: 'fabric', rough: 0.85 }));
  solid.push(
    box(0.34, 0.4, 0.08, PAINT.black, [0, seatY + 0.22, seatZ + 0.17], [-0.12, 0, 0], { mat: 'fabric', rough: 0.85 }),
  );
  solid.push(
    cyl(0.11, 0.11, 0.05, dark, [0, hullY1 + 0.02, seatZ], undefined, 10, { mat: 'steel', rough: 0.5, metal: 0.5 }),
  );
  const colT = [0, 1.02, -0.34];
  solid.push(strutBetween([0, hullY1 + 0.08, -0.08], colT, 0.03, dark, 'steel'));
  solid.push(torus(0.15, 0.015, PAINT.black, colT, [1.05, 0, 0], 6, 14, Math.PI * 2, { mat: 'polymer', rough: 0.55 }));
  solid.push(nub(0.05, 0.05, 0.03, dark, colT, [1.05, 0, 0], { mat: 'steel', rough: 0.5, metal: 0.5 }));
  for (const sx of [-1, 1])
    solid.push(
      strutBetween(
        [sx * 0.18, seatY + 0.1, seatZ - 0.22],
        [sx * 0.18, seatY + 0.28, seatZ - 0.3],
        0.012,
        dark,
        'steel',
      ),
    );

  // engine cover: louvred, hinged at the back, between the seat and the counterweight; a stack on the
  // diesel variants — kept clear of the reclined seat backrest (which reaches to z≈0.53) by a margin
  const covZ0 = 0.6,
    covZ1 = 0.92,
    covY1 = hullY1 + 0.34;
  solid.push(
    box(0.84, covY1 - hullY1, covZ1 - covZ0, body, [0, (hullY1 + covY1) / 2, (covZ0 + covZ1) / 2], undefined, {
      mat: 'paint',
      rough: 0.6,
    }),
  );
  solid.push(louvreBank(6, 0.6, 0.18, dark, [0, covY1 - 0.1, covZ0 - 0.006], undefined, 'gunmetal', 'z'));
  for (const hx of [-0.3, 0.3])
    solid.push(hingeStrap(0.1, body, [hx, covY1 - 0.02, covZ1 + 0.01], [0, 0, Math.PI / 2], 'paint'));
  if (liv.diesel)
    solid.push(
      cyl(0.025, 0.03, 0.22, dark, [0.3, covY1 + 0.11, covZ1 - 0.1], undefined, 8, {
        mat: 'steel',
        rough: 0.5,
        metal: 0.5,
      }),
    );

  // counterweight: a rounded casting at the back, with a lifting eye on top and data plates on its face
  const cwZ0 = 0.95,
    cwZ1 = 1.42,
    cwY0 = 0.05,
    cwY1 = 0.92;
  solid.push(
    box(0.98, cwY1 - cwY0, cwZ1 - cwZ0, dark, [0, (cwY0 + cwY1) / 2, (cwZ0 + cwZ1) / 2], undefined, {
      mat: 'paint',
      rough: 0.6,
    }),
  );
  solid.push(
    torus(0.05, 0.011, PAINT.pale, [0, cwY1, cwZ1 - 0.15], undefined, 4, 10, Math.PI * 2, {
      mat: 'steel',
      rough: 0.4,
      metal: 0.7,
    }),
  );
  solid.push(
    nub(0.05, 0.3, 0.008, PAINT.rust, [0.25, cwY1 - 0.22, cwZ1 + 0.006], undefined, { mat: 'rust', rough: 0.9 }),
  ); // a worn streak under the lifting eye — a real, outdoor machine
  solid.push(
    nub(0.3, 0.1, 0.012, PAINT.white, [0.3, cwY0 + 0.78, cwZ1 + 0.007], undefined, { mat: 'paint', rough: 0.5 }),
  );
  solid.push(
    nub(0.7, 0.14, 0.012, PAINT.safetyRed, [0, cwY0 + 0.5, cwZ1 + 0.007], undefined, { mat: 'paint', rough: 0.5 }),
  );
  solid.push(
    nub(0.34, 0.1, 0.012, PAINT.white, [0, cwY0 + 0.22, cwZ1 + 0.007], undefined, { mat: 'paint', rough: 0.5 }),
  );
  letters.push({ text: id.fleet, tone: 'white', height: 0.08, at: [0.3, cwY0 + 0.78, cwZ1 + 0.014], out: [0, 0, 1] });
  letters.push({ text: 'CAUTION', tone: 'hazard', height: 0.1, at: [0, cwY0 + 0.5, cwZ1 + 0.014], out: [0, 0, 1] });
  letters.push({ text: id.cap, tone: 'black', height: 0.06, at: [0, cwY0 + 0.22, cwZ1 + 0.014], out: [0, 0, 1] });

  // headlamps on the chassis front, taillamps on the counterweight, and two hydraulic hoses running from
  // the chassis, up beside a mast upright, to the lift cylinder
  for (const sx of [-1, 1]) {
    solid.push(
      nub(0.07, 0.07, 0.05, PAINT.black, [sx * 0.46, 0.5, hullZ0 - 0.01], undefined, { mat: 'polymer', rough: 0.5 }),
    );
    solid.push(
      nub(0.05, 0.05, 0.012, PAINT.glass, [sx * 0.46, 0.5, hullZ0 - 0.035], undefined, { mat: 'glass', rough: 0.2 }),
    );
    glow.push(
      nub(0.04, 0.04, 0.01, GLOW.headlampDim, [sx * 0.46, 0.5, hullZ0 - 0.035 - PROUD], undefined, { mat: 'glass' }),
    );
    solid.push(
      nub(0.05, 0.05, 0.012, PAINT.safetyRed, [sx * 0.4, cwY0 + 0.14, cwZ1 + 0.007], undefined, {
        mat: 'glass',
        rough: 0.3,
      }),
    );
    glow.push(
      nub(0.04, 0.04, 0.01, GLOW.taillampDim, [sx * 0.4, cwY0 + 0.14, cwZ1 + 0.007 + PROUD], undefined, {
        mat: 'glass',
      }),
    );
    solid.push(
      ...lace(
        [
          [sx * 0.12, 0.3, -0.42],
          [sx * 0.2, 0.2, -0.25],
          [sx * 0.12, 0.42, mastZ + 0.08],
        ],
        0.014,
        PAINT.black,
        'rubber',
      ),
    );
    solid.push(
      nub(0.03, 0.03, 0.05, PAINT.brass, [sx * 0.12, 0.42, mastZ + 0.08], undefined, {
        mat: 'brass',
        rough: 0.4,
        metal: 0.7,
      }),
    );
  }

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}

// ---------------------------------------------------------------------------------------------------------
// console — a sloped operator's desk, facing -Z (matching the model it replaces: propModels.js's
// buildConsole mounts its screens and switches on the operator-facing side, confirmed by eye to be -Z).

const CONSOLE_PALETTES = [
  { body: PAINT.enamelSage, panel: PAINT.panelSage },
  { body: PAINT.enamelGrey, panel: PAINT.panelGrey },
  { body: PAINT.enamelBlue, panel: PAINT.panelBlue },
];
const CONSOLE_LAYOUTS = [
  { gauges: 6, annun: 8, legends: ['FEED A', 'FEED B', 'TRIP'] },
  { gauges: 4, annun: 6, legends: ['P-204', 'P-205', 'TRIP'] },
  { gauges: 8, annun: 9, legends: ['FEED A', 'P-204', 'TRIP'] },
];

export function buildConsole(variant = 0) {
  const c = pick(CONSOLE_PALETTES, variant);
  const layout = pick(CONSOLE_LAYOUTS, variant);
  const solid = [];
  const glow = [];
  const letters = [];

  // geometry plan (Y up, -Z the operator's side): a plinth, two pedestals and a desktop at the front, a
  // raked instrument panel rising from the desktop's back edge, cable trunking behind it
  const plinthY = 0.06;
  solid.push(box(1.86, plinthY, 0.86, c.body, [0, plinthY / 2, 0], undefined, { mat: 'enamel', rough: 0.6 }));
  for (const sx of [-1, 1])
    solid.push(box(0.6, 0.58, 0.8, c.body, [sx * 0.63, plinthY + 0.29, 0], undefined, { mat: 'enamel', rough: 0.55 }));
  solid.push(box(1.9, 0.05, 0.86, c.body, [0, plinthY + 0.605, 0], undefined, { mat: 'enamel', rough: 0.5 }));
  solid.push(
    box(0.64, 0.03, 0.4, PAINT.steel, [0, plinthY + 0.02, -0.25], undefined, {
      mat: 'chequer',
      rough: 0.6,
      metal: 0.3,
    }),
  ); // kickplate, where the operator's feet rest
  solid.push(nub(0.56, 0.02, 0.22, c.panel, [0, plinthY + 0.46, -0.36], undefined, { mat: 'polymer', rough: 0.5 })); // keyboard shelf

  // the raked instrument panel: a box between two edge points, angled like the slope between them (same
  // trick as a raked windscreen) — onPanel(t, proud) places a part flush on its face, t=0 at the bottom
  // edge, t=1 at the top; proud nudges it away from the face, along the face's own outward normal
  const PY0 = 0.68,
    PZ0 = 0.06,
    PY1 = 1.08,
    PZ1 = 0.26;
  const pdy = PY1 - PY0,
    pdz = PZ1 - PZ0,
    panelLen = Math.hypot(pdy, pdz),
    panelAngle = Math.atan2(pdz, pdy);
  const panelThick = 0.08;
  const onPanel = (t, proud = 0) => {
    const ny = pdz / panelLen,
      nz = -pdy / panelLen;
    return [PY0 + pdy * t + ny * proud, PZ0 + pdz * t + nz * proud];
  };
  const FACE_ROT = [panelAngle - Math.PI / 2, 0, 0];
  solid.push(
    box(1.86, panelLen, panelThick, c.body, [0, (PY0 + PY1) / 2, (PZ0 + PZ1) / 2], [panelAngle, 0, 0], {
      mat: 'enamel',
      rough: 0.55,
    }),
  );
  // (offset kept small: the box's top edge is the console's tallest point, and the footprint only allows
  // ~2cm of headroom above the panel's own top edge before the 1.15m box ceiling)
  solid.push(box(1.9, 0.06, 0.05, c.panel, [0, PY1 + 0.02, PZ1 + 0.02], undefined, { mat: 'enamel', rough: 0.5 }));

  // cable trunking at the back, below the panel's top trim
  solid.push(box(1.7, 0.3, 0.1, PAINT.steelDark, [0, 0.78, 0.42], undefined, { mat: 'galv', rough: 0.6, metal: 0.4 }));
  solid.push(louvreBank(6, 1.5, 0.22, PAINT.gunmetal, [0, 0.78, 0.372], undefined, 'gunmetal', 'z'));

  // round gauges, in one or two rows, each a pale metal bezel (distinct from the dark glass it rings),
  // glass and a needle, flush on the panel face — sized and spaced to clear the switches below, the screens
  // beside, and the annunciators above (panelLen is short, so every band here is budgeted on purpose)
  const gaugeR = 0.05;
  const gaugeRow = Math.min(layout.gauges, 6);
  const rows = Math.ceil(layout.gauges / gaugeRow);
  for (let row = 0; row < rows; row++) {
    const t = 0.62 - row * 0.27;
    const n = Math.min(gaugeRow, layout.gauges - row * gaugeRow);
    for (let i = 0; i < n; i++) {
      const gx = (i - (n - 1) / 2) * 0.17;
      const [by, bz] = onPanel(t, panelThick / 2 + 0.012);
      solid.push(
        cyl(gaugeR, gaugeR, 0.03, PAINT.pale, [gx, by, bz], FACE_ROT, 16, {
          mat: 'aluminium',
          rough: 0.4,
          metal: 0.15,
        }),
      );
      const [gy, gz] = onPanel(t, panelThick / 2 + 0.03);
      solid.push(
        cyl(gaugeR * 0.55, gaugeR * 0.55, 0.008, PAINT.glass, [gx, gy, gz], FACE_ROT, 16, {
          mat: 'glass',
          rough: 0.15,
          metal: 0.05,
        }),
      );
      solid.push(
        nub(gaugeR * 0.45, 0.008, 0.008, PAINT.white, [gx, gy + gaugeR * 0.14, gz + 0.006], FACE_ROT, {
          mat: 'paint',
          rough: 0.4,
        }),
      );
    }
  }

  // toggle switches, low on the panel, clear of the legend strips just below them
  const swN = 10;
  for (let i = 0; i < swN; i++) {
    const sx2 = (i - (swN - 1) / 2) * 0.16;
    const [by, bz] = onPanel(0.14, panelThick / 2 + 0.01);
    solid.push(nub(0.03, 0.03, 0.02, PAINT.black, [sx2, by, bz], FACE_ROT, { mat: 'polymer', rough: 0.5 }));
    const [ty, tz] = onPanel(0.14, panelThick / 2 + 0.035);
    solid.push(cyl(0.006, 0.006, 0.03, PAINT.pale, [sx2, ty, tz], FACE_ROT, 6, { mat: 'polymer', rough: 0.4 }));
  }

  // illuminated push-buttons and annunciator tiles (glow), in a grid above the gauges
  for (let i = 0; i < layout.annun; i++) {
    const col = i % 4,
      row = Math.floor(i / 4);
    const sx3 = (col - 1.5) * 0.18;
    const t = 0.95 - row * 0.08;
    const [ay, az] = onPanel(t, panelThick / 2 + 0.01);
    solid.push(nub(0.07, 0.045, 0.012, PAINT.black, [sx3, ay, az], FACE_ROT, { mat: 'polymer', rough: 0.5 }));
    const [ay2, az2] = onPanel(t, panelThick / 2 + 0.02);
    glow.push(
      nub(0.06, 0.035, 0.006, pick([GLOW.annunciator, GLOW.ledAmber, GLOW.ledGreen], i), [sx3, ay2, az2], FACE_ROT, {
        mat: 'glass',
      }),
    );
  }

  // two flat screens, each with a bezel and a dim glow face, flanking the gauge cluster (same panel height
  // as the gauges' top row but out at the panel's shoulders, clear of them in X) rather than stacked above
  // or below, where this short a panel leaves no room spare
  for (const sx4 of [-0.68, 0.68]) {
    const [by, bz] = onPanel(0.62, panelThick / 2 + 0.015);
    solid.push(box(0.3, 0.12, 0.03, PAINT.black, [sx4, by, bz], FACE_ROT, { mat: 'polymer', rough: 0.45 }));
    const [gy, gz] = onPanel(0.62, panelThick / 2 + 0.037);
    glow.push(nub(0.25, 0.08, 0.006, GLOW.screenCyan, [sx4, gy, gz], FACE_ROT, { mat: 'glass' }));
  }

  // a service access door on each pedestal, with hinges and a latch; the pull handle is a medium+ refinement
  for (const doorSx of [0.63, -0.63]) {
    solid.push(
      nub(0.5, 0.42, 0.015, c.panel, [doorSx, plinthY + 0.3, -0.397], undefined, { mat: 'enamel', rough: 0.5 }),
    );
    // a proud frame top and bottom (brief: "proud frames and recessed panels so light catches edges"),
    // clear of the hinge/latch Y positions so nothing overlaps
    for (const fy of [plinthY + 0.09, plinthY + 0.51]) {
      solid.push(box(0.54, 0.03, 0.018, c.panel, [doorSx, fy, -0.403], undefined, { mat: 'enamel', rough: 0.45 }));
      if (geoDetail.bevel)
        for (const fx of [doorSx - 0.25, doorSx + 0.25])
          solid.push(
            cyl(0.009, 0.009, 0.01, PAINT.pale, [fx, fy, -0.408], [Math.PI / 2, 0, 0], 6, {
              mat: 'galv',
              rough: 0.4,
              metal: 0.7,
            }),
          ); // frame corner bolts, a medium+ refinement
    }
    for (const hy of [plinthY + 0.12, plinthY + 0.48])
      solid.push(hingeStrap(0.08, c.panel, [doorSx - 0.23, hy, -0.397], undefined, 'enamel'));
    solid.push(
      cyl(0.015, 0.015, 0.02, PAINT.chrome, [doorSx + 0.21, plinthY + 0.3, -0.4], [Math.PI / 2, 0, 0], 8, {
        mat: 'steel',
        rough: 0.3,
        metal: 0.8,
      }),
    );
    if (geoDetail.bevel)
      for (const hx of [doorSx - 0.08, doorSx + 0.08])
        solid.push(
          cyl(0.008, 0.008, 0.04, c.panel, [hx, plinthY + 0.3, -0.417], [Math.PI / 2, 0, 0], 8, {
            mat: 'polymer',
            rough: 0.45,
          }),
        );
    if (geoDetail.bevel)
      solid.push(
        cyl(0.01, 0.01, 0.18, c.panel, [doorSx, plinthY + 0.3, -0.437], [0, 0, Math.PI / 2], 8, {
          mat: 'polymer',
          rough: 0.45,
        }),
      ); // the door's own D-pull handle
  }

  // ventilation louvres on each pedestal's outer side face, and a cable bundle sagging from the trunking
  // into the kneehole — both called for in the brief; medium+ refinements, like the forklift's tread lugs
  if (geoDetail.bevel) {
    for (const sx6 of [-1, 1])
      solid.push(louvreBank(8, 0.46, 0.3, c.panel, [sx6 * 0.931, plinthY + 0.32, 0.02], undefined, 'enamel', 'x'));
    solid.push(
      ...lace(
        [
          [0.75, 0.78, 0.42],
          [0.6, 0.55, 0.3],
          [0.63, plinthY + 0.3, 0.38],
        ],
        0.012,
        PAINT.black,
        'rubber',
      ),
    );
    solid.push(
      ...lace(
        [
          [0.55, 0.78, 0.42],
          [0.3, 0.42, 0.25],
          [-0.63, plinthY + 0.3, 0.38],
        ],
        0.012,
        PAINT.black,
        'rubber',
      ),
    );
    for (const cx2 of [-0.6, -0.2, 0.2, 0.6])
      solid.push(
        nub(0.04, 0.32, 0.12, PAINT.steelDark, [cx2, 0.78, 0.42], undefined, { mat: 'galv', rough: 0.55, metal: 0.4 }),
      ); // P-clip cable clamps strapping the trunking
  }

  // panel edge screws
  for (const sx5 of [-0.9, 0.9])
    for (const t of [0.04, 0.96]) {
      const [sy5, sz5] = onPanel(t, panelThick / 2 + 0.006);
      solid.push(
        cyl(0.01, 0.01, 0.012, PAINT.pale, [sx5, sy5, sz5], FACE_ROT, 6, { mat: 'galv', rough: 0.4, metal: 0.7 }),
      );
    }

  // panel legend strips (short codes) just below the gauges — out must be horizontal, so a small text
  // plaque on the raked face uses the operator's view direction, not the panel's own tilted normal
  for (let i = 0; i < layout.legends.length; i++) {
    const lx = (i - (layout.legends.length - 1) / 2) * 0.5;
    const [ly, lz] = onPanel(0.06, panelThick / 2 + 0.002);
    letters.push({ text: layout.legends[i], tone: 'white', height: 0.045, at: [lx, ly, lz + 0.001], out: [0, 0, -1] });
  }

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}

// ---------------------------------------------------------------------------------------------------------
// switchgear — a line-up of two tall enamelled cubicles on a plinth, doors towards -Z (matching the model
// it replaces: propModels.js's switchgearCubicle mounts its door, meters and warning triangle on -Z).

const SWITCHGEAR_PALETTES = [
  { body: PAINT.enamelGrey, panel: PAINT.panelGrey, cubicles: ['Q01', 'Q02'] },
  { body: PAINT.enamelSage, panel: PAINT.panelSage, cubicles: ['Q03', 'Q04'] },
  { body: PAINT.enamelBlue, panel: PAINT.panelBlue, cubicles: ['Q05', 'Q06'] },
];

export function buildSwitchgear(variant = 0) {
  const c = pick(SWITCHGEAR_PALETTES, variant);
  const solid = [];
  const glow = [];
  const letters = [];

  const plinthY = 0.1,
    bodyY1 = 2.18,
    frontZ = -0.44,
    backZ = 0.44,
    halfW = 0.46;
  solid.push(
    box(1.96, plinthY, backZ - frontZ + 0.04, PAINT.steelDark, [0, plinthY / 2, 0], undefined, {
      mat: 'steel',
      rough: 0.6,
      metal: 0.3,
    }),
  );

  const cubes = [
    { cx: -0.48, hinge: -1 },
    { cx: 0.48, hinge: 1 },
  ];
  for (let ci = 0; ci < cubes.length; ci++) {
    const { cx, hinge } = cubes[ci];
    solid.push(
      box(
        halfW * 2,
        bodyY1 - plinthY,
        backZ - frontZ,
        c.body,
        [cx, (plinthY + bodyY1) / 2, (frontZ + backZ) / 2],
        undefined,
        {
          mat: 'enamel',
          rough: 0.55,
        },
      ),
    );
    const doorY0 = plinthY + 0.3,
      doorY1 = bodyY1 - 0.32;
    solid.push(
      box(halfW * 2 - 0.08, doorY1 - doorY0, 0.02, c.panel, [cx, (doorY0 + doorY1) / 2, frontZ - 0.011], undefined, {
        mat: 'enamel',
        rough: 0.5,
      }),
    );
    for (const hy of [doorY0 + 0.15, (doorY0 + doorY1) / 2, doorY1 - 0.15])
      solid.push(hingeStrap(0.09, c.panel, [cx + hinge * (halfW - 0.05), hy, frontZ - 0.02], undefined, 'enamel'));
    solid.push(
      cyl(
        0.022,
        0.022,
        0.02,
        PAINT.black,
        [cx - hinge * (halfW - 0.06), (doorY0 + doorY1) / 2, frontZ - 0.022],
        [Math.PI / 2, 0, 0],
        8,
        { mat: 'polymer', rough: 0.4 },
      ),
    );
    solid.push(
      nub(
        0.07,
        0.018,
        0.018,
        PAINT.pale,
        [cx - hinge * (halfW - 0.06), (doorY0 + doorY1) / 2, frontZ - 0.034],
        [Math.PI / 2, 0, 0],
        { mat: 'galv', rough: 0.4, metal: 0.7 },
      ),
    );
    for (const bx of [-1, 1])
      for (const by of [0, 1])
        solid.push(
          cyl(
            0.009,
            0.009,
            0.01,
            PAINT.pale,
            [cx + bx * (halfW - 0.045), doorY0 + by * (doorY1 - doorY0), frontZ - 0.021],
            [Math.PI / 2, 0, 0],
            6,
            { mat: 'galv', rough: 0.45, metal: 0.7 },
          ),
        );

    const bwY = doorY0 + (doorY1 - doorY0) * 0.65;
    const FWD_ROT = [Math.PI / 2, 0, 0]; // lays a cyl's axis from Y (vertical) onto Z, facing the front
    solid.push(
      nub(0.22, 0.26, 0.01, PAINT.gunmetal, [cx, bwY, frontZ - 0.012], undefined, {
        mat: 'gunmetal',
        rough: 0.5,
        metal: 0.3,
      }),
    );
    solid.push(
      cyl(0.09, 0.09, 0.012, PAINT.glass, [cx, bwY, frontZ - 0.024], FWD_ROT, 14, {
        mat: 'glass',
        rough: 0.2,
        metal: 0.05,
      }),
    );
    if (geoDetail.bevel)
      solid.push(
        torus(0.09, 0.006, PAINT.pale, [cx, bwY, frontZ - 0.019], undefined, 4, 16, Math.PI * 2, {
          mat: 'steel',
          rough: 0.4,
          metal: 0.7,
        }),
      ); // the breaker window's raised rim (torus is already Z-axis-native — no FWD_ROT needed), a medium+
    // refinement so the glass reads as set into the door, not stuck on it
    solid.push(
      nub(0.05, 0.016, 0.015, PAINT.pale, [cx, bwY, frontZ - 0.032], undefined, {
        mat: 'steel',
        rough: 0.45,
        metal: 0.2,
      }),
    );
    solid.push(
      nub(0.016, 0.05, 0.015, PAINT.pale, [cx, bwY, frontZ - 0.032], undefined, {
        mat: 'steel',
        rough: 0.45,
        metal: 0.2,
      }),
    ); // a small racking-handle socket set in the window, not a plate big enough to hide the glass behind it

    for (let m = 0; m < 2; m++) {
      const mx = cx + (m - 0.5) * 0.22,
        my = doorY1 - 0.18;
      solid.push(
        cyl(0.05, 0.05, 0.02, PAINT.pale, [mx, my, frontZ - 0.011], FWD_ROT, 14, {
          mat: 'aluminium',
          rough: 0.4,
          metal: 0.15,
        }),
      );
      solid.push(
        cyl(0.028, 0.028, 0.006, PAINT.glass, [mx, my, frontZ - 0.025], FWD_ROT, 14, { mat: 'glass', rough: 0.15 }),
      );
    }

    const lampColors = [GLOW.ledRed, GLOW.ledGreen, GLOW.ledAmber];
    for (let L = 0; L < 3; L++) {
      const lx2 = cx + (L - 1) * 0.09,
        ly2 = doorY0 + 0.3;
      solid.push(
        nub(0.025, 0.025, 0.012, PAINT.black, [lx2, ly2, frontZ - 0.011], undefined, { mat: 'polymer', rough: 0.5 }),
      );
      glow.push(nub(0.018, 0.018, 0.006, lampColors[L], [lx2, ly2, frontZ - 0.024], undefined, { mat: 'glass' }));
    }

    // protection relays: small boxes with tiny windows, one stack per cubicle (the second cubicle's stack
    // is a medium+ refinement, so the low-detail triangle count stays within its own, tighter budget);
    // only 2 fit the gap below the breaker window before its surround plate (a 3rd would overlap it)
    if (ci === 0 || geoDetail.bevel)
      for (let r = 0; r < 2; r++) {
        const ry = doorY0 + 0.6 + r * 0.14;
        // the casing used to share its whole depth span with the door backing panel behind it (same
        // centre, same thickness) — a coincident-volume z-fighting seam on every edge; seating it proud
        // of the panel (half sunk in, half standing off) like the other door-mounted fittings fixes it
        solid.push(
          nub(0.16, 0.1, 0.02, PAINT.black, [cx, ry, frontZ - 0.021], undefined, { mat: 'polymer', rough: 0.5 }),
        );
        solid.push(
          nub(0.1, 0.06, 0.004, PAINT.glass, [cx, ry, frontZ - 0.037], undefined, { mat: 'glass', rough: 0.2 }),
        );
      }

    solid.push(
      louvreBank(5, halfW * 1.7, 0.16, c.panel, [cx, bodyY1 - 0.12, frontZ - 0.008], undefined, 'enamel', 'z'),
    );
    solid.push(
      louvreBank(4, halfW * 1.7, 0.12, c.panel, [cx, plinthY + 0.1, frontZ - 0.008], undefined, 'enamel', 'z'),
    );
  }

  solid.push(
    box(1.0, 0.07, 0.5, PAINT.steelDark, [0, bodyY1 + 0.035, 0], undefined, { mat: 'galv', rough: 0.5, metal: 0.4 }),
  );
  solid.push(boltRing(8, 0.22, 0.012, PAINT.pale, [0, bodyY1 + 0.071, 0], undefined, 'galv'));
  for (const sx of [-1, 1])
    solid.push(
      torus(0.035, 0.009, PAINT.pale, [sx * 0.8, bodyY1 + 0.005, -0.3], undefined, 4, 10, Math.PI * 2, {
        mat: 'steel',
        rough: 0.4,
        metal: 0.7,
      }),
    );
  solid.push(
    nub(0.7, 0.3, 0.012, PAINT.steelDark, [0, plinthY + 0.22, backZ + 0.007], undefined, {
      mat: 'galv',
      rough: 0.55,
      metal: 0.4,
    }),
  );
  for (let gx = -2; gx <= 2; gx++)
    solid.push(
      cyl(0.025, 0.025, 0.01, PAINT.black, [gx * 0.13, plinthY + 0.22, backZ + 0.014], [Math.PI / 2, 0, 0], 10, {
        mat: 'rubber',
        rough: 0.6,
      }),
    );
  solid.push(
    cyl(0.012, 0.012, 1.9, PAINT.brass, [0, plinthY + 0.16, frontZ - 0.02], [0, 0, Math.PI / 2], 10, {
      mat: 'brass',
      rough: 0.3,
      metal: 0.85,
    }),
  );
  for (let ex = -1; ex <= 1; ex++)
    solid.push(
      nub(0.02, 0.05, 0.02, PAINT.brass, [ex * 0.7, plinthY + 0.16, frontZ - 0.02], undefined, {
        mat: 'brass',
        rough: 0.3,
        metal: 0.85,
      }),
    );

  letters.push({
    text: 'DANGER 6.6 kV',
    tone: 'hazard',
    height: 0.1,
    at: [0, bodyY1 - 0.35, frontZ - 0.012],
    out: [0, 0, -1],
  });
  for (let ci = 0; ci < cubes.length; ci++)
    letters.push({
      text: c.cubicles[ci],
      tone: 'white',
      height: 0.07,
      at: [cubes[ci].cx, bodyY1 - 0.55, frontZ - 0.012],
      out: [0, 0, -1],
    });
  letters.push({
    text: 'LODESTAR SWGR CO',
    tone: 'black',
    height: 0.04,
    at: [0, plinthY + 0.5, frontZ - 0.012],
    out: [0, 0, -1],
  });

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}
