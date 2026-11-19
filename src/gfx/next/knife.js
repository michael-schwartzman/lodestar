// The knife: what is in the left hand when there is no time, or no ammunition, for anything else. Rebuilt the
// same way the carbine was (src/gfx/next/carbine.js): a blade with a real ground bevel and a fuller, a rounded
// guard and grip, a lathed pommel, a gloved fist — in place of the flat boxes src/gfx/knife.js (the builder this
// replaces) used — to that same contract: one mesh, in parts.knife, origin at the grip, pointing down −Z.
import * as THREE from 'three';
import { lit } from '../materials.js';
import { paint, place, box, merge, sides } from '../geo.js';
import { Outline, extrude } from './extrude.js';
import { buildFist } from './hands.js';
import { STEEL, STEEL_DARK, RUBBER, sAlumWorn, sRubber } from './carbine.js';
import { lettering } from './lettering.js';

const HALF = Math.PI / 2;
const sFuller = { rough: 0.45, metal: 0.85, mat: 'steel' }; // the groove down the flat — duller than the blade

/**
 * @returns {{ root: THREE.Group, parts: { knife: THREE.Mesh } }} the blade, its guard and grip, and the gloved
 *   fist and forearm that hold it — one mesh, placed by weapon.js in the same little scene as the carbine
 */
