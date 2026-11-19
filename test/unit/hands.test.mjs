// Contract lock: the hands the player holds a gun with read as arms, not posts; nothing of a gun floats loose
// of the part it belongs to; and nothing of a gun or its hands ever stands in the sight's own window.
//
// 16 November 2026. The owner plays in first person and said: "the hand holding the gun is slightly off". Looking
// closer, three faults, worst first: (1) the carbine's and the shotgun's support arm stood up like a post — its
// wrist on the near (left) side of the handguard/pump, its sleeve falling almost straight down — instead of
// cupping the thing held from below and trailing back to the shooter's own elbow, down and to the LEFT, off the
// bottom-left of the picture; (2) the carbine's ten suppressor rings were built at y = 0 instead of the bore's own
// height (0.082), so they hung eight centimetres under the muzzle, in mid-air; (3) hands in general — sized,
// fitted and jointed against whatever each is really holding. This file holds the geometry to all three, so none
// of them can drift back unnoticed: it must fail before the fix and pass after it (`node --test
// test/unit/hands.test.mjs`), and it must go on passing with every later change to these models.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { setGeoDetail } from '../../src/gfx/geo.js';
import { buildCarbine } from '../../src/gfx/next/carbine.js';
import { buildPistol, buildShotgun, buildGrenadeBody, buildGrenade } from '../../src/gfx/next/sidearms.js';
import { buildKnife } from '../../src/gfx/next/knife.js';

// The builders run in node, with no renderer: this is the detail level the second look draws at ("medium" —
// test/unit/matter.test.mjs's own `second(true)` — DESIGN.md §8, `look=2`), the one the triangle ceilings below
// are counted at.
setGeoDetail({ bevel: true, round: 1.5, matter: true });

// ---------- geometry helpers: a corner at a time, however the caller has positioned the root ----------

/** every corner of one mesh (indexed or not), carried into whatever space its own `matrixWorld` describes */
function worldCorners(mesh) {
  const pos = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const n = index ? index.count : pos.count;
  const m = mesh.matrixWorld.elements;
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = index ? index.getX(i) : i;
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    out.push([
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ]);
  }
  return out;
}

/** every corner of an object and all its descendant meshes (a part plus whatever `lettering()` hung off it) */
function allCorners(object) {
  const out = [];
  object.traverse((o) => {
    if (o.isMesh) out.push(...worldCorners(o));
  });
  return out;
}

const mean = (points) => {
  const m = [0, 0, 0];
  for (const p of points) {
    m[0] += p[0];
    m[1] += p[1];
    m[2] += p[2];
  }
  return [m[0] / points.length, m[1] / points.length, m[2] / points.length];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** a line through `a` (world space) along the gun's own +Z, as it stands once `root`'s matrixWorld is current */
function axisLine(root, boreY) {
  const a = new THREE.Vector3(0, boreY, 0).applyMatrix4(root.matrixWorld);
  const b = new THREE.Vector3(0, boreY, -1).applyMatrix4(root.matrixWorld);
  return { a, d: b.sub(a).normalize() };
}
function distToLine(p, line) {
  const q = new THREE.Vector3(p[0], p[1], p[2]).sub(line.a);
  const t = q.dot(line.d);
  return q.addScaledVector(line.d, -t).length();
}

// How each gun sits at the hip (src/weapon.js FEEL), and the bore's own height in its model space (carbine:
// the fault report's own 0.082; shotgun: src/gfx/next/sidearms.js buildShotgun's own `boreY`, 0.095 — higher,
// since the tube magazine stacks under it).
const HIP = {
  carbine: { hip: [0.2, -0.215, -0.47], turn: 0.04, boreY: 0.082 },
  shotgun: { hip: [0.17, -0.2, -0.42], turn: 0.1, boreY: 0.095 },
};
const AIM_EYE = { carbine: 0.3, pistol: 0.22, shotgun: 0.2 };

// ---------- test 1: nothing of the carbine's body hangs under the muzzle ----------

test('the carbine: nothing forward of the handguard hangs off the bore — every such corner of the body is within 4 cm of its axis', () => {
  const { root, parts } = buildCarbine();
  root.updateMatrixWorld(true); // root is untouched: this is the gun's own space, exactly as the fault report gives it
  const BORE_Y = 0.082;
  const forward = allCorners(parts.body).filter(([, , z]) => z < -0.5);
  assert.ok(forward.length > 50, `too few corners forward of the handguard to mean anything: ${forward.length}`);
  const stray = forward.filter(([x, y]) => Math.hypot(x, y - BORE_Y) > 0.04);
  assert.deepEqual(
    stray.map(([x, y, z]) => [x.toFixed(3), (y - BORE_Y).toFixed(3), z.toFixed(3)]),
    [],
    `${stray.length} of ${forward.length} corners forward of the handguard are more than 4 cm off the bore's axis`,
  );
});

// ---------- test 2: the support arm reads as an arm, not a post — at the hip, carbine and shotgun ----------

function checkSupportArmAtHip(key, build) {
  const { root, parts } = build();
  const feel = HIP[key];
  root.position.set(...feel.hip);
  root.rotation.set(0, feel.turn, 0);
  root.updateMatrixWorld(true);
  const corners = allCorners(parts.armL);
  assert.ok(corners.length > 50, `${key}: too few corners in armL to mean anything: ${corners.length}`);
  const line = axisLine(root, feel.boreY);
  const near = corners.filter((p) => distToLine(p, line) <= 0.12);
  assert.ok(near.length > 0, `${key}: nothing of armL lies within 12 cm of the gun's own axis — where is the hand?`);
  const hand = mean(near);
  const byFarness = corners.map((p) => [p, dist(p, hand)]).sort((a, b) => b[1] - a[1]);
  const farCount = Math.max(1, Math.round(corners.length * 0.05));
  const sleeveEnd = mean(byFarness.slice(0, farCount).map(([p]) => p));

  const left = hand[0] - sleeveEnd[0];
  const below = hand[1] - sleeveEnd[1];
  const nearer = sleeveEnd[2] - hand[2];
  assert.ok(left >= 0.15, `${key}: the sleeve's end is only ${(left * 100).toFixed(1)} cm left of the hand`);
  assert.ok(below >= 0.1, `${key}: the sleeve's end is only ${(below * 100).toFixed(1)} cm below the hand`);
  assert.ok(
    nearer >= 0.15,
    `${key}: the sleeve's end is only ${(nearer * 100).toFixed(1)} cm nearer the eye than the hand`,
  );

  // and it must actually be off the picture: a 55° vertical field of view, 16:9, eye at the origin looking -Z
  const halfH = Math.tan((55 * Math.PI) / 360);
  const halfW = halfH * (16 / 9);
  const forwardDist = -sleeveEnd[2];
  const offFrame =
    forwardDist <= 1e-6 || sleeveEnd[1] / (forwardDist * halfH) < -1 || sleeveEnd[0] / (forwardDist * halfW) < -1;
  assert.ok(
    offFrame,
    `${key}: the sleeve's end still projects inside the picture at ${sleeveEnd.map((v) => v.toFixed(3))}`,
  );
}

test('the carbine, at the hip: the support arm trails down and left to the elbow, off the bottom-left of the picture', () => {
  checkSupportArmAtHip('carbine', buildCarbine);
});

test('the shotgun, at the hip: the support arm (on the pump) trails down and left the same way', () => {
  checkSupportArmAtHip('shotgun', buildShotgun);
});

// ---------- test 3: aimed, nothing stands between the eye and what is aimed at ----------

/** Möller–Trumbore: does the ray from the origin along unit `d` cross triangle a,b,c, closer than infinity? */
function crossesTriangle(d, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < 1e-12) return false;
  const u = -(a[0] * h[0] + a[1] * h[1] + a[2] * h[2]) / det;
  if (u < 0 || u > 1) return false;
  const q = [-(a[1] * e1[2] - a[2] * e1[1]), -(a[2] * e1[0] - a[0] * e1[2]), -(a[0] * e1[1] - a[1] * e1[0])];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
  if (v < 0 || u + v > 1) return false;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
  return t > 1e-4;
}

