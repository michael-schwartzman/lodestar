// The site's room furniture, second look: a 19-inch instrument rack, a bank of steel lockers, a steel desk, an
// oil-filled power transformer and a skid-mounted diesel generator set — the "second look" versions of
// src/gfx/propModels.js's buildRack/buildLocker/buildDesk/buildTransformer/buildGenerator, built the way
// gfx/next/props.js and gfx/next/drone.js are: painted primitives that say what they are made of (gfx/matter.js),
// merged into one `solid` and one small `glow`, plus `letters` — what is written on, for a new renderer to draw
// as lit decals (gfx/next/lettering.js). No textures, no three.js lights, no materials here: just geometry, paint
// and what each part is made of. Randomness only ever comes from makeRng(), seeded from the kind and the variant
// (propModels.js's own seedFor, copied below), so the same call always returns the same shape.
import * as THREE from 'three';
import { paint, place, box, cyl, merge, sides } from '../geo.js';
import { makeRng } from '../../core/rng.js';

const wrap = (i, n) => ((i % n) + n) % n;
/** Picks an item of a palette by variant, wrapping so that any integer (including negatives) works. */
const pick = (list, variant) => list[wrap(variant, list.length)];

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

// albedo paint, read from the models being replaced (propModels.js PAINT) so the same variant still reads the
// same colour from above; plus a warm ceramic tone for porcelain insulators, which propModels.js never drew.
const C = {
  steel: 0x5d6a70,
  steelLight: 0x76858c,
  steelDark: 0x454e53,
  gunmetal: 0x3a4348,
  olive: 0x5b5d3e,
  oliveDark: 0x454633,
  blue: 0x2f5673,
  blueDark: 0x223f54,
  tan: 0x9c8a5c,
  tanDark: 0x7c6c48,
  pale: 0x9aa39f,
  paleDark: 0x7a837f,
  black: 0x17191a,
  white: 0xc7c9c4,
  glass: 0x161b1f,
  rust: 0x7a4a32,
  rustDark: 0x5c3826,
  safetyRed: 0x832318,
  yellow: 0xc9a227,
  concrete: 0x8a8d88,
  porcelain: 0xc7b483,
  brassTone: 0x8a7236,
};

// light the prop gives off — plain (r, g, b) tuples, some above 1, bypassing THREE.Color's sRGB hex path (a
// 3-number Color is copied verbatim). Kept few and small: the rooms are lit by a real lamp now.
const GLOW = {
  ledGreen: new THREE.Color(0.4, 2.0, 0.6),
  ledAmber: new THREE.Color(2.2, 1.3, 0.25),
  ledRed: new THREE.Color(2.0, 0.25, 0.2),
  gaugeLit: new THREE.Color(1.5, 1.25, 0.5),
};

// shade presets: every one of these names a real material (gfx/matter.js); a name not in that catalogue throws.
const sEnamel = { mat: 'enamel', rough: 0.4, metal: 0.1 };
const sSteel = { mat: 'steel', rough: 0.45, metal: 0.7 };
const sGalv = { mat: 'galv', rough: 0.4, metal: 0.65 };
const sGun = { mat: 'gunmetal', rough: 0.32, metal: 0.8 };
const sAlum = { mat: 'aluminium', rough: 0.3, metal: 0.72 };
const sBrass = { mat: 'brass', rough: 0.35, metal: 0.6 };
const sRubber = { mat: 'rubber', rough: 0.9, metal: 0 };
const sPoly = { mat: 'polymer', rough: 0.55, metal: 0.05 };
const sPaint = { mat: 'paint', rough: 0.5, metal: 0 };
const sConcrete = { mat: 'concrete', rough: 0.85, metal: 0 };
const sGlass = { mat: 'glass', rough: 0.08, metal: 0 };
const sRust = { mat: 'rust', rough: 0.75, metal: 0.25 };
const sLed = { mat: 'polymer', rough: 0.25, metal: 0 }; // a glow part is still a real lens/shade; name it too
const sPorcelain = { mat: 'paint', rough: 0.22, metal: 0 }; // glazed ceramic: a stoved-paint-like gloss, no metal

// the site's own fiction (docs: containers say "HOLLOW LINE"/"NINE FREIGHT", the guards are "WARDEN"/"KITE") —
// one invented heavy-equipment maker belongs to the same world, stencilled on the site's own fixed gear.
const MAKER = 'CAIRNGATE WORKS';

// ---------------------------------------------------------------------------------------------------------
// Small helpers (geo.js's own idiom — see gfx/next/props.js and gfx/next/drone.js, which this copies).

/** A box with sharp edges regardless of detail level — for small parts a bevel would be wasted on. */
function nub(w, h, d, color, at, rot, shade) {
  return box(w, h, d, color, at, rot, { ...shade, bevel: false });
}

/** A rectangular grid of `nRows` x `nCols` small nubs, centred on `at`, evenly spaced by `gapY`/`gapZc` on the
 * two axes named by `rowAxis`/`colAxis` ('y' or 'z') — a perforated/louvred panel or a wire-mesh door insert. */
function grid(nRows, nCols, sx, sy, sz, gapRow, gapCol, color, at, shade, colAxis = 'z') {
  const parts = [];
  for (let r = 0; r < nRows; r++) {
    const y = at[1] + (r - (nRows - 1) / 2) * gapRow;
    for (let cI = 0; cI < nCols; cI++) {
      const off = (cI - (nCols - 1) / 2) * gapCol;
      const p = colAxis === 'z' ? [at[0], y, at[2] + off] : [at[0] + off, y, at[2]];
      parts.push(nub(sx, sy, sz, color, p, undefined, shade));
    }
  }
  return parts;
}

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
/** The XYZ Euler that turns +Y to point from `a` to `b` — shared by `span` and anything else laid on an axis. */
function axisEuler(a, b) {
  _p0.set(a[0], a[1], a[2]);
  _p1.set(b[0], b[1], b[2]);
  _dir.subVectors(_p1, _p0).normalize();
  _quat.setFromUnitVectors(_up, _dir);
  _euler.setFromQuaternion(_quat);
  return [_euler.x, _euler.y, _euler.z];
}
/** A painted cylinder whose own axis runs from `a` to `b` — pipes, cable runs, struts. */
function span(a, b, r1, r2, color, shade, segments = 8) {
  const len = Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return cyl(r1, r2, len, color, mid, axisEuler(a, b), segments, shade);
}
/** An open ring — a collar, a trim band, a fan-guard rim. Cheaper than a capped cylinder. */
function ring(radius, height, color, at, rot, segments, shade) {
  return place(paint(new THREE.CylinderGeometry(radius, radius, height, sides(segments), 1, true), color, shade), {
    at,
    rot,
  });
}
/** A collar clamped around a tube running from `a` to `b`, at `t` (0 = a .. 1 = b) along it. */
function collarOn(a, b, t, radius, height, color, shade, segments = 10) {
  const at = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return ring(radius, height, color, at, axisEuler(a, b), segments, shade);
}
/** A strap hinge: a pin with two knuckle wraps, axis along Y before `rot` turns it. One merged geometry. */
function hingeStrap(len, pinColor, leafColor, at, rot, pinShade, leafShade) {
  return place(
    merge([
      cyl(0.013, 0.013, len, pinColor, [0, 0, 0], undefined, 6, pinShade),
      nub(0.03, len * 0.32, 0.03, leafColor, [0, len * 0.27, 0], undefined, leafShade),
      nub(0.03, len * 0.32, 0.03, leafColor, [0, -len * 0.27, 0], undefined, leafShade),
    ]),
    { at, rot },
  );
}
/** A ring of `n` small studs (bolt/rivet heads) around a circle of radius `r`, local XZ plane (face +Y) before
 * `rot` tilts it. One merged, already-placed geometry. */
function boltRing(n, r, size, color, at, rot, shade, segments = 6) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(cyl(size, size, size * 0.9, color, [r * Math.cos(a), 0, r * Math.sin(a)], undefined, segments, shade));
  }
  return place(merge(parts), { at, rot });
}
/** A flat right-triangle decal (a warning sign), default normal +Z; pass rot [0, Math.PI, 0] to face -Z. */
function flatTriangle(w, h, color, at, rot, shade) {
  const hw = w / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-hw, 0, 0, hw, 0, 0, 0, h, 0]), 3));
  g.computeVertexNormals();
  return place(paint(g, color, shade), { at, rot });
}
/** A lathed upright profile — [radius, y] pairs revolved about the local Y axis — for a porcelain bushing or a
 * turned instrument knob: the one shape primitives alone cannot fake, so it is the real thing. */
function turned(profile, color, at, shade, segments = 12) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0004, r), y));
  return place(paint(new THREE.LatheGeometry(pts, sides(segments)), color, shade), { at });
}
/** A round backlit gauge: bezel ring, face, needle, built lying flat with its face normal +Y (like `ring`'s own
 * cylinder) — pass `rot` to tip it to face outward, e.g. [-Math.PI / 2, 0, 0] for a vertical panel facing -Z.
 * Needle angle in radians is measured in the dial's own local face plane (X-Z before `rot`), 0 = pointing +Z.
 * Returns a flat array of solid parts (spread into the caller's `solid`). */
