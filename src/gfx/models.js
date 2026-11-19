// The things that move or are held: the WARDEN sentry, the KITE drone, the player's carbine, the cascade hall's
// centrifuges, the demolition charge and the lodestar beacon.
//
// Every model faces -Z, is built from painted primitives (src/gfx/geo.js) and lit with src/gfx/materials.js —
// no textures, no built-in three.js materials, no lights. Each articulated part is one merged Mesh whose origin
// is its joint, parented so a parent's rotation carries its children (see src/world/map.js in DESIGN.md 8.2 for
// the exact contract). Nothing here calls makeRng: these shapes are fixed, not randomised.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lit, glow } from './materials.js';
import { paint, place, box, cyl, ball, merge, geoDetail } from './geo.js';

// ---------------------------------------------------------------------------------------------------------------
// Palette. Albedo stays in the mid range (per DESIGN.md 8.1/8.2) so the single key light and rim can still shade
// it at night — nothing here is near-black. Two or three tones plus one accent per model.
const PAINT = {
  // WARDEN sentry: graphite / gunmetal armour over a darker visible frame, hazard-amber markings.
  sentryArmourA: 0x3a434c, // main chest/head panels
  sentryArmourB: 0x46525c, // waist/limb panels, a shade lighter for variety
  sentryFrame: 0x262d33, // visible structural frame, joints, vents — darker but not black
  sentryAmber: 0xe0922e, // hazard stripe, number-plate border
  sentryLabel: 0xc3c9c6, // small pale warning labels
  sentryGunmetal: 0x333b43, // gun housing / barrels
  sentryCable: 0x24292d, // rubber-sheathed cable loom (explicit rough/metal where used — see sCable below)

  // KITE drone: a shade lighter than the sentry, same amber marking language.
  droneHull: 0x5b6670,
  droneHullDark: 0x3f4850,
  droneFrame: 0x2c343a,
  droneAmber: 0xe0922e,
  droneLabel: 0xc8cdc9,
  droneCable: 0x282e33,

  // Player carbine: matte charcoal metalwork, dark olive furniture, slightly lighter worn edges.
  gunCharcoal: 0x303236,
  gunCharcoalWorn: 0x45484c,
  gunOlive: 0x3f4330,
  gunOliveDark: 0x2e3122,
  sleeve: 0x2b2f3a,
  glove: 0x202123,
  knuckle: 0x565b60,

  // Centrifuge: brushed pale metal, darker foot, one pale-yellow band.
  centrifugeCasing: 0xa9afb0,
  centrifugeFoot: 0x565b5c,
  centrifugeBand: 0xd8c24a,

  // Demolition charge: ribbed olive block, darker straps, near-black electronics.
  chargeOlive: 0x4b5338,
  chargeOliveDark: 0x383f29,
  chargeStrap: 0x2f3320,
  chargeKeypad: 0x24271f,
  chargeCable: 0x1c1d16,

  // Beacon: sand / olive field kit, one amber band.
  beaconSand: 0x9c9070,
  beaconOlive: 0x5c5f45,
  beaconDark: 0x454736,
  beaconAmber: 0xe0922e,
};

// ---------------------------------------------------------------------------------------------------------------
// Small shared helpers (on top of geo.js) used by more than one model below.

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * A painted cylinder running between two points, its own axis aligned from `a` to `b`. Good for splayed struts.
 * `openEnded` drops both caps — safe (and worth 2 * segments triangles) when both ends tuck into other geometry.
 */
function strut(a, b, r1, r2, color, segments = 6, shade, openEnded = false) {
  const from = _from.set(a[0], a[1], a[2]).clone();
  const to = _to.set(b[0], b[1], b[2]).clone();
  const length = from.distanceTo(to);
  const g = paint(new THREE.CylinderGeometry(r1, r2, length, segments, 1, openEnded), color, shade);
  _dir.subVectors(to, from).normalize();
  _quat.setFromUnitVectors(_up, _dir);
  _mid.addVectors(from, to).multiplyScalar(0.5);
  g.applyQuaternion(_quat);
  g.translate(_mid.x, _mid.y, _mid.z);
  return g;
}

/** A thin open-ended cylinder (no caps) — cheap rings and ducts: a collar, a band, a duct around a rotor. */
function ring(radius, height, color, at, rot, segments = 10, shade) {
  return place(paint(new THREE.CylinderGeometry(radius, radius, height, segments, 1, true), color, shade), {
    at,
    rot,
  });
}

/**
 * A cylinder standing on Y with independently optional end caps. A flush or stepped join only ever needs
 * a cap on its larger (outer) side to hide the seam, so the other side can drop its cap entirely — this is
 * what keeps the centrifuge, which the game instances by the hundred, inside its tight triangle budget.
 */
function drum(radiusTop, radiusBottom, height, color, at, segments = 8, shade, caps = {}) {
  const { top = true, bottom = true } = caps;
  const parts = [new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, true)];
  if (top) parts.push(new THREE.CircleGeometry(radiusTop, segments).rotateX(-Math.PI / 2).translate(0, height / 2, 0));
  if (bottom)
    parts.push(new THREE.CircleGeometry(radiusBottom, segments).rotateX(Math.PI / 2).translate(0, -height / 2, 0));
  return place(paint(mergeGeometries(parts), color, shade), { at });
}

/** A tiny painted box — a rivet, a bolt head, a greeble. */
function bolt(at, color, size = 0.014) {
  return box(size, size, size, color, at);
}

/** A hinge-pin look at a joint: a short fat cylinder lying on its side along X. */
function pin(at, radius, length, color) {
  return cyl(radius, radius, length, color, at, [0, 0, Math.PI / 2], 8);
}

/**
 * A hydraulic actuator between two points: a fatter barrel from `a` partway to `b`, then a thinner rod running
 * on to `b`, with a small collar ball hiding the seam between them — the exposed piston at a knee, hip or
 * elbow that makes a joint read as driven machinery rather than a bare pivot.
 */
function piston(a, b, rBarrel, rRod, barrelColor, rodColor, shade, reach = 0.55) {
  const mid = [a[0] + (b[0] - a[0]) * reach, a[1] + (b[1] - a[1]) * reach, a[2] + (b[2] - a[2]) * reach];
  return [
    strut(a, mid, rBarrel, rBarrel * 0.85, barrelColor, 6, shade),
    strut(mid, b, rRod, rRod, rodColor, 5, shade, true),
    ball(rBarrel * 1.08, barrelColor, mid, 4, shade),
  ];
}

/**
 * A recessed louvered vent facing -Z (rotate with `rot` for other walls): a shadowed frame plus a handful of
 * raised slats, so light catches real gaps between them instead of a groove scored into one slab. Always
 * sharp-edged (bevel costs nothing here) since a vent reads from its slots, not its corners.
 */
function vent(w, h, color, frameColor, at, rot, slats = 4) {
  const parts = [box(w, h, 0.01, frameColor, [0, 0, 0], undefined, { bottom: 0.6, top: 0.9, bevel: false })];
  const step = h / slats;
  for (let i = 0; i < slats; i++)
    parts.push(
      box(w - 0.008, step * 0.55, 0.012, color, [0, -h / 2 + step * (i + 0.5), -0.008], undefined, { bevel: false }),
    );
  return place(merge(parts), { at, rot });
}

/** A tiny flat-sided fastener head — cheaper than `bolt()`'s chamfered box, so rows of them stay in budget. */
function rivet(at, color, size = 0.012) {
  return box(size, size, size, color, at, undefined, { bevel: false });
}

/** `n` evenly spaced rivets from `a` to `b` (inclusive) — a seam line of fasteners along a panel edge. */
function rivetRow(a, b, n, color, size = 0.012) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    parts.push(rivet([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], color, size));
  }
  return parts;
}

