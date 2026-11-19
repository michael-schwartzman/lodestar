// The overspeed (src/wild/overspeed.js): the rules of pushing the drives past what the rotors can bear — how long
// it takes, what leaving the room does, when the site answers — with no browser in them.
// The wild branch's experiment: docs/WILD.md, "The overspeed".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OVERSPEED,
  begin,
  createOverspeed,
  hzAt,
  needFor,
  spinAt,
  stepOverspeed,
  strainAt,
} from '../../src/wild/overspeed.js';

const run = (o, seconds, near, dt = 1 / 60) => {
  const said = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) said.push(...stepOverspeed(o, { dt, near }));
  return said;
};

test('how long the room must be held: thirty-two seconds with no charge set, six fewer for each one that is, never under ten', () => {
  assert.equal(needFor(0), OVERSPEED.seconds);
  assert.equal(needFor(1), OVERSPEED.seconds - OVERSPEED.perCharge);
  assert.equal(needFor(3), OVERSPEED.seconds - 3 * OVERSPEED.perCharge);
  assert.equal(needFor(9), OVERSPEED.least);
  assert.ok(needFor(3) >= OVERSPEED.least);
});

test('held, it runs from nought to the end in exactly that long — and says what happens on the way, each thing once', () => {
  const o = createOverspeed();
  assert.equal(o.running, false);
  assert.deepEqual(stepOverspeed(o, { dt: 1, near: true }), [], 'not begun: nothing runs');
  begin(o, 0);
  assert.deepEqual([o.running, o.progress, o.need], [true, 0, 32]);
  const said = run(o, 31.9, true);
  assert.equal(o.running, true);
  assert.ok(o.progress > 0.99 && o.progress < 1);
  // three waves and the lamps, in the order of their marks
  assert.deepEqual(said, ['wave', 'wave', 'dark', 'wave']);
  assert.deepEqual(run(o, 0.2, true), ['done']);
  assert.deepEqual([o.running, o.done, o.progress], [false, true, 1]);
  // done is done: nothing runs after it, and it cannot be begun again
  assert.deepEqual(run(o, 5, true), []);
  begin(o, 0);
  assert.equal(o.running, false);
});

test('each thing happens at its mark', () => {
  const o = createOverspeed();
  begin(o, 0);
  const at = [];
  for (let t = 0; t < 40 && !o.done; t += 1 / 60)
    for (const what of stepOverspeed(o, { dt: 1 / 60, near: true }))
      at.push([what, Math.round(o.progress * 100) / 100]);
  assert.deepEqual(at, [
    ['wave', OVERSPEED.waves[0]],
    ['wave', OVERSPEED.waves[1]],
    ['dark', OVERSPEED.dark],
    ['wave', OVERSPEED.waves[2]],
    ['done', 1],
  ]);
});

test('leave the room and it runs back down, half as fast as it builds; come back and it builds again from where it is', () => {
  const o = createOverspeed();
  begin(o, 0);
  run(o, 16, true);
  assert.ok(Math.abs(o.progress - 0.5) < 0.01);
  run(o, 8, false);
  assert.ok(Math.abs(o.progress - (0.5 - (8 * OVERSPEED.slip) / 32)) < 0.01, `it is at ${o.progress}`);
  const before = o.progress;
  run(o, 4, true);
  assert.ok(Math.abs(o.progress - (before + 4 / 32)) < 0.01);
  // what has happened once does not happen again on the way back up
  assert.deepEqual(
    run(o, 2, true).filter((what) => what === 'wave' || what === 'dark'),
    [],
  );
});

test('left for long enough it runs down to nothing and is abandoned — and can then be begun again from nothing', () => {
  const o = createOverspeed();
  begin(o, 2);
  run(o, 4, true);
  const said = run(o, 60, false);
  assert.deepEqual(said, ['abandoned']);
  assert.deepEqual([o.running, o.progress, o.done], [false, 0, false]);
  begin(o, 2);
  assert.equal(o.running, true);
  // a new run sends its waves again: the site answers each time it is touched
  assert.ok(run(o, 20, true).includes('wave'));
});

test('the progress never leaves 0 … 1, whatever the frame', () => {
  const o = createOverspeed();
  begin(o, 0);
  assert.ok(stepOverspeed(o, { dt: 500, near: true }).includes('done'));
  assert.equal(o.progress, 1);
  const p = createOverspeed();
  begin(p, 0);
  stepOverspeed(p, { dt: 1, near: true });
  stepOverspeed(p, { dt: 500, near: false });
  assert.equal(p.progress, 0);
});

test('what is seen and heard of it grows with it: the drives’ pitch, the turning, the shaking', () => {
  assert.equal(hzAt(0), OVERSPEED.hz[0]);
  assert.equal(hzAt(1), OVERSPEED.hz[1]);
  assert.equal(spinAt(0), 1);
  assert.equal(spinAt(1), OVERSPEED.spin);
  assert.equal(strainAt(0), 0);
  assert.equal(strainAt(OVERSPEED.shakeFrom), 0);
  assert.equal(strainAt(1), 1);
  for (let p = 0; p < 1; p += 0.05) {
    assert.ok(hzAt(p + 0.05) > hzAt(p));
    assert.ok(spinAt(p + 0.05) > spinAt(p));
    assert.ok(strainAt(p + 0.05) >= strainAt(p));
  }
  // the numbers are the ones the history books have
  assert.deepEqual(OVERSPEED.hz, [1064, 1410]);
});
