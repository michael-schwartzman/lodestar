// Contract lock: what the grid says about sight, bullets and routes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Grid, KIND } from '../../src/world/grid.js';
import { moveBody, pushOut } from '../../src/world/collide.js';

/** A 20 × 20 open field with a wall round the edge. */
function field() {
  const g = new Grid(20, 20);
  for (let i = 0; i < 20; i++) {
    g.kind[g.index(i, 0)] = KIND.WALL;
    g.kind[g.index(i, 19)] = KIND.WALL;
    g.kind[g.index(0, i)] = KIND.WALL;
    g.kind[g.index(19, i)] = KIND.WALL;
  }
  return g;
}
const wallRow = (g, z, x0 = 1, x1 = 18) => {
  for (let x = x0; x <= x1; x++) g.kind[g.index(x, z)] = KIND.WALL;
};

test('a wall stops sight; open ground does not', () => {
  const g = field();
  assert.equal(g.sight(5.5, 1.6, 5.5, 5.5, 1.6, 15.5), true);
  wallRow(g, 10);
  assert.equal(g.sight(5.5, 1.6, 5.5, 5.5, 1.6, 15.5), false);
});

test('a fence stops bodies but never sight or bullets', () => {
  const g = field();
  for (let x = 1; x <= 18; x++) g.kind[g.index(x, 10)] = KIND.FENCE;
  assert.equal(g.blocked(5, 10), true);
  assert.equal(g.sight(5.5, 1.6, 5.5, 5.5, 1.6, 15.5), true);
  const hit = {};
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, 0, 1, 8, hit), false);
});

test('low cover hides what is below its top and nothing above it', () => {
  const g = field();
  g.block[g.index(5, 10)] = 1.1;
  assert.equal(g.sight(5.5, 1.7, 8.5, 5.5, 1.6, 12.5), true, 'standing: eyes above the crate');
  assert.equal(g.sight(5.5, 1.7, 8.5, 5.5, 0.9, 11.5), false, 'crouched right behind it');
});

test('a thin prop stops a body but not sight', () => {
  const g = field();
  const i = g.index(5, 10);
  g.block[i] = 6;
  g.thin[i] = 1;
  assert.equal(g.blocked(5, 10), true);
  assert.equal(g.sight(5.5, 1.6, 5.5, 5.5, 1.6, 15.5), true);
});

test('a shut door stops sight and bodies; an open one stops neither; a plan goes through it either way', () => {
  const g = field();
  wallRow(g, 10);
  const door = g.addDoor(5, 10, 6, 10);
  assert.equal(door.along, 'x');
  assert.equal(g.sight(5.5, 1.6, 5.5, 5.5, 1.6, 15.5), false);
  assert.equal(g.blocked(5, 10), true);
  assert.equal(g.walkable(5, 10), true, 'planning treats a door as open ground');
  const route = g.path(5, 5, 5, 15);
  assert.ok(route, 'a route is not refused because the door happens to be shut');
  assert.ok(
    route.some((v, k) => k % 2 === 1 && v === 10.5),
    'and it goes through the doorway',
  );

  door.open = 1;
  assert.equal(g.sight(5.5, 1.6, 5.5, 5.5, 1.6, 15.5), true);
  assert.equal(g.blocked(5, 10), false);
});

test('a route never cuts a corner and never enters a wall', () => {
  const g = field();
  wallRow(g, 10, 1, 12);
  const route = g.path(3, 5, 3, 15);
  assert.ok(route);
  let px = 3.5;
  let pz = 5.5;
  for (let k = 0; k < route.length; k += 2) {
    const x = route[k];
    const z = route[k + 1];
    assert.equal(g.walkable(Math.floor(x), Math.floor(z)), true);
    if (x !== px && z !== pz) {
      assert.equal(g.walkable(Math.floor(x), Math.floor(pz)), true, 'diagonal step squeezes past a corner');
      assert.equal(g.walkable(Math.floor(px), Math.floor(z)), true, 'diagonal step squeezes past a corner');
    }
    px = x;
    pz = z;
  }
  assert.deepEqual(route.slice(-2), [3.5, 15.5]);
});

test('no way in means no route — and asking again is safe', () => {
  const g = field();
  wallRow(g, 10);
  assert.equal(g.path(5, 5, 5, 15), null);
  assert.equal(g.path(5, 5, 5, 15), null);
  assert.ok(g.path(5, 5, 8, 8));
});