// ===================================================================================================================
// WARDEN — the sentry. 1.9 m tall, feet on y = 0, standing at the origin. Hips pivot at y = 0.98 (given);
// everything above is 0.92 m (waist 0.20 + torso 0.40 + head 0.32 = 0.92 -> top of head at 1.90 exactly);
// everything below is the 0.94 m from hip joint to the floor, split 0.46 thigh / 0.48 shin so the feet land on y=0.
/** A two-legged guard machine. */
export function buildSentry() {
  const A = PAINT.sentryArmourA;
  const B = PAINT.sentryArmourB;
  const F = PAINT.sentryFrame;
  const GM = PAINT.sentryGunmetal;
  const CAB = PAINT.sentryCable;
  const matLit = lit({ vertexColors: true, rim: 0.5 });
  const matEye = glow({ color: 0x8fe8ff, intensity: 1.5 });
  const sJoint = { rough: 0.35, metal: 0.8 }; // exposed pistons, hinge pins, gun metal
  const sCable = { rough: 0.85, metal: 0 }; // rubber-sheathed cable loom

  // --- hips: pivot at the pelvis (y = 0.98 world, (0,0,0) local). Hip joints sit slightly below and to the sides.
  // A visible frame keeps the old silhouette; a smaller, forward-standing plate rides proud of it on every face
  // that can take one, so the seam between plate and frame reads as a real panel gap rather than a flat box.
  const hipsGeo = merge([
    box(0.34, 0.22, 0.26, F, [0, 0.02, 0], undefined, { bottom: 0.72, top: 1 }), // frame (old silhouette)
    box(0.29, 0.185, 0.03, A, [0, 0.025, -0.145]), // proud pelvis plate
    box(0.11, 0.2, 0.24, F, [0.2, 0, 0]),
    box(0.11, 0.2, 0.24, F, [-0.2, 0, 0]),
    box(0.095, 0.185, 0.02, B, [0.2, 0.005, -0.13]), // proud hip cap R
    box(0.095, 0.185, 0.02, B, [-0.2, 0.005, -0.13]), // proud hip cap L
    box(0.36, 0.03, 0.03, F, [0, -0.1, -0.13]), // belt line
    box(0.065, 0.05, 0.05, F, [0.14, -0.11, -0.15], undefined, { bottom: 0.7, top: 1 }), // belt pouch R
    box(0.065, 0.05, 0.05, F, [-0.14, -0.11, -0.15], undefined, { bottom: 0.7, top: 1 }), // belt pouch L
    rivet([0.14, -0.085, -0.177], F, 0.014),
    rivet([-0.14, -0.085, -0.177], F, 0.014),
    pin([0.19, -0.04, 0], 0.05, 0.3, F),
    pin([-0.19, -0.04, 0], 0.05, 0.3, F),
    ...piston([0.22, 0.095, -0.1], [0.235, -0.04, -0.09], 0.024, 0.014, F, GM, sJoint), // hip actuator R
    ...piston([-0.22, 0.095, -0.1], [-0.235, -0.04, -0.09], 0.024, 0.014, F, GM, sJoint), // hip actuator L
    ...rivetRow([0.155, 0.09, -0.142], [0.155, -0.02, -0.142], 2, F),
    ...rivetRow([-0.155, 0.09, -0.142], [-0.155, -0.02, -0.142], 2, F),
  ]);
  const hips = new THREE.Mesh(hipsGeo, matLit);
  hips.position.set(0, 0.98, 0);

  // --- legs (thighs): pivot at the hip joint, hanging to the knee at local y = -0.46.
  function buildLeg() {
    return merge([
      box(0.18, 0.27, 0.2, B, [0, -0.135, 0]), // thigh core (old silhouette)
      box(0.15, 0.22, 0.03, A, [0, -0.135, -0.115]), // proud thigh plate
      box(0.15, 0.2, 0.17, A, [0, -0.36, 0], undefined, { bottom: 0.75, top: 1 }), // knee block (old silhouette)
      box(0.12, 0.08, 0.02, F, [0, -0.355, -0.095]), // knee guard rib, proud
      ...rivetRow([0.065, -0.05, -0.108], [-0.065, -0.05, -0.108], 2, F, 0.011),
      pin([0, -0.46, 0], 0.065, 0.3, F),
      ...piston([0.09, -0.07, -0.055], [0.075, -0.4, -0.085], 0.02, 0.012, F, GM, sJoint), // knee actuator
    ]);
  }
  const legL = new THREE.Mesh(buildLeg(), matLit);
  const legR = new THREE.Mesh(buildLeg(), matLit);
  legL.position.set(-0.19, -0.04, 0); // anatomical left/right: +X is this character's right (see armL/armR below)
  legR.position.set(0.19, -0.04, 0);

  // --- shins: pivot at the knee (local 0,0,0), hanging to the floor at local y = -0.48; the foot is built in.
  function buildShin() {
    return merge([
      box(0.17, 0.22, 0.19, A, [0, -0.11, 0], undefined, { bottom: 0.7, top: 1 }), // calf core (old silhouette)
      box(0.14, 0.18, 0.025, B, [0, -0.11, -0.108]), // proud calf plate
      box(0.15, 0.17, 0.165, B, [0, -0.305, 0], undefined, { bottom: 0.65, top: 1 }), // ankle block (old silhouette)
      box(0.12, 0.09, 0.018, F, [0, -0.275, -0.0915]), // ankle guard, proud
      ...rivetRow([0.06, -0.06, -0.122], [-0.06, -0.06, -0.122], 2, F, 0.011),
      pin([0, -0.4, 0], 0.05, 0.26, F),
      ...piston([0.065, -0.15, -0.05], [0.055, -0.37, -0.085], 0.017, 0.011, F, GM, sJoint), // ankle actuator
      box(0.16, 0.08, 0.3, F, [0, -0.44, -0.07], undefined, { bottom: 0.6, top: 0.9 }), // flat foot
      box(0.13, 0.055, 0.07, F, [0, -0.452, -0.25], [0.18, 0, 0]), // chamfered toe
      box(0.14, 0.012, 0.015, B, [0, -0.474, -0.05], undefined, { bevel: false }), // tread line
      box(0.14, 0.012, 0.015, B, [0, -0.474, -0.12], undefined, { bevel: false }), // tread line
      box(0.14, 0.012, 0.015, B, [0, -0.474, -0.19], undefined, { bevel: false }), // tread line
      box(0.1, 0.03, 0.12, F, [0, -0.45, 0.065], undefined, { bottom: 0.55, top: 0.85 }), // heel guard
    ]);
  }
  const shinL = new THREE.Mesh(buildShin(), matLit);
  const shinR = new THREE.Mesh(buildShin(), matLit);
  shinL.position.set(0, -0.46, 0);
  shinR.position.set(0, -0.46, 0);

  // --- torso: pivot at the waist (local 0,0,0, hips-local y = +0.20 -> world 1.18). Narrow waist, wide shoulders.
  const torsoGeo = merge([
    box(0.3, 0.17, 0.22, B, [0, 0.085, 0], undefined, { bottom: 0.78, top: 1 }), // waist (old silhouette)
    box(0.26, 0.13, 0.025, A, [0, 0.1, -0.1225]), // proud waist plate
    box(0.52, 0.24, 0.27, A, [0, 0.28, 0]), // chest (old silhouette)
    box(0.18, 0.2, 0.025, B, [0.17, 0.28, -0.1475]), // chest plate R, flanking the badge
    box(0.18, 0.2, 0.025, B, [-0.17, 0.28, -0.1475]), // chest plate L
    box(0.15, 0.13, 0.23, F, [0.33, 0.33, 0]), // shoulder pad R (+X is this character's right, old silhouette)
    box(0.12, 0.1, 0.02, A, [0.33, 0.33, -0.125]), // shoulder cap R, proud
    pin([0.33, 0.27, -0.09], 0.025, 0.1, GM), // shoulder hinge pin R (decorative)
    box(0.15, 0.13, 0.23, F, [-0.33, 0.33, 0]), // shoulder pad L (old silhouette)
    box(0.12, 0.1, 0.02, A, [-0.33, 0.33, -0.125]), // shoulder cap L, proud
    pin([-0.33, 0.27, -0.09], 0.025, 0.1, GM), // shoulder hinge pin L (decorative)
    box(0.05, 0.14, 0.03, F, [0, 0.33, -0.145]), // chest spine line (collar seam; stops above the number plate)
    cyl(0.07, 0.08, 0.08, F, [0, 0.41, 0], undefined, 8), // neck stub
    ring(0.085, 0.02, F, [0, 0.365, 0], undefined, 10), // neck collar ring
    // back: battery pack + cooling fins + short antenna
    box(0.26, 0.22, 0.12, F, [0, 0.26, 0.19]),
    box(0.22, 0.022, 0.03, F, [0, 0.33, 0.265]),
    box(0.22, 0.022, 0.03, F, [0, 0.29, 0.27]),
    box(0.22, 0.022, 0.03, F, [0, 0.25, 0.27]),
    box(0.22, 0.022, 0.03, F, [0, 0.21, 0.265]),
    cyl(0.008, 0.013, 0.22, F, [0.09, 0.52, 0.14], [0.12, 0, 0.1], 6),
    ball(0.018, PAINT.sentryAmber, [0.112, 0.63, 0.165], 6),
    // cable loom from the battery pack down into the waist, both sides
    strut([0.1, 0.33, 0.235], [0.075, 0.15, 0.1], 0.009, 0.009, CAB, 5, sCable, true),
    strut([-0.1, 0.33, 0.235], [-0.075, 0.15, 0.1], 0.009, 0.009, CAB, 5, sCable, true),
    // louvered side vents
    vent(0.05, 0.14, F, F, [0.261, 0.2, 0], [0, Math.PI / 2, 0], 4),
    vent(0.05, 0.14, F, F, [-0.261, 0.2, 0], [0, -Math.PI / 2, 0], 4),
    // hazard stripe (left shoulder) + bordered number plate (chest)
    box(0.1, 0.012, 0.18, PAINT.sentryAmber, [-0.33, 0.397, 0]),
    box(0.116, 0.07, 0.01, PAINT.sentryAmber, [0, 0.21, -0.136]),
    box(0.096, 0.052, 0.006, PAINT.sentryLabel, [0, 0.21, -0.139]),
    // small pale warning labels (one now rides the new chest plate R)
    box(0.05, 0.03, 0.008, PAINT.sentryLabel, [0.17, 0.28, -0.162]),
    box(0.05, 0.03, 0.008, PAINT.sentryLabel, [0, 0.08, 0.112]),
    ...rivetRow([0.13, 0.36, -0.108], [0.13, 0.2, -0.108], 3, F, 0.011),
    ...rivetRow([-0.13, 0.36, -0.108], [-0.13, 0.2, -0.108], 3, F, 0.011),
    rivet([0.24, 0.06, -0.137], F, 0.014),
    rivet([-0.24, 0.06, -0.137], F, 0.014),
  ]);
  const torso = new THREE.Mesh(torsoGeo, matLit);
  torso.position.set(0, 0.2, 0);

  // --- head: pivot at the neck (local 0,0,0, torso-local y = +0.40 -> world 1.58). A sensor housing with a visor.
  const headGeo = merge([
    box(0.22, 0.26, 0.24, A, [0, 0.15, 0]),
    box(0.17, 0.05, 0.19, F, [0, 0.303, 0]), // stepped top
    box(0.23, 0.06, 0.02, F, [0, 0.16, -0.125]), // visor recess frame
    box(0.19, 0.028, 0.012, B, [0, 0.194, -0.129]), // brow ridge, proud over the visor
    cyl(0.032, 0.032, 0.05, F, [0.12, 0.17, -0.06], [Math.PI / 2, 0, 0], 8), // R lens housing barrel
    ring(0.032, 0.008, GM, [0.12, 0.17, -0.087], [Math.PI / 2, 0, 0], 8), // R lens bezel
    cyl(0.032, 0.032, 0.05, F, [-0.12, 0.17, -0.06], [Math.PI / 2, 0, 0], 8), // L lens housing barrel
    ring(0.032, 0.008, GM, [-0.12, 0.17, -0.087], [Math.PI / 2, 0, 0], 8), // L lens bezel
    vent(0.045, 0.075, F, F, [0.108, 0.095, -0.06], [0, -0.45, 0], 3), // R cheek vent
    vent(0.045, 0.075, F, F, [-0.108, 0.095, -0.06], [0, 0.45, 0], 3), // L cheek vent
    box(0.18, 0.05, 0.02, F, [0, 0.07, -0.118], undefined, { bottom: 0.7, top: 0.9 }), // chin vent
    box(0.2, 0.025, 0.012, B, [0, 0.044, -0.123]), // jaw guard, proud below the chin vent
    box(0.14, 0.04, 0.015, F, [0, 0.25, 0.115]), // rear vent
    ...rivetRow([0.095, 0.27, -0.113], [-0.095, 0.27, -0.113], 3, F, 0.011),
  ]);
  const head = new THREE.Mesh(headGeo, matLit);
  head.position.set(0, 0.4, 0);

  // eye must protrude past the recess frame's front face (z=-0.135) or the frame hides it entirely.
  const eye = new THREE.Mesh(box(0.19, 0.034, 0.012, 0xffffff, [0, 0.16, -0.145]), matEye);
  head.add(eye);

  // --- left arm: three-finger clamp. Hangs straight down from the shoulder so rotation.x swings it forward (+Z->-Z).
  const armLGeo = merge([
    pin([0, 0, 0], 0.075, 0.2, F),
    box(0.15, 0.3, 0.155, B, [0, -0.15, 0]), // upper arm (old silhouette)
    box(0.12, 0.25, 0.025, A, [0, -0.15, -0.09]), // proud upper-arm plate
    ...piston([0.065, -0.02, -0.04], [0.06, -0.28, -0.065], 0.021, 0.012, F, GM, sJoint), // bicep actuator
    pin([0, -0.3, 0], 0.065, 0.18, F),
    box(0.135, 0.28, 0.145, A, [0, -0.44, 0], undefined, { bottom: 0.75, top: 1 }), // forearm (old silhouette)
    box(0.105, 0.21, 0.02, B, [0, -0.43, -0.0825]), // proud forearm plate
    ...rivetRow([0.05, -0.34, -0.1], [0.05, -0.52, -0.1], 3, F, 0.011),
    ring(0.082, 0.025, F, [0, -0.585, 0], undefined, 10), // wrist collar
    box(0.12, 0.09, 0.12, F, [0, -0.635, 0]),
    // three gripper fingers, each a cheap two-segment, two-colour claw (base + curled tip) rather than one flat paddle
    box(0.032, 0.058, 0.034, B, [0.052, -0.705, -0.018], [0, 0, -0.22]), // finger R base
    box(0.027, 0.05, 0.03, F, [0.062, -0.756, -0.046], [0, 0, -0.55]), // finger R tip
    box(0.032, 0.058, 0.034, B, [-0.052, -0.705, -0.018], [0, 0, 0.22]), // finger L base
    box(0.027, 0.05, 0.03, F, [-0.062, -0.756, -0.046], [0, 0, 0.55]), // finger L tip
    box(0.032, 0.058, 0.034, B, [0, -0.705, 0.038], [0.22, 0, 0]), // finger front base
    box(0.027, 0.05, 0.03, F, [0, -0.756, 0.066], [0.55, 0, 0]), // finger front tip
  ]);
  const armL = new THREE.Mesh(armLGeo, matLit);
  armL.position.set(-0.35, 0.33, 0); // +X is this character's right (confirmed via its own -Z-forward first-person view)

  // --- right arm: the built-in twin-barrel gun. Same hanging rule; at rotation.x = +1.45 the muzzle levels out at -Z.
  const armRGeo = merge([
    pin([0, 0, 0], 0.075, 0.2, F),
    box(0.155, 0.3, 0.16, B, [0, -0.15, 0]), // upper arm (old silhouette)
    box(0.125, 0.25, 0.025, A, [0, -0.15, -0.0925]), // proud upper-arm plate
    ...piston([0.07, -0.02, -0.04], [0.065, -0.28, -0.065], 0.021, 0.012, F, GM, sJoint), // bicep actuator
    pin([0, -0.3, 0], 0.065, 0.18, F),
    box(0.145, 0.16, 0.15, GM, [0, -0.38, 0]), // receiver block (old silhouette)
    box(0.115, 0.125, 0.02, F, [0, -0.38, -0.085]), // receiver proud plate
    box(0.045, 0.06, 0.05, F, [0.09, -0.4, 0.04], undefined, { bottom: 0.7, top: 1 }), // ammo feed box
    ...rivetRow([0.085, -0.34, -0.093], [-0.085, -0.34, -0.093], 3, F, 0.011),
    box(0.12, 0.2, 0.12, F, [0, -0.52, 0]), // barrel housing frame
    ring(0.064, 0.17, GM, [0, -0.52, 0], undefined, 10), // proud housing collar
    cyl(0.022, 0.024, 0.24, GM, [0.045, -0.73, 0], undefined, 8),
    cyl(0.022, 0.024, 0.24, GM, [-0.045, -0.73, 0], undefined, 8),
    ring(0.028, 0.025, F, [0.045, -0.84, 0], undefined, 8), // flash-hider collar R
    ring(0.028, 0.025, F, [-0.045, -0.84, 0], undefined, 8), // flash-hider collar L
    vent(0.08, 0.05, F, F, [0, -0.48, -0.067], undefined, 3), // heat vent beside the housing
    box(0.05, 0.03, 0.05, F, [0, -0.25, 0.075]), // sensor dome base
    ball(0.02, PAINT.sentryAmber, [0, -0.225, 0.08], 6), // sensor lens
    rivet([0, -0.6, 0.067], F, 0.018),
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

// ===================================================================================================================
// KITE — the drone. ~0.9 m across (hub to opposite hub), centred on its own origin at flying height.
/** A four-rotor guard drone. */
export function buildDrone() {
  const H = PAINT.droneHull;
  const D = PAINT.droneHullDark;
  const F = PAINT.droneFrame;
  const C = PAINT.droneCable;
  const matLit = lit({ vertexColors: true, rim: 0.55 });
  const matEye = glow({ color: 0x8fe8ff, intensity: 1.6 });
  const matTail = glow({ color: 0xff3b30, intensity: 1.3 });

  const hubs = [
    [0.32, 0, -0.32],
    [0.32, 0, 0.32],
    [-0.32, 0, -0.32],
    [-0.32, 0, 0.32],
  ];

  const bodyParts = [
    // frame core — the hull's original silhouette, kept as the visible understructure between panels
    box(0.2, 0.075, 0.24, F, [0, 0, 0]),
    box(0.14, 0.065, 0.1, F, [0, 0.002, -0.17]),
    box(0.07, 0.05, 0.06, D, [0, 0.002, -0.22]),
    box(0.12, 0.055, 0.08, F, [0, 0.002, 0.15]),

    // upper canopy armour, proud of the frame and inset a hair so its edge reads as a seam all round
    box(0.172, 0.028, 0.212, H, [0, 0.0515, -0.004]),
    box(0.112, 0.022, 0.09, H, [0, 0.0445, -0.175]),
    ...rivetRow([-0.082, 0.0655, -0.096], [0.082, 0.0655, -0.096], 4, F, 0.011),
    ...rivetRow([-0.082, 0.0655, 0.076], [0.082, 0.0655, 0.076], 3, F, 0.011),
    // belly armour, proud below the frame the same way
    box(0.16, 0.022, 0.19, D, [0, -0.0485, 0]),
    box(0.05, 0.03, 0.26, D, [0, 0.0655 + 0.015, 0]), // top spine, resting on the new canopy
    box(0.05, 0.03, 0.008, PAINT.droneAmber, [0.09, 0.0375 + 0.015, 0.1]), // hazard mark, on the exposed frame ledge
    box(0.05, 0.03, 0.008, PAINT.droneAmber, [-0.09, -0.0375 - 0.015, 0.1], [Math.PI, 0, 0]), // mirrored, underside
    box(0.045, 0.024, 0.007, PAINT.droneLabel, [-0.09, 0.0375 + 0.012, 0.12]), // label, same ledge
    bolt([0.08, 0.02, -0.22], F, 0.01),
    bolt([-0.08, 0.02, -0.22], F, 0.01),
    // cable loom: a signal line sagging from the canopy rear down onto the tail boom
    strut([0.018, 0.067, 0.04], [0.026, 0.057, 0.13], 0.006, 0.006, C, 5),
    strut([0.026, 0.057, 0.13], [0.022, 0.048, 0.185], 0.006, 0.005, C, 5),
    // camera/sensor bezel: a recessed housing ring framing the eye, plus a small brow lip above it
    ring(0.03, 0.018, D, [0, -0.068, -0.178], [Math.PI / 2, 0, 0], 10),
    box(0.07, 0.012, 0.03, F, [0, -0.045, -0.2]),
  ];
  // 4 arms running from the hull out to each duct hub, with a collar at either end of every arm
  for (const h of hubs) {
    const root3 = [h[0] * 0.3, 0, h[2] * 0.3];
    bodyParts.push(strut(root3, h, 0.028, 0.02, F, 6));
    bodyParts.push(ring(0.03, 0.012, D, root3, undefined, 8));
    bodyParts.push(ring(0.023, 0.01, D, h, undefined, 8));
  }
  // ducted rings (static) around each rotor disc: an outer shroud plus an inset lip, and a static motor
  // nacelle peeking through the middle — the rotor mesh itself spins just clear of it
  for (const h of hubs) {
    bodyParts.push(ring(0.095, 0.03, D, h, undefined, 10));
    bodyParts.push(ring(0.078, 0.016, H, [h[0], h[1] + 0.008, h[2]], undefined, 10));
    bodyParts.push(drum(0.032, 0.032, 0.022, F, h, 8, undefined, { top: true, bottom: false }));
  }
  // gimbal housing + two small barrels beside it, framed by a yoke ring and collared at the muzzle
  bodyParts.push(new THREE.SphereGeometry(0.038, 8, 6).translate(0, -0.052, -0.155).rotateX(0));
  paint(bodyParts[bodyParts.length - 1], D);
  bodyParts.push(
    ring(0.042, 0.01, F, [0, -0.052, -0.148], [0, 0, Math.PI / 2], 10),
    cyl(0.015, 0.015, 0.09, PAINT.droneFrame, [0.06, -0.05, -0.15], [-Math.PI / 2, 0, 0], 6),
    cyl(0.015, 0.015, 0.09, PAINT.droneFrame, [-0.06, -0.05, -0.15], [-Math.PI / 2, 0, 0], 6),
    ring(0.019, 0.012, D, [0.06, -0.05, -0.192], [-Math.PI / 2, 0, 0], 8),
    ring(0.019, 0.012, D, [-0.06, -0.05, -0.192], [-Math.PI / 2, 0, 0], 8),
  );
  // two skids, braced and footed
  bodyParts.push(
    box(0.018, 0.012, 0.22, F, [0.1, -0.067, 0.02]),
    box(0.018, 0.012, 0.22, F, [-0.1, -0.067, 0.02]),
    box(0.018, 0.05, 0.018, F, [0.1, -0.045, -0.08]),
    box(0.018, 0.05, 0.018, F, [-0.1, -0.045, -0.08]),
    box(0.018, 0.05, 0.018, F, [0.1, -0.045, 0.1]),
    box(0.018, 0.05, 0.018, F, [-0.1, -0.045, 0.1]),
    strut([0.1, -0.067, -0.05], [-0.1, -0.067, -0.05], 0.009, 0.009, F, 5), // cross-brace, front
    ball(0.016, F, [0.1, -0.073, -0.08], 5),
    ball(0.016, F, [-0.1, -0.073, -0.08], 5),
    ball(0.016, F, [0.1, -0.073, 0.13], 5),
    ball(0.016, F, [-0.1, -0.073, 0.13], 5),
  );
  const body = new THREE.Mesh(merge(bodyParts), matLit);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6).translate(0, -0.068, -0.188), matEye);
  paint(eye.geometry, 0xffffff);
  // must protrude past the tail-cone housing's back face (z=0.19) or it's hidden entirely.
  const tail = new THREE.Mesh(box(0.025, 0.02, 0.016, 0xffffff, [0, 0.01, 0.205]), matTail);

  function propGeo() {
    return merge([
      box(0.16, 0.012, 0.028, D, [0, 0, 0], [0, 0, 0.12]),
      box(0.16, 0.012, 0.028, D, [0, 0, 0], [0, Math.PI, -0.12]),
      cyl(0.016, 0.016, 0.03, F, [0, 0, 0], undefined, 6),
    ]);
  }
  const rotors = hubs.map((h) => {
    const m = new THREE.Mesh(propGeo(), matLit);
    m.position.set(h[0], 0.02, h[2]);
    return m;
  });

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.03, -0.2);

  const root = new THREE.Group();
  root.add(body, eye, tail, muzzle, ...rotors);

  return { root, parts: { body, rotors, eye, tail, muzzle } };
}

