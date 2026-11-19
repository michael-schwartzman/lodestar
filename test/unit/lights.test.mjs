// Contract lock: a drone can be found far off (src/enemies/lights.js). Pure — no three.js, no browser.
//
// Decision of 16 November 2026 — the owner, having played the second look: "the drones sometimes get lost in the
// distance". Two things were found by looking (16 November; pictures of one drone held at 12 to 92 metres down
// the cavern): a machine further than ninety metres from the eye was not drawn at all, and the cavern is longer
// than that; and from forty metres a drone is a line one or two pixels high, which the night haze then takes.
//
// What was decided, and is held here (nobody was asked; each is one number to change):
//   - a machine is drawn as far off as anybody can stand from it on the site;
//   - a drone carries running lights — its eye, in the colour of what it is thinking, and a white strobe on its
//     back — which are never drawn smaller than a few pixels however far off it is, and which the haze takes
//     only half of;
//   - close to, where the drone itself can be seen, they add nothing.
// That they are IN THE PICTURE at seventy and at ninety-five metres is held in a browser (test/smoke.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAR, LIGHT, lightPixels, lightShare, lightSize, strobe } from '../../src/enemies/lights.js';
import { buildSite } from '../../src/world/map.js';
import { SCHEMA } from '../../src/settings.js';

const site = buildSite();
const grid = site.grid;

test('a machine is drawn as far off as anybody can stand from it: no two places on the site are further apart', () => {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let z = 0; z < grid.h; z++)
    for (let x = 0; x < grid.w; x++) {
      if (!grid.walkable(x, z)) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z + 1);
    }
  const across = Math.hypot(x1 - x0, z1 - z0);
  assert.ok(across > 100, `the site is ${across.toFixed(0)} m from corner to corner`);
  assert.ok(FAR >= across, `a machine is drawn to ${FAR} m; the site is ${across.toFixed(1)} m from corner to corner`);
  // it was ninety: less than the length of the main cavern
  assert.ok(FAR > 90);
});

test('a drone’s light is its own size close to, and never less than a few pixels across however far off', () => {
  assert.equal(lightSize(1), LIGHT.size);
  assert.equal(lightSize(10), LIGHT.size);
  // further off it is drawn larger, in step with the distance — never smaller than before
  let before = 0;
  for (let d = 1; d <= FAR; d += 0.5) {
    const size = lightSize(d);
    assert.ok(size >= before, `it shrinks at ${d} m`);
    before = size;
  }
  // on the screen: in a window 720 pixels high, at the widest field of view the settings allow
  const fov = SCHEMA.find((s) => s.key === 'fov');
  for (let d = 10; d <= FAR; d += 1) {
    const wide = lightPixels(d, 720, fov.max);
    assert.ok(wide >= 5, `${wide.toFixed(1)} pixels across at ${d} m, at ${fov.max}°`);
    // and at the field of view the game starts with it is not a lighthouse either
    const usual = lightPixels(d, 720, fov.def);
    assert.ok(usual <= 40 || d < 12, `${usual.toFixed(1)} pixels across at ${d} m`);
  }
  // a phone held sideways is 390 pixels high: three of them, at least (each is three of the screen's own)
  for (let d = 10; d <= FAR; d += 1) assert.ok(lightPixels(d, 390, fov.def) >= 3);
});

test('close to, where the drone itself is seen, its lights add nothing; from twenty-five metres they are full', () => {
  assert.equal(lightShare(0), 0);
  assert.equal(lightShare(LIGHT.near), 0);
  assert.equal(lightShare(LIGHT.full), 1);
  assert.equal(lightShare(FAR), 1);
  let before = 0;
  for (let d = 0; d <= 40; d += 0.25) {
    const share = lightShare(d);
    assert.ok(share >= before && share >= 0 && share <= 1);
    before = share;
  }
  assert.ok(LIGHT.near >= 6 && LIGHT.full <= 30);
  // the haze takes no more than half of it: at ninety metres it takes three quarters of everything else
  assert.ok(LIGHT.fogFloor >= 0.4 && LIGHT.fogFloor <= 0.7);
});

test('the strobe: one short flash in each period, and two drones do not flash together', () => {
  const { period, on } = LIGHT.strobe;
  assert.ok(period >= 0.8 && period <= 2, `a flash every ${period} s`);
  assert.ok(on >= 0.05 && on <= 0.2, `for ${on} s`);
  for (const id of [0, 1, 2, 7]) {
    let lit = 0;
    let flashes = 0;
    let was = strobe(0, id) > 0;
    const step = 0.005;
    for (let t = step; t < period * 10; t += step) {
      const now = strobe(t, id) > 0;
      if (now) lit += step;
      if (now && !was) flashes++;
      was = now;
    }
    assert.ok(flashes >= 9 && flashes <= 10, `drone ${id} flashed ${flashes} times in ten periods`);
    assert.ok(
      Math.abs(lit - on * 10) < 0.15,
      `drone ${id} was lit for ${lit.toFixed(2)} s of ${(period * 10).toFixed(1)}`,
    );
  }
  // at the moment one is lit, its neighbour on the roll is dark
  let together = 0;
  for (let t = 0; t < period * 4; t += 0.005) if (strobe(t, 3) > 0 && strobe(t, 4) > 0) together++;
  assert.equal(together, 0);
  // never negative, never more than one
  for (let t = 0; t < 3; t += 0.01) assert.ok(strobe(t, 5) === 0 || strobe(t, 5) === 1);
});
