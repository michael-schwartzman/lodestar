// Contract lock: the mountain Site Hollow Nine is cut into (src/world/mountain.js) and the site's place inside it.
// Decision of 12 November 2026 — the owner: "I want it clear that this is a hidden centrifuge site inside a
// mountain, underground, not just a hangar." Everything a player can stand on is under rock except the forecourt
// outside the portal, and the pictures of the outside are taken from where there is air to stand in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CRATER, FORECOURT, ROOF, SHAFT, STATIONS, cutDistance, mountainAt, roofAt } from '../../src/world/mountain.js';
import { buildSite, W, H, ZONE } from '../../src/world/map.js';
import { KIND } from '../../src/world/grid.js';

const site = buildSite();
const g = site.grid;
const open = (i) => g.kind[i] !== KIND.ROCK && g.kind[i] !== KIND.WALL;
const corners = (x, z) => [
  [x, z],
  [x + 1, z],
  [x, z + 1],
  [x + 1, z + 1],
];

test('the mountain and the roof are the same every time they are asked', () => {
  for (const [x, z] of [
    [20.5, 40.5],
    [64, 60],
    [107, 35],
    [-80, 10],
    [64, 180],
  ]) {
    assert.equal(mountainAt(x, z), mountainAt(x, z));
    assert.equal(roofAt(x, z), roofAt(x, z));
    assert.ok(Number.isFinite(mountainAt(x, z)) && Number.isFinite(roofAt(x, z)));
  }
});

test('the cavern roof is rock a long way overhead: never under 10.5 m, never over 15, and clear of everything that stands under it', () => {
  let low = Infinity;
  let high = -Infinity;
  let cells = 0;
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = g.index(x, z);
      // the cavern: open cells with no built ceiling that are not under the sky or the shaft
      if (!open(i) || g.ceil[i] > 0 || g.sky[i] !== 0) continue;
      cells++;
      for (const [cx, cz] of corners(x, z)) {
        const r = roofAt(cx, cz);
        low = Math.min(low, r);
        high = Math.max(high, r);
        assert.ok(r >= g.block[i] + 1.5, `the roof is ${r.toFixed(1)} m over a ${g.block[i]} m prop at ${x},${z}`);
      }
    }
  assert.ok(cells > 3500, `the cavern is only ${cells} cells`);
  assert.ok(low >= 10.5 && high <= 15, `the roof runs from ${low.toFixed(1)} to ${high.toFixed(1)} m`);
  assert.ok(high - low > 1.5, 'and it is not flat');
  // you can stand on a container (2.6 m) and jump (1.08 m): your head (1.8 m) is nowhere near it
  assert.ok(low > 2.6 + 1.08 + 1.8 + 3);
});

test('the roof is a surface: between the points of its lattice it runs straight, so that walls can meet it', () => {
  const L = ROOF.lattice;
  for (const [x, z] of [
    [40, 60],
    [86, 70],
    [20, 20],
  ]) {
    const a = roofAt(x, z);
    const b = roofAt(x + L, z);
    assert.ok(Math.abs(roofAt(x + L / 2, z) - (a + b) / 2) < 1e-9, 'half way along an edge is the mean of its ends');
  }
});

test('the mountain is over all of it: everywhere that is not open sky or the shaft, the ground above is well clear of what is below', () => {
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = g.index(x, z);
      if (!open(i) || g.sky[i] !== 0) continue;
      // the last two metres behind a cliff are the cliff face's to hide (world/build.js draws it), not the slope's
      if (cutDistance(x + 0.5, z + 0.5) < 2.5) continue;
      const under = g.ceil[i] > 0 ? g.ceil[i] : Math.max(...corners(x, z).map(([cx, cz]) => roofAt(cx, cz)));
      const over = Math.min(...corners(x, z).map(([cx, cz]) => mountainAt(cx, cz)));
      assert.ok(over - under >= 1.5, `only ${(over - under).toFixed(1)} m of rock over ${x},${z}`);
    }
  // and over the facility itself there is a mountain, not a mound
  assert.ok(mountainAt(50, 30) > 60 && mountainAt(84, 22) > 60, `${mountainAt(50, 30)} m over the cascade hall`);
});

