// Site Hollow Nine, as data.
//
// buildSite() draws the site onto a grid with a handful of helpers and returns plain objects: the grid itself and
// lists of lamps, props, guards and objectives. Nothing here draws anything; world/build.js turns it into meshes.
// Everything is in cells (one metre), X east and Z south, so (x, z) on a printed map reads like a page.
//
// The site is INSIDE A MOUNTAIN (decision of 12 November 2026, docs/DESIGN.md §4). The grid starts as solid rock
// and everything is cut out of it: a main cavern with the facility built into its north side, a drainage adit on the
// west (where you come in), a drone bay on the north, an exhaust shaft over the lodestar pad, and one road tunnel
// south to a forecourt — the only cells under the sky. The shapes that the outside shares with this file (the
// forecourt, the road, the shaft) are in world/mountain.js.
import { Grid, KIND } from './grid.js';
import { PROPS, footprint } from './props.js';
import { FORECOURT, ROAD, SHAFT } from './mountain.js';

export const W = 128;
export const H = 96;

export const ZONE = {
  /** the forecourt and the road: the only cells that are not under rock */
  OUTSIDE: 0,
  /** the main cavern */
  YARD: 1,
  LOBBY: 2,
  CORRIDOR: 3,
  HALL: 4,
  CONTROL: 5,
  FEED: 6,
  POWER: 7,
  DOCK: 8,
  WORKSHOP: 9,
  ARMOURY: 10,
  GATEHOUSE: 11,
  GENSHED: 12,
  /** the east end of the cavern, under the exhaust shaft */
  STACK: 13,
  ADIT: 14,
  TUNNEL: 15,
  BAY: 16,
};

export const ZONE_NAMES = [
  'Forecourt',
  'Main cavern',
  'Lobby',
  'Service corridor',
  'Cascade hall',
  'Control room',
  'Feed room',
  'Switchgear',
  'Loading dock',
  'Workshop',
  'Armoury',
  'Gatehouse',
  'Generator shed',
  'Shaft cavern',
  'Drainage adit',
  'Road tunnel',
  'Drone bay',
];

export const FLOOR = { DIRT: 0, ASPHALT: 1, CONCRETE: 2, TILE: 3, EPOXY: 4, PLATE: 5 };
/** texture name for each floor id */
export const FLOOR_TEXTURES = ['dirt', 'asphalt', 'floorConcrete', 'floorTile', 'floorEpoxy', 'floorPlate'];
/** texture name for the walls that face each zone */
export const WALL_TEXTURES = [
  'concrete',
  'concrete',
  'wallPanel',
  'wallPanel',
  'hallWall',
  'wallPanel',
  'hallWall',
  'wallPanel',
  'hallWall',
  'wallPanel',
  'wallPanel',
  'wallPanel',
  'wallPanel',
  'concrete',
  'concrete',
  'concrete',
  'concrete',
];
/** texture name for the BUILT ceiling of each zone that has one; anything not listed gets panels ('ceiling') */
export const CEILING_TEXTURES = { [ZONE.ADIT]: 'rock', [ZONE.BAY]: 'rock', [ZONE.TUNNEL]: 'concrete' };

// lamp colours, linear light
const SODIUM = [1.0, 0.56, 0.2];
const COLD = [0.74, 0.9, 1.0];
const WARM = [1.0, 0.82, 0.6];
const CYAN = [0.3, 0.85, 0.9];
const AMBER = [1.0, 0.76, 0.46];
const FLOOD = [0.8, 0.9, 1.0];
const RED = [1.0, 0.16, 0.08];

const QUARTER = Math.PI / 2;

/**
 * A casing of the cascade, from its axis to its skin (gfx/models.js draws it; world/build.js measures what is
 * drawn, and test/smoke.test.mjs holds the three together): where a charge hangs, and how wide a round finds it.
 */
export const CASING = 0.21;
/** The control room's window on the cascade hall: how high its sill stands and where its head is, in metres. */
export const WINDOW = { sill: 1.0, head: 2.4 };

