// The player's own figure, built of three.js primitives alone — boxes, cylinders, a sphere, two capsules — for the
// one moment it is ever seen: standing where the body was left while the hands are flown out in a drone
// (operator-live.js). No textures, no files; its colours are the first-person arms' own (src/gfx/models.js
// PAINT.sleeve/glove/knuckle, read there, not imported here — this file is fenced to three.js alone). It must
// read as a soldier, not as one of WARDEN's machines: darker and narrower than a sentry, a rounder head, cloth
// not plate.
import * as THREE from 'three';

/** feet to the top of the head, standing — about the player's own (src/player.js PLAYER.height) */
export const STAND_HEIGHT = 1.8;
/** feet to the top of the head, crouched — a lower pose, knees bent, is enough */
export const CROUCH_HEIGHT = 1.2;

const UP = new THREE.Vector3(0, 1, 0);

/** cloth and armour, taken from the first-person arms so that this is seen as the same person */
const PAINT = {
  cloth: 0x2b2f3a, // sleeve
  glove: 0x202123, // boots, gloves
  trim: 0x565b60, // knuckle: a pale-grey accent
  plate: 0x303236, // gunCharcoal: the carrier's armour
  pouch: 0x2e3122, // gunOliveDark
  gun: 0x3f4330, // gunOlive
  gunWorn: 0x45484c, // gunCharcoalWorn
  helmet: 0x1c1e22,
};
/** the uplink's own cold light (the antenna) and the slate's screen (a warmer, display green) */
const GLOW_ANTENNA = 0x55d6ff;
const GLOW_SLATE = 0x8dffcf;

/** standing: ankle/knee/waist, straight up from the foot */
const STAND = { ankleY: 0.09, kneeY: 0.47, kneeZ: 0, waistY: 0.86, waistZ: 0 };
/** crouched: a deep bend, feet planted where they were, the knee driven forward and the waist low — the rest of
 * the figure is also scaled down a little (setOperatorCrouch), so the legs need not do it all */
const CROUCH = { ankleY: 0.09, kneeY: 0.18, kneeZ: -0.19, waistY: 0.3, waistZ: -0.07 };
/** how much the figure above the waist is scaled down, crouched (a little shorter, not just lower) */
const CROUCH_UPPER_SCALE = 0.9;
const HIP_X = 0.11;

/** A straight segment of unit length along local Y, stretched and turned to join two points. */
function segment(radiusTop, radiusBottom, segments, material) {
  return new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, segments), material);
}

/** Stretches, turns and places a unit-length segment mesh so that it runs from `from` to `to`. */
function placeSegment(mesh, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = Math.max(1e-4, dir.length());
  mesh.scale.set(1, len, 1);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}

function box(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

/**
 * Builds one leg (boot, shin, thigh) at the hip's `side` (−1 left, +1 right) of the root, and leaves it posed
 * standing. `setLegPose` moves it between standing and crouched afterwards.
 */
function buildLeg(side, mats) {
  const boot = box(0.1, 0.09, 0.24, mats.glove);
  const shin = segment(0.065, 0.055, 8, mats.cloth);
  const thigh = segment(0.085, 0.075, 8, mats.cloth);
  const group = new THREE.Group();
  group.add(thigh, shin, boot);
  setLegPose({ side, boot, shin, thigh }, STAND);
  return { group, boot, shin, thigh, side };
}

/** Moves one leg's three parts to stand on the ground at (hipX, 0, 0) with the knee and waist `pose` gives. */
function setLegPose(leg, pose) {
  const x = HIP_X * leg.side;
  const ankle = new THREE.Vector3(x, pose.ankleY, 0);
  const knee = new THREE.Vector3(x, pose.kneeY, pose.kneeZ);
  const waist = new THREE.Vector3(x, pose.waistY, pose.waistZ);
  placeSegment(leg.shin, ankle, knee);
  placeSegment(leg.thigh, knee, waist);
  leg.boot.position.set(x, pose.ankleY / 2, 0.02);
}

/** Builds one arm (shoulder to hand) between two fixed joints — the figure is only ever seen flying the drone,
 * so an arm's pose never changes once built. */
function buildArm(shoulder, elbow, wrist, mats) {
  const upper = segment(0.052, 0.046, 8, mats.cloth);
  const fore = segment(0.044, 0.04, 8, mats.cloth);
  // a small sphere, not a capsule: CapsuleGeometry is not otherwise in the main script, and must not become so
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mats.glove);
  hand.scale.set(1, 0.85, 1.15);
  placeSegment(upper, shoulder, elbow);
  placeSegment(fore, elbow, wrist);
  hand.position.copy(wrist);
  const group = new THREE.Group();
  group.add(upper, fore, hand);
  return { group, upper, fore, hand };
}