test('what the briefing says of the rock is true: the cascade hall has at least fifty metres of it over every part', () => {
  // src/ui/menus.js: "its cascade hall under at least fifty metres of rock". The words were "one cavern under
  // eighty metres of rock" until the arithmetic was done (12 November 2026): the main cavern has a mean of
  // thirty-one metres over it, the hall between fifty-nine and eighty-five.
  let least = Infinity;
  let sum = 0;
  let cells = 0;
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = g.index(x, z);
      if (!open(i) || g.zone[i] !== ZONE.HALL) continue;
      assert.ok(g.ceil[i] > 0, `the hall has no ceiling at ${x},${z}`);
      const cover = Math.min(...corners(x, z).map(([cx, cz]) => mountainAt(cx, cz))) - g.ceil[i];
      least = Math.min(least, cover);
      sum += cover;
      cells++;
    }
  assert.ok(cells > 900, `the hall is only ${cells} cells`);
  assert.ok(least >= 50, `there are only ${least.toFixed(1)} m of rock over the thinnest part of the hall`);
  assert.ok(sum / cells >= 70, `and ${(sum / cells).toFixed(1)} m on average`);
});

test('the forecourt and the road out are open: the mountain is not above the ground anywhere over them', () => {
  let cells = 0;
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (g.sky[g.index(x, z)] !== 1) continue;
      cells++;
      for (const [cx, cz] of corners(x, z))
        assert.ok(mountainAt(cx, cz) <= 0, `the mountain stands ${mountainAt(cx, cz)} m over ${cx},${cz}`);
      assert.equal(cutDistance(x + 0.5, z + 0.5), 0);
    }
  assert.ok(cells >= 80, `only ${cells} cells under the sky`);
  // the road goes on south of the map down a valley that widens: there is somewhere for the pictures to be taken
  for (const z of [100, 130, 170, 220]) assert.equal(mountainAt(64, z), 0, `the road at z = ${z}`);
  assert.ok(mountainAt(64 + 18, 130) === 0 && mountainAt(64 + 18, 100) > 8, 'the valley widens as it goes');
  // and its walls are cliffs: a few metres back from the forecourt's edge the rock is already high
  assert.ok(mountainAt(FORECOURT.x0 - 4, 92) > 12 && mountainAt(FORECOURT.x1 + 4, 92) > 12);
  assert.ok(mountainAt(64, FORECOURT.z0 - 4) > 12, 'over the portal');
});

test('the exhaust shaft comes out on a levelled bench high on the mountain, straight above the lodestar pad', () => {
  assert.ok(
    site.beacon.x > SHAFT.x0 && site.beacon.x < SHAFT.x1 && site.beacon.z > SHAFT.z0 && site.beacon.z < SHAFT.z1,
  );
  assert.ok(
    Math.abs((SHAFT.x0 + SHAFT.x1) / 2 - site.beacon.x) < 0.01 &&
      Math.abs((SHAFT.z0 + SHAFT.z1) / 2 - site.beacon.z) < 0.01,
  );
  const rim = [];
  for (let x = SHAFT.x0; x <= SHAFT.x1; x++) rim.push(mountainAt(x, SHAFT.z0), mountainAt(x, SHAFT.z1));
  for (let z = SHAFT.z0; z <= SHAFT.z1; z++) rim.push(mountainAt(SHAFT.x0, z), mountainAt(SHAFT.x1, z));
  assert.ok(Math.max(...rim) - Math.min(...rim) < 0.01, 'the bench is level round the shaft');
  assert.ok(Math.abs(rim[0] - SHAFT.top) < 0.01, `the shaft's top is the bench: ${rim[0]} m`);
  assert.ok(SHAFT.top - roofAt(SHAFT.x0, SHAFT.z0) > 35, 'and it is a long way up from the cavern');
  // every cell of it is marked, is open ground, and nothing stands in it
  let cells = 0;
  for (let z = SHAFT.z0; z < SHAFT.z1; z++)
    for (let x = SHAFT.x0; x < SHAFT.x1; x++) {
      const i = g.index(x, z);
      assert.equal(g.sky[i], 2, `${x},${z} is not marked as the shaft`);
      assert.ok(g.walkable(x, z) && g.ceil[i] === 0, `${x},${z} is not open ground`);
      cells++;
    }
  assert.equal(cells, (SHAFT.x1 - SHAFT.x0) * (SHAFT.z1 - SHAFT.z0));
  let marked = 0;
  for (let i = 0; i < W * H; i++) if (g.sky[i] === 2) marked++;
  assert.equal(marked, cells, 'and nothing else is');
});