export function buildSite() {
  const g = new Grid(W, H);
  const site = {
    grid: g,
    /** { x, y, z, r, g, b, radius, kind } — kind: post | wall | ceiling | flood | screen */
    lamps: [],
    /** { kind, x, y, z, rot, variant } — world position of the model's origin */
    props: [],
    /** [x, z] of every centrifuge casing */
    centrifuges: [],
    /** { x0, z0, x1, z1, top } — one flat roof per building */
    roofs: [],
    /** { name, tier, type: 'sentry' | 'drone', route: [x, z][], loop, yaw } — see garrison() */
    guards: [],
    /** { id, name, x, y, z, nx, nz, stand: [x, z] } — where a charge goes and where you stand to set it */
    charges: [],
    /** { x, z, radius } — where the charges are fired from: the control room, at its window on the hall */
    firing: null,
    /** [x, z] — the cells of that window: a sill a body cannot cross, open above it to eyes and rounds */
    window: [],
    /** [x, z] — ammunition */
    ammo: [],
    /** where pursuers come from once the beacon is up */
    reinforcements: [],
    /** [x, z] — the doors of the building a wave of guards walks in by when a charge is set */
    entries: [],
    /** { text, x, y, z, side, height, tone } — words painted on walls; side says which wall of the cell: n s e w */
    signs: [],
  };

  // ---------- drawing helpers ----------
  const each = (x0, z0, x1, z1, fn) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(g.index(x, z), x, z);
  };
  const ground = (x0, z0, x1, z1, floor, zone) =>
    each(x0, z0, x1, z1, (i) => {
      g.kind[i] = KIND.GROUND;
      g.ceil[i] = 0;
      g.floor[i] = floor;
      g.zone[i] = zone;
    });
  const rock = (x0, z0, x1, z1) =>
    each(x0, z0, x1, z1, (i) => {
      g.kind[i] = KIND.ROCK;
    });
  /** Wire: it stops bodies, not eyes, and a drone goes over it. The ground under it belongs to `zone`. */
  const fence = (x0, z0, x1, z1, zone = ZONE.YARD) =>
    each(x0, z0, x1, z1, (i) => {
      g.kind[i] = KIND.FENCE;
      g.ceil[i] = 0;
      g.zone[i] = zone;
    });
  /** A passage bored through the rock: open ground under a low roof of its own. */
  const bore = (x0, z0, x1, z1, floor, zone, ceil) =>
    each(x0, z0, x1, z1, (i) => {
      g.kind[i] = KIND.GROUND;
      g.ceil[i] = ceil;
      g.floor[i] = floor;
      g.zone[i] = zone;
    });
  /**
   * A solid block; rooms are then carved out of it. With a `top` it stands free under the cavern's roof and has
   * a flat roof of its own; with none (0) it is built into the rock and its walls go up to the cavern's roof.
   */
  const building = (x0, z0, x1, z1, top = 0) => {
    each(x0, z0, x1, z1, (i) => {
      g.kind[i] = KIND.WALL;
      g.top[i] = top;
    });
    if (top > 0) site.roofs.push({ x0, z0, x1, z1, top });
  };
  const room = (x0, z0, x1, z1, zone, floor, ceil) =>
    each(x0, z0, x1, z1, (i) => {
      g.kind[i] = KIND.FLOOR;
      g.zone[i] = zone;
      g.floor[i] = floor;
      g.ceil[i] = ceil;
    });
  /** A sliding door: a short stretch of floor under a lintel. Its floor and zone are taken from `like`. */
  const door = (x0, z0, x1, z1, like) => {
    const src = g.index(like[0], like[1]);
    room(x0, z0, x1, z1, g.zone[src], g.floor[src], 2.6);
    g.addDoor(x0, z0, x1, z1);
  };
  /** A doorway with no door in it. */
  const opening = (x0, z0, x1, z1, like, ceil) => {
    const src = g.index(like[0], like[1]);
    room(x0, z0, x1, z1, g.zone[src], g.floor[src], ceil);
  };

  /** Stands a prop with its footprint's north-west corner on cell (x, z). turns: quarter turns, 0 faces north. */
  const prop = (kind, x, z, turns = 0, variant = 0) => {
    const spec = PROPS[kind];
    const [fw, fd] = footprint(kind, turns);
    each(x, z, x + fw - 1, z + fd - 1, (i, cx, cz) => {
      const k = g.kind[i];
      if ((k !== KIND.GROUND && k !== KIND.FLOOR) || g.block[i] > 0)
        throw new Error(`${kind} at ${x},${z} does not fit: cell ${cx},${cz} is taken`);
      if (spec.block > 0) {
        g.block[i] = spec.block;
        g.thin[i] = spec.thin ? 1 : 0;
        g.stand[i] = spec.stand ? 1 : 0;
      }
    });
    site.props.push({ kind, x: x + fw / 2, y: 0, z: z + fd / 2, rot: turns * QUARTER, variant });
  };
  /** A prop put at an exact point (lights, pipes, things on the roof); takes up no ground. */
  const decor = (kind, x, y, z, rot = 0, variant = 0) => site.props.push({ kind, x, y, z, rot, variant });

  const lamp = (x, y, z, color, power, radius, kind) =>
    site.lamps.push({ x, y, z, r: color[0] * power, g: color[1] * power, b: color[2] * power, radius, kind });

  /** A strip light on the ceiling of cell (x, z). */
  const ceilingLamp = (x, z, color = COLD, power = 1.4, radius = 10, along = 0) => {
    const ceil = g.ceil[g.index(x, z)];
    decor('ceilingLight', x + 0.5, ceil, z + 0.5, along * QUARTER);
    lamp(x + 0.5, ceil - 0.3, z + 0.5, color, power, radius, 'ceiling');
  };
  /** A lamp post on cell (x, z) with its arm reaching the way it faces. */
  const post = (x, z, turns, power = 1.7, radius = 15) => {
    prop('lampPost', x, z, turns);
    const a = turns * QUARTER;
    lamp(x + 0.5 - Math.sin(a) * 1.1, 5.5, z + 0.5 - Math.cos(a) * 1.1, SODIUM, power, radius, 'post');
  };
  /** A bulkhead lamp on the wall that bounds cell (x, z) on side n | s | e | w. */
  const wallLamp = (x, z, side, y = 3.4, color = SODIUM, power = 1.2, radius = 9) => {
    const at = { n: [0.5, 0, Math.PI], s: [0.5, 1, 0], w: [0, 0.5, -QUARTER], e: [1, 0.5, QUARTER] }[side];
    decor('wallLight', x + at[0], y, z + at[1], at[2]);
    const off = { n: [0, 0.35], s: [0, -0.35], w: [0.35, 0], e: [-0.35, 0] }[side];
    lamp(x + at[0] + off[0], y - 0.1, z + at[1] + off[1], color, power, radius, 'wall');
  };

  /**
   * Words stencilled on the wall that bounds cell (x, z) on side n | s | e | w, centred `along` cells along it.
   * tone: 'paint' (off-white) or 'hazard' (yellow).
   */
  const sign = (text, x, z, side, along = 0.5, y = 3.08, height = 0.34, tone = 'paint') =>
    site.signs.push({ text, x, z, side, along, y, height, tone });

  // `tier` is the easiest setting a machine appears on: 1 = every setting, 2 = Operator and Ghost, 3 = Ghost only
  // (see garrison() below, and src/difficulty.js)
  const sentry = (name, tier, route, opts = {}) =>
    site.guards.push({ name, tier, type: 'sentry', route, loop: true, ...opts });
  const drone = (name, tier, route, opts = {}) =>
    site.guards.push({ name, tier, type: 'drone', route, loop: true, ...opts });

  // ---------- the mountain ----------
  // Solid rock from edge to edge; everything else is cut out of it. (Until 12 November 2026 this was an open basin
  // with a ragged rim of rock, a fenced yard under the night sky, and a building standing in it.)
  rock(0, 0, W - 1, H - 1);

  // the main cavern — where the yard was, and the same size: every route across it is where it always was
  ground(15, 13, 112, 83, FLOOR.DIRT, ZONE.YARD);
  ground(30, 55, 100, 80, FLOOR.ASPHALT, ZONE.YARD);
  ground(101, 13, 112, 54, FLOOR.CONCRETE, ZONE.STACK);
  ground(16, 26, 29, 39, FLOOR.CONCRETE, ZONE.YARD);
  ground(60, 81, 67, 83, FLOOR.ASPHALT, ZONE.YARD);

  // the drainage adit, where you come in: a bore through the rock on the west, a little wider where you start
  // and at its mouth — which has a grating across it, and the grating has been cut
  bore(3, 66, 13, 67, FLOOR.DIRT, ZONE.ADIT, 2.7);
  bore(7, 65, 11, 68, FLOOR.DIRT, ZONE.ADIT, 3.0);
  bore(12, 64, 13, 69, FLOOR.DIRT, ZONE.ADIT, 2.7);
  fence(14, 64, 14, 69);
  ground(14, 66, 14, 67, FLOOR.DIRT, ZONE.YARD);

  // the drone bay: a recess off the north of the cavern behind a wire screen, where the pursuers wait
  bore(38, 5, 88, 11, FLOOR.CONCRETE, ZONE.BAY, 5);
  fence(38, 12, 88, 12);

  // the road out: under the portal, through a tunnel lined with concrete, into a forecourt under the sky, and
  // off the south edge of the map
  bore(ROAD.x0, 84, ROAD.x1 - 1, FORECOURT.z0 - 1, FLOOR.ASPHALT, ZONE.TUNNEL, 5.5);
  building(ROAD.x0 - 1, 84, ROAD.x0 - 1, FORECOURT.z0 - 1);
  building(ROAD.x1, 84, ROAD.x1, FORECOURT.z0 - 1);
  ground(FORECOURT.x0, FORECOURT.z0, FORECOURT.x1 - 1, FORECOURT.z1 - 1, FLOOR.DIRT, ZONE.OUTSIDE);
  ground(ROAD.x0, FORECOURT.z0, ROAD.x1 - 1, H - 1, FLOOR.ASPHALT, ZONE.OUTSIDE);
  each(0, FORECOURT.z0, W - 1, H - 1, (i) => {
    if (g.kind[i] === KIND.GROUND && g.zone[i] === ZONE.OUTSIDE) g.sky[i] = 1;
  });

  // the exhaust shaft: straight up from the lodestar pad to a bench on the mountain — the one place inside that
  // is open to the sky, which is why the lodestar is stood there
  each(SHAFT.x0, SHAFT.z0, SHAFT.x1 - 1, SHAFT.z1 - 1, (i) => {
    g.sky[i] = 2;
  });
  site.shaft = SHAFT;

  // ---------- the enrichment facility, built into the north side of the cavern ----------
  building(30, 16, 100, 54);
  room(31, 17, 71, 41, ZONE.HALL, FLOOR.EPOXY, 7);
  room(73, 17, 99, 27, ZONE.FEED, FLOOR.CONCRETE, 5);
  room(73, 29, 84, 41, ZONE.CONTROL, FLOOR.TILE, 3.6);
  room(86, 29, 88, 41, ZONE.CORRIDOR, FLOOR.CONCRETE, 3.6);
  room(90, 29, 99, 41, ZONE.POWER, FLOOR.PLATE, 4);
  room(31, 43, 99, 45, ZONE.CORRIDOR, FLOOR.CONCRETE, 3.6);
  room(31, 47, 46, 53, ZONE.LOBBY, FLOOR.TILE, 3.6);
  room(48, 47, 58, 53, ZONE.ARMOURY, FLOOR.CONCRETE, 3.6);
  room(60, 47, 78, 53, ZONE.WORKSHOP, FLOOR.CONCRETE, 3.6);
  room(80, 47, 99, 53, ZONE.DOCK, FLOOR.PLATE, 5);

  door(40, 54, 41, 54, [40, 53]); // lobby, from the yard
  door(40, 46, 41, 46, [40, 45]); // lobby to the corridor
  door(44, 42, 45, 42, [44, 43]); // corridor to the hall, west
  door(64, 42, 65, 42, [64, 43]); // corridor to the hall, east
  door(72, 21, 72, 22, [73, 21]); // hall to the feed room
  door(78, 42, 79, 42, [78, 43]); // corridor to the control room
  opening(86, 42, 88, 42, [86, 43], 3.0); // the two corridors meet
  door(86, 28, 87, 28, [86, 29]); // corridor to the feed room
  door(89, 35, 89, 36, [88, 35]); // corridor to the switchgear
  door(85, 33, 85, 34, [86, 33]); // control room to the corridor
  opening(88, 54, 91, 54, [88, 53], 4.2); // the dock's shutter, rolled up
  door(90, 46, 91, 46, [90, 45]); // dock to the corridor
  door(68, 46, 69, 46, [68, 45]); // workshop
  door(52, 46, 53, 46, [52, 45]); // armoury
  door(100, 22, 100, 23, [99, 22]); // feed room out to the stack yard
  door(30, 44, 30, 45, [31, 44]); // the corridor's west end, out to the dark side of the yard
  // The control room looks into the cascade hall through a long window with no glass in it: a sill that stops a
  // body, open above it to eyes and to rounds, under a low head. The charges are fired from here.
  opening(72, 32, 72, 37, [73, 34], WINDOW.head);
  each(72, 32, 72, 37, (i, x, z) => {
    g.block[i] = WINDOW.sill;
    site.window.push([x, z]);
  });

  // ---------- outbuildings ----------
  building(18, 28, 27, 37, 4.6);
  room(19, 29, 26, 36, ZONE.GENSHED, FLOOR.CONCRETE, 3.6);
  door(27, 32, 27, 33, [26, 32]);

  building(70, 76, 77, 83, 4.2);
  room(71, 77, 76, 82, ZONE.GATEHOUSE, FLOOR.TILE, 3.2);
  door(70, 79, 70, 80, [71, 79]);

  // ---------- the forecourt, outside the portal ----------
  prop('rock', 57, 92, 0, 1);
  prop('rock', 69, 90, 1, 3);
  prop('barrier', 57, 90, 0);
  prop('barrier', 70, 93, 0);
  prop('crate', 59, 93, 0, 1);
  // hooded lamps on the portal's two piers and one over its mouth: enough to find the way out by
  wallLamp(ROAD.x0 - 1, FORECOURT.z0, 'n', 4.2, SODIUM, 0.8, 9);
  wallLamp(ROAD.x1, FORECOURT.z0, 'n', 4.2, SODIUM, 0.8, 9);
  wallLamp(63, FORECOURT.z0, 'n', 6.5, SODIUM, 0.9, 10);

  // ---------- the road tunnel ----------
  wallLamp(60, 85, 'w', 3.8, SODIUM, 1.0, 9);
  wallLamp(67, 85, 'e', 3.8, SODIUM, 1.0, 9);
  wallLamp(60, 88, 'w', 3.8, SODIUM, 1.0, 9);
  wallLamp(67, 88, 'e', 3.8, SODIUM, 1.0, 9);

  // ---------- the drainage adit ----------
  prop('barrel', 8, 65, 0, 2);
  prop('crate', 11, 68, 0, 0);
  wallLamp(12, 64, 'n', 2.1, AMBER, 0.5, 6);

  // ---------- the drone bay ----------
  for (const x of [44, 56, 68, 80]) ceilingLamp(x, 8, RED, 0.9, 10);
  for (const x of [40, 47, 53, 59, 65, 71, 77, 86]) prop('rack', x, 5);
  prop('crate', 84, 6, 0, 1);
  prop('crate', 85, 6, 0, 2);
  prop('barrel', 42, 6, 0, 0);

  // ---------- the cavern ----------
  prop('container', 33, 58, 0, 0);
  prop('container', 33, 61, 0, 1);
  prop('container', 41, 66, 1, 2);
  prop('container', 46, 74, 0, 3);
  prop('container', 94, 62, 1, 1);
  prop('container', 97, 62, 1, 0);
  prop('container', 18, 50, 1, 2);
  prop('container', 22, 58, 0, 3);
  prop('truck', 52, 57, 0, 0);
  prop('truck', 73, 58, 2, 1);
  prop('truck', 82, 66, 1, 2);
  prop('forklift', 84, 56, 2);
  for (const [kind, x, z, v] of [
    ['crate', 40, 58, 0],
    ['crateTall', 40, 59, 1],
    ['barrel', 39, 63, 0],
    ['barrel', 40, 63, 1],
    ['crate', 57, 70, 1],
    ['crate', 58, 70, 2],
    ['crateTall', 58, 71, 0],
    ['barrel', 56, 71, 2],
    ['crate', 92, 57, 0],
    ['crate', 93, 57, 2],
    ['crate', 92, 58, 1],
    ['pallet', 95, 57, 0],
    ['barrel', 104, 60, 0],
    ['barrel', 105, 60, 1],
    ['crate', 104, 61, 1],
    ['crate', 28, 41, 0],
    ['barrel', 28, 42, 2],
    ['crate', 47, 78, 2],
    ['barrel', 78, 73, 0],
    ['barrel', 79, 73, 1],
    ['crate', 79, 74, 0],
    ['pallet', 86, 60, 0],
  ])
    prop(kind, x, z, 0, v);
  prop('cylinder', 96, 58, 0);
  prop('barrier', 60, 79, 0);
  prop('barrier', 65, 76, 0);
  prop('barrier', 68, 81, 0);
  prop('transformer', 19, 40);
  prop('transformer', 22, 40);
  prop('tower', 16, 80);
  prop('tower', 109, 80);
  prop('tower', 16, 13);
  lamp(18, 7.4, 80.5, FLOOD, 1.25, 26, 'flood');
  lamp(109, 7.4, 80.5, FLOOD, 1.25, 26, 'flood');
  lamp(18.5, 7.4, 16, FLOOD, 0.9, 22, 'flood');

  post(58, 57, 3);
  post(69, 70, 1);
  post(58, 80, 3);
  post(69, 74, 1);
  post(44, 63, 2);
  post(90, 72, 0);
  post(31, 70, 3);
  post(100, 74, 1);
  for (const x of [34, 46, 58, 70, 82, 96]) wallLamp(x, 55, 'n', 4.4);
  wallLamp(38, 55, 'n', 3.0, COLD, 0.9, 7);
  wallLamp(43, 55, 'n', 3.0, COLD, 0.9, 7);
  wallLamp(28, 32, 'w', 3.0, SODIUM, 0.9, 8);
  wallLamp(29, 46, 'e', 3.0, SODIUM, 0.7, 7);
  wallLamp(69, 78, 'e', 2.9, SODIUM, 1.0, 8);

  // ---------- the shaft cavern ----------
  prop('transformer', 103, 44);
  prop('transformer', 106, 44);
  prop('transformer', 109, 44);
  prop('barrier', 103, 48);
  prop('barrier', 108, 48);
  prop('crate', 111, 30, 0, 1);
  prop('barrel', 111, 31, 0, 2);
  prop('tank', 104, 16);
  prop('tank', 107, 16);
  post(109, 27, 1, 1.4, 14);
  wallLamp(101, 20, 'w', 3.0, COLD, 0.9, 7);
  wallLamp(101, 40, 'w', 4.4, SODIUM, 0.9, 9);
  site.beacon = { x: 106.5, z: 34.5, radius: 2.2 };
  each(105, 33, 107, 35, (i) => {
    g.floor[i] = FLOOR.PLATE;
  });
  // The shaft's lamps: a ring of work lights where it leaves the cavern, then red ones every twelve metres up to
  // the top — so that looking up it you can see how far it goes. Each is on the middle of one of its four walls
  // (where the fitting is, which way it faces, and where its light is: a hand's breadth out from the wall).
  {
    const mx = (SHAFT.x0 + SHAFT.x1) / 2;
    const mz = (SHAFT.z0 + SHAFT.z1) / 2;
    const walls = [
      [mx, SHAFT.z0, Math.PI, 0, 0.35],
      [mx, SHAFT.z1, 0, 0, -0.35],
      [SHAFT.x0, mz, -QUARTER, 0.35, 0],
      [SHAFT.x1, mz, QUARTER, -0.35, 0],
    ];
    for (let y = 17, ring = 0; y < SHAFT.top - 2; y += 12, ring++)
      for (const [x, z, rot, ox, oz] of walls) {
        decor('wallLight', x, y, z, rot);
        if (ring === 0) lamp(x + ox * 2, y - 0.1, z + oz * 2, COLD, 0.26, 11, 'wall');
        else lamp(x + ox * 2, y - 0.1, z + oz * 2, RED, 0.8, 11, 'wall');
      }
    // and what comes down it from the sky: a little cold light on the pad, from no lamp at all
    lamp(mx, 8.5, mz, [0.55, 0.7, 1.0], 0.75, 14, 'sky');
  }

  // ---------- the cascade hall ----------
  for (const z of [20, 21, 25, 26, 30, 31, 35, 36])
    for (const [x0, x1] of [
      [34, 49],
      [53, 68],
    ])
      for (let x = x0; x <= x1; x++) {
        g.block[g.index(x, z)] = 3.3;
        site.centrifuges.push([x + 0.25, z + 0.5], [x + 0.75, z + 0.5]);
      }
  for (const z of [21, 26, 31, 36]) for (const x of [36, 40, 44, 48, 55, 59, 63, 67]) decor('pipeRun', x, 0.25, z);
  for (const z of [18, 28, 39]) for (const x of [36, 46, 56, 66]) ceilingLamp(x, z, COLD, 1.5, 14);
  ceilingLamp(51, 23, COLD, 1.2, 12);
  ceilingLamp(51, 33, COLD, 1.2, 12);
  prop('console', 33, 40, 2);
  prop('rack', 31, 30);
  prop('rack', 31, 31);
  prop('crate', 70, 40, 0, 1);
  prop('crate', 71, 40, 0, 0);
  prop('rack', 71, 30);
  // One charge to a cascade (a double row of casings), each on the end casing of a row, at a different end of the
  // hall each time: rigging all four is a walk through it. `CASING` is a casing's radius: the charge sits on its skin.
  const charge = (n, cx, cz, nx, stand) =>
    site.charges.push({ id: `c${n}`, name: `Cascade ${n}`, x: cx + nx * CASING, y: 1.25, z: cz, nx, nz: 0, stand });
  charge(1, 34.25, 20.5, -1, [33, 20]);
  charge(2, 49.75, 25.5, 1, [50, 25]);
  charge(3, 53.25, 30.5, -1, [52, 30]);
  charge(4, 68.75, 35.5, 1, [69, 35]);

  // ---------- the feed room ----------
  for (const x of [75, 79, 83, 87]) prop('tank', x, 18);
  for (const [x, z] of [
    [75, 24],
    [79, 24],
    [83, 24],
    [75, 26],
    [79, 26],
  ])
    prop('cylinder', x, z, 0, (x + z) % 3);
  for (const x of [76, 80, 84, 88]) decor('pipeRun', x, 1.2, 20.5);
  prop('console', 92, 17, 2);
  prop('rack', 97, 17);
  prop('rack', 98, 17);
  prop('crate', 96, 26, 0, 2);
  prop('barrel', 97, 26, 0, 0);
  ceilingLamp(78, 22, COLD, 1.3, 11, 1);
  ceilingLamp(88, 22, COLD, 1.3, 11, 1);
  ceilingLamp(96, 22, COLD, 1.1, 10, 1);

  // ---------- the control room ----------
  // where the charges are fired from: at the window, opposite the fourth cascade
  site.firing = { x: 73.6, z: 35.5, radius: 1.5 };
  for (const z of [33, 37])
    for (const x of [75, 78, 81]) {
      prop('console', x, z, 0);
      lamp(x + 1, 1.5, z - 0.4, CYAN, 0.45, 4.5, 'screen');
    }
  for (const z of [30, 31, 38, 39, 40]) prop('rack', 73, z, 3);
  prop('desk', 82, 40, 2);
  ceilingLamp(77, 35, COLD, 0.55, 9);
  ceilingLamp(82, 31, COLD, 0.55, 9);

  // ---------- the east corridor and the switchgear ----------
  ceilingLamp(87, 31, COLD, 1.1, 9, 1);
  ceilingLamp(87, 39, COLD, 1.1, 9, 1);
  for (const x of [91, 93, 95, 97]) prop('switchgear', x, 29, 2);
  for (const z of [32, 34, 37, 39]) prop('switchgear', 99, z, 1);
  prop('transformer', 91, 39);
  prop('rack', 94, 41);
  ceilingLamp(94, 34, AMBER, 1.0, 10);

  // ---------- the service corridor ----------
  for (const x of [35, 43, 51, 67, 75, 91, 97]) ceilingLamp(x, 44, COLD, 1.25, 10);
  for (let x = 33; x <= 97; x += 4) decor('pipeRun', x, -0.12, 43.5);
  prop('crate', 33, 45, 0, 1);
  prop('crate', 34, 45, 0, 0);
  prop('barrel', 61, 43, 0, 1);
  prop('crate', 74, 45, 0, 2);
  prop('crateTall', 75, 45, 0, 0);
  prop('barrel', 96, 43, 0, 0);

  // ---------- the lobby ----------
  prop('desk', 35, 49, 2);
  prop('barrier', 38, 51);
  prop('barrier', 43, 51);
  prop('locker', 31, 47, 1);
  prop('locker', 31, 50, 1);
  prop('console', 44, 47, 2);
  prop('rack', 46, 53);
  ceilingLamp(35, 50, COLD, 1.2, 9);
  ceilingLamp(42, 49, COLD, 1.2, 9);

  // ---------- the armoury ----------
  for (const x of [48, 50, 54, 56]) prop('locker', x, 53, 0);
  prop('crate', 57, 47, 0, 2);
  prop('crate', 58, 47, 0, 1);
  prop('crateTall', 58, 48, 0, 2);
  prop('desk', 48, 48, 1);
  ceilingLamp(53, 50, WARM, 1.0, 9);
  site.ammo.push([55.5, 50.5]);

  // ---------- the workshop ----------
  prop('rack', 60, 47);
  prop('rack', 61, 47);
  prop('desk', 63, 53, 0);
  prop('cylinder', 62, 50, 0, 1);
  prop('pallet', 66, 52);
  prop('crate', 70, 51, 0, 0);
  prop('crate', 71, 51, 0, 2);
  prop('crateTall', 72, 51, 0, 1);
  prop('barrel', 75, 48, 0, 0);
  prop('barrel', 76, 48, 0, 2);
  prop('barrel', 76, 49, 0, 1);
  prop('locker', 77, 52, 1);
  ceilingLamp(64, 50, COLD, 1.1, 9);

  // ---------- the loading dock ----------
  prop('crate', 81, 48, 0, 0);
  prop('crate', 82, 48, 0, 1);
  prop('crate', 81, 49, 0, 2);
  prop('crateTall', 82, 49, 0, 0);
  prop('pallet', 84, 52);
  prop('pallet', 85, 52);
  prop('cylinder', 94, 48, 0, 0);
  prop('cylinder', 94, 50, 0, 2);
  prop('barrel', 98, 52, 0, 1);
  prop('barrel', 99, 52, 0, 0);
  prop('rack', 99, 47);
  ceilingLamp(84, 50, COLD, 1.3, 11);
  ceilingLamp(95, 49, COLD, 1.3, 11);
  site.ammo.push([86.5, 48.5]);

  // ---------- the generator shed ----------
  prop('generator', 20, 30, 0);
  prop('generator', 20, 34, 0);
  prop('rack', 25, 29);
  prop('barrel', 25, 36, 0, 2);
  prop('barrel', 26, 36, 0, 0);
  ceilingLamp(23, 32, WARM, 0.9, 8);
  site.ammo.push([24.5, 32.5]);

  // ---------- the gatehouse ----------
  prop('desk', 73, 77, 2);
  prop('console', 75, 82, 0);
  prop('locker', 76, 78, 1);
  ceilingLamp(73, 80, WARM, 1.0, 7);

  // ---------- words on the walls ----------
  // over each door, on the side you come at it from. `along` runs 0 → 1 from the left end of the cell's wall to its
  // right end as you face it, so the middle of a two-cell door is 1 on its left cell (n, e) or 0 on its right (s, w)
  sign('CASCADE HALL', 44, 43, 'n', 1);
  sign('CASCADE HALL', 64, 43, 'n', 1);
  sign('SERVICE CORRIDOR', 44, 41, 's', 0, 3.1);
  sign('SERVICE CORRIDOR', 64, 41, 's', 0, 3.1);
  sign('CONTROL', 78, 43, 'n', 1);
  sign('FEED + WITHDRAWAL', 86, 29, 'n', 1);
  sign('FEED + WITHDRAWAL', 71, 21, 'e', 1, 3.1);
  sign('CASCADE HALL', 73, 21, 'w', 0, 3.1);
  sign('SWITCHGEAR', 88, 35, 'e', 1);
  sign('DANGER  11 kV', 88, 35, 'e', 1, 2.72, 0.2, 'hazard');
  sign('CONTROL', 86, 33, 'w', 0);
  sign('LOBBY', 40, 45, 's', 0);
  sign('ARMOURY', 52, 45, 's', 0);
  sign('WORKSHOP', 68, 45, 's', 0);
  sign('DOCK', 90, 45, 's', 0);
  sign('SHAFT CAVERN', 99, 22, 'e', 1, 3.1);
  sign('CAVERN — WEST', 31, 44, 'w', 0);
  // in the cavern, big enough to read across it
  sign('HOLLOW NINE', 40, 55, 'n', 1, 3.9, 0.7);
  sign('CAVERN 1  ·  LEVEL −2', 53, 55, 'n', 0.5, 6.3, 0.5);
  sign('DOCK 1', 89, 55, 'n', 1, 5.1, 0.8);
  sign('SERVICE', 29, 44, 'e', 1, 3.4, 0.4);
  sign('GENERATORS', 28, 32, 'w', 0, 3.2, 0.36);
  sign('PORTAL', 69, 79, 'e', 1, 3.1, 0.36);
  sign('FEED ROOM', 101, 22, 'w', 0, 3.2, 0.4);
  sign('NO UNESCORTED ACCESS', 46, 55, 'n', 0.5, 1.7, 0.16, 'hazard');
  sign('CASCADE  A1 – A4', 31, 28, 'w', 0.5, 2.2, 0.3);
  sign('CASCADE  B1 – B4', 71, 34, 'e', 0.5, 2.2, 0.3);
  // the ways in and out of the rock, named where you meet them
  sign('TO SURFACE', 63, 83, 's', 1, 6.15, 0.62);
  sign('ROAD TUNNEL', 63, 83, 's', 1, 5.68, 0.3);
  sign('DRAINAGE ADIT 3', 15, 63, 'w', 0.5, 2.5, 0.32);
  sign('KEEP GRATING SHUT', 15, 70, 'w', 0.5, 1.7, 0.18, 'hazard');
  sign('EXHAUST SHAFT 1', 101, 34, 'w', 0.5, 3.4, 0.5);
  sign('DANGER  OPEN SHAFT ABOVE', 101, 34, 'w', 0.5, 2.75, 0.2, 'hazard');
  sign('DRONE BAY', 62, 12, 'n', 1, 5.5, 0.5);

  // ---------- the guards ----------
  // Twenty machines in all. How many of them are on the site depends on the setting: see garrison().
  // on the ground outside
  sentry('gate', 1, [[58, 82]], { yaw: Math.PI });
  sentry(
    'road',
    1,
    [
      [63, 82],
      [63, 57],
    ],
    { loop: false },
  );
  sentry('yardWest', 3, [
    [31, 57],
    [31, 78],
    [48, 78],
    [48, 64],
    [45, 57],
  ]);
  sentry('yardEast', 1, [
    [78, 57],
    [92, 60],
    [101, 70],
    [90, 78],
    [78, 72],
  ]);
  // walks past the cut in the wire: the way in is only watched on Ghost
  sentry(
    'fenceWest',
    3,
    [
      [22, 24],
      [22, 72],
    ],
    { loop: false },
  );
  sentry('stackYard', 2, [
    [103, 24],
    [110, 24],
    [110, 51],
    [103, 51],
  ]);
  sentry(
    'north',
    3,
    [
      [20, 14],
      [98, 14],
    ],
    { loop: false },
  );
  // inside (the lobby, the east corridor and the dock each came down a setting on 12 November 2026, when the owner
  // asked for "a bit harder": what was added is in the building, where the charges are — test/unit/difficulty.test.mjs)
  sentry('lobby', 2, [[36, 51]], { yaw: -QUARTER * 1.5 });
  sentry(
    'corridor',
    1,
    [
      [33, 44],
      [97, 44],
    ],
    { loop: false },
  );
  sentry(
    'eastCorridor',
    2,
    [
      [87, 40],
      [87, 30],
    ],
    { loop: false },
  );
  sentry('hallLoop', 1, [
    [32, 18],
    [70, 18],
    [70, 39],
    [32, 39],
  ]);
  sentry(
    'hallAisle',
    2,
    [
      [51, 19],
      [51, 40],
    ],
    { loop: false },
  );
  sentry('control', 1, [[79, 39]], { yaw: 0 });
  sentry(
    'feed',
    1,
    [
      [74, 22],
      [97, 22],
    ],
    { loop: false },
  );
  sentry('switchgear', 1, [[94, 36]], { yaw: QUARTER });
  sentry(
    'dock',
    1,
    [
      [83, 51],
      [97, 51],
    ],
    { loop: false },
  );
  // in the air
  drone('droneYard', 1, [
    [40, 65],
    [60, 70],
    [86, 72],
    [99, 58],
    [70, 56],
    [46, 56],
  ]);
  drone('dronePerimeter', 3, [
    [21, 20],
    [21, 76],
    [56, 82],
    [106, 76],
    [107, 58],
  ]);
  drone('droneStack', 3, [
    [107, 30],
    [107, 41],
    [103, 36],
  ]);
  drone('droneHall', 2, [
    [33, 23],
    [69, 23],
    [69, 33],
    [33, 33],
  ]);

  site.reinforcements = [
    [50, 9],
    [62, 9],
    [74, 9],
    [86, 9],
    [40, 9],
  ];
  // The doors of the building a wave of guards walks in by when a charge goes on a cascade (src/enemies/wave.js
  // chooses among them): the lobby, the two ends of the service corridor, the dock, the feed room and the east
  // corridor. None is in the hall: a machine does not appear in the room the player is working in.
  site.entries = [
    [36, 51],
    [33, 44],
    [97, 44],
    [97, 51],
    [97, 22],
    [87, 30],
  ];

  // ---------- where it starts and where it ends ----------
  // in the adit, facing the grating; and on the road in the forecourt, under the sky
  site.start = { x: 9.5, z: 67, yaw: -QUARTER };
  site.pickup = { x0: ROAD.x0, z0: FORECOURT.z0 + 1, x1: ROAD.x1, z1: FORECOURT.z1, x: 64, z: 93 };

  g.changed();
  return site;
}

/**
 * The machines that guard the site on a setting: every one whose tier is no higher than the setting's
 * (1 Recruit, 2 Operator, 3 Ghost — src/difficulty.js). A harder setting keeps the easier one's machines and adds
 * to them. A machine's place in this list is its number on the mission's roll.
 */
export function garrison(site, tier) {
  return site.guards.filter((unit) => unit.tier <= tier);
}

/** The site as text, one character a cell — for tests and for reading in a terminal. */
export function printSite(site) {
  const g = site.grid;
  const rows = [];
  for (let z = 0; z < g.h; z++) {
    let row = '';
    for (let x = 0; x < g.w; x++) {
      const i = g.index(x, z);
      const kind = g.kind[i];
      if (kind === KIND.ROCK) row += '^';
      else if (kind === KIND.WALL) row += '#';
      else if (kind === KIND.FENCE) row += 'x';
      else if (kind === KIND.DOOR) row += 'D';
      else if (g.block[i] > 0) row += g.thin[i] ? '|' : g.block[i] >= 1.9 ? 'O' : 'o';
      else row += kind === KIND.FLOOR ? ' ' : g.floor[i] === FLOOR.DIRT ? '.' : ',';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