export function buildKnife() {
  // --- blade: one extruded profile, guard at z=0, tip at z≈-0.194 — not the flat-sided boxes the old builder
  // used. The shape's own +Y is the spine, −Y the edge; the extrusion's own bevel stands in for the real
  // ground bevel (it rounds the whole outline, spine included — a small stylisation), and
  // painting it with a bottom-brighter/top-duller gradient (bottom = min Y = the edge) adds the edge's own
  // highlight with no extra geometry, since this shape's local Y stays the spine/edge axis through everything
  // that follows (rotateY never changes Y).
  const shape = new Outline();
  shape.moveTo(0, 0.0185); // spine, at the guard
  shape.lineTo(0.145, 0.012); // spine, tapering towards the point
  shape.lineTo(0.194, 0); // the point
  shape.quadraticCurveTo(0.17, -0.016, 0.1, -0.0175); // the edge's own belly, a true curve
  shape.lineTo(0.015, -0.0155); // edge, back towards the guard
  shape.lineTo(0, -0.0135); // ricasso, at the guard
  shape.lineTo(0, 0.0185);
  const bladeGeo = extrude(shape, {
    depth: 0.005,
    bevelEnabled: true,
    bevelThickness: 0.0017,
    bevelSize: 0.0017,
    bevelSegments: 3,
    curveSegments: sides(14),
  });
  bladeGeo.translate(0, 0, -0.0025); // centre the thickness on the local Z axis
  bladeGeo.rotateY(HALF); // shape-x (guard→tip) becomes −Z; shape-y (spine/edge) stays Y; depth becomes X
  const blade = paint(bladeGeo, STEEL, { bottom: 1.55, top: 0.85, rough: 0.3, metal: 0.92, mat: 'steel' });

  const fullerParts = [
    box(0.0011, 0.006, 0.13, 0x5e656b, [0.0021, 0.0045, -0.082], undefined, sFuller),
    box(0.0011, 0.006, 0.13, 0x5e656b, [-0.0021, 0.0045, -0.082], undefined, sFuller),
  ]; // a shallow fuller down the flat, each side, nearer the spine than the edge

  // --- guard: a true stadium cross-section — flat sides, both ends a real half-round, not the one-rounded-edge
  // domedBox shape (which only rounds its top) — a cross-guard's both ends stand proud of the blade and both
  // catch the light the same way.
  const gw = 0.01;
  const gCapR = 0.011;
  const gStraight = 0.021;
  const guardShape = new Outline();
  guardShape.moveTo(-gw, -gStraight);
  guardShape.lineTo(-gw, gStraight);
  guardShape.quadraticCurveTo(-gw, gStraight + gCapR, 0, gStraight + gCapR);
  guardShape.quadraticCurveTo(gw, gStraight + gCapR, gw, gStraight);
  guardShape.lineTo(gw, -gStraight);
  guardShape.quadraticCurveTo(gw, -gStraight - gCapR, 0, -gStraight - gCapR);
  guardShape.quadraticCurveTo(-gw, -gStraight - gCapR, -gw, -gStraight);
  const guardGeo = extrude(guardShape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.0025,
    bevelSize: 0.0025,
    bevelSegments: 2,
    curveSegments: sides(10),
  });
  guardGeo.translate(0, 0, -0.007);
  guardGeo.rotateY(HALF);
  guardGeo.translate(0, -0.002, -0.022);
  const guard = paint(guardGeo, STEEL_DARK, sAlumWorn);

  // --- grip: a single lathed taper, rubber, three true ring grooves for the fingers ---------------------------
  const gripParts = [
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0.0145, -0.018],
            [0.0175, -0.004],
            [0.018, 0.014],
            [0.0175, 0.032],
            [0.0155, 0.046],
            [0.0125, 0.058],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(20),
        ),
        RUBBER,
        sRubber,
      ),
      { at: [0, 0, 0], rot: [HALF, 0, 0] },
    ),
    ...[0.01, 0.034, 0.058].map((z) =>
      place(paint(new THREE.TorusGeometry(0.0183, 0.0032, Math.max(4, sides(8)), sides(18)), 0x100f10, sRubber), {
        at: [0, 0, z],
        rot: [0, 0, HALF],
      }),
    ), // the finger grooves — true rings, not flat discs
  ];

  // --- pommel: its own short lathed turning, flared wider than the grip then rounded to a button — steel, not
  // rubber, so it carries its own paint() call and its own mesh. ------------------------------------------------
  const pommel = place(
    paint(
      new THREE.LatheGeometry(
        [
          [0.0125, 0],
          [0.0155, 0.01],
          [0.0175, 0.022],
          [0.0185, 0.03],
          [0.014, 0.038],
          [0.004, 0.044],
        ].map(([r, y]) => new THREE.Vector2(r, y)),
        sides(20),
      ),
      STEEL,
      { rough: 0.38, metal: 0.92, mat: 'steel' },
    ),
    { at: [0, 0, 0.058], rot: [HALF, 0, 0] },
  );

  // --- the gloved fist round the grip: palm, four curled fingers, thumb along the spine side — the same
  // closed-fist helper the grenade uses, so every weapon's hands come from one place. --------------------------
  const fistParts = buildFist({
    fingers: [
      {
        points: [
          [0.006, -0.02, -0.028],
          [0.006, -0.02, 0.034],
        ],
        radii: [0.0125, 0.0105],
      },
      {
        points: [
          [0.006, -0.022, -0.004],
          [0.006, -0.022, 0.056],
        ],
        radii: [0.013, 0.011],
      },
      {
        points: [
          [0.006, -0.022, 0.019],
          [0.006, -0.022, 0.078],
        ],
        radii: [0.013, 0.0108],
      },
      {
        points: [
          [0.006, -0.02, 0.041],
          [0.006, -0.02, 0.098],
        ],
        radii: [0.0115, 0.0095],
      },
    ],
    thumb: {
      points: [
        [-0.03, 0.022, -0.03],
        [-0.03, 0.022, 0.028],
      ],
      radii: [0.013, 0.0112],
    },
    palm: [0.004, 0.02, 0.004],
    palmSize: [0.062, 0.05, 0.088],
    knuckle: [0.004, 0.048, 0.002],
    knuckleSize: [0.068, 0.014, 0.07],
    wrist: [0.008, 0, 0.064],
    wristR: 0.0345,
    elbow: [0.012, -0.06, 0.25],
    elbowR: 0.044,
    away: [0.018, -0.22, 0.55],
    awayR: 0.05,
  });

  const geometry = merge([blade, ...fullerParts, guard, ...gripParts, pommel, ...fistParts]);
  const knife = new THREE.Mesh(geometry, lit({ vertexColors: true, rim: 0.45 }));
  knife.frustumCulled = false;

  // maker's stamp on the ricasso, the flat unsharpened heel of the blade just forward of the guard — the one
  // spot on a fighting knife a small etched mark always sits, and in reach of a side view's eye.
  knife.add(lettering('FK-7', { height: 0.005, tone: 'white', at: [0.0045, 0.002, -0.014], rot: [0, HALF, 0] }));

  const root = new THREE.Group();
  root.add(knife);
  return { root, parts: { knife } };
}
