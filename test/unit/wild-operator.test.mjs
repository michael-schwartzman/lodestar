// The player's own figure (src/wild/operator.js): built of three.js primitives alone, with no browser in it.
// Contract lock: about 1.8 m standing and 1.2 m crouched, feet at y = 0, a triangle count a drone's camera can
// afford, every named part the brief calls for, every mesh lit by the probe system (ownMaterials finds it), and
// facing −Z — the game's own "forward" at yaw 0 — so the slate and the carbine read in front and the pack behind.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { lit, glow, ownMaterials } from '../../src/gfx/materials.js';
import { buildOperator, setOperatorCrouch, STAND_HEIGHT, CROUCH_HEIGHT } from '../../src/wild/operator.js';

const lib = { lit, glow, ownMaterials };

function heightOf(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  return { height: box.max.y - box.min.y, feet: box.min.y };
}

function triangleCount(root) {
  let tris = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return tris;
}

test('it is a wild-operator group, about STAND_HEIGHT tall, standing with its feet at 0', () => {
  const { root } = buildOperator(lib);
  assert.equal(root.name, 'wild-operator');
  assert.equal(root.isGroup, true);
  const { height, feet } = heightOf(root);
  assert.ok(Math.abs(feet) < 1e-3, `feet at ${feet}`);
  assert.ok(Math.abs(height - STAND_HEIGHT) < 0.1, `${height} is not about ${STAND_HEIGHT}`);
});

test('between 600 and 6 000 triangles', () => {
  const { root } = buildOperator(lib);
  const tris = triangleCount(root);
  assert.ok(tris >= 600 && tris <= 6000, `${tris} triangles`);
});

test('its main parts are named', () => {
  const { parts } = buildOperator(lib);
  for (const key of ['head', 'torso', 'pack', 'antenna', 'slate', 'rifle', 'legL', 'legR', 'armL', 'armR']) {
    assert.ok(parts[key]?.isObject3D, `parts.${key} is not a built part`);
  }
});

test('it faces −Z: the slate and the carbine are in front of the waist, the pack behind it', () => {
  const { root, parts } = buildOperator(lib);
  root.updateMatrixWorld(true);
  const z = (part) => new THREE.Vector3().setFromMatrixPosition(part.matrixWorld).z;
  const waistZ = z(parts.upperBody);
  assert.ok(z(parts.slate) < waistZ, 'the slate is not in front');
  assert.ok(z(parts.rifle) < waistZ, 'the carbine is not in front');
  assert.ok(z(parts.pack) > waistZ, 'the pack is not behind');
});

test('every mesh is lit by the probe system (ownMaterials finds it — none is a bare three.js material)', () => {
  const { root } = buildOperator(lib);
  let meshes = 0;
  let tagged = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.material?.userData?.lode) tagged++;
  });
  assert.ok(meshes > 0);
  assert.equal(tagged, meshes, `${meshes - tagged} of ${meshes} meshes would not be tinted`);
});

test('it carries its own lit and glow materials (the antenna tip and the slate face)', () => {
  const { mats } = buildOperator(lib);
  assert.ok(mats.lit.length > 0);
  assert.equal(mats.glow.length, 2, 'the antenna tip and the slate face');
});

test('crouched, it is a lower pose — about CROUCH_HEIGHT tall — and standing straightens it back up', () => {
  const { root, parts } = buildOperator(lib);
  const stand = heightOf(root);
  setOperatorCrouch(parts, true);
  const crouch = heightOf(root);
  assert.ok(Math.abs(crouch.feet) < 1e-3, `feet at ${crouch.feet} crouched`);
  assert.ok(Math.abs(crouch.height - CROUCH_HEIGHT) < 0.1, `${crouch.height} is not about ${CROUCH_HEIGHT}`);
  assert.ok(crouch.height < stand.height - 0.3, 'a crouch this close to standing is not a lower pose');
  setOperatorCrouch(parts, false);
  const restood = heightOf(root);
  assert.ok(Math.abs(restood.height - stand.height) < 1e-6, 'standing back up does not return the same height');
});
