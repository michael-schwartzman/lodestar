// WARDEN — the sentry, second look. Same rig as the old gfx/models.js builder (every pivot to the millimetre,
// so the walk/aim/stun/death animation in enemies/index.js still turns the right joint) but built as a real
// machine: pale armour panels over a dark steel frame, galvanised hinge pins at every joint, rubber cable looms
// and boot bellows, glass lenses, and its unit markings stencilled on in paint (gfx/next/lettering.js).
//
// 1.91 m tall, feet on y = 0, standing at the origin, facing -Z. Hips pivot at y = 0.98 (given); everything
// above is 0.93 m (waist 0.20 + torso 0.40 + head crown 0.33 -> top of the antenna mast clears 1.9-ish);
// everything below is the 0.94 m from hip joint to the floor, split 0.46 thigh / 0.48 shin, same as before.
import * as THREE from 'three';
import { lit, glow } from '../materials.js';
import { paint, place, box, cyl, ball, merge, sides, geoDetail } from '../geo.js';
import { Outline, extrude } from './extrude.js';
import { lettering } from './lettering.js';

// ---------------------------------------------------------------------------------------------------------------
// Palette: pale armour (two close tones, for panel variety) over a dark steel/gunmetal frame, one hazard-amber
// accent. Albedo stays mid-range so the key light and rim can still shade it at night (DESIGN.md 8.1/8.2).
const PALE = 0xd8d2c1; // main armour plate — warm off-white
const PALE2 = 0xc0b9a5; // secondary armour plate, a shade darker for panel-to-panel variety
const DARK = 0x2a2d31; // visible steel frame: the understructure the panels sit proud of
const GUN = 0x34383f; // gunmetal: weapon housing, sensor barrels, receiver
const GALV = 0xa7aca8; // bright galvanised hinge pins and collars
const ACCENT = 0xe0922e; // the one accent colour: hazard-amber paint, used sparingly
const CABLE = 0x191b1d; // rubber cable loom / bellows / sole
const LENS = 0x121a21; // dark glass lens
const SENSOR = 0xcf8a3a; // small amber glass sensor lens

// shade presets: every one of these names a real material (gfx/matter.js); a name not in that catalogue throws.
const sPaint = { mat: 'paint', rough: 0.52, metal: 0 };
const sSteel = { mat: 'steel', rough: 0.4, metal: 0.85 };
const sGun = { mat: 'gunmetal', rough: 0.3, metal: 0.82 };
const sGalv = { mat: 'galv', rough: 0.28, metal: 0.9 };
const sCable = { mat: 'rubber', rough: 0.92, metal: 0 };
const sGlass = { mat: 'glass', rough: 0.08, metal: 0 };

// ---------------------------------------------------------------------------------------------------------------
// Small helpers (on top of geo.js) used by more than one part below.
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

/** A painted cylinder whose own axis runs from `a` to `b` — cable runs, struts, actuator rods. */
function span(a, b, r1, r2, color, shade, segments = 8) {
  _p0.set(a[0], a[1], a[2]);
  _p1.set(b[0], b[1], b[2]);
  const len = Math.max(1e-4, _p0.distanceTo(_p1));
  _dir.subVectors(_p1, _p0).normalize();
  _quat.setFromUnitVectors(_up, _dir);
  _euler.setFromQuaternion(_quat);
  _mid.addVectors(_p0, _p1).multiplyScalar(0.5);
  return cyl(r1, r2, len, color, [_mid.x, _mid.y, _mid.z], [_euler.x, _euler.y, _euler.z], segments, shade);
}

/** A hinge pin: a cylinder lying on its side along X, poking out through a joint that only ever turns on X. */
function pinX(at, radius, length, color, shade, segments = 10) {
  return cyl(radius, radius, length, color, at, [0, 0, Math.PI / 2], segments, shade);
}

/** A thin open-ended ring — a collar, a bellows course, a muzzle band. Cheaper than a capped cylinder. */
function ring(radius, height, color, at, rot, segments, shade) {
  return place(paint(new THREE.CylinderGeometry(radius, radius, height, sides(segments), 1, true), color, shade), {
    at,
    rot,
  });
}

/** A rubber boot at a joint: a short stack of rings alternating wide/narrow, so it reads as pleated, not a tube. */
function bellows(cx, cy, cz, rWide, rNarrow, course, count) {
  const out = [];
  for (let i = 0; i < count; i++)
    out.push(
      ring(i % 2 === 0 ? rWide : rNarrow, course * 0.82, CABLE, [cx, cy - i * course, cz], undefined, 10, sCable),
    );
  return out;
}

/** A hydraulic actuator between two points: a barrel partway, a rod on to `b`, a collar ball over the seam. */
function actuator(a, b, rBarrel, rRod, reach = 0.55) {
  const mid = [a[0] + (b[0] - a[0]) * reach, a[1] + (b[1] - a[1]) * reach, a[2] + (b[2] - a[2]) * reach];
  return [
    span(a, mid, rBarrel, rBarrel * 0.8, DARK, sSteel, 8),
    span(mid, b, rRod, rRod, GALV, sGalv, 6),
    ball(rBarrel * 1.1, DARK, mid, 6, sSteel),
  ];
}

/** A small bolt head, proud of the surface it sits on — a real round fastener, not a flat-shaded box. */
function bolt(at, rot, color, shade, radius = 0.009) {
  return cyl(radius, radius, radius * 0.8, color, at, rot, 6, shade);
}

/** `n` evenly spaced bolts from `a` to `b` — a seam line along a panel edge. `rot` orients the row's own axis
 *  (default: lying flat against a -Z/+Z facing panel). Dropped on a phone: too fine to read at that distance. */
function boltRow(a, b, n, color, shade, rot = [Math.PI / 2, 0, 0], radius = 0.009) {
  if (!geoDetail.bevel) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    out.push(
      bolt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], rot, color, shade, radius),
    );
  }
  return out;
}

/** Small domed rivets proud of a panel face — like boltRow, too fine to read on a phone, so dropped there too. */
function rivets(points, color, shade, radius = 0.009) {
  if (!geoDetail.bevel) return [];
  return points.map((at) => ball(radius, color, at, 6, shade));
}

/** A recessed louvred vent facing -Z: a shadowed frame plus raised slats, so light catches real gaps. */
function vent(w, h, at, rot, slats = 4) {
  const parts = [box(w, h, 0.012, DARK, [0, 0, 0], undefined, { ...sSteel, bottom: 0.6, top: 0.9 })];
  const step = h / slats;
  for (let i = 0; i < slats; i++)
    parts.push(
      box(w - 0.01, step * 0.5, 0.014, GUN, [0, -h / 2 + step * (i + 0.5), -0.01], undefined, {
        ...sGun,
        bevel: false,
      }),
    );
  return place(merge(parts), { at, rot });
}