// ===================================================================================================================
// The player's carbine, origin at the pistol grip, built along -Z (muzzle at -Z). ~0.93 m overall.

/**
 * A finger or thumb: a chain of ball-jointed struts through explicit waypoints, base to fingertip. Points are
 * plain coordinates rather than turtle angles, so a segment's curl is just where its own next point is — nothing
 * here has to guess the sign of a rotation. The base itself gets no ball (it tucks inside the palm).
 * @param {number[][]} points centres from the base to the fingertip, at least two
 * @param {number[]} radii    one per point
 */
function jointChain(points, radii, color, shade, segments = 6) {
  const parts = [];
  for (let i = 0; i < points.length - 1; i++)
    parts.push(strut(points[i], points[i + 1], radii[i], radii[i + 1], color, segments, shade));
  for (let i = 1; i < points.length - 1; i++) parts.push(ball(radii[i] * 1.1, color, points[i], 6, shade));
  parts.push(ball(radii[radii.length - 1] * 0.92, color, points[points.length - 1], 6, shade)); // rounded fingertip
  return parts;
}

/**
 * A run of Picatinny rail along Z: a low base rib plus a row of separate bevelled crossbar teeth, so the slots
 * between them are real gaps rather than grooves scored into one slab.
 * @param {number} zBack  the rear (+Z) end of the run
 * @param {number} zFront the front (-Z) end of the run, zFront < zBack
 */
