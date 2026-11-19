// MISSION OBJECTS — second look: the gas-centrifuge casing that stands by the hundred in the cascade hall, the
// demolition charge planted on them, and the lodestar beacon raised for the strike. Same contracts as the old
// gfx/models.js builders they replace (buildCentrifugeGeometry, buildCharge, buildBeacon) — sizes, positions and
// return shapes to the millimetre — built as real hardware: a machined-aluminium casing with a bolted foot
// flange, banded couplings, a bearing-housing head and three pipes that rise and bend out to small flanges; a
// hand-bundled canvas satchel charge with webbing straps, a brass-capped detonator well and a timer/keypad; a
// man-portable tripod beacon with a cabled battery box, a ribbed dish on a yoke-mounted feed horn and a caged
// lamp.
//
// The casing is instanced by the hundred (world/build.js, "the cascade: hundreds of casings"), which derives the
// round a bullet meets, and how tall it stands, straight from the geometry: the tallest straight-sided part —
// one radius, kept for a long straight run — is the skin, and the highest vertex of all is the top. That is why
// the skin below is built as one unbroken open cylinder from y = 0.14 to y = 2.78 at radius exactly 0.21, never
// as a stack of shorter drums at that same radius: the detector takes the tallest *single* straight run, not a
// sum of several, so splitting it would make the casing measure as something far shorter than it draws.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lit, glow } from '../materials.js';
import { paint, place, box, cyl, merge, sides, geoDetail } from '../geo.js';
import { lettering } from './lettering.js';

// ===================================================================================================================
// Palette — one family per object, pale enough that the cascade's per-instance light (which multiplies a metal
// part's paint) does not crush it to black; every shade below names a real material (gfx/matter.js) and a
// name not in that catalogue throws, in or out of the second look.

// Centrifuge casing: pale machined aluminium body, darker load-bearing steel, a hazard-yellow coupling band,
// bright galvanised fasteners, warm brass pipe fittings, one muted-blue enamelled valve body.
const C_BODY = 0xb9bdc0; // the skin, head and pipe risers: pale aluminium
const C_BODY_DARK = 0xa3a7a9; // housing underside / neck, a shade darker for a visible shoulder
const C_STEEL = 0x74797b; // foot, flange disc, damper ring: darker structural steel
const C_BAND = 0xc7aa49; // coupling-band paint: a muted hazard-yellow identification ring
const C_GALV = 0xaab0ac; // bright galvanised bolts and gland collars
const C_BRASS = 0xb0703a; // brass pipe flanges and fittings
const C_VALVE = 0x3f6478; // enamelled valve body: a muted blue accent

const sAlum = { mat: 'aluminium', rough: 0.3, metal: 0.78 };
const sAlumDark = { mat: 'aluminium', rough: 0.36, metal: 0.72 };
const sSteel = { mat: 'steel', rough: 0.42, metal: 0.82 };
const sGalv = { mat: 'galv', rough: 0.3, metal: 0.88 };
const sBrass = { mat: 'brass', rough: 0.36, metal: 0.72 };
const sEnamel = { mat: 'enamel', rough: 0.38, metal: 0.08 };

// Demolition charge: olive canvas blocks, darker wrap, green-drab webbing, near-black electronics, brass cap.
const H_CANVAS = 0x4e5536; // bundled block canvas
const H_CANVAS_DK = 0x3a4027; // wrap straps, a shade darker
const H_WEBBING = 0x333a22; // vertical webbing straps
const H_HOUSING = 0x24271f; // timer/keypad housing, detonator-well tube
const H_METAL = 0x2c2f2b; // buckles, D-rings, buttons: dull field hardware
const H_BACK = 0x1c1d16; // the adhesive/magnetic backing plate

// Beacon: sand/olive field paint over dark steel fittings, galvanised tripod hardware, one amber accent.
const B_SAND = 0x9c9070; // mast, dish: painted sand-tan tube and reflector
const B_OLIVE = 0x5c5f45; // legs, battery box: painted olive drab
const B_DARK = 0x3c3e30; // feet, lid, hub collar: near-black fittings
const B_GALV = 0xa7aca8; // locking collars, spreader, cage, yoke
const B_AMBER = 0xe0922e; // the amber lamp band

