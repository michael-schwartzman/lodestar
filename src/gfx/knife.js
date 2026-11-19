// The knife: what is in the left hand when there is no time, or no ammunition, for anything else.
// Built the way every model is (docs/DESIGN.md §8.1): painted primitives, no textures. It points down −Z.
import * as THREE from 'three';
import { lit } from './materials.js';
import { box, cyl, merge } from './geo.js';

const STEEL = 0x858d94;
const EDGE = 0xc6ced3;
const GRIP = 0x191b1d;
const GLOVE = 0x2b3035;
const KNUCKLE = 0x3d444a;
const SLEEVE = 0x39402f;

const steel = { rough: 0.3, metal: 0.95, bevel: 0.002 };
const rubber = { rough: 0.88, metal: 0 };
const cloth = { rough: 0.93, metal: 0 };

/**
 * @returns {{ root: THREE.Group, parts: { knife: THREE.Mesh } }} the blade, its guard and grip, and the gloved
 *   fist and forearm that hold it — one mesh, placed by weapon.js in the same little scene as the carbine
 */
export function buildKnife() {
  const HALF = Math.PI / 2;
  const geometry = merge([
    // the blade: a flat bar, a narrower run towards the point, and the point itself turned down to the edge
    box(0.0055, 0.034, 0.12, STEEL, [0, 0, -0.09], undefined, steel),
    box(0.005, 0.029, 0.05, STEEL, [0, -0.0025, -0.172], undefined, steel),
    box(0.0045, 0.022, 0.045, STEEL, [0, -0.008, -0.208], [0.3, 0, 0], steel),
    // the ground edge, brighter than the flat
    box(0.0022, 0.007, 0.16, EDGE, [0, -0.0175, -0.108], undefined, { rough: 0.16, metal: 1, bevel: false }),
    // a fuller down the flat, each side
    box(0.0012, 0.006, 0.09, 0x60676d, [0.0032, 0.006, -0.1], undefined, { rough: 0.45, metal: 0.9, bevel: false }),
    box(0.0012, 0.006, 0.09, 0x60676d, [-0.0032, 0.006, -0.1], undefined, { rough: 0.45, metal: 0.9, bevel: false }),
    // guard, grip with three ribs, pommel
    box(0.016, 0.062, 0.012, GRIP, [0, -0.002, -0.024], undefined, { rough: 0.5, metal: 0.75 }),
    cyl(0.0155, 0.0175, 0.112, GRIP, [0, 0, 0.038], [HALF, 0, 0], 10, rubber),
    cyl(0.0185, 0.0185, 0.007, 0x0f1011, [0, 0, 0.012], [HALF, 0, 0], 10, rubber),
    cyl(0.0185, 0.0185, 0.007, 0x0f1011, [0, 0, 0.04], [HALF, 0, 0], 10, rubber),
    cyl(0.0185, 0.0185, 0.007, 0x0f1011, [0, 0, 0.068], [HALF, 0, 0], 10, rubber),
    cyl(0.019, 0.019, 0.012, STEEL, [0, 0, 0.1], [HALF, 0, 0], 10, { rough: 0.42, metal: 0.9 }),
    // the fist round the grip: palm, four fingers wrapped under, the thumb along the top
    box(0.062, 0.05, 0.088, GLOVE, [0.004, 0.02, 0.042], undefined, cloth),
    cyl(0.0125, 0.0125, 0.066, GLOVE, [0.006, -0.02, 0.006], [0, 0, HALF], 8, cloth),
    cyl(0.013, 0.013, 0.068, GLOVE, [0.006, -0.022, 0.03], [0, 0, HALF], 8, cloth),
    cyl(0.013, 0.013, 0.066, GLOVE, [0.006, -0.022, 0.054], [0, 0, HALF], 8, cloth),
    cyl(0.0115, 0.0115, 0.06, GLOVE, [0.006, -0.02, 0.077], [0, 0, HALF], 8, cloth),
    cyl(0.013, 0.0115, 0.062, GLOVE, [-0.03, 0.022, 0.008], [HALF - 0.25, 0, 0.2], 8, cloth),
    box(0.068, 0.014, 0.07, KNUCKLE, [0.004, 0.048, 0.04], undefined, { rough: 0.6, metal: 0.1 }),
    // wrist and forearm, running back and down out of the picture
    cyl(0.033, 0.036, 0.05, 0x14171a, [0.008, 0.0, 0.108], [HALF - 0.2, 0, 0], 12, rubber),
    cyl(0.038, 0.05, 0.36, SLEEVE, [0.012, -0.06, 0.29], [HALF - 0.36, 0, 0], 12, cloth),
  ]);
  const knife = new THREE.Mesh(geometry, lit({ vertexColors: true, rim: 0.45 }));
  knife.frustumCulled = false;
  const root = new THREE.Group();
  root.add(knife);
  return { root, parts: { knife } };
}
