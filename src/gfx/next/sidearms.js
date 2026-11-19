// The player's other weapons, second look: the P5 suppressed sidearm, the M7 breacher shotgun and the EMP
// grenade — rebuilt the same way the carbine was (src/gfx/next/carbine.js) — real sub-assemblies in place of a
// handful of boxes, the same dark, plain palette, the same gloved hands (src/gfx/next/hands.js) — to the exact
// contracts src/gfx/sidearms.js (the builders they replace) already set: same part names, same local positions,
// same orientation, same scale, all in metres, all facing -Z. Built from painted primitives (src/gfx/geo.js) and
// lit with src/gfx/materials.js — no textures, no built-in three.js materials, no lights, nothing from
// Math.random: every shape here is fixed.
import * as THREE from 'three';
import { lit, glow } from '../materials.js';
import { paint, place, box, cyl, ball, merge, sides } from '../geo.js';
import { lettering } from './lettering.js';
import { row, rivet, pin, sidePlates, ringRivets, railTeeth, domedBox, buildHand, buildFist } from './hands.js';
import {
  C,
  CW,
  O,
  OD,
  OM,
  STEEL,
  STEEL_DARK,
  RUBBER,
  ROUND,
  sAlum,
  sAlumWorn,
  sSteel,
  sPoly,
  sRubber,
  sBrass,
} from './carbine.js';

const HALF = Math.PI / 2;
// the shotgun shell's hull: a dull brick red, the one deliberately coloured part on these three weapons, same
// exception the carbine's one visible brass round makes — small, and a hull really is about this colour.
const HULL = 0x5c2317;
const sHull = { rough: 0.55, metal: 0, mat: 'paint' };

/** A full torus ring, its hole facing local X — a trigger guard, a loop — with the top arc (where it meets the
 *  frame) meant to sit buried inside that frame's own geometry: nothing shows through solid geometry, so a
 *  closed ring is cheaper and rounder than building the open arc and butting a separate crossbar onto it. */
function guardRing(radius, tube, at, color, shade, segments = 12) {
  return place(paint(new THREE.TorusGeometry(radius, tube, Math.max(4, sides(8)), sides(segments)), color, shade), {
    at,
    rot: [0, 0, HALF],
  });
}