// ===================================================================================================================
// Small shared helpers (on top of geo.js), the same idioms as gfx/next/drone.js and gfx/next/sentry.js.
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

/** A painted cylinder whose own axis runs from `a` to `b` — struts, cable runs, yoke arms, antenna whips. */
function span(a, b, r1, r2, color, shade, segments = 8) {
  const len = Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return cyl(r1, r2, len, color, mid, axisEuler(a, b), segments, shade);
}

/** A thin open-ended ring, standing on Y — a collar, a gland, a cage band. Cheaper than a capped cylinder. */
function ring(radius, height, color, at, rot, segments, shade) {
  return place(paint(new THREE.CylinderGeometry(radius, radius, height, sides(segments), 1, true), color, shade), {
    at,
    rot,
  });
}

/** An open (no end-cap) tube between two points — pipe runs whose ends tuck into another part or a flange. */
function openSpan(a, b, radius, color, shade, segments = 8) {
  const len = Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return ring(radius, len, color, mid, axisEuler(a, b), segments, shade);
}

/**
 * A cylinder standing on Y with independently optional end caps, scaled by the detail level like every other
 * round part here. A flush join (equal radius on the touching side) only ever needs a cap on whichever side
 * steps out past its neighbour, so the other side can drop its cap entirely: this is what keeps the casing,
 * which the game instances by the hundred, inside its triangle budget.
 */
