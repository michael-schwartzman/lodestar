// The player's other weapons: the P5 suppressed sidearm, the M7 breacher shotgun, and the EMP grenade. Built the
// same way every model in the game is (docs/DESIGN.md §8.1/8.2): painted primitives, no textures, no built-in
// three.js materials, no lights. All face -Z, origin at the grip, in metres at real scale.
//
// src/gfx/models.js owns buildCarbine() and is being changed by someone else right now, so the small helpers this
// needs (strut, ring, jointChain, a hinge pin, the hand/arm construction) are copied here rather than imported.
// Hands and sleeves reuse the carbine's own glove/sleeve/knuckle colours exactly, so swapping weapons never
// changes the look of the operator's own arms.
import * as THREE from 'three';
import { lit, glow } from './materials.js';
import { paint, place, box, cyl, ball, merge } from './geo.js';

const HALF = Math.PI / 2;

// ---------------------------------------------------------------------------------------------------------------
// Palette. Albedo stays mid-range (DESIGN.md 8.1/8.2); two or three tones plus one accent per model.
const GLOVE = 0x202123; // == models.js PAINT.glove
const SLEEVE = 0x2b2f3a; // == models.js PAINT.sleeve
const KNUCKLE = 0x565b60; // == models.js PAINT.knuckle
const sGlove = { rough: 0.78, metal: 0 };
const sFabric = { rough: 0.9, metal: 0 };

// P5 sidearm: matte black-olive polymer frame, a lighter machined-steel slide, darkened suppressor.
const P_FRAME = 0x2d2f28;
const P_FRAME_DK = 0x212219;
const P_SLIDE = 0x3c3f43;
const P_SLIDE_WORN = 0x55585c;
const P_STEEL = 0x53575c;
const P_STEEL_DARK = 0x34373b;
const P_BRASS = 0xaf8639;
const P_INSERT = 0xdfe3df; // painted (not glow) white sight dots

// M7 breacher: gunmetal receiver, olive furniture (matches the carbine's furniture family), red shell hulls.
const S_RECEIVER = 0x34383a;
const S_RECEIVER_DK = 0x24272a;
const S_POLY = 0x33362c;
const S_POLY_DK = 0x262920;
const S_STEEL = 0x55585c;
const S_STEEL_DARK = 0x35383c;
const S_SHELL = 0xb5431f;
const S_BRASS = 0xaf8639;

// EMP grenade: dull olive-steel canister, pale lever, brass pin ring, one live cyan band.
const G_BODY = 0x3d4a42;
const G_CAP = 0x565f58;
const G_LEVER = 0x6c7278;
const G_PIN = 0x9a8a3e;
const G_BAND = 0x49f3ff;

const sPoly = { rough: 0.72, metal: 0 };
const sSlide = { rough: 0.38, metal: 0.85 };
const sSlideWorn = { rough: 0.32, metal: 0.9 };
const sBarrel = { rough: 0.35, metal: 0.9 };
const sSuppressor = { rough: 0.42, metal: 0.85 };
const sBrass = { rough: 0.3, metal: 1 };
const sReceiver = { rough: 0.45, metal: 0.75 };
const sShell = { rough: 0.55, metal: 0 };
const sCanister = { rough: 0.45, metal: 0.55 };
const sLever = { rough: 0.35, metal: 0.85 };

// ---------------------------------------------------------------------------------------------------------------
// Small shared helpers (copied from models.js — see its comments for how each is built).

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** A painted cylinder running between two points, its own axis aligned from `a` to `b`. */
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

/** A thin open-ended cylinder (no caps) — cheap rings and collars. */
function ring(radius, height, color, at, rot, segments = 10, shade) {
  return place(paint(new THREE.CylinderGeometry(radius, radius, height, segments, 1, true), color, shade), {
    at,
    rot,
  });
}

/** A flat annulus (washer face, normal +Z before `rot`) — caps a ring so an eye looking straight down its bore
 *  reads a solid frame around a hole, instead of the near-invisible edge-on silhouette of an open cylinder. */
function ringCap(innerRadius, outerRadius, color, at, rot, segments = 10, shade) {
  return place(paint(new THREE.RingGeometry(innerRadius, outerRadius, segments), color, shade), { at, rot });
}

/** A hinge-pin look at a joint: a short fat cylinder lying on its side along X. */
function pin(at, radius, length, color, shade) {
  return cyl(radius, radius, length, color, at, [0, 0, HALF], 8, shade);
}

/** A tiny painted box — a control, a screw head, a greeble. Flat-shaded (cheap) by default: too small to bevel. */
function nub(at, color, size = 0.012, shade) {
  return box(size, size, size, color, at, undefined, { bevel: false, ...shade });
}

function jointChain(points, radii, color, shade, segments = 6) {
  const parts = [];
  for (let i = 0; i < points.length - 1; i++)
    parts.push(strut(points[i], points[i + 1], radii[i], radii[i + 1], color, segments, shade));
  for (let i = 1; i < points.length - 1; i++) parts.push(ball(radii[i] * 1.1, color, points[i], 6, shade));
  parts.push(ball(radii[radii.length - 1] * 0.92, color, points[points.length - 1], 6, shade)); // rounded fingertip
  return parts;
}