function railSegments(x, y, zBack, zFront, width, color, shade) {
  const span = zBack - zFront;
  const pitch = 0.0195;
  const tooth = 0.012;
  const count = Math.max(1, Math.floor(span / pitch));
  const parts = [box(width, 0.01, span + 0.01, color, [x, y - 0.005, (zBack + zFront) / 2], undefined, shade)];
  for (let i = 0; i < count; i++)
    parts.push(box(width, 0.013, tooth, color, [x, y + 0.006, zBack - i * pitch - tooth / 2], undefined, shade));
  return parts;
}

/** The player's suppressed carbine, seen from behind the sight, and the two gloved hands holding it. */
export function buildCarbine() {
  const C = PAINT.gunCharcoal; // anodised upper/lower receiver, rail, optic housing
  const W = PAINT.gunCharcoalWorn; // worn aluminium: trigger, selector, catches, charging handle
  const O = PAINT.gunOlive; // polymer furniture: grip, handguard, stock, mag
  const OD = PAINT.gunOliveDark; // polymer furniture, recessed/shadowed
  const STEEL = 0x53575c; // exposed barrel
  const STEEL_DARK = 0x35383c; // heat-darkened suppressor, bolt carrier
  const BRASS = 0xaf8639; // the one visible round in the mag
  const RUBBER = 0x242427; // buttpad

  const matLit = lit({ vertexColors: true, rim: 0.45 });
  const matDot = glow({ color: 0xff6a2a, intensity: 2.4 });

  // explicit rough/metal so every surface lands in the brief's numeric ranges, whatever geo.js would otherwise
  // guess from the colour alone.
  const sAlum = { rough: 0.5, metal: 0.65 }; // anodised aluminium
  const sAlumWorn = { rough: 0.47, metal: 0.68 };
  const sSteel = { rough: 0.4, metal: 0.85 }; // barrel, suppressor, bolt carrier
  const sPoly = { rough: 0.72, metal: 0 }; // polymer furniture
  const sRubber = { rough: 0.85, metal: 0 };
  const sFabric = { rough: 0.9, metal: 0 }; // sleeves
  const sGlove = { rough: 0.78, metal: 0 };
  const sBrass = { rough: 0.3, metal: 1 };

  const boreY = 0.082;

  const bodyParts = [
    // --- lower receiver: grip with finger grooves + beavertail, trigger guard, trigger, mag well flare,
    // selector, bolt catch, mag release, pivot + takedown pins -------------------------------------------------
    box(0.046, 0.05, 0.1, C, [0, 0.008, -0.012], undefined, sAlum), // lower receiver shell
    box(0.036, 0.165, 0.085, O, [0, -0.085, 0.032], [-0.17, 0, 0], sPoly), // grip
    box(0.05, 0.028, 0.05, OD, [0, -0.005, 0.063], [-0.1, 0, 0], sPoly), // beavertail, blends grip into the shell
    box(0.038, 0.012, 0.012, OD, [0, -0.055, -0.004], [-0.17, 0, 0], sPoly), // finger groove 1
    box(0.038, 0.012, 0.012, OD, [0, -0.09, -0.004], [-0.17, 0, 0], sPoly), // finger groove 2
    box(0.038, 0.012, 0.012, OD, [0, -0.125, -0.004], [-0.17, 0, 0], sPoly), // finger groove 3
    box(0.012, 0.048, 0.085, C, [0, 0.008, -0.018], undefined, sAlum), // trigger guard front
    box(0.012, 0.048, 0.014, C, [0, 0.008, 0.052], undefined, sAlum), // trigger guard back
    box(0.072, 0.012, 0.095, C, [0, -0.018, -0.012], undefined, sAlum), // trigger guard bottom
    box(0.012, 0.026, 0.022, W, [0, 0.016, -0.006], undefined, sAlumWorn), // trigger
    box(0.05, 0.02, 0.02, OD, [0, -0.145, -0.075], [0.3, 0, 0], sPoly), // mag well flare, front
    box(0.05, 0.02, 0.02, OD, [0, -0.145, -0.03], [-0.25, 0, 0], sPoly), // mag well flare, back
    cyl(0.008, 0.008, 0.01, W, [-0.032, -0.015, -0.03], [0, 0, Math.PI / 2], 8, sAlumWorn), // mag release
    box(0.01, 0.034, 0.02, W, [-0.03, 0.045, -0.07], undefined, sAlumWorn), // bolt catch paddle
    box(0.03, 0.01, 0.018, W, [-0.026, 0.03, 0.015], [0, 0, -0.15], sAlumWorn), // selector lever (left)
    box(0.012, 0.01, 0.014, W, [0.024, 0.03, 0.015], undefined, sAlumWorn), // selector nub (right, ambi)
    pin([0, boreY - 0.05, -0.065], 0.011, 0.058, W), // pivot pin
    pin([0, boreY - 0.045, 0.045], 0.011, 0.058, W), // takedown pin

    // --- upper receiver: forward assist, ejection port + open dust cover, brass deflector, charging handle -----
    box(0.05, 0.072, 0.3, C, [0, boreY, -0.1], undefined, sAlum),
    box(0.075, 0.034, 0.016, C, [0.026, boreY + 0.006, -0.07], undefined, {
      bottom: 0.5,
      top: 0.9,
      rough: 0.55,
      metal: 0.4,
    }), // eject port recess
    box(0.008, 0.05, 0.07, W, [0.034, boreY + 0.03, -0.07], [0.9, 0, 0], sAlumWorn), // dust cover, hinged open
    box(0.014, 0.03, 0.022, C, [0.028, boreY + 0.032, -0.042], [0.15, 0, -0.2], sAlum), // brass deflector
    cyl(0.014, 0.014, 0.016, C, [0.026, boreY + 0.012, 0.015], [Math.PI / 2, 0, 0], 10, sAlum), // forward assist
    box(0.022, 0.02, 0.05, W, [0, boreY + 0.03, 0.03], undefined, sAlumWorn), // charging handle body
    box(0.032, 0.012, 0.016, W, [0, boreY + 0.038, 0.053], undefined, sAlumWorn), // charging handle latch
    ...railSegments(0, boreY + 0.046, 0.02, -0.43, 0.03, W, sAlumWorn), // top rail: receiver + handguard

    // --- compact red-dot optic: mount riser, clamp + screws, open front/rear frame, hood, brightness knob -----
    box(0.024, 0.039, 0.022, C, [0, 0.104, -0.11], undefined, sAlum), // riser
    box(0.038, 0.018, 0.052, C, [0, 0.1325, -0.11], undefined, sAlum), // clamp base
    bolt([0.021, 0.1325, -0.095], W, 0.009), // clamp screw
    bolt([0.021, 0.1325, -0.125], W, 0.009), // clamp screw
    box(0.052, 0.009, 0.046, C, [0, 0.146, -0.11], undefined, sAlum), // frame bottom
    box(0.052, 0.009, 0.046, C, [0, 0.19, -0.11], undefined, sAlum), // frame top
    box(0.009, 0.048, 0.046, C, [0.0255, 0.168, -0.11], undefined, sAlum), // frame right
    box(0.009, 0.048, 0.046, C, [-0.0255, 0.168, -0.11], undefined, sAlum), // frame left
    box(0.05, 0.012, 0.012, C, [0, 0.198, -0.129], undefined, sAlum), // hood, front lip
    box(0.05, 0.012, 0.012, C, [0, 0.198, -0.091], undefined, sAlum), // hood, rear lip
    cyl(0.008, 0.008, 0.014, W, [-0.0255, 0.145, -0.125], [Math.PI / 2, 0, 0], 8, sAlumWorn), // brightness knob
    // folded back-up irons: flat on the rail, well clear of the optic's own window
    box(0.022, 0.012, 0.03, C, [0, boreY + 0.054, 0.075], undefined, sAlum),
    cyl(0.009, 0.009, 0.012, W, [0, boreY + 0.06, 0.08], [Math.PI / 2, 0, 0], 8, sAlumWorn),
    box(0.018, 0.012, 0.024, C, [0, boreY + 0.054, -0.42], undefined, sAlum),
    box(0.006, 0.016, 0.006, W, [0, boreY + 0.064, -0.428], undefined, sAlumWorn),

    // --- free-float handguard: octagonal tube, M-LOK-style slots, barrel nut, gas block + tube -----------------
    place(paint(new THREE.CylinderGeometry(0.034, 0.034, 0.2, 8, 1, true), O, sPoly), {
      at: [0, boreY - 0.004, -0.35],
      rot: [Math.PI / 2, 0, 0],
    }),
    ring(0.037, 0.018, C, [0, boreY - 0.004, -0.257], [Math.PI / 2, 0, 0], 10, sAlum), // barrel nut
    ...[-1, 1].flatMap((side) =>
      [-0.29, -0.33, -0.37, -0.41].map((z) =>
        box(0.01, 0.01, 0.03, STEEL_DARK, [side * 0.028, boreY - 0.004, z], undefined, { rough: 0.6, metal: 0.1 }),
      ),
    ), // M-LOK slots, both sides
    box(0.028, 0.032, 0.032, STEEL_DARK, [0, boreY, -0.44], undefined, sSteel), // gas block
    cyl(0.0035, 0.0035, 0.06, STEEL, [0, boreY + 0.024, -0.42], [Math.PI / 2, 0, 0], 6, sSteel), // gas tube

    // --- stepped barrel + heat-darkened suppressor: collar, main tube, rings, hex wrench flats, end cap --------
    cyl(0.013, 0.013, 0.05, STEEL, [0, boreY, -0.475], [Math.PI / 2, 0, 0], 10, sSteel), // exposed barrel
    cyl(0.024, 0.024, 0.03, STEEL_DARK, [0, boreY, -0.515], [Math.PI / 2, 0, 0], 12, sSteel), // mount collar
    cyl(0.0255, 0.0255, 0.15, STEEL_DARK, [0, boreY, -0.605], [Math.PI / 2, 0, 0], 14, sSteel), // main tube
    ring(0.028, 0.012, STEEL_DARK, [0, boreY, -0.555], [Math.PI / 2, 0, 0], 14, sSteel),
    ring(0.028, 0.012, STEEL_DARK, [0, boreY, -0.605], [Math.PI / 2, 0, 0], 14, sSteel),
    ring(0.028, 0.012, STEEL_DARK, [0, boreY, -0.655], [Math.PI / 2, 0, 0], 14, sSteel),
    place(paint(new THREE.CylinderGeometry(0.0285, 0.0285, 0.022, 6, 1, true), STEEL_DARK, sSteel), {
      at: [0, boreY, -0.545],
      rot: [Math.PI / 2, 0, 0],
    }), // wrench flats
    cyl(0.023, 0.023, 0.016, STEEL_DARK, [0, boreY, -0.688], [Math.PI / 2, 0, 0], 14, sSteel), // end cap
    ring(0.008, 0.004, STEEL_DARK, [0, boreY, -0.694], [Math.PI / 2, 0, 0], 10, { rough: 0.25, metal: 0.3 }), // bore hint

    // --- real stock: buffer tube, adjustable body with cheek rest, latch + position nubs, rubber pad, sling ---
    cyl(0.0165, 0.0165, 0.14, C, [0, boreY, 0.095], [Math.PI / 2, 0, 0], 10, sAlum), // buffer tube
    box(0.052, 0.078, 0.095, O, [0, boreY - 0.012, 0.178], undefined, sPoly), // stock body
    box(0.032, 0.022, 0.075, OD, [0, boreY + 0.028, 0.165], undefined, sPoly), // cheek rest
    box(0.022, 0.016, 0.022, W, [0, boreY - 0.052, 0.145], [0.2, 0, 0], sAlumWorn), // adjustment lever
    bolt([0, boreY - 0.022, 0.15], W, 0.01), // position-indicator nub
    bolt([0, boreY - 0.022, 0.19], W, 0.01),
    box(0.062, 0.098, 0.024, RUBBER, [0, boreY - 0.012, 0.238], undefined, sRubber), // buttpad
    place(paint(new THREE.TorusGeometry(0.018, 0.005, 6, 10), C, sAlum), {
      at: [0, boreY - 0.055, 0.205],
      rot: [Math.PI / 2, 0, 0],
    }), // sling loop
  ];
  const body = new THREE.Mesh(merge(bodyParts), matLit);

  // magazine: origin at the well (just forward of the trigger guard); a slight curve, ribs, floor plate and the
  // one round visible at the feed lips. Slides down + tilts on reload (src/weapon.js reads this position as home).
  const magGeo = merge([
    box(0.032, 0.09, 0.046, O, [0, -0.045, -0.04], [-0.08, 0, 0], sPoly),
    box(0.03, 0.085, 0.042, O, [0, -0.125, -0.052], [-0.2, 0, 0], sPoly),
    box(0.028, 0.05, 0.04, O, [0, -0.19, -0.062], [-0.1, 0, 0], sPoly),
    box(0.036, 0.016, 0.05, OD, [0, -0.218, -0.066], [-0.1, 0, 0], sPoly), // floor plate
    box(0.034, 0.01, 0.008, OD, [0, -0.08, -0.016], undefined, sPoly), // rib
    box(0.034, 0.01, 0.008, OD, [0, -0.125, -0.02], undefined, sPoly), // rib
    box(0.034, 0.01, 0.008, OD, [0, -0.17, -0.027], undefined, sPoly), // rib
    bolt([0.016, -0.1, -0.045], OD, 0.009), // witness hole
    bolt([0.016, -0.15, -0.052], OD, 0.009),
    cyl(0.0095, 0.0095, 0.012, BRASS, [0, 0, -0.034], [Math.PI / 2, 0, 0], 10, sBrass), // the one visible round
  ]);
  const mag = new THREE.Mesh(magGeo, matLit);
  mag.position.set(0, boreY - 0.045, -0.052);

  // bolt carrier group: visible through the ejection port, racked +Z (rearward) when the game fires or reloads.
  const boltGeo = merge([
    box(0.022, 0.026, 0.07, STEEL_DARK, [0, 0, 0], undefined, sSteel), // carrier body
    box(0.018, 0.02, 0.012, STEEL, [0, -0.002, -0.038], undefined, sSteel), // bolt face
    box(0.005, 0.01, 0.02, W, [0.012, 0.006, -0.03], undefined, sAlumWorn), // extractor
  ]);
  const boltPart = new THREE.Mesh(boltGeo, matLit);
  boltPart.position.set(0.024, boreY + 0.006, -0.07);

  // sight: empty at the centre of the window; the dot floats there.
  const sight = new THREE.Object3D();
  sight.position.set(0, 0.168, -0.11);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), matDot);
  paint(dot.geometry, 0xffffff);
  sight.add(dot);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, boreY, -0.7);

  // --- arms: five-fingered gloved hands, built directly in the gun's own coordinates (no extra transform to
  // compound) so each waypoint below is exactly where it ends up. Every finger is a jointChain: struts through
  // explicit points, not a curl angle, so nothing here depends on guessing a rotation's sign. -------------------

  /**
   * The firing hand: middle/ring/pinky wrap the grip from its back-right round to its front; the index runs
   * nearly straight along the right side of the trigger guard/frame rather than wrapping, per the brief; the
   * thumb wraps the other way, over the top-left, resting near the selector.
   */
  function buildFiringHand() {
    const parts = [
      ...jointChain(
        [
          [0.0261, -0.0501, 0.0421],
          [0.025, -0.0501, 0.0159],
          [0.0051, -0.0548, -0.0219],
        ],
        [0.011, 0.009, 0.007],
        PAINT.glove,
        sGlove,
      ), // middle: waypoints projected onto the grip's own (tilted, non-circular) box surface, + finger radius
      ...jointChain(
        [
          [0.0266, -0.0851, 0.0399],
          [0.0235, -0.0852, 0.0134],
          [0.0078, -0.0889, -0.0155],
        ],
        [0.0105, 0.0085, 0.0065],
        PAINT.glove,
        sGlove,
      ), // ring
      ...jointChain(
        [
          [0.0255, -0.115, 0.0372],
          [0.0219, -0.1155, 0.0108],
          [0.0127, -0.1184, -0.0098],
        ],
        [0.009, 0.0075, 0.006],
        PAINT.glove,
        sGlove,
      ), // pinky
      ...jointChain(
        [
          [0.02, 0.005, 0.025],
          [0.019, -0.005, -0.015],
          [0.016, -0.012, -0.05],
        ],
        [0.0105, 0.009, 0.0075],
        PAINT.glove,
        sGlove,
      ), // index: straight along the guard, not wrapped
      ...jointChain(
        [
          [-0.016, -0.01, 0.048],
          [-0.028, 0.012, 0.025],
          [-0.027, 0.025, -0.008],
        ],
        [0.012, 0.0095, 0.008],
        PAINT.glove,
        sGlove,
      ), // thumb
    ];
    const palm = [0.0467, -0.0823, 0.0458]; // also projected onto the grip surface, same way as the fingertips
    const wrist = [0.0395, -0.1033, 0.0651];
    const elbow = [0.0725, -0.2433, 0.2201];
    const away = [0.1175, -0.3833, 0.4401];
    parts.push(
      ball(0.034, PAINT.glove, palm, 8, sGlove), // back of the hand
      strut([0.033, -0.044, 0.048], [0.031, -0.11, 0.042], 0.012, 0.01, PAINT.knuckle, 6, { rough: 0.55, metal: 0.1 }), // knuckle guard
      strut(palm, wrist, 0.033, 0.036, PAINT.glove, 8, sGlove),
      ball(0.036, PAINT.sleeve, wrist, 8, sFabric), // cuff
      strut(wrist, elbow, 0.036, 0.04, PAINT.sleeve, 8, sFabric),
      ball(0.041, PAINT.sleeve, elbow, 8, sFabric), // elbow bend
      strut(elbow, away, 0.04, 0.046, PAINT.sleeve, 8, sFabric), // sleeve trails well back/down, off-screen
    );
    return merge(parts);
  }

  /**
   * The support hand: four fingers wrap up the near (-X) side of the handguard's round, one knuckle line per
   * finger along Z; the thumb crosses over the top, resting forward along the rail side of the tube.
   */
  function buildSupportHand() {
    const parts = [
      ...jointChain(
        [
          [-0.0182, 0.0391, -0.3],
          [-0.0415, 0.078, -0.3],
          [-0.017, 0.1142, -0.3],
        ],
        [0.0105, 0.009, 0.0075],
        PAINT.glove,
        sGlove,
      ), // index: waypoints projected onto the handguard's actual round surface, + finger radius, so they ride
      // its outside rather than cutting through it
      ...jointChain(
        [
          [-0.0147, 0.0376, -0.325],
          [-0.0413, 0.0816, -0.325],
          [-0.0104, 0.1166, -0.325],
        ],
        [0.0105, 0.009, 0.0075],
        PAINT.glove,
        sGlove,
      ), // middle
      ...jointChain(
        [
          [-0.0108, 0.0374, -0.35],
          [-0.0405, 0.078, -0.35],
          [-0.0134, 0.1146, -0.35],
        ],
        [0.0095, 0.008, 0.0065],
        PAINT.glove,
        sGlove,
      ), // ring
      ...jointChain(
        [
          [-0.0071, 0.0381, -0.375],
          [-0.0393, 0.0745, -0.375],
          [-0.019, 0.1109, -0.375],
        ],
        [0.008, 0.007, 0.0055],
        PAINT.glove,
        sGlove,
      ), // pinky
      ...jointChain(
        [
          [-0.02, 0.07, -0.305],
          [0.0, 0.108, -0.32],
          [0.012, 0.111, -0.355],
        ],
        [0.013, 0.0105, 0.009],
        PAINT.glove,
        sGlove,
      ), // thumb, crossing over the top
    ];
    const palm = [-0.0194, 0.017, -0.3375]; // projected onto the handguard surface, same way as the fingertips
    const wrist = [-0.0233, 0.0225, -0.3125];
    const elbow = [-0.0813, -0.1275, -0.2375];
    const away = [-0.1513, -0.2775, -0.1175];
    parts.push(
      ball(0.034, PAINT.glove, palm, 8, sGlove), // back of the hand
      strut([-0.0138, 0.0425, -0.302], [-0.012, 0.044, -0.373], 0.012, 0.01, PAINT.knuckle, 6, {
        rough: 0.55,
        metal: 0.1,
      }), // knuckle guard, index to pinky
      strut(palm, wrist, 0.033, 0.036, PAINT.glove, 8, sGlove),
      ball(0.036, PAINT.sleeve, wrist, 8, sFabric), // cuff
      strut(wrist, elbow, 0.036, 0.04, PAINT.sleeve, 8, sFabric),
      ball(0.041, PAINT.sleeve, elbow, 8, sFabric), // elbow bend
      strut(elbow, away, 0.04, 0.046, PAINT.sleeve, 8, sFabric), // sleeve trails well back/down, off-screen
    );
    return merge(parts);
  }

  const armR = new THREE.Mesh(buildFiringHand(), matLit);
  const armL = new THREE.Mesh(buildSupportHand(), matLit);

  const root = new THREE.Group();
  root.add(body, mag, boltPart, armL, armR, muzzle, sight);

  return { root, parts: { body, mag, bolt: boltPart, armL, armR, muzzle, sight, dot } };
}

