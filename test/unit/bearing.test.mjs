// Contract lock: which way is which. The map reads like a page — north is up (−Z), east is right (+X) — and
// everything that names a direction (the compass, the readout under the small map, what Overwatch says) agrees.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ARROWS,
  POINTS,
  POINT_WORDS,
  bearingOf,
  contacts,
  headingOf,
  metres,
  pointOf,
  relativeOf,
} from '../../src/bearing.js';
import { AI } from '../../src/enemies/ai.js';
import { buildSite } from '../../src/world/map.js';

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} is not ${b}`);

test('north is −Z and east is +X: the map reads like a page', () => {
  near(bearingOf(0, -1), 0, 'north');
  near(bearingOf(1, 0), 90, 'east');
  near(bearingOf(0, 1), 180, 'south');
  near(bearingOf(-1, 0), 270, 'west');
  near(bearingOf(3, -3), 45, 'north-east');
  assert.deepEqual(
    [
      [0, -5],
      [5, -5],
      [5, 0],
      [5, 5],
      [0, 5],
      [-5, 5],
      [-5, 0],
      [-5, -5],
    ].map(([dx, dz]) => POINTS[pointOf(bearingOf(dx, dz))]),
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  );
  assert.deepEqual(POINT_WORDS, [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ]);
});

test('each of the eight points owns 45 degrees, and north wraps round the top', () => {
  assert.equal(pointOf(0), 0);
  assert.equal(pointOf(22.4), 0);
  assert.equal(pointOf(22.6), 1);
  assert.equal(pointOf(67.4), 1);
  assert.equal(pointOf(67.6), 2);
  assert.equal(pointOf(337.4), 7);
  assert.equal(pointOf(337.6), 0);
  assert.equal(pointOf(359.99), 0);
  assert.equal(pointOf(360), 0);
  assert.equal(pointOf(-45), 7);
  assert.equal(pointOf(765), 1);
  for (let b = 0; b < 360; b += 0.5) assert.ok(pointOf(b) >= 0 && pointOf(b) <= 7);
});

test('the way you face: yaw 0 looks north, turning left goes west, and it wraps', () => {
  near(headingOf(0), 0, 'yaw 0');
  near(headingOf(Math.PI / 2), 270, 'a quarter turn left');
  near(headingOf(-Math.PI / 2), 90, 'a quarter turn right');
  near(headingOf(Math.PI), 180, 'about turn');
  near(headingOf(Math.PI / 2 + 4 * Math.PI), 270, 'two whole turns later');
  near(headingOf(-Math.PI / 2 - 6 * Math.PI), 90, 'three whole turns the other way');
  for (let yaw = -20; yaw < 20; yaw += 0.37) assert.ok(headingOf(yaw) >= 0 && headingOf(yaw) < 360);
});

test('the mission starts facing east, at the cut in the wire', () => {
  const site = buildSite();
  assert.equal(POINT_WORDS[pointOf(headingOf(site.start.yaw))], 'east');
  // …and looking along that heading from the start, the cut in the fence is dead ahead
  assert.equal(relativeOf(site.start.yaw, 14.5 - site.start.x, 67 - site.start.z), 0);
});

test('where something is from where you stand: ahead, right, behind, left — whichever way you face', () => {
  assert.deepEqual(ARROWS, ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']);
  // facing north
  assert.equal(relativeOf(0, 0, -10), 0, 'ahead');
  assert.equal(relativeOf(0, 10, -10), 1, 'ahead and to the right');
  assert.equal(relativeOf(0, 10, 0), 2, 'right');
  assert.equal(relativeOf(0, 0, 10), 4, 'behind');
  assert.equal(relativeOf(0, -10, 0), 6, 'left');
  // facing east (yaw −90°): east is ahead, south is to the right, north to the left
  const east = -Math.PI / 2;
  assert.equal(relativeOf(east, 10, 0), 0);
  assert.equal(relativeOf(east, 0, 10), 2);
  assert.equal(relativeOf(east, -10, 0), 4);
  assert.equal(relativeOf(east, 0, -10), 6);
  // the compass point of a thing never depends on the way you face; its arrow always does
  for (const yaw of [0, 1, 2, 3, -1, -2.5]) {
    assert.equal(pointOf(bearingOf(7, 0)), 2);
    const expected = pointOf(90 - headingOf(yaw));
    assert.equal(relativeOf(yaw, 7, 0), expected);
  }
});

const unit = (x, z, state, more = {}) => ({ x, z, type: 'sentry', dead: false, rollId: 0, brain: { state }, ...more });

test('contacts: the machines that are after you, nearest first — never the ones still on their rounds', () => {
  const player = { x: 50, z: 50, yaw: 0 };
  const units = [
    unit(50, 20, AI.PATROL),
    unit(80, 50, AI.COMBAT),
    unit(50, 60, AI.SEARCH),
    unit(45, 50, AI.INVESTIGATE, { dead: true }),
    unit(50, 44, AI.SUSPICIOUS),
    unit(20, 50, AI.INVESTIGATE, { type: 'drone' }),
  ];
  const found = contacts(units, player);
  assert.deepEqual(
    found.map((c) => [c.unit.type, Math.round(c.d), POINTS[c.point], c.relative, c.hot]),
    [
      ['sentry', 6, 'N', 0, false],
      ['sentry', 10, 'S', 4, false],
      ['sentry', 30, 'E', 2, true],
      ['drone', 30, 'W', 6, false],
    ],
  );
  assert.equal(contacts(units, player, 2).length, 2, 'no more than asked for');
  assert.equal(contacts(units, player, 2).total, 4, 'but the count of all of them is kept');
  assert.deepEqual(contacts([], player), Object.assign([], { total: 0 }));
});

test('contacts: a pursuer counts from the moment it is sent, whatever it is thinking', () => {
  const player = { x: 0, z: 0, yaw: 0 };
  const found = contacts([unit(0, -40, AI.PATROL, { type: 'drone', rollId: -1 })], player);
  assert.equal(found.length, 1);
  assert.equal(POINT_WORDS[found[0].point], 'north');
});

test('contacts: turning round changes the arrows and nothing else', () => {
  const units = [unit(10, 0, AI.COMBAT)];
  const a = contacts(units, { x: 0, z: 0, yaw: 0 })[0];
  const b = contacts(units, { x: 0, z: 0, yaw: Math.PI })[0];
  assert.deepEqual([a.point, a.relative, a.d], [2, 2, 10]);
  assert.deepEqual([b.point, b.relative, b.d], [2, 6, 10]);
});

test('contacts: without the radar, a machine hunting you that you have never seen is not named', () => {
  const player = { x: 0, z: 0, yaw: 0 };
  const units = [
    unit(0, -10, AI.SEARCH, { shown: false }),
    unit(20, 0, AI.COMBAT, { shown: true }),
    unit(0, 30, AI.SEARCH, { shown: true }),
    unit(-40, 0, AI.PATROL, { shown: true }),
  ];
  const known = contacts(units, player, Infinity, (u) => u.shown);
  assert.deepEqual(
    known.map((c) => POINTS[c.point]),
    ['E', 'S'],
  );
  assert.equal(known.total, 2);
  assert.equal(contacts(units, player).total, 3, 'with the radar, all three that are after you');
});

test('distances are spoken in fives, and never as nothing', () => {
  assert.deepEqual(
    [0.4, 2.4, 7.4, 7.6, 18, 22.4, 22.6, 61].map((d) => metres(d)),
    [5, 5, 5, 10, 20, 20, 25, 60],
  );
});