/** A curved armour-plate shell: a partial lathe revolve about the local Y axis (THREE.LatheGeometry, a partial
 *  `phiLength`), open over `arc` radians and centred on -Z — the limb's own front — instead of a flat proud
 *  plate. `profile` is a list of `[y, radius]` pairs, bottom to top (ascending y); a taper toward either joint
 *  is just a narrower radius at that end of the list. Open-edged (no caps): always placed proud of a core that
 *  fills the gap behind it, the same "panel proud of frame" language as the flat plates it replaces. */
function shell(profile, arc, color, at, rot, shade, segments = 14) {
  const pts = profile.map(([y, r]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, sides(segments), Math.PI - arc / 2, arc);
  return place(paint(geo, color, shade), { at, rot });
}

/** A flat panel with a chamfered, bevelled outline (an outline pushed out, with a small bevel: ./extrude.js)
 *  rather than a square-cornered box: `w`/`h` its outer size, `depth` how thick it stands, `cut` how much is
 *  chamfered off each corner, `bevel` the edge bevel size. Extrudes from its own z=0 toward +Z by `depth` then
 *  recentres on that axis, so `at`/`rot` place it exactly the way a box() of the same w/h/depth would. */
function panel(w, h, depth, cut, bevel, color, at, rot, shade, bevelSegments = 2) {
  const hw = w / 2;
  const hh = h / 2;
  const s = new Outline();
  s.moveTo(-hw + cut, -hh);
  s.lineTo(hw - cut, -hh);
  s.lineTo(hw, -hh + cut);
  s.lineTo(hw, hh - cut);
  s.lineTo(hw - cut, hh);
  s.lineTo(-hw + cut, hh);
  s.lineTo(-hw, hh - cut);
  s.lineTo(-hw, -hh + cut);
  const geo = extrude(s, {
    depth,
    bevelEnabled: !!bevel,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return place(paint(geo, color, shade), { at, rot });
}

/** A rounded dome cap — a shallow closed lathe revolve — for knee caps, pauldrons and the head's crown: `profile`
 *  a list of `[y, radius]` pairs, bottom (rim) to top (pole), the last one normally `[y, 0]` to close the tip. */
function dome(profile, color, at, rot, shade, segments = 14) {
  const pts = profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 1e-5), y));
  return place(paint(new THREE.LatheGeometry(pts, sides(segments)), color, shade), { at, rot });
}

