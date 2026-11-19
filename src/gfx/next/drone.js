// KITE — the guard drone, second look. Same rig as the old gfx/models.js builder (hub positions, eye/tail/
// muzzle to the millimetre, so the game's rotor spin, eye glow, tail blink and muzzle flash all still land in
// the right place) but built as a real flying machine: a lathed two-tone hull (pale armour proud of a dark
// aluminium frame, the same family as gfx/next/sentry.js), ducted rotors with galvanised mounting bolts and a
// rust trim ring, tapered arms with rubber cable looms, a slung gimballed sensor/weapon turret, skids, antennae.
//
// ~0.9 m across (hub to opposite hub), centred on its own origin at flying height, facing -Z.
import * as THREE from 'three';
import { lit, glow } from '../materials.js';
import { paint, place, box, cyl, ball, merge, sides, geoDetail } from '../geo.js';
import { lettering } from './lettering.js';

// ---------------------------------------------------------------------------------------------------------------
// Palette: the sentry's own family — pale armour over a dark frame, galvanised fasteners, one amber accent —
// plus a rust trim ring (the duct's weathered band) and a near-black polymer for the blades.
const PALE = 0xd8d2c1; // main armour plate, warm off-white — the same tone as WARDEN's
const PALE2 = 0xc0b9a5; // secondary plate, a shade darker
const DARK = 0x2a2d31; // visible aluminium frame: the understructure the panels sit proud of
const GUN = 0x34383f; // gunmetal: motor pods, weapon, sensor barrels
const GALV = 0xa7aca8; // bright galvanised bolts, collars, pins
const ACCENT = 0xe0922e; // the one accent colour: hazard-amber paint, used sparingly
const CABLE = 0x191b1d; // rubber cable loom / feet
const RUST = 0xa35a32; // the duct's weathered rust trim band
const BLADE = 0x1e1f22; // near-black rotor-blade polymer
const SENSOR = 0xcf8a3a; // small amber glass sensor lens

// shade presets: every one of these names a real material (gfx/matter.js); a name not in that catalogue throws.
const sPaint = { mat: 'paint', rough: 0.5, metal: 0 };
const sPoly = { mat: 'polymer', rough: 0.55, metal: 0.05 };
const sAlum = { mat: 'aluminium', rough: 0.32, metal: 0.78 };
const sGun = { mat: 'gunmetal', rough: 0.3, metal: 0.82 };
const sGalv = { mat: 'galv', rough: 0.28, metal: 0.9 };
const sCable = { mat: 'rubber', rough: 0.92, metal: 0 };
const sGlass = { mat: 'glass', rough: 0.08, metal: 0 };
const sRust = { mat: 'rust', rough: 0.72, metal: 0.3 };
const sBlade = { mat: 'polymer', rough: 0.4, metal: 0.05 };

// ---------------------------------------------------------------------------------------------------------------
// Small helpers (on top of geo.js), the same idioms as gfx/next/sentry.js.
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

/** A painted cylinder whose own axis runs from `a` to `b` — arms, cable runs, barrels, struts. */
function span(a, b, r1, r2, color, shade, segments = 8) {
  const len = Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return cyl(r1, r2, len, color, mid, axisEuler(a, b), segments, shade);
}

/** An open ring — a collar, a duct trim band, a muzzle cap. Cheaper than a capped cylinder. */
function ring(radius, height, color, at, rot, segments, shade) {
  return place(paint(new THREE.CylinderGeometry(radius, radius, height, sides(segments), 1, true), color, shade), {
    at,
    rot,
  });
}

/** A collar clamped around a tube running from `a` to `b`, at `t` (0 = a .. 1 = b) along it. */
function collar(a, b, t, radius, height, color, shade, segments = 10) {
  const at = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return ring(radius, height, color, at, axisEuler(a, b), segments, shade);
}

/** Calls `make(pos, angle, i)` `count` times around a circle of `radius` in the XZ plane centred on `center`. */
function radial(count, radius, center, make) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push(make([center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius], a, i));
  }
  return out;
}

/** Fine, close-up detail (bolts, fins, trim rings): dropped entirely at low detail, same as a phone gets no bevels. */
function fine(parts) {
  return geoDetail.bevel ? parts : [];
}

