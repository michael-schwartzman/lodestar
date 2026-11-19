// The player's next carbine: a suppressed "K9", charcoal anodised receiver, olive polymer furniture, red-dot
// optic — same weapon as src/gfx/models.js buildCarbine, same contract (parts, orientation, scale), rebuilt from
// scratch with real sub-assemblies instead of a few boxes, so the second look's materials and wear have edges
// and grain worth rendering. Built from painted primitives (src/gfx/geo.js) and lit with src/gfx/materials.js —
// no textures, no built-in three.js materials, no lights. Nothing here calls Math.random: these shapes are fixed.
import * as THREE from 'three';
import { lit, glow } from '../materials.js';
import { paint, place, box, cyl, merge, sides } from '../geo.js';
import { lettering } from './lettering.js';
import { row, rivet, rivetRow, pin, sidePlates, ringRivets, railTeeth, domedBox, buildHand } from './hands.js';

// ---------------------------------------------------------------------------------------------------------------
// Palette: a dark, plain gun. Albedo stays low (DESIGN.md 8.1/8.2, and the second look: under a strong white
// floodlight nothing on the weapon may be the brightest or most colourful thing on screen) and, after the first
// review of this model in the game, nothing here may read as green or blue: every tone below was checked by
// hue in .work/palette-check.mjs before it was used. Exported: src/gfx/next/sidearms.js and knife.js are the
// same gun family and share this literally, not a separately eyeballed copy of it.
export const C = 0x2e3135; // gunmetal: receiver, rail, optic housing, mounts
export const CW = 0x484b50; // worn steel: charging handle, selector, catches, levers
export const O = 0x26231d; // dark olive-brown polymer: grip, handguard, stock, mag body
export const OD = 0x1b1915; // olive polymer, recessed/shadowed
export const OM = 0x201e19; // olive polymer, the pattern moulded into it: a shade under the body
export const STEEL = 0x42454a; // exposed barrel
export const STEEL_DARK = 0x323538; // heat-darkened suppressor, bolt carrier
export const RUBBER = 0x201f20; // buttpad, light switch pad
export const ROUND = 0xaf8639; // the one visible brass round — small, and brass really is this bright
const LIGHT_LENS = 0x5d6b70; // weapon-light lens: glassy and cool is expected of a lens, but kept dark and muted

// Explicit rough/metal/mat so every surface lands in the brief's ranges and names its own material, whatever
// geo.js would otherwise guess from the colour alone.
export const sAlum = { rough: 0.48, metal: 0.68, mat: 'gunmetal' }; // receiver, rail, optic housing, mounts
export const sAlumWorn = { rough: 0.45, metal: 0.72, mat: 'steel' }; // handled steel: levers, catches, handle
export const sSteel = { rough: 0.38, metal: 0.86, mat: 'steel' }; // barrel, suppressor, bolt carrier
export const sPoly = { rough: 0.73, metal: 0, mat: 'polymer' }; // furniture: grip, handguard, stock, mag
export const sRubber = { rough: 0.87, metal: 0, mat: 'rubber' }; // buttpad, switch pad
export const sBrass = { rough: 0.32, metal: 0.9, mat: 'brass' }; // the round's own shiny metal grain
const sGlass = { rough: 0.06, metal: 0, mat: 'glass' };

const boreY = 0.082; // bore height above root's origin (the grip), matched to the model this replaces
const sShell = { ...sAlum, bevel: 0.009 }; // the receiver's own big shells: a bigger, slower radius, not a nick

const GRIP_AT = [0, -0.095, 0.036];
const GRIP_TILT = -0.18;
/**
 * A point on the grip's own tilted, slightly elliptical cross-section (wider front-to-back than side-to-side,
 * like the box it wraps): `yLocal` runs up/down its length before the tilt, `angleDeg` sweeps around it (0 =
 * local +Z/rear, 90 = +X/right — the back of a right hand's fingers, 180 = -Z/front — the trigger side, 270 =
 * -X/left), `rx`/`rz` its two half-widths at that point.
 */
function onGrip(yLocal, angleDeg, rx, rz) {
  const a = (angleDeg * Math.PI) / 180;
  const x = Math.sin(a) * rx;
  const z0 = Math.cos(a) * rz;
  const ct = Math.cos(GRIP_TILT);
  const st = Math.sin(GRIP_TILT);
  return [GRIP_AT[0] + x, GRIP_AT[1] + yLocal * ct - z0 * st, GRIP_AT[2] + yLocal * st + z0 * ct];
}

/** A point on the handguard's round cross-section at `zAt`: `angleDeg` 0 = top (+Y), 90 = right (+X), 180 =
 * bottom (-Y), 270 = left (-X). */
function onHandguard(zAt, angleDeg, radius) {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.sin(a) * radius, boreY + Math.cos(a) * radius, zAt];
}

/**
 * A short tube with a wall of its own thickness, lying along the gun's Z: its outside, its inside and both of
 * its ends, each facing the right way — so that it is seen whole from anywhere, the inside of its far wall
 * included.
 */
