// The slide (src/wild/slide.js): its rules — when it can begin, how fast and how far it goes, what is in its way —
// with no browser in them. The wild branch's experiment: docs/WILD.md, "The slide".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SLIDE, canSlide, inTheWay, slideLength, speedAt } from '../../src/wild/slide.js';

test('it begins fast and ends slow: faster than a run at first, a walk by the end, and never speeds up', () => {
  assert.equal(speedAt(0), SLIDE.speed);
  assert.equal(speedAt(SLIDE.seconds), SLIDE.end);
  assert.ok(SLIDE.speed > 6.6, 'it is no faster than running');
  assert.ok(SLIDE.end < 4.3);
  for (let t = 0; t < SLIDE.seconds; t += 0.05) assert.ok(speedAt(t + 0.05) <= speedAt(t));
  // past its end it is no slower than its end
  assert.equal(speedAt(SLIDE.seconds * 3), SLIDE.end);
});

test('it carries the body between four and six metres', () => {
  const far = slideLength();
  assert.ok(far > 4 && far < 6, `it goes ${far.toFixed(2)} m`);
});

test('it begins only at a run, really going, with the feet on the ground and the hands free — and not straight after another', () => {
  const ok = { running: true, speed: 6.6, grounded: true, holding: false, alive: true, rest: 0 };
  assert.equal(canSlide(ok), true);
  for (const [what, v] of [
    ['running', false],
    // the first step of a run is not a run: nobody slides from standing
    ['speed', 2],
    ['grounded', false],
    ['holding', true],
    ['alive', false],
    ['rest', 0.2],
  ])
    assert.equal(canSlide({ ...ok, [what]: v }), false, what);
  assert.ok(SLIDE.rest > 0.3);
  assert.ok(SLIDE.from > 4.3 && SLIDE.from < 6.6, 'faster than a walk, slower than a run');
});

test('what is in its way: a machine within a metre and ahead — not one beside it, behind it, or further off', () => {
  // sliding north (towards −z) from the origin
  const north = [0, -1];
  assert.equal(inTheWay(0, 0, north, 0, -0.8), true);
  assert.equal(inTheWay(0, 0, north, 0.4, -0.7), true, 'a little to one side is still in the way');
  assert.equal(inTheWay(0, 0, north, 0, -(SLIDE.knock.reach + 0.05)), false, 'too far off');
  assert.equal(inTheWay(0, 0, north, 0, 0.6), false, 'behind');
  assert.equal(inTheWay(0, 0, north, 0.9, -0.05), false, 'beside');
});

test('the numbers hold together', () => {
  assert.ok(
    SLIDE.knock.stun >= 2 && SLIDE.knock.stun <= 4,
    'long enough to do something about it, not long enough to stroll',
  );
  assert.ok(SLIDE.knock.shove > 0 && SLIDE.knock.shove < SLIDE.knock.reach);
  assert.ok(SLIDE.noise > 3.5 && SLIDE.noise < 9, 'it is heard further than a walk, and not as far as a run');
  assert.ok(SLIDE.fov > 1 && SLIDE.fov < 1.1);
  assert.ok(SLIDE.low > 0 && SLIDE.low < 0.4);
  assert.ok(SLIDE.stopped > 0 && SLIDE.stopped < 1);
});