test('a goal inside something solid is moved to the nearest place one can stand', () => {
  const g = field();
  g.block[g.index(10, 10)] = 2;
  const route = g.path(3, 3, 10, 10);
  assert.ok(route);
  const [x, z] = route.slice(-2);
  assert.ok(Math.hypot(x - 10.5, z - 10.5) <= 1.5);
  assert.equal(g.walkable(Math.floor(x), Math.floor(z)), true);
});

test('flying units cross fences and low cover, but not walls or tall things', () => {
  const g = field();
  for (let x = 1; x <= 18; x++) g.kind[g.index(x, 10)] = KIND.FENCE;
  assert.equal(g.path(5, 5, 5, 15), null);
  assert.ok(g.path(5, 5, 5, 15, true));
  g.block[g.index(5, 12)] = 1.0;
  assert.equal(g.walkable(5, 12, true), true);
  g.block[g.index(5, 12)] = 2.6;
  assert.equal(g.walkable(5, 12, true), false);
  wallRow(g, 14);
  assert.equal(g.path(5, 5, 5, 16, true), null);
});

test('a bullet stops at a wall, at the right distance, with the wall facing back at it', () => {
  const g = field();
  wallRow(g, 10);
  const hit = {};
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, 0, 1, 50, hit), true);
  assert.equal(hit.what, 'wall');
  assert.ok(Math.abs(hit.t - 4.5) < 1e-6);
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [0, 0, -1]);
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, 0, 1, 3, hit), false, 'out of range');
});

test('a bullet fired down hits the floor; fired up indoors hits the ceiling; outdoors it flies off', () => {
  const g = field();
  const hit = {};
  const d = Math.SQRT1_2;
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, -d, d, 50, hit), true);
  assert.equal(hit.what, 'floor');
  assert.ok(Math.abs(hit.y) < 1e-6);
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, d, d, 50, hit), true, 'the far wall, in the end');
  assert.equal(hit.what, 'wall');
  for (let z = 1; z < 19; z++) for (let x = 1; x < 19; x++) g.ceil[g.index(x, z)] = 4;
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, d, d, 50, hit), true);
  assert.equal(hit.what, 'ceiling');
  assert.ok(Math.abs(hit.y - 4) < 1e-6);
});

test('a bullet hits the side of a crate below its top, its lid from above, and passes over it otherwise', () => {
  const g = field();
  g.block[g.index(5, 10)] = 1.0;
  const hit = {};
  assert.equal(g.raycast(5.5, 0.6, 5.5, 0, 0, 1, 50, hit), true);
  assert.equal(hit.what, 'prop');
  assert.ok(Math.abs(hit.t - 4.5) < 1e-6);
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, 0, 1, 12, hit), false, 'over the top');
  const len = Math.hypot(5, 1);
  assert.equal(g.raycast(5.5, 2, 5.5, 0, -1 / len, 5 / len, 50, hit), true);
  assert.equal(hit.what, 'prop');
  assert.equal(hit.ny, 1, 'landed on the lid');
});

test('a round that comes to a low place above its ceiling stops on the face over the opening — not in the air before it, and not inside', () => {
  // Found 16 November 2026, looking for which lamps a round can reach (the owner: "i want to have the ability to
  // shoot at the light"): the lamp over the mouth of the road tunnel could not be hit from the forecourt. A
  // round fired up at it was said to have met the tunnel's ceiling — a metre out in the open air, where the
  // round had passed the HEIGHT of that ceiling on its way to the rock above the mouth. The same over every
  // doorway looked at from a higher place: a mark in the air in front of the lintel.
  const g = field();
  // the south half is a low place: a ceiling at 2.6 from row 10 on; the north half is open to the sky
  for (let z = 10; z < 19; z++) for (let x = 1; x < 19; x++) g.ceil[g.index(x, z)] = 2.6;
  const hit = {};
  // fired from the open, upwards, at a point over the opening: it is at 4.6 m when it reaches the low place
  const rise = 3 / 4.5;
  const len = Math.hypot(1, rise);
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, rise / len, 1 / len, 50, hit), true);
  assert.equal(hit.what, 'wall', 'what is built over an opening is a wall');
  assert.ok(Math.abs(hit.z - 10) < 1e-6, `it stopped at z = ${hit.z}: the face of the low place is at 10`);
  assert.ok(Math.abs(hit.y - 4.6) < 1e-6, `…at a height of ${hit.y}`);
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [0, 0, -1], 'the face looks back at where the round came from');
  // level, above the ceiling: the same face — it does not fly on through what is over the opening
  assert.equal(g.raycast(5.5, 3.2, 5.5, 0, 0, 1, 50, hit), true);
  assert.equal(hit.what, 'wall');
  assert.ok(Math.abs(hit.z - 10) < 1e-6 && Math.abs(hit.y - 3.2) < 1e-6);
  // coming down from high up, still above the ceiling where it gets there: the same
  const fall = -0.5 / 4.5;
  const flen = Math.hypot(1, fall);
  assert.equal(g.raycast(5.5, 3.6, 5.5, 0, fall / flen, 1 / flen, 50, hit), true);
  assert.equal(hit.what, 'wall');
  assert.ok(Math.abs(hit.z - 10) < 1e-6 && Math.abs(hit.y - 3.1) < 1e-6);
  // a round that comes in UNDER the ceiling goes in, and meets the ceiling inside if it is rising
  const low = 0.5 / 4.5;
  const llen = Math.hypot(1, low);
  assert.equal(g.raycast(5.5, 1.6, 5.5, 0, low / llen, 1 / llen, 50, hit), true);
  assert.equal(hit.what, 'ceiling');
  assert.ok(hit.z > 10 && Math.abs(hit.y - 2.6) < 1e-6);
  // and one fired from inside the low place meets its ceiling where it always did
  const d = Math.SQRT1_2;
  assert.equal(g.raycast(5.5, 1.6, 12.5, 0, d, d, 50, hit), true);
  assert.equal(hit.what, 'ceiling');
  assert.ok(Math.abs(hit.t - 1 / d) < 1e-6);
  // out of range, the face over the opening stops nothing
  assert.equal(g.raycast(5.5, 3.2, 5.5, 0, 0, 1, 4, hit), false);
});

