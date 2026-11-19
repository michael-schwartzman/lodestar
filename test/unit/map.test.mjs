// Contract lock: the site can be finished. Every place the mission sends you, and every place a guard can be,
// is reachable on foot from where you start — so no machine is ever out of reach and no objective is walled off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSite, W, H, ZONE } from '../../src/world/map.js';
import { KIND } from '../../src/world/grid.js';
import { PROPS } from '../../src/world/props.js';

const site = buildSite();
const g = site.grid;

/** Every cell that can be walked to from the start. */
function reachable(flying = false) {
  const seen = new Uint8Array(W * H);
  const sx = Math.floor(site.start.x);
  const sz = Math.floor(site.start.z);
  const queue = [sx, sz];
  seen[g.index(sx, sz)] = 1;
  while (queue.length) {
    const z = queue.pop();
    const x = queue.pop();
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      if (!g.walkable(nx, nz, flying)) continue;
      const i = g.index(nx, nz);
      if (seen[i]) continue;
      seen[i] = 1;
      queue.push(nx, nz);
    }
  }
  return seen;
}
const onFoot = reachable();
const canWalkTo = (x, z) => onFoot[g.index(Math.floor(x), Math.floor(z))] === 1;

test('the map is the size the design says and is the same every time it is built', () => {
  assert.equal(g.w, 128);
  assert.equal(g.h, 96);
  const again = buildSite();
  assert.deepEqual(again.grid.kind, g.kind);
  assert.deepEqual(again.grid.block, g.block);
  assert.deepEqual(again.props, site.props);
  assert.deepEqual(again.guards, site.guards);
});

test('the start is open ground outside the grating', () => {
  assert.equal(g.walkable(Math.floor(site.start.x), Math.floor(site.start.z)), true);
  assert.ok(site.start.x < 14);
});

test('nothing walks off the edge of the map', () => {
  for (let x = 0; x < W; x++)
    for (const z of [0, H - 1]) {
      const kind = g.kind[g.index(x, z)];
      assert.ok(kind === KIND.ROCK || (x >= 60 && x <= 67), `edge cell ${x},${z} is open`);
    }
  for (let z = 0; z < H; z++)
    for (const x of [0, W - 1]) assert.equal(g.kind[g.index(x, z)], KIND.ROCK, `edge cell ${x},${z} is open`);
});

// Decision of 12 November 2026 — the owner: "i want to blow up the centrefuges". The three charges (cascade
// hall, feed room, switchgear) became four, one on each cascade of centrifuges, and they are fired from the
// control room, which looks into the hall through a window.
test('there are four charges, one on a casing of each cascade; each can be walked to and reached from where you stand', () => {
  assert.deepEqual(site.charges.map((c) => c.id).sort(), ['c1', 'c2', 'c3', 'c4']);
  const cascades = new Set();
  for (const c of site.charges) {
    assert.ok(canWalkTo(c.stand[0], c.stand[1]), `${c.id}: cannot walk to its stand cell`);
    assert.ok(Math.hypot(c.stand[0] + 0.5 - c.x, c.stand[1] + 0.5 - c.z) < 1.5, `${c.id}: stand cell too far`);
    assert.equal(Math.hypot(c.nx, c.nz), 1, `${c.id}: needs a unit facing`);
    // it is on a casing: a hand's breadth from the axis of the nearest one, on the side it faces
    const nearest = site.centrifuges.reduce(
      (best, [x, z]) => (Math.hypot(x - c.x, z - c.z) < Math.hypot(best[0] - c.x, best[1] - c.z) ? [x, z] : best),
      [Infinity, Infinity],
    );
    const off = Math.hypot(nearest[0] - c.x, nearest[1] - c.z);
    assert.ok(off > 0.08 && off < 0.25, `${c.id} hangs ${off.toFixed(2)} m from the nearest casing's axis`);
    assert.ok(
      (c.x - nearest[0]) * c.nx + (c.z - nearest[1]) * c.nz > 0.08,
      `${c.id} is not on the side of its casing that it faces`,
    );
    assert.equal(g.zone[g.index(c.stand[0], c.stand[1])], ZONE.HALL, `${c.id} is not in the cascade hall`);
    // the double rows stand five cells apart: which one this is
    cascades.add(Math.floor((Math.floor(nearest[1]) - 20) / 5));
    assert.match(c.name, /^Cascade [1-4]$/);
  }
  assert.deepEqual([...cascades].sort(), [0, 1, 2, 3], 'two charges are on the same cascade');
});