// ===================================================================================================================
/**
 * One centrifuge casing; the game draws hundreds of them with instancing. Centred on the origin, base on y = 0.
 * Every internal join is radius-matched to its neighbour so the touching end caps can be dropped (invisible,
 * since nothing can ever see between two flush solids) — this is what keeps 8-sided drums this tall in budget.
 * The low tier (phones, hundreds of instances, almost no triangle headroom) stops at the plain casing below;
 * medium/high add a bolted flange, a second coupling band and pipe-stub collars (gated on `geoDetail.bevel`,
 * which is exactly the medium/low split — see setGeoDetail in geo.js).
 */
export function buildCentrifugeGeometry() {
  const sides = 8;
  const parts = [
    // foot: flares out at the (never-seen) floor contact and necks up to meet the casing's radius exactly
    drum(
      0.21,
      0.235,
      0.14,
      PAINT.centrifugeFoot,
      [0, 0.07, 0],
      sides,
      { bottom: 0.7, top: 1 },
      { top: false, bottom: false },
    ),
    drum(
      0.21,
      0.21,
      2.64,
      PAINT.centrifugeCasing,
      [0, 1.46, 0],
      sides,
      { bottom: 0.85, top: 1.05 },
      { top: false, bottom: false },
    ),
    // band steps out past the casing on both sides, so it alone needs both its caps
    drum(0.225, 0.225, 0.1, PAINT.centrifugeBand, [0, 2.83, 0], sides, undefined, { top: true, bottom: true }),
    drum(
      0.14,
      0.21,
      0.12,
      PAINT.centrifugeCasing,
      [0, 2.94, 0],
      sides,
      { bottom: 1, top: 1.1 },
      { top: false, bottom: false },
    ),
    drum(0.14, 0.14, 0.09, PAINT.centrifugeFoot, [0, 3.045, 0], sides, undefined, { top: true, bottom: false }),
    drum(0.014, 0.016, 0.21, PAINT.centrifugeFoot, [0.07, 3.195, 0], 6, undefined, { top: true, bottom: false }),
    drum(0.014, 0.016, 0.21, PAINT.centrifugeFoot, [-0.07, 3.195, 0], 6, undefined, { top: true, bottom: false }),
  ];
  // medium/high only — the low tier above already reads clean and has almost no triangle headroom left.
  if (geoDetail.bevel) {
    parts.push(
      // a wider bolted mounting flange partway up the foot
      drum(0.26, 0.26, 0.025, PAINT.centrifugeFoot, [0, 0.1, 0], 6, undefined, { top: true, bottom: true }),
      // a second coupling band lower down the casing — same sides/radius as the existing band so its
      // octagon lines up with the casing's underneath it instead of leaving corner gaps
      drum(0.225, 0.225, 0.045, PAINT.centrifugeBand, [0, 1.35, 0], sides, undefined, { top: true, bottom: true }),
      // small gland collars where the header-pipe stubs root into the top fitting
      ring(0.021, 0.016, PAINT.centrifugeFoot, [0.07, 3.1, 0], undefined, 6),
      ring(0.021, 0.016, PAINT.centrifugeFoot, [-0.07, 3.1, 0], undefined, 6),
    );
  }
  return merge(parts);
}