/**
 * A row of separate bevelled teeth along Z, standing proud of a base rib — cheap Picatinny-style rail, real gaps
 * between slots rather than grooves scored into one slab (see models.js railSegments).
 */
function railSegments(x, y, zBack, zFront, width, color, shade) {
  const span = zBack - zFront;
  const pitch = 0.0195;
  const tooth = 0.012;
  const count = Math.max(1, Math.floor(span / pitch));
  const parts = [box(width, 0.009, span + 0.01, color, [x, y - 0.0045, (zBack + zFront) / 2], undefined, shade)];
  for (let i = 0; i < count; i++)
    parts.push(box(width, 0.011, tooth, color, [x, y + 0.0055, zBack - i * pitch - tooth / 2], undefined, shade));
  return parts;
}

/**
 * One gloved hand + forearm: a 3-point jointChain per finger (base/mid/tip, not a curl angle — see models.js),
 * a palm, a knuckle-guard strut, a wrist cuff and a sleeve running back to the elbow and off-screen beyond it.
 * `fingers` is an array of { points: [p0,p1,p2], radii: [r0,r1,r2] }.
 */
function buildHand({ fingers, palm, wrist, elbow, away, knuckleA, knuckleB, palmR = 0.034, wristR = [0.033, 0.036] }) {
  const parts = [];
  for (const f of fingers) parts.push(...jointChain(f.points, f.radii, GLOVE, sGlove));
  parts.push(
    ball(palmR, GLOVE, palm, 8, sGlove),
    strut(knuckleA, knuckleB, 0.012, 0.01, KNUCKLE, 6, { rough: 0.55, metal: 0.1 }),
    strut(palm, wrist, wristR[0], wristR[1], GLOVE, 8, sGlove),
    ball(0.036, SLEEVE, wrist, 8, sFabric), // cuff
    strut(wrist, elbow, 0.036, 0.04, SLEEVE, 8, sFabric),
    ball(0.041, SLEEVE, elbow, 8, sFabric), // elbow bend
    strut(elbow, away, 0.04, 0.046, SLEEVE, 8, sFabric), // sleeve trails back/down, off-screen
  );
  return merge(parts);
}