test('the pictures of the outside are taken from the air: the title, the ending and the debrief all stand clear of the mountain', () => {
  const clear = (name, p) => {
    const ground = mountainAt(p.x, p.z);
    assert.ok(
      p.y > ground + 1.5,
      `${name}: the camera is ${(p.y - ground).toFixed(1)} m over the ground at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`,
    );
    // and it is looking at the mountain, not out of the map
    assert.ok(Math.hypot(p.tx - p.x, p.tz - p.z) > 20, `${name}: looking at its own feet`);
  };
  for (let t = 0; t <= 900; t += 2.5) {
    clear('title', STATIONS.title(t));
    clear('debrief', STATIONS.debrief(t));
  }
  for (let k = 0; k <= 1; k += 0.05) clear('ending', STATIONS.ending(k));
  // the title looks at the portal from the road, low down; the ending sees the bench the shaft comes out on
  const title = STATIONS.title(0);
  assert.ok(
    title.z > FORECOURT.z1 + 15 && title.y < 12,
    'the title is taken from the road, from a standing height or so',
  );
  const ending = STATIONS.ending(0);
  assert.ok(ending.z > FORECOURT.z1 + 30, 'the ending is watched from down the valley');
});

test('the crater takes in the facility and the shaft, and stays clear of where the ending is watched from', () => {
  const inside = (x, z) => Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.radius;
  assert.ok(inside(site.beacon.x, site.beacon.z), 'the shaft goes down with it');
  for (const c of site.charges) assert.ok(inside(c.x, c.z), `the ${c.id} charge is under it`);
  for (let k = 0; k <= 1; k += 0.1) {
    const p = STATIONS.ending(k);
    assert.ok(!inside(p.x, p.z) && Math.hypot(p.x - CRATER.x, p.z - CRATER.z) > CRATER.radius + 30);
  }
  assert.ok(
    CRATER.depth >= 15 && CRATER.depth < mountainAt(CRATER.x, CRATER.z),
    'a hollow, not a hole through the world',
  );
});

test('the site is inside the mountain: the only cells under the sky are the forecourt and the road, at the south edge', () => {
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      const i = g.index(x, z);
      if (!open(i)) {
        assert.equal(g.sky[i], 0, `solid cell ${x},${z} is marked as open to the sky`);
        continue;
      }
      if (g.sky[i] === 1) {
        assert.equal(g.zone[i], ZONE.OUTSIDE, `${x},${z} is under the sky but is not the forecourt`);
        assert.ok(z >= FORECOURT.z0 && x >= FORECOURT.x0 && x < FORECOURT.x1, `${x},${z} is under the sky`);
        assert.equal(g.ceil[i], 0);
      } else assert.notEqual(g.zone[i], ZONE.OUTSIDE, `${x},${z} is the forecourt but is under rock`);
    }
});