// ===================================================================================================================
/** A demolition charge. Its back lies in the plane z = 0 and it stands out towards -Z. */
export function buildCharge() {
  const O = PAINT.chargeOlive;
  const OD = PAINT.chargeOliveDark;
  const matLit = lit({ vertexColors: true, rim: 0.5 });
  const matLed = glow({ color: 0xff4020, intensity: 2 });

  const parts = [
    box(0.36, 0.24, 0.11, O, [0, 0, -0.055], undefined, { bottom: 0.8, top: 1 }),
    box(0.32, 0.024, 0.016, OD, [0, 0.07, -0.118]),
    box(0.32, 0.024, 0.016, OD, [0, 0, -0.118]),
    box(0.32, 0.024, 0.016, OD, [0, -0.07, -0.118]),
    box(0.045, 0.26, 0.018, PAINT.chargeStrap, [0.1, 0, -0.121]),
    box(0.045, 0.26, 0.018, PAINT.chargeStrap, [-0.1, 0, -0.121]),
    box(0.1, 0.075, 0.016, PAINT.chargeKeypad, [0.1, -0.07, -0.122]),
    box(0.03, 0.016, 0.01, PAINT.chargeStrap, [0.1, -0.05, -0.133]), // one raised keypad button reads at this scale
    strut([-0.15, -0.085, -0.1], [-0.12, -0.06, -0.13], 0.007, 0.007, PAINT.chargeCable, 6, undefined, true),
    // rotate about the torus's own centre first -- rotating after translate would swing it around the world
    // origin instead and bury it inside the block
    new THREE.TorusGeometry(0.026, 0.0065, 4, 8).rotateY(0.3).translate(-0.145, -0.095, -0.125),
  ];
  paint(parts[parts.length - 1], PAINT.chargeCable);
  const root = new THREE.Group();
  const bodyMesh = new THREE.Mesh(merge(parts), matLit);
  const led = new THREE.Mesh(box(0.013, 0.013, 0.006, 0xffffff, [0.1, -0.025, -0.131]), matLed);
  root.add(bodyMesh, led);

  return { root, parts: { led } };
}