// ===================================================================================================================
// P5 — a suppressed 9 mm service pistol, held in a two-handed grip. Same contract as buildPistol in
// src/gfx/sidearms.js: parts.body/bolt(slide)/mag/armR/armL/muzzle/sight at the same local positions.
export function buildPistol() {
  const boreY = 0.036; // bore centreline above the grip top, matched to the model this replaces
  const slideLen = 0.175;
  const slideCenterZ = -0.0375;
  const matLit = lit({ vertexColors: true, rim: 0.45 });

  const GRIP_AT = [0, -0.062, 0.013];
  const GRIP_TILT = -0.1;

  const frameParts = [
    // grip: a lathed taper, a hair fuller where the frame meets it, narrower at the base — an elliptical cross
    // section, not the plain rectangular slab a box would give
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0, -0.062],
            [0.0145, -0.057],
            [0.0168, -0.03],
            [0.0172, 0.008],
            [0.0165, 0.04],
            [0.0145, 0.056],
            [0.011, 0.062],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(22),
        ),
        O,
        sPoly,
      ),
      { at: GRIP_AT, rot: [GRIP_TILT, 0, 0], scale: [0.9, 1, 1] },
    ),
    box(0.032, 0.018, 0.02, O, [0, 0.003, 0.027], [-0.05, 0, 0], sPoly), // tang, blends grip into the frame
    box(0.024, 0.008, 0.009, OD, [0, -0.028, -0.006], [-0.1, 0, 0], sPoly), // finger groove 1
    box(0.024, 0.008, 0.009, OD, [0, -0.055, -0.003], [-0.1, 0, 0], sPoly), // finger groove 2
    box(0.024, 0.008, 0.009, OD, [0, -0.082, 0.0], [-0.1, 0, 0], sPoly), // finger groove 3
    // texture panels: a shallow crosshatch of ribs on each grip flank, not a grid of studs
    ...[-1, 1].flatMap((side) =>
      [-0.075, -0.06, -0.045, -0.03, -0.015].flatMap((y) => [
        box(0.0022, 0.005, 0.022, OM, [side * 0.0138, y, 0.013], [GRIP_TILT, 0, side * 0.5], sPoly),
        box(0.0022, 0.005, 0.022, OM, [side * 0.0138, y, 0.013], [GRIP_TILT, 0, side * -0.5], sPoly),
      ]),
    ), // crosshatch texture, both grip panels
    guardRing(0.024, 0.0052, [0, -0.012, 0.011], O, sPoly), // trigger guard: a round loop, top buried in the frame
    box(0.008, 0.034, 0.014, STEEL_DARK, [0, 0.006, -0.001], undefined, sSteel), // trigger
    box(0.036, 0.014, 0.014, OD, [0, -0.116, -0.014], [0.2, 0, 0], sPoly), // magwell flare, front
    box(0.036, 0.014, 0.014, OD, [0, -0.116, 0.028], [-0.18, 0, 0], sPoly), // magwell flare, back
    cyl(0.0055, 0.0055, 0.008, CW, [-0.022, -0.008, 0.006], [0, 0, HALF], 8, sAlumWorn), // mag release
    box(0.02, 0.007, 0.013, CW, [-0.018, 0.025, 0.012], [0, 0, -0.1], sAlumWorn), // slide-stop lever
    pin([0, 0.02, -0.022], 0.007, 0.034, CW, sAlumWorn), // takedown pin, crossing the frame
    domedBox(0.028, 0.026, 0.085, O, [0, 0.01, -0.082], undefined, sPoly, 0.5, 8), // dust cover, now a true rounded shell
    ...sidePlates(0.014, 0.022, 0.08, O, [0, 0.01, -0.082], sPoly, 0.0025),
    box(0.032, 0.006, 0.034, OD, [0, -0.005, -0.083], undefined, sPoly), // accessory-rail rib
    ...row([0.016, -0.001, -0.05], [0.016, -0.001, -0.11], 3, (p) => box(0.004, 0.006, 0.014, OD, p, undefined, sPoly)), // rail slots, right
    ...row([-0.016, -0.001, -0.05], [-0.016, -0.001, -0.11], 3, (p) =>
      box(0.004, 0.006, 0.014, OD, p, undefined, sPoly),
    ), // rail slots, left
  ];

  // --- barrel + suppressor: one lathed profile, mount collar wider than a genuinely tapering/waisted main tube,
  // raised baffle rings, a flat end cap — a true turning, not stacked same-radius cylinders ------------------------
  const barrelParts = [
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0.0068, -0.012],
            [0.0072, 0],
            [0.0068, 0.012],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(16),
        ),
        STEEL,
        sSteel,
      ),
      { at: [0, boreY, -0.135], rot: [HALF, 0, 0] },
    ), // exposed barrel: a hair of taper either side of its own middle, not a plain rod
    cyl(0.0078, 0.0078, 0.006, STEEL, [0, boreY, -0.148], [HALF, 0, 0], 12, sSteel), // thread protector collar
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0, 0],
            [0.0175, 0],
            [0.018, 0.006],
            [0.0175, 0.02],
            [0.0185, 0.024],
            [0.0185, 0.06],
            [0.0175, 0.065],
            [0.0185, 0.07],
            [0.0185, 0.105],
            [0.0175, 0.11],
            [0.0185, 0.115],
            [0.0185, 0.148],
            [0.017, 0.153],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(22),
        ),
        STEEL_DARK,
        sSteel,
      ),
      // slightly slimmer than its own profile radii suggest (scaled down in cross-section): a hair under the
      // rear sight's own height, so the direct eye-to-target line grazes just over the top of the tube
      { at: [0, boreY, -0.308], rot: [HALF, 0, 0], scale: [0.85, 1, 0.85] },
    ), // suppressor: mount collar, waisted main tube with two raised baffle rings, end cap — one turning
    ...ringRivets([0, boreY, -0.308], 0.0149, 10, STEEL_DARK, sSteel, 0.0045), // collar / tube seam
    ...ringRivets([0, boreY, -0.248], 0.0162, 10, STEEL_DARK, sSteel, 0.0042), // baffle-stage seam
    ...ringRivets([0, boreY, -0.288], 0.0162, 10, STEEL_DARK, sSteel, 0.0042), // baffle-stage seam
    place(
      paint(new THREE.CylinderGeometry(0.008, 0.004, 0.003, sides(10), 1, true), 0x15171a, {
        rough: 0.25,
        metal: 0.3,
        mat: 'steel',
      }),
      {
        at: [0, boreY, -0.311],
        rot: [HALF, 0, 0],
      },
    ), // bore hint
  ];

  const body = new THREE.Mesh(merge([...frameParts, ...barrelParts]), matLit);
  body.add(
    lettering('P5-2214', { height: 0.006, tone: 'white', at: [-0.0145, 0.02, -0.03], rot: [0, -HALF, 0] }),
    lettering('9x19', { height: 0.0045, tone: 'hazard', at: [0.0145, 0.02, -0.03], rot: [0, HALF, 0] }),
  );

  // --- the slide ("bolt"): its own mesh, a true rounded shell (domedBox) rather than a plain rectangular box,
  // rear sight (notched ears + open window, no bridge across the eye's own line), front sight, eject-port
  // recess, serrations front and rear. Racks back along +Z on each shot. -------------------------------------------
  const slideParts = [
    domedBox(0.027, 0.032, slideLen, C, [0, 0, 0], undefined, sAlum, 0.4, 10, 0.006), // main body: radiused top, a flat spine for the sights to sit flush on
    ...sidePlates(0.0135, 0.026, slideLen - 0.01, C, [0, -0.001, 0], sAlum, 0.0018),
    // rear sight: two ears dovetailed onto the slide top with a genuine open notch between them
    box(0.005, 0.016, 0.012, CW, [0.0085, 0.024, 0.0715], undefined, sAlumWorn), // rear sight ear, right
    box(0.005, 0.016, 0.012, CW, [-0.0085, 0.024, 0.0715], undefined, sAlumWorn), // rear sight ear, left
    rivet([0.006, 0.024, 0.077], 0xdfe3df, { rough: 0.3, metal: 0, mat: 'paint' }, 0.0025), // rear sight dot, right
    rivet([-0.006, 0.024, 0.077], 0xdfe3df, { rough: 0.3, metal: 0, mat: 'paint' }, 0.0025), // rear sight dot, left
    // set a hair lower than the rear notch (as a real post sits just under the line the eye actually looks
    // along), so the direct eye-to-target ray passes clear over its top rather than through it
    cyl(0.0026, 0.0026, 0.016, CW, [0, 0.0075, -0.0735], undefined, 8, sAlumWorn), // front sight: a round post, not a flat blade
    ball(0.003, 0xdfe3df, [0, 0.0105, -0.0765], 6, { rough: 0.3, metal: 0, mat: 'paint' }), // front sight dot
    domedBox(
      0.012,
      0.02,
      0.05,
      STEEL_DARK,
      [0.0145, 0.004, 0.01],
      undefined,
      { bottom: 0.6, top: 0.9, rough: 0.5, metal: 0.5, mat: 'gunmetal' },
      0.3,
      6,
    ), // ejection port recess
    box(0.006, 0.01, 0.014, CW, [0.0145, 0.012, 0.058], undefined, sAlumWorn), // extractor
    ...[0.052, 0.07].map((z) => box(0.028, 0.03, 0.006, CW, [0, 0, z], undefined, sAlumWorn)), // rear grip serrations
    ...[-0.052, -0.066].map((z) => box(0.027, 0.028, 0.006, CW, [0, 0, z], undefined, sAlumWorn)), // front grip serrations
  ];
  const boltPart = new THREE.Mesh(merge(slideParts), matLit);
  boltPart.position.set(0, boreY, slideCenterZ);

  // --- magazine: a separate object, pivot at the bottom of the grip; a curved tapered body, ribs, floor plate
  // and the one visible round at the feed lips, same brass the carbine's own uses. ----------------------------------
  const magGeo = merge([
    place(paint(new THREE.CylinderGeometry(0.0128, 0.0118, 0.09, sides(18), 1, false), O, sPoly), {
      at: [0, 0.037, -0.004],
      scale: [1, 1, 1.6],
    }), // body, lower
    place(paint(new THREE.CylinderGeometry(0.0115, 0.0108, 0.05, sides(18), 1, false), O, sPoly), {
      at: [0, 0.087, -0.008],
      scale: [1, 1, 1.5],
    }), // body, upper (feed area)
    box(0.027, 0.012, 0.028, OD, [0, 0.006, -0.002], undefined, sPoly), // floorplate
    box(0.026, 0.007, 0.005, OD, [0, 0.05, 0.008], undefined, sPoly), // rib
    box(0.026, 0.007, 0.005, OD, [0, 0.075, 0.006], undefined, sPoly), // rib
    rivet([0.011, 0.045, 0.011], OD, sPoly, 0.009), // witness hole
    rivet([0.011, 0.07, 0.009], OD, sPoly, 0.009),
    cyl(0.0048, 0.0048, 0.01, ROUND, [0, 0.105, 0.0], [HALF, 0, 0], 10, sBrass), // the top round, at the feed lips
  ]);
  const mag = new THREE.Mesh(magGeo, matLit);
  mag.position.set(0, -0.122, 0.013);

  const sight = new THREE.Object3D();
  sight.position.set(0, boreY + 0.024, slideCenterZ + 0.0715);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, boreY, -0.312);

  // --- arms: five-fingered gloved hands wrapping the thin pistol grip — waypoints close to the old builder's
  // own (already proven to sit correctly against this grip's own shape), fed through the shared buildHand(). -----
  function buildFiringHand() {
    const fingers = [
      {
        points: [
          [0.017, 0.038, 0.014],
          [0.017, -0.03, 0.027],
          [0.016, -0.03, 0.006],
          [0.004, -0.033, -0.012],
        ],
        radii: [0.0112, 0.0095, 0.0078, 0.0062],
      }, // middle
      {
        points: [
          [0.017, 0.013, 0.012],
          [0.017, -0.055, 0.025],
          [0.0155, -0.055, 0.004],
          [0.0045, -0.058, -0.013],
        ],
        radii: [0.0108, 0.009, 0.0073, 0.0058],
      }, // ring
      {
        points: [
          [0.016, -0.01, 0.009],
          [0.016, -0.078, 0.022],
          [0.014, -0.078, 0.002],
          [0.006, -0.081, -0.012],
        ],
        radii: [0.0094, 0.0078, 0.0065, 0.0052],
      }, // pinky
    ];
    const thumb = {
      points: [
        [-0.013, -0.005, 0.022],
        [-0.019, 0.005, 0.014],
        [-0.021, 0.015, 0.004],
        [-0.02, 0.026, -0.012],
      ],
      radii: [0.0112, 0.0105, 0.0085, 0.007],
    }; // over the top-left, resting near the slide-stop
    const indexFinger = {
      points: [
        [0.016, 0.028, 0.026],
        [0.016, 0.006, 0.02],
        [0.015, -0.004, -0.006],
        [0.013, -0.01, -0.028],
      ],
      radii: [0.0098, 0.009, 0.0078, 0.0066],
    }; // straight along the guard's right wall, not wrapped
    return merge(
      buildHand({
        fingers: [...fingers, indexFinger],
        thumb,
        palm: [0.021, -0.05, 0.03],
        palmR: 0.032,
        knuckleRow: { from: [0.016, 0.003, 0.023], to: [0.015, -0.082, 0.018], rot: [0, 0, 0.2] },
        seam: { from: [0.015, -0.082, 0.018], to: [0.018, -0.072, 0.045] },
        wrist: [0.018, -0.072, 0.045],
        wristR: 0.035,
        elbow: [0.045, -0.2, 0.2],
        elbowR: 0.044,
        away: [0.075, -0.32, 0.37],
        awayR: 0.05,
        strapAt: [0.014, -0.075, 0.048],
        buckleAt: [0.04, -0.078, 0.043],
      }),
    );
  }

  function buildSupportHand() {
    const fingers = [
      {
        points: [
          [-0.018, -0.025, 0.028],
          [-0.016, -0.045, 0.02],
          [-0.014, -0.045, -0.004],
          [-0.005, -0.048, -0.016],
        ],
        radii: [0.0098, 0.009, 0.0075, 0.006],
      }, // index
      {
        points: [
          [-0.018, -0.045, 0.026],
          [-0.016, -0.065, 0.018],
          [-0.014, -0.065, -0.006],
          [-0.004, -0.068, -0.017],
        ],
        radii: [0.0095, 0.0088, 0.0073, 0.0058],
      }, // middle
      {
        points: [
          [-0.017, -0.065, 0.022],
          [-0.015, -0.085, 0.015],
          [-0.013, -0.085, -0.007],
          [-0.003, -0.088, -0.016],
        ],
        radii: [0.0088, 0.0082, 0.0068, 0.0054],
      }, // ring
      {
        points: [
          [-0.016, -0.085, 0.018],
          [-0.014, -0.103, 0.012],
          [-0.012, -0.103, -0.006],
          [-0.004, -0.105, -0.014],
        ],
        radii: [0.0078, 0.0072, 0.006, 0.0048],
      }, // pinky
    ];
    const thumb = {
      points: [
        [-0.022, -0.03, 0.024],
        [-0.02, -0.01, 0.02],
        [-0.019, 0.006, -0.01],
        [-0.017, 0.011, -0.045],
      ],
      radii: [0.0112, 0.0105, 0.0088, 0.0072],
    }; // forward along the dust cover, clear of the slide above
    return merge(
      buildHand({
        fingers,
        thumb,
        palm: [-0.022, -0.07, 0.025],
        palmR: 0.032,
        knuckleRow: { from: [-0.018, -0.03, 0.024], to: [-0.014, -0.106, 0.01], rot: [0, 0, -0.2] },
        seam: { from: [-0.014, -0.106, 0.01], to: [-0.02, -0.095, 0.05] },
        wrist: [-0.02, -0.095, 0.05],
        wristR: 0.034,
        // the two hands necessarily overlap on a grip this thin, but the sleeve forks away from armR's sooner
        // and wider than a plain mirror would, so the two forearms read as separate in a quarter/side view.
        elbow: [-0.078, -0.21, 0.205],
        elbowR: 0.043,
        away: [-0.145, -0.33, 0.37],
        awayR: 0.049,
        strapAt: [-0.016, -0.098, 0.052],
        strapRot: [0.1, 0.2, 0.3],
        buckleAt: [-0.034, -0.1, 0.048],
      }),
    );
  }

  const armR = new THREE.Mesh(buildFiringHand(), matLit);
  const armL = new THREE.Mesh(buildSupportHand(), matLit);

  const root = new THREE.Group();
  root.add(body, boltPart, mag, armL, armR, muzzle, sight);

  return { root, parts: { body, bolt: boltPart, mag, armR, armL, muzzle, sight } };
}

