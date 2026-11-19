// The gloved hands and sleeves every weapon in src/gfx/next/ is held by: a hand is a set of jointed, tapering
// fingers (base to tip, each inner joint a knuckle) wrapped round whatever the weapon hands it — a grip, a
// handguard, a pump, a knife handle, a grenade — plus a palm, a knuckle-guard, a wrist strap and a sleeved
// forearm that trails back off-screen. One builder, `buildHand()`, serves every one of those: the open hand
// that wraps a grip or a handguard and the closed fist round a knife or grenade differ only in which points its
// fingers curl through, which the caller works out from its own weapon's own shape.
// Built from painted primitives (src/gfx/geo.js), same as every model (docs/DESIGN.md §8.1). No textures, no
// built-in three.js materials, no lights, nothing from Math.random: a hand is a fixed shape.
import * as THREE from 'three';
import { box, cyl, ball, paint, place, sides } from '../geo.js';
import { Outline, extrude } from './extrude.js';

// ---------------------------------------------------------------------------------------------------------------
// Palette, shared by every weapon's hands so that swapping guns never changes the look of the operator's own
// arms. Albedo stays low (DESIGN.md 8.1/8.2): nothing here may be the brightest or most colourful thing on
// screen under a white floodlight.
export const GLOVE = 0x2c2822; // glove fabric: a warm dark coyote-grey, never green, never blue
export const SLEEVE = 0x2b2c27; // sleeve fabric: a dark neutral charcoal, the faintest warmth and no more
export const KNUCKLE = 0x3d3932; // knuckle-guard shell, moulded polymer — a shade lighter than the glove, warm
// and dark like it (never the cool pale grey the floodlight review flagged on the carbine's old sleeve)
export const STRAP = 0x5c5440; // wrist-strap webbing
export const BUCKLE = 0x35363a; // strap buckle, dark hardware
export const SEAM = 0x4a443a; // stitched seam line and the glove/sleeve collar — a shade lighter, not brighter

export const sGlove = { rough: 0.82, metal: 0, mat: 'fabric' };
export const sFabric = { rough: 0.88, metal: 0, mat: 'fabric' }; // sleeve: a looser weave than the glove
export const sKnuckle = { rough: 0.6, metal: 0.08, mat: 'polymer' };
export const sStrap = { rough: 0.8, metal: 0, mat: 'fabric' };
export const sBuckle = { rough: 0.5, metal: 0.3, mat: 'polymer' };
export const sSeam = { rough: 0.75, metal: 0, mat: 'fabric' };

// ---------------------------------------------------------------------------------------------------------------
// Small shared helpers (every weapon file in src/gfx/next/ imports these too, so a strut, a rivet or a rail
// tooth is built the same way whichever file it is in).

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * A painted cylinder running between two points, its own axis aligned from `a` to `b` — splayed struts (fingers,
 * sleeves, cable-like runs). `openEnded` drops both caps, safe when both ends tuck into a joint ball or another
 * strut.
 */
export function strut(a, b, r1, r2, color, shade, segments = 6, openEnded = false) {
  const from = _from.set(a[0], a[1], a[2]).clone();
  const to = _to.set(b[0], b[1], b[2]).clone();
  const length = Math.max(from.distanceTo(to), 1e-5);
  const g = paint(new THREE.CylinderGeometry(r1, r2, length, sides(segments), 1, openEnded), color, shade);
  _dir.subVectors(to, from).normalize();
  _quat.setFromUnitVectors(_up, _dir);
  _mid.addVectors(from, to).multiplyScalar(0.5);
  g.applyQuaternion(_quat);
  g.translate(_mid.x, _mid.y, _mid.z);
  return g;
}

/** A short collar standing proud of a strut's own run, at parameter `t` from `a` to `b` (0 at `a`, 1 at `b`) —
 * the seam where a glove's cuff meets its sleeve, a cable tie, a hose clamp. */