function gauge(radius, at, rot, faceColor, needleColor, needleAngle, bezelShade) {
  const solid = [
    ring(radius, 0.014, C.steelDark, at, rot, 10, bezelShade),
    nub(radius * 1.5, 0.004, radius * 1.5, faceColor, at, rot, sPoly),
  ];
  const na = needleAngle;
  const local = [Math.sin(na) * radius * 0.7, 0, Math.cos(na) * radius * 0.7];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0])));
  const v = new THREE.Vector3(...local).applyQuaternion(q);
  const tip = [at[0] + v.x, at[1] + v.y, at[2] + v.z];
  solid.push(span([at[0], at[1], at[2]], tip, 0.0015, 0.004, needleColor, { ...sSteel, bevel: false }, 4));
  return solid;
}

// ---------------------------------------------------------------------------------------------------------------
// rack — a 19-inch instrument/frequency-converter cabinet: four-post frame, perforated side panels, a hinged
// door (glazed or mesh by variant) guarding rack-mount units of different heights with front handles, a row of
// breakers, a meter, cable management down one rail and a cable trunk on top.

const RACK_PALETTES = [
  { body: C.steelDark, frame: C.steel, unit: C.steel },
  { body: C.gunmetal, frame: C.steelLight, unit: C.steelLight },
  { body: 0x3c4042, frame: C.pale, unit: C.steel },
  { body: C.blueDark, frame: C.steelLight, unit: C.steelLight },
];
const RACK_UNITS = [
  'CASCADE FEED CTRL',
  'FREQ CONVERTER BANK',
  'INSTR RACK — AUX',
  'TELEMETRY NODE',
  'VACUUM MONITOR',
  'INTERLOCK PANEL',
];

export function buildRack(variant = 0) {
  const rng = makeRng(seedFor('rack', variant));
  const c = pick(RACK_PALETTES, variant);
  const H = 2.1;
  const hx = 0.47, // footprint half-width used by the body — 3 cm inside the 1 m box on each side
    hz = 0.4; // carcass half-depth — leaves a 9 cm budget front and back for the door/handle and the gland/trunk to stand proud
  const frontZ = -hz,
    backZ = hz;
  const meshDoor = rng.chance(0.5);
  const solid = [];
  const glow = [];
  const letters = [];

  // plinth and top cap — the cabinet's full-footprint base and lid
  solid.push(box(hx * 2, 0.08, hz * 2, c.body, [0, 0.04, 0], undefined, sEnamel));
  solid.push(box(hx * 2, 0.08, hz * 2, c.body, [0, H - 0.04, 0], undefined, sEnamel));
  // four 19-inch frame posts, the full height between plinth and cap
  const bodyY0 = 0.08,
    bodyY1 = H - 0.08;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      solid.push(
        box(
          0.05,
          bodyY1 - bodyY0,
          0.05,
          c.frame,
          [sx * (hx - 0.03), (bodyY0 + bodyY1) / 2, sz * (hz - 0.03)],
          undefined,
          sSteel,
        ),
      );
  // perforated side panels, each a grille of slots standing proud of the body skin
  for (const sx of [-1, 1]) {
    solid.push(
      box(
        0.03,
        bodyY1 - bodyY0 - 0.04,
        hz * 2 - 0.08,
        c.body,
        [sx * (hx - 0.015), (bodyY0 + bodyY1) / 2, 0],
        undefined,
        sEnamel,
      ),
    );
    solid.push(
      ...grid(
        4,
        5,
        0.014,
        0.04,
        0.13,
        0.42,
        0.14,
        C.black,
        [sx * (hx - 0.002), 1.05, 0],
        { ...sGun, bevel: false },
        'z',
      ),
    );
  }
  // bolted angle-iron construction: a ladder of fastener heads down each corner post
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (const t of [0.2, 0.5, 0.8])
        solid.push(
          nub(
            0.02,
            0.02,
            0.02,
            C.steelDark,
            [sx * (hx - 0.03), bodyY0 + (bodyY1 - bodyY0) * t, sz * (hz - 0.03)],
            undefined,
            sSteel,
          ),
        );
  // rear panel, flush with the carcass back face, with a cable gland standing proud of it
  solid.push(
    box(
      hx * 2 - 0.08,
      bodyY1 - bodyY0 - 0.04,
      0.03,
      c.body,
      [0, (bodyY0 + bodyY1) / 2, backZ - 0.015],
      undefined,
      sEnamel,
    ),
  );
  solid.push(nub(0.07, 0.07, 0.05, c.frame, [hx - 0.15, 0.16, backZ + 0.025], undefined, sGun));
  solid.push(span([hx - 0.15, 0.2, backZ + 0.025], [hx - 0.15, 0.4, backZ + 0.025], 0.014, 0.014, C.black, sRubber, 6));

  // door: a four-strip frame hinged on the left post, glazed or mesh by variant, with a handle and a latch
  const doorHalfW = hx - 0.06,
    doorY0 = bodyY0 + 0.03,
    doorY1 = bodyY1 - 0.03,
    doorZ = frontZ - 0.015;
  solid.push(nub(doorHalfW * 2, 0.045, 0.02, c.frame, [0, doorY1 - 0.0225, doorZ], undefined, sSteel)); // top rail
  solid.push(nub(doorHalfW * 2, 0.045, 0.02, c.frame, [0, doorY0 + 0.0225, doorZ], undefined, sSteel)); // bottom rail
  solid.push(
    nub(
      0.045,
      doorY1 - doorY0 - 0.08,
      0.02,
      c.frame,
      [-doorHalfW + 0.0225, (doorY0 + doorY1) / 2, doorZ],
      undefined,
      sSteel,
    ),
  ); // hinge stile
  solid.push(
    nub(
      0.045,
      doorY1 - doorY0 - 0.08,
      0.02,
      c.frame,
      [doorHalfW - 0.0225, (doorY0 + doorY1) / 2, doorZ],
      undefined,
      sSteel,
    ),
  ); // latch stile
  if (meshDoor) {
    solid.push(
      nub(
        doorHalfW * 2 - 0.1,
        doorY1 - doorY0 - 0.1,
        0.012,
        C.black,
        [0, (doorY0 + doorY1) / 2, doorZ - 0.004],
        undefined,
        sPoly,
      ),
    );
    for (let i = -2; i <= 2; i++)
      solid.push(
        nub(
          doorHalfW * 2 - 0.12,
          0.014,
          0.014,
          c.frame,
          [0, (doorY0 + doorY1) / 2 + i * 0.3, doorZ - 0.009],
          undefined,
          sGalv,
        ),
      );
    for (let i = -1; i <= 1; i++)
      solid.push(
        nub(
          0.014,
          doorY1 - doorY0 - 0.12,
          0.014,
          c.frame,
          [i * 0.28, (doorY0 + doorY1) / 2, doorZ - 0.009],
          undefined,
          sGalv,
        ),
      );
  } else {
    solid.push(
      nub(
        doorHalfW * 2 - 0.1,
        doorY1 - doorY0 - 0.1,
        0.012,
        C.glass,
        [0, (doorY0 + doorY1) / 2, doorZ - 0.004],
        undefined,
        sGlass,
      ),
    );
    solid.push(
      nub(doorHalfW * 2 - 0.1, 0.02, 0.014, c.frame, [0, (doorY0 + doorY1) / 2, doorZ - 0.009], undefined, sSteel),
    ); // mullion
  }
  // three hinges on the left stile
  for (const t of [0.15, 0.5, 0.85])
    solid.push(
      hingeStrap(
        0.22,
        C.steelDark,
        c.frame,
        [-doorHalfW + 0.01, doorY0 + (doorY1 - doorY0) * t, doorZ - 0.01],
        [0, 0, 0],
        sSteel,
        sSteel,
      ),
    );
  // handle and latch, on the right stile
  solid.push(
    nub(0.02, 0.26, 0.03, c.frame, [doorHalfW - 0.09, (doorY0 + doorY1) / 2, doorZ - 0.035], undefined, sSteel),
  );
  solid.push(
    nub(0.02, 0.03, 0.03, c.frame, [doorHalfW - 0.09, (doorY0 + doorY1) / 2 + 0.11, doorZ - 0.018], undefined, sSteel),
  );
  solid.push(
    nub(0.02, 0.03, 0.03, c.frame, [doorHalfW - 0.09, (doorY0 + doorY1) / 2 - 0.11, doorZ - 0.018], undefined, sSteel),
  );
  solid.push(
    nub(0.035, 0.05, 0.02, C.gunmetal, [doorHalfW - 0.03, (doorY0 + doorY1) / 2, doorZ - 0.01], undefined, sGun),
  );
  // a riveted placard on the door, proud of the glazing/mesh, carrying the bay number and unit designation
  const plateZ = doorZ - 0.02;
  solid.push(nub(0.5, 0.22, 0.012, c.frame, [0, doorY1 - 0.17, plateZ], undefined, sAlum));
  solid.push(boltRing(4, 0.21, 0.01, C.steelDark, [0, doorY1 - 0.17, plateZ - 0.007], [-Math.PI / 2, 0, 0], sSteel, 5));

  // mounting rails, just inside the door, and the equipment mounted flush to them — unit housings run from the
  // rail back into the cabinet, so every front-of-unit detail (handles, breakers, the meter, LEDs) sits proud on
  // the rail-side (railZ) face, where the player looking in through the door actually sees it.
  const railZ = frontZ + 0.02;
  for (const sx of [-1, 1])
    solid.push(nub(0.025, bodyY1 - bodyY0 - 0.1, 0.02, c.frame, [sx * 0.21, 1.05, railZ], undefined, sSteel));
  const UNIT_ROWS = [
    { y: 0.32, h: 0.26, d: 0.3 },
    { y: 0.66, h: 0.24, d: 0.26 },
    { y: 1.0, h: 0.22, d: 0.22 },
    { y: 1.3, h: 0.3, d: 0.3 },
    { y: 1.66, h: 0.24, d: 0.24 },
    { y: 1.96, h: 0.14, d: 0.18 },
  ];
  UNIT_ROWS.forEach((u, i) => {
    const uc = pick([c.unit, C.steelLight, C.gunmetal], variant + i);
    solid.push(nub(0.4, u.h, u.d, uc, [0, u.y, railZ + u.d / 2], undefined, sGun));
    if (i % 2 === 0) solid.push(nub(0.025, u.h * 0.5, 0.018, c.frame, [0.13, u.y, railZ - 0.011], undefined, sSteel)); // front handle
  });
  // a row of breakers on the third unit
  for (let i = -3; i <= 3; i++)
    solid.push(nub(0.025, 0.045, 0.02, C.black, [i * 0.045, UNIT_ROWS[2].y + 0.03, railZ - 0.011], undefined, sPoly));
  // a meter on the fourth unit, tipped to face -Z (the door) instead of lying flat
  solid.push(
    ...gauge(
      0.07,
      [-0.12, UNIT_ROWS[3].y + 0.04, railZ - 0.013],
      [-Math.PI / 2, 0, 0],
      C.pale,
      C.black,
      rng.range(-0.6, 0.6),
      sAlum,
    ),
  );
  solid.push(nub(0.1, 0.07, 0.01, C.pale, [0.14, UNIT_ROWS[5].y, railZ - 0.009], undefined, sAlum)); // small rating plate

  // cable management: a loom down the right rail to a base gland, and a trunk along the top
  const loomTop = [0.21, bodyY1 - 0.1, railZ];
  const loomMid = [0.3, 0.5, railZ + 0.1];
  const loomBase = [0.3, 0.18, backZ - 0.02];
  solid.push(span(loomTop, loomMid, 0.014, 0.013, C.black, sRubber, 6));
  solid.push(span(loomMid, loomBase, 0.013, 0.013, C.black, sRubber, 6));
  solid.push(nub(0.08, 0.08, 0.06, c.frame, [0.3, 0.1, backZ - 0.02], undefined, sGun));
  solid.push(box(hx * 2 - 0.12, 0.07, 0.22, c.frame, [0, H - 0.115, backZ - 0.18], undefined, sGalv)); // trunk
  solid.push(nub(0.05, 0.065, 0.2, c.frame, [-(hx - 0.06), H - 0.115, backZ - 0.18], undefined, sGalv));
  solid.push(nub(0.05, 0.065, 0.2, c.frame, [hx - 0.06, H - 0.115, backZ - 0.18], undefined, sGalv));
  solid.push(span([0.18, H - 0.15, backZ - 0.18], [0.18, bodyY1 - 0.02, backZ], 0.016, 0.016, c.frame, sGalv, 6));
  solid.push(span([-0.18, H - 0.15, backZ - 0.18], [-0.18, bodyY1 - 0.02, backZ], 0.016, 0.016, c.frame, sGalv, 6));

  // feet and corner fasteners
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      solid.push(nub(0.05, 0.03, 0.05, C.black, [sx * (hx - 0.08), 0.015, sz * (hz - 0.08)], undefined, sRubber));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      solid.push(
        nub(
          0.016,
          0.016,
          0.014,
          c.frame,
          [sx * (hx - 0.03), bodyY0 + 0.02, sz * (hz - 0.03) + sz * 0.016],
          undefined,
          sGalv,
        ),
      );
      solid.push(
        nub(
          0.016,
          0.016,
          0.014,
          c.frame,
          [sx * (hx - 0.03), bodyY1 - 0.02, sz * (hz - 0.03) + sz * 0.016],
          undefined,
          sGalv,
        ),
      );
    }
  solid.push(flatTriangle(0.09, 0.075, C.yellow, [0.2, UNIT_ROWS[3].y - 0.12, railZ - 0.012], [0, Math.PI, 0], sPaint));

  glow.push(nub(0.016, 0.016, 0.005, GLOW.ledGreen, [-0.16, UNIT_ROWS[1].y, railZ - 0.011], undefined, sLed));
  glow.push(nub(0.016, 0.016, 0.005, GLOW.ledAmber, [0.1, UNIT_ROWS[4].y, railZ - 0.011], undefined, sLed));
  glow.push(nub(0.016, 0.016, 0.005, GLOW.ledRed, [-0.1, UNIT_ROWS[0].y, railZ - 0.011], undefined, sLed));

  const bay = 1 + wrap(variant, 24);
  letters.push({
    text: `BAY ${String(bay).padStart(2, '0')}`,
    at: [0, doorY1 - 0.1, plateZ - 0.011],
    out: [0, 0, -1],
    height: 0.045,
    tone: 'white',
  });
  letters.push({
    text: pick(RACK_UNITS, variant),
    at: [0, doorY1 - 0.22, plateZ - 0.011],
    out: [0, 0, -1],
    height: 0.026,
    tone: 'white',
  });
  letters.push({
    text: '480V',
    at: [0.14, UNIT_ROWS[2].y - 0.09, railZ - 0.006],
    out: [0, 0, -1],
    height: 0.022,
    tone: 'hazard',
  });

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}