test('the cascades are fired from the control room: its window lets an eye and a round into the hall, and no body', () => {
  const f = site.firing;
  const at = g.index(Math.floor(f.x), Math.floor(f.z));
  assert.equal(g.zone[at], ZONE.CONTROL, 'the firing point is not in the control room');
  assert.ok(canWalkTo(f.x, f.z), 'the firing point cannot be walked to');
  for (const c of site.charges)
    assert.ok(
      Math.hypot(c.x - f.x, c.z - f.z) > 4,
      `the firing point is ${Math.hypot(c.x - f.x, c.z - f.z)} m from a charge`,
    );
  // the window: a low wall in the cells between the two rooms
  assert.ok(site.window.length >= 3, 'the window is less than three metres wide');
  for (const [x, z] of site.window) {
    const i = g.index(x, z);
    assert.ok(g.blocked(x, z), `a body can go through the window at ${x},${z}`);
    assert.ok(g.occluder(x, z) > 0.8 && g.occluder(x, z) < 1.3, `the sill at ${x},${z} is ${g.occluder(x, z)} m high`);
    assert.ok(g.ceil[i] > 1.9 && g.ceil[i] < 3, `the window's head at ${x},${z} is at ${g.ceil[i]} m`);
    assert.equal(g.stand[i], 0, 'the sill can be climbed onto');
  }
  // standing at the firing point, the eye is over the sill: the near aisle of the hall and the casings beyond
  const eye = 1.62;
  const [wx, wz] = site.window[Math.floor(site.window.length / 2)];
  assert.equal(g.sight(f.x, eye, f.z, wx - 1.5, eye, wz + 0.5), true, 'the hall cannot be seen from the firing point');
  const hit = {};
  assert.equal(g.raycast(f.x, eye, f.z, -1, 0, 0, 30, hit), true);
  assert.equal(hit.what, 'prop', 'a round fired west from the firing point does not reach the casings');
  assert.equal(g.zone[g.index(Math.floor(hit.x - 0.01), Math.floor(hit.z))], ZONE.HALL);
  assert.ok(g.block[g.index(Math.floor(hit.x - 0.01), Math.floor(hit.z))] > 2, 'what it struck is not a casing');
  // crouched under the sill there is no line either way
  assert.equal(g.sight(f.x, 0.7, f.z, wx - 1.5, 0.7, wz + 0.5), false, 'the sill hides nothing');
  // and the way round on foot is a real walk: the window is not a door
  const route = g.path(Math.floor(f.x), Math.floor(f.z), wx - 2, wz);
  assert.ok(
    route && route.length / 2 > 14,
    `the hall is ${route ? route.length / 2 : 'no'} steps from the firing point`,
  );
});

test('the beacon pad, the pickup and the ammunition can be walked to', () => {
  assert.ok(canWalkTo(site.beacon.x, site.beacon.z), 'beacon');
  assert.ok(canWalkTo(site.pickup.x, site.pickup.z), 'pickup');
  for (let z = site.pickup.z0; z < site.pickup.z1; z++)
    for (let x = site.pickup.x0; x < site.pickup.x1; x++)
      assert.ok(g.kind[g.index(x, z)] === KIND.ROCK || canWalkTo(x, z), `pickup cell ${x},${z}`);
  for (const [x, z] of site.ammo) assert.ok(canWalkTo(x, z), `ammo at ${x},${z}`);
  assert.ok(site.ammo.length >= 2);
});

test('every post a guard stands on or flies to can be walked to from the start', () => {
  assert.ok(site.guards.filter((u) => u.type === 'sentry').length >= 12);
  assert.ok(site.guards.filter((u) => u.type === 'drone').length >= 4);
  site.guards.forEach((unit, n) => {
    assert.ok(unit.route.length >= 1);
    for (const [x, z] of unit.route) {
      assert.ok(canWalkTo(x, z), `${unit.type} #${n}: post ${x},${z} cannot be walked to`);
      if (unit.type === 'drone') assert.ok(g.walkable(x, z, true));
    }
  });
});

test('every leg of every patrol has a route', () => {
  site.guards.forEach((unit, n) => {
    const flying = unit.type === 'drone';
    for (let k = 0; k + 1 < unit.route.length; k++) {
      const [ax, az] = unit.route[k];
      const [bx, bz] = unit.route[k + 1];
      assert.ok(g.path(ax, az, bx, bz, flying), `${unit.type} #${n}: no route ${ax},${az} → ${bx},${bz}`);
    }
  });
});

test('pursuers have somewhere to come from', () => {
  assert.ok(site.reinforcements.length >= 3);
  for (const [x, z] of site.reinforcements) assert.ok(g.walkable(x, z, true), `spawn ${x},${z}`);
});

test('no door is blocked: there is open floor on both sides of every one', () => {
  for (const door of g.doors) {
    const sides =
      door.along === 'x'
        ? [
            [door.x0, door.z0 - 1],
            [door.x0, door.z1 + 1],
            [door.x1, door.z0 - 1],
            [door.x1, door.z1 + 1],
          ]
        : [
            [door.x0 - 1, door.z0],
            [door.x1 + 1, door.z0],
            [door.x0 - 1, door.z1],
            [door.x1 + 1, door.z1],
          ];
    for (const [x, z] of sides) assert.ok(g.walkable(x, z), `door ${door.id}: ${x},${z} is not open floor`);
    assert.ok(canWalkTo(door.x0, door.z0), `door ${door.id} cannot be reached`);
  }
  assert.ok(g.doors.length >= 12);
});

test('every room of the building can be walked into', () => {
  const zones = new Set();
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = g.index(x, z);
      if (g.kind[i] !== KIND.FLOOR) continue;
      if (g.block[i] > 0) continue;
      assert.ok(onFoot[i], `floor cell ${x},${z} (zone ${g.zone[i]}) is sealed off`);
      zones.add(g.zone[i]);
    }
  assert.ok(zones.size >= 10);
});

test('every prop is a known kind, and every lamp is on the map and gives light', () => {
  for (const p of site.props) assert.ok(PROPS[p.kind], `unknown prop ${p.kind}`);
  for (const l of site.lamps) {
    assert.ok(l.x > 0 && l.x < W && l.z > 0 && l.z < H && l.y > 0);
    assert.ok(l.r + l.g + l.b > 0 && l.radius > 1);
  }
  assert.ok(site.lamps.length >= 40);
});

test('the cascade hall is full of centrifuges, each on a cell that stops you', () => {
  assert.ok(site.centrifuges.length >= 400);
  for (const [x, z] of site.centrifuges) assert.ok(g.block[g.index(Math.floor(x), Math.floor(z))] > 2);
});
