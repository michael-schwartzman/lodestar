// Contract lock: what a machine can see of you — all of you, only the head you lean out, or nothing.
// Leaning round a corner is only worth doing if it shows less of you than stepping out does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PEEK, exposure } from '../../src/enemies/sight.js';
import { Grid, KIND } from '../../src/world/grid.js';

/** An open field with a wall along z = 10 that ends at x = 10: everything from x = 10 eastwards is wall. */
function corner() {
  const g = new Grid(24, 24);
  for (let x = 10; x < 24; x++) g.kind[g.index(x, 10)] = KIND.WALL;
  return g;
}
// a sentry north-west of the corner, and its eye
const EYE = [8.5, 1.72, 4.5];
const body = (x, z, more = {}) => ({ x, z, y: 0, eye: 1.62, headX: x, headZ: z, ...more });

test('behind the corner, upright: nothing of you can be seen', () => {
  assert.equal(exposure(corner(), ...EYE, body(10.6, 11.6)), 0);
});

test('lean out and only the head shows: a smaller thing to notice, and to hit', () => {
  const g = corner();
  const leaning = body(10.6, 11.6, { headX: 10.1 });
  assert.equal(exposure(g, ...EYE, leaning), PEEK);
  assert.ok(PEEK > 0.2 && PEEK < 0.7, `a leaning head counts for ${PEEK} of a body`);
});

test('step out and all of you shows', () => {
  assert.equal(exposure(corner(), ...EYE, body(9.4, 11.6)), 1);
});

test('leaning the wrong way, or not far enough, shows nothing', () => {
  const g = corner();
  assert.equal(exposure(g, ...EYE, body(10.6, 11.6, { headX: 11.1 })), 0, 'leaning further behind the wall');
  assert.equal(exposure(g, ...EYE, body(12.6, 11.6, { headX: 12.1 })), 0, 'two metres from the corner');
});

test('in the open a lean changes nothing: all of you shows', () => {
  const g = new Grid(24, 24);
  assert.equal(exposure(g, ...EYE, body(10.6, 11.6, { headX: 10.1 })), 1);
});

test('low cover: standing behind a crate your upper half shows; crouched close behind it, nothing does', () => {
  const g = new Grid(24, 24);
  // a row of crates, one metre high, between the sentry and you; you are right up against them
  for (let x = 6; x <= 14; x++) g.block[g.index(x, 8)] = 1.0;
  assert.equal(exposure(g, ...EYE, body(10.5, 9.35)), 1, 'standing');
  assert.equal(exposure(g, ...EYE, body(10.5, 9.35, { eye: 1.02 })), 0, 'crouched');
  // crouched and leaning along the crates is still behind them
  assert.equal(exposure(g, ...EYE, body(10.5, 9.35, { eye: 1.02, headX: 11.0 })), 0);
});

test('standing on a crate counts from where your feet are, not from the ground', () => {
  const g = new Grid(24, 24);
  for (let x = 6; x <= 14; x++) g.block[g.index(x, 8)] = 2.0;
  // on the ground behind a two-metre crate: hidden
  assert.equal(exposure(g, ...EYE, body(10.5, 9.6)), 0);
  // standing a metre up, the head clears it
  assert.equal(exposure(g, ...EYE, body(10.5, 9.6, { y: 1, eye: 2.62 })), 1);
});