// ---------------------------------------------------------------------------------------------------------------
// locker — a bank of six steel lockers on a shared plinth: louvred doors with recessed handles, hasps, number
// plates and hinges, a sloped top, one door standing ajar on odd variants.

const LOCKER_PALETTES = [
  { body: C.steel, trim: C.steelDark },
  { body: C.olive, trim: C.oliveDark },
  { body: C.blueDark, trim: C.steelDark },
  { body: C.steelLight, trim: C.gunmetal },
];

export function buildLocker(variant = 0) {
  const rng = makeRng(seedFor('locker', variant));
  const c = pick(LOCKER_PALETTES, variant);
  const H = 1.9;
  const hx = 0.98, // footprint half-width — 2 cm inside the 2 m box
    hd = 0.42; // carcass half-depth — leaves an 8 cm budget front and back for doors/hardware to stand proud
  const frontZ = -hd,
    backZ = hd;
  const plinthH = 0.1,
    capY = H - 0.1; // top of the flat door bank, below the sloped cap
  const nDoors = 6,
    step = (hx * 2) / nDoors,
    doorW = step - 0.02;
  const ajarDoor = rng.chance(0.45) ? rng.int(0, nDoors - 1) : -1;
  const solid = [];
  const letters = [];

  // plinth and a sloped cap (a shallow lean-to roof over the flat door bank, rising toward the back)
  solid.push(box(hx * 2, plinthH, hd * 2, c.trim, [0, plinthH / 2, 0], undefined, sEnamel));
  solid.push(box(hx * 2 - 0.02, 0.03, hd * 2 - 0.02, c.trim, [0, capY + 0.035, 0.015], [-0.05, 0, 0], sEnamel));
  solid.push(nub(hx * 2, 0.02, 0.04, c.trim, [0, capY + 0.01, frontZ + 0.02], undefined, sGalv)); // front drip edge
  // a riveted trim strip along the top of the flat door bank, just under the sloped cap
  solid.push(...grid(3, 16, 0.045, 0.01, 0.012, 0.013, 0.115, c.trim, [0, capY - 0.025, frontZ - 0.016], sGalv, 'x'));
  // side end panels and the back
  for (const sx of [-1, 1]) {
    solid.push(
      box(0.02, capY - plinthH, hd * 2 - 0.02, c.body, [sx * (hx - 0.01), (plinthH + capY) / 2, 0], undefined, sEnamel),
    );
    solid.push(
      ...grid(
        3,
        3,
        0.012,
        0.03,
        0.09,
        0.09,
        0.14,
        C.black,
        [sx * (hx + 0.001), 1.5, -0.05],
        { ...sGun, bevel: false },
        'z',
      ),
    );
  }
  solid.push(
    box(hx * 2 - 0.04, capY - plinthH, 0.02, c.body, [0, (plinthH + capY) / 2, backZ - 0.01], undefined, sEnamel),
  );
  // vertical trim posts between and at the ends of the six doors
  for (let i = 0; i <= nDoors; i++)
    solid.push(
      nub(
        0.016,
        capY - plinthH - 0.04,
        0.018,
        c.trim,
        [-hx + i * step, (plinthH + capY) / 2, frontZ - 0.015],
        undefined,
        sGalv,
      ),
    );

  const doorY0 = plinthH + 0.02,
    doorY1 = capY - 0.02,
    doorZ = frontZ - 0.012,
    midY = (doorY0 + doorY1) / 2;
  const _vOut = new THREE.Vector3();
  for (let i = 0; i < nDoors; i++) {
    const cx = -hx + step * (i + 0.5);
    const ajar = i === ajarDoor;
    const hingeX = cx - doorW / 2;
    const swing = ajar ? [0, -0.26, 0] : [0, 0, 0]; // hinged on the left edge, swung open a little about a Y axis
    const pivot = [hingeX, 0, doorZ];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...swing));

    // every door part is built relative to the hinge pivot (local x grows away from the hinge, local z is depth
    // proud of doorZ), then the whole assembly is placed as one rigid body — flush, or swung open if ajar
    const dx = doorW; // door width measured from the hinge
    const doorParts = [
      box(doorW, doorY1 - doorY0, 0.02, c.body, [dx / 2, midY, -0.01], undefined, sEnamel),
      nub(0.02, 0.12, 0.012, c.trim, [dx - 0.045, midY - 0.35, -0.022], undefined, sGun), // recessed handle recess
      nub(0.016, 0.09, 0.025, c.trim, [dx - 0.045, midY - 0.35, -0.034], undefined, sGun), // handle bar
      nub(0.05, 0.06, 0.018, C.gunmetal, [dx - 0.045, midY - 0.5, -0.025], undefined, sGun), // hasp
      nub(0.025, 0.025, 0.02, C.black, [dx - 0.045, midY - 0.56, -0.03], undefined, {
        mat: 'polymer',
        rough: 0.6,
        metal: 0,
      }), // padlock body
      nub(0.1, 0.055, 0.006, C.pale, [0.09, doorY1 - 0.14, -0.022], undefined, sAlum), // number plate
    ];
    for (let s = 0; s < 6; s++)
      doorParts.push(
        nub(doorW - 0.07, 0.016, 0.012, c.trim, [dx / 2, doorY1 - 0.1 - s * 0.042, -0.021], undefined, sGalv),
      );
    solid.push(place(merge(doorParts), { at: pivot, rot: swing }));
    // hinges stay fixed to the frame, at the same edge regardless of swing
    for (const t of [0.14, 0.5, 0.86])
      solid.push(
        hingeStrap(
          0.16,
          C.steelDark,
          c.trim,
          [hingeX + 0.01, doorY0 + (doorY1 - doorY0) * t, doorZ - 0.012],
          [0, 0, 0],
          sSteel,
          sSteel,
        ),
      );

    const plateLocal = new THREE.Vector3(0.09, 0, -0.03);
    const platePos = plateLocal
      .clone()
      .applyQuaternion(q)
      .add(new THREE.Vector3(...pivot));
    _vOut.set(0, 0, -1).applyQuaternion(q);
    letters.push({
      text: String(1 + variant * nDoors + i),
      at: [platePos.x, doorY1 - 0.14, platePos.z],
      out: [_vOut.x, 0, _vOut.z],
      height: 0.032,
      tone: 'white',
    });
  }
  // a continuous kick-plate vent and a single asset tag on the plinth
  solid.push(nub(hx * 1.6, 0.03, 0.012, c.trim, [0, plinthH - 0.04, frontZ - 0.002], undefined, sGalv));
  letters.push({
    text: `LOCKER BANK ${String.fromCharCode(65 + wrap(variant, 8))}`,
    at: [0, plinthH - 0.04, frontZ - 0.009],
    out: [0, 0, -1],
    height: 0.02,
    tone: 'black',
  });

  return { solid: merge(solid), glow: null, letters };
}