// ===================================================================================================================
// P5 — a suppressed 9 mm service pistol, held in a two-handed grip. Seen from behind the sight, built along -Z
// with its origin at the top of the grip (the frame floor), matching buildCarbine's convention exactly.
export function buildPistol() {
  const boreY = 0.036; // bore centreline above the grip top

  const matLit = lit({ vertexColors: true, rim: 0.45 });

  // --- frame: grip, trigger guard + trigger, magwell, slide-stop/mag-release/takedown pin, dust cover ----------
  const frameParts = [
    box(0.03, 0.118, 0.032, P_FRAME, [0, -0.062, 0.013], [-0.1, 0, 0], sPoly), // grip
    box(0.032, 0.018, 0.02, P_FRAME, [0, 0.003, 0.027], [-0.05, 0, 0], sPoly), // tang, blends grip into the frame
    box(0.024, 0.008, 0.009, P_FRAME_DK, [0, -0.028, -0.006], [-0.1, 0, 0], sPoly), // finger groove 1
    box(0.024, 0.008, 0.009, P_FRAME_DK, [0, -0.055, -0.003], [-0.1, 0, 0], sPoly), // finger groove 2
    box(0.024, 0.008, 0.009, P_FRAME_DK, [0, -0.082, 0.0], [-0.1, 0, 0], sPoly), // finger groove 3
    box(0.003, 0.065, 0.02, P_FRAME_DK, [0.0145, -0.058, 0.013], undefined, sPoly), // grip panel, right
    box(0.003, 0.065, 0.02, P_FRAME_DK, [-0.0145, -0.058, 0.013], undefined, sPoly), // grip panel, left
    box(0.008, 0.034, 0.055, P_FRAME, [0, 0.0, -0.004], undefined, sPoly), // trigger guard front
    box(0.008, 0.034, 0.01, P_FRAME, [0, 0.0, 0.033], undefined, sPoly), // trigger guard back
    box(0.042, 0.008, 0.066, P_FRAME, [0, -0.018, 0.006], undefined, sPoly), // trigger guard bottom
    box(0.008, 0.018, 0.014, P_SLIDE_WORN, [0, 0.006, -0.001], undefined, sSlideWorn), // trigger
    box(0.036, 0.014, 0.014, P_FRAME_DK, [0, -0.116, -0.014], [0.2, 0, 0], sPoly), // magwell flare, front
    box(0.036, 0.014, 0.014, P_FRAME_DK, [0, -0.116, 0.028], [-0.18, 0, 0], sPoly), // magwell flare, back
    cyl(0.0055, 0.0055, 0.008, P_SLIDE_WORN, [-0.022, -0.008, 0.006], [0, 0, HALF], 8, sSlideWorn), // mag release
    box(0.02, 0.007, 0.013, P_SLIDE_WORN, [-0.018, 0.025, 0.012], [0, 0, -0.1], sSlideWorn), // slide-stop lever
    pin([0, 0.02, -0.022], 0.007, 0.034, P_SLIDE_WORN, sSlideWorn), // takedown pin, crossing the frame
    box(0.028, 0.026, 0.085, P_FRAME, [0, 0.01, -0.082], undefined, sPoly), // dust cover (frame, under the barrel)
    box(0.032, 0.006, 0.034, P_FRAME_DK, [0, -0.005, -0.083], undefined, sPoly), // accessory-rail rib
  ];

  // --- barrel + suppressor: exposed muzzle end, mount collar, ribbed tube, end cap (fixed to the frame) --------
  const barrelParts = [
    cyl(0.007, 0.007, 0.02, P_STEEL, [0, boreY, -0.135], [HALF, 0, 0], 10, sBarrel), // exposed barrel
    ring(0.0075, 0.006, P_STEEL, [0, boreY, -0.148], [HALF, 0, 0], 10, sBarrel), // thread protector collar
    cyl(0.016, 0.016, 0.018, P_STEEL_DARK, [0, boreY, -0.16], [HALF, 0, 0], 12, sSuppressor), // mount collar
    cyl(0.017, 0.017, 0.13, P_STEEL_DARK, [0, boreY, -0.234], [HALF, 0, 0], 14, sSuppressor), // main tube
    ring(0.0185, 0.008, P_STEEL_DARK, [0, boreY, -0.2], [HALF, 0, 0], 14, sSuppressor),
    ring(0.0185, 0.008, P_STEEL_DARK, [0, boreY, -0.23], [HALF, 0, 0], 14, sSuppressor),
    ring(0.0185, 0.008, P_STEEL_DARK, [0, boreY, -0.26], [HALF, 0, 0], 14, sSuppressor),
    cyl(0.0155, 0.0155, 0.012, P_STEEL_DARK, [0, boreY, -0.305], [HALF, 0, 0], 14, sSuppressor), // end cap
    ring(0.005, 0.003, 0x15171a, [0, boreY, -0.311], [HALF, 0, 0], 10, { rough: 0.25, metal: 0.3 }), // bore hint
  ];

  const body = new THREE.Mesh(merge([...frameParts, ...barrelParts]), matLit);

  // --- the slide ("bolt"): its own mesh, centred on its own length so Object3D.position places it; nothing else
  // is parented to it. Rear sight (notched ears + white dots), front sight (blade + white dot), eject-port
  // recess and grip serrations front and rear. Racks back along +Z on each shot. ---------------------------------
  const slideLen = 0.175;
  const slideCenterZ = -0.0375; // world z the slide sits at when home
  const slideParts = [
    box(0.027, 0.032, slideLen, P_SLIDE, [0, 0, 0], undefined, sSlide), // main body
    // rear sight: two ears dovetailed onto the slide top with a genuine open notch between them (no bridge
    // filling the gap) — looking down the sights, the eye sees open space between the ears, not a solid wall.
    box(0.005, 0.016, 0.012, P_SLIDE_WORN, [0.0085, 0.024, 0.0715], undefined, sSlideWorn), // rear sight ear, right
    box(0.005, 0.016, 0.012, P_SLIDE_WORN, [-0.0085, 0.024, 0.0715], undefined, sSlideWorn), // rear sight ear, left
    nub([0.006, 0.024, 0.077], P_INSERT, 0.0025), // rear sight dot, right (on the ear's inner face, in the notch)
    nub([-0.006, 0.024, 0.077], P_INSERT, 0.0025), // rear sight dot, left
    box(0.005, 0.016, 0.006, P_SLIDE_WORN, [0, 0.024, -0.074], undefined, sSlideWorn), // front sight blade, same
    // height as the rear ears so its top sits level with the notch top when aimed
    nub([0, 0.029, -0.0765], P_INSERT, 0.003), // front sight dot (painted — the tritium glow is the optional `dot`)
    box(0.012, 0.02, 0.05, P_STEEL_DARK, [0.0145, 0.004, 0.01], undefined, {
      bottom: 0.6,
      top: 0.9,
      rough: 0.5,
      metal: 0.5,
    }), // ejection port recess
    box(0.006, 0.01, 0.014, P_SLIDE_WORN, [0.0145, 0.012, 0.058], undefined, sSlideWorn), // extractor
    ...[0.052, 0.07].map((z) => box(0.028, 0.03, 0.006, P_SLIDE_WORN, [0, 0, z], undefined, sSlideWorn)), // rear grip serrations
    ...[-0.052, -0.066].map((z) => box(0.027, 0.028, 0.006, P_SLIDE_WORN, [0, 0, z], undefined, sSlideWorn)), // front grip serrations
  ];
  const boltPart = new THREE.Mesh(merge(slideParts), matLit);
  boltPart.position.set(0, boreY, slideCenterZ);

  // --- magazine: a separate object, pivot at the BOTTOM of the grip (the floorplate) so the game can drop it
  // straight down and tilt it on reload; its body runs upward (+Y, local) into the grip when seated. -----------
  const magGeo = merge([
    box(0.027, 0.012, 0.028, P_FRAME_DK, [0, 0.006, -0.002], undefined, sPoly), // floorplate
    box(0.025, 0.05, 0.025, P_FRAME, [0, 0.037, -0.004], undefined, sPoly), // body, lower
    box(0.023, 0.05, 0.021, P_FRAME, [0, 0.087, -0.008], undefined, sPoly), // body, upper (feed area)
    box(0.026, 0.007, 0.005, P_FRAME_DK, [0, 0.05, 0.008], undefined, sPoly), // rib
    box(0.026, 0.007, 0.005, P_FRAME_DK, [0, 0.075, 0.006], undefined, sPoly), // rib
    nub([0.011, 0.045, 0.011], P_FRAME_DK, 0.009), // witness hole
    nub([0.011, 0.07, 0.009], P_FRAME_DK, 0.009), // witness hole
    cyl(0.0048, 0.0048, 0.01, P_BRASS, [0, 0.105, 0.0], [HALF, 0, 0], 8, sBrass), // the top round, at the feed lips
  ]);
  const mag = new THREE.Mesh(magGeo, matLit);
  mag.position.set(0, -0.122, 0.013);

  // sight: empty, on the line of the sights, at the rear sight, where the eye lines up (between the two ears,
  // over the notch) — a fixed reference; the dot sight's `dot` is deliberately omitted (see sidearms report).
  const sight = new THREE.Object3D();
  sight.position.set(0, boreY + 0.024, slideCenterZ + 0.0715);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, boreY, -0.312);

  // --- arms: five-fingered gloved hands wrapping the thin pistol grip. armR (firing hand) wraps the grip fully
  // on its own, so the gun still looks properly held when armL is hidden; armL (support hand) clasps a lower
  // band around the front/left of the grip and runs its thumb forward along the dust cover, clear of the slide. -
  function buildFiringHand() {
    const fingers = [
      {
        points: [
          [0.017, -0.03, 0.027],
          [0.016, -0.03, 0.006],
          [0.004, -0.033, -0.012],
        ],
        radii: [0.0095, 0.0078, 0.0062],
      }, // middle
      {
        points: [
          [0.017, -0.055, 0.025],
          [0.0155, -0.055, 0.004],
          [0.0045, -0.058, -0.013],
        ],
        radii: [0.009, 0.0073, 0.0058],
      }, // ring
      {
        points: [
          [0.016, -0.078, 0.022],
          [0.014, -0.078, 0.002],
          [0.006, -0.081, -0.012],
        ],
        radii: [0.0078, 0.0065, 0.0052],
      }, // pinky
      {
        points: [
          [0.016, 0.006, 0.02],
          [0.015, -0.004, -0.006],
          [0.013, -0.01, -0.028],
        ],
        radii: [0.009, 0.0078, 0.0066],
      }, // index: straight along the guard's right wall, not wrapped
      {
        points: [
          [-0.013, -0.005, 0.022],
          [-0.021, 0.015, 0.004],
          [-0.02, 0.026, -0.012],
        ],
        radii: [0.0105, 0.0085, 0.007],
      }, // thumb: over the top-left, resting near the slide-stop
    ];
    return buildHand({
      fingers,
      palm: [0.021, -0.05, 0.03],
      wrist: [0.018, -0.072, 0.045],
      elbow: [0.045, -0.2, 0.2],
      away: [0.075, -0.32, 0.37],
      knuckleA: [0.016, 0.003, 0.023],
      knuckleB: [0.015, -0.082, 0.018],
    });
  }

  function buildSupportHand() {
    const fingers = [
      {
        points: [
          [-0.016, -0.045, 0.02],
          [-0.014, -0.045, -0.004],
          [-0.005, -0.048, -0.016],
        ],
        radii: [0.009, 0.0075, 0.006],
      }, // index
      {
        points: [
          [-0.016, -0.065, 0.018],
          [-0.014, -0.065, -0.006],
          [-0.004, -0.068, -0.017],
        ],
        radii: [0.0088, 0.0073, 0.0058],
      }, // middle
      {
        points: [
          [-0.015, -0.085, 0.015],
          [-0.013, -0.085, -0.007],
          [-0.003, -0.088, -0.016],
        ],
        radii: [0.0082, 0.0068, 0.0054],
      }, // ring
      {
        points: [
          [-0.014, -0.103, 0.012],
          [-0.012, -0.103, -0.006],
          [-0.004, -0.105, -0.014],
        ],
        radii: [0.0072, 0.006, 0.0048],
      }, // pinky
      {
        points: [
          [-0.02, -0.01, 0.02],
          [-0.019, 0.006, -0.01],
          [-0.017, 0.011, -0.045],
        ],
        radii: [0.0105, 0.0088, 0.0072],
      }, // thumb: forward along the dust cover, clear of the slide above
    ];
    return buildHand({
      fingers,
      palm: [-0.022, -0.07, 0.025],
      wrist: [-0.02, -0.095, 0.05],
      // the two hands necessarily overlap on a grip this thin, but the sleeve forks away from armR's sooner and
      // wider than a plain mirror would, so the two forearms read as separate in a quarter/side view.
      elbow: [-0.078, -0.21, 0.205],
      away: [-0.145, -0.33, 0.37],
      knuckleA: [-0.016, -0.04, 0.02],
      knuckleB: [-0.014, -0.106, 0.01],
    });
  }

  const armR = new THREE.Mesh(buildFiringHand(), matLit);
  const armL = new THREE.Mesh(buildSupportHand(), matLit);

  const root = new THREE.Group();
  root.add(body, boltPart, mag, armL, armR, muzzle, sight);

  return { root, parts: { body, bolt: boltPart, mag, armR, armL, muzzle, sight } };
}

