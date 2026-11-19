// Bent time (src/wild/focus.js): the rules of FOCUS and of the REFLEX, with no browser in them.
// The wild branch's experiment — docs/WILD.md, "Bent time".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOCUS, createFocus, earn, reflex, stepFocus } from '../../src/wild/focus.js';

const run = (state, seconds, now = {}, dt = 1 / 60) => {
  const said = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) said.push(...stepFocus(state, { dt, toggle: false, can: true, ...now }));
  return said;
};

test('left alone, time is not bent: both clocks run at 1, the meter is at nought, and three uses wait', () => {
  const f = createFocus();
  assert.deepEqual(run(f, 3), []);
  assert.deepEqual([f.world, f.own, f.meter, f.on, f.usesLeft], [1, 1, 0, false, FOCUS.uses]);
});

test('FOCUS: asked for, the world slows to three tenths and the player to a little over half, eased in — and a use is spent', () => {
  const f = createFocus();
  assert.deepEqual(stepFocus(f, { dt: 1 / 60, toggle: true, can: true }), ['on']);
  assert.equal(f.on, true);
  assert.equal(f.usesLeft, FOCUS.uses - 1);
  // a fresh use begins at a full meter (the frame just run has only just begun spending it)
  assert.ok(f.meter > 0.99, `a fresh use begins at ${f.meter}`);
  // eased, not jumped: after one frame it has only begun
  assert.ok(f.world < 1 && f.world > 0.8, `after one frame the world runs at ${f.world}`);
  run(f, 0.6);
  assert.ok(Math.abs(f.world - FOCUS.world) < 0.01, `the world runs at ${f.world}`);
  assert.ok(Math.abs(f.own - FOCUS.own) < 0.01, `the player runs at ${f.own}`);
  // the player is the faster of the two: that is the point of it
  assert.ok(FOCUS.own > FOCUS.world * 1.5);
});

test('FOCUS lasts as long as the meter: a full one is five seconds, and it ends by itself', () => {
  const f = createFocus();
  stepFocus(f, { dt: 0, toggle: true, can: true });
  const said = run(f, FOCUS.seconds - 0.1);
  assert.deepEqual(said, []);
  assert.equal(f.on, true);
  assert.ok(f.meter > 0 && f.meter < 0.05);
  let end = [];
  for (let n = 0; n < 12 && !end.length; n++) end = stepFocus(f, { dt: 1 / 60, toggle: false, can: true });
  assert.deepEqual(end, ['spent']);
  assert.deepEqual([f.on, f.meter], [false, 0]);
  // the use is gone, not merely paused: this is one of the three
  assert.equal(f.usesLeft, FOCUS.uses - 1);
  // and the clocks come back to 1
  run(f, 1);
  assert.ok(Math.abs(f.world - 1) < 0.01 && Math.abs(f.own - 1) < 0.01);
  // the meter is never under nought, whatever the frame
  const g = createFocus();
  stepFocus(g, { dt: 0, toggle: true, can: true });
  stepFocus(g, { dt: 60, toggle: false, can: true });
  assert.equal(g.meter, 0);
});

// 17 November 2026 — the owner's new rule replaces "what is left of the meter is kept" (the old test's name):
// a use, once spent, does not refund any part of itself for next time.
test('FOCUS let go of early: the use is still spent, and what was left of its meter is lost, not kept', () => {
  const f = createFocus();
  stepFocus(f, { dt: 0, toggle: true, can: true });
  run(f, 2);
  assert.ok(f.meter > 0.5, `meter still has ${f.meter} on it`);
  assert.deepEqual(stepFocus(f, { dt: 1 / 60, toggle: true, can: true }), ['off']);
  assert.deepEqual([f.on, f.meter], [false, 0]);
  assert.equal(f.usesLeft, FOCUS.uses - 1, 'the use is spent regardless');
  // a fresh press spends a second use and begins again at a full meter — none of the first is carried over
  assert.deepEqual(stepFocus(f, { dt: 0, toggle: true, can: true }), ['on']);
  assert.equal(f.meter, 1);
  assert.equal(f.usesLeft, FOCUS.uses - 2);
});

// 17 November 2026 — the owner: "also limit the number of focus and uplinks a use can do". The meter no longer
// fills by itself; this replaces the old "the meter fills again … slowly by itself" test.
test('the meter no longer fills by itself; what is done well puts time back on the use now running, never over full, and nothing while FOCUS is off', () => {
  const f = createFocus();
  const left = run(f, 10);
  assert.deepEqual(left, []);
  assert.equal(f.meter, 0, 'ten seconds idle leaves the meter exactly where it was');
  // nothing is earned while FOCUS is off
  earn(f, 'kill');
  assert.equal(f.meter, 0);
  // a use running: a kill, a head shot, a takedown put time back on it — most for what is hardest
  stepFocus(f, { dt: 0, toggle: true, can: true });
  run(f, 2);
  const before = f.meter;
  earn(f, 'kill');
  assert.ok(Math.abs(f.meter - (before + FOCUS.gain.kill)) < 1e-9);
  earn(f, 'head');
  earn(f, 'takedown');
  assert.ok(FOCUS.gain.takedown > FOCUS.gain.head && FOCUS.gain.head > FOCUS.gain.kill);
  // …but never over a full meter
  for (let n = 0; n < 9; n++) earn(f, 'takedown');
  assert.equal(f.meter, 1);
  earn(f, 'nothing known');
  assert.equal(f.meter, 1);
  // once that use ends, the next earn is wasted — there is no use running to put it on
  run(f, FOCUS.seconds + 0.1);
  assert.equal(f.on, false);
  earn(f, 'kill');
  assert.equal(f.meter, 0);
});