export function collar(a, b, t, radius, half, color, shade, segments = 10) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const uz = dz / len;
  const px = a[0] + dx * t;
  const py = a[1] + dy * t;
  const pz = a[2] + dz * t;
  return strut(
    [px - ux * half, py - uy * half, pz - uz * half],
    [px + ux * half, py + uy * half, pz + uz * half],
    radius,
    radius,
    color,
    shade,
    segments,
    true,
  );
}

/** `n` copies of `make(point, t)` evenly spaced from `a` to `b` inclusive (n=1 sits at the midpoint) — a seam of
 * rivets, a run of rail teeth, a line of slots. */
export function row(a, b, n, make) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    parts.push(make([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], t));
  }
  return parts;
}

/** A tiny flat-sided fastener head standing in for a rivet, screw or roll pin at this distance. */
export function rivet(at, color, shade, size = 0.011) {
  return box(size, size, size, color, at, undefined, shade);
}

/** `n` evenly spaced rivets from `a` to `b` — a seam line of fasteners along a panel join. */
export function rivetRow(a, b, n, color, shade, size) {
  return row(a, b, n, (p) => rivet(p, color, shade, size));
}

/** A hinge/takedown pin: a short fat cylinder lying on its side along X. */
export function pin(at, radius, length, color, shade) {
  return cyl(radius, radius, length, color, at, [0, 0, Math.PI / 2], 8, shade);
}

/** A pair of thin plates proud of a box's left/right (X) faces — the panel-gap seam that makes a slab read as a
 * built-up part rather than one casting. */
export function sidePlates(hw, h, d, color, at, shade, inset = 0.0035) {
  return [
    box(inset * 2, h, d, color, [at[0] + hw + inset, at[1], at[2]], undefined, shade),
    box(inset * 2, h, d, color, [at[0] - hw - inset, at[1], at[2]], undefined, shade),
  ];
}

/**
 * A prism extruded along local Z, its cross-section a flat-bottomed, flat-sided rectangle whose top rounds
 * over in a true arc above `shoulder` (0–1, the fraction of the full height where the round begins) — a
 * receiver shell, a stock comb, anything that needs an actual radius rather than a box's small edge chamfer.
 * Width/height describe the flat part below the shoulder. `plateau` (an absolute half-width) leaves a flat
 * strip at the very top instead of closing to a single ridge — a flat-top receiver's rail spine, rounding
 * away to either side — so a flush rail/deck can sit on it with no gap; 0 (default) is a true pointed dome.
 */
export function domedBox(w, h, d, color, at, rot, shade, shoulder = 0.6, segments = 10, plateau = 0) {
  const hw = w / 2;
  const hh = h / 2;
  const shoulderY = -hh + h * shoulder;
  const pw = Math.min(plateau, hw * 0.98);
  const shape = new Outline();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, shoulderY);
  shape.quadraticCurveTo(hw, hh, pw, hh);
  if (pw > 0) shape.lineTo(-pw, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, shoulderY);
  shape.lineTo(-hw, -hh);
  const g = extrude(shape, { depth: d, bevelEnabled: false, curveSegments: sides(segments) });
  g.translate(0, 0, -d / 2);
  return place(paint(g, color, shade), { at, rot });
}

/** `n` rivets evenly spaced round a circle of `radius` centred on `at` — the seam band where two round parts
 * meet (a tube over a tube, a collar, a knurled ring). `axis` is which way the two parts' own axis runs: 'z'
 * for parts already rotated by +X/90 (barrel, suppressor, buffer tube), 'x' for parts along the gun's left-right. */
export function ringRivets(at, radius, n, color, shade, size, axis = 'z') {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p =
      axis === 'z'
        ? [at[0] + Math.cos(a) * radius, at[1] + Math.sin(a) * radius, at[2]]
        : [at[0], at[1] + Math.cos(a) * radius, at[2] + Math.sin(a) * radius];
    parts.push(rivet(p, color, shade, size));
  }
  return parts;
}

