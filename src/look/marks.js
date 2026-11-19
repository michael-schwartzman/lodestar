// What is painted, spilt and worn on the site's floors and walls, and the dark under what stands on them: the
// second look's marks (docs/DESIGN.md, "The second look"). A floor that has been worked on for years is not a
// clean sheet of one material: there is a hazard band across every doorway, a line round each cascade and its
// number at the end, oil under what has an engine, damp where the rock seeps — and under everything that stands
// on it, the dark where no light gets (which is what makes a thing stand ON a floor and not hover over it).
//
// All of it is worked out here from the site alone, and is the same every time. Each mark is one square of ONE
// picture (look/marksheet.js draws it: SHEET, CELLS), laid on a floor (`P`: its four corners, x and z) or stood
// on a wall (the cell it is seen from, the side, how far along, how high). world/build.js lays them into the
// level as lit squares, in the order they are given here: stains first, paint over them, the dark over both.
// No three.js and no browser in here.
import { KIND } from '../world/grid.js';
import { FLOOR, ZONE } from '../world/map.js';
import { PROPS } from '../world/props.js';

/** the picture: eight squares by four, each `cell` pixels across */
export const SHEET = { cols: 8, rows: 4, cell: 256 };

/** what is in each square of the picture, row by row from the top */
export const CELLS = [
  // the dark under things: under a box, under a vehicle (deeper), under something round
  'blob',
  'deep',
  'disc',
  // paint
  'hazard',
  'yellow',
  'white',
  'arrow',
  // …and what use leaves
  'tyre',
  'oil',
  'damp',
  'drip',
  'scuff',
  'crack',
  'grime',
  'patch',
  'spare',
  // numbers, stencilled
  'n1',
  'n2',
  'n3',
  'n4',
  'n5',
  'n6',
  'n7',
  'n8',
  // faces: the signs beside doors
  'trefoil',
  'voltage',
  'noEntry',
  'ears',
  'fire',
  'exit',
  'plan',
  'notice',
];

/** no more squares than this on the whole site (each is two triangles, and a phone draws them too) */
export const MARK_LIMIT = 4200;

/** how far inside its square a mark keeps, as a part of the square: a neighbour must not show along its edge */
const EDGE = 2 / SHEET.cell;

/**
 * Where a square of the picture is, as [u0, v0, u1, v1] (v upward, as a texture has it). `part` is a part of the
 * square, [s0, t0, s1, t1], each from 0 to 1 — s from its left edge, t DOWN from its top, as it is drawn.
 */
export function cellUV(name, part = [0, 0, 1, 1]) {
  const i = CELLS.indexOf(name);
  if (i < 0) throw new Error(`no such mark: "${name}" (there are: ${CELLS.join(', ')})`);
  const col = i % SHEET.cols;
  const row = Math.floor(i / SHEET.cols);
  const inset = (f) => EDGE + f * (1 - 2 * EDGE);
  return [
    (col + inset(part[0])) / SHEET.cols,
    1 - (row + inset(part[3])) / SHEET.rows,
    (col + inset(part[2])) / SHEET.cols,
    1 - (row + inset(part[1])) / SHEET.rows,
  ];
}

/** these have no dark under them: they hang from a wall or a roof, or stand on a roof, or on four thin legs */
export const NO_CONTACT = new Set(['pipeRun', 'ceilingLight', 'wallLight', 'tower', 'roofUnit', 'dish']);
/** these are round where they meet the floor */
const ROUND = new Set(['barrel', 'tank', 'lampPost']);
/** …and under these there is a gap the eye can see into: darker */
const DEEP = new Set(['truck', 'forklift']);
/** what drips oil */
const OILY = { truck: [0, -1.9], forklift: [0, 0.3], generator: [-0.5, 0], transformer: [0.2, 0.3] };