// ---------- the true shape of things ----------
// Decision of 12 November 2026 — the owner: "there's a bug where i fire at transparent objects but they get
// bullet marks". A thing that stands in a cell is smaller than the cell: a round used to stop on the cell's
// box, in the air beside the thing, and leave its mark there. Whoever knows the thing's shape (world/build.js)
// can tell the grid; then a round stops on the shape, or flies on.

/** A ball of radius 0.25 in the middle of cell (5, 10), and the same ball said to fill cell (5, 11) as well. */
function withBall(g, cells = [[5, 10]]) {
  for (const [x, z] of cells) g.block[g.index(x, z)] = 1.0;
  const asked = { at: 0, ray: 0 };
  g.shapes = {
    at(i) {
      asked.at++;
      assert.ok(g.kind[i] !== KIND.WALL && g.kind[i] !== KIND.DOOR, 'a wall has no other shape than its own');
      return cells.some(([x, z]) => g.index(x, z) === i) ? 7 : -1;
    },
    ray(id, ox, oy, oz, dx, dy, dz, out) {
      asked.ray++;
      assert.equal(id, 7);
      // where a ray meets a ball: the nearer root of a quadratic
      const cx = ox - 5.5;
      const cy = oy - 0.6;
      const cz = oz - 10.5;
      const b = cx * dx + cy * dy + cz * dz;
      const disc = b * b - (cx * cx + cy * cy + cz * cz - 0.25 * 0.25);
      if (disc < 0) return false;
      const t = -b - Math.sqrt(disc);
      if (t <= 0) return false;
      out.t = t;
      out.nx = (cx + dx * t) / 0.25;
      out.ny = (cy + dy * t) / 0.25;
      out.nz = (cz + dz * t) / 0.25;
      return true;
    },
  };
  return asked;
}

test('a round stops on the shape of a thing, not on the box it stands in', () => {
  const g = field();
  withBall(g);
  const hit = {};
  assert.equal(g.raycast(5.5, 0.6, 5.5, 0, 0, 1, 50, hit), true);
  assert.equal(hit.what, 'prop');
  assert.ok(Math.abs(hit.t - 4.75) < 1e-6, `it stopped ${hit.t} m out: the box's face is at 4.5, the ball at 4.75`);
  assert.ok(Math.abs(hit.z - 10.25) < 1e-6 && Math.abs(hit.nz + 1) < 1e-6, 'on the ball, which faces back at it');
});

test('a round that passes beside the thing, inside its cell, flies on to whatever is behind', () => {
  const g = field();
  withBall(g);
  const hit = {};
  // 0.4 m to one side of the ball's middle: inside the cell, well clear of the ball
  assert.equal(g.raycast(5.9, 0.6, 5.5, 0, 0, 1, 50, hit), true);
  assert.equal(hit.what, 'wall', 'it left its mark in the air beside the ball');
  assert.ok(Math.abs(hit.t - 13.5) < 1e-6);
  // and without the shape it is the box that stops it, as it always was
  g.shapes = null;
  assert.equal(g.raycast(5.9, 0.6, 5.5, 0, 0, 1, 50, hit), true);
  assert.equal(hit.what, 'prop');
  assert.ok(Math.abs(hit.t - 4.5) < 1e-6);
});

