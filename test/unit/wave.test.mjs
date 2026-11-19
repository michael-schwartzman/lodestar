// Contract lock: what a charge brings. Decision of 16 November 2026 — the owner: "every time you rig a
// centrifuge fire an alarm with new guards and drones that are coming to you". Setting a charge trips the site's
// alarm (the site's own: it is not counted against the grade, as the blast's and the lodestar's are not) and
// brings a WAVE: machines that are not on the mission's roll, guards on foot from the doors of the building and
// drones from the bay, sent to the charge. How many is the setting's (src/difficulty.js `wave`); where the guards
// walk in from is chosen so that nobody sees them appear (src/enemies/wave.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIFFICULTY } from '../../src/difficulty.js';
import { waveEntries, waveBays, WAVE } from '../../src/enemies/wave.js';
import { buildSite } from '../../src/world/map.js';

const site = buildSite();

test('how many come: a guard on Recruit; a guard and a drone on Operator; two guards and a drone on Ghost', () => {
  assert.deepEqual(DIFFICULTY.recruit.wave, { guards: 1, drones: 0 });
  assert.deepEqual(DIFFICULTY.operator.wave, { guards: 1, drones: 1 });
  assert.deepEqual(DIFFICULTY.ghost.wave, { guards: 2, drones: 1 });
});

test('the doors a wave walks in by: six of them, each open floor, each a walk from every charge — and none in the hall', () => {
  assert.equal(site.entries.length, 6);
  const g = site.grid;
  // everything a machine on foot can reach from the first charge (doors open for machines)
  const reach = new Set();
  const start = site.charges[0].stand;
  const queue = [start];
  reach.add(g.index(start[0], start[1]));
  const walkable = (x, z) => g.inside(x, z) && (!g.blocked(x, z) || g.doorAt[g.index(x, z)] >= 0);
  while (queue.length) {
    const [x, z] = queue.pop();
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (!walkable(nx, nz) || reach.has(g.index(nx, nz))) continue;
      reach.add(g.index(nx, nz));
      queue.push([nx, nz]);
    }
  }
  for (const c of site.charges) assert.ok(reach.has(g.index(c.stand[0], c.stand[1])), `${c.name} cannot be walked to`);
  for (const [x, z] of site.entries) {
    assert.ok(!g.blocked(x, z), `the entry at ${x}, ${z} is not open floor`);
    assert.ok(reach.has(g.index(x, z)), `the entry at ${x}, ${z} cannot be walked from to a charge`);
    // not among the cascades: a machine does not appear in the room the player is working in
    for (const c of site.charges)
      assert.ok(Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) > WAVE.far, `the entry at ${x}, ${z} is by ${c.name}`);
  }
  assert.equal(new Set(site.entries.map(([x, z]) => `${x},${z}`)).size, 6, 'an entry is listed twice');
});

const DOORS = [
  [0, 0],
  [20, 0],
  [40, 0],
  [60, 0],
];
const nobody = () => false;

test('a wave comes in where it is not seen, and from near: the nearest doors out of sight that are far enough off', () => {
  // standing at 30, 0: the doors at 20 and 40 are 10 m off — too near; 0 and 60 are 30 m off
  assert.deepEqual(waveEntries(DOORS, { x: 30, z: 0 }, 1, nobody), [[0, 0]]);
  assert.deepEqual(waveEntries(DOORS, { x: 30, z: 0 }, 2, nobody), [
    [0, 0],
    [60, 0],
  ]);
  // nearer the left end: the nearest far-enough door is the one at 20
  assert.deepEqual(waveEntries(DOORS, { x: 2, z: 0 }, 1, nobody), [[20, 0]]);
  // a door that can be seen is passed over for one that cannot, though it is further
  const seen = (x) => x === 20;
  assert.deepEqual(waveEntries(DOORS, { x: 2, z: 0 }, 1, seen), [[40, 0]]);
  assert.deepEqual(waveEntries(DOORS, { x: 2, z: 0 }, 2, seen), [
    [40, 0],
    [60, 0],
  ]);
});

test('there is always a way in: seen doors before none, near doors before none, and two machines by one door if need be', () => {
  // every door in sight: the far ones are used all the same, nearest first
  assert.deepEqual(
    waveEntries(DOORS, { x: 2, z: 0 }, 2, () => true),
    [
      [20, 0],
      [40, 0],
    ],
  );
  // every door too near (one door, and the player beside it): it is used all the same
  assert.deepEqual(waveEntries([[5, 5]], { x: 6, z: 5 }, 1, nobody), [[5, 5]]);
  // more machines than doors: they share
  const three = waveEntries(
    [
      [0, 0],
      [60, 0],
    ],
    { x: 30, z: 0 },
    3,
    nobody,
  );
  assert.equal(three.length, 3);
  for (const door of three) assert.ok(door[0] === 0 || door[0] === 60);
  // nobody asked for, or no door at all: nobody comes, and nothing throws
  assert.deepEqual(waveEntries(DOORS, { x: 30, z: 0 }, 0, nobody), []);
  assert.deepEqual(waveEntries([], { x: 30, z: 0 }, 2, nobody), []);
});

test('on the site itself: from each charge, on each setting, the wave has doors — out of sight of a body at the charge', () => {
  const g = site.grid;
  for (const c of site.charges) {
    const from = { x: c.stand[0] + 0.5, z: c.stand[1] + 0.5 };
    const sees = (x, z) => g.sight(from.x, 1.62, from.z, x + 0.5, 1.6, z + 0.5);
    for (const level of Object.values(DIFFICULTY)) {
      const doors = waveEntries(site.entries, from, level.wave.guards, sees);
      assert.equal(doors.length, level.wave.guards);
      for (const [x, z] of doors) {
        assert.ok(!sees(x, z), `${c.name}: the door at ${x}, ${z} is in sight of the charge`);
        assert.ok(Math.hypot(x + 0.5 - from.x, z + 0.5 - from.z) >= WAVE.far);
      }
    }
  }
});

test('the drones of a wave come up from the bay, a different part of it each time', () => {
  const bay = site.reinforcements;
  assert.ok(bay.length >= 4);
  assert.deepEqual(waveBays(bay, 0, 1), [bay[0]]);
  assert.deepEqual(waveBays(bay, 1, 1), [bay[1]]);
  assert.deepEqual(waveBays(bay, 3, 2), [bay[3], bay[4 % bay.length]]);
  assert.deepEqual(waveBays(bay, 2, 0), []);
  assert.deepEqual(waveBays([], 2, 2), []);
  // the fourth charge's drones do not come from where the first charge's did
  assert.notDeepEqual(waveBays(bay, 3, 1), waveBays(bay, 0, 1));
});