// ===================================================================================================================
// M7 "breacher" — a short pump-action 12-gauge. Same contract as buildShotgun in src/gfx/sidearms.js:
// parts.body/bolt(pump)/armR/armL/mag(null)/muzzle/sight/shell at the same local positions; armL is parented to
// `bolt`, not root, so it rides the fore-end's own travel exactly as the old builder's does.
export function buildShotgun() {
  const boreY = 0.095; // bore centreline above the grip top — higher than the pistol's: the tube mag stacks under it
  const matLit = lit({ vertexColors: true, rim: 0.45 });

  const gripParts = [
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0, -0.0625],
            [0.0155, -0.058],
            [0.0178, -0.03],
            [0.0182, 0.01],
            [0.0175, 0.042],
            [0.0155, 0.058],
            [0.012, 0.0625],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(22),
        ),
        O,
        sPoly,
      ),
      { at: [0, -0.0625, 0.016], rot: [-0.09, 0, 0], scale: [0.95, 1, 1] },
    ), // grip: a lathed taper like the pistol's own
    box(0.034, 0.02, 0.022, O, [0, 0.005, 0.03], [-0.04, 0, 0], sPoly), // tang
    ...[-0.075, -0.06, -0.045, -0.03, -0.015].flatMap((y) => [
      box(0.0022, 0.005, 0.024, OM, [0.0152, y, 0.016], [-0.09, 0, 0.5], sPoly),
      box(0.0022, 0.005, 0.024, OM, [0.0152, y, 0.016], [-0.09, 0, -0.5], sPoly),
      box(0.0022, 0.005, 0.024, OM, [-0.0152, y, 0.016], [-0.09, 0, 0.5], sPoly),
      box(0.0022, 0.005, 0.024, OM, [-0.0152, y, 0.016], [-0.09, 0, -0.5], sPoly),
    ]), // crosshatch texture, both grip panels
    guardRing(0.026, 0.0055, [0, -0.008, 0.016], O, sPoly), // trigger guard: a round loop, top buried in the frame
    box(0.009, 0.02, 0.015, STEEL_DARK, [0, 0.006, 0.002], undefined, sSteel), // trigger
    domedBox(0.044, 0.05, 0.05, C, [0, 0.045, 0.01], undefined, sAlum, 0.45, 8), // trigger-group housing, now a true rounded shell
  ];

  // --- receiver: the pump action's steel box, ejection port, loading port, controls --------------------------
  const receiverParts = [
    domedBox(0.044, 0.085, 0.19, C, [0, 0.085, -0.075], undefined, sAlum, 0.42, 12, 0.014), // main receiver: lathed-radius shoulder, flat only under the rail spine
    ...sidePlates(0.022, 0.07, 0.17, C, [0, 0.085, -0.075], sAlum),
    domedBox(
      0.012,
      0.03,
      0.07,
      STEEL_DARK,
      [0.0225, 0.09, -0.07],
      undefined,
      { bottom: 0.6, top: 0.9, rough: 0.55, metal: 0.55, mat: 'gunmetal' },
      0.3,
      6,
    ), // ejection port recess
    box(0.03, 0.012, 0.05, STEEL_DARK, [0, 0.045, -0.04], undefined, sAlum), // loading port, underside
    cyl(0.009, 0.009, 0.014, CW, [0.013, 0.128, 0.015], [0, 0, HALF], 8, sAlumWorn), // cross-bolt safety
    cyl(0.01, 0.01, 0.012, CW, [-0.023, 0.01, -0.01], [0, 0, HALF], 8, sAlumWorn), // action-release button
  ];

  // --- top rail + ghost-ring rear sight (`sight`) + bead front sight ------------------------------------------
  const sightParts = [
    ...railTeeth(0, 0.1365, -0.03, -0.15, 0.03, CW, sAlumWorn),
    box(0.022, 0.0175, 0.018, STEEL_DARK, [0, 0.13625, 0.008], undefined, sAlum), // ghost-ring riser, up to the ring's lower rim only
    place(paint(new THREE.CylinderGeometry(0.013, 0.013, 0.02, sides(16), 1, true), STEEL_DARK, sAlumWorn), {
      at: [0, 0.158, 0.008],
      rot: [HALF, 0, 0],
    }), // ghost ring, a short tunnel
    place(paint(new THREE.RingGeometry(0.013, 0.021, sides(16)), STEEL_DARK, sAlumWorn), {
      at: [0, 0.158, -0.004],
    }), // ring face — a flat annulus so an eye down its own bore sees a solid frame, not empty air
    cyl(0.0022, 0.0022, 0.016, STEEL_DARK, [0, 0.111, -0.435], undefined, 8, sAlumWorn), // bead sight post, round
    ball(0.0032, 0xdfe3df, [0, 0.12, -0.435], 8, { rough: 0.25, metal: 0, mat: 'paint' }), // the bead itself
  ];

  // --- barrel, tube magazine with its own clamp, heat shield as collars + ribs (reads better than a closed tube) -
  const barrelParts = [
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0.0098, -0.165],
            [0.0102, -0.08],
            [0.0105, 0],
            [0.0102, 0.08],
            [0.0098, 0.165],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(22),
        ),
        STEEL,
        sSteel,
      ),
      { at: [0, boreY, -0.3325], rot: [HALF, 0, 0] },
    ), // barrel: a true lathed taper, a hair fuller at the receiver
    cyl(0.012, 0.012, 0.006, STEEL_DARK, [0, boreY, -0.5], [HALF, 0, 0], 14, sSteel), // muzzle crown
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0.013, -0.15],
            [0.0135, 0],
            [0.013, 0.15],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(16),
        ),
        STEEL_DARK,
        sAlum,
      ),
      { at: [0, boreY - 0.042, -0.18], rot: [HALF, 0, 0] },
    ), // tube magazine: a hair of taper, not a plain cylinder
    cyl(0.015, 0.017, 0.014, STEEL_DARK, [0, boreY - 0.042, -0.335], [HALF, 0, 0], 12, sAlum), // tube cap
    ...ringRivets([0, boreY, -0.47], 0.013, 10, STEEL_DARK, sAlum, 0.004), // barrel clamp band
    cyl(0.009, 0.009, 0.02, STEEL_DARK, [0, boreY - 0.021, -0.47], undefined, 10, sAlum), // clamp, joining barrel to tube
    place(paint(new THREE.TorusGeometry(0.021, 0.0075, Math.max(4, sides(8)), sides(16)), STEEL_DARK, sAlum), {
      at: [0, boreY, -0.175],
      rot: [0, 0, HALF],
    }), // heat shield, rear collar — a true ring, not a stack of flat ribs
    place(paint(new THREE.TorusGeometry(0.021, 0.0075, Math.max(4, sides(8)), sides(16)), STEEL_DARK, sAlum), {
      at: [0, boreY, -0.42],
      rot: [0, 0, HALF],
    }), // heat shield, front collar
    ...[0, 90, 180, 270].map((deg) =>
      box(
        0.008,
        0.006,
        0.23,
        STEEL_DARK,
        [Math.sin((deg * Math.PI) / 180) * 0.021, boreY + Math.cos((deg * Math.PI) / 180) * 0.021, -0.3],
        [0, 0, (deg * Math.PI) / 180],
        sAlum,
      ),
    ), // heat shield ribs, four round the tube
    place(paint(new THREE.TorusGeometry(0.006, 0.0032, Math.max(4, sides(6)), sides(12)), STEEL_DARK, sAlum), {
      at: [0, 0.043, 0.015],
      rot: [HALF, 0, 0],
    }), // sling swivel, front
    place(paint(new THREE.TorusGeometry(0.006, 0.0032, Math.max(4, sides(6)), sides(12)), STEEL_DARK, sAlum), {
      at: [0, -0.1, -0.012],
      rot: [HALF, 0, 0],
    }), // sling swivel, grip heel
  ];

  // --- side-saddle: four spare shells carried on the right of the receiver, each a true brass-rimmed round ----
  const saddleParts = [
    domedBox(0.01, 0.025, 0.1, O, [0.028, 0.095, -0.07], undefined, sPoly, 0.3, 6),
    ...[-0.1, -0.08, -0.06, -0.04].flatMap((z) => [
      cyl(0.0095, 0.0095, 0.022, HULL, [0.034, 0.095, z], [HALF, 0, 0], 10, sHull),
      place(paint(new THREE.TorusGeometry(0.0096, 0.0032, Math.max(4, sides(6)), sides(14)), ROUND, sBrass), {
        at: [0.034, 0.095, z + 0.009],
        rot: [0, HALF, 0],
      }),
    ]),
  ];

  // --- compact stock: a short lathed taper from the trigger housing's tang back to a rubber buttpad — the old
  // M7 went without one; the brief for this second look asks for one, so it is added here, behind the grip,
  // without touching any contract position (it is more of `body`, which has none of its own). Its front face
  // sits right at the tang's own rear face (z=0.075-0.032=0.043, the tang ends z~0.041) — not 6cm behind it in
  // mid-air. ---------------------------------------------------------------------------------------------------
  const stockParts = [
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0, -0.032],
            [0.015, -0.03],
            [0.028, -0.022],
            [0.03, 0],
            [0.029, 0.018],
            [0.024, 0.03],
            [0.019, 0.034],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(22),
        ),
        O,
        sPoly,
      ),
      { at: [0, 0.058, 0.075], rot: [HALF, 0, 0], scale: [0.78, 1, 1] },
    ), // stock body: a real narrowing from the tang collar to the pad
    ...sidePlates(0.0205, 0.035, 0.06, O, [0, 0.057, 0.075], sPoly),
    box(0.044, 0.07, 0.02, RUBBER, [0, 0.057, 0.118], undefined, sRubber), // buttpad
    ...row([0, 0.03, 0.129], [0, 0.084, 0.129], 3, (p) => box(0.042, 0.005, 0.004, RUBBER, p, undefined, sRubber)), // buttpad ridges
  ];

  const body = new THREE.Mesh(
    merge([...gripParts, ...receiverParts, ...sightParts, ...barrelParts, ...saddleParts, ...stockParts]),
    matLit,
  );
  body.add(
    lettering('M7-0931', { height: 0.009, tone: 'white', at: [-0.0226, 0.09, -0.08], rot: [0, -HALF, 0] }),
    lettering('12GA', { height: 0.008, tone: 'hazard', at: [0.0226, 0.09, -0.08], rot: [0, HALF, 0] }),
  );

  // --- pump / fore-end ("bolt"): its own mesh, a rounded octagonal-ish body (domedBox on all sides reads as a
  // lathed grip tube at this size) with real grooves, racks back along +Z by up to ~0.09 m. --------------------
  const pumpHomeZ = -0.32;
  const pumpGeo = merge([
    place(paint(new THREE.CylinderGeometry(0.0225, 0.0225, 0.1, sides(18), 1, false), O, sPoly), {
      at: [0, 0, 0],
      rot: [HALF, 0, 0],
      scale: [1, 1, 1],
    }), // fore-end body, wraps the tube — round, not a square slab (its own axis along Z, like its bands/grooves)
    ...[-0.03, -0.01, 0.01, 0.03].map((z) =>
      place(paint(new THREE.TorusGeometry(0.0228, 0.0028, Math.max(4, sides(6)), sides(14)), OD, sPoly), {
        at: [0, 0, z],
        rot: [0, 0, HALF],
      }),
    ), // grip grooves, now true rings
    place(paint(new THREE.CylinderGeometry(0.0205, 0.0205, 0.01, sides(14), 1, true), OD, sPoly), {
      at: [0, 0, 0.052],
      rot: [HALF, 0, 0],
    }), // rear band
    place(paint(new THREE.CylinderGeometry(0.0205, 0.0205, 0.01, sides(14), 1, true), OD, sPoly), {
      at: [0, 0, -0.052],
      rot: [HALF, 0, 0],
    }), // front band
  ]);
  const boltPart = new THREE.Mesh(pumpGeo, matLit);
  boltPart.position.set(0, boreY - 0.042, pumpHomeZ);

  const sight = new THREE.Object3D();
  sight.position.set(0, 0.158, 0.008);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, boreY, -0.503);

  // --- shell: one loose round near the loading port, hidden until the game wants to show a reload ------------
  const shellGeo = merge([
    cyl(0.0095, 0.0095, 0.022, HULL, [0, 0, 0], [HALF, 0, 0], 12, sHull),
    cyl(0.0098, 0.0098, 0.004, ROUND, [0, 0, 0.009], [HALF, 0, 0], 12, sBrass),
  ]);
  const shell = new THREE.Mesh(shellGeo, matLit);
  shell.position.set(0.004, 0.044, -0.035);
  shell.rotation.set(0.3, 0, 0.2);
  shell.visible = false;

  // --- arms: the firing hand wraps the pistol grip, same proportions as the P5's own; the support hand wraps
  // the pump fore-end and is BUILT IN THE PUMP'S OWN LOCAL SPACE (z=0 at its centre) so it can be parented to
  // `bolt` and ride the slide exactly as the old builder's does. -----------------------------------------------
  function buildFiringHand() {
    const fingers = [
      {
        points: [
          [0.017, 0.041, 0.017],
          [0.017, -0.03, 0.03],
          [0.016, -0.03, 0.009],
          [0.004, -0.033, -0.009],
        ],
        radii: [0.0112, 0.0095, 0.0078, 0.0062],
      }, // middle
      {
        points: [
          [0.017, 0.016, 0.015],
          [0.017, -0.055, 0.028],
          [0.0155, -0.055, 0.007],
          [0.0045, -0.058, -0.01],
        ],
        radii: [0.0108, 0.009, 0.0073, 0.0058],
      }, // ring
      {
        points: [
          [0.016, -0.007, 0.012],
          [0.016, -0.078, 0.025],
          [0.014, -0.078, 0.005],
          [0.006, -0.081, -0.009],
        ],
        radii: [0.0094, 0.0078, 0.0065, 0.0052],
      }, // pinky
      {
        points: [
          [0.016, 0.031, 0.029],
          [0.016, 0.006, 0.023],
          [0.015, -0.004, -0.003],
          [0.013, -0.01, -0.025],
        ],
        radii: [0.0098, 0.009, 0.0078, 0.0066],
      }, // index: along the guard's right wall
    ];
    const thumb = {
      points: [
        [-0.013, -0.005, 0.025],
        [-0.019, 0.005, 0.017],
        [-0.021, 0.015, 0.007],
        [-0.02, 0.026, -0.009],
      ],
      radii: [0.0112, 0.0105, 0.0085, 0.007],
    };
    return merge(
      buildHand({
        fingers,
        thumb,
        palm: [0.021, -0.05, 0.033],
        palmR: 0.032,
        knuckleRow: { from: [0.016, 0.003, 0.026], to: [0.015, -0.082, 0.021], rot: [0, 0, 0.2] },
        seam: { from: [0.015, -0.082, 0.021], to: [0.018, -0.072, 0.048] },
        wrist: [0.018, -0.072, 0.048],
        wristR: 0.035,
        elbow: [0.045, -0.2, 0.2],
        elbowR: 0.044,
        away: [0.075, -0.32, 0.37],
        awayR: 0.05,
        strapAt: [0.014, -0.075, 0.051],
        buckleAt: [0.04, -0.078, 0.046],
      }),
    );
  }

  /** A point on the pump's own round cross-section, in its local space (z=0 at its centre): 0=top(+Y),
   * 90=right(+X), 180=bottom(-Y), 270=left(-X) — the same convention as the carbine's handguard. */
  function onPump(zAt, angleDeg, radius) {
    const a = (angleDeg * Math.PI) / 180;
    return [Math.sin(a) * radius, Math.cos(a) * radius, zAt];
  }

  /**
   * The support hand: it cups the pump from below, palm against its underside; the four fingers wrap up the
   * far (+X, right) side, knuckles toward the eye; the thumb lies forward along the near (-X, left) side. The
   * forearm runs back from the wrist down and to the LEFT, toward the shooter's own elbow — off the picture —
   * not straight down like a post. Built in the pump's own local space (z=0 is the fore-end's centre), so it
   * can be parented to `bolt`.
   */
  function buildSupportHand() {
    const zRows = [0.028, 0.008, -0.012, -0.03];
    const radii = [
      [0.0098, 0.0095, 0.008, 0.0065],
      [0.01, 0.0098, 0.0082, 0.0066],
      [0.0094, 0.0092, 0.0077, 0.0062],
      [0.0082, 0.008, 0.0068, 0.0055],
    ];
    const sweep = [175, 120, 75, 35]; // base near the bottom, wrapping up the far/right side to the fingertip
    const fingers = zRows.map((z, i) => ({
      points: sweep.map((deg) => onPump(z, deg, 0.0225 + radii[i][0] * 0.6)),
      radii: radii[i],
    }));
    const thumb = {
      points: [
        onPump(0.023, 250, 0.03),
        onPump(0.009, 244, 0.031),
        onPump(-0.006, 238, 0.029),
        onPump(-0.02, 233, 0.025),
      ],
      radii: [0.0112, 0.0105, 0.0088, 0.0072],
    }; // lying forward along the near side, toward the muzzle — not crossing to the far side
    const palm = onPump(0.0, 192, 0.034);
    const wrist = onPump(0.03, 220, 0.052);
    const knuckleFrom = onPump(0.028, 168, 0.038);
    const knuckleTo = onPump(-0.03, 168, 0.038);
    return merge(
      buildHand({
        fingers,
        thumb,
        palm,
        palmR: 0.032,
        knuckleRow: { from: knuckleFrom, to: knuckleTo, rot: [0.1, 0, -0.3], size: [0.012, 0.018, 0.022] },
        seam: { from: knuckleTo, to: wrist },
        wrist,
        wristR: 0.034,
        // the support arm trails back, down and to the left, to the shooter's own elbow, off the bottom-left
        // of the picture — not so far back that the two sleeves (this one and armR's) converge in a side view.
        elbow: [-0.17, -0.16, 0.26],
        elbowR: 0.042,
        away: [-0.32, -0.33, 0.46],
        awayR: 0.048,
        strapAt: [wrist[0] - 0.003, wrist[1] + 0.002, wrist[2] - 0.01],
        strapRot: [0.2, 0.1, 1.4],
        buckleAt: [wrist[0] - 0.006, wrist[1] + 0.005, wrist[2]],
      }),
    );
  }

  const armR = new THREE.Mesh(buildFiringHand(), matLit);
  const armL = new THREE.Mesh(buildSupportHand(), matLit);
  boltPart.add(armL); // rides the pump

  const root = new THREE.Group();
  root.add(body, boltPart, armR, muzzle, sight, shell);

  return { root, parts: { body, bolt: boltPart, armR, armL, mag: null, muzzle, sight, shell } };
}