// ===================================================================================================================
// M7 "breacher" — a short pump-action 12-gauge, pistol-grip-only (no shoulder stock: a breacher is swung and
// worked one-handed as often as not, and dropping the stock keeps the triangle budget for the parts that matter).
// Heat shield over the barrel, a side-saddle of spare shells, a top rail with a ghost-ring sight. Tube-fed, so
// `mag` is null. Origin at the grip, same convention as the pistol and the carbine.
export function buildShotgun() {
  const boreY = 0.095; // bore centreline above the grip top — higher than the pistol's: the tube mag stacks under it
  const matLit = lit({ vertexColors: true, rim: 0.45 });

  // --- grip, trigger group, lower receiver stub --------------------------------------------------------------
  const gripParts = [
    box(0.032, 0.125, 0.034, S_POLY, [0, -0.0625, 0.016], [-0.09, 0, 0], sPoly), // grip
    box(0.034, 0.02, 0.022, S_POLY, [0, 0.005, 0.03], [-0.04, 0, 0], sPoly), // tang
    box(0.003, 0.07, 0.022, S_POLY_DK, [0.0155, -0.06, 0.016], undefined, sPoly), // grip panel, right
    box(0.003, 0.07, 0.022, S_POLY_DK, [-0.0155, -0.06, 0.016], undefined, sPoly), // grip panel, left
    box(0.009, 0.036, 0.012, S_POLY, [0, 0.0, -0.006], undefined, sPoly), // trigger guard front
    box(0.009, 0.036, 0.012, S_POLY, [0, 0.0, 0.034], undefined, sPoly), // trigger guard back
    box(0.046, 0.009, 0.052, S_POLY, [0, -0.02, 0.013], undefined, sPoly), // trigger guard bottom
    box(0.009, 0.02, 0.015, S_STEEL_DARK, [0, 0.006, 0.002], undefined, { rough: 0.4, metal: 0.8 }), // trigger
    box(0.044, 0.05, 0.05, S_RECEIVER, [0, 0.045, 0.01], undefined, sReceiver), // trigger-group housing
  ];

  // --- receiver: the pump action's steel box, ejection port, loading port, controls --------------------------
  const receiverParts = [
    box(0.044, 0.085, 0.19, S_RECEIVER, [0, 0.085, -0.075], undefined, sReceiver), // main receiver
    box(0.012, 0.03, 0.07, S_RECEIVER_DK, [0.0225, 0.09, -0.07], undefined, {
      bottom: 0.6,
      top: 0.9,
      rough: 0.55,
      metal: 0.55,
    }), // ejection port recess
    box(0.03, 0.012, 0.05, S_RECEIVER_DK, [0, 0.045, -0.04], undefined, sReceiver), // loading port, underside
    nub([0.013, 0.128, 0.015], S_STEEL_DARK, 0.009, { rough: 0.35, metal: 0.8 }), // cross-bolt safety
    nub([-0.023, 0.01, -0.01], S_STEEL_DARK, 0.01, { rough: 0.35, metal: 0.8 }), // action-release button
  ];

  // --- top rail + ghost-ring rear sight + front sight post ----------------------------------------------------
  // The rail stops short of the ghost ring (it used to run under it and poke into the aperture) so the ring
  // reads as a clear hole to look through, with its own riser rising straight off the receiver top.
  const sightParts = [
    ...railSegments(0, 0.1365, -0.03, -0.15, 0.03, S_RECEIVER_DK, sReceiver),
    box(0.022, 0.0175, 0.018, S_RECEIVER_DK, [0, 0.13625, 0.008], undefined, sReceiver), // ghost-ring riser, up to the ring's lower rim only
    ring(0.013, 0.02, S_STEEL_DARK, [0, 0.158, 0.008], [HALF, 0, 0], 12, { rough: 0.35, metal: 0.8 }), // ghost ring, a short tunnel
    // an eye looking straight down the tunnel's own bore sees a thin cylinder wall edge-on (almost nothing) —
    // this flat annulus caps the front of it so the sight reads as a solid frame around a hole, not empty air.
    ringCap(0.013, 0.021, S_STEEL_DARK, [0, 0.158, -0.004], undefined, 12, { rough: 0.35, metal: 0.8 }), // ring face
    box(0.005, 0.018, 0.006, S_STEEL_DARK, [0, 0.111, -0.435], undefined, { rough: 0.35, metal: 0.8 }), // front sight post
    nub([0, 0.1175, -0.4365], P_INSERT, 0.0025), // front sight insert dot
  ];

  // --- barrel, tube magazine, heat shield (skeletonised: collars + ribs, cheaper and reads better than a tube) -
  const barrelParts = [
    cyl(0.0105, 0.0105, 0.335, S_STEEL, [0, boreY, -0.3325], [HALF, 0, 0], 12, sBarrel), // barrel
    ring(0.012, 0.006, S_STEEL_DARK, [0, boreY, -0.5], [HALF, 0, 0], 12, sBarrel), // muzzle crown
    cyl(0.013, 0.013, 0.3, S_RECEIVER_DK, [0, boreY - 0.042, -0.18], [HALF, 0, 0], 12, sReceiver), // tube magazine
    cyl(0.015, 0.017, 0.014, S_RECEIVER_DK, [0, boreY - 0.042, -0.335], [HALF, 0, 0], 12, sReceiver), // tube cap
    ring(0.013, 0.014, S_RECEIVER_DK, [0, boreY, -0.47], [HALF, 0, 0], 12, sReceiver), // barrel clamp band
    ring(0.021, 0.01, S_RECEIVER_DK, [0, boreY, -0.175], [HALF, 0, 0], 14, sReceiver), // heat shield, rear collar
    ring(0.021, 0.01, S_RECEIVER_DK, [0, boreY, -0.42], [HALF, 0, 0], 14, sReceiver), // heat shield, front collar
    box(0.008, 0.006, 0.26, S_RECEIVER_DK, [0, boreY + 0.021, -0.3], undefined, sReceiver), // heat shield rib, top
    box(0.008, 0.006, 0.26, S_RECEIVER_DK, [0.021, boreY, -0.3], undefined, sReceiver), // heat shield rib, right
    box(0.008, 0.006, 0.26, S_RECEIVER_DK, [-0.021, boreY, -0.3], undefined, sReceiver), // heat shield rib, left
    box(0.008, 0.006, 0.26, S_RECEIVER_DK, [0, boreY - 0.021, -0.3], undefined, sReceiver), // heat shield rib, bottom
    ring(0.006, 0.004, S_STEEL_DARK, [0, 0.043, 0.015], [HALF, 0, 0], 8, sReceiver), // sling swivel, front
    ring(0.006, 0.004, S_STEEL_DARK, [0, -0.1, -0.012], [HALF, 0, 0], 8, sReceiver), // sling swivel, grip heel
  ];

  // --- side-saddle: four spare shells carried on the right of the receiver ------------------------------------
  const saddleParts = [box(0.01, 0.025, 0.1, S_POLY, [0.028, 0.095, -0.07], undefined, sPoly)];
  for (const z of [-0.1, -0.08, -0.06, -0.04]) {
    saddleParts.push(
      cyl(0.0095, 0.0095, 0.022, S_SHELL, [0.034, 0.095, z], [HALF, 0, 0], 10, sShell),
      ring(0.0098, 0.004, S_BRASS, [0.034, 0.095, z + 0.009], [HALF, 0, 0], 10, sBrass),
    );
  }

  const body = new THREE.Mesh(
    merge([...gripParts, ...receiverParts, ...sightParts, ...barrelParts, ...saddleParts]),
    matLit,
  );

  // --- pump / fore-end ("bolt"): its own mesh, racks back along +Z by up to ~0.09 m. armL rides on it as a
  // child, so the supporting hand always sits on the fore-end wherever it is in its travel. -------------------
  const pumpHomeZ = -0.32;
  const pumpGeo = merge([
    box(0.036, 0.036, 0.1, S_POLY, [0, 0, 0], undefined, sPoly), // fore-end body, wraps the tube
    box(0.038, 0.006, 0.004, S_POLY_DK, [0, 0, -0.03], undefined, sPoly), // grip groove
    box(0.038, 0.006, 0.004, S_POLY_DK, [0, 0, -0.01], undefined, sPoly), // grip groove
    box(0.038, 0.006, 0.004, S_POLY_DK, [0, 0, 0.01], undefined, sPoly), // grip groove
    box(0.038, 0.006, 0.004, S_POLY_DK, [0, 0, 0.03], undefined, sPoly), // grip groove
    ring(0.019, 0.01, S_POLY_DK, [0, 0, 0.052], [HALF, 0, 0], 12, sPoly), // rear band
    ring(0.019, 0.01, S_POLY_DK, [0, 0, -0.052], [HALF, 0, 0], 12, sPoly), // front band
  ]);
  const boltPart = new THREE.Mesh(pumpGeo, matLit);
  boltPart.position.set(0, boreY - 0.042, pumpHomeZ);

  // sight: empty, at the ghost ring, where the eye lines up.
  const sight = new THREE.Object3D();
  sight.position.set(0, 0.158, 0.008);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, boreY, -0.503);

  // --- shell: one loose round near the loading port, hidden until the game wants to show a reload ------------
  const shellGeo = merge([
    cyl(0.0095, 0.0095, 0.022, S_SHELL, [0, 0, 0], [HALF, 0, 0], 10, sShell),
    ring(0.0098, 0.004, S_BRASS, [0, 0, 0.009], [HALF, 0, 0], 10, sBrass),
  ]);
  const shell = new THREE.Mesh(shellGeo, matLit);
  shell.position.set(0.004, 0.044, -0.035);
  shell.rotation.set(0.3, 0, 0.2);
  shell.visible = false;

  // --- arms: the firing hand wraps the pistol grip exactly as on the P5 (same grip proportions); the support
  // hand wraps the pump fore-end and is parented to it so it rides the slide, still returned as parts.armL. ---
  function buildFiringHand() {
    const fingers = [
      {
        points: [
          [0.017, -0.03, 0.03],
          [0.016, -0.03, 0.009],
          [0.004, -0.033, -0.009],
        ],
        radii: [0.0095, 0.0078, 0.0062],
      }, // middle
      {
        points: [
          [0.017, -0.055, 0.028],
          [0.0155, -0.055, 0.007],
          [0.0045, -0.058, -0.01],
        ],
        radii: [0.009, 0.0073, 0.0058],
      }, // ring
      {
        points: [
          [0.016, -0.078, 0.025],
          [0.014, -0.078, 0.005],
          [0.006, -0.081, -0.009],
        ],
        radii: [0.0078, 0.0065, 0.0052],
      }, // pinky
      {
        points: [
          [0.016, 0.006, 0.023],
          [0.015, -0.004, -0.003],
          [0.013, -0.01, -0.025],
        ],
        radii: [0.009, 0.0078, 0.0066],
      }, // index: along the guard's right wall
      {
        points: [
          [-0.013, -0.005, 0.025],
          [-0.021, 0.015, 0.007],
          [-0.02, 0.026, -0.009],
        ],
        radii: [0.0105, 0.0085, 0.007],
      }, // thumb
    ];
    return buildHand({
      fingers,
      palm: [0.021, -0.05, 0.033],
      wrist: [0.018, -0.072, 0.048],
      elbow: [0.045, -0.2, 0.2],
      away: [0.075, -0.32, 0.37],
      knuckleA: [0.016, 0.003, 0.026],
      knuckleB: [0.015, -0.082, 0.021],
    });
  }

  // Built in the pump's own local space (z=0 is the fore-end's centre), so it can be parented to `bolt`.
  function buildSupportHand() {
    const fingers = [
      {
        points: [
          [-0.012, 0.022, 0.028],
          [0.02, 0.012, 0.028],
          [0.022, -0.006, 0.028],
        ],
        radii: [0.0095, 0.008, 0.0065],
      }, // index
      {
        points: [
          [-0.014, 0.023, 0.008],
          [0.021, 0.013, 0.008],
          [0.023, -0.008, 0.008],
        ],
        radii: [0.0098, 0.0082, 0.0066],
      }, // middle
      {
        points: [
          [-0.014, 0.022, -0.012],
          [0.02, 0.012, -0.012],
          [0.022, -0.009, -0.012],
        ],
        radii: [0.0092, 0.0077, 0.0062],
      }, // ring
      {
        points: [
          [-0.013, 0.02, -0.03],
          [0.018, 0.01, -0.03],
          [0.02, -0.008, -0.03],
        ],
        radii: [0.008, 0.0068, 0.0055],
      }, // pinky
      {
        points: [
          [-0.021, 0.004, 0.02],
          [-0.016, -0.014, 0.018],
          [-0.002, -0.024, 0.014],
        ],
        radii: [0.0105, 0.0088, 0.0072],
      }, // thumb
    ];
    return buildHand({
      fingers,
      palm: [-0.006, 0.03, 0.0],
      wrist: [-0.012, 0.01, 0.075],
      // short, little-bent support arm (like the carbine's handguard hand) — it must stay close to the pump and
      // NOT trail back as far as armR's sleeve, or the two sleeves converge and tangle in a side view.
      elbow: [-0.07, -0.14, 0.15],
      away: [-0.14, -0.29, 0.27],
      knuckleA: [-0.014, 0.021, 0.03],
      knuckleB: [0.021, 0.011, -0.03],
    });
  }

  const armR = new THREE.Mesh(buildFiringHand(), matLit);
  const armL = new THREE.Mesh(buildSupportHand(), matLit);
  boltPart.add(armL); // rides the pump

  const root = new THREE.Group();
  root.add(body, boltPart, armR, muzzle, sight, shell);

  return { root, parts: { body, bolt: boltPart, armR, armL, mag: null, muzzle, sight, shell } };
}

