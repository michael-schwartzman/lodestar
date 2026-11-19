// What is painted, spilt and worn on the site, and the dark under things (src/look/marks.js): the second look's
// marks, worked out from the site alone. No three.js and no browser in here; what is drawn of them is held in
// test/second/look.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, SHEET, cellUV, layMarks, MARK_LIMIT, NO_CONTACT } from '../../src/look/marks.js';
import { KIND } from '../../src/world/grid.js';
import { buildSite, FLOOR } from '../../src/world/map.js';
import { PROPS } from '../../src/world/props.js';

const site = buildSite();
const grid = site.grid;
const marks = layMarks(site);
const floor = marks.filter((m) => m.on === 'floor');
const walls = marks.filter((m) => m.on === 'wall');
const cornersOf = (m) => [0, 1, 2, 3].map((k) => [m.P[k * 2], m.P[k * 2 + 1]]);
const open = (x, z) => {
  if (!grid.inside(Math.floor(x), Math.floor(z))) return false;
  const kind = grid.kind[grid.index(Math.floor(x), Math.floor(z))];
  return kind === KIND.GROUND || kind === KIND.FLOOR || kind === KIND.DOOR;
};

test('the sheet: thirty-two squares, every one named once, and each name has its place in the picture', () => {
  assert.equal(CELLS.length, SHEET.cols * SHEET.rows);
  assert.equal(new Set(CELLS).size, CELLS.length);
  for (const name of CELLS) {
    const [u0, v0, u1, v1] = cellUV(name);
    assert.ok(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1 && u1 > u0 && v1 > v0, `${name}: ${[u0, v0, u1, v1]}`);
    // …and a little inside its square, so that a neighbour does not show along its edge
    assert.ok(u1 - u0 < 1 / SHEET.cols && v1 - v0 < 1 / SHEET.rows, `${name} fills its square to the edge`);
  }
  assert.throws(() => cellUV('no such mark'), /no such mark/);
  // a part of a square: the left half of it is the left half of the picture's square
  const whole = cellUV('hazard');
  const half = cellUV('hazard', [0, 0, 0.5, 1]);
  assert.ok(Math.abs(half[0] - whole[0]) < 1e-9 && half[2] < whole[2] && half[2] > whole[0]);
});

test('every mark is one of the kinds there are, on a square of the sheet, with four corners and their places in it', () => {
  const KINDS = new Set([
    'contact',
    'threshold',
    'line',
    'number',
    'dash',
    'oil',
    'damp',
    'crack',
    'patch',
    'scuff',
    'tyre',
    'drip',
    'face',
  ]);
  assert.ok(marks.length > 600, `only ${marks.length} marks on the whole site`);
  assert.ok(marks.length <= MARK_LIMIT, `${marks.length} marks: each is two triangles, and a phone draws them too`);
  for (const m of marks) {
    assert.ok(KINDS.has(m.kind), `a mark of kind ${m.kind}`);
    assert.ok(CELLS.includes(m.cell), `${m.kind}: no square called ${m.cell}`);
    assert.equal(m.uv.length, 8);
    for (const v of m.uv) assert.ok(v >= 0 && v <= 1, `${m.kind}: ${m.uv}`);
    if (m.on === 'floor') {
      assert.equal(m.P.length, 8);
      for (const v of m.P) assert.ok(Number.isFinite(v));
      // no piece so long that the light on it, known only at its corners, is a guess in between
      const c = cornersOf(m);
      for (let k = 0; k < 4; k++) {
        const [ax, az] = c[k];
        const [bx, bz] = c[(k + 1) % 4];
        assert.ok(Math.hypot(bx - ax, bz - az) <= 1.6, `${m.kind}: a side ${Math.hypot(bx - ax, bz - az)} m long`);
      }
    } else {
      assert.equal(m.on, 'wall');
      assert.ok(['n', 's', 'w', 'e'].includes(m.side));
    }
  }
});

test('the same site gives the same marks, every time', () => {
  assert.deepEqual(layMarks(buildSite()), marks);
});

test('everything that stands on the ground has the dark under it, once; what hangs, or stands on something, has none', () => {
  const contact = marks.filter((m) => m.kind === 'contact' && m.of !== undefined);
  for (const [i, p] of site.props.entries()) {
    const mine = contact.filter((m) => m.of === i);
    const stands = PROPS[p.kind].block > 0 && p.y < 0.05 && !NO_CONTACT.has(p.kind);
    if (!stands) {
      assert.equal(mine.length, 0, `${p.kind} at (${p.x}, ${p.z}) has a shadow under it`);
      continue;
    }
    assert.ok(mine.length >= 1, `nothing under the ${p.kind} at (${p.x}, ${p.z})`);
    // the dark reaches all round it: past its middle on every side, and it is under its middle
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const m of mine)
      for (const [x, z] of cornersOf(m)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
    assert.ok(x0 < p.x - 0.2 && x1 > p.x + 0.2 && z0 < p.z - 0.2 && z1 > p.z + 0.2, `${p.kind}: ${[x0, z0, x1, z1]}`);
    // …and no further than the thing and a soft edge: half a metre past its box at the most
    const half = Math.max(PROPS[p.kind].w, PROPS[p.kind].d) / 2 + 0.5;
    assert.ok(x0 >= p.x - half && x1 <= p.x + half && z0 >= p.z - half && z1 <= p.z + half, `${p.kind} is too wide`);
  }
  // the cascade stands on the hall's floor too: the dark under every one of its casings
  const rows = marks.filter((m) => m.kind === 'contact' && m.of === undefined);
  for (const [x, z] of site.centrifuges) {
    const under = rows.some((m) => {
      const c = cornersOf(m);
      const xs = c.map((q) => q[0]);
      const zs = c.map((q) => q[1]);
      return x >= Math.min(...xs) && x <= Math.max(...xs) && z >= Math.min(...zs) && z <= Math.max(...zs);
    });
    assert.ok(under, `nothing under the casing at (${x}, ${z})`);
  }
});

