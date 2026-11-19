// Flying a drone (src/wild/pilot.js): the rules of the flight — what the hand asks and where that takes it, how
// high it may go, what its gun and its end do — with no browser in them. docs/WILD.md, "The uplink".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PILOT, blastAt, createFlight, heightWithin, stepFlight } from '../../src/wild/pilot.js';

const still = { moveX: 0, moveY: 0, lift: 0, lookX: 0, lookY: 0 };
const fly = (f, seconds, ask, dt = 1 / 60) => {
  const went = { x: 0, y: 0, z: 0 };
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const d = stepFlight(f, { dt, ...still, ...ask });
    went.x += d.x;
    went.y += d.y;
    went.z += d.z;
  }
  return went;
};

test('left alone it hangs where it is; pushed forward it flies the way it faces, and comes up to its speed', () => {
  const f = createFlight(0);
  assert.deepEqual(fly(f, 1, {}), { x: 0, y: 0, z: 0 });
  // yaw 0 looks towards −z (as everything in the game does)
  const north = fly(f, 2, { moveY: 1 });
  assert.ok(Math.abs(north.x) < 1e-6 && north.z < -9, `it went ${JSON.stringify(north)}`);
  assert.ok(Math.abs(Math.hypot(f.vx, f.vz) - PILOT.speed) < 0.2, `it flies at ${Math.hypot(f.vx, f.vz)}`);
  // facing east (yaw −π/2), forward is +x and right is +z
  const g = createFlight(-Math.PI / 2);
  const east = fly(g, 2, { moveY: 1 });
  assert.ok(east.x > 9 && Math.abs(east.z) < 1e-6, `it went ${JSON.stringify(east)}`);
  const h = createFlight(0);
  const right = fly(h, 2, { moveX: 1 });
  assert.ok(right.x > 9 && Math.abs(right.z) < 1e-6, 'right of north is east');
});

test('let go, it comes to rest by itself; a diagonal is no faster than straight ahead', () => {
  const f = createFlight(0);
  fly(f, 2, { moveY: 1 });
  fly(f, 2, {});
  assert.ok(Math.hypot(f.vx, f.vz) < 0.05, `it still drifts at ${Math.hypot(f.vx, f.vz)}`);
  const g = createFlight(0);
  fly(g, 3, { moveX: 1, moveY: 1 });
  assert.ok(Math.hypot(g.vx, g.vz) < PILOT.speed + 0.05);
});

test('it climbs and sinks by the hand, slower than it flies; the eye turns with the hand and cannot go over the top', () => {
  const f = createFlight(0);
  const up = fly(f, 2, { lift: 1 });
  assert.ok(up.y > PILOT.climb * 1.4 && up.y < PILOT.climb * 2 + 0.01, `it rose ${up.y}`);
  const down = fly(f, 3, { lift: -1 });
  assert.ok(down.y < -PILOT.climb * 2);
  assert.ok(PILOT.climb < PILOT.speed);
  // looking: the hand's own measure (input.js has already made radians of it), unslowed by any clock
  const g = createFlight(1);
  stepFlight(g, { dt: 1 / 60, ...still, lookX: 0.3, lookY: -0.2 });
  assert.ok(Math.abs(g.yaw - 0.7) < 1e-9 && Math.abs(g.pitch - 0.2) < 1e-9);
  stepFlight(g, { dt: 1 / 60, ...still, lookY: -9 });
  assert.equal(g.pitch, PILOT.pitch);
  stepFlight(g, { dt: 1 / 60, ...still, lookY: 99 });
  assert.equal(g.pitch, -PILOT.pitch);
});

test('it banks into a turn of the head and into a slide to the side, and levels off', () => {
  const f = createFlight(0);
  fly(f, 0.5, { moveX: 1 });
  assert.ok(f.roll < -0.03 && f.roll >= -PILOT.roll, `sliding right it leans ${f.roll}`);
  fly(f, 2, {});
  assert.ok(Math.abs(f.roll) < 0.01);
});

test('the same flight whatever the frame: thirty frames a second or a hundred and twenty', () => {
  const a = createFlight(0.4);
  const b = createFlight(0.4);
  const one = fly(a, 3, { moveY: 1, moveX: 0.4, lift: 0.5 }, 1 / 30);
  const two = fly(b, 3, { moveY: 1, moveX: 0.4, lift: 0.5 }, 1 / 120);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(one[k] - two[k]) < 0.5, `${k}: ${one[k]} and ${two[k]}`);
});

test('how high: never under what a drone flies over, never into the roof, and in the open not out of the cavern', () => {
  // under a roof three metres up
  assert.equal(heightWithin(2.5, 3), 2.5);
  assert.equal(heightWithin(9, 3), 3 - PILOT.headroom);
  assert.equal(heightWithin(0.2, 3), PILOT.low);
  // a roof so low there is no room at all: it keeps to what it flies over
  assert.equal(heightWithin(2.5, 2), PILOT.low);
  // in the open
  assert.equal(heightWithin(40, Infinity), PILOT.high);
  assert.ok(PILOT.low >= 1.9, 'a crate is flown over, not through');
});

test('its end: what is near is hurt most, what is at the edge of it a little, what is beyond not at all', () => {
  assert.equal(blastAt(0), PILOT.blast.damage);
  assert.equal(blastAt(PILOT.blast.radius), PILOT.blast.least);
  assert.equal(blastAt(PILOT.blast.radius + 0.01), 0);
  assert.ok(blastAt(1) > blastAt(3));
  // a drone beside it does not survive; a sentry does, once
  assert.ok(blastAt(1.5) > 55 && blastAt(0) < 100);
});

test('the numbers hold together', () => {
  assert.ok(PILOT.seconds >= 15 && PILOT.seconds <= 30);
  assert.ok(PILOT.gun.damage * 7 >= 100, 'a second of its gun on a sentry is the sentry');
  assert.ok(PILOT.gun.interval > 0.05);
  assert.ok(PILOT.fov > 80 && PILOT.fov <= 104);
});