// final-Y flattening: a streamlined hull reads better than a barrel. Scaled in before the lathe's own Y axis
// becomes world Z (place() applies scale before rotation), so this squashes only the up/down cross-section —
// the nose-to-tail length and the left/right spread are untouched.
const SQUASH = 0.72;

/** A full-revolve hull layer: `profile` is a list of [radius, z] pairs, nose (-Z) to tail (+Z). */
function hull(profile, color, shade, segments = 16) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(r, z));
  return place(paint(new THREE.LatheGeometry(pts, sides(segments)), color, shade), {
    rot: [Math.PI / 2, 0, 0],
    scale: [1, 1, SQUASH],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Hull profile, nose to tail. The frame is the full length; the armour panel sits proud of it only over the
// mid-body, leaving the frame itself as a visible nose cone and tail boom — the same "panel proud of frame,
// frame visible at the break" language as the sentry's plates.
const FRAME_PROFILE = [
  [0.01, -0.21],
  [0.045, -0.18],
  [0.075, -0.14],
  [0.092, -0.08],
  [0.098, -0.02],
  [0.096, 0.04],
  [0.084, 0.09],
  [0.062, 0.13],
  [0.038, 0.16],
  [0.018, 0.182],
];
const ARMOUR_PROFILE = [
  [0.082, -0.14],
  [0.098, -0.09],
  [0.104, -0.02],
  [0.102, 0.04],
  [0.088, 0.09],
  [0.07, 0.14],
];

// hub centres: identical to the old gfx/models.js KITE, to the millimetre — every rotor, duct and arm keys off these.
const HUBS = [
  [0.32, -0.32],
  [0.32, 0.32],
  [-0.32, -0.32],
  [-0.32, 0.32],
];

/** One arm, cable loom, motor pod and ducted-rotor shroud, from the hull out to `[hx, hz]`. */
function limb(hx, hz) {
  const root3 = [hx * 0.3, -0.01, hz * 0.3]; // where the arm leaves the hull
  const tip = [hx, 0, hz]; // duct/motor reference height — the rotor mesh itself sits 0.02 above this
  return [
    span(root3, tip, 0.021, 0.015, DARK, sAlum, 8), // tapered arm tube
    collar(root3, tip, 0, 0.028, 0.014, GALV, sGalv, 10), // inner collar, at the hull
    collar(root3, tip, 1, 0.022, 0.012, GALV, sGalv, 10), // outer collar, at the motor pod
    // cable loom, a hair below the arm, with a slight sag at its one waypoint
    span(
      [root3[0], root3[1] - 0.012, root3[2]],
      [(root3[0] + hx) / 2, -0.028, (root3[2] + hz) / 2],
      0.006,
      0.006,
      CABLE,
      sCable,
      6,
    ),
    span([(root3[0] + hx) / 2, -0.028, (root3[2] + hz) / 2], [hx, -0.004, hz], 0.006, 0.0055, CABLE, sCable, 6),

    // motor pod: a small nub, mostly tucked under the duct wall; the rotor spins clear above it
    cyl(0.044, 0.038, 0.026, GUN, [hx, -0.013, hz], undefined, 12, sGun),
    ...fine(
      radial(8, 0.04, [hx, -0.013, hz], (pos, a) =>
        box(0.01, 0.018, 0.012, GUN, pos, [0, -a, 0], { ...sGun, bevel: false }),
      ),
    ), // cooling fins

    // duct shroud: a deep two-wall drum — outer pale armour, inner dark frame — so the blades spin out of sight
    // the way a real ducted fan's do, not a thin flat ring; a rust trim lip at the top, flush rivets round the
    // wall and three support struts back to the hub.
    ring(0.096, 0.056, PALE, [hx, 0.016, hz], undefined, 20, sPoly),
    ring(0.083, 0.05, DARK, [hx, 0.014, hz], undefined, 16, sAlum),
    place(paint(new THREE.TorusGeometry(0.09, 0.011, sides(6), sides(16)), RUST, sRust), {
      at: [hx, 0.043, hz],
      rot: [Math.PI / 2, 0, 0],
    }),
    ...fine([
      ...radial(10, 0.096, [hx, 0.016, hz], (pos, a) =>
        cyl(0.006, 0.006, 0.012, GALV, pos, axisEuler([0, 0, 0], [Math.cos(a), 0, Math.sin(a)]), 6, sGalv),
      ), // flush rivets, round the outer wall
      ...radial(3, 0.07, tip, (pos) => span(tip, pos, 0.007, 0.006, DARK, sAlum, 5)),
      box(0.028, 0.012, 0.016, ACCENT, [hx, 0.045, hz], undefined, { ...sPaint, bevel: false }), // hazard placard, duct top
      // dark flush access patches, offset from the rivets' own angle so the two never coincide — they break up
      // the outer wall, as two-tone banding would
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        return box(
          0.022,
          0.004,
          0.034,
          DARK,
          [hx + Math.cos(a) * 0.097, 0.016, hz + Math.sin(a) * 0.097],
          axisEuler([0, 0, 0], [Math.cos(a), 0, Math.sin(a)]),
          { ...sAlum, bevel: false },
        );
      }),
    ]),
  ];
}