// ===================================================================================================================
/** The lodestar: the beacon the strike homes on. ~1.1 m tall, standing on y = 0 at the origin. */
export function buildBeacon() {
  const S = PAINT.beaconSand;
  const O = PAINT.beaconOlive;
  const D = PAINT.beaconDark;
  const matLit = lit({ vertexColors: true, rim: 0.5 });
  const matLamp = glow({ color: 0xffb347, intensity: 2.2 });

  const hubY = 0.34;
  const legParts = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const foot = [Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42];
    legParts.push(
      strut([0, hubY, 0], foot, 0.022, 0.016, O, 6, { bottom: 0.8, top: 1.05 }),
      box(0.05, 0.02, 0.05, D, [foot[0], 0.01, foot[2]]),
    );
  }

  const mastParts = [
    cyl(0.05, 0.065, 0.1, D, [0, hubY, 0], undefined, 8), // hub collar
    cyl(0.028, 0.034, 0.5, S, [0, 0.62, 0], undefined, 8, { bottom: 0.85, top: 1.05 }), // mast
    box(0.12, 0.16, 0.08, O, [0, 0.5, 0.07]), // battery box
    box(0.1, 0.02, 0.07, D, [0, 0.58, 0.075]),
    ring(0.038, 0.05, PAINT.beaconAmber, [0, 0.78, 0], undefined, 8), // amber band
    cyl(0.03, 0.022, 0.1, S, [0, 0.92, 0], undefined, 8), // mast top / dish pivot collar
  ];

  const root = new THREE.Group();
  const body = new THREE.Mesh(merge([...legParts, ...mastParts]), matLit);

  // dish: origin on the mast axis; the tilt is baked into the geometry so rotation.y stays free for panning.
  const dishProfile = [new THREE.Vector2(0.015, 0), new THREE.Vector2(0.07, 0.025), new THREE.Vector2(0.14, 0.05)];
  const dishGeo = place(paint(new THREE.LatheGeometry(dishProfile, 10), S, { bottom: 0.9, top: 1.1 }), {
    rot: [Math.PI * 0.42, 0, 0],
  });
  const dishParts = merge([dishGeo, strut([0, 0, 0], [0, 0.07, -0.01], 0.012, 0.016, D, 6)]);
  const dish = new THREE.Mesh(dishParts, matLit);
  dish.position.set(0, 0.95, 0);

  const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), matLamp);
  lamp.position.set(0, 1.04, 0);
  paint(lamp.geometry, 0xffffff);

  root.add(body, dish, lamp);

  return { root, parts: { lamp, dish } };
}