// 17 November 2026 — the owner: "also limit the number of focus and uplinks a use can do". Replaces the old
// floor-based "FOCUS is refused on a meter that is all but empty" test: there is no floor now, only a count.
test('FOCUS: three uses a mission — a fourth press is refused, said once, and bends nothing', () => {
  const f = createFocus();
  for (let n = 0; n < FOCUS.uses; n++) {
    assert.deepEqual(stepFocus(f, { dt: 1 / 60, toggle: true, can: true }), ['on']);
    run(f, FOCUS.seconds + 0.1);
    assert.equal(f.on, false);
  }
  assert.equal(f.usesLeft, 0);
  // let the clocks finish coming back to 1 before judging whether a refused press moves them
  run(f, 2);
  const worldBefore = f.world;
  assert.deepEqual(stepFocus(f, { dt: 1 / 60, toggle: true, can: true }), ['refused']);
  assert.equal(f.on, false);
  assert.ok(Math.abs(f.world - worldBefore) < 1e-6, 'a refused press bends nothing further');
  // held down, it is not said again and again: one press, one word
  assert.deepEqual(run(f, 1), []);
  assert.deepEqual(stepFocus(f, { dt: 1 / 60, toggle: true, can: true }), ['refused']);
});

test('the REFLEX: it bends time harder than FOCUS, for a little over two seconds, costs no meter, and then must rest', () => {
  const f = createFocus();
  assert.equal(reflex(f), true);
  run(f, 0.6);
  assert.ok(Math.abs(f.world - FOCUS.reflex.world) < 0.01, `the world runs at ${f.world}`);
  assert.ok(FOCUS.reflex.world < FOCUS.world);
  // 17 November 2026 — the meter no longer rests at a full 1 when idle (it no longer fills by itself); a reflex
  // that begins on a fresh FOCUS still does not touch it, so it stays at whatever it was: nought
  assert.equal(f.meter, 0, 'a reflex is not paid for');
  assert.equal(f.reflexT > 0, true);
  // it ends by itself
  const said = run(f, FOCUS.reflex.seconds);
  assert.deepEqual(said, ['reflex-over']);
  assert.equal(f.reflexT, 0);
  run(f, 1);
  assert.ok(Math.abs(f.world - 1) < 0.01);
  // …and there is not another until it has rested
  assert.equal(reflex(f), false);
  run(f, FOCUS.reflex.cooldown);
  assert.equal(reflex(f), true);
});

test('there is no REFLEX while FOCUS is on — time is bent already — and none is owed for it afterwards', () => {
  const f = createFocus();
  stepFocus(f, { dt: 0, toggle: true, can: true });
  assert.equal(reflex(f), false);
  assert.equal(f.coolT, 0, 'a reflex that was not had is not rested from');
});

// 17 November 2026 — the owner: "…and once uplink fire is being used the alarm still should be triggered…" sits
// beside this: "the REFLEX … is not a use: it stays free, with its rest of 25 seconds, exactly as it is."
test('the REFLEX is not a use: it is free even once every FOCUS use is spent', () => {
  const f = createFocus();
  for (let n = 0; n < FOCUS.uses; n++) {
    stepFocus(f, { dt: 1 / 60, toggle: true, can: true });
    run(f, FOCUS.seconds + 0.1);
  }
  assert.equal(f.usesLeft, 0);
  assert.equal(reflex(f), true);
  assert.equal(f.usesLeft, 0, 'a reflex spends no use');
  run(f, 0.6);
  assert.ok(Math.abs(f.world - FOCUS.reflex.world) < 0.01, `the world runs at ${f.world}`);
});

test('FOCUS asked for during a REFLEX begins at once, and the harder of the two bends until the reflex is over', () => {
  const f = createFocus();
  reflex(f);
  run(f, 0.5);
  assert.deepEqual(stepFocus(f, { dt: 1 / 60, toggle: true, can: true }), ['on']);
  run(f, 0.5);
  // the harder of the two bends
  assert.ok(Math.abs(f.world - FOCUS.reflex.world) < 0.02, `the world runs at ${f.world}`);
  run(f, FOCUS.reflex.seconds);
  assert.ok(Math.abs(f.world - FOCUS.world) < 0.02, `after the reflex the world runs at ${f.world}`);
});

test('when the mission is not being played — paused, down, over — nothing is bent and nothing runs', () => {
  const f = createFocus();
  stepFocus(f, { dt: 0, toggle: true, can: true });
  reflex(f);
  run(f, 1);
  const meter = f.meter;
  const said = stepFocus(f, { dt: 1 / 60, toggle: false, can: false });
  assert.deepEqual(said, ['off']);
  assert.deepEqual([f.on, f.reflexT, f.world, f.own], [false, 0, 1, 1]);
  assert.equal(f.meter, meter);
  // …and a key pressed then does nothing
  assert.deepEqual(stepFocus(f, { dt: 1 / 60, toggle: true, can: false }), []);
  assert.equal(f.on, false);
});

test('the numbers hold together', () => {
  assert.ok(FOCUS.world > 0 && FOCUS.world < FOCUS.own && FOCUS.own < 1);
  assert.ok(FOCUS.reflex.own > FOCUS.reflex.world);
  assert.ok(FOCUS.fov > 0.9 && FOCUS.fov < 1);
  assert.ok(FOCUS.uses >= 1 && FOCUS.uses <= 5, 'a count worth having, not a flood');
  // a reflex is over long before the next can come
  assert.ok(FOCUS.reflex.cooldown > FOCUS.reflex.seconds * 5);
});