function drum(radiusTop, radiusBottom, height, color, at, segments, shade, caps = {}) {
  const { top = true, bottom = true } = caps;
  const n = sides(segments);
  const parts = [new THREE.CylinderGeometry(radiusTop, radiusBottom, height, n, 1, true)];
  if (top) parts.push(new THREE.CircleGeometry(radiusTop, n).rotateX(-Math.PI / 2).translate(0, height / 2, 0));
  if (bottom) parts.push(new THREE.CircleGeometry(radiusBottom, n).rotateX(Math.PI / 2).translate(0, -height / 2, 0));
  return place(paint(mergeGeometries(parts), color, shade), { at });
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

/** Fine, close-up detail: dropped entirely at low detail, same as a phone gets no bevels. */
function fine(parts) {
  return geoDetail.bevel ? parts : [];
}

// ===================================================================================================================
/**
 * One centrifuge casing; the game draws hundreds of them with instancing. Centred on the origin, base on y = 0.
 *
 * HARD CONTRACT (world/build.js derives collision and the round's blast height from this geometry, not a
 * hand-written number): the skin is one unbroken open cylinder, radius exactly 0.21 m, from y = 0.14 to y = 2.78
 * (height 2.64) — the tallest straight-sided run on the whole mesh by a wide margin. The highest vertex of the
 * whole geometry is the pipe flanges at y = 3.30. Nothing reaches past 0.27 m from the axis (casings stand
 * 0.5 m apart, two to a cell) and nothing sits below y = 0.
 */
export function buildCentrifugeGeometry() {
  const BODY_SEG = 11; // the skin: sides 11 / 17 / 22 at low / medium / high — the "16+ sided at medium" ask
  const RING_SEG = 6; // foot, bands, neck, housing, flange, valve: a steady, cheap facet count

  // ---- the skin (CONTRACT: radius 0.21 exactly, y 0.14 .. 2.78, one open cylinder, never split) ----
  const SKIN_R = 0.21;
  const SKIN_BOTTOM = 0.14;
  const SKIN_H = 2.64;
  const SKIN_TOP = SKIN_BOTTOM + SKIN_H; // 2.78

  // ---- foot: flares to the (never-seen) floor contact, necks up to meet the skin's own radius exactly ----
  const FOOT_BOTTOM_R = 0.235;
  const FOOT_H = 0.14; // y 0 .. 0.14
  const FLANGE_R = 0.25;
  const FLANGE_H = 0.02;
  const FLANGE_Y = 0.095;

  // ---- top coupling band: steps out past the skin below, so it alone needs a cap there ----
  const BAND_R = 0.225;
  const BAND_H = 0.075;
  const BAND_Y = SKIN_TOP + BAND_H / 2; // 2.8175 -> spans 2.78 .. 2.855
  const BAND_TOP = BAND_Y + BAND_H / 2; // 2.855

  // ---- neck + bearing housing: narrows from the band's radius to the head the pipes root in ----
  const NECK_TOP_R = 0.165;
  const NECK_H = 0.08;
  const HOUSING_R = NECK_TOP_R;
  const HOUSING_H = 0.13;
  const HEAD_TOP = BAND_TOP + NECK_H + HOUSING_H; // 3.065 -> where the pipes root, every detail level alike

  // ---- the three pipes: feed, product, tails, 120 degrees apart, rising from the head to y = 3.30 exactly ----
  const PIPE_ROOT_R = 0.06;
  const PIPE_OUT_R = 0.1; // how far out the bend carries the pipe before it runs straight up to its flange
  const TOP_Y = 3.3; // CONTRACT: the highest vertex of the whole geometry

  const parts = [
    drum(FOOT_BOTTOM_R, SKIN_R, FOOT_H, C_STEEL, [0, FOOT_H / 2, 0], RING_SEG, sSteel, { top: false, bottom: false }),
    drum(SKIN_R, SKIN_R, SKIN_H, C_BODY, [0, SKIN_BOTTOM + SKIN_H / 2, 0], BODY_SEG, sAlum, {
      top: false,
      bottom: false,
    }),
    // band: radius steps out from the skin (0.21) below, so its own bottom cap hides that step; its top is
    // flush with the neck's own bottom radius (both 0.225), so that cap drops.
    drum(BAND_R, BAND_R, BAND_H, C_BAND, [0, BAND_Y, 0], RING_SEG, sSteel, { top: false, bottom: true }),
  ];

  // low tier: the plain casing above is almost the whole triangle budget already — a round body, one band, a
  // tapered head and three simple pipe stubs. Medium/high add the split neck+housing, the bolted flange, the
  // second band, the valve, the damper ring and a bent, flanged pipe — gated together behind `geoDetail.bevel`
  // (the low tier's own single combined head taper below stands in for the neck+housing split, reaching the
  // same HEAD_TOP, so the pipes root at the same spot whatever the tier).
  if (geoDetail.bevel) {
    parts.push(
      drum(NECK_TOP_R, BAND_R, NECK_H, C_BODY_DARK, [0, BAND_TOP + NECK_H / 2, 0], RING_SEG, sAlumDark, {
        top: false,
        bottom: false,
      }),
      drum(
        HOUSING_R,
        HOUSING_R,
        HOUSING_H,
        C_BODY_DARK,
        [0, BAND_TOP + NECK_H + HOUSING_H / 2, 0],
        RING_SEG,
        sAlumDark,
        {
          top: true,
          bottom: false,
        },
      ),
      drum(FLANGE_R, FLANGE_R, FLANGE_H, C_STEEL, [0, FLANGE_Y, 0], RING_SEG, sSteel, { top: true, bottom: true }),
      ...radial(4, FLANGE_R - 0.012, [0, FLANGE_Y, 0], (pos) =>
        box(0.014, 0.014, 0.014, C_GALV, pos, undefined, { ...sGalv, bevel: false }),
      ),
      // second coupling band, lower down the skin — same radius as the band above so its octagon lines up
      drum(BAND_R, BAND_R, 0.045, C_BAND, [0, 1.3, 0], RING_SEG, sSteel, { top: true, bottom: true }),
      // damper ring: a thin proud ring partway up the skin
      drum(0.232, 0.232, 0.032, C_STEEL, [0, 2.2, 0], RING_SEG, sSteel, { top: true, bottom: true }),
      ...valveBody(),
    );
  } else {
    parts.push(
      drum(0.09, BAND_R, HEAD_TOP - BAND_TOP, C_BODY_DARK, [0, (BAND_TOP + HEAD_TOP) / 2, 0], RING_SEG, sAlumDark, {
        top: true,
        bottom: false,
      }),
    );
  }

  /** One of the three header pipes: rises from the head, bends outward, ends in a small flange at y = 3.30.
   *  Riser and bend are open tubes (no end caps: the root tucks into the housing, the tip into the flange) —
   *  what keeps three of these, times hundreds of casings, affordable. */
  function pipe(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const root = [PIPE_ROOT_R * c, HEAD_TOP, PIPE_ROOT_R * s];
    if (!geoDetail.bevel) {
      // low tier: one simple capped stub, straight up to the contract height.
      return [
        drum(0.016, 0.016, TOP_Y - HEAD_TOP, C_BODY, [root[0], (HEAD_TOP + TOP_Y) / 2, root[2]], 6, sAlum, {
          top: true,
          bottom: false,
        }),
      ];
    }
    const kink = [root[0], HEAD_TOP + 0.07, root[2]];
    const flangeY = TOP_Y - 0.02;
    const tip = [PIPE_OUT_R * c, flangeY, PIPE_OUT_R * s];
    return [
      openSpan(root, kink, 0.015, C_BODY, sAlum, 5),
      openSpan(kink, tip, 0.018, C_BODY, sAlum, 5),
      // flange: radius matches the pipe's own end, so its bottom cap can drop (flush, no gap)
      drum(0.022, 0.022, 0.02, C_BRASS, [tip[0], TOP_Y - 0.01, tip[2]], 5, sBrass, { top: true, bottom: false }),
    ];
  }

  /** A sample/bleed valve mounted on the skin's side: a body with a small bonnet — gated, kept well inside the
   *  0.27 m reach limit (farthest point, the box's outer corner after bevel, reaches about 0.233). */
  function valveBody() {
    return [
      box(0.05, 0.05, 0.034, C_VALVE, [0.2, 1.6, 0], undefined, { ...sEnamel, bevel: false }),
      drum(0.016, 0.016, 0.03, C_STEEL, [0.2, 1.64, 0], 4, sSteel, { top: true, bottom: false }),
    ];
  }

  for (let i = 0; i < 3; i++) parts.push(...pipe((i / 3) * Math.PI * 2));

  return merge(parts);
}

// ===================================================================================================================
/**
 * A demolition charge. Its back lies in the plane z = 0 and it stands out towards -Z: a hand-bundled canvas
 * satchel over a magnetic backing plate, webbing straps and buckles, a brass-capped detonator well, a det-cord
 * loop, and a timer/keypad unit with a dim screen and the arming LED. `parts.led` sits exactly where the old
 * model's did, so the game's blink still lands on it.
 */
export function buildCharge() {
  const matLit = lit({ vertexColors: true, rim: 0.5 });
  const matLed = glow({ color: 0xff4020, intensity: 2 });
  const matScreen = glow({ color: 0x5ad66b, intensity: 0.4 });

  const sCanvas = { mat: 'canvas', rough: 0.85, metal: 0 };
  const sWebbing = { mat: 'fabric', rough: 0.8, metal: 0 };
  const sHousing = { mat: 'polymer', rough: 0.55, metal: 0.05 };
  const sMetal = { mat: 'gunmetal', rough: 0.4, metal: 0.7 };
  const sBrassCap = { mat: 'brass', rough: 0.32, metal: 0.78 };
  const sBack = { mat: 'rubber', rough: 0.8, metal: 0 };
  const sCord = { mat: 'rubber', rough: 0.7, metal: 0 };

  const parts = [
    // magnetic/adhesive backing plate: its own back face is the plane z = 0, exactly as the old single block's was
    box(0.34, 0.22, 0.012, H_BACK, [0, 0, -0.006], undefined, sBack),

    // two bundled blocks, side by side, canvas-wrapped, a visible seam between them
    box(0.158, 0.2, 0.086, H_CANVAS, [-0.082, 0, -0.055], undefined, { ...sCanvas, bottom: 0.82, top: 1 }),
    box(0.158, 0.2, 0.086, H_CANVAS, [0.082, 0, -0.055], undefined, { ...sCanvas, bottom: 0.82, top: 1 }),

    // three horizontal wrap straps binding both blocks as one bundle
    box(0.33, 0.026, 0.012, H_CANVAS_DK, [0, 0.076, -0.104], undefined, sCanvas),
    box(0.33, 0.026, 0.012, H_CANVAS_DK, [0, 0, -0.104], undefined, sCanvas),
    box(0.33, 0.026, 0.012, H_CANVAS_DK, [0, -0.076, -0.104], undefined, sCanvas),

    // two vertical webbing straps over the wrap, each with a buckle and a carry D-ring
    box(0.045, 0.27, 0.018, H_WEBBING, [0.095, 0, -0.108], undefined, sWebbing),
    box(0.045, 0.27, 0.018, H_WEBBING, [-0.095, 0, -0.108], undefined, sWebbing),
    ...fine([
      box(0.05, 0.03, 0.014, H_METAL, [0.095, -0.1, -0.118], undefined, { ...sMetal, bevel: false }),
      box(0.05, 0.03, 0.014, H_METAL, [-0.095, -0.1, -0.118], undefined, { ...sMetal, bevel: false }),
      place(paint(new THREE.TorusGeometry(0.018, 0.0045, 4, 8), H_METAL, sMetal), {
        at: [0.095, 0.12, -0.112],
        rot: [Math.PI / 2, 0, 0],
      }),
      place(paint(new THREE.TorusGeometry(0.018, 0.0045, 4, 8), H_METAL, sMetal), {
        at: [-0.095, 0.12, -0.112],
        rot: [Math.PI / 2, 0, 0],
      }),
    ]),
    // rivets riding each wrap strap: three rows of eight small studs, catching the light the way real pressed
    // rivets would along a bound canvas edge
    ...fine(
      [0.076, 0, -0.076].flatMap((y) =>
        [-0.14, -0.1, -0.06, -0.02, 0.02, 0.06, 0.1, 0.14].map((x) =>
          box(0.012, 0.012, 0.007, H_METAL, [x, y, -0.111], undefined, { ...sMetal, bevel: true }),
        ),
      ),
    ),
    // small studs pinning the backing plate's trim around its own edge
    ...fine(
      [-0.16, -0.08, 0, 0.08, 0.16].flatMap((x) => [
        box(0.012, 0.012, 0.006, H_METAL, [x, 0.098, -0.005], undefined, { ...sMetal, bevel: true }),
        box(0.012, 0.012, 0.006, H_METAL, [x, -0.098, -0.005], undefined, { ...sMetal, bevel: true }),
      ]),
    ),
    ...fine(
      [-0.08, 0.08].flatMap((y) => [
        box(0.012, 0.012, 0.006, H_METAL, [-0.16, y, -0.005], undefined, { ...sMetal, bevel: true }),
        box(0.012, 0.012, 0.006, H_METAL, [0.16, y, -0.005], undefined, { ...sMetal, bevel: true }),
      ]),
    ),
    // small maker's data plate, riveted to open canvas between the straps
    box(0.07, 0.034, 0.005, 0x8a8070, [-0.03, 0.038, -0.1], undefined, { mat: 'aluminium', rough: 0.4, metal: 0.6 }),
    // carrying handle: a shallow canvas loop over the top
    span([-0.055, 0.13, -0.1], [0, 0.17, -0.1], 0.009, 0.009, H_CANVAS_DK, sWebbing, 6),
    span([0, 0.17, -0.1], [0.055, 0.13, -0.1], 0.009, 0.009, H_CANVAS_DK, sWebbing, 6),

    // detonator well, upper-left on the block face, with a brass cap plugging it
    ring(0.021, 0.022, H_HOUSING, [-0.09, 0.08, -0.087], [Math.PI / 2, 0, 0], 8, sHousing),
    drum(0.024, 0.024, 0.01, H_HOUSING, [-0.09, 0.08, -0.102], 8, sBrassCap, { top: true, bottom: true }),
    // det cord, looped and tucked by the well
    place(paint(new THREE.TorusGeometry(0.026, 0.0065, 4, 8).rotateY(0.3), H_HOUSING, sCord), {
      at: [-0.14, -0.09, -0.11],
    }),

    // timer/keypad unit, lower right
    box(0.1, 0.078, 0.02, H_HOUSING, [0.1, -0.07, -0.117], undefined, sHousing),
    box(0.05, 0.028, 0.004, 0x204018, [0.1, -0.056, -0.1285], undefined, { mat: 'glass', rough: 0.2, metal: 0 }),
    ...fine(
      [-0.013, 0.013].map((dx) =>
        box(0.016, 0.014, 0.01, H_METAL, [0.1 + dx, -0.088, -0.127], undefined, { ...sMetal, bevel: false }),
      ),
    ),
    // small raised bezel the arming LED sits proud of, directly above the keypad
    box(0.022, 0.022, 0.018, H_HOUSING, [0.1, -0.025, -0.119], undefined, sHousing),
  ];

  const root = new THREE.Group();
  const bodyMesh = new THREE.Mesh(merge(parts), matLit);
  const screen = new THREE.Mesh(box(0.05, 0.028, 0.002, 0xffffff, [0.1, -0.056, -0.131]), matScreen);
  const led = new THREE.Mesh(box(0.013, 0.013, 0.006, 0xffffff, [0.1, -0.025, -0.131]), matLed);
  bodyMesh.add(
    lettering('M183 CHARGE DEMOLITION', { height: 0.016, tone: 'white', at: [0, 0.102, -0.098], rot: [0, Math.PI, 0] }),
    lettering('ARM', { height: 0.012, tone: 'hazard', at: [0.1, -0.11, -0.119], rot: [0, Math.PI, 0] }),
  );
  root.add(bodyMesh, screen, led);

  return { root, parts: { led } };
}

// ===================================================================================================================
/**
 * The lodestar: the beacon the strike homes on. ~1.1 m tall, standing on y = 0 at the origin: a tripod with a
 * locking collar and spreader braces, a cabled battery box, a ribbed dish on a yoke-mounted feed horn, an
 * antenna whip and the amber lamp in a wire cage. `parts.dish` and `parts.lamp` sit at exactly the old
 * positions, so the game's pan and pulse still land right.
 */
export function buildBeacon() {
  const matLit = lit({ vertexColors: true, rim: 0.5 });
  const matLamp = glow({ color: 0xffb347, intensity: 2.2 });

  const sOlive = { mat: 'paint', rough: 0.55, metal: 0 };
  const sSand = { mat: 'paint', rough: 0.5, metal: 0 };
  const sDark = { mat: 'steel', rough: 0.45, metal: 0.6 };
  const sGalv = { mat: 'galv', rough: 0.3, metal: 0.88 };
  const sCable = { mat: 'rubber', rough: 0.9, metal: 0 };
  const sAmber = { mat: 'enamel', rough: 0.35, metal: 0.1 };
  const sAlum = { mat: 'aluminium', rough: 0.32, metal: 0.8 };

  const hubY = 0.34;
  const legParts = [];
  const feet = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const hub = [0, hubY, 0];
    const foot = [Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42];
    const knee = [
      hub[0] + (foot[0] - hub[0]) * 0.55,
      hub[1] + (foot[1] - hub[1]) * 0.55,
      hub[2] + (foot[2] - hub[2]) * 0.55,
    ];
    feet.push(foot);
    legParts.push(
      span(hub, knee, 0.022, 0.018, B_OLIVE, sOlive, 10),
      span(knee, foot, 0.017, 0.014, B_OLIVE, sOlive, 10),
      ...fine([
        collar(hub, foot, 0.55, 0.021, 0.022, B_GALV, sGalv, 10),
        collar(hub, foot, 0.28, 0.0195, 0.018, B_GALV, sGalv, 10), // a second, lighter locking collar nearer the hub
        box(
          0.024,
          0.024,
          0.024,
          B_GALV,
          [hub[0] + (foot[0] - hub[0]) * 0.55, hubY - 0.02, hub[2] + (foot[2] - hub[2]) * 0.55],
          undefined,
          {
            ...sGalv,
            bevel: true,
          },
        ), // knee gusset, bolted where the two leg sections meet
      ]),
      box(0.055, 0.022, 0.055, B_DARK, [foot[0], 0.011, foot[2]], undefined, sDark),
      ring(0.034, 0.01, B_DARK, [foot[0], 0.003, foot[2]], undefined, 10, sDark), // rubber foot pad, proud of the floor box
    );
  }
  // spreader: a triangular brace linking each leg to the next, a little below the locking collars (two layers,
  // one lower and lighter, for a true braced-tripod look)
  for (let i = 0; i < 3; i++) {
    const a = feet[i];
    const b = feet[(i + 1) % 3];
    const mid1 = [a[0] * 0.62, 0.14, a[2] * 0.62];
    const mid2 = [b[0] * 0.62, 0.14, b[2] * 0.62];
    const low1 = [a[0] * 0.4, 0.07, a[2] * 0.4];
    const low2 = [b[0] * 0.4, 0.07, b[2] * 0.4];
    legParts.push(
      ...fine([
        span(mid1, mid2, 0.009, 0.009, B_GALV, sGalv, 6),
        span(low1, low2, 0.007, 0.007, B_GALV, sGalv, 6), // a second, lower brace tying the feet together
      ]),
    );
  }

  const cableEnd = [0.04, 0.94, 0.03]; // where the battery cable disappears into the head wiring
  const mastParts = [
    cyl(0.05, 0.065, 0.1, B_DARK, [0, hubY, 0], undefined, 8, sDark), // hub collar
    cyl(0.028, 0.034, 0.5, B_SAND, [0, 0.62, 0], undefined, 8, { ...sSand, bottom: 0.85, top: 1.05 }), // mast
    box(0.13, 0.17, 0.085, B_OLIVE, [0, 0.5, 0.075], undefined, sOlive), // battery box
    box(0.1, 0.02, 0.07, B_DARK, [0, 0.58, 0.078], undefined, sDark), // lid
    ...fine([
      box(0.022, 0.016, 0.012, B_GALV, [0.05, 0.44, 0.1], undefined, { ...sGalv, bevel: false }), // latch
      box(0.022, 0.016, 0.012, B_GALV, [-0.05, 0.44, 0.1], undefined, { ...sGalv, bevel: false }), // latch
      cyl(0.008, 0.008, 0.012, B_GALV, [0.045, 0.565, 0.12], undefined, 8, sGalv), // connector stub
      // lid screws, a row of four along the battery-box lid's seam
      ...[-0.04, -0.013, 0.013, 0.04].map((x) =>
        box(0.012, 0.012, 0.01, B_GALV, [x, 0.58, 0.11], undefined, { ...sGalv, bevel: true }),
      ),
      // cable clamps, pinning the run to the box and the mast
      ring(0.0075, 0.012, B_DARK, [0.05, 0.63, 0.09], axisEuler([0.045, 0.565, 0.12], [0.06, 0.78, 0.05]), 8, sCable),
      ring(0.006, 0.01, B_DARK, [0.055, 0.73, 0.065], axisEuler([0.045, 0.565, 0.12], [0.06, 0.78, 0.05]), 8, sCable),
    ]),
    span([0.045, 0.565, 0.12], [0.06, 0.78, 0.05], 0.005, 0.0045, B_DARK, sCable, 6), // cable, battery box to head
    span([0.06, 0.78, 0.05], cableEnd, 0.0045, 0.004, B_DARK, sCable, 6),
    ring(0.038, 0.05, B_AMBER, [0, 0.78, 0], undefined, 8, sAmber), // amber band
    cyl(0.03, 0.022, 0.1, B_SAND, [0, 0.92, 0], undefined, 8, sAlum), // mast top / dish pivot collar
    // antenna whip, leaning clear of the dish's swing
    span([0.032, 0.86, 0], [0.05, 1.18, 0.012], 0.0032, 0.0012, B_DARK, { mat: 'polymer', rough: 0.4, metal: 0 }, 6),
    // lamp cage: a basket of thin wire arcs around the amber lamp, tying to two rings
    ...radial(9, 0.045, [0, 0.975, 0], (pos) =>
      span(pos, [pos[0] * 0.68, 1.1, pos[2] * 0.68], 0.0028, 0.0022, B_GALV, sGalv, 5),
    ),
    ring(0.045, 0.012, B_GALV, [0, 0.98, 0], undefined, 16, sGalv),
    ring(0.031, 0.01, B_GALV, [0, 1.095, 0], undefined, 16, sGalv),
  ];

  const root = new THREE.Group();
  const bodyMesh = new THREE.Mesh(merge([...legParts, ...mastParts]), matLit);
  bodyMesh.add(
    lettering('LODESTAR  MK 4', { height: 0.02, tone: 'white', at: [0, 0.5, 0.119], rot: [0, 0, 0] }),
    lettering('ARM', { height: 0.012, tone: 'hazard', at: [0.065, 0.44, 0.08], rot: [0, Math.PI / 2, 0] }),
  );

  // dish: origin on the mast axis; the tilt is baked into the geometry so rotation.y stays free for panning.
  // Ribs, the yoke and the feed horn are built in the same pre-tilt frame and merged in before the one rotation,
  // so everything on the head tips together.
  const dishProfile = [new THREE.Vector2(0.017, 0), new THREE.Vector2(0.075, 0.028), new THREE.Vector2(0.15, 0.06)];
  const dishLathe = paint(new THREE.LatheGeometry(dishProfile, sides(14)), B_SAND, { bottom: 0.9, top: 1.1 });
  const dishLocal = [
    dishLathe,
    // ribs on the convex back, radiating from near the vertex to just under the rim
    ...radial(12, 0.02, [0, -0.006, 0], (pos, a) =>
      span(pos, [Math.cos(a) * 0.14, 0.046, Math.sin(a) * 0.14], 0.006, 0.0035, B_GALV, sGalv, 6),
    ),
    // a second, shorter ring of ribs partway out, bolted where the long ribs cross it
    ...radial(8, 0.085, [0, 0.016, 0], (pos, a) =>
      span(pos, [Math.cos(a) * 0.145, 0.05, Math.sin(a) * 0.145], 0.004, 0.003, B_GALV, sGalv, 5),
    ),
    // rim bolts, a ring of small fasteners catching the light right at the dish's own edge
    ...radial(16, 0.148, [0, 0.058, 0], (pos) =>
      box(0.009, 0.009, 0.006, B_GALV, pos, undefined, { ...sGalv, bevel: true }),
    ),
    // yoke: two struts from the rim to the feed horn, mounted ahead of the dish on its own focal axis
    span([0, 0.05, 0.15], [0, 0.1, 0], 0.007, 0.006, B_GALV, sGalv, 6),
    span([0, 0.05, -0.15], [0, 0.1, 0], 0.007, 0.006, B_GALV, sGalv, 6),
    drum(0.018, 0.012, 0.045, 0xb9bdc0, [0, 0.1, 0], 10, sAlum, { top: true, bottom: true }), // bare aluminium feed horn
    // small fasteners ringing the feed-horn collar where it meets the yoke
    ...fine(
      radial(8, 0.022, [0, 0.082, 0], (pos) =>
        box(0.008, 0.008, 0.006, B_GALV, pos, undefined, { ...sGalv, bevel: true }),
      ),
    ),
  ];
  const dishGeo = place(merge(dishLocal), { rot: [Math.PI * 0.42, 0, 0] });
  const dish = new THREE.Mesh(dishGeo, matLit);
  dish.position.set(0, 0.95, 0);

  const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), matLamp);
  lamp.position.set(0, 1.04, 0);
  paint(lamp.geometry, 0xffffff);

  root.add(bodyMesh, dish, lamp);

  return { root, parts: { lamp, dish } };
}