test('you start in the drainage adit: under rock, under a low roof, walled in by rock, and the only way on is the cut grating', () => {
  const sx = Math.floor(site.start.x);
  const sz = Math.floor(site.start.z);
  const at = g.index(sx, sz);
  assert.equal(g.zone[at], ZONE.ADIT);
  assert.equal(g.sky[at], 0);
  // every cell of the adit: low, and bounded only by rock, by more adit, by the grating, or by the way through it
  const seen = new Set([at]);
  const queue = [[sx, sz]];
  const ways = new Set();
  while (queue.length) {
    const [x, z] = queue.pop();
    const i = g.index(x, z);
    assert.ok(g.ceil[i] >= 2.3 && g.ceil[i] <= 3.4, `the adit's roof is ${g.ceil[i]} m at ${x},${z}`);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const nz = z + dz;
      const j = g.index(nx, nz);
      if (g.zone[j] === ZONE.ADIT && open(j) && g.kind[j] !== KIND.FENCE) {
        if (!seen.has(j)) {
          seen.add(j);
          queue.push([nx, nz]);
        }
      } else if (g.kind[j] === KIND.ROCK || g.kind[j] === KIND.FENCE) continue;
      else ways.add(`${nx},${nz}`);
    }
  }
  assert.ok(seen.size >= 20 && seen.size <= 80, `the adit is ${seen.size} cells`);
  assert.deepEqual([...ways].sort(), ['14,66', '14,67'], 'the two cells of the cut, and nothing else');
  assert.ok(
    g.kind[g.index(14, 65)] === KIND.FENCE && g.kind[g.index(14, 68)] === KIND.FENCE,
    'the grating stands either side of the cut',
  );
});

test('the road tunnel is the only way out: without it nothing under the sky can be reached, and with it the pickup can', () => {
  const reach = (allowTunnel) => {
    const seen = new Uint8Array(W * H);
    const queue = [Math.floor(site.start.x), Math.floor(site.start.z)];
    seen[g.index(queue[0], queue[1])] = 1;
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
        if (!g.walkable(nx, nz)) continue;
        const i = g.index(nx, nz);
        if (seen[i] || (!allowTunnel && g.zone[i] === ZONE.TUNNEL)) continue;
        seen[i] = 1;
        queue.push(nx, nz);
      }
    }
    return seen;
  };
  const without = reach(false);
  const withIt = reach(true);
  let tunnel = 0;
  for (let i = 0; i < W * H; i++) {
    if (g.sky[i] === 1) assert.equal(without[i], 0, 'the sky can be reached without going through the tunnel');
    if (g.zone[i] === ZONE.TUNNEL && open(i)) {
      tunnel++;
      assert.ok(g.ceil[i] >= 4.5 && g.ceil[i] <= 7 && g.sky[i] === 0, 'the tunnel has a roof');
    }
  }
  assert.ok(tunnel >= 40, `the tunnel is ${tunnel} cells`);
  const p = site.pickup;
  for (let z = p.z0; z < p.z1; z++)
    for (let x = p.x0; x < p.x1; x++) {
      const i = g.index(x, z);
      assert.equal(g.sky[i], 1, `pickup cell ${x},${z} is not under the sky`);
      assert.equal(withIt[i], 1, `pickup cell ${x},${z} cannot be walked to`);
    }
  assert.equal(g.sky[g.index(Math.floor(p.x), Math.floor(p.z))], 1);
});

test('the drone bay is behind the wire: the pursuers can fly out of it, and nobody can walk into it', () => {
  const onFoot = new Uint8Array(W * H);
  const queue = [Math.floor(site.start.x), Math.floor(site.start.z)];
  onFoot[g.index(queue[0], queue[1])] = 1;
  while (queue.length) {
    const z = queue.pop();
    const x = queue.pop();
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (!g.walkable(x + dx, z + dz)) continue;
      const i = g.index(x + dx, z + dz);
      if (onFoot[i]) continue;
      onFoot[i] = 1;
      queue.push(x + dx, z + dz);
    }
  }
  for (const [x, z] of site.reinforcements) {
    const i = g.index(x, z);
    assert.equal(g.zone[i], ZONE.BAY, `spawn ${x},${z} is not in the bay`);
    assert.equal(g.sky[i], 0);
    assert.equal(onFoot[i], 0, `the bay can be walked into at ${x},${z}`);
    assert.ok(g.path(x, z, 62, 60, true), `a drone cannot get from ${x},${z} into the cavern`);
  }
});
