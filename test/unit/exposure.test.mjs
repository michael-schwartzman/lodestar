// Contract lock: the exposure that follows the place (the second look).
//
// Decision of 16 November 2026 — the plan's third step, which the owner said to go on with, lists "exposure that
// adapts". It is worked out from the light the game already knows of, not read off the picture (src/look/
// exposure.js says why), and it multiplies the player's own brightness setting; it never takes its place.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOOKS, MID, createExposure, exposureFor, sceneLight } from '../../src/look/exposure.js';

test('a place of middling light is exposed as it always was; a brighter one less, a darker one more — within limits', () => {
  assert.equal(exposureFor(MID), 1);
  // by the square root: four times the light, half the exposure — a bright place still looks the brighter
  assert.ok(Math.abs(exposureFor(MID * 2) - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(exposureFor(MID / 2) - Math.SQRT2) < 1e-9);
  let last = Infinity;
  for (let light = 0; light <= 8; light += 0.05) {
    const e = exposureFor(light);
    assert.ok(e >= 0.62 && e <= 1.5, `${e} for ${light}`);
    assert.ok(e <= last, 'more light asked for more exposure');
    last = e;
  }
  assert.equal(exposureFor(0), 1.5);
  assert.equal(exposureFor(100), 0.62);
});

test('it creeps: towards the light in about a second, towards the dark in several — and is set at once when the eye jumps', () => {
  const exposure = createExposure();
  assert.equal(exposure.value, 1);
  // out of a dim place into a flood: most of the way in a second
  const bright = exposureFor(4);
  let t = 0;
  let before = exposure.value;
  while (Math.abs(exposure.value - bright) > 0.02 && t < 20) {
    const now = exposure.update(4, 1 / 60);
    assert.ok(now <= before && now >= bright - 1e-9, 'it overshot, or went the wrong way');
    assert.ok(before - now <= 0.02, `it jumped by ${before - now} in a frame`);
    before = now;
    t += 1 / 60;
  }
  assert.ok(t > 0.4 && t < 2.2, `it took ${t.toFixed(2)} s to close for a flood`);
  // and back into the dark: slower by a good deal
  const dark = exposureFor(0.02);
  let back = 0;
  while (Math.abs(exposure.value - dark) > 0.02 && back < 30) {
    exposure.update(0.02, 1 / 60);
    back += 1 / 60;
  }
  assert.ok(back > t * 2 && back < 9, `it took ${back.toFixed(2)} s to open for the dark, ${t.toFixed(2)} to close`);
  // a long frame (a stall) moves it no further than a quarter of a second would
  const stalled = createExposure();
  stalled.update(4, 5);
  assert.ok(stalled.value > exposureFor(4) + 0.1, `a five-second stall took it to ${stalled.value}`);
  // the eye jumps: set, not crept
  assert.equal(exposure.update(4, 1 / 60, true), bright);
  // no time has passed (the first frame): nothing moves
  assert.equal(createExposure().update(4, 0), 1);
});

/** a world of one number of light to a cell, `w` cells wide in a row, walled at both ends */
function corridor(lights) {
  const w = lights.length;
  return {
    grid: {
      inside: (x, z) => x >= 0 && x < w && z === 0,
      solidAt: (x, z) => !(x >= 0 && x < w && z === 0),
      // a ray along +x or −x from (ox, 0): stopped by the end walls
      raycast(ox, oy, oz, dx, dy, dz, max, out) {
        const t = dx > 0 ? w - ox : dx < 0 ? ox : Infinity;
        if (t > max) return false;
        out.t = t;
        return true;
      },
    },
    probe(x, z, colour) {
      const l = lights[Math.min(w - 1, Math.max(0, Math.floor(x)))];
      return colour.setRGB(l, l, l);
    },
    keyAt: () => 0,
  };
}

test('what the eye is looking at: where it stands, and three places along its line of sight — never off the map', () => {
  assert.deepEqual(LOOKS, [4, 9, 16]);
  // a dark passage thirty metres long that opens into light at its far end
  const lights = Array.from({ length: 30 }, (_, x) => (x >= 20 ? 3 : 0.05));
  const world = corridor(lights);
  const eye = { x: 12.5, y: 1.6, z: 0.5 };
  const towardsLight = sceneLight(world, eye, { x: 1, z: 0 });
  const awayFromIt = sceneLight(world, eye, { x: -1, z: 0 });
  // looking down the passage at the lit end: 0.3 of where it stands, 0.7 of (dark at 4 m, lit at 9 and 16)
  assert.ok(Math.abs(towardsLight - (0.05 * 0.3 + ((0.05 + 3 + 3) / 3) * 0.7)) < 1e-6, `${towardsLight}`);
  assert.ok(Math.abs(awayFromIt - 0.05) < 1e-6, `looking at the dark end: ${awayFromIt}`);
  // a wall three metres off: every place looked at is this side of it
  const close = sceneLight(world, { x: 27.5, y: 1.6, z: 0.5 }, { x: 1, z: 0 });
  assert.ok(Math.abs(close - 3) < 1e-6);
  // not looking anywhere on the map (straight up): the light where it stands
  assert.ok(Math.abs(sceneLight(world, eye, { x: 0, z: 0 }) - 0.05) < 1e-9);
  // the key lights count as the lamps do
  const lit = { ...world, keyAt: () => 1 };
  assert.ok(Math.abs(sceneLight(lit, eye, { x: -1, z: 0 }) - 1.05) < 1e-6);
});