/** One rotor's geometry, centred on its own axis (local 0,0,0) so `rotation.y` spins it in place; shared by all
 *  four meshes. Four blades (even, so the shape is bbox-symmetric about the hub), each tapered over two
 *  segments, a small accent tip on each and a gunmetal spinner cone in the middle. */
function buildRotorGeometry() {
  const parts = [cyl(0.017, 0.021, 0.026, GUN, [0, 0.005, 0], undefined, 10, sGun)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push(
      box(0.041, 0.007, 0.028, BLADE, [c * 0.028, 0.003, s * 0.028], [0, -a, 0.24], sBlade), // root, more pitch
      box(0.036, 0.006, 0.02, BLADE, [c * 0.061, 0, s * 0.061], [0, -a, 0.1], sBlade), // tip, less pitch
      ...fine([box(0.01, 0.005, 0.018, ACCENT, [c * 0.081, 0, s * 0.081], [0, -a, 0], { ...sPaint, bevel: false })]),
    );
  }
  return merge(parts);
}

/** A four-rotor guard drone: `{ root, parts: { body, rotors, eye, tail, muzzle } }`, the same rig as the old
 *  gfx/models.js KITE. */
export function buildDrone() {
  const matLit = lit({ vertexColors: true, rim: 0.55 });
  const matEye = glow({ color: 0x8fe8ff, intensity: 1.6 });
  const matTail = glow({ color: 0xff3b30, intensity: 1.3 });

  const bodyParts = [
    hull(FRAME_PROFILE, DARK, sAlum, 16), // frame: the full-length understructure
    hull(ARMOUR_PROFILE, PALE, sPaint, 16), // armour: proud of the frame, mid-body only

    // dorsal spine and GPS/antenna mount, proud of the canopy's highest point
    box(0.05, 0.02, 0.15, PALE2, [0, 0.082, -0.01], undefined, sPaint),
    box(0.034, 0.014, 0.05, DARK, [0, 0.088, -0.05], undefined, sAlum),
    ...fine([box(0.05, 0.006, 0.008, ACCENT, [0, 0.093, -0.1], undefined, { ...sPaint, bevel: false })]), // dorsal hazard mark

    // belly fairing: the gimbal mount shoulder, blending the turret into the hull
    box(0.07, 0.03, 0.09, DARK, [0, -0.068, -0.11], undefined, sAlum),

    // nose turret: yoke, gimbal housing, twin IR sensor barrels either side, the eye's bezel — the eye itself is
    // its own part, below, so it can take the glow material and still move with the game's eye uniforms
    ring(0.042, 0.013, DARK, [0, -0.052, -0.148], [0, 0, Math.PI / 2], 12, sAlum),
    ball(0.037, GUN, [0, -0.053, -0.165], 10, sGun),
    span([0.034, -0.05, -0.128], [0.034, -0.05, -0.183], 0.011, 0.011, GUN, sGun, 8),
    span([-0.034, -0.05, -0.128], [-0.034, -0.05, -0.183], 0.011, 0.011, GUN, sGun, 8),
    ball(0.008, SENSOR, [0.034, -0.05, -0.185], 6, sGlass),
    ball(0.008, SENSOR, [-0.034, -0.05, -0.185], 6, sGlass),
    ring(0.026, 0.009, DARK, [0, -0.068, -0.183], [Math.PI / 2, 0, 0], 12, sAlum), // eye bezel, just behind the eye

    // slung weapon: receiver, sight, ammo feed and twin barrels, tips exactly at the muzzle
    box(0.05, 0.034, 0.05, GUN, [0, -0.045, -0.165], undefined, sGun),
    box(0.016, 0.018, 0.018, PALE2, [0, -0.025, -0.15], undefined, sPaint),
    box(0.034, 0.024, 0.03, DARK, [0, -0.062, -0.145], undefined, sAlum),
    span([0.014, -0.032, -0.12], [0.014, -0.032, -0.2], 0.0095, 0.009, GUN, sGun, 8),
    span([-0.014, -0.032, -0.12], [-0.014, -0.032, -0.2], 0.0095, 0.009, GUN, sGun, 8),
    ring(0.011, 0.008, GALV, [0.014, -0.032, -0.2], [Math.PI / 2, 0, 0], 8, sGalv), // R muzzle collar, at the muzzle
    ring(0.011, 0.008, GALV, [-0.014, -0.032, -0.2], [Math.PI / 2, 0, 0], 8, sGalv), // L muzzle collar
    ...fine([
      box(0.014, 0.012, 0.012, GALV, [0.026, -0.05, -0.135], [0, 0, 0.3], sGalv), // ammo link
      box(0.014, 0.012, 0.012, GALV, [-0.026, -0.05, -0.135], [0, 0, -0.3], sGalv),
    ]),

    // tail boom detail: a small upright fin (the tail light itself is `parts.tail`, below)
    box(0.012, 0.045, 0.026, DARK, [0, 0.028, 0.16], undefined, { ...sAlum, bevel: false }),

    // skids: two rails, cross braces, rubber feet
    ...[1, -1].flatMap((side) => [
      span([side * 0.095, -0.087, -0.1], [side * 0.095, -0.087, 0.12], 0.009, 0.009, DARK, sAlum, 8),
      span([side * 0.06, -0.068, -0.08], [side * 0.095, -0.087, -0.08], 0.008, 0.008, DARK, sAlum, 6),
      span([side * 0.06, -0.068, 0.1], [side * 0.095, -0.087, 0.1], 0.008, 0.008, DARK, sAlum, 6),
      ball(0.013, CABLE, [side * 0.095, -0.089, -0.09], 6, sCable),
      ball(0.013, CABLE, [side * 0.095, -0.089, 0.11], 6, sCable),
      ...fine([collar([side * 0.06, -0.068, -0.08], [side * 0.095, -0.087, -0.08], 0.5, 0.009, 0.01, GALV, sGalv, 8)]),
    ]),

    // antennae: a swept V off the dorsal mount, angled out and back — mostly reach, not height, to stay inside
    // the hull's own Y envelope
    ...[1, -1].flatMap((side) => [
      span([side * 0.015, 0.091, -0.055], [side * 0.05, 0.099, -0.095], 0.0035, 0.0018, DARK, sAlum, 6),
      ball(0.0032, GALV, [side * 0.05, 0.099, -0.095], 6, sGalv),
    ]),

    ...HUBS.flatMap(([hx, hz]) => limb(hx, hz)),
  ];

  const body = new THREE.Mesh(merge(bodyParts), matLit);
  // unit markings: painted on, a hair off the surface they are stencilled on. Lettering faces +Z as made.
  body.add(
    lettering('K-07', { height: 0.022, tone: 'white', at: [0, 0.093, 0.02], rot: [-Math.PI / 2, 0, Math.PI] }),
    lettering('ARM', { height: 0.014, tone: 'hazard', at: [0.027, -0.045, -0.165], rot: [0, Math.PI / 2, 0] }),
  );

  // eye: its own glow material (the game reads/writes parts.eye.material.uniforms directly). Must protrude past
  // the bezel's own face (z = -0.183) or it is hidden.
  const eye = new THREE.Mesh(ball(0.022, 0xffffff, [0, -0.068, -0.188], 8, sGlass), matEye);
  // tail: must protrude past the hull's rearmost solid face (z = 0.182) or it is hidden.
  const tail = new THREE.Mesh(box(0.025, 0.02, 0.016, 0xffffff, [0, 0.01, 0.205], undefined, sGlass), matTail);

  const rotorGeometry = buildRotorGeometry();
  const rotors = HUBS.map(([hx, hz]) => {
    const mesh = new THREE.Mesh(rotorGeometry, matLit);
    mesh.position.set(hx, 0.02, hz);
    return mesh;
  });

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.03, -0.2);

  const root = new THREE.Group();
  root.add(body, eye, tail, muzzle, ...rotors);

  return { root, parts: { body, rotors, eye, tail, muzzle } };
}