// ===================================================================================================================
/** A two-legged guard machine: `{ root, parts: { hips, torso, head, armL, armR, legL, legR, shinL, shinR, eye, muzzle } }`. */
export function buildSentry() {
  const matLit = lit({ vertexColors: true, rim: 0.5 });
  const matEye = glow({ color: 0x8fe8ff, intensity: 1.5 });

  // --- hips: pivot at the pelvis (y = 0.98 world, (0,0,0) local). Hip joints sit at the hinge pins, exactly
  // where legL/legR are mounted, so the leg visually plugs into the pin.
  const hipsGeo = merge([
    box(0.34, 0.22, 0.26, DARK, [0, 0.01, 0], undefined, { ...sSteel, bottom: 0.72, top: 1 }), // frame
    panel(0.29, 0.16, 0.034, 0.022, 0.006, PALE, [0, 0.03, -0.149], undefined, sPaint), // proud pelvis plate, a chamfered casting
    ...bellows(0, 0.205, 0, 0.145, 0.122, 0.027, 3), // waist bellows, the flexible joint between pelvis and chest
    box(0.26, 0.055, 0.03, PALE2, [0, -0.07, -0.146], undefined, sPaint), // lower apron plate, a seam below the main one
    box(0.1, 0.19, 0.24, DARK, [0.2, 0, 0], undefined, sSteel),
    box(0.1, 0.19, 0.24, DARK, [-0.2, 0, 0], undefined, sSteel),
    box(0.088, 0.175, 0.02, PALE, [0.2, 0.005, -0.132], undefined, sPaint), // proud hip cap R
    box(0.088, 0.175, 0.02, PALE, [-0.2, 0.005, -0.132], undefined, sPaint), // proud hip cap L
    box(0.36, 0.028, 0.022, ACCENT, [0, -0.1, -0.138], undefined, sPaint), // hazard belt stripe
    box(0.07, 0.085, 0.018, PALE2, [0.205, -0.115, -0.1], undefined, sPaint), // hip skirt lip R, below the belt stripe
    box(0.07, 0.085, 0.018, PALE2, [-0.205, -0.115, -0.1], undefined, sPaint), // hip skirt lip L
    box(0.015, 0.14, 0.022, DARK, [0.165, 0.03, -0.14], undefined, sSteel), // hip side frame strip R, in the panel gap
    box(0.015, 0.14, 0.022, DARK, [-0.165, 0.03, -0.14], undefined, sSteel), // hip side frame strip L
    box(0.05, 0.03, 0.012, PALE2, [0, -0.02, -0.162], undefined, sPaint), // pelvis centre trim strip
    box(0.26, 0.08, 0.03, PALE2, [0, 0, 0.148], undefined, sPaint), // rear pelvis plate
    box(0.1, 0.06, 0.04, DARK, [0, -0.04, 0.158], undefined, sSteel), // rear equipment nub, proud on the rear plate
    vent(0.045, 0.065, [0.2, -0.04, -0.125], [0, -0.1, 0], 3), // hip side vent R
    vent(0.045, 0.065, [-0.2, -0.04, -0.125], [0, 0.1, 0], 3), // hip side vent L
    span([0.08, -0.03, 0.163], [0.08, 0.05, 0.163], 0.008, 0.008, DARK, sSteel, 8), // rear plate conduit R
    span([-0.08, -0.03, 0.163], [-0.08, 0.05, 0.163], 0.008, 0.008, DARK, sSteel, 8), // rear plate conduit L
    pinX([0.19, -0.04, 0], 0.05, 0.26, GALV, sGalv, 10), // hip hinge pin R, exactly on the leg's pivot
    pinX([-0.19, -0.04, 0], 0.05, 0.26, GALV, sGalv, 10), // hip hinge pin L
    cyl(0.056, 0.056, 0.026, DARK, [0.19, -0.04, 0], [0, 0, Math.PI / 2], 10, sSteel), // pin collar R, a sleeve around the hinge, capped so it doesn't read as a stray sliver edge-on
    cyl(0.056, 0.056, 0.026, DARK, [-0.19, -0.04, 0], [0, 0, Math.PI / 2], 10, sSteel), // pin collar L
    ...actuator([0.22, 0.095, -0.1], [0.225, -0.035, -0.09], 0.024, 0.013), // hip actuator R
    ...actuator([-0.22, 0.095, -0.1], [-0.225, -0.035, -0.09], 0.024, 0.013), // hip actuator L
    ...boltRow([0.15, 0.09, -0.142], [0.15, -0.02, -0.142], 2, DARK, sSteel),
    ...boltRow([-0.15, 0.09, -0.142], [-0.15, -0.02, -0.142], 2, DARK, sSteel),
    ...boltRow([-0.12, -0.065, -0.145], [0.12, -0.065, -0.145], 3, DARK, sSteel),
    ...boltRow([0.1, 0.0, 0.164], [-0.1, 0.0, 0.164], 3, DARK, sSteel), // rear plate seam
    ...boltRow([0.17, -0.1, -0.09], [0.17, 0.08, -0.09], 2, DARK, sSteel, [0, Math.PI / 2, 0]), // side strip seam R
    ...boltRow([-0.17, -0.1, -0.09], [-0.17, 0.08, -0.09], 2, DARK, sSteel, [0, Math.PI / 2, 0]), // side strip seam L
    ...rivets(
      [
        [0.09, 0, 0.164],
        [-0.09, 0, 0.164],
      ],
      DARK,
      sSteel,
    ), // rear pelvis plate rivets
  ]);
  const hips = new THREE.Mesh(hipsGeo, matLit);
  hips.position.set(0, 0.98, 0);

  // --- legs (thighs): pivot at the hip pin, hanging to the knee at local y = -0.46.
  function buildThigh() {
    return merge([
      box(0.18, 0.27, 0.2, DARK, [0, -0.135, 0], undefined, { ...sSteel, bottom: 0.8, top: 1 }), // thigh core
      shell(
        [
          [-0.255, 0.112],
          [-0.2, 0.135],
          [-0.09, 0.14],
          [-0.02, 0.113],
        ],
        2.15,
        PALE,
        [0, 0, 0],
        undefined,
        sPaint,
        12,
      ), // curved thigh plate, a lathed half-shell proud of the core, tapering toward hip and knee
      box(0.158, 0.022, 0.03, PALE2, [0, -0.1, -0.135], undefined, sPaint), // thigh plate seam band, breaking the shell into two panels
      box(0.026, 0.02, 0.17, ACCENT, [0, -0.05, 0], undefined, { ...sPaint, bevel: false }), // knee-cap accent trim
      box(0.15, 0.2, 0.17, DARK, [0, -0.36, 0], undefined, { ...sSteel, bottom: 0.75, top: 1 }), // knee block
      dome(
        [
          [0, 0.048],
          [0.012, 0.043],
          [0.026, 0.03],
          [0.034, 0],
        ],
        PALE,
        [0, -0.345, -0.072],
        [-Math.PI / 2, 0, 0],
        sPaint,
        12,
      ), // rounded knee cap, a small domed lathe proud of the knee block
      box(0.028, 0.14, 0.022, DARK, [0.085, -0.355, -0.06], undefined, sSteel), // knee side plate trim R
      box(0.028, 0.14, 0.022, DARK, [-0.085, -0.355, -0.06], undefined, sSteel), // knee side plate trim L
      box(0.13, 0.17, 0.028, PALE2, [0, -0.14, 0.108], undefined, sPaint), // thigh rear plate
      box(0.03, 0.03, 0.022, GALV, [0.055, -0.21, -0.14], undefined, sGalv), // cable clamp, hip-to-knee cable, proud of the plate
      box(0.024, 0.024, 0.02, GALV, [0, -0.42, 0.138], undefined, sGalv), // rear cable clip, knee-to-ankle run
      span([0, -0.23, 0.128], [0, -0.42, 0.138], 0.01, 0.01, CABLE, sCable, 6), // rear cable loom, visible from behind
      vent(0.045, 0.1, [0.098, -0.17, -0.03], [0, -0.5, 0], 3), // thigh side vent R, at the plate/core edge
      pinX([0, -0.46, 0], 0.044, 0.3, GALV, sGalv, 10), // knee hinge pin, on the shin's pivot
      cyl(0.05, 0.05, 0.016, GALV, [0.141, -0.46, 0], [0, 0, Math.PI / 2], 10, sGalv), // knee pin collar R, retaining the pin at its visible end
      cyl(0.05, 0.05, 0.016, GALV, [-0.141, -0.46, 0], [0, 0, Math.PI / 2], 10, sGalv), // knee pin collar L
      ...actuator([0.088, -0.07, -0.058], [0.07, -0.4, -0.082], 0.02, 0.012), // knee actuator
      span([0.04, -0.21, -0.08], [0.035, -0.35, -0.08], 0.01, 0.01, CABLE, sCable, 6), // hip-to-knee cable
      ...boltRow([0.06, -0.02, -0.11], [-0.06, -0.02, -0.11], 2, DARK, sSteel),
      ...boltRow([0.06, -0.22, -0.085], [-0.06, -0.22, -0.085], 2, DARK, sSteel), // lower plate seam
      ...rivets(
        [
          [0.055, -0.1, -0.112],
          [-0.055, -0.1, -0.112],
        ],
        DARK,
        sSteel,
      ), // thigh plate rivets
    ]);
  }
  const legL = new THREE.Mesh(buildThigh(), matLit);
  const legR = new THREE.Mesh(buildThigh(), matLit);
  legL.position.set(-0.19, -0.04, 0); // anatomical left/right: +X is this character's right (see armL/armR below)
  legR.position.set(0.19, -0.04, 0);

  // --- shins: pivot at the knee (local 0,0,0), hanging to the floor at local y = -0.48; the foot is built in.
  function buildShin() {
    return merge([
      box(0.17, 0.22, 0.19, DARK, [0, -0.11, 0], undefined, { ...sSteel, bottom: 0.7, top: 1 }), // calf core
      shell(
        [
          [-0.195, 0.1],
          [-0.135, 0.12],
          [-0.05, 0.124],
          [-0.012, 0.1],
        ],
        2.05,
        PALE,
        [0, 0, 0],
        undefined,
        sPaint,
        12,
      ), // curved calf plate, a lathed half-shell proud of the core, tapering toward knee and ankle
      box(0.14, 0.02, 0.026, PALE2, [0, -0.085, -0.12], undefined, sPaint), // calf plate seam band, breaking the shell into two panels
      vent(0.07, 0.09, [0.092, -0.14, -0.04], [0, -0.5, 0], 3), // calf side vent R, at the plate/core edge
      box(0.15, 0.17, 0.165, DARK, [0, -0.305, 0], undefined, { ...sSteel, bottom: 0.65, top: 1 }), // ankle block
      box(0.118, 0.085, 0.018, PALE2, [0, -0.275, -0.09], undefined, sPaint), // ankle guard, proud
      box(0.09, 0.03, 0.016, PALE2, [0, -0.35, -0.087], undefined, sPaint), // second ankle plate insert, lower seam
      ...boltRow([0.055, -0.06, -0.12], [-0.055, -0.06, -0.12], 2, DARK, sSteel),
      ...boltRow([0.05, -0.33, -0.1], [-0.05, -0.33, -0.1], 2, DARK, sSteel), // ankle lower seam
      pinX([0, -0.4, 0], 0.034, 0.24, GALV, sGalv, 10), // ankle hinge pin, a universal joint with the foot
      cyl(0.038, 0.038, 0.014, GALV, [0.112, -0.4, 0], [0, 0, Math.PI / 2], 8, sGalv), // ankle pin collar R
      cyl(0.038, 0.038, 0.014, GALV, [-0.112, -0.4, 0], [0, 0, Math.PI / 2], 8, sGalv), // ankle pin collar L
      ...bellows(0, -0.391, 0, 0.078, 0.065, 0.013, 3), // ankle bellows, hiding the block/foot seam
      ...actuator([0.062, -0.15, -0.05], [0.052, -0.37, -0.083], 0.016, 0.01), // ankle actuator
      span([0.035, -0.16, -0.075], [0.03, -0.3, -0.08], 0.009, 0.009, CABLE, sCable, 6), // knee-to-ankle cable
      box(0.16, 0.075, 0.3, DARK, [0, -0.445, -0.07], undefined, { ...sSteel, bottom: 0.6, top: 0.9 }), // foot core
      box(0.13, 0.05, 0.065, PALE, [0, -0.455, -0.25], [0.18, 0, 0], sPaint), // chamfered toe, proud
      box(0.11, 0.022, 0.05, PALE2, [0, -0.452, -0.262], [0.18, 0, 0], sPaint), // toe cap overlay guard, proud of the toe
      box(0.1, 0.028, 0.115, DARK, [0, -0.45, 0.065], undefined, { ...sSteel, bottom: 0.55, top: 0.85 }), // heel guard
      box(0.172, 0.018, 0.33, CABLE, [0, -0.476, -0.06], undefined, sCable), // rubber sole, sprung: the compliant layer between foot and ground
      box(0.1, 0.012, 0.08, CABLE, [0, -0.481, -0.235], undefined, { ...sCable, bevel: false }), // toe rubber pad, proud of the sole
      box(0.085, 0.012, 0.09, CABLE, [0, -0.481, 0.06], undefined, { ...sCable, bevel: false }), // heel rubber pad, proud of the sole
      box(0.14, 0.008, 0.014, DARK, [0, -0.482, -0.19], undefined, sSteel), // tread ridge
      box(0.14, 0.008, 0.014, DARK, [0, -0.482, -0.138], undefined, sSteel), // tread ridge
      box(0.14, 0.008, 0.014, DARK, [0, -0.482, -0.086], undefined, sSteel), // tread ridge
      box(0.14, 0.008, 0.014, DARK, [0, -0.482, -0.034], undefined, sSteel), // tread ridge
      box(0.14, 0.008, 0.014, DARK, [0, -0.482, 0.018], undefined, sSteel), // tread ridge
      box(0.14, 0.008, 0.014, DARK, [0, -0.482, 0.07], undefined, sSteel), // tread ridge
    ]);
  }
  const shinL = new THREE.Mesh(buildShin(), matLit);
  const shinR = new THREE.Mesh(buildShin(), matLit);
  shinL.position.set(0, -0.46, 0);
  shinR.position.set(0, -0.46, 0);

  // --- torso: pivot at the waist (local 0,0,0, hips-local y = +0.20 -> world 1.18). Narrow waist, wide shoulders.
  const torsoGeo = merge([
    box(0.3, 0.17, 0.22, DARK, [0, 0.085, 0], undefined, { ...sSteel, bottom: 0.78, top: 1 }), // waist
    box(0.255, 0.125, 0.025, PALE2, [0, 0.1, -0.121], undefined, sPaint), // proud waist plate
    box(0.26, 0.04, 0.02, PALE2, [0, 0.03, -0.126], undefined, sPaint), // waist front skirt lip, below the plate
    box(0.045, 0.1, 0.03, PALE2, [0.16, 0.0, -0.06], [0, 0, -0.12], sPaint), // waist skirt flare R
    box(0.045, 0.1, 0.03, PALE2, [-0.16, 0.0, -0.06], [0, 0, 0.12], sPaint), // waist skirt flare L
    box(0.06, 0.08, 0.05, DARK, [0.2, -0.02, 0.05], undefined, sSteel), // tool pouch, waist R
    box(0.05, 0.015, 0.012, GALV, [0.2, 0.015, 0.075], undefined, sGalv), // tool pouch strap
    box(0.52, 0.24, 0.27, DARK, [0, 0.28, 0], undefined, sSteel), // chest frame
    panel(0.146, 0.19, 0.026, 0.016, 0.005, PALE, [0.076, 0.295, -0.14], [0, -0.05, 0], sPaint), // chest plate R half, angled back from the centre crease
    panel(0.146, 0.19, 0.026, 0.016, 0.005, PALE, [-0.076, 0.295, -0.14], [0, 0.05, 0], sPaint), // chest plate L half, angled back from the centre crease
    box(0.016, 0.185, 0.02, DARK, [0, 0.295, -0.146], undefined, sSteel), // chest crease spine, the seam between the two plate halves
    box(0.3, 0.012, 0.03, ACCENT, [0, 0.385, -0.147], undefined, sPaint), // chest plate top trim, the one accent on the torso
    box(0.02, 0.17, 0.014, DARK, [0.125, 0.295, -0.158], undefined, sSteel), // chest panel line R, flanks the marking
    box(0.02, 0.17, 0.014, DARK, [-0.125, 0.295, -0.158], undefined, sSteel), // chest panel line L
    box(0.17, 0.2, 0.025, PALE2, [0.17, 0.28, -0.1475], undefined, sPaint), // chest side plate R
    box(0.17, 0.2, 0.025, PALE2, [-0.17, 0.28, -0.1475], undefined, sPaint), // chest side plate L
    box(0.03, 0.05, 0.02, DARK, [0.185, 0.175, -0.17], [0.2, 0, 0], sSteel), // chest lower corner bracket R
    box(0.03, 0.05, 0.02, DARK, [-0.185, 0.175, -0.17], [-0.2, 0, 0], sSteel), // chest lower corner bracket L
    vent(0.06, 0.07, [0.09, 0.22, -0.145], [0, -0.2, 0], 3), // chest side vent R, below the shoulder
    vent(0.06, 0.07, [-0.09, 0.22, -0.145], [0, 0.2, 0], 3), // chest side vent L
    box(0.15, 0.13, 0.23, DARK, [0.33, 0.33, 0], undefined, sSteel), // shoulder pod R (+X is this character's right)
    box(0.04, 0.08, 0.02, DARK, [0.25, 0.33, -0.14], undefined, sSteel), // frame/shoulder seam plate R, proud
    box(0.12, 0.1, 0.022, PALE, [0.33, 0.33, -0.122], undefined, sPaint), // shoulder cap R, proud (carries the shoulder marking)
    dome(
      [
        [0, 0.068],
        [0.018, 0.058],
        [0.038, 0.034],
        [0.052, 0],
      ],
      PALE,
      [0.33, 0.396, -0.01],
      undefined,
      sPaint,
      12,
    ), // pauldron cap R, domed over the shoulder pod
    box(0.1, 0.018, 0.09, ACCENT, [0.33, 0.385, -0.09], undefined, sPaint), // shoulder hazard band R
    cyl(0.058, 0.058, 0.03, DARK, [0.33, 0.27, 0], [0, 0, Math.PI / 2], 10, sSteel), // shoulder housing collar R, capped
    pinX([0.33, 0.27, 0], 0.03, 0.3, GALV, sGalv, 10), // shoulder hinge pin R, through the housing
    box(0.15, 0.13, 0.23, DARK, [-0.33, 0.33, 0], undefined, sSteel), // shoulder pod L
    box(0.04, 0.08, 0.02, DARK, [-0.25, 0.33, -0.14], undefined, sSteel), // frame/shoulder seam plate L, proud
    box(0.12, 0.1, 0.022, PALE, [-0.33, 0.33, -0.122], undefined, sPaint), // shoulder cap L, proud
    dome(
      [
        [0, 0.068],
        [0.018, 0.058],
        [0.038, 0.034],
        [0.052, 0],
      ],
      PALE,
      [-0.33, 0.396, -0.01],
      undefined,
      sPaint,
      12,
    ), // pauldron cap L, domed over the shoulder pod
    box(0.1, 0.018, 0.09, ACCENT, [-0.33, 0.385, -0.09], undefined, sPaint), // shoulder hazard band L
    cyl(0.058, 0.058, 0.03, DARK, [-0.33, 0.27, 0], [0, 0, Math.PI / 2], 10, sSteel), // shoulder housing collar L, capped
    pinX([-0.33, 0.27, 0], 0.03, 0.3, GALV, sGalv, 10), // shoulder hinge pin L
    box(0.045, 0.14, 0.03, DARK, [0, 0.33, -0.142], undefined, sSteel), // chest spine seam
    box(0.2, 0.012, 0.1, GUN, [0, 0.405, -0.02], undefined, sGun), // collar mounting plate, atop the chest frame
    cyl(0.067, 0.078, 0.08, DARK, [0, 0.41, 0], undefined, 10, sSteel), // neck stub
    ring(0.082, 0.022, GALV, [0, 0.365, 0], undefined, 12, sGalv), // neck gimbal collar ring
    cyl(0.016, 0.016, 0.034, GALV, [0.082, 0.365, 0], [0, 0, Math.PI / 2], 8, sGalv), // gimbal pivot pin R, through the collar
    cyl(0.016, 0.016, 0.034, GALV, [-0.082, 0.365, 0], [0, 0, Math.PI / 2], 8, sGalv), // gimbal pivot pin L
    // back: battery pack + cooling fins + vents + a carry handle
    box(0.26, 0.22, 0.12, DARK, [0, 0.26, 0.19], undefined, sSteel),
    box(0.21, 0.02, 0.028, GUN, [0, 0.35, 0.265], undefined, sGun),
    box(0.21, 0.02, 0.028, GUN, [0, 0.315, 0.27], undefined, sGun),
    box(0.21, 0.02, 0.028, GUN, [0, 0.28, 0.27], undefined, sGun),
    box(0.21, 0.02, 0.028, GUN, [0, 0.245, 0.27], undefined, sGun),
    box(0.21, 0.02, 0.028, GUN, [0, 0.21, 0.27], undefined, sGun),
    box(0.21, 0.02, 0.028, GUN, [0, 0.175, 0.265], undefined, sGun),
    vent(0.08, 0.1, [0.14, 0.24, 0.185], [0, Math.PI / 2, 0], 3), // battery side vent R
    vent(0.08, 0.1, [-0.14, 0.24, 0.185], [0, -Math.PI / 2, 0], 3), // battery side vent L
    panel(0.14, 0.1, 0.014, 0.01, 0.003, GUN, [0, 0.2, 0.254], undefined, sGun), // battery access hatch, proud of the rear face
    bolt([0.055, 0.235, 0.259], [Math.PI / 2, 0, 0], DARK, sSteel, 0.009), // hatch quarter-turn fastener, top R
    bolt([-0.055, 0.235, 0.259], [Math.PI / 2, 0, 0], DARK, sSteel, 0.009), // hatch quarter-turn fastener, top L
    bolt([0.055, 0.165, 0.259], [Math.PI / 2, 0, 0], DARK, sSteel, 0.009), // hatch quarter-turn fastener, bottom R
    bolt([-0.055, 0.165, 0.259], [Math.PI / 2, 0, 0], DARK, sSteel, 0.009), // hatch quarter-turn fastener, bottom L
    span([-0.06, 0.37, 0.2], [0.06, 0.37, 0.2], 0.012, 0.012, DARK, sSteel, 6), // carry-handle crossbar
    span([-0.06, 0.345, 0.2], [-0.06, 0.37, 0.2], 0.012, 0.012, DARK, sSteel, 6), // handle upright L
    span([0.06, 0.345, 0.2], [0.06, 0.37, 0.2], 0.012, 0.012, DARK, sSteel, 6), // handle upright R
    box(0.025, 0.025, 0.02, DARK, [-0.07, 0.345, 0.195], undefined, sSteel), // handle base gusset L
    box(0.025, 0.025, 0.02, DARK, [0.07, 0.345, 0.195], undefined, sSteel), // handle base gusset R
    // cable loom from the battery pack down to the waist, and out to each shoulder
    span([0.09, 0.18, 0.24], [0.06, 0.1, 0.1], 0.011, 0.011, CABLE, sCable, 6),
    span([-0.09, 0.18, 0.24], [-0.06, 0.1, 0.1], 0.011, 0.011, CABLE, sCable, 6),
    span([0.1, 0.33, 0.1], [0.3, 0.3, 0.04], 0.01, 0.01, CABLE, sCable, 6),
    span([-0.1, 0.33, 0.1], [-0.3, 0.3, 0.04], 0.01, 0.01, CABLE, sCable, 6),
    // louvred side vents, waist
    vent(0.05, 0.13, [0.261, 0.185, 0], [0, Math.PI / 2, 0], 4),
    vent(0.05, 0.13, [-0.261, 0.185, 0], [0, -Math.PI / 2, 0], 4),
    // small pale warning labels
    box(0.045, 0.028, 0.008, PALE2, [0.17, 0.28, -0.162], undefined, { ...sPaint, bevel: false }),
    box(0.045, 0.028, 0.008, PALE2, [0, 0.08, 0.112], undefined, { ...sPaint, bevel: false }),
    ...boltRow([0.13, 0.37, -0.108], [0.13, 0.21, -0.108], 3, DARK, sSteel),
    ...boltRow([-0.13, 0.37, -0.108], [-0.13, 0.21, -0.108], 3, DARK, sSteel),
    ...boltRow([-0.11, 0.095, -0.132], [0.11, 0.095, -0.132], 3, DARK, sSteel),
    ...boltRow([0.14, 0.02, -0.08], [0.14, -0.015, -0.03], 2, DARK, sSteel), // waist skirt seam R
    ...boltRow([-0.14, 0.02, -0.08], [-0.14, -0.015, -0.03], 2, DARK, sSteel), // waist skirt seam L
    ...boltRow([0.17, 0.225, -0.175], [0.2, 0.15, -0.175], 2, DARK, sSteel), // chest corner bracket seam R
    ...boltRow([-0.17, 0.225, -0.175], [-0.2, 0.15, -0.175], 2, DARK, sSteel), // chest corner bracket seam L
    ...rivets(
      [
        [0.22, 0.36, -0.161],
        [0.22, 0.2, -0.161],
        [-0.22, 0.36, -0.161],
        [-0.22, 0.2, -0.161],
      ],
      DARK,
      sSteel,
    ), // chest side plate rivets
    ...rivets(
      [
        [0.1, 0.1, -0.134],
        [-0.1, 0.1, -0.134],
      ],
      DARK,
      sSteel,
    ), // waist plate rivets
  ]);
  const torso = new THREE.Mesh(torsoGeo, matLit);
  torso.position.set(0, 0.2, 0);

  // the unit's markings: painted on, a hair off each surface, so they move with the part they are stencilled on
  // lettering faces +Z as made (see lettering.js); front-facing plates look toward -Z so they need the 180° turn,
  // the back plate already looks toward +Z so it takes none.
  torso.add(lettering('WARDEN', { height: 0.05, tone: 'black', at: [0, 0.3, -0.162], rot: [0, Math.PI, 0] }));
  torso.add(lettering('S-9', { height: 0.045, tone: 'black', at: [0.33, 0.335, -0.134], rot: [0, Math.PI, 0] }));
  torso.add(lettering('SVC-9', { height: 0.028, tone: 'hazard', at: [0, 0.335, 0.251], rot: [0, 0, 0] }));
  torso.add(lettering('CAUTION', { height: 0.02, tone: 'hazard', at: [0, 0.08, 0.118], rot: [0, 0, 0] })); // small hazard label, low on the back plate

  // --- head: pivot at the neck (local 0,0,0, torso-local y = +0.40 -> world 1.58). A sensor housing with a visor.
  const headGeo = merge([
    box(0.21, 0.24, 0.23, DARK, [0, 0.14, 0], undefined, sSteel), // housing frame
    box(0.185, 0.2, 0.025, PALE, [0, 0.145, -0.113], undefined, sPaint), // proud face plate
    dome(
      [
        [0, 0.097],
        [0.025, 0.093],
        [0.055, 0.058],
        [0.078, 0],
      ],
      PALE2,
      [0, 0.257, 0],
      undefined,
      sPaint,
      14,
    ), // rounded crown dome, proud of the housing frame
    box(0.22, 0.05, 0.02, DARK, [0, 0.16, -0.122], undefined, sSteel), // visor recess frame
    box(0.185, 0.026, 0.01, PALE2, [0, 0.19, -0.126], undefined, sPaint), // brow ridge, proud over the visor
    cyl(0.034, 0.034, 0.05, GUN, [0.105, 0.163, -0.06], [Math.PI / 2, 0, 0], 10, sGun), // R lens barrel, the larger of the pair
    cyl(0.024, 0.024, 0.013, LENS, [0.105, 0.163, -0.087], [Math.PI / 2, 0, 0], 10, sGlass), // R lens glass
    cyl(0.023, 0.023, 0.038, GUN, [-0.105, 0.167, -0.052], [Math.PI / 2, 0, 0], 10, sGun), // L lens barrel, the smaller rangefinder lens
    cyl(0.016, 0.016, 0.011, LENS, [-0.105, 0.167, -0.072], [Math.PI / 2, 0, 0], 10, sGlass), // L lens glass
    box(0.032, 0.05, 0.055, GUN, [0.108, 0.14, 0.01], undefined, sGun), // R ear sensor pod
    box(0.032, 0.05, 0.055, GUN, [-0.108, 0.14, 0.01], undefined, sGun), // L ear sensor pod
    ball(0.01, SENSOR, [0.108, 0.14, 0.038], 6, sGlass), // R ear lens
    ball(0.01, SENSOR, [-0.108, 0.14, 0.038], 6, sGlass), // L ear lens
    vent(0.04, 0.065, [0.098, 0.085, -0.058], [0, -0.45, 0], 3), // R cheek vent
    vent(0.04, 0.065, [-0.098, 0.085, -0.058], [0, 0.45, 0], 3), // L cheek vent
    box(0.165, 0.045, 0.02, DARK, [0, 0.06, -0.113], undefined, { ...sSteel, bottom: 0.7, top: 0.9 }), // chin vent frame
    box(0.185, 0.022, 0.011, PALE2, [0, 0.038, -0.117], undefined, sPaint), // jaw guard, proud
    box(0.13, 0.036, 0.014, DARK, [0, 0.24, 0.11], undefined, sSteel), // rear vent
    ...boltRow([0.09, 0.135, -0.13], [-0.09, 0.135, -0.13], 3, DARK, sSteel), // visor recess seam
    // antenna, a short stub off the crown — tall enough to read, not tall enough to break the silhouette height
    cyl(0.012, 0.015, 0.03, DARK, [0, 0.325, 0.03], undefined, 8, sSteel),
    span([0, 0.34, 0.025], [0.018, 0.37, -0.005], 0.005, 0.003, DARK, sSteel, 6),
    ring(0.0075, 0.01, GALV, [0.0075, 0.353, 0.011], [0.2, 0, 0], 8, sGalv),
    ball(0.008, ACCENT, [0.019, 0.378, -0.008], 6, sPaint),
    // a second, shorter antenna stub off the other side of the crown
    cyl(0.008, 0.01, 0.018, DARK, [-0.05, 0.3, 0.06], undefined, 8, sSteel),
    span([-0.05, 0.309, 0.06], [-0.058, 0.325, 0.048], 0.004, 0.002, DARK, sSteel, 6),
  ]);
  const head = new THREE.Mesh(headGeo, matLit);
  head.position.set(0, 0.4, 0);

  // eye: one mesh, its own glow material; must protrude past the recess frame's front face or it hides it.
  const eye = new THREE.Mesh(box(0.175, 0.032, 0.012, 0xffffff, [0, 0.16, -0.132]), matEye);
  head.add(eye);

  // --- left arm: three-finger clamp. Hangs straight down from the shoulder so rotation.x swings it forward.
  const armLGeo = merge([
    box(0.145, 0.29, 0.15, DARK, [0, -0.145, 0], undefined, { ...sSteel, bottom: 0.82, top: 1 }), // upper arm
    shell(
      [
        [-0.26, 0.082],
        [-0.2, 0.095],
        [-0.09, 0.098],
        [-0.03, 0.082],
      ],
      2.0,
      PALE,
      [0, 0, 0],
      undefined,
      sPaint,
      12,
    ), // curved upper-arm plate, a lathed half-shell proud of the core
    box(0.04, 0.05, 0.03, DARK, [0, 0.015, -0.04], [0.25, 0, 0], sSteel), // shoulder root bracket
    span([-0.05, -0.02, -0.03], [0.05, -0.02, -0.03], 0.01, 0.01, CABLE, sCable, 6), // shoulder cable bridge
    ...actuator([0.062, -0.02, -0.04], [0.058, -0.27, -0.062], 0.02, 0.012), // bicep actuator
    pinX([0, -0.3, 0], 0.046, 0.175, GALV, sGalv, 10), // elbow hinge pin
    cyl(0.052, 0.052, 0.018, DARK, [0, -0.3, 0.095], [0, 0, Math.PI / 2], 10, sSteel), // capped
    box(0.13, 0.26, 0.14, DARK, [0, -0.43, 0], undefined, { ...sSteel, bottom: 0.78, top: 1 }), // forearm
    shell(
      [
        [-0.555, 0.078],
        [-0.48, 0.088],
        [-0.38, 0.09],
        [-0.305, 0.075],
      ],
      1.9,
      PALE,
      [0, 0, 0],
      undefined,
      sPaint,
      12,
    ), // curved forearm plate, a lathed half-shell proud of the core
    box(0.082, 0.085, 0.016, PALE2, [0, -0.5, -0.086], undefined, sPaint), // forearm guard, second inset
    ...boltRow([0.048, -0.33, -0.095], [0.048, -0.5, -0.095], 3, DARK, sSteel),
    ...boltRow([-0.045, -0.35, -0.085], [-0.045, -0.47, -0.085], 2, DARK, sSteel),
    ...rivets(
      [
        [0.045, -0.05, -0.099],
        [0.045, -0.24, -0.099],
        [-0.045, -0.05, -0.099],
        [-0.045, -0.24, -0.099],
      ],
      DARK,
      sSteel,
    ), // upper-arm plate rivets
    ...rivets(
      [
        [0.04, -0.34, -0.09],
        [0.04, -0.5, -0.09],
        [-0.04, -0.34, -0.09],
        [-0.04, -0.5, -0.09],
      ],
      DARK,
      sSteel,
    ), // forearm plate rivets
    span([0, -0.32, -0.05], [0, -0.52, -0.045], 0.009, 0.009, CABLE, sCable, 6), // forearm cable
    ...bellows(0, -0.56, 0, 0.068, 0.056, 0.018, 3), // wrist bellows
    box(0.11, 0.08, 0.11, GUN, [0, -0.625, 0], undefined, sGun), // palm
    // three gripper fingers, each a knuckle ball plus a base and a curled tip segment
    ball(0.024, GALV, [0.05, -0.685, -0.02], 6, sGalv),
    box(0.03, 0.055, 0.032, PALE2, [0.052, -0.718, -0.03], [0, 0, -0.22], sPaint),
    box(0.024, 0.045, 0.028, CABLE, [0.063, -0.765, -0.056], [0, 0, -0.55], sCable),
    ball(0.024, GALV, [-0.05, -0.685, -0.02], 6, sGalv),
    box(0.03, 0.055, 0.032, PALE2, [-0.052, -0.718, -0.03], [0, 0, 0.22], sPaint),
    box(0.024, 0.045, 0.028, CABLE, [-0.063, -0.765, -0.056], [0, 0, 0.55], sCable),
    ball(0.024, GALV, [0, -0.685, 0.044], 6, sGalv),
    box(0.03, 0.055, 0.032, PALE2, [0, -0.718, 0.052], [0.22, 0, 0], sPaint),
    box(0.024, 0.045, 0.028, CABLE, [0, -0.765, 0.084], [0.55, 0, 0], sCable),
  ]);
  const armL = new THREE.Mesh(armLGeo, matLit);
  armL.position.set(-0.35, 0.33, 0); // +X is this character's right (confirmed via its own -Z-forward first-person view)

  // --- right arm: the built-in twin-barrel gun. Same shoulder/elbow, muzzle fixed at local (0,-0.85,0).
  const armRGeo = merge([
    box(0.15, 0.29, 0.155, DARK, [0, -0.145, 0], undefined, { ...sSteel, bottom: 0.82, top: 1 }), // upper arm
    shell(
      [
        [-0.26, 0.085],
        [-0.2, 0.098],
        [-0.09, 0.101],
        [-0.03, 0.085],
      ],
      2.0,
      PALE,
      [0, 0, 0],
      undefined,
      sPaint,
      12,
    ), // curved upper-arm plate, a lathed half-shell proud of the core
    box(0.04, 0.05, 0.03, DARK, [0, 0.015, -0.04], [0.25, 0, 0], sSteel), // shoulder root bracket
    span([-0.05, -0.02, -0.03], [0.05, -0.02, -0.03], 0.01, 0.01, CABLE, sCable, 6), // shoulder cable bridge
    ...actuator([0.066, -0.02, -0.04], [0.062, -0.27, -0.063], 0.02, 0.012), // bicep actuator
    pinX([0, -0.3, 0], 0.046, 0.175, GALV, sGalv, 10), // elbow hinge pin
    cyl(0.052, 0.052, 0.018, DARK, [0, -0.3, 0.095], [0, 0, Math.PI / 2], 10, sSteel), // capped
    box(0.14, 0.155, 0.145, GUN, [0, -0.375, 0], undefined, sGun), // receiver block
    box(0.11, 0.12, 0.02, DARK, [0, -0.375, -0.082], undefined, sSteel), // receiver proud plate
    box(0.06, 0.09, 0.05, GUN, [0, -0.38, 0.078], undefined, sGun), // stock counterweight, proud off the back
    ...rivets([[0, -0.38, 0.104]], DARK, sSteel), // stock rivet
    box(0.03, 0.022, 0.06, GUN, [0, -0.28, -0.04], undefined, sGun), // sight block atop the receiver
    box(0.03, 0.055, 0.035, DARK, [0, -0.56, -0.083], undefined, sSteel), // foregrip, proud off the shroud
    box(0.045, 0.06, 0.05, DARK, [0.088, -0.4, 0.038], undefined, { ...sSteel, bottom: 0.7, top: 1 }), // ammo feed box
    box(0.018, 0.03, 0.03, PALE2, [0.088, -0.432, 0.038], undefined, { ...sPaint, bevel: false }), // feed box latch
    ...rivets(
      [
        [0.047, -0.05, -0.102],
        [0.047, -0.24, -0.102],
        [-0.047, -0.05, -0.102],
        [-0.047, -0.24, -0.102],
      ],
      DARK,
      sSteel,
    ), // upper-arm plate rivets
    ...rivets(
      [
        [0.04, -0.33, -0.093],
        [0.04, -0.42, -0.093],
        [-0.04, -0.33, -0.093],
        [-0.04, -0.42, -0.093],
      ],
      DARK,
      sSteel,
    ), // receiver plate rivets
    // ammo belt, a short arc of link boxes from the feed box up toward the receiver
    box(0.02, 0.016, 0.018, GALV, [0.07, -0.37, 0.05], [0, 0, 0.2], sGalv),
    box(0.02, 0.016, 0.018, GALV, [0.045, -0.345, 0.056], [0, 0, 0.35], sGalv),
    box(0.02, 0.016, 0.018, GALV, [0.022, -0.315, 0.06], [0, 0, 0.5], sGalv),
    box(0.02, 0.016, 0.018, GALV, [0.006, -0.29, 0.062], [0, 0, 0.6], sGalv),
    ...boltRow([0.082, -0.335, -0.09], [-0.082, -0.335, -0.09], 3, DARK, sSteel),
    box(0.058, 0.03, 0.05, DARK, [0, -0.25, 0.07], undefined, sSteel), // sensor dome base
    ball(0.019, SENSOR, [0, -0.225, 0.078], 6, sGlass), // sensor lens
    box(0.125, 0.2, 0.125, GUN, [0, -0.52, 0], undefined, sGun), // barrel shroud housing
    ring(0.07, 0.17, DARK, [0, -0.52, 0], undefined, 12, sSteel), // proud housing collar
    vent(0.075, 0.05, [0, -0.47, -0.065], undefined, 3), // heat vent beside the housing
    // shroud holes, a pattern of round vents punched through the housing sides
    cyl(0.013, 0.013, 0.01, DARK, [0.063, -0.47, 0.03], [0, 0, Math.PI / 2], 10, { ...sSteel, bevel: false }),
    cyl(0.013, 0.013, 0.01, DARK, [0.063, -0.5, 0.03], [0, 0, Math.PI / 2], 10, { ...sSteel, bevel: false }),
    cyl(0.013, 0.013, 0.01, DARK, [0.063, -0.56, 0.03], [0, 0, Math.PI / 2], 10, { ...sSteel, bevel: false }),
    cyl(0.013, 0.013, 0.01, DARK, [-0.063, -0.47, 0.03], [0, 0, Math.PI / 2], 10, { ...sSteel, bevel: false }),
    cyl(0.013, 0.013, 0.01, DARK, [-0.063, -0.5, 0.03], [0, 0, Math.PI / 2], 10, { ...sSteel, bevel: false }),
    cyl(0.013, 0.013, 0.01, DARK, [-0.063, -0.56, 0.03], [0, 0, Math.PI / 2], 10, { ...sSteel, bevel: false }),
    cyl(0.021, 0.023, 0.24, GUN, [0.045, -0.73, 0], undefined, 10, sGun),
    cyl(0.021, 0.023, 0.24, GUN, [-0.045, -0.73, 0], undefined, 10, sGun),
    ring(0.027, 0.028, GALV, [0.045, -0.845, 0], undefined, 10, sGalv), // muzzle collar R
    ring(0.027, 0.028, GALV, [-0.045, -0.845, 0], undefined, 10, sGalv), // muzzle collar L
    // muzzle device: a stepped brake proud of each barrel's tip, right at the muzzle point, with gas-port holes
    cyl(0.031, 0.025, 0.018, DARK, [0.045, -0.858, 0], undefined, 10, sSteel),
    cyl(0.031, 0.025, 0.018, DARK, [-0.045, -0.858, 0], undefined, 10, sSteel),
    cyl(0.006, 0.006, 0.01, GUN, [0.045, -0.858, 0.027], [Math.PI / 2, 0, 0], 8, { ...sGun, bevel: false }), // brake port R
    cyl(0.006, 0.006, 0.01, GUN, [-0.045, -0.858, 0.027], [Math.PI / 2, 0, 0], 8, { ...sGun, bevel: false }), // brake port L
    ...boltRow([0, -0.605, 0.055], [0, -0.605, 0.078], 1, DARK, sSteel),
  ]);
  const armR = new THREE.Mesh(armRGeo, matLit);
  armR.position.set(0.35, 0.33, 0);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.85, 0);
  armR.add(muzzle);

  hips.add(torso, legL, legR);
  legL.add(shinL);
  legR.add(shinR);
  torso.add(head, armL, armR);

  const root = new THREE.Group();
  root.add(hips);

  return { root, parts: { hips, torso, head, armL, armR, legL, legR, shinL, shinR, eye, muzzle } };
}
