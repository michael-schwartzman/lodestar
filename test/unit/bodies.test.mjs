// Contract lock: a fallen machine is something the others can find. Decision of 16 November 2026 — the owner:
// "make the robots smarter, when they see a friend of their that died they need to trigger the site alarm you can
// add a feature where you can drag and hide the body so it won't be seen".
//
// A machine that has a fallen one in sight for a second raises the alarm — a machine's alarm: it counts against
// the grade, as one that found YOU does. How far off it sees it goes by the light the body lies in, so the dark
// hides a body as it hides the player; and a body can be taken hold of and dragged there. The rules are
// src/enemies/bodies.js; what the built game does with them is in test/smoke.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BODY, bodyView, seesBody, stepBody, findable, haul, middleOf } from '../../src/enemies/bodies.js';
import { DIFFICULTY } from '../../src/difficulty.js';
import { Grid, KIND } from '../../src/world/grid.js';

const open = () => true;
const walled = () => false;
/** a machine standing at (x, z), looking the way `yaw` says (0 is north: towards −z), with a sentry's eye and cone */
const guard = (x, z, yaw = 0, cone = 0.96) => ({ x, z, eye: 1.72, facing: yaw, cone });

test('how far off a fallen machine is seen goes by the light it lies in: sixteen metres under a lamp, four in the dark', () => {
  assert.equal(bodyView(1), BODY.view);
  assert.equal(BODY.view, 16);
  assert.equal(bodyView(0), BODY.view * BODY.dark);
  assert.equal(bodyView(0), 4);
  // in between, in between — and light past full is full
  assert.ok(bodyView(0.5) > bodyView(0.2) && bodyView(0.2) > bodyView(0));
  assert.equal(bodyView(3), BODY.view);
  assert.equal(bodyView(-1), bodyView(0));
  // the setting stretches it or shrinks it
  assert.equal(bodyView(1, 0.7), 16 * 0.7);
  assert.deepEqual(
    ['recruit', 'operator', 'ghost'].map((name) => DIFFICULTY[name].bodies),
    [0.7, 1, 1.3],
  );
});

test('it is seen as the player is seen: within reach of the eye, inside the cone, with a clear line', () => {
  const body = { x: 10, z: 0 };
  // ten metres ahead, in the light: seen
  assert.equal(seesBody(guard(10, 10), body, 1, open), true);
  // …seventeen metres ahead: too far, even in the light
  assert.equal(seesBody(guard(10, 17), body, 1, open), false);
  // ten metres ahead in the dark: not seen; three metres ahead in the dark: seen
  assert.equal(seesBody(guard(10, 10), body, 0, open), false);
  assert.equal(seesBody(guard(10, 3), body, 0, open), true);
  // behind its back, or off to the side of what it looks at: not seen
  assert.equal(seesBody(guard(10, 10, Math.PI), body, 1, open), false);
  assert.equal(seesBody(guard(10, 10, Math.PI / 2), body, 1, open), false);
  // …unless it is at its feet: a machine standing on a wreck knows it
  assert.equal(seesBody(guard(10, 1, Math.PI), body, 1, open), true);
  // a wall between them: not seen, however near and however bright
  assert.equal(seesBody(guard(10, 5), body, 1, walled), false);
  // the line is drawn from its eye to where the wreck lies, low down
  let line = null;
  seesBody(guard(10, 5), body, 1, (...ends) => {
    line = ends;
    return true;
  });
  assert.deepEqual(line, [10, 1.72, 5, 10, BODY.height, 0]);
  // a machine that is looking for somebody looks about it: a wider cone finds what a narrow one does not
  const aside = guard(10, 10, 1.3);
  assert.equal(seesBody(aside, body, 1, open), false);
  assert.equal(seesBody({ ...aside, cone: 2 }, body, 1, open), true);
});

test('on a real floor: a crate between a guard and a wreck hides it, and the same wreck beside the crate is seen', () => {
  const g = new Grid(20, 20);
  for (let x = 0; x < 20; x++)
    for (let z = 0; z < 20; z++) {
      const edge = x === 0 || z === 0 || x === 19 || z === 19;
      g.kind[g.index(x, z)] = edge ? KIND.WALL : KIND.FLOOR;
      g.block[g.index(x, z)] = edge ? 4 : 0;
    }
  // a container across the middle
  for (let x = 8; x <= 11; x++) g.block[g.index(x, 10)] = 2.6;
  g.changed();
  const clear = g.sight.bind(g);
  const watcher = guard(10, 16);
  assert.equal(seesBody(watcher, { x: 10, z: 6 }, 1, clear), false, 'behind the container');
  assert.equal(seesBody(watcher, { x: 14.5, z: 6 }, 1, clear), true, 'beside it');
});

