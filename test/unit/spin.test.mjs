// Contract lock: the casings turn. Decision of 16 November 2026 — the owner: "make the centrifuge spin". The
// skin of each casing turns about its own axis, between a foot and a head that stand still; it is done in the
// vertex shader (gfx/materials.js LODE_SPIN), so that five hundred of them cost the processor nothing; and so
// that the turning can be SEEN on a plain metal skin there are marks on it. What is skin, where the marks go, how
// fast each casing turns and how the turning runs down when the charges are fired is src/world/spin.js, and this.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPIN, skinOf, markSkin, rateOf, turn } from '../../src/world/spin.js';

/** A casing in little: a foot that flares, a straight skin on it, a band that steps out, and a pipe on top. */
function casing(sides) {
  const position = [];
  const normal = [];
  const ring = (radius, y, ny) => {
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const len = Math.hypot(1, ny);
      position.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      normal.push(Math.cos(a) / len, ny / len, Math.sin(a) / len);
    }
  };
  // the foot: from 0.235 at the floor to the skin's own radius where it meets it — its sides lean
  ring(0.235, 0, 0.18);
  ring(0.21, 0.14, 0.18);
  // the skin
  ring(0.21, 0.14, 0);
  ring(0.21, 2.78, 0);
  // the band over it, a little wider
  ring(0.225, 2.78, 0);
  ring(0.225, 2.855, 0);
  // a pipe, off the axis
  for (const y of [3.07, 3.3]) {
    position.push(0.1, y, 0);
    normal.push(1, 0, 0);
  }
  const color = new Float32Array(position.length).fill(0.8);
  return { position: new Float32Array(position), normal: new Float32Array(normal), color, per: sides + 1 };
}

test('the skin is the straight side of the casing and nothing else: not its foot, its band or its pipes', () => {
  for (const sides of [8, 11, 17, 22]) {
    const c = casing(sides);
    const skin = skinOf(c.position, c.normal);
    assert.equal(skin.length, c.position.length / 3);
    const on = [...skin].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    assert.equal(on.length, c.per * 2, `${sides} sides: ${on.length} corners of skin`);
    // exactly the two rings of the skin: the third and the fourth laid down
    assert.deepEqual(
      on,
      Array.from({ length: c.per * 2 }, (_, k) => c.per * 2 + k),
    );
    for (const v of skin) assert.ok(v === 0 || v === 1);
  }
});

test('a casing of another size is told its own: the skin is found by the radius and the height it is given', () => {
  const c = casing(8);
  assert.equal(
    skinOf(c.position, c.normal, { radius: 0.3, bottom: 0.14, top: 2.78 }).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(
    skinOf(c.position, c.normal, { radius: 0.225, bottom: 2.78, top: 2.855 }).reduce((a, b) => a + b, 0),
    c.per * 2,
  );
});

test('the marks: three streaks down the skin, each the height of it, and nothing else is touched', () => {
  assert.equal(SPIN.marks.length, 3);
  for (const sides of [8, 11, 22]) {
    const c = casing(sides);
    const skin = skinOf(c.position, c.normal);
    const before = Float32Array.from(c.color);
    markSkin(c.position, c.color, skin);
    const changed = new Set();
    for (let i = 0; i < skin.length; i++) {
      const was = before[i * 3];
      const is = c.color[i * 3];
      if (!skin[i]) assert.equal(is, was, 'something that is not skin was marked');
      // grey stays grey: the three channels move together
      assert.ok(Math.abs(c.color[i * 3 + 1] - is) < 1e-6 && Math.abs(c.color[i * 3 + 2] - is) < 1e-6);
      if (is !== was)
        changed.add(Math.round((Math.atan2(c.position[i * 3 + 2], c.position[i * 3]) / (2 * Math.PI)) * 1000));
    }
    // each streak is one line of corners from the bottom of the skin to the top (the seam's two lines are one place)
    const places = new Set([...changed].map((a) => ((a % 1000) + 1000) % 1000));
    assert.equal(places.size, 3, `${sides} sides: streaks at ${[...places]}`);
    for (let i = 0; i < skin.length; i++) {
      if (!skin[i] || c.color[i * 3] === before[i * 3]) continue;
      // …and whatever is marked at the bottom is marked the same at the top
      const twin = i < c.per * 3 ? i + c.per : i - c.per;
      assert.equal(c.color[twin * 3], c.color[i * 3]);
    }
    // some of it darker and some lighter than the metal: a streak that could be a shadow, and one that could not
    const marks = [...c.color].filter((v, k) => k % 3 === 0 && v !== 0.8);
    assert.ok(
      Math.min(...marks) < 0.8 * 0.8 && Math.max(...marks) > 0.8 * 1.1,
      `${Math.min(...marks)} … ${Math.max(...marks)}`,
    );
  }
});

test('each casing turns at its own speed, one of a few, and none of them fast enough to stand still on a screen', () => {
  const rates = new Set();
  for (let k = 0; k < 200; k++) {
    const r = rateOf(k / 200);
    rates.add(r);
    assert.ok(r >= 0.7 && r <= 1.3, `a casing turns at ${r} of the middling speed`);
  }
  assert.equal(rates.size, SPIN.speeds);
  // turns a second: quick enough to be seen at a glance, slow enough for a mark to be followed by the eye
  for (const r of rates) assert.ok(SPIN.rate * r > 0.5 && SPIN.rate * r < 2.5);
  // the angle the shader is given comes round — a number that grew for an hour would lose its small change — and
  // it comes round where every one of the speeds comes round with it
  for (const r of rates) {
    const turns = (SPIN.wrap * r) / (2 * Math.PI);
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `at ${r} the wrap is ${turns} turns`);
  }
});

test('the turning: steady while the cascade stands, run down in a few seconds once it is fired, still in the wreck', () => {
  const state = { angle: 0, speed: 1 };
  // standing
  for (let n = 0; n < 60; n++) turn(state, 1 / 60, true);
  assert.ok(Math.abs(state.angle - SPIN.rate * 2 * Math.PI) < 1e-6, `after a second: ${state.angle}`);
  assert.equal(state.speed, 1);
  // fired: it slows, it never goes backwards, and it has stopped by SPIN.runDown
  let last = state.angle;
  let stopped = -1;
  for (let n = 0; n < 60 * 6; n++) {
    turn(state, 1 / 60, false);
    const moved = (state.angle - last + SPIN.wrap) % SPIN.wrap;
    assert.ok(moved < 1, 'it went backwards');
    if (stopped < 0 && state.speed === 0) stopped = n / 60;
    if (state.speed === 0) assert.equal(state.angle, last, 'it moved after it had stopped');
    last = state.angle;
  }
  assert.ok(stopped > SPIN.runDown * 0.8 && stopped < SPIN.runDown * 1.2, `it stopped after ${stopped} s`);
  // stood up again (a new mission): it turns again, from where it was
  turn(state, 0.5, true);
  assert.equal(state.speed, 1);
  assert.notEqual(state.angle, last);
  // an hour of it: the angle is still inside its round
  for (let n = 0; n < 3600; n++) turn(state, 1, true);
  assert.ok(state.angle >= 0 && state.angle < SPIN.wrap);
});