test('a thing that fills several cells is asked about once a round, not once a cell', () => {
  const g = field();
  const asked = withBall(g, [
    [5, 10],
    [5, 11],
    [5, 12],
  ]);
  const hit = {};
  assert.equal(g.raycast(5.9, 0.6, 5.5, 0, 0, 1, 50, hit), true);
  assert.equal(hit.what, 'wall');
  assert.equal(asked.ray, 1);
});

test('standing on a thing and firing down, the round lands on it — not on the floor underneath', () => {
  const g = field();
  withBall(g);
  const hit = {};
  assert.equal(g.raycast(5.5, 1.9, 10.5, 0, -1, 0, 50, hit), true);
  assert.equal(hit.what, 'prop');
  assert.ok(Math.abs(hit.y - 0.85) < 1e-6 && Math.abs(hit.ny - 1) < 1e-6, `it landed at ${hit.y}`);
});

test('a shape out of range stops nothing, and what is nearer than the shape still does', () => {
  const g = field();
  withBall(g);
  const hit = {};
  assert.equal(g.raycast(5.5, 0.6, 5.5, 0, 0, 1, 4.7, hit), false, 'the ball is 4.75 m out');
  // fired down at the ground in front of the ball: the floor is nearer
  const len = Math.hypot(1, 4);
  assert.equal(g.raycast(5.5, 0.6, 5.5, 0, -1 / len, 4 / len, 50, hit), true);
  assert.equal(hit.what, 'floor');
});

test('a shape may say what it is, and the next shape does not inherit the word', () => {
  const g = field();
  // two things in a row: a heap of wreckage at z = 10, a plain thing at z = 14
  g.block[g.index(5, 10)] = 0.7;
  g.block[g.index(5, 14)] = 1.0;
  g.shapes = {
    at: (i) => (i === g.index(5, 10) ? 1 : i === g.index(5, 14) ? 2 : -1),
    ray(id, ox, oy, oz, dx, dy, dz, out) {
      const face = id === 1 ? 10 : 14;
      const top = id === 1 ? 0.7 : 1.0;
      const t = (face - oz) / dz;
      if (!(t > 0) || oy + dy * t > top) return false;
      Object.assign(out, { t, nx: 0, ny: 0, nz: -1 });
      // only the wreckage has a word of its own
      if (id === 1) out.what = 'wreck';
      return true;
    },
  };
  const hit = {};
  assert.equal(g.raycast(5.5, 0.4, 5.5, 0, 0, 1, 50, hit), true);
  assert.deepEqual([hit.what, hit.t], ['wreck', 4.5]);
  // over the heap and into the thing behind it: that one is a prop, whatever was said about the heap
  assert.equal(g.raycast(5.5, 0.9, 5.5, 0, 0, 1, 50, hit), true);
  assert.deepEqual([hit.what, hit.t], ['prop', 8.5]);
});

test('a body is pushed out of a wall and slides along it', () => {
  const g = field();
  const pos = { x: 5, z: 1.1 };
  pushOut(g, pos, 0.35);
  assert.ok(pos.z >= 1.35 - 1e-9);
  const slider = { x: 5, z: 1.4 };
  moveBody(g, slider, 2, -2, 0.35);
  assert.ok(slider.z >= 1.35 - 1e-9, 'did not enter the wall');
  assert.ok(slider.x > 6.5, 'kept the part of its move that runs along the wall');
});

test('a fast body does not tunnel through a wall one cell thick', () => {
  const g = field();
  wallRow(g, 10);
  const pos = { x: 5.5, z: 9 };
  moveBody(g, pos, 0, 6, 0.35);
  assert.ok(pos.z < 10);
});

test('a body waits at a shut door and walks through an open one', () => {
  const g = field();
  wallRow(g, 10);
  const door = g.addDoor(5, 10, 6, 10);
  const pos = { x: 6, z: 9 };
  moveBody(g, pos, 0, 3, 0.35);
  assert.ok(pos.z < 10);
  door.open = 1;
  moveBody(g, pos, 0, 3, 0.35);
  assert.ok(pos.z > 11);
});

test('a body that somehow starts inside a cell is put back on open ground', () => {
  const g = field();
  g.block[g.index(8, 8)] = 2;
  const pos = { x: 8.5, z: 8.4 };
  pushOut(g, pos, 0.35);
  assert.equal(g.blocked(Math.floor(pos.x), Math.floor(pos.z)), false);
});