test('a second in sight, unbroken, and it is found — once', () => {
  assert.equal(BODY.notice, 1);
  const body = { dead: true };
  let found = 0;
  for (let n = 0; n < 9; n++) found += stepBody(body, true, 0.1) ? 1 : 0;
  assert.equal(found, 0, 'nine tenths of a second is not enough');
  assert.ok(body.noticeT > 0.85);
  // a glance away and it has to be looked at all over again
  stepBody(body, false, 0.1);
  assert.equal(body.noticeT, 0);
  for (let n = 0; n < 9; n++) found += stepBody(body, true, 0.1) ? 1 : 0;
  assert.equal(found, 0);
  assert.equal(stepBody(body, true, 0.1), true, 'the second is up');
  assert.equal(body.found, true);
  // and it is not found twice
  for (let n = 0; n < 30; n++) assert.equal(stepBody(body, true, 0.1), false);
});

test('what can be found: a machine that lies where it fell — not one still running, cleared away, or known already', () => {
  assert.equal(findable({ dead: true }), true);
  assert.equal(findable({ dead: false }), false);
  // a retry from a checkpoint clears the wrecks away: they are in the list still, and nobody may trip over them
  assert.equal(findable({ dead: true, gone: true }), false);
  // one that went down while the alarm was sounding — or in the blast — is no news to anybody
  assert.equal(findable({ dead: true, found: true }), false);
});

test('a wreck is taken hold of by its middle, which is not where its feet are', () => {
  // it falls forward: a sentry at (5, 5) that faced north lies with its head towards −z
  const [x, z] = middleOf({ x: 5, z: 5, yaw: 0, type: 'sentry' });
  assert.ok(Math.abs(x - 5) < 1e-9 && z < 5 - 0.5 && z > 5 - 1.2, `${x}, ${z}`);
  // a drone's wreck is where it is
  assert.deepEqual(middleOf({ x: 5, z: 5, yaw: 1, type: 'drone' }), [5, 5]);
});

test('dragged, it follows like a load on a rope: never further than the rope, never through a wall, and let go of if it snags', () => {
  const g = new Grid(30, 12);
  for (let x = 0; x < 30; x++)
    for (let z = 0; z < 12; z++) {
      const edge = x === 0 || z === 0 || x === 29 || z === 11;
      g.kind[g.index(x, z)] = edge ? KIND.WALL : KIND.FLOOR;
      g.block[g.index(x, z)] = edge ? 4 : 0;
    }
  // a wall across the room with a gap at its top end
  for (let z = 3; z < 11; z++) {
    g.kind[g.index(15, z)] = KIND.WALL;
    g.block[g.index(15, z)] = 4;
  }
  g.changed();
  const rope = BODY.rope;
  const body = { x: 5.5, z: 6.5, yaw: 0, type: 'sentry' };
  const hand = { x: 6, z: 6.5 };
  // standing by it: it does not move
  assert.equal(haul(g, body, hand, 0.016), true);
  assert.deepEqual([body.x, body.z], [5.5, 6.5]);
  // walked away along the room: it comes after, and is never further off than the rope is long
  for (let n = 0; n < 200; n++) {
    hand.x += 0.04;
    if (hand.x > 13) hand.x = 13;
    assert.equal(haul(g, body, hand, 0.016), true);
    assert.ok(Math.hypot(hand.x - body.x, hand.z - body.z) <= rope + 1e-6);
  }
  assert.ok(body.x > 13 - rope - 0.01 && Math.abs(body.z - 6.5) < 0.01, `it ended at ${body.x}, ${body.z}`);
  // its head has come round to the hand
  assert.ok(Math.abs(Math.atan2(-(hand.x - body.x), -(hand.z - body.z)) - body.yaw) < 0.2, `it lies at ${body.yaw}`);
  // through the gap and down the far side of the wall: the body is never inside the wall…
  const path = [
    [13, 1.5],
    [17, 1.5],
    [17, 4],
  ];
  let snagged = false;
  for (const [tx, tz] of path)
    for (let n = 0; n < 400 && !snagged; n++) {
      const d = Math.hypot(tx - hand.x, tz - hand.z);
      if (d < 0.02) break;
      hand.x += ((tx - hand.x) / d) * 0.03;
      hand.z += ((tz - hand.z) / d) * 0.03;
      if (!haul(g, body, hand, 0.016)) snagged = true;
      assert.ok(!g.blocked(Math.floor(body.x), Math.floor(body.z)), `the body is in a wall at ${body.x}, ${body.z}`);
    }
  // …and if the corner holds it while the hand goes on, the hand lets go: it is not dragged through
  hand.x = 17;
  hand.z = 9;
  const held = haul(g, body, hand, 0.016);
  // (the stage itself is held to: were the wall not to hold it any more, nothing below would be asked)
  const apart = Math.hypot(hand.x - body.x, hand.z - body.z);
  assert.ok(apart > rope * BODY.snap, `the wall did not hold it: the hand is ${apart.toFixed(2)} m from it`);
  assert.equal(held, false, 'it should have been let go of');
  assert.ok(!g.blocked(Math.floor(body.x), Math.floor(body.z)));
  // a drone's wreck is small: its rope is shorter
  const wreck = { x: 5.5, z: 6.5, yaw: 0, type: 'drone' };
  const far = { x: 8, z: 6.5 };
  haul(g, wreck, far, 0.016);
  assert.ok(Math.hypot(far.x - wreck.x, far.z - wreck.z) < rope * 0.7);
});