/**
 * A run of Picatinny rail along Z: a base rib plus a row of separate bevelled crossbar teeth, so the slots
 * between them are real gaps rather than grooves scored into one slab.
 * @param {number} zBack  the rear (+Z) end of the run
 * @param {number} zFront the front (-Z) end of the run, zFront < zBack
 */
export function railTeeth(x, y, zBack, zFront, width, color, shade, pitch = 0.0155, tooth = 0.0105) {
  const span = zBack - zFront;
  const count = Math.max(1, Math.floor(span / pitch));
  const parts = [box(width, 0.01, span + 0.01, color, [x, y - 0.005, (zBack + zFront) / 2], undefined, shade)];
  for (let i = 0; i < count; i++)
    parts.push(box(width, 0.013, tooth, color, [x, y + 0.0065, zBack - i * pitch - tooth / 2], undefined, shade));
  return parts;
}

/**
 * A finger: a chain of tapering phalanx struts through `points` (base to tip — 4 points, 3 segments), each joint
 * covered by a small ball kept close to the strut's own radius there, so it reads as a knuckle, not a bead.
 */
function finger(points, radii, color, shade, segments = 6) {
  const parts = [];
  for (let i = 0; i < points.length - 1; i++)
    parts.push(strut(points[i], points[i + 1], radii[i], radii[i + 1], color, shade, segments, true));
  for (let i = 1; i < points.length - 1; i++) parts.push(ball(radii[i] * 1.05, color, points[i], segments, shade));
  parts.push(ball(radii[radii.length - 1] * 0.92, color, points[points.length - 1], segments, shade)); // fingertip
  return parts;
}

/**
 * A sleeved forearm: the same taper-and-knuckle trick as `finger()`, scaled up — `n` struts from `a` to `b`,
 * radius growing from `r0` to `r1`, each internal joint covered by a ball close to the strut's own radius there
 * (not a bead). Alternating joints get a touch more radius (`foldAmp`): a shallow ring where cloth bunches,
 * instead of the bare taper a plain strut chain would give.
 */
function sleeveRun(a, b, n, r0, r1, foldAmp, color, shade, segments = 8) {
  const pts = [];
  const radii = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    radii.push(r0 + (r1 - r0) * t + (i > 0 && i < n && i % 2 === 1 ? foldAmp : 0));
  }
  const parts = [];
  for (let i = 0; i < n; i++)
    parts.push(strut(pts[i], pts[i + 1], radii[i], radii[i + 1], color, shade, segments, true));
  for (let i = 1; i < n; i++) parts.push(ball(radii[i] * 1.03, color, pts[i], segments, shade));
  return parts;
}

// ===================================================================================================================
/**
 * One gloved hand (or fist) and its sleeved forearm, as a flat array of painted geometries — not merged, so a
 * caller can fold it straight into a bigger single mesh (the knife's and the grenade's, each one merged mesh)
 * or merge it alone into its own Mesh (every other weapon's separate `armL`/`armR`).
 *
 * @param {object} spec
 * @param {{points: number[][], radii: number[]}[]} spec.fingers  base-to-tip point chains, 4 points/3 segments
 *   each, one entry per finger (not the thumb) — a wrapping grip sweeps these round the thing held; a fist
 *   curls them in tight underneath it.
 * @param {{points: number[][], radii: number[]}} [spec.thumb]  the thumb, the same shape as a finger
 * @param {number[]} spec.palm  the back-of-the-hand ball's centre
 * @param {number} [spec.palmR]
 * @param {{from: number[], to: number[], n?: number, rot?: number[], size?: number[]}} [spec.knuckleRow]  a row
 *   of knuckle-guard plates evenly spaced between two points, each with the same fixed local rotation
 * @param {{from: number[], to: number[]}} [spec.seam]  a stitched seam ridge across the back of the hand
 * @param {number[]} spec.wrist  where the cuff sits, and the sleeve begins
 * @param {number} [spec.wristR]
 * @param {number[]} spec.elbow  the sleeve's bend
 * @param {number} [spec.elbowR]
 * @param {number[]} spec.away  where the sleeve trails off, below or behind the picture
 * @param {number} [spec.awayR]
 * @param {number} [spec.sleeveSegments]  how many tapered struts the forearm is built from
 * @param {number} [spec.foldAmp]  how far alternating sleeve joints bulge for a cloth fold
 * @param {number[]} [spec.strapRot]  the wrist-strap's local rotation (and the buckle's)
 * @param {number[]} [spec.strapAt]  where the strap band sits; defaults to `wrist`
 * @param {number[]} [spec.buckleAt]  where the buckle sits; defaults to `strapAt`
 * @param {number} [spec.segments]  finger roundness
 * @returns {THREE.BufferGeometry[]}
 */