// ===================================================================================================================
// Frag grenade — a round-bodied lathed canister, standing about 0.13 m tall like the old one. Shared by both
// buildGrenadeBody() (in flight: parts.band only) and buildGrenade() (held in a gloved fist: parts.grenade/band),
// exactly as src/gfx/sidearms.js splits them.
const G_BODY = 0x2c3326; // dark, muted olive-drab — stoved paint on steel, never the "green" the review flagged
const sBody = { rough: 0.55, metal: 0.15, mat: 'enamel' };

// One fresh set of canister geometries, upright (its own long axis along +Y), centred on its own middle.
function canisterParts() {
  return [
    place(
      paint(
        new THREE.LatheGeometry(
          // a true round-bodied curve, not a drawn-out straight-walled canister: the old two sparse points at
          // the full radius (one at the shoulder, one 65mm below it) read as a flask's straight side under the
          // shoulder taper below — fattened and bowed there instead, the shoulder/neck/cap above kept exactly
          // as they were (so the lever, its pin and the pull-ring, all pinned against that stretch, still sit
          // where they did).
          [
            [0.005, -0.065],
            [0.024, -0.057],
            [0.029, -0.045],
            [0.025, 0.02],
            [0.0195, 0.03],
            [0.0175, 0.037],
            [0.015, 0.042],
            [0.015, 0.052],
            [0.0125, 0.058],
            [0.0125, 0.063],
            [0.006, 0.0655],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(30),
        ),
        G_BODY,
        sBody,
      ),
      { at: [0, 0, 0] },
    ), // the whole body, base-to-fuze-cap, as one true lathed turning
    place(paint(new THREE.TorusGeometry(0.0275, 0.0028, Math.max(4, sides(8)), sides(26)), G_BODY, sBody), {
      at: [0, -0.048, 0],
      rot: [0, 0, HALF],
    }), // the seam — a single raised ring round the equator, not a scored grid
    cyl(0.0105, 0.0105, 0.01, STEEL_DARK, [0, 0.0685, 0], undefined, 12, sSteel), // fuze body, screwed onto the cap
    cyl(0.0075, 0.0075, 0.012, ROUND, [0, 0.077, 0], undefined, 10, sBrass), // fuze top cap, brass
    box(0.0105, 0.07, 0.012, STEEL_DARK, [0.0215, 0.038, 0], [0, 0, -0.08], sAlumWorn), // safety lever, pinned flat against the side
    cyl(0.004, 0.004, 0.02, STEEL_DARK, [0.0205, 0.072, 0], [HALF, 0, 0], 8, sAlumWorn), // lever pivot pin
    place(paint(new THREE.TorusGeometry(0.011, 0.0022, Math.max(4, sides(6)), sides(16)), ROUND, sBrass), {
      at: [0.031, 0.07, 0],
      rot: [0, HALF, 0],
    }), // pull-pin ring, a true brass ring
    cyl(0.0032, 0.0032, 0.022, ROUND, [0.0205, 0.07, 0], [0, 0, HALF], 8, sBrass), // the pin itself, through the lever and fuze body
  ];
}

// The glow band the game shows while the pin is out — a short translucent cylinder, pre-baked (via
// geometry.translate, not mesh.position) onto the body's own upper band so both parts.band positions stay (0,0,0)
// exactly as the old builder's bandMesh() does.
function bandMesh() {
  const geo = new THREE.CylinderGeometry(0.0205, 0.0205, 0.01, sides(20), 1, true);
  geo.translate(0, 0.016, 0);
  return new THREE.Mesh(geo, glow({ color: 0xff5a3c, intensity: 1.6 }));
}

export function buildGrenadeBody() {
  const grenade = new THREE.Mesh(merge(canisterParts()), lit({ vertexColors: true, rim: 0.4 }));
  grenade.add(lettering('M80', { height: 0.007, tone: 'hazard', at: [0, -0.01, 0.0215], rot: [0, 0, 0] }));

  const band = bandMesh();

  const root = new THREE.Group();
  root.add(grenade, band);

  return { root, parts: { band } };
}

export function buildGrenade() {
  const matLit = lit({ vertexColors: true, rim: 0.45 });

  // Stand the canister up along Z and push it forward into the fist — identical technique to the old builder's.
  const canister = canisterParts();
  for (const g of canister) g.rotateX(HALF).translate(0, 0, 0.048);

  function buildFistHand() {
    // the fattened body (see canisterParts() above) pushes its surface out under the first three fingers —
    // each finger's own Y here is nudged out to re-hug that surface at its own (unchanged) Z span; the fourth
    // finger sits entirely on the shoulder taper above the fattening and keeps its old, already-tuned Y.
    const fingers = [
      {
        points: [
          [0.006, -0.028, 0.014],
          [0.006, -0.028, 0.074],
        ],
        radii: [0.0135, 0.0115],
      },
      {
        points: [
          [0.006, -0.026, 0.038],
          [0.006, -0.026, 0.106],
        ],
        radii: [0.0138, 0.012],
      },
      {
        points: [
          [0.006, -0.025, 0.062],
          [0.006, -0.025, 0.128],
        ],
        radii: [0.0135, 0.0115],
      },
      {
        points: [
          [0.006, -0.02, 0.085],
          [0.006, -0.02, 0.145],
        ],
        radii: [0.012, 0.0095],
      },
    ];
    const thumb = {
      points: [
        [-0.03, 0.022, 0.016],
        [-0.03, 0.022, 0.078],
      ],
      radii: [0.0135, 0.012],
    };
    return buildFist({
      fingers,
      thumb,
      palm: [0.004, 0.02, 0.05],
      palmSize: [0.062, 0.05, 0.086],
      knuckle: [0.004, 0.055, 0.048],
      knuckleSize: [0.068, 0.014, 0.07],
      wrist: [0.01, 0.015, 0.085],
      wristR: 0.0345,
      elbow: [0.013, -0.015, 0.14],
      elbowR: 0.037,
      away: [0.02, -0.19, 0.48],
      awayR: 0.05,
    });
  }

  const grenade = new THREE.Mesh(merge([...canister, ...buildFistHand()]), matLit);
  grenade.frustumCulled = false;

  const band = bandMesh();
  band.geometry.rotateX(HALF);
  band.geometry.translate(0, 0, -0.021);

  const root = new THREE.Group();
  root.add(grenade, band);

  return { root, parts: { grenade, band } };
}