test('a doorway has its hazard band across it on every side where the floor was made — not on dirt — and nowhere else', () => {
  const madeAt = (x, z) => open(x + 0.5, z + 0.5) && grid.floor[grid.index(x, z)] !== FLOOR.DIRT;
  let banded = 0;
  for (const door of grid.doors) {
    const bands = marks.filter((m) => m.kind === 'threshold' && m.door === door.id);
    // the cells in front of the door, on each of its two sides
    const fronts =
      door.along === 'x'
        ? { n: [door.x0, door.z0 - 1], s: [door.x0, door.z1 + 1] }
        : { w: [door.x0 - 1, door.z0], e: [door.x1 + 1, door.z0] };
    for (const [face, [x, z]] of Object.entries(fronts)) {
      const mine = bands.filter((m) => m.face === face);
      if (madeAt(x, z))
        assert.ok(mine.length >= 1, `door ${door.id} at (${door.x}, ${door.z}): no band on its ${face} side`);
      else assert.equal(mine.length, 0, `door ${door.id}: a band painted on dirt on its ${face} side`);
      banded += mine.length ? 1 : 0;
    }
    assert.ok(bands.length >= 1, `door ${door.id} at (${door.x}, ${door.z}) has no band at all`);
    for (const m of bands) {
      assert.equal(m.cell, 'hazard');
      for (const [x, z] of cornersOf(m)) {
        assert.ok(open(x, z), `door ${door.id}: its band is in a wall at (${x}, ${z})`);
        // within half a metre of the door's own cells
        const dx = Math.max(door.x0 - x, 0, x - (door.x1 + 1));
        const dz = Math.max(door.z0 - z, 0, z - (door.z1 + 1));
        assert.ok(Math.hypot(dx, dz) <= 0.5 + 1e-9, `door ${door.id}: a band ${Math.hypot(dx, dz)} m from it`);
      }
    }
  }
  assert.ok(banded >= grid.doors.length * 1.5, `only ${banded} sides of ${grid.doors.length} doors have a band`);
});

test('paint is on made floors only: none on dirt, none in a wall — and a cascade has its lines and its number', () => {
  const PAINT = new Set(['threshold', 'line', 'number', 'dash']);
  const painted = floor.filter((m) => PAINT.has(m.kind));
  assert.ok(painted.length > 150, `${painted.length} squares of paint`);
  for (const m of painted)
    for (const [x, z] of cornersOf(m)) {
      assert.ok(open(x, z), `${m.kind}: painted in a wall at (${x}, ${z})`);
      const made = grid.floor[grid.index(Math.floor(x), Math.floor(z))] !== FLOOR.DIRT;
      assert.ok(made, `${m.kind}: painted on dirt at (${x}, ${z})`);
    }
  // four cascades: each has a line down both of its sides, and its number at the end
  const numbers = marks.filter((m) => m.kind === 'number' && m.row !== undefined);
  assert.deepEqual([...new Set(numbers.map((m) => m.row))].sort(), [0, 1, 2, 3]);
  assert.deepEqual([...new Set(numbers.map((m) => m.cell))].sort(), ['n1', 'n2', 'n3', 'n4']);
  for (let row = 0; row < 4; row++) {
    const lines = marks.filter((m) => m.kind === 'line' && m.row === row);
    const zs = lines.flatMap((m) => cornersOf(m).map((c) => c[1]));
    assert.ok(Math.max(...zs) - Math.min(...zs) >= 2.5, `cascade ${row + 1}: its lines are not on both sides of it`);
    const xs = lines.flatMap((m) => cornersOf(m).map((c) => c[0]));
    assert.ok(
      Math.max(...xs) - Math.min(...xs) >= 30,
      `cascade ${row + 1}: its lines are ${Math.max(...xs) - Math.min(...xs)} m long`,
    );
  }
});

test('what is on a wall is on a wall: seen from an open cell, with wall behind it, at a height to be read, clear of the words', () => {
  assert.ok(walls.length >= 20, `${walls.length} marks on walls`);
  const DIR = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
  const faces = walls.filter((m) => m.kind === 'face');
  assert.ok(faces.length >= 12, `${faces.length} faces on the walls`);
  for (const m of walls) {
    assert.ok(open(m.x + 0.5, m.z + 0.5), `${m.kind}: its cell (${m.x}, ${m.z}) is not open`);
    const [dx, dz] = DIR[m.side];
    const behind = grid.kind[grid.index(m.x + dx, m.z + dz)];
    assert.equal(behind, KIND.WALL, `${m.kind} at (${m.x}, ${m.z}) ${m.side}: what is behind it is ${behind}`);
    assert.ok(m.along >= 0 && m.along <= 1 && m.w > 0 && m.h > 0 && m.y >= 0);
  }
  for (const m of faces) {
    assert.ok(m.y >= 1.2 && m.y + m.h <= 2.2, `a face from ${m.y} to ${m.y + m.h}`);
    // not across what is already written on that wall
    for (const s of site.signs)
      if (s.x === m.x && s.z === m.z && s.side === m.side)
        assert.ok(s.y >= m.y + m.h || s.y + s.height <= m.y, `a face over "${s.text}"`);
  }
  // the faces say what is behind the door they are beside: the hall's doors have the trefoil, the switchgear's the bolt
  const cells = new Set(faces.map((m) => m.cell));
  for (const name of ['trefoil', 'voltage', 'noEntry', 'ears', 'fire', 'exit'])
    assert.ok(cells.has(name), `no ${name}`);
});