// ---------------------------------------------------------------------------------------------------------
// desk — a steel desk: a thick bevelled worktop whose top is the box's own ceiling (so a player can stand on
// it), a drawer pedestal on one end, an open leg frame with a stretcher on the other, a modesty panel closing
// the knee space, a cable grommet feeding a dropped cable, and a lower rear shelf (the old model's clutter
// moved down a step, so nothing needed on the desk pokes above the standing surface).

const DESK_PALETTES = [
  { body: C.steel, dark: C.steelDark },
  { body: C.olive, dark: C.oliveDark },
  { body: C.pale, dark: C.paleDark },
  { body: C.blueDark, dark: C.steelDark },
];

export function buildDesk(variant = 0) {
  const rng = makeRng(seedFor('desk', variant));
  const c = pick(DESK_PALETTES, variant);
  const H = 0.78;
  const hxTop = 0.96, // worktop half-width — 4 cm inside the 2 m box
    hdTop = 0.46; // worktop half-depth — 4 cm inside the 1 m box
  const topT = 0.045; // front worktop thickness
  const splitZ = 0.1; // where the standing worktop steps down to the lower rear shelf
  const frontHD = (splitZ - -hdTop) / 2,
    frontCZ = (-hdTop + splitZ) / 2;
  const backHD = (hdTop - splitZ) / 2,
    backCZ = (splitZ + hdTop) / 2;
  const backT = 0.04,
    backTopY = H - 0.03; // the rear shelf sits 3 cm lower, headroom for what stands on it
  const solid = [
    box(hxTop * 2, topT, frontHD * 2, c.body, [0, H - topT / 2, frontCZ], undefined, sEnamel), // front worktop — flat top at exactly H
    box(hxTop * 2, backT, backHD * 2, c.body, [0, backTopY - backT / 2, backCZ], undefined, sEnamel), // rear shelf, one step down
    nub(hxTop * 2 - 0.02, H - backTopY, 0.02, c.dark, [0, (H + backTopY) / 2, splitZ - 0.005], undefined, sGalv), // the step's riser lip
    box(hxTop * 2 - 0.04, 0.02, 0.012, c.dark, [0, H - 0.01, -hdTop - 0.006], undefined, sGalv), // a proud edge trim along the front lip
  ];
  const glow = [];
  const letters = [];
  const underFront = H - topT; // 0.735 — where the pedestal/front leg stop, flush under the front worktop
  const underBack = backTopY - backT; // where the back leg stops, flush under the rear shelf
  // side edge trims along the front tier only (the tier the side trim's own height band belongs to)
  for (const sxt of [-1, 1])
    solid.push(
      nub(0.012, 0.02, frontHD * 2 - 0.01, c.dark, [sxt * (hxTop + 0.006), H - 0.01, frontCZ], undefined, sGalv),
    );

  // pedestal, left end: a drawer cabinet on a recessed toe-kick, three drawer fronts facing the room (-Z).
  // Each proud layer is expressed from the one before it (2 mm overlap into the surface it sits on), the same
  // budgeted-stack pattern as the rack's front face, so nothing floats and nothing is flush with what is below.
  const pedHX = 0.22,
    pedHD = 0.21,
    pedX = -0.7,
    pedFrontZ = -hdTop, // the cabinet's own front face — flush with the worktop's front edge
    pedZ = pedFrontZ + pedHD,
    kickH = 0.045,
    pedBodyH = underFront - kickH;
  solid.push(
    nub(pedHX * 2 - 0.03, kickH, pedHD * 2 - 0.03, c.dark, [pedX, kickH / 2, pedZ + 0.01], undefined, sEnamel),
  );
  solid.push(box(pedHX * 2, pedBodyH, pedHD * 2, c.body, [pedX, kickH + pedBodyH / 2, pedZ], undefined, sEnamel));
  const drawerFrontZ = pedFrontZ - 0.008, // half-depth 0.01: near face pedFrontZ+0.002 (2mm into the body), far face pedFrontZ-0.018
    drawerFaceZ = pedFrontZ - 0.018;
  const pullZ = pedFrontZ - 0.021; // half-depth 0.005: near face pedFrontZ-0.016 (2mm into the drawer), far face pedFrontZ-0.026
  for (let i = 0; i < 3; i++) {
    const dy = kickH + pedBodyH * (0.18 + i * 0.32);
    solid.push(box(pedHX * 2 - 0.03, pedBodyH * 0.27, 0.02, c.dark, [pedX, dy, drawerFrontZ], undefined, sEnamel));
    solid.push(nub(pedHX * 1.1, 0.018, 0.01, c.body, [pedX, dy, pullZ], undefined, sGun)); // recessed pull
    // four exposed corner screws per drawer face
    for (const [sxg, syg] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      solid.push(
        nub(
          0.012,
          0.012,
          0.006,
          C.black,
          [pedX + sxg * (pedHX - 0.04), dy + syg * pedBodyH * 0.11, drawerFrontZ - 0.012],
          undefined,
          sGun,
        ),
      );
  }
  // a flush card-reader by the top drawer, with one small lit LED — a secure-site touch. Reader body overlaps
  // the cabinet face by 2mm; the LED sits proud of the reader's own face by 2mm; the label sits below both.
  const readerX = pedX + pedHX - 0.055,
    readerY = kickH + pedBodyH * 0.18 + 0.12,
    readerFaceZ = pedFrontZ - 0.014; // half-depth 0.008: near face pedFrontZ-0.006, far face pedFrontZ-0.014
  solid.push(nub(0.05, 0.07, 0.016, C.black, [readerX, readerY, pedFrontZ - 0.006], undefined, sPoly));
  glow.push(nub(0.013, 0.013, 0.004, GLOW.ledGreen, [readerX, readerY + 0.02, readerFaceZ - 0.002], undefined, sLed));
  letters.push({
    text: 'BADGE',
    at: [readerX, readerY - 0.025, readerFaceZ - 0.005],
    out: [0, 0, -1],
    height: 0.012,
    tone: 'white',
  });

  // open leg frame, right end: two legs under the step (one under each tier) joined by a stretcher rail
  const legX = 0.78,
    legFrontZ = -hdTop + 0.03,
    legBackZ = hdTop - 0.05,
    footH = 0.03;
  solid.push(
    box(0.04, underFront - footH, 0.04, c.dark, [legX, footH + (underFront - footH) / 2, legFrontZ], undefined, sSteel),
  );
  solid.push(
    box(0.04, underBack - footH, 0.04, c.dark, [legX, footH + (underBack - footH) / 2, legBackZ], undefined, sSteel),
  );
  for (const lz of [legFrontZ, legBackZ])
    solid.push(cyl(0.03, 0.024, footH, C.black, [legX, footH / 2, lz], undefined, 10, sRubber)); // adjustable glide feet
  solid.push(
    nub(
      0.03,
      0.03,
      legBackZ - legFrontZ - 0.02,
      c.dark,
      [legX, underFront - 0.08, (legFrontZ + legBackZ) / 2],
      undefined,
      sSteel,
    ),
  );
  // corner gussets where the legs and the pedestal meet the worktop's underside
  for (const [gxp, gzp] of [
    [legX, legFrontZ],
    [legX, legBackZ],
    [pedX, pedZ],
  ])
    solid.push(nub(0.07, 0.018, 0.07, c.dark, [gxp, underFront - 0.015, gzp], undefined, sSteel));

  // a modesty panel closing the open-leg knee space, recessed behind the worktop's front edge, with a top and
  // bottom lip so it reads as a framed panel rather than a bare sheet
  const modX0 = pedX + pedHX + 0.02,
    modX1 = legX + 0.02,
    modZ = -hdTop + 0.09;
  solid.push(box(modX1 - modX0, 0.3, 0.016, c.dark, [(modX0 + modX1) / 2, 0.37, modZ], undefined, sEnamel));
  solid.push(
    nub(modX1 - modX0 + 0.02, 0.016, 0.022, c.body, [(modX0 + modX1) / 2, 0.52, modZ - 0.001], undefined, sSteel),
  );
  solid.push(
    nub(modX1 - modX0 + 0.02, 0.016, 0.022, c.body, [(modX0 + modX1) / 2, 0.22, modZ - 0.001], undefined, sSteel),
  );
  // a power strip mounted on the modesty panel's inside (knee-space) face, four outlet slots proud of it
  solid.push(box(0.5, 0.05, 0.02, C.black, [0.3, 0.46, modZ + 0.018], undefined, sPoly));
  solid.push(...grid(1, 4, 0.03, 0.025, 0.012, 0, 0.1, C.gunmetal, [0.3, 0.46, modZ + 0.032], sPoly, 'x'));

  // a wire basket cable tray, slung directly under and touching the worktop, in the knee space
  const trayAt1 = underFront - 0.0465; // so the grid's top row's top edge lands exactly on the worktop underside
  solid.push(...grid(3, 13, 0.016, 0.013, 0.013, 0.07, 0.065, C.black, [0.1, trayAt1 - 0.03, modZ + 0.03], sGun, 'x'));
  solid.push(
    nub(0.84, 0.012, 0.11, C.black, [0.1, trayAt1 - 0.1125, modZ + 0.03], undefined, { ...sGun, bevel: false }),
  ); // basket floor, touching the bottom row

  // a floor-standing CPU tower in the knee space beside the pedestal, with a vented front and a drive-bay fascia
  const cpuX = -0.32,
    cpuHX = 0.09,
    cpuHD = 0.19,
    cpuH = 0.58,
    cpuFrontZ = -0.12 - cpuHD;
  solid.push(box(cpuHX * 2, cpuH, cpuHD * 2, c.dark, [cpuX, cpuH / 2, -0.12], undefined, sEnamel));
  solid.push(nub(cpuHX * 1.5, 0.018, 0.01, c.body, [cpuX, cpuH * 0.86, cpuFrontZ - 0.006], undefined, sAlum)); // drive bay fascia
  solid.push(...grid(5, 3, 0.03, 0.01, 0.01, 0.08, 0.04, C.black, [cpuX, cpuH * 0.45, cpuFrontZ - 0.006], sGun, 'x'));

  // a cable grommet on the rear shelf, flush with its surface, feeding a cable down behind the modesty panel
  const gx = pedX + 0.05,
    gz = backCZ + 0.05;
  solid.push(cyl(0.035, 0.035, 0.016, C.black, [gx, backTopY - 0.008, gz], undefined, 12, sPoly));
  solid.push(span([gx, underBack - 0.01, gz], [gx + 0.04, 0.03, legFrontZ + 0.3], 0.006, 0.006, C.black, sRubber, 6));

  // what stands on the rear shelf, low enough to stay under the step: a closed terminal and a flat notepad
  solid.push(box(0.34, 0.018, 0.2, C.steelDark, [0.15, backTopY + 0.009, backCZ - 0.05], undefined, sGun));
  solid.push(nub(0.22, 0.006, 0.16, C.pale, [-0.35, backTopY + 0.003, backCZ + 0.05], undefined, sPaint));

  letters.push({
    text: `ASSET DSK-${rng.int(100, 399)}`,
    at: [pedX, kickH + pedBodyH * (0.18 + 2 * 0.32), drawerFaceZ - 0.005],
    out: [0, 0, -1],
    height: 0.016,
    tone: 'white',
  });
  letters.push({
    text: 'MAX 120 KG',
    at: [0.55, H - topT / 2, -hdTop - 0.005],
    out: [0, 0, -1],
    height: 0.014,
    tone: 'black',
  });

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}

// ---------------------------------------------------------------------------------------------------------------
// transformer — an oil-filled power transformer: a tank with corrugated radiator banks on three faces (the
// fourth, the front, kept clear for the control/access gear a crew actually has to reach), a conservator drum
// on brackets, HV and LV porcelain bushings (lathed, sheds and all), a tap-changer box, a cable terminal box,
// lifting lugs, a rating plate, a skid base with a drain valve, and a concrete bund kerb to hold a spill.

const TRANSFORMER_PALETTES = [
  { body: C.steel, dark: C.steelDark },
  { body: C.oliveDark, dark: C.olive },
  { body: C.pale, dark: C.paleDark },
  { body: C.blueDark, dark: C.steelLight },
];

// lathed [radius, y] profiles for the two bushing sizes — HV (tall, three sheds) and LV (short, two sheds).
const HV_BUSHING_PROFILE = [
  [0.05, 0],
  [0.065, 0.015],
  [0.048, 0.035],
  [0.048, 0.055],
  [0.08, 0.085],
  [0.044, 0.15],
  [0.08, 0.18],
  [0.044, 0.25],
  [0.08, 0.28],
  [0.044, 0.35],
  [0.05, 0.37],
  [0.034, 0.4],
];
const LV_BUSHING_PROFILE = [
  [0.04, 0],
  [0.05, 0.012],
  [0.036, 0.03],
  [0.065, 0.055],
  [0.034, 0.1],
  [0.065, 0.125],
  [0.036, 0.17],
  [0.026, 0.19],
];

export function buildTransformer(variant = 0) {
  const rng = makeRng(seedFor('transformer', variant));
  const c = pick(TRANSFORMER_PALETTES, variant);
  const kva = rng.pick([1000, 1600, 2000, 2500, 3150]);
  const solid = [];
  const glow = [];
  const letters = [];

  // concrete bund kerb: a shallow drained pan with a raised lip at the footprint's outer edge, holding any spill
  const kerbHX = 0.96,
    kerbHZ = 0.96,
    panHX = 0.94,
    panHZ = 0.94;
  solid.push(box(panHX * 2, 0.05, panHZ * 2, C.concrete, [0, 0.025, 0], undefined, sConcrete));
  solid.push(nub(kerbHX * 2, 0.09, 0.04, C.concrete, [0, 0.045, kerbHZ - 0.02], undefined, sConcrete));
  solid.push(nub(kerbHX * 2, 0.09, 0.04, C.concrete, [0, 0.045, -kerbHZ + 0.02], undefined, sConcrete));
  solid.push(nub(0.04, 0.09, kerbHZ * 2, C.concrete, [kerbHX - 0.02, 0.045, 0], undefined, sConcrete));
  solid.push(nub(0.04, 0.09, kerbHZ * 2, C.concrete, [-kerbHX + 0.02, 0.045, 0], undefined, sConcrete));

  // steel skid base: two rails and three cross members resting on the pan, with a drain valve hanging underneath
  const skidTop = 0.17;
  for (const sz of [-1, 1]) solid.push(nub(1.72, 0.12, 0.12, c.dark, [0, 0.11, sz * 0.62], undefined, sGalv));
  for (const sx of [-0.55, 0, 0.55]) solid.push(nub(0.12, 0.1, 1.3, c.dark, [sx, 0.1, 0], undefined, sGalv));
  solid.push(nub(0.05, 0.05, 0.05, C.gunmetal, [0.3, 0.075, 0], undefined, sGun)); // drain valve body
  solid.push(cyl(0.032, 0.032, 0.03, C.gunmetal, [0.3, 0.05, 0.07], [Math.PI / 2, 0, 0], 8, sGun)); // handwheel
  solid.push(span([0.3, 0.05, 0], [0.3, 0.05, 0.07], 0.012, 0.012, C.gunmetal, sGun, 6)); // valve stub

  // the tank itself
  const hxT = 0.76,
    hzT = 0.76,
    tankY0 = skidTop,
    tankY1 = 1.72,
    frontZ = -hzT,
    backZ = hzT;
  solid.push(box(hxT * 2, tankY1 - tankY0, hzT * 2, c.body, [0, (tankY0 + tankY1) / 2, 0], undefined, sEnamel));

  // corrugated radiator banks: vertical fin blades between a top and bottom header pipe, standing proud of the
  // tank skin on both sides and the back — the front is kept clear for the tap-changer and terminal box
  const finY0 = tankY0 + 0.25,
    finY1 = tankY1 - 0.15,
    finYc = (finY0 + finY1) / 2,
    finH = finY1 - finY0;
  function radiatorBank(faceX, faceZ, along, n, half) {
    // faceX/faceZ: the tank-wall point the bank is mounted to; along: 'x' or 'z', the axis the fins spread on
    for (let i = 0; i < n; i++) {
      const t = ((i - (n - 1) / 2) * (half * 2)) / Math.max(1, n - 1);
      const x = along === 'z' ? faceX : faceX + 0; // faceX already carries the proud offset for an x-mounted bank
      const z = along === 'z' ? faceZ + t : faceZ;
      const fx = along === 'x' ? faceX + t : x;
      solid.push(
        box(along === 'x' ? 0.09 : 0.05, finH, along === 'z' ? 0.09 : 0.05, c.dark, [fx, finYc, z], undefined, sGalv),
      );
    }
    const hdrA = along === 'z' ? [faceX, finY0 - 0.03, faceZ - half] : [faceX - half, finY0 - 0.03, faceZ];
    const hdrB = along === 'z' ? [faceX, finY0 - 0.03, faceZ + half] : [faceX + half, finY0 - 0.03, faceZ];
    const hdrA2 = along === 'z' ? [faceX, finY1 + 0.03, faceZ - half] : [faceX - half, finY1 + 0.03, faceZ];
    const hdrB2 = along === 'z' ? [faceX, finY1 + 0.03, faceZ + half] : [faceX + half, finY1 + 0.03, faceZ];
    solid.push(span(hdrA, hdrB, 0.035, 0.035, c.dark, sGalv, 8));
    solid.push(span(hdrA2, hdrB2, 0.035, 0.035, c.dark, sGalv, 8));
    const wallPt =
      along === 'z'
        ? [faceX - Math.sign(faceX || 1) * 0.045, finY0 - 0.03, faceZ]
        : [faceX, finY0 - 0.03, faceZ - Math.sign(faceZ || 1) * 0.045];
    solid.push(
      span(
        wallPt,
        hdrA.map((v, i2) => (i2 === 0 ? faceX : i2 === 2 ? faceZ : v)),
        0.03,
        0.03,
        c.dark,
        sGalv,
        8,
      ),
    );
    const wallPt2 =
      along === 'z'
        ? [faceX - Math.sign(faceX || 1) * 0.045, finY1 + 0.03, faceZ]
        : [faceX, finY1 + 0.03, faceZ - Math.sign(faceZ || 1) * 0.045];
    solid.push(
      span(
        wallPt2,
        hdrA2.map((v, i2) => (i2 === 0 ? faceX : i2 === 2 ? faceZ : v)),
        0.03,
        0.03,
        c.dark,
        sGalv,
        8,
      ),
    );
  }
  radiatorBank(-(hxT + 0.045), 0, 'z', 12, 0.6);
  radiatorBank(hxT + 0.045, 0, 'z', 12, 0.6);
  radiatorBank(0, backZ + 0.045, 'x', 8, 0.58);

  // conservator: a horizontal drum on two brackets above the tank, with a sight glass and a breather, set back
  // from the bushings so neither crowds the other
  const consY = tankY1 + 0.15 + 0.16;
  for (const bx of [-0.22, 0.22])
    solid.push(nub(0.05, 0.15, 0.05, c.dark, [bx, tankY1 + 0.075, 0.3], undefined, sSteel));
  solid.push(cyl(0.16, 0.16, 0.8, c.body, [0, consY, 0.3], [0, 0, Math.PI / 2], 12, sEnamel));
  solid.push(cyl(0.02, 0.02, 0.1, C.glass, [0.38, consY, 0.3], undefined, 8, sGlass)); // oil-level sight glass
  solid.push(cyl(0.025, 0.025, 0.07, c.dark, [0, consY + 0.16 + 0.035, 0.3], undefined, 8, sSteel)); // breather pipe
  solid.push(nub(0.045, 0.02, 0.045, c.dark, [0, consY + 0.16 + 0.08, 0.3], undefined, sSteel)); // breather cap
  solid.push(span([0.12, tankY1, 0.3], [0.12, tankY1 + 0.15, 0.3], 0.022, 0.022, c.dark, sSteel, 8)); // link pipe
  glow.push(nub(0.012, 0.012, 0.012, GLOW.ledAmber, [-0.22, tankY1 + 0.14, 0.33], undefined, sLed)); // trip tell-tale

  // HV bushings (3, taller, three sheds) toward the front of the tank top, clear of the conservator
  for (const bx of [-0.3, 0, 0.3]) {
    solid.push(cyl(0.085, 0.085, 0.02, c.dark, [bx, tankY1 + 0.01, -0.25], undefined, 10, sSteel)); // mounting flange
    solid.push(turned(HV_BUSHING_PROFILE, C.porcelain, [bx, tankY1 + 0.02, -0.25], sPorcelain, 12));
    solid.push(span([bx, tankY1 + 0.42, -0.25], [bx, tankY1 + 0.47, -0.25], 0.012, 0.012, C.brassTone, sBrass, 6)); // busbar stub
  }
  // LV bushings (3, shorter, two sheds) alongside, toward the +X edge of the top
  for (const bz of [-0.45, -0.15, 0.15]) {
    solid.push(cyl(0.07, 0.07, 0.016, c.dark, [0.55, tankY1 + 0.008, bz], undefined, 10, sSteel));
    solid.push(turned(LV_BUSHING_PROFILE, C.porcelain, [0.55, tankY1 + 0.016, bz], sPorcelain, 10));
    solid.push(span([0.55, tankY1 + 0.21, bz], [0.55, tankY1 + 0.25, bz], 0.01, 0.01, C.brassTone, sBrass, 6));
  }

  // pressure relief valve, a corner clear of both bushing rows and the conservator
  solid.push(ring(0.045, 0.03, c.dark, [-0.55, tankY1 + 0.015, 0.5], undefined, 8, sSteel));
  solid.push(cyl(0.018, 0.018, 0.05, c.dark, [-0.55, tankY1 + 0.055, 0.5], undefined, 8, sSteel));

  // lifting lugs, one at each top corner of the tank
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      solid.push(
        nub(0.1, 0.03, 0.07, c.dark, [sx * (hxT - 0.12), tankY1 + 0.02, sz * (hzT - 0.12)], undefined, sSteel),
      );
      solid.push(
        ring(
          0.025,
          0.018,
          c.dark,
          [sx * (hxT - 0.12), tankY1 + 0.045, sz * (hzT - 0.12)],
          [Math.PI / 2, 0, 0],
          8,
          sSteel,
        ),
      );
    }
  // grounding lug strap, low on a side face clear of the radiator fins
  solid.push(nub(0.05, 0.14, 0.02, c.dark, [-hxT - 0.025, 0.5, -0.7], undefined, sSteel));

  // front face: tap-changer drive box (with its hand wheel), a cable terminal box with conduit down to the
  // skid, and a rating plate with a boltring of fixing studs
  const tapZ = frontZ - 0.08;
  solid.push(box(0.26, 0.32, 0.16, c.dark, [-0.35, 1.0, tapZ], undefined, sGun));
  solid.push(cyl(0.05, 0.05, 0.03, c.dark, [-0.35, 1.0, tapZ - 0.095], [Math.PI / 2, 0, 0], 12, sSteel));
  solid.push(boltRing(8, 0.1, 0.008, c.dark, [-0.35, 1.0, tapZ - 0.081], [Math.PI / 2, 0, 0], sSteel, 6));

  const termZ = frontZ - 0.07;
  solid.push(box(0.2, 0.18, 0.14, c.dark, [0.1, 0.7, termZ], undefined, sGun));
  solid.push(span([0.1, 0.61, termZ - 0.06], [0.1, skidTop, termZ - 0.06], 0.025, 0.025, c.dark, sGun, 8));
  glow.push(nub(0.01, 0.01, 0.01, GLOW.ledRed, [0.19, 0.76, termZ - 0.065], undefined, sLed)); // energised lamp

  const plateZ = frontZ - 0.021;
  solid.push(box(0.26, 0.17, 0.012, C.pale, [0.5, 1.1, plateZ], undefined, sPaint));
  solid.push(boltRing(4, 0.1, 0.006, c.dark, [0.5, 1.1, plateZ - 0.007], undefined, sSteel, 6));

  // a small hazard triangle, backed so it does not z-fight the tank skin, beside the danger line
  solid.push(nub(0.16, 0.14, 0.012, C.black, [-0.4, 0.55, frontZ - 0.006], undefined, sPaint));
  solid.push(flatTriangle(0.12, 0.1, C.yellow, [-0.4, 0.49, frontZ - 0.013], [0, Math.PI, 0], sPaint));

  letters.push({
    text: `XFMR-${String(rng.int(1, 6)).padStart(2, '0')}`,
    at: [0, 1.35, frontZ - 0.006],
    out: [0, 0, -1],
    height: 0.09,
    tone: 'white',
  });
  letters.push({
    text: `${kva} kVA`,
    at: [0.5, 1.14, plateZ - 0.007 - 0.001],
    out: [0, 0, -1],
    height: 0.032,
    tone: 'black',
  });
  letters.push({
    text: MAKER,
    at: [0.5, 1.07, plateZ - 0.007 - 0.001],
    out: [0, 0, -1],
    height: 0.016,
    tone: 'black',
  });
  letters.push({
    text: 'DANGER - HIGH VOLTAGE',
    at: [0, 0.55, frontZ - 0.006],
    out: [0, 0, -1],
    height: 0.055,
    tone: 'hazard',
  });

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}