// ===================================================================================================================
// The EMP grenade. The canister (shared by the in-hand and thrown versions) stands on its own axis (Y), origin
// at its centre, about 0.13 m tall: a main body, a tapered base, a necked-down fuze housing, a safety lever
// pinned against the side, and a pull-ring. A thin cyan `band` (glow()) says it is live.
function canisterParts() {
  return [
    cyl(0.021, 0.021, 0.075, G_BODY, [0, -0.0075, 0], undefined, 14, sCanister), // main body
    cyl(0.021, 0.017, 0.02, G_CAP, [0, -0.055, 0], undefined, 10, sCanister), // base
    cyl(0.021, 0.015, 0.02, G_CAP, [0, 0.04, 0], undefined, 14, sCanister), // neck
    cyl(0.015, 0.015, 0.015, G_CAP, [0, 0.0575, 0], undefined, 10, sCanister), // fuze housing cap
    box(0.01, 0.07, 0.012, G_LEVER, [0.0265, 0.015, 0], undefined, sLever), // safety lever, pinned flat to the side
    ring(0.012, 0.005, G_PIN, [0.033, 0.045, 0], [0, 0, HALF], 6, sLever), // pull-pin ring
  ];
}

function bandMesh() {
  const g = new THREE.CylinderGeometry(0.0225, 0.0225, 0.01, 12, 1, true);
  g.translate(0, 0.016, 0); // axis along Y, matching the upright canister
  return new THREE.Mesh(g, glow({ color: G_BAND, intensity: 1.6 }));
}