/** names of every mesh (but the sight's own glow) that any of the five sight-window rays crosses, aimed */
function inTheWay(root, sightLocal) {
  const sightWorld = sightLocal.clone().applyMatrix4(root.matrixWorld);
  const rays = [
    [0, 0],
    [0.003, 0],
    [-0.003, 0],
    [0, 0.003],
    [0, -0.003],
  ].map(([dx, dy]) => {
    const v = new THREE.Vector3(sightWorld.x + dx, sightWorld.y + dy, sightWorld.z);
    return [v.x / v.length(), v.y / v.length(), v.z / v.length()];
  });
  const crossed = [];
  root.traverse((o) => {
    if (!o.isMesh || o.material?.userData?.lode === 'glow') return;
    for (let up = o; up; up = up.parent) if (!up.visible) return;
    const corners = worldCorners(o);
    const n = corners.length;
    for (let i = 0; i + 2 < n; i += 3) {
      const [a, b, c] = [corners[i], corners[i + 1], corners[i + 2]];
      if (rays.some((ray) => crossesTriangle(ray, a, b, c))) {
        crossed.push(o.name || 'a part of the gun');
        break;
      }
    }
  });
  return crossed;
}

function checkSightClear(key, build) {
  const { root, parts } = build();
  const sightLocal = parts.sight.position.clone();
  const eye = AIM_EYE[key];
  root.position.set(-sightLocal.x, -sightLocal.y, -eye - sightLocal.z);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  assert.deepEqual(inTheWay(root, sightLocal), [], `${key}, aimed: something stands between the eye and the target`);
}

test('the carbine, aimed: nothing of the gun or its hands stands between the eye and the target', () => {
  checkSightClear('carbine', buildCarbine);
});
test('the pistol, aimed: nothing of the gun or its hands stands between the eye and the target', () => {
  checkSightClear('pistol', buildPistol);
});
test('the shotgun, aimed: nothing of the gun or its hands stands between the eye and the target', () => {
  checkSightClear('shotgun', buildShotgun);
});

// ---------- test 4: the contract every builder must keep — same keys, nothing more, nothing less ----------

const assertParts = (built, keys) => assert.deepEqual(Object.keys(built.parts).sort(), [...keys].sort());

test('each builder returns exactly the parts keys the game relies on', () => {
  assertParts(buildCarbine(), ['body', 'mag', 'bolt', 'armL', 'armR', 'muzzle', 'sight', 'dot']);
  assertParts(buildPistol(), ['body', 'bolt', 'mag', 'armR', 'armL', 'muzzle', 'sight']);
  assertParts(buildShotgun(), ['body', 'bolt', 'armR', 'armL', 'mag', 'muzzle', 'sight', 'shell']);
  assertParts(buildGrenadeBody(), ['band']);
  assertParts(buildGrenade(), ['grenade', 'band']);
  assertParts(buildKnife(), ['knife']);
});