/** how far the dark reaches out from under a thing, metres */
const BAND = 0.3;
/** how much of the round dark's square is its full-dark middle */
const DISC_CORE = 0.55;
/** no piece of a mark is longer than this: the floor's light is known at a piece's corners only */
const PIECE = 1.25;
const QUARTER = Math.PI / 2;
const WHOLE = [0, 0, 1, 1];

/** which signs stand beside a door, by what is behind it: the first on the right of the doorway, the second on the left */
const FACES = {
  [ZONE.HALL]: ['trefoil', 'ears'],
  [ZONE.FEED]: ['trefoil', 'noEntry'],
  [ZONE.POWER]: ['voltage', 'noEntry'],
  [ZONE.CONTROL]: ['noEntry'],
  [ZONE.ARMOURY]: ['noEntry', 'fire'],
  [ZONE.WORKSHOP]: ['ears', 'fire'],
  [ZONE.GENSHED]: ['voltage', 'ears'],
  [ZONE.DOCK]: ['fire'],
  [ZONE.LOBBY]: ['plan', 'notice'],
  [ZONE.CORRIDOR]: ['exit'],
  [ZONE.YARD]: ['exit'],
  [ZONE.STACK]: ['exit'],
  [ZONE.GATEHOUSE]: ['noEntry'],
};
const FACE = { y: 1.45, size: 0.5 };