export function buildHand({
  fingers,
  thumb,
  palm,
  palmR = 0.033,
  knuckleRow,
  seam,
  wrist,
  wristR = 0.035,
  elbow,
  elbowR = 0.044,
  away,
  awayR = 0.05,
  sleeveSegments = 6,
  foldAmp = 0.0018,
  strapRot = [0.3, 0, 0.2],
  strapAt,
  buckleAt,
  segments = 8,
}) {
  const parts = [];
  for (const f of fingers) parts.push(...finger(f.points, f.radii, GLOVE, sGlove, segments));
  if (thumb) parts.push(...finger(thumb.points, thumb.radii, GLOVE, sGlove, segments));
  parts.push(ball(palmR, GLOVE, palm, 10, sGlove)); // back of the hand
  if (knuckleRow) {
    const { from, to, n = 3, rot = [0, 0, 0.25], size = [0.018, 0.012, 0.022] } = knuckleRow;
    parts.push(...row(from, to, n, (p) => box(size[0], size[1], size[2], KNUCKLE, p, rot, sKnuckle)));
  }
  parts.push(strut(palm, wrist, palmR * 0.97, wristR, GLOVE, sGlove, 8, true));
  if (seam) parts.push(strut(seam.from, seam.to, 0.0027, 0.0019, SEAM, sSeam, 4, true)); // stitched seam, back of hand
  const strapP = strapAt ?? wrist;
  const buckleP = buckleAt ?? strapP;
  parts.push(
    ball(wristR + 0.001, SLEEVE, wrist, 10, sFabric), // cuff
    collar(wrist, elbow, 0.12, wristR + 0.0035, 0.0035, SEAM, sSeam, 12), // glove-cuff / sleeve seam
    box(0.07, 0.014, 0.012, STRAP, strapP, strapRot, sStrap), // wrist strap, banded round the cuff
    box(0.014, 0.014, 0.006, BUCKLE, buckleP, strapRot, sBuckle), // strap buckle
    ...sleeveRun(wrist, elbow, sleeveSegments, wristR, elbowR, foldAmp, SLEEVE, sFabric, 10),
    ball(elbowR, SLEEVE, elbow, 11, sFabric), // elbow bend
    strut(elbow, away, elbowR, awayR, SLEEVE, sFabric, 10, true), // sleeve trails well back/down, off-screen
  );
  return parts;
}