/**
 * @param {{ lit: Function, glow: Function, ownMaterials: Function }} lib ctx.lib (or, for tests, the real
 *   lit/glow/ownMaterials of src/gfx/materials.js — this file imports neither: see the header)
 * @returns {{ root: THREE.Group, parts: object, mats: { lit: THREE.ShaderMaterial[], glow: THREE.ShaderMaterial[] } }}
 */
export function buildOperator(lib) {
  const { lit, glow, ownMaterials } = lib;
  const mats = {
    cloth: lit({ color: PAINT.cloth, rough: 0.85 }),
    glove: lit({ color: PAINT.glove, rough: 0.8 }),
    trim: lit({ color: PAINT.trim, rough: 0.6, metal: 0.3 }),
    plate: lit({ color: PAINT.plate, rough: 0.55, metal: 0.25 }),
    pouch: lit({ color: PAINT.pouch, rough: 0.9 }),
    gun: lit({ color: PAINT.gun, rough: 0.6, metal: 0.2 }),
    gunWorn: lit({ color: PAINT.gunWorn, rough: 0.5, metal: 0.35 }),
    helmet: lit({ color: PAINT.helmet, rough: 0.5, metal: 0.15 }),
  };

  const root = new THREE.Group();
  root.name = 'wild-operator';

  // ---- legs: the one part of the figure whose pose changes (setOperatorCrouch) ----
  const legL = buildLeg(-1, mats);
  const legR = buildLeg(1, mats);
  root.add(legL.group, legR.group);

  // ---- the body above the waist: one group, lifted to the waist height setOperatorCrouch gives the legs ----
  const upperBody = new THREE.Group();
  upperBody.position.set(0, STAND.waistY, STAND.waistZ);
  root.add(upperBody);

  const hips = box(0.3, 0.12, 0.2, mats.cloth);
  hips.position.set(0, 0.06, 0);

  const torso = new THREE.Group();
  const chest = box(0.38, 0.46, 0.22, mats.cloth);
  chest.position.set(0, 0.12 + 0.23, 0);
  const plateFront = box(0.4, 0.38, 0.1, mats.plate);
  plateFront.position.set(0, 0.16 + 0.19, -0.1);
  const pouchL = box(0.1, 0.1, 0.07, mats.pouch);
  pouchL.position.set(-0.1, 0.18, -0.16);
  const pouchR = box(0.1, 0.1, 0.07, mats.pouch);
  pouchR.position.set(0.1, 0.18, -0.16);
  torso.add(chest, plateFront, pouchL, pouchR);

  const shoulderL = box(0.1, 0.08, 0.16, mats.plate);
  shoulderL.position.set(-0.24, 0.59, 0);
  const shoulderR = box(0.1, 0.08, 0.16, mats.plate);
  shoulderR.position.set(0.24, 0.59, 0);

  const neck = segment(0.05, 0.055, 8, mats.cloth);
  placeSegment(neck, new THREE.Vector3(0, 0.58, 0), new THREE.Vector3(0, 0.66, 0));

  // head: a group pivoting at the neck, so that leaning it down turns it about that joint, not the waist
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 8), mats.helmet);
  helmet.scale.set(1, 1.05, 1.1);
  helmet.position.set(0, 0.13, 0.01);
  const nvgL = segment(0.022, 0.018, 6, mats.trim);
  const nvgR = segment(0.022, 0.018, 6, mats.trim);
  placeSegment(nvgL, new THREE.Vector3(-0.045, 0.19, -0.06), new THREE.Vector3(-0.05, 0.26, -0.14));
  placeSegment(nvgR, new THREE.Vector3(0.045, 0.19, -0.06), new THREE.Vector3(0.05, 0.26, -0.14));
  head.add(helmet, nvgL, nvgR);
  // leans the head down a little: it is looking at the slate, not ahead
  head.rotation.x = 0.2;

  // the right arm hangs; the left is raised, holding the slate up before the chest
  const armR = buildArm(
    new THREE.Vector3(0.21, 0.58, 0),
    new THREE.Vector3(0.23, 0.33, 0.02),
    new THREE.Vector3(0.24, 0.1, 0.04),
    mats,
  );
  const armL = buildArm(
    new THREE.Vector3(-0.21, 0.58, 0),
    new THREE.Vector3(-0.27, 0.5, -0.2),
    new THREE.Vector3(-0.2, 0.52, -0.4),
    mats,
  );

  const slate = new THREE.Group();
  slate.position.copy(armL.hand.position).add(new THREE.Vector3(0.02, 0.02, -0.06));
  slate.rotation.set(-0.9, 0, 0.15);
  const slateBody = box(0.14, 0.09, 0.015, mats.glove);
  const slateFace = box(0.11, 0.065, 0.006, glow({ color: GLOW_SLATE, intensity: 0.9 }));
  slateFace.position.set(0, 0, 0.011);
  slate.add(slateBody, slateFace);

  // the pack, on the back (+Z: the figure faces −Z), with the uplink's whip antenna
  const pack = new THREE.Group();
  pack.position.set(0, 0.42, 0.14);
  const packBody = box(0.22, 0.28, 0.12, mats.plate);
  const antenna = new THREE.Group();
  const antennaRod = segment(0.012, 0.007, 6, mats.trim);
  const tipFrom = new THREE.Vector3(0.05, 0.14, 0.02);
  const tipTo = new THREE.Vector3(0.08, 0.46, 0.09);
  placeSegment(antennaRod, tipFrom, tipTo);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), glow({ color: GLOW_ANTENNA, intensity: 1 }));
  antennaTip.position.copy(tipTo);
  antenna.add(antennaRod, antennaTip);
  pack.add(packBody, antenna);

  // the carbine, slung across the chest — body, grip, magazine, barrel — the left hand busy with the slate instead
  const rifle = new THREE.Group();
  rifle.position.set(0.02, 0.32, -0.14);
  rifle.rotation.set(0, 0, 0.5);
  const rifleBody = box(0.065, 0.08, 0.5, mats.gun);
  const rifleBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.3, 8), mats.gunWorn);
  rifleBarrel.rotation.x = Math.PI / 2;
  rifleBarrel.position.set(0, 0, -0.4);
  const rifleMag = box(0.04, 0.16, 0.06, mats.pouch);
  rifleMag.position.set(0, -0.12, -0.04);
  const rifleStock = box(0.055, 0.07, 0.14, mats.gunWorn);
  rifleStock.position.set(0, 0, 0.3);
  rifle.add(rifleBody, rifleBarrel, rifleMag, rifleStock);

  upperBody.add(hips, torso, shoulderL, shoulderR, neck, head, armL.group, armR.group, slate, pack, rifle);

  const parts = {
    root,
    upperBody,
    legL: legL.group,
    legR: legR.group,
    hips,
    torso,
    head,
    pack,
    antenna,
    antennaTip,
    slate,
    slateFace,
    rifle,
    armL: armL.group,
    armR: armR.group,
    // kept for setOperatorCrouch
    legs: [legL, legR],
  };
  return { root, parts, mats: ownMaterials(root) };
}

/** Moves the figure between standing and a lower, knees-bent crouch — about CROUCH_HEIGHT tall — by moving the
 * legs' joints and lifting the waist the rest of the figure stands on. Pure: no scene, no frame clock. */
export function setOperatorCrouch(parts, crouched) {
  const pose = crouched ? CROUCH : STAND;
  for (const leg of parts.legs) setLegPose(leg, pose);
  parts.upperBody.position.set(0, pose.waistY, pose.waistZ);
  parts.upperBody.scale.set(1, crouched ? CROUCH_UPPER_SCALE : 1, 1);
}