function ring(outer, inner, length, color, at, shade, segments = 24) {
  const half = length / 2;
  // round the wall's section: up the outside, in across the far end, down the inside, out across the near end
  const section = [
    [outer, -half],
    [outer, half],
    [inner, half],
    [inner, -half],
    [outer, -half],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return place(paint(new THREE.LatheGeometry(section, sides(segments)), color, shade), {
    at,
    rot: [Math.PI / 2, 0, 0],
  });
}

// ===================================================================================================================
/** The player's suppressed carbine, seen from behind the sight, and the two gloved hands holding it. */
export function buildCarbine() {
  const matLit = lit({ vertexColors: true, rim: 0.45 });
  const matDot = glow({ color: 0xff6a2a, intensity: 2.4 });

  const bodyParts = [
    // --- lower receiver: narrower than the upper by design, so the step between them reads as a real seam;
    // grip with finger grooves + beavertail, trigger guard, trigger, mag well flare, selector, bolt catch,
    // mag release, pivot + takedown pins -----------------------------------------------------------------------
    box(0.044, 0.072, 0.11, C, [0, boreY - 0.052, -0.01], undefined, sShell), // lower receiver shell
    ...sidePlates(0.022, 0.05, 0.08, C, [0, boreY - 0.05, -0.01], sAlum),
    place(paint(new THREE.CylinderGeometry(0.047, 0.036, 0.17, sides(34), 1, false), O, sPoly), {
      at: GRIP_AT,
      rot: [GRIP_TILT, 0, 0],
      scale: [0.436, 1, 1],
    }), // grip: an elliptical taper, fuller where the frame meets it, narrower at the base
    box(0.05, 0.028, 0.05, OD, [0, -0.008, 0.063], [-0.1, 0, 0], sPoly), // beavertail, blends grip into the shell
    box(0.034, 0.045, 0.028, OD, [0, -0.06, 0.058], [GRIP_TILT, 0, 0], sPoly), // front strap recess, below trigger
    box(0.036, 0.011, 0.011, OD, [0, -0.055, -0.003], [GRIP_TILT, 0, 0], sPoly), // finger groove 1
    box(0.036, 0.011, 0.011, OD, [0, -0.088, -0.003], [GRIP_TILT, 0, 0], sPoly), // finger groove 2
    box(0.036, 0.011, 0.011, OD, [0, -0.121, -0.003], [GRIP_TILT, 0, 0], sPoly), // finger groove 3
    box(0.012, 0.012, 0.012, OD, [0, -0.17, 0.045], [GRIP_TILT, 0, 0], sPoly), // grip base cap
    cyl(0.005, 0.005, 0.016, CW, [0, -0.178, 0.045], undefined, 6, sAlumWorn), // grip screw boss
    box(0.012, 0.048, 0.088, C, [0, boreY - 0.058, -0.02], undefined, sAlum), // trigger guard front
    box(0.012, 0.048, 0.014, C, [0, boreY - 0.058, 0.052], undefined, sAlum), // trigger guard back
    box(0.07, 0.012, 0.098, C, [0, boreY - 0.084, -0.011], undefined, sAlum), // trigger guard bottom
    ...rivetRow([0.033, boreY - 0.078, -0.055], [0.033, boreY - 0.078, 0.03], 3, C, sAlum, 0.006), // guard seam, R
    ...rivetRow([-0.033, boreY - 0.078, -0.055], [-0.033, boreY - 0.078, 0.03], 3, C, sAlum, 0.006), // guard seam, L
    box(0.012, 0.03, 0.2, C, [-0.035, boreY - 0.08, -0.1], undefined, sAlum), // winter-trigger shelf, proud rib
    box(0.012, 0.026, 0.022, CW, [0, boreY - 0.05, -0.006], undefined, sAlumWorn), // trigger
    box(0.05, 0.02, 0.02, OD, [0, -0.145, -0.075], [0.3, 0, 0], sPoly), // mag well flare, front
    box(0.05, 0.02, 0.02, OD, [0, -0.145, -0.03], [-0.25, 0, 0], sPoly), // mag well flare, back
    box(0.046, 0.012, 0.072, OD, [0, -0.157, -0.05], undefined, sPoly), // mag well flare, bottom lip
    cyl(0.008, 0.008, 0.01, CW, [-0.032, -0.015, -0.03], [0, 0, Math.PI / 2], 8, sAlumWorn), // mag release
    box(0.01, 0.034, 0.02, CW, [-0.03, 0.045, -0.07], undefined, sAlumWorn), // bolt catch paddle
    box(0.006, 0.02, 0.014, CW, [-0.034, 0.03, -0.07], undefined, sAlumWorn), // bolt catch checkering ridge
    box(0.03, 0.01, 0.018, CW, [-0.026, 0.03, 0.015], [0, 0, -0.15], sAlumWorn), // selector lever (left)
    box(0.012, 0.01, 0.014, CW, [0.024, 0.03, 0.015], undefined, sAlumWorn), // selector nub (right, ambi)
    pin([0, boreY - 0.05, -0.065], 0.011, 0.058, CW, sAlumWorn), // pivot pin
    cyl(0.016, 0.016, 0.004, C, [0.0, boreY - 0.05, -0.065 + 0.031], [0, 0, Math.PI / 2], 10, sAlum), // pivot boss
    pin([0, boreY - 0.045, 0.045], 0.011, 0.058, CW, sAlumWorn), // takedown pin
    cyl(0.016, 0.016, 0.004, C, [0.0, boreY - 0.045, 0.045 + 0.031], [0, 0, Math.PI / 2], 10, sAlum), // td boss
    ...rivetRow([0.019, boreY - 0.02, -0.02], [0.019, boreY - 0.02, 0.04], 4, C, sAlum, 0.008), // lower seam, R
    ...rivetRow([-0.019, boreY - 0.02, -0.02], [-0.019, boreY - 0.02, 0.04], 4, C, sAlum, 0.008), // lower seam, L
    ...rivetRow([0.019, boreY - 0.072, -0.03], [0.019, boreY - 0.072, 0.0], 3, C, sAlum, 0.007), // lower, lower seam
    ...rivetRow([-0.019, boreY - 0.072, -0.03], [-0.019, boreY - 0.072, 0.0], 3, C, sAlum, 0.007),
    place(paint(new THREE.TorusGeometry(0.016, 0.0035, Math.max(4, sides(5)), sides(14)), C, sAlum), {
      at: [0.0295, boreY - 0.05, -0.02],
      rot: [0, Math.PI / 2, 0],
      scale: [1, 1.5, 1],
    }), // lightening-cut lip, R — one raised oval ring, not a grid of studs
    place(paint(new THREE.TorusGeometry(0.016, 0.0035, Math.max(4, sides(5)), sides(14)), C, sAlum), {
      at: [-0.0295, boreY - 0.05, -0.02],
      rot: [0, Math.PI / 2, 0],
      scale: [1, 1.5, 1],
    }), // lightening-cut lip, L

    // --- upper receiver: forward assist, ejection port + open dust cover, brass deflector, charging handle,
    // bolt carrier seen through the port (the separate `bolt` mesh) ---------------------------------------------
    domedBox(0.05, 0.06, 0.3, C, [0, boreY + 0.006, -0.1], undefined, sShell, 0.45, 12, 0.017), // upper receiver: a true lathed-radius shoulder, not a box with a chamfer — flat only where the rail spine sits
    ...sidePlates(0.025, 0.05, 0.27, C, [0, boreY + 0.006, -0.1], sAlum),
    box(0.032, 0.012, 0.3, C, [0, boreY + 0.037, -0.1], undefined, sShell), // top deck, proud of the rail base — narrower than the shell so the rounded shoulder shows to each side
    box(0.075, 0.034, 0.016, C, [0.026, boreY + 0.006, -0.07], undefined, {
      bottom: 0.5,
      top: 0.9,
      rough: 0.55,
      metal: 0.4,
      mat: 'gunmetal',
    }), // eject port recess
    box(0.008, 0.05, 0.07, CW, [0.034, boreY + 0.03, -0.07], [0.9, 0, 0], sAlumWorn), // dust cover, hinged open
    cyl(0.004, 0.004, 0.058, CW, [0.034, boreY + 0.055, -0.07], [0, 0, Math.PI / 2], 6, sAlumWorn), // cover hinge pin
    box(0.014, 0.03, 0.022, C, [0.028, boreY + 0.032, -0.042], [0.15, 0, -0.2], sAlum), // brass deflector
    cyl(0.014, 0.014, 0.016, C, [0.026, boreY + 0.012, 0.015], [Math.PI / 2, 0, 0], 10, sAlum), // forward assist
    box(0.022, 0.02, 0.05, CW, [0, boreY + 0.03, 0.03], undefined, sAlumWorn), // charging handle body
    box(0.032, 0.012, 0.016, CW, [0, boreY + 0.038, 0.053], undefined, sAlumWorn), // charging handle latch
    box(0.016, 0.008, 0.01, CW, [0, boreY + 0.02, 0.054], undefined, sAlumWorn), // charging handle roll pin boss
    ...railTeeth(0, boreY + 0.043, 0.065, -0.43, 0.03, CW, sAlumWorn), // top rail: receiver deck + handguard
    ...rivetRow([0.021, boreY + 0.03, -0.2], [0.021, boreY + 0.03, -0.01], 5, C, sAlum, 0.008), // receiver seam, R
    ...rivetRow([-0.021, boreY + 0.03, -0.2], [-0.021, boreY + 0.03, -0.01], 5, C, sAlum, 0.008), // receiver seam, L
    ...rivetRow([0.021, boreY - 0.01, -0.2], [0.021, boreY - 0.01, -0.01], 5, C, sAlum, 0.008),
    ...rivetRow([-0.021, boreY - 0.01, -0.2], [-0.021, boreY - 0.01, -0.01], 5, C, sAlum, 0.008),
    ...rivetRow([0.021, boreY + 0.012, -0.19], [0.021, boreY + 0.012, -0.02], 4, C, sAlum, 0.007), // mid seam
    ...rivetRow([-0.021, boreY + 0.012, -0.19], [-0.021, boreY + 0.012, -0.02], 4, C, sAlum, 0.007),
    ...row([0.032, boreY + 0.006, -0.178], [0.032, boreY + 0.006, -0.152], 3, (p) =>
      box(0.004, 0.022, 0.009, C, p, [0, Math.PI / 2, 0], { ...sAlum, bevel: 0.0035 }),
    ), // cooling slots, R — a row of three, not a grid
    ...row([-0.032, boreY + 0.006, -0.178], [-0.032, boreY + 0.006, -0.152], 3, (p) =>
      box(0.004, 0.022, 0.009, C, p, [0, -Math.PI / 2, 0], { ...sAlum, bevel: 0.0035 }),
    ), // cooling slots, L

    // rack number: the optic mount's left flat; serial: the upper receiver's left side; selector markings; a
    // caliber marking on the optic mount's right flat (all a hair off the surface, children of `body` below).

    // --- compact red-dot optic: mount riser, clamp + QD lever, open front/rear frame with real lenses, two
    // turrets, hood, brightness knob --------------------------------------------------------------------------
    box(0.024, 0.039, 0.022, C, [0, 0.104, -0.11], undefined, sAlum), // riser
    box(0.038, 0.018, 0.052, C, [0, 0.1325, -0.11], undefined, sAlum), // clamp base
    ...rivetRow([0, 0.123, -0.084], [0, 0.123, -0.136], 3, C, sAlum, 0.005), // riser / clamp seam
    box(0.01, 0.026, 0.01, CW, [0.022, 0.126, -0.1], [0, 0, -0.3], sAlumWorn), // QD throw lever
    cyl(0.005, 0.005, 0.016, CW, [0.022, 0.126, -0.1], [Math.PI / 2, 0, 0], 6, sAlumWorn), // QD lever pivot
    cyl(0.0045, 0.0045, 0.018, CW, [0.021, 0.1325, -0.095], [Math.PI / 2, 0, 0], 6, sAlumWorn), // clamp screw
    cyl(0.0045, 0.0045, 0.018, CW, [0.021, 0.1325, -0.125], [Math.PI / 2, 0, 0], 6, sAlumWorn), // clamp screw
    // round optic tube — a window is simply the hole straight through its middle, no panel can block it. It is a
    // wall with an inside and an outside (a lathed ring): an open cylinder of one skin shows its near half only,
    // and from the hip the sight was a hook (16 November 2026, seen in the pictures of the finished site).
    ring(0.028, 0.0248, 0.039, C, [0, 0.168, -0.11], sAlum, 24),
    ...ringRivets([0, 0.168, -0.0915], 0.0285, 4, CW, sAlumWorn, 0.0045), // tube / rear lens-bezel seam screws
    ...ringRivets([0, 0.168, -0.1285], 0.0285, 4, CW, sAlumWorn, 0.0045), // tube / front lens-bezel seam screws
    // The window is open: a sight is for looking through, and a lens that can be seen is one that hides what is
    // aimed at (test/second/look.test.mjs). What says "glass" is the bezel each lens would sit in. (A bezel is
    // four millimetres of skin inside the tube: one skin is all of it that can be seen, and a phone's gun has
    // no triangles to spare for its other side.)
    ...[-0.0975, -0.1225].map((z) =>
      place(paint(new THREE.CylinderGeometry(0.0195, 0.0195, 0.004, sides(24), 1, true), CW, sAlumWorn), {
        at: [0, 0.168, z],
        rot: [Math.PI / 2, 0, 0],
      }),
    ), // front and rear lens bezels
    box(0.05, 0.012, 0.012, C, [0, 0.198, -0.129], undefined, sAlum), // hood, front lip
    box(0.05, 0.012, 0.012, C, [0, 0.198, -0.091], undefined, sAlum), // hood, rear lip
    cyl(0.009, 0.009, 0.013, CW, [0.0255, 0.185, -0.098], [0, 0, 0], 8, sAlumWorn), // elevation turret stem
    cyl(0.0115, 0.0115, 0.005, CW, [0.0255, 0.1915, -0.098], [0, 0, 0], 8, sAlumWorn), // elevation turret cap
    cyl(0.009, 0.009, 0.013, CW, [0.0255, 0.16, -0.1225], [0, 0, Math.PI / 2], 8, sAlumWorn), // windage turret stem
    cyl(0.0115, 0.0115, 0.005, CW, [0.0315, 0.16, -0.1225], [0, 0, Math.PI / 2], 8, sAlumWorn), // windage turret cap
    cyl(0.008, 0.008, 0.014, CW, [-0.0255, 0.145, -0.125], [Math.PI / 2, 0, 0], 8, sAlumWorn), // brightness knob
    cyl(0.009, 0.009, 0.002, C, [-0.0255, 0.145, -0.132], [Math.PI / 2, 0, 0], 8, sAlum), // knob base flange
    // folded back-up irons: flat on the rail, well clear of the optic's own window
    box(0.022, 0.012, 0.03, C, [0, boreY + 0.05, 0.078], undefined, sAlum),
    cyl(0.009, 0.009, 0.012, CW, [0, boreY + 0.056, 0.082], [Math.PI / 2, 0, 0], 8, sAlumWorn),
    cyl(0.0035, 0.0035, 0.024, CW, [0, boreY + 0.056, 0.082], [0, 0, Math.PI / 2], 6, sAlumWorn), // pivot pin
    box(0.018, 0.012, 0.024, C, [0, boreY + 0.05, -0.42], undefined, sAlum),
    box(0.006, 0.016, 0.006, CW, [0, boreY + 0.06, -0.428], undefined, sAlumWorn),
    cyl(0.003, 0.003, 0.02, CW, [0, boreY + 0.05, -0.42], [0, 0, Math.PI / 2], 6, sAlumWorn), // pivot pin

    // --- free-float handguard: round tube, M-LOK-style slots on three faces, barrel nut, QD sling sockets,
    // a weapon light on an accessory rail segment, gas block + tube --------------------------------------------
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0.0335, -0.105],
            [0.0338, -0.06],
            [0.034, 0],
            [0.0342, 0.06],
            [0.0344, 0.095],
            [0.0348, 0.098],
            [0.0345, 0.105],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(34),
          0,
          Math.PI * 2,
        ),
        O,
        sPoly,
      ),
      { at: [0, boreY - 0.004, -0.35], rot: [Math.PI / 2, 0, 0] },
    ), // handguard: one lathed tube, a hair fuller at the receiver end with a flare before the barrel-nut collar
    ...row([0, 0, -0.26], [0, 0, -0.43], 9, (p) =>
      box(0.0075, 0.0075, 0.0075, STEEL_DARK, onHandguard(p[2], 0, 0.0345), undefined, {
        rough: 0.5,
        metal: 0.1,
        mat: 'steel',
      }),
    ), // top-of-handguard rivets, just under the rail
    place(paint(new THREE.CylinderGeometry(0.037, 0.037, 0.018, sides(14), 1, true), C, sAlum), {
      at: [0, boreY - 0.004, -0.257],
      rot: [Math.PI / 2, 0, 0],
    }), // barrel nut
    ...ringRivets([0, boreY - 0.004, -0.266], 0.0365, 10, C, sAlum, 0.006), // barrel nut / handguard seam
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 4;
      return cyl(
        0.004,
        0.004,
        0.012,
        CW,
        [Math.cos(a) * 0.033, boreY - 0.004 + Math.sin(a) * 0.033, -0.257],
        [Math.PI / 2, 0, 0],
        6,
        sAlumWorn,
      );
    }), // barrel nut screws
    ...[-110, 110].flatMap((side) =>
      row([0, 0, -0.27], [0, 0, -0.425], 8, (p) => {
        const a = onHandguard(p[2], side, 0.0345);
        return box(0.02, 0.009, 0.018, STEEL_DARK, a, [0, 0, side > 0 ? -0.08 : 0.08], {
          rough: 0.55,
          metal: 0.1,
          mat: 'steel',
        });
      }),
    ), // M-LOK slots, left + right
    ...row([0, 0, -0.27], [0, 0, -0.425], 8, (p) =>
      box(0.024, 0.009, 0.016, STEEL_DARK, onHandguard(p[2], 180, 0.0345), [0.08, 0, 0], {
        rough: 0.55,
        metal: 0.1,
        mat: 'steel',
      }),
    ), // M-LOK slots, bottom
    cyl(0.009, 0.009, 0.016, C, onHandguard(-0.29, 150, 0.036), [0, 0, (150 * Math.PI) / 180], 8, sAlum), // QD socket
    cyl(0.011, 0.004, 0.006, C, onHandguard(-0.29, 150, 0.046), [0, 0, (150 * Math.PI) / 180], 8, sAlum),
    cyl(0.009, 0.009, 0.016, C, onHandguard(-0.405, -150, 0.036), [0, 0, (-150 * Math.PI) / 180], 8, sAlum), // QD socket
    cyl(0.011, 0.004, 0.006, C, onHandguard(-0.405, -150, 0.046), [0, 0, (-150 * Math.PI) / 180], 8, sAlum),
    // weapon light, clamped to the handguard's underside (the one accessory)
    box(0.026, 0.012, 0.022, C, onHandguard(-0.37, 200, 0.036), undefined, sAlum), // mount clamp
    cyl(0.015, 0.015, 0.058, C, [0.024, boreY - 0.052, -0.37], [Math.PI / 2, 0, 0], 12, sAlum), // light body
    ...ringRivets([0.024, boreY - 0.052, -0.397], 0.0155, 6, C, sAlum, 0.004), // light body / bezel seam
    cyl(0.017, 0.017, 0.006, C, [0.024, boreY - 0.052, -0.4], [Math.PI / 2, 0, 0], 12, sAlum), // bezel
    cyl(0.015, 0.015, 0.002, LIGHT_LENS, [0.024, boreY - 0.052, -0.403], [Math.PI / 2, 0, 0], 12, sGlass), // lens
    cyl(0.016, 0.016, 0.008, C, [0.024, boreY - 0.052, -0.344], [Math.PI / 2, 0, 0], 12, sAlum), // tailcap
    box(0.006, 0.006, 0.01, RUBBER, [0.024, boreY - 0.036, -0.344], undefined, sRubber), // pressure-pad switch
    box(0.028, 0.032, 0.032, STEEL_DARK, [0, boreY, -0.44], undefined, sSteel), // gas block
    ...sidePlates(0.014, 0.024, 0.024, STEEL_DARK, [0, boreY, -0.44], sSteel, 0.002),
    ...ringRivets([0, boreY, -0.459], 0.015, 6, CW, sAlumWorn, 0.005), // gas block / barrel collar
    cyl(0.0035, 0.0035, 0.06, STEEL, [0, boreY + 0.024, -0.42], [Math.PI / 2, 0, 0], 6, sSteel), // gas tube

    // --- stepped barrel + heat-darkened suppressor: collar, main tube, cooling flutes, hex wrench flats,
    // end cap, muzzle hint --------------------------------------------------------------------------------------
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0.0135, -0.025],
            [0.0133, -0.015],
            [0.0128, 0],
            [0.0125, 0.015],
            [0.0122, 0.025],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(34),
        ),
        STEEL,
        sSteel,
      ),
      { at: [0, boreY, -0.475], rot: [Math.PI / 2, 0, 0] },
    ), // exposed barrel: a true lathed taper, a hair fuller at the gas block
    // the collar, main tube and end cap are one lathed profile — a true turned part, not three cylinders
    // butted together — with its own chamfers at the shoulders and a flat, slightly domed cap at the muzzle end.
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0, 0],
            [0.023, 0],
            [0.0235, 0.004],
            [0.023, 0.016],
            [0.0255, 0.0185],
            [0.0255, 0.06],
            [0.0245, 0.065],
            [0.0255, 0.07],
            [0.0255, 0.11],
            [0.0245, 0.115],
            [0.0255, 0.12],
            [0.0255, 0.166],
            [0.0255, 0.138],
            [0.0245, 0.143],
            [0.0255, 0.148],
            [0.024, 0.1685],
            [0.024, 0.196],
            [0.0215, 0.199],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(34),
        ),
        STEEL_DARK,
        sSteel,
      ),
      { at: [0, boreY, -0.696], rot: [Math.PI / 2, 0, 0] },
    ), // suppressor: end cap, main tube, mount collar — one lathed turning
    ...ringRivets([0, boreY, -0.503], 0.0245, 8, STEEL_DARK, sSteel, 0.005), // collar / barrel thread seam
    ...ringRivets([0, boreY, -0.531], 0.026, 10, STEEL_DARK, sSteel, 0.005), // collar / tube seam
    ...ringRivets([0, boreY, -0.626], 0.0255, 8, STEEL_DARK, sSteel, 0.0045), // baffle-stage seam, 1
    ...ringRivets([0, boreY, -0.581], 0.0255, 8, STEEL_DARK, sSteel, 0.0045), // baffle-stage seam, 2
    ...ringRivets([0, boreY, -0.553], 0.0255, 8, STEEL_DARK, sSteel, 0.0045), // baffle-stage seam, 3
    ...row([0, boreY, -0.54], [0, boreY, -0.685], 10, (p) =>
      place(paint(new THREE.CylinderGeometry(0.0285, 0.0285, 0.009, sides(34), 1, true), STEEL_DARK, sSteel), {
        at: p,
        rot: [Math.PI / 2, 0, 0],
      }),
    ), // suppressor rings
    ...row([0, 0, -0.5075], [0, 0, -0.6975], 16, (p, t) =>
      box(
        0.0045,
        0.0045,
        0.012,
        STEEL_DARK,
        [Math.cos(t * Math.PI * 10) * 0.026, boreY + Math.sin(t * Math.PI * 10) * 0.026, p[2]],
        undefined,
        {
          rough: 0.5,
          metal: 0.2,
          mat: 'steel',
        },
      ),
    ), // cooling flutes, winding slightly around the tube
    ...[-0.575, -0.615, -0.65].flatMap((z, row_i) =>
      Array.from({ length: 6 }, (_, i) => {
        const deg = (i / 6) * 360 + row_i * 30;
        const onTube = onHandguard(z, deg, 0.0255 - 0.005); // sunk most of the way in, pokes out a hair
        return cyl(0.0055, 0.0055, 0.013, STEEL_DARK, onTube, [0, 0, (deg * Math.PI) / 180], 8, {
          rough: 0.6,
          metal: 0.15,
          mat: 'steel',
        });
      }),
    ), // three rings of six lathed ports venting the baffles
    place(paint(new THREE.CylinderGeometry(0.0285, 0.0285, 0.022, 6, 1, true), STEEL_DARK, sSteel), {
      at: [0, boreY, -0.545],
      rot: [Math.PI / 2, 0, 0],
    }), // wrench flats
    ...ringRivets([0, boreY, -0.679], 0.0225, 10, STEEL_DARK, sSteel, 0.005), // end cap / tube seam
    place(
      paint(new THREE.CylinderGeometry(0.008, 0.004, 0.004, sides(12), 1, true), STEEL_DARK, {
        rough: 0.25,
        metal: 0.3,
        mat: 'steel',
      }),
      {
        at: [0, boreY, -0.696],
        rot: [Math.PI / 2, 0, 0],
      },
    ), // bore hint

    // --- real stock: buffer tube, adjustable body with cheek rest, latch + position nubs, ridged rubber pad,
    // sling loop ---------------------------------------------------------------------------------------------
    cyl(0.0165, 0.0165, 0.15, C, [0, boreY, 0.1], [Math.PI / 2, 0, 0], 22, sAlum), // buffer tube
    ...ringRivets([0, boreY, 0.03], 0.0172, 8, C, sAlum, 0.005), // buffer tube / receiver seam
    place(
      paint(
        new THREE.LatheGeometry(
          [
            [0, -0.05],
            [0.02, -0.047],
            [0.04, -0.04],
            [0.044, -0.025],
            [0.042, 0],
            [0.0405, 0.025],
            [0.034, 0.042],
            [0.028, 0.05],
          ].map(([r, y]) => new THREE.Vector2(r, y)),
          sides(34),
        ),
        O,
        sPoly,
      ),
      {
        at: [0, boreY - 0.012, 0.183],
        rot: [Math.PI / 2, 0, 0],
        scale: [0.75, 1, 1],
      },
    ), // stock body: one lathed taper, a real narrowing from the latch collar to the pad — not a near-cylinder
    ...sidePlates(0.029, 0.05, 0.08, O, [0, boreY - 0.014, 0.183], sPoly),
    ...ringRivets([0, boreY, 0.17], 0.0172, 8, O, sPoly, 0.005), // buffer tube / stock body seam
    // The stock is the part of the gun nearest the eye: a grid of studs on it is a toy brick. Three ribs moulded
    // along each flank instead, a hair proud, and three grooves across the cheek rest.
    ...[-1, 1].flatMap((side) =>
      [-0.016, 0, 0.016].map((dy) =>
        box(0.002, 0.0055, 0.066, OM, [side * 0.0343, boreY - 0.014 + dy, 0.183], undefined, sPoly),
      ),
    ), // stock ribs, both flanks
    ...[-0.022, 0, 0.022].map((dz) => box(0.03, 0.002, 0.0055, O, [0, boreY + 0.0423, 0.168 + dz], undefined, sPoly)), // cheek rest grooves
    box(0.034, 0.024, 0.08, OD, [0, boreY + 0.03, 0.168], undefined, sPoly), // cheek rest
    box(0.022, 0.016, 0.022, CW, [0, boreY - 0.052, 0.145], [0.2, 0, 0], sAlumWorn), // adjustment lever
    cyl(0.005, 0.005, 0.01, CW, [0, boreY - 0.052, 0.145], [Math.PI / 2, 0, 0], 6, sAlumWorn), // lever pivot
    rivet([0, boreY - 0.022, 0.15], CW, sAlumWorn, 0.01), // position-indicator nub
    rivet([0, boreY - 0.022, 0.19], CW, sAlumWorn, 0.01),
    box(0.064, 0.1, 0.026, RUBBER, [0, boreY - 0.012, 0.246], undefined, sRubber), // buttpad
    ...row([0, boreY - 0.045, 0.261], [0, boreY + 0.022, 0.261], 4, (p) =>
      box(0.062, 0.006, 0.004, RUBBER, p, undefined, sRubber),
    ), // buttpad ridges, rear (shoulder) face — the rubber material's own grain carries the rest of the texture
    ...[-0.028, 0.028].flatMap((x) => [
      rivet([x, boreY - 0.044, 0.235], CW, sAlumWorn, 0.009), // buttpad screws
      rivet([x, boreY + 0.02, 0.235], CW, sAlumWorn, 0.009),
    ]),
    place(paint(new THREE.TorusGeometry(0.018, 0.0048, Math.max(4, sides(8)), sides(18)), C, sAlum), {
      at: [0, boreY - 0.055, 0.21],
      rot: [Math.PI / 2, 0, 0],
    }), // sling loop
  ];
  const body = new THREE.Mesh(merge(bodyParts), matLit);

  // rack number: the optic mount's left flat, visible with the gun at the hip and aimed (the frame-left panel
  // sits almost on the sight's own axis). Serial: the upper receiver's left side, for side views. Selector
  // markings by the lever. A caliber marking on the optic mount's right flat.
  body.add(
    lettering('K9-0417', { height: 0.009, tone: 'white', at: [-0.0306, 0.168, -0.11], rot: [0, -Math.PI / 2, 0] }),
    lettering('0219-K9', { height: 0.011, tone: 'white', at: [-0.0266, boreY, -0.17], rot: [0, -Math.PI / 2, 0] }),
    lettering('S 1 A', { height: 0.006, tone: 'hazard', at: [-0.031, 0.034, 0.008], rot: [0, -Math.PI / 2, 0] }),
    lettering('5.56', { height: 0.008, tone: 'white', at: [0.0306, 0.168, -0.11], rot: [0, Math.PI / 2, 0] }),
  );

  // magazine: origin at the well (just forward of the trigger guard); a curve, ribs, floor plate and the one
  // round visible at the feed lips. Slides down + tilts on reload (src/weapon.js reads this position as home).
  const magGeo = merge([
    place(paint(new THREE.CylinderGeometry(0.023, 0.023, 0.09, sides(34), 1, false), O, sPoly), {
      at: [0, -0.045, -0.04],
      rot: [-0.08, 0, 0],
      scale: [0.696, 1, 1],
    }),
    place(paint(new THREE.CylinderGeometry(0.021, 0.021, 0.085, sides(34), 1, false), O, sPoly), {
      at: [0, -0.125, -0.052],
      rot: [-0.2, 0, 0],
      scale: [0.714, 1, 1],
    }),
    place(paint(new THREE.CylinderGeometry(0.02, 0.02, 0.05, sides(34), 1, false), O, sPoly), {
      at: [0, -0.19, -0.062],
      rot: [-0.1, 0, 0],
      scale: [0.7, 1, 1],
    }),
    box(0.036, 0.016, 0.05, OD, [0, -0.218, -0.066], [-0.1, 0, 0], sPoly), // floor plate
    box(0.038, 0.006, 0.052, OD, [0, -0.227, -0.067], [-0.1, 0, 0], sPoly), // floor plate base pad lip
    ...row([0, -0.075, -0.014], [0, -0.175, -0.028], 4, (p) => box(0.034, 0.008, 0.008, OD, p, undefined, sPoly)), // ribs, front
    ...row([0.016, -0.075, -0.018], [0.013, -0.19, -0.042], 4, (p) =>
      box(0.0065, 0.009, 0.024, OM, p, undefined, sPoly),
    ), // ribs, R flank — the mag's curve, not a waffle grid
    ...row([-0.016, -0.075, -0.018], [-0.013, -0.19, -0.042], 4, (p) =>
      box(0.0065, 0.009, 0.024, OM, p, undefined, sPoly),
    ), // ribs, L flank
    rivet([0.016, -0.1, -0.045], OD, sPoly, 0.009), // witness hole
    rivet([0.016, -0.15, -0.052], OD, sPoly, 0.009),
    rivet([-0.016, -0.1, -0.045], OD, sPoly, 0.009), // witness hole, other side
    rivet([-0.016, -0.15, -0.052], OD, sPoly, 0.009),
    cyl(0.0095, 0.0095, 0.03, ROUND, [0, 0, -0.034], [Math.PI / 2, 0, 0], 14, sBrass), // the one visible round
    cyl(0.0095, 0.0105, 0.004, ROUND, [0, 0.014, -0.034], [Math.PI / 2, 0, 0], 14, sBrass), // its case rim
  ]);
  const mag = new THREE.Mesh(magGeo, matLit);
  mag.position.set(0, boreY - 0.045, -0.052);

  // bolt carrier group: visible through the ejection port, racked +Z (rearward) when the game fires or reloads.
  const boltGeo = merge([
    box(0.022, 0.026, 0.07, STEEL_DARK, [0, 0, 0], undefined, sSteel), // carrier body
    box(0.018, 0.02, 0.012, STEEL, [0, -0.002, -0.038], undefined, sSteel), // bolt face
    box(0.005, 0.01, 0.02, CW, [0.012, 0.006, -0.03], undefined, sAlumWorn), // extractor
    cyl(0.0035, 0.0035, 0.026, CW, [0, 0.014, -0.01], [Math.PI / 2, 0, 0], 6, sAlumWorn), // cam pin
    place(paint(new THREE.CylinderGeometry(0.0115, 0.0115, 0.004, sides(10), 1, true), STEEL, sSteel), {
      at: [0, -0.002, -0.044],
      rot: [Math.PI / 2, 0, 0],
    }), // gas ring
  ]);
  const boltPart = new THREE.Mesh(boltGeo, matLit);
  boltPart.position.set(0.024, boreY + 0.006, -0.07);

  // sight: empty at the centre of the window; the dot floats there, on the bore's vertical plane (x = 0) so the
  // aimed pose (src/weapon.js) does not skew sideways.
  const sight = new THREE.Object3D();
  sight.position.set(0, 0.17, -0.112);
  const dotGeo = new THREE.SphereGeometry(0.004, 8, 6);
  paint(dotGeo, 0xffffff);
  const dot = new THREE.Mesh(dotGeo, matDot);
  sight.add(dot);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, boreY, -0.702);

  // --- arms: five-fingered gloved hands, built directly in the gun's own coordinates. Waypoints come off the
  // onGrip/onHandguard helpers, which place them on the actual tilted/round surfaces those parts occupy, so a
  // finger rides its outside rather than cutting through it. -----------------------------------------------------

  /**
   * The firing hand: middle/ring/pinky wrap the grip from its back-right round to its front; the index runs
   * nearly straight along the right side of the trigger guard/frame rather than wrapping; the thumb wraps the
   * other way, over the top-left, resting near the selector.
   */
  function buildFiringHand() {
    const rows = [
      { y: 0.028, sweep: [70, 112, 150, 182], r: [0.0115, 0.0097, 0.0082, 0.0068] }, // middle
      { y: -0.008, sweep: [68, 110, 150, 185], r: [0.0105, 0.0088, 0.0075, 0.0062] }, // ring
      { y: -0.042, sweep: [64, 106, 148, 188], r: [0.0092, 0.0078, 0.0066, 0.0054] }, // pinky
    ];
    const fingers = rows.map(({ y, sweep, r }) => ({
      points: sweep.map((deg, i) => {
        const k = i / (sweep.length - 1);
        const rx = 0.03 - k * 0.013;
        const rz = 0.058 - k * 0.03;
        return onGrip(y - k * 0.012, deg, rx, rz);
      }),
      radii: r,
    }));
    fingers.push({
      points: [
        [0.021, 0.006, 0.026],
        [0.0205, -0.006, -0.006],
        [0.018, -0.012, -0.034],
        [0.015, -0.015, -0.055],
      ],
      radii: [0.0112, 0.0096, 0.0081, 0.0062],
    }); // index: straight along the guard, not wrapped
    const thumb = {
      points: [
        [-0.015, -0.006, 0.05],
        [-0.026, 0.006, 0.033],
        [-0.03, 0.018, 0.012],
        [-0.027, 0.027, -0.009],
      ],
      radii: [0.0128, 0.0105, 0.009, 0.0075],
    }; // wrapping the other way over the top-left
    const palm = onGrip(0.01, 90, 0.034, 0.058);
    const wrist = onGrip(0.07, 100, 0.036, 0.058);
    const knuckleFrom = [0.034, -0.038, 0.05];
    const knuckleTo = [0.028, -0.115, 0.034];
    return merge(
      buildHand({
        fingers,
        thumb,
        palm,
        palmR: 0.033,
        knuckleRow: { from: knuckleFrom, to: knuckleTo, rot: [0, 0.1, 0.25] },
        seam: { from: knuckleTo, to: wrist },
        wrist,
        wristR: 0.035,
        elbow: [0.0725, -0.2433, 0.2201],
        elbowR: 0.044,
        away: [0.1175, -0.3833, 0.4401],
        awayR: 0.05,
        strapAt: [wrist[0], wrist[1] - 0.002, wrist[2] + 0.003],
        strapRot: [0.3, 0, 0.2],
        buckleAt: [wrist[0] + 0.026, wrist[1] - 0.005, wrist[2]],
      }),
    );
  }

  /**
   * The support hand: it cups the handguard from below, palm against its underside; the four fingers wrap up
   * the far (+X, right) side, knuckles toward the eye and fingertips curling out of sight past the top; the
   * thumb lies forward along the near (-X, left) side, pointing toward the muzzle. The forearm runs back from
   * the wrist down and to the LEFT — toward the shooter's own elbow, off the bottom-left of the picture — not
   * straight down like a post.
   */
  function buildSupportHand() {
    const zRows = [-0.266, -0.289, -0.312, -0.335];
    const radii = [
      [0.0112, 0.0096, 0.0081, 0.0062],
      [0.0112, 0.0096, 0.0081, 0.0062],
      [0.0098, 0.0084, 0.0071, 0.0057],
      [0.0085, 0.0073, 0.0062, 0.005],
    ];
    const sweep = [175, 120, 75, 35]; // base near the bottom, wrapping up the far/right side to the fingertip
    const fingers = zRows.map((z, i) => ({
      points: sweep.map((deg) => onHandguard(z, deg, 0.0335 + radii[i][0] * 0.55)),
      radii: radii[i],
    }));
    const thumb = {
      points: [
        onHandguard(-0.261, 250, 0.042),
        onHandguard(-0.284, 244, 0.043),
        onHandguard(-0.307, 238, 0.04),
        onHandguard(-0.328, 233, 0.035),
      ],
      radii: [0.0128, 0.0105, 0.009, 0.0075],
    }; // lying forward along the near side, toward the muzzle — not crossing over the top
    const palm = onHandguard(-0.301, 192, 0.05);
    const wrist = onHandguard(-0.27, 220, 0.078);
    const knuckleFrom = onHandguard(-0.266, 168, 0.056);
    const knuckleTo = onHandguard(-0.335, 168, 0.056);
    return merge(
      buildHand({
        fingers,
        thumb,
        palm,
        palmR: 0.033,
        knuckleRow: { from: knuckleFrom, to: knuckleTo, rot: [0.1, 0, -0.3], size: [0.012, 0.018, 0.022] },
        seam: { from: knuckleTo, to: wrist },
        wrist,
        wristR: 0.035,
        elbow: [-0.2, -0.17, -0.04],
        elbowR: 0.044,
        away: [-0.36, -0.34, 0.18],
        awayR: 0.05,
        strapAt: [wrist[0] - 0.003, wrist[1] + 0.002, wrist[2] - 0.028],
        strapRot: [0.1, 0.2, 0.3],
        buckleAt: [wrist[0] - 0.006, wrist[1] + 0.005, wrist[2] - 0.002],
      }),
    );
  }

  const armR = new THREE.Mesh(buildFiringHand(), matLit);
  const armL = new THREE.Mesh(buildSupportHand(), matLit);

  const root = new THREE.Group();
  root.add(body, mag, boltPart, armL, armR, muzzle, sight);

  return { root, parts: { body, mag, bolt: boltPart, armL, armR, muzzle, sight, dot } };
}