// ===================================================================================================================
/**
 * A closed gloved fist round a handle — the knife's grip, the grenade's canister — and its sleeved forearm, as a
 * flat array of painted geometries (same convention as `buildHand()`: not merged, so a caller folds it straight
 * into its own weapon's single merged mesh). A fist's own fingers curl in tight under the palm and are hidden
 * from the one angle a player ever sees their own hand from, so unlike `buildHand()`'s open wrapping hand they
 * are not built as jointed, knuckled chains — each is one tapered strut standing in for a curled finger, the
 * triangles that would have gone into joints the eye never reaches spent instead on the blade, the guard, the
 * back of the hand and the wrist strap, which the eye does reach.
 *
 * @param {object} spec
 * @param {{points: number[][], radii: number[]}[]} spec.fingers  one base-to-tip two-point strut per curled
 *   finger (not the thumb), already placed by the caller against its own weapon's own handle
 * @param {{points: number[][], radii: number[]}} [spec.thumb]  the thumb, wrapped the other way, over the top
 * @param {number[]} spec.palm  the palm box's centre
 * @param {number[]} [spec.palmSize]
 * @param {number[]} [spec.palmRot]
 * @param {number[]} [spec.knuckle]  the knuckle-guard box's centre; omitted if there is no room for one
 * @param {number[]} [spec.knuckleSize]
 * @param {number[]} [spec.knuckleRot]
 * @param {number[]} spec.wrist  where the cuff sits, and the sleeve begins
 * @param {number} [spec.wristR]
 * @param {number[]} spec.elbow  the sleeve's bend
 * @param {number} [spec.elbowR]
 * @param {number[]} spec.away  where the sleeve trails off, below or behind the picture
 * @param {number} [spec.awayR]
 * @param {number} [spec.sleeveSegments]
 * @param {number[]} [spec.strapRot]
 * @param {number[]} [spec.strapAt]
 * @param {number[]} [spec.buckleAt]
 * @param {number} [spec.segments]  finger roundness
 * @returns {THREE.BufferGeometry[]}
 */
export function buildFist({
  fingers,
  thumb,
  palm,
  palmSize = [0.062, 0.05, 0.086],
  palmRot,
  knuckle,
  knuckleSize = [0.068, 0.014, 0.07],
  knuckleRot,
  wrist,
  wristR = 0.035,
  elbow,
  elbowR = 0.044,
  away,
  awayR = 0.05,
  sleeveSegments = 6,
  foldAmp = 0.0018,
  strapRot = [0.3, 0, 0.2],
  strapAt,
  buckleAt,
  segments = 8,
}) {
  const parts = [];
  // capped, not open-ended: a curled finger's tip is often exposed to the player's own eye (tucked round a
  // handle, not buried in another part), so — unlike the sleeve chain's joints, each plugged by a ball — it
  // needs its own end caps, or it is a hollow ring where a fingertip should be.
  for (const f of fingers) parts.push(strut(f.points[0], f.points[1], f.radii[0], f.radii[1], GLOVE, sGlove, segments));
  if (thumb)
    parts.push(strut(thumb.points[0], thumb.points[1], thumb.radii[0], thumb.radii[1], GLOVE, sGlove, segments));
  parts.push(box(palmSize[0], palmSize[1], palmSize[2], GLOVE, palm, palmRot, sGlove));
  if (knuckle) parts.push(box(knuckleSize[0], knuckleSize[1], knuckleSize[2], KNUCKLE, knuckle, knuckleRot, sKnuckle));
  const strapP = strapAt ?? wrist;
  const buckleP = buckleAt ?? strapP;
  parts.push(
    ball(wristR + 0.001, SLEEVE, wrist, 10, sFabric), // cuff
    collar(wrist, elbow, 0.12, wristR + 0.0035, 0.0035, SEAM, sSeam, 12), // glove-cuff / sleeve seam
    box(0.07, 0.014, 0.012, STRAP, strapP, strapRot, sStrap), // wrist strap, banded round the cuff
    box(0.014, 0.014, 0.006, BUCKLE, buckleP, strapRot, sBuckle), // strap buckle
    ...sleeveRun(wrist, elbow, sleeveSegments, wristR, elbowR, foldAmp, SLEEVE, sFabric, 10),
    ball(elbowR, SLEEVE, elbow, 11, sFabric), // elbow bend
    strut(elbow, away, elbowR, awayR, SLEEVE, sFabric, 10, true), // sleeve trails well back/down, off-screen
  );
  return parts;
}