/** The canister alone — the thrown object. Origin at its centre, about 0.13 m tall. */
export function buildGrenadeBody() {
  const matLit = lit({ vertexColors: true, rim: 0.45 });
  const root = new THREE.Group();
  const grenade = new THREE.Mesh(merge(canisterParts()), matLit);
  const band = bandMesh();
  root.add(grenade, band);
  return { root, parts: { band } };
}

// The gloved left fist and forearm holding the canister — built the way buildKnife() builds its fist: single
// sideways cylinders standing in for curled fingers (not the carbine's jointed hand), one merged mesh. The
// canister here is rotated on its side (axis Z) to sit in the fist exactly as the knife's grip does.
export function buildGrenade() {
  const parts = [...canisterParts()];
  for (const g of parts) g.rotateX(HALF).translate(0, 0, 0.048); // stand the canister up along Z, into the fist

  const fistParts = [
    ...parts,
    box(0.062, 0.05, 0.086, GLOVE, [0.004, 0.02, 0.05], undefined, sGlove), // palm
    cyl(0.013, 0.013, 0.066, GLOVE, [0.006, -0.02, 0.014], [0, 0, HALF], 8, sGlove), // index, curled under
    cyl(0.0135, 0.0135, 0.068, GLOVE, [0.006, -0.022, 0.038], [0, 0, HALF], 8, sGlove), // middle
    cyl(0.0135, 0.0135, 0.066, GLOVE, [0.006, -0.022, 0.062], [0, 0, HALF], 8, sGlove), // ring
    cyl(0.012, 0.012, 0.06, GLOVE, [0.006, -0.02, 0.085], [0, 0, HALF], 8, sGlove), // pinky
    cyl(0.0135, 0.012, 0.062, GLOVE, [-0.03, 0.022, 0.016], [HALF - 0.25, 0, 0.2], 8, sGlove), // thumb, over the lever
    box(0.068, 0.014, 0.07, KNUCKLE, [0.004, 0.048, 0.048], undefined, { rough: 0.55, metal: 0.1 }), // knuckle guard
    // wrist cuff and forearm as point-to-point struts (not manually-rotated cylinders) so each segment is
    // guaranteed to meet the next: palm -> wrist -> elbow, trailing back and down out of the picture.
    strut([0.01, 0.015, 0.085], [0.013, -0.015, 0.14], 0.033, 0.036, SLEEVE, 12, sFabric), // wrist cuff
    strut([0.013, -0.015, 0.14], [0.02, -0.19, 0.48], 0.038, 0.05, SLEEVE, 12, sFabric), // forearm, trails off
  ];
  const grenade = new THREE.Mesh(merge(fistParts), lit({ vertexColors: true, rim: 0.45 }));
  grenade.frustumCulled = false;
  const band = bandMesh();
  band.geometry.rotateX(HALF);
  // the fat wrist cuff engulfs the back (fuze) end of the canister — sit the band on the front/base end instead,
  // which pokes out past the curled fingers and stays clear of both the palm box and the wrist
  band.geometry.translate(0, 0, -0.021);

  const root = new THREE.Group();
  root.add(grenade, band);
  return { root, parts: { grenade, band } };
}