// ---------------------------------------------------------------------------------------------------------------
// generator — a skid-mounted diesel generator set: a base-frame fuel tank doubling as the skid, a subframe on
// rubber anti-vibration mounts carrying the engine (rocker cover, exhaust manifold, lagged silencer and stack),
// the radiator and fan guard at one end, the alternator and its terminal box at the other, a control panel with
// gauges facing the aisle, batteries, and a perimeter guard frame with lifting eyes and louvred acoustic panels.

const GENERATOR_PALETTES = [
  { body: C.steel, dark: C.steelDark },
  { body: C.oliveDark, dark: C.olive },
  { body: C.steelDark, dark: C.gunmetal },
  { body: C.pale, dark: C.paleDark },
];

export function buildGenerator(variant = 0) {
  const rng = makeRng(seedFor('generator', variant));
  const c = pick(GENERATOR_PALETTES, variant);
  const solid = [];
  const glow = [];
  const letters = [];

  // base-frame fuel tank: the skid itself is the tank, resting directly on the floor, with a filler, a sight
  // gauge and a drain valve, and a corrugated rib pattern on all four sides (a common pressed-tank finish)
  const tankHX = 1.44,
    tankHZ = 0.9,
    tankH = 0.46;
  solid.push(box(tankHX * 2, tankH, tankHZ * 2, c.dark, [0, tankH / 2, 0], undefined, sEnamel));
  solid.push(nub(2.92, 0.03, 1.84, c.dark, [0, 0.015, 0], undefined, sGalv)); // wider skid shoe flange, flush with the floor
  solid.push(...grid(1, 10, 0.015, 0.3, 0.07, 0, 0.16, c.dark, [tankHX - 0.012, tankH / 2, 0], sGalv, 'z'));
  solid.push(...grid(1, 10, 0.015, 0.3, 0.07, 0, 0.16, c.dark, [-tankHX + 0.012, tankH / 2, 0], sGalv, 'z'));
  solid.push(...grid(1, 16, 0.07, 0.3, 0.015, 0, 0.17, c.dark, [0, tankH / 2, tankHZ - 0.012], sGalv, 'x'));
  solid.push(...grid(1, 16, 0.07, 0.3, 0.015, 0, 0.17, c.dark, [0, tankH / 2, -tankHZ + 0.012], sGalv, 'x'));
  solid.push(cyl(0.05, 0.05, 0.03, c.dark, [1.0, tankH + 0.015, -0.55], undefined, 12, sSteel)); // filler neck
  solid.push(nub(0.07, 0.015, 0.07, c.dark, [1.0, tankH + 0.045, -0.55], undefined, sSteel)); // hinged lid, closed
  solid.push(cyl(0.014, 0.014, 0.012, C.gunmetal, [1.0, tankH + 0.06, -0.55], undefined, 8, sGun)); // lid handle boss
  solid.push(span([1.22, tankH - 0.32, -0.7], [1.22, tankH - 0.04, -0.7], 0.016, 0.016, C.glass, sGlass, 8)); // sight gauge
  solid.push(nub(0.03, 0.02, 0.03, c.dark, [1.22, tankH - 0.04, -0.7], undefined, sSteel));
  solid.push(nub(0.03, 0.02, 0.03, c.dark, [1.22, tankH - 0.36, -0.7], undefined, sSteel));
  solid.push(nub(0.045, 0.045, 0.045, C.gunmetal, [-1.2, 0.05, -0.7], undefined, sGun)); // drain valve body
  solid.push(cyl(0.026, 0.026, 0.03, C.gunmetal, [-1.2, 0.03, -0.64], [Math.PI / 2, 0, 0], 8, sGun)); // handwheel
  // two bolted inspection hatches on the tank's flat top, each on a raised collar plate
  for (const hp of [
    [-0.85, 0.4],
    [0.15, 0.4],
  ]) {
    solid.push(nub(0.26, 0.01, 0.26, c.dark, [hp[0], tankH + 0.005, hp[1]], undefined, sGalv));
    solid.push(boltRing(8, 0.11, 0.012, C.gunmetal, [hp[0], tankH + 0.011, hp[1]], undefined, sGun, 6));
  }

  // subframe on rubber anti-vibration mounts, carrying the engine/alternator skid
  const subTop = tankH + 0.05;
  solid.push(nub(2.86, 0.04, 1.78, c.dark, [0, tankH + 0.02, 0], undefined, sGalv));
  for (const mx of [-1.3, -0.3, 0.6, 1.3])
    for (const mz of [-0.72, 0.72])
      solid.push(nub(0.07, 0.04, 0.07, C.black, [mx, tankH + 0.02, mz], undefined, sRubber));

  // engine block with a rocker (valve) cover, cast-iron side ribs and a front pulley
  const engX = -0.45,
    engHX = 0.5,
    engHZ = 0.36,
    engY0 = subTop,
    engH = 0.5;
  solid.push(box(engHX * 2, engH, engHZ * 2, c.body, [engX, engY0 + engH / 2, 0], undefined, sPaint));
  solid.push(box(0.72, 0.13, 0.52, C.pale, [engX, engY0 + engH + 0.065, 0], undefined, sAlum)); // alloy rocker cover
  solid.push(boltRing(10, 0.3, 0.009, c.dark, [engX, engY0 + engH + 0.13, 0], undefined, sSteel, 5));
  for (const ez of [-1, 1])
    solid.push(
      ...grid(1, 9, 0.02, 0.3, 0.05, 0, 0.07, c.dark, [engX, engY0 + engH / 2, ez * (engHZ - 0.01)], sGun, 'x'),
    );
  solid.push(cyl(0.11, 0.11, 0.07, C.gunmetal, [engX - engHX - 0.03, engY0 + 0.2, 0], [0, 0, Math.PI / 2], 14, sGun)); // pulley boss
  // intake air filter canister on a bracket, clear of the rocker cover and manifold
  const afX = engX,
    afZ = -0.5,
    afBaseY = subTop + 0.5;
  solid.push(nub(0.05, 0.31, 0.05, c.dark, [afX, subTop + 0.155, afZ], undefined, sSteel)); // mounting bracket, foot to canister
  solid.push(cyl(0.16, 0.16, 0.38, C.pale, [afX, afBaseY, afZ], undefined, 14, sAlum)); // canister body
  solid.push(cyl(0.17, 0.17, 0.035, c.dark, [afX, afBaseY + 0.2, afZ], undefined, 14, sSteel)); // inlet cap
  solid.push(
    span([afX - 0.14, afBaseY - 0.1, afZ], [engX, engY0 + engH - 0.05, -engHZ + 0.04], 0.028, 0.028, C.pale, sAlum, 8),
  ); // outlet hose

  // radiator and fan guard, at the -X end, drawing air along the engine's axis
  const radX = -1.14;
  solid.push(box(0.12, 0.62, 0.84, c.dark, [radX, subTop + 0.36, 0], undefined, sGalv));
  solid.push(
    ...grid(
      1,
      13,
      0.016,
      0.54,
      0.04,
      0,
      0.062,
      C.black,
      [radX - 0.07, subTop + 0.36, 0],
      { ...sGun, bevel: false },
      'z',
    ),
  );
  solid.push(ring(0.32, 0.025, c.dark, [radX - 0.14, subTop + 0.36, 0], [0, 0, Math.PI / 2], 16, sGalv)); // fan guard rim
  solid.push(cyl(0.05, 0.05, 0.03, c.dark, [radX - 0.1, subTop + 0.36, 0], [0, 0, Math.PI / 2], 10, sGun)); // guard hub
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    solid.push(
      span(
        [radX - 0.08, subTop + 0.36, 0],
        [radX - 0.14, subTop + 0.36 + Math.sin(a) * 0.3, Math.cos(a) * 0.3],
        0.009,
        0.009,
        c.dark,
        sGalv,
        4,
      ),
    );
  }

  // exhaust manifold, lagged silencer and stack, routed up the engine's +Z (back) side
  const silY = subTop + 0.52,
    silZ = 0.55;
  solid.push(
    span([engX - 0.15, engY0 + engH - 0.05, engHZ], [engX - 0.3, silY, silZ], 0.045, 0.03, C.steelDark, sGun, 8),
  ); // manifold
  solid.push(cyl(0.1, 0.1, 0.52, C.pale, [engX - 0.1, silY, silZ], [0, 0, Math.PI / 2], 12, sAlum)); // lagged silencer shell
  solid.push(collarOn([engX - 0.36, silY, silZ], [engX + 0.16, silY, silZ], 0.3, 0.108, 0.03, c.dark, sSteel, 12));
  solid.push(collarOn([engX - 0.36, silY, silZ], [engX + 0.16, silY, silZ], 0.7, 0.108, 0.03, c.dark, sSteel, 12));
  const stackBaseY = silY + 0.1,
    stackX = engX - 0.0,
    stackTopY = 1.62;
  solid.push(span([stackX, stackBaseY, silZ], [stackX, stackTopY, silZ], 0.045, 0.045, C.steelDark, sGun, 10));
  solid.push(cyl(0.07, 0.07, 0.035, C.rust, [stackX, stackTopY + 0.03, silZ], undefined, 10, sRust)); // rain cap
  solid.push(nub(0.02, 0.025, 0.02, C.steelDark, [stackX, stackTopY - 0.02, silZ], undefined, sSteel)); // clamp band

  // alternator, coupled behind the engine, with a terminal box and cable entries
  const altX = 0.3;
  solid.push(cyl(0.22, 0.22, 0.46, c.dark, [altX, subTop + 0.28, 0], [0, 0, Math.PI / 2], 14, sGun));
  solid.push(ring(0.215, 0.5, C.black, [altX, subTop + 0.28, 0], [0, 0, Math.PI / 2], 14, { ...sGun, bevel: false })); // louvre band
  solid.push(box(0.22, 0.16, 0.16, c.dark, [altX, subTop + 0.28 + 0.22 + 0.08, 0.1], undefined, sGun)); // terminal box
  solid.push(nub(0.03, 0.03, 0.05, C.black, [altX - 0.08, subTop + 0.28 + 0.22 + 0.08, 0.18], undefined, sRubber));
  solid.push(nub(0.03, 0.03, 0.05, C.black, [altX + 0.08, subTop + 0.28 + 0.22 + 0.08, 0.18], undefined, sRubber));

  // control panel, facing the aisle (-Z), with two gauges, a row of breaker toggles and an E-stop
  const panelX = 1.05,
    panelZ = -0.74,
    panelY = subTop + 0.46;
  solid.push(box(0.46, 0.56, 0.07, c.dark, [panelX, panelY, panelZ], undefined, sGun));
  solid.push(
    ...gauge(0.07, [panelX - 0.12, panelY + 0.13, panelZ - 0.04], [-Math.PI / 2, 0, 0], C.black, C.yellow, 0.6, sSteel),
  );
  solid.push(
    ...gauge(
      0.07,
      [panelX + 0.12, panelY + 0.13, panelZ - 0.04],
      [-Math.PI / 2, 0, 0],
      C.black,
      C.yellow,
      -0.4,
      sSteel,
    ),
  );
  solid.push(...grid(1, 4, 0.03, 0.05, 0.015, 0, 0.1, C.gunmetal, [panelX, panelY - 0.1, panelZ - 0.042], sGun, 'x'));
  solid.push(cyl(0.012, 0.012, 0.03, C.gunmetal, [panelX - 0.17, panelY - 0.22, panelZ - 0.045], undefined, 8, sGun)); // e-stop stem
  solid.push(
    cyl(0.028, 0.028, 0.018, C.safetyRed, [panelX - 0.17, panelY - 0.22 + 0.024, panelZ - 0.045], undefined, 10, sPoly),
  );
  glow.push(nub(0.012, 0.012, 0.008, GLOW.ledGreen, [panelX + 0.17, panelY - 0.18, panelZ - 0.045], undefined, sLed));
  glow.push(nub(0.012, 0.012, 0.008, GLOW.ledAmber, [panelX + 0.17, panelY - 0.24, panelZ - 0.045], undefined, sLed));

  // battery box beside the engine, with two terminal posts and a hold-down strap, plus a second battery alongside
  solid.push(box(0.3, 0.2, 0.2, C.black, [-0.95, subTop + 0.1, -0.6], undefined, sPoly));
  solid.push(nub(0.3, 0.02, 0.2, c.dark, [-0.95, subTop + 0.21, -0.6], undefined, sSteel)); // hold-down strap
  solid.push(cyl(0.012, 0.012, 0.014, C.brassTone, [-1.03, subTop + 0.21, -0.6], undefined, 8, sBrass));
  solid.push(cyl(0.012, 0.012, 0.014, C.gunmetal, [-0.87, subTop + 0.21, -0.6], undefined, 8, sGun));
  solid.push(box(0.3, 0.2, 0.2, C.black, [-0.95, subTop + 0.1, -0.4], undefined, sPoly));
  solid.push(nub(0.3, 0.02, 0.2, c.dark, [-0.95, subTop + 0.21, -0.4], undefined, sSteel)); // hold-down strap
  solid.push(cyl(0.012, 0.012, 0.014, C.brassTone, [-1.03, subTop + 0.21, -0.4], undefined, 8, sBrass));
  solid.push(cyl(0.012, 0.012, 0.014, C.gunmetal, [-0.87, subTop + 0.21, -0.4], undefined, 8, sGun));

  // perimeter guard frame — four posts and top rails, lifting eyes at each corner, with louvred acoustic
  // panels filling the two long (±Z) faces between them
  const postX = 1.35,
    postZ = 0.74,
    postTop = subTop + 0.82;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      solid.push(
        span([sx * postX, subTop, sz * postZ], [sx * postX, postTop, sz * postZ], 0.028, 0.028, c.dark, sGalv, 8),
      );
      solid.push(ring(0.032, 0.016, c.dark, [sx * postX, postTop + 0.02, sz * postZ], [Math.PI / 2, 0, 0], 10, sSteel)); // lifting eye
    }
  solid.push(span([-postX, postTop, -postZ], [postX, postTop, -postZ], 0.024, 0.024, c.dark, sGalv, 8));
  solid.push(span([-postX, postTop, postZ], [postX, postTop, postZ], 0.024, 0.024, c.dark, sGalv, 8));
  solid.push(span([-postX, postTop, -postZ], [-postX, postTop, postZ], 0.024, 0.024, c.dark, sGalv, 8));
  solid.push(span([postX, postTop, -postZ], [postX, postTop, postZ], 0.024, 0.024, c.dark, sGalv, 8));
  for (const sz of [-1, 1]) {
    solid.push(
      box(
        postX * 2 - 0.1,
        postTop - subTop - 0.06,
        0.03,
        c.dark,
        [0, (subTop + postTop) / 2, sz * (postZ - 0.015)],
        undefined,
        sEnamel,
      ),
    );
    solid.push(
      ...grid(
        6,
        11,
        0.014,
        0.045,
        0.1,
        0.12,
        0.21,
        C.black,
        [0, (subTop + postTop) / 2, sz * (postZ - 0.015 - 0.016 * sz)],
        {
          ...sGun,
          bevel: false,
        },
        'x',
      ),
    );
  }

  // a small hazard tag, backed so it does not z-fight the tank skin, beside the filler neck
  solid.push(nub(0.14, 0.11, 0.012, C.black, [0.75, tankH + 0.08, -0.55 - 0.012], undefined, sPaint));
  solid.push(flatTriangle(0.1, 0.085, C.yellow, [0.75, tankH + 0.035, -0.55 - 0.019], [0, Math.PI, 0], sPaint));

  letters.push({
    text: `GEN-${String(rng.int(1, 2)).padStart(2, '0')}`,
    at: [panelX, panelY + 0.23, panelZ - 0.036],
    out: [0, 0, -1],
    height: 0.03,
    tone: 'white',
  });
  letters.push({
    text: MAKER,
    at: [0, tankH + 0.16, -tankHZ - 0.006],
    out: [0, 0, -1],
    height: 0.045,
    tone: 'white',
  });
  letters.push({
    text: 'DIESEL',
    at: [1.0, tankH + 0.1, -0.55 - 0.02],
    out: [0, 0, -1],
    height: 0.024,
    tone: 'orange',
  });
  letters.push({
    text: 'HOT SURFACE',
    at: [engX - 0.045, engY0 + engH - 0.12, engHZ + 0.005],
    out: [0, 0, 1],
    height: 0.022,
    tone: 'hazard',
  });

  return { solid: merge(solid), glow: glow.length ? merge(glow) : null, letters };
}