const hash = (x, z, n) => {
  const s = Math.sin(x * 127.1 + z * 311.7 + n * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A thing's own frame — x across it, z along it — turned as world/build.js turns a prop: (lx, lz) to the site's (x, z). */
function frame(x, z, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
}

/**
 * Everything marked on the site.
 * @param {object} site what world/map.js buildSite() returns
 * @param {object} [o]
 * @param {(p: object, i: number) => number[] | null} [o.baseOf] where prop `p` meets the floor, in its own frame,
 *   as [x0, z0, x1, z1] — from its model, when there is one to measure; left out, its box a little drawn in
 * @returns {object[]} floor marks `{ kind, cell, on: 'floor', P, uv }` and wall marks
 *   `{ kind, cell, on: 'wall', x, z, side, along, y, w, h, uv }`
 */
export function layMarks(site, { baseOf = () => null } = {}) {
  const grid = site.grid;
  const { w: W, h: H } = grid;
  const kindAt = (x, z) => (x >= 0 && z >= 0 && x < W && z < H ? grid.kind[z * W + x] : KIND.ROCK);
  const openCell = (x, z) => {
    const k = kindAt(x, z);
    return k === KIND.GROUND || k === KIND.FLOOR;
  };
  const open = (x, z) => openCell(Math.floor(x), Math.floor(z));
  /** paint is put on floors that were made, not on dirt */
  const made = (x, z) => open(x, z) && grid.floor[Math.floor(z) * W + Math.floor(x)] !== FLOOR.DIRT;

  const stains = [];
  const paint = [];
  const dark = [];
  const onWalls = [];

  /**
   * A rectangle in a frame, as pieces no longer than PIECE, the part of the square spread over the whole of it.
   * `allow`: every corner of a piece must pass, or the piece is left out.
   */
  function rect(out, to, x0, z0, x1, z1, base, part = WHOLE, allow = null) {
    const nx = Math.max(1, Math.ceil((x1 - x0) / PIECE - 1e-6));
    const nz = Math.max(1, Math.ceil((z1 - z0) / PIECE - 1e-6));
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < nz; b++) {
        const f = [a / nx, b / nz, (a + 1) / nx, (b + 1) / nz];
        piece(
          out,
          to,
          x0 + (x1 - x0) * f[0],
          z0 + (z1 - z0) * f[1],
          x0 + (x1 - x0) * f[2],
          z0 + (z1 - z0) * f[3],
          base,
          [
            part[0] + (part[2] - part[0]) * f[0],
            part[1] + (part[3] - part[1]) * f[1],
            part[0] + (part[2] - part[0]) * f[2],
            part[1] + (part[3] - part[1]) * f[3],
          ],
          allow,
        );
      }
  }

  function piece(out, to, x0, z0, x1, z1, base, part, allow) {
    const P = [...to(x0, z0), ...to(x0, z1), ...to(x1, z1), ...to(x1, z0)];
    if (allow) for (let k = 0; k < 8; k += 2) if (!allow(P[k], P[k + 1])) return;
    const [u0, v0, u1, v1] = cellUV(base.cell, part);
    // t runs down the square as z runs along the frame: the top of the square (v1) is at z0
    out.push({ ...base, on: 'floor', P, uv: [u0, v1, u0, v0, u1, v0, u1, v1] });
  }

  /**
   * A band along a frame's x from x0 to x1, z0 to z1 across: the square repeated every `metres` along it, its
   * rows t0…t1 across it.
   */
  function strip(out, to, x0, x1, z0, z1, base, t0, t1, allow = null, metres = 1) {
    for (let x = x0; x < x1 - 1e-6; x += metres) {
      const end = Math.min(x1, x + metres);
      piece(out, to, x, z0, end, z1, base, [0, t0, (end - x) / metres, t1], allow);
    }
  }

  /** The dark under a rectangle: full under it, and fading out over BAND all round. */
  function under(to, x0, z0, x1, z1, base) {
    const xs = [x0 - BAND, x0, x1, x1 + BAND];
    const zs = [z0 - BAND, z0, z1, z1 + BAND];
    const q = [0, 0.25, 0.75, 1];
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        rect(dark, to, xs[a], zs[b], xs[a + 1], zs[b + 1], base, [q[a], q[b], q[a + 1], q[b + 1]]);
  }

  const still = frame(0, 0, 0);

  // ---------- what use leaves ----------
  // damp, where the cavern's floor meets the rock it seeps out of
  const SEEPS = new Set([ZONE.YARD, ZONE.STACK, ZONE.ADIT, ZONE.BAY, ZONE.TUNNEL]);
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (!openCell(x, z) || !SEEPS.has(grid.zone[z * W + x])) continue;
      const rock = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ].find(([dx, dz]) => kindAt(x + dx, z + dz) === KIND.ROCK);
      if (!rock || hash(x, z, 1) >= 0.07) continue;
      const half = 0.8 + hash(x, z, 2) * 0.6;
      const to = frame(x + 0.5 + rock[0] * 0.25, z + 0.5 + rock[1] * 0.25, hash(x, z, 3) * 6.283);
      rect(stains, to, -half, -half, half, half, { kind: 'damp', cell: 'damp' });
    }
  // cracks in the asphalt, and squares of it that were dug up and laid again
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (!openCell(x, z) || grid.floor[z * W + x] !== FLOOR.ASPHALT) continue;
      const to = frame(x + 0.5, z + 0.5, Math.floor(hash(x, z, 5) * 4) * QUARTER);
      if (hash(x, z, 4) < 0.014) {
        const half = 0.9 + hash(x, z, 6) * 0.3;
        rect(stains, to, -half, -half, half, half, { kind: 'crack', cell: 'crack' }, WHOLE, open);
      } else if (hash(x, z, 7) < 0.006)
        rect(stains, to, -0.6, -0.8, 0.6, 0.8, { kind: 'patch', cell: 'patch' }, WHOLE, open);
    }
  // oil under what has an engine or is full of it, and the tracks a lorry leaves backing in
  for (const [i, p] of site.props.entries()) {
    const drips = OILY[p.kind];
    if (!drips || p.y > 0.05) continue;
    const to = frame(p.x, p.z, p.rot);
    const [cx, cz] = to(drips[0] + (hash(i, 1, 8) - 0.5) * 0.4, drips[1] + (hash(i, 2, 8) - 0.5) * 0.4);
    const half = 0.6 + hash(i, 3, 8) * 0.35;
    rect(
      stains,
      frame(cx, cz, hash(i, 4, 8) * 6.283),
      -half,
      -half,
      half,
      half,
      { kind: 'oil', cell: 'oil' },
      WHOLE,
      open,
    );
    if (p.kind === 'truck') {
      const back = PROPS.truck.d / 2;
      rect(stains, to, -1.15, back - 0.5, 1.15, back + 4.5, { kind: 'tyre', cell: 'tyre' }, WHOLE, open);
    }
  }
  // …and where boots turn in front of every door
  const sidesOf = (door) => {
    // each side of a door: the cells in front of it, which way is out from it, and the frame of its sill —
    // x along the doorway, z away from the door
    const out = [];
    if (door.along === 'x') {
      const wide = door.x1 + 1 - door.x0;
      const mid = (door.x0 + door.x1 + 1) / 2;
      out.push({
        face: 'n',
        to: frame(mid, door.z0, Math.PI),
        wide,
        cells: [door.x0, door.z0 - 1, door.x1, door.z0 - 1],
      });
      out.push({
        face: 's',
        to: frame(mid, door.z1 + 1, 0),
        wide,
        cells: [door.x0, door.z1 + 1, door.x1, door.z1 + 1],
      });
    } else {
      const wide = door.z1 + 1 - door.z0;
      const mid = (door.z0 + door.z1 + 1) / 2;
      out.push({
        face: 'w',
        to: frame(door.x0, mid, -QUARTER),
        wide,
        cells: [door.x0 - 1, door.z0, door.x0 - 1, door.z1],
      });
      out.push({
        face: 'e',
        to: frame(door.x1 + 1, mid, QUARTER),
        wide,
        cells: [door.x1 + 1, door.z0, door.x1 + 1, door.z1],
      });
    }
    return out;
  };
  for (const door of grid.doors)
    for (const side of sidesOf(door)) {
      const half = side.wide / 2;
      rect(stains, side.to, -half, 0.45, half, 1.45, { kind: 'scuff', cell: 'scuff', door: door.id }, WHOLE, open);
    }

  // ---------- paint ----------
  // a hazard band across every doorway, on each side where there is a made floor to paint it on
  for (const door of grid.doors)
    for (const side of sidesOf(door)) {
      const half = side.wide / 2;
      const base = { kind: 'threshold', cell: 'hazard', door: door.id, face: side.face };
      strip(paint, side.to, -half, half, 0.1, 0.42, base, 0.1, 0.42, made);
    }

  // the cascades: the casings stand two rows deep; a yellow line round each, and its number at the west end
  const casings = new Set(site.centrifuges.map(([x, z]) => `${Math.floor(x)},${Math.floor(z)}`));
  const blocks = [];
  {
    const seen = new Set();
    const cells = [...casings].map((key) => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [x, z] of cells) {
      if (seen.has(`${x},${z}`)) continue;
      let x1 = x;
      while (casings.has(`${x1 + 1},${z}`)) x1++;
      let z1 = z;
      const whole = (row) => {
        for (let c = x; c <= x1; c++) if (!casings.has(`${c},${row}`) || seen.has(`${c},${row}`)) return false;
        return !casings.has(`${x - 1},${row}`) && !casings.has(`${x1 + 1},${row}`);
      };
      while (whole(z1 + 1)) z1++;
      for (let r = z; r <= z1; r++) for (let c = x; c <= x1; c++) seen.add(`${c},${r}`);
      blocks.push({ x0: x, z0: z, x1: x1 + 1, z1: z1 + 1 });
    }
  }
  // blocks that share their rows are one cascade (there are walkways through it)
  const rows = [];
  for (const b of blocks) {
    const row = rows.find((r) => r.z0 === b.z0 && r.z1 === b.z1);
    if (row) {
      row.x0 = Math.min(row.x0, b.x0);
      row.x1 = Math.max(row.x1, b.x1);
    } else rows.push({ ...b });
  }
  rows.sort((a, b) => a.z0 - b.z0);
  const LINE = [0.3, 0.7];
  for (const [n, r] of rows.entries()) {
    const base = { kind: 'line', cell: 'yellow', row: n };
    const x0 = r.x0 - 0.6;
    const x1 = r.x1 + 0.6;
    const z0 = r.z0 - 0.5;
    const z1 = r.z1 + 0.5;
    strip(paint, still, x0, x1, z0 - 0.1, z0 + 0.1, base, ...LINE, made);
    strip(paint, still, x0, x1, z1 - 0.1, z1 + 0.1, base, ...LINE, made);
    // the two ends: a frame turned a quarter, so that its x runs down the site's z
    const down = frame(0, 0, -QUARTER);
    strip(paint, down, z0, z1, -x0 - 0.1, -x0 + 0.1, base, ...LINE, made);
    strip(paint, down, z0, z1, -x1 - 0.1, -x1 + 0.1, base, ...LINE, made);
    // its number, read by someone coming up to its west end
    if (n < 8) {
      const to = frame(x0 - 0.75, (z0 + z1) / 2, -QUARTER);
      rect(paint, to, -0.5, -0.5, 0.5, 0.5, { kind: 'number', cell: `n${n + 1}`, row: n }, WHOLE, made);
    }
  }

  // a lorry's bay: a white line round where it stands, and the bay's number behind it
  let bay = rows.length;
  for (const p of site.props) {
    if (p.kind !== 'truck' || p.y > 0.05) continue;
    const to = frame(p.x, p.z, p.rot);
    const hw = PROPS.truck.w / 2 + 0.3;
    const hd = PROPS.truck.d / 2 + 0.3;
    const base = { kind: 'line', cell: 'white' };
    strip(paint, to, -hw, hw, -hd - 0.1, -hd + 0.1, base, ...LINE, made);
    strip(paint, to, -hw, hw, hd - 0.1, hd + 0.1, base, ...LINE, made);
    const along = frame(p.x, p.z, p.rot - QUARTER);
    strip(paint, along, -hd, hd, -hw - 0.1, -hw + 0.1, base, ...LINE, made);
    strip(paint, along, -hd, hd, hw - 0.1, hw + 0.1, base, ...LINE, made);
    const cell = `n${(bay++ % 8) + 1}`;
    rect(paint, frame(...to(0, hd + 0.9), p.rot), -0.5, -0.5, 0.5, 0.5, { kind: 'number', cell }, WHOLE, made);
  }

  // the road: a broken white line down the middle of it, in the tunnel and out under the sky
  for (let z = 0; z < H; z++) {
    if (z % 4 !== 1) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (!openCell(x, z) || grid.floor[i] !== FLOOR.ASPHALT) continue;
      if (grid.zone[i] !== ZONE.TUNNEL && grid.zone[i] !== ZONE.OUTSIDE) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
    }
    if (x1 - x0 < 2) continue;
    const down = frame((x0 + x1) / 2, z + 0.5, -QUARTER);
    strip(paint, down, -0.8, 0.8, -0.1, 0.1, { kind: 'dash', cell: 'white' }, ...LINE, made);
  }

  // ---------- the dark under things ----------
  for (const [i, p] of site.props.entries()) {
    const spec = PROPS[p.kind];
    if (!(spec.block > 0) || p.y > 0.05 || NO_CONTACT.has(p.kind)) continue;
    const to = frame(p.x, p.z, p.rot);
    const [x0, z0, x1, z1] = baseOf(p, i) || [
      -spec.w / 2 + 0.05,
      -spec.d / 2 + 0.05,
      spec.w / 2 - 0.05,
      spec.d / 2 - 0.05,
    ];
    if (ROUND.has(p.kind)) {
      // the round dark's square is full-dark over its middle and fades from there: as wide as puts the thing's
      // edge where the fading starts — but under something large, no more than a soft edge's width past it
      const r = Math.min(x1 - x0, z1 - z0) / 2;
      const reach = Math.min(r / DISC_CORE, r + BAND * 1.5);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      rect(dark, to, cx - reach, cz - reach, cx + reach, cz + reach, { kind: 'contact', cell: 'disc', of: i });
    } else under(to, x0, z0, x1, z1, { kind: 'contact', cell: DEEP.has(p.kind) ? 'deep' : 'blob', of: i });
  }
  for (const b of blocks)
    under(still, b.x0 + 0.04, b.z0 + 0.04, b.x1 - 0.04, b.z1 - 0.04, { kind: 'contact', cell: 'blob' });

  // ---------- on the walls ----------
  const NEXT = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
  /** a square of the picture for something upright: its corners from the foot at the left, round to the top left */
  const wallUV = (name) => {
    const [u0, v0, u1, v1] = cellUV(name);
    return [u0, v0, u1, v0, u1, v1, u0, v1];
  };
  const wallBehind = (x, z, side) => kindAt(x + NEXT[side][0], z + NEXT[side][1]) === KIND.WALL;
  // water runs down what was built in the cavern
  const WEEPS = new Set([ZONE.YARD, ZONE.STACK]);
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++) {
      if (!openCell(x, z) || !WEEPS.has(grid.zone[z * W + x])) continue;
      for (const [n, side] of ['n', 's', 'w', 'e'].entries()) {
        if (!wallBehind(x, z, side) || hash(x, z, 20 + n) >= 0.07) continue;
        const top = grid.top[(z + NEXT[side][1]) * W + x + NEXT[side][0]] || 6;
        const y = 0.7 + hash(x, z, 30 + n) * 0.6;
        const h = Math.min(2.6, top - 0.15 - y);
        if (h < 1.2) continue;
        onWalls.push({
          kind: 'drip',
          cell: 'drip',
          on: 'wall',
          x,
          z,
          side,
          along: 0.5,
          y,
          w: 0.8,
          h,
          uv: wallUV('drip'),
        });
      }
    }
  // the signs beside doors: what they say is what is behind the door
  const written = (x, z, side, y0, y1) =>
    (site.signs || []).some((s) => s.x === x && s.z === z && s.side === side && s.y < y1 && s.y + s.height > y0);
  for (const door of grid.doors) {
    // each side: [the side of a cell the wall is on, the zone behind the door, the cell on the right, on the left]
    const sides =
      door.along === 'x'
        ? [
            ['s', [door.x0, door.z1 + 1], [door.x0 - 1, door.z0 - 1], [door.x1 + 1, door.z0 - 1]],
            ['n', [door.x0, door.z0 - 1], [door.x1 + 1, door.z1 + 1], [door.x0 - 1, door.z1 + 1]],
          ]
        : [
            ['e', [door.x1 + 1, door.z0], [door.x0 - 1, door.z1 + 1], [door.x0 - 1, door.z0 - 1]],
            ['w', [door.x0 - 1, door.z0], [door.x1 + 1, door.z0 - 1], [door.x1 + 1, door.z1 + 1]],
          ];
    for (const [side, beyond, right, left] of sides) {
      if (!openCell(beyond[0], beyond[1])) continue;
      const faces = FACES[grid.zone[beyond[1] * W + beyond[0]]] || [];
      for (const [n, at] of [right, left].entries()) {
        const cell = faces[n];
        if (!cell || !openCell(at[0], at[1]) || !wallBehind(at[0], at[1], side)) continue;
        if (written(at[0], at[1], side, FACE.y, FACE.y + FACE.size)) continue;
        onWalls.push({
          kind: 'face',
          cell,
          on: 'wall',
          x: at[0],
          z: at[1],
          side,
          along: 0.5,
          y: FACE.y,
          w: FACE.size,
          h: FACE.size,
          door: door.id,
          uv: wallUV(cell),
        });
      }
    }
  }

  return [...stains, ...paint, ...dark, ...onWalls];
}
