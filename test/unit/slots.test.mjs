// Contract lock: a strong light in every space, and the few of them that burn at once.
//
// Decision of 16 November 2026 — the owner, having looked at the one view of the 15th: "I like the new graphics
// continue the implementation plan". Its third step: "one strong light in every space that throws real shadows:
// the moon outside and down the shaft, floodlights in the cavern, work lights in the hall … more than one colour
// of light". There are now some two dozen key lights (src/look/keys.js) and a handful of slots for them
// (src/look/slots.js). What is held here, without a browser:
//   - every space of the site has one, and the map's own questions about roofs are answered for them;
//   - they are of several colours;
//   - nowhere on the site do more lamps ask to burn than a desk has slots for; a phone, with fewer, is never
//     left without a lamp the eye is standing in;
//   - nothing jumps: a lamp's level creeps, a slot is given up only by a lamp that has gone out, and at most one
//     depth picture is asked for in a frame.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY_SEEN, keyLuma, keyReach, keySheet, keySight, lightReaches, shaftOf } from '../../src/look/key.js';
import { KEYS, MIRROR, MIRRORS, mirrorAt } from '../../src/look/keys.js';
import { LIT, OUT, createSlots, keyGain, shortSighted, surveyKeys } from '../../src/look/slots.js';
import { buildSite, ZONE_NAMES } from '../../src/world/map.js';

/** how many key lights a desk can burn at once, and a phone: what src/look/index.js asks for */
const DESK = 6;
const HANDHELD = { slots: 4, reach: 0.6 };

const site = buildSite();
const grid = site.grid;
// light goes through a doorway whether its door is shut or not: the lamps are worked out with every door open
for (const door of grid.doors) door.open = 1;
const sheets = KEYS.map((key) => keySheet(grid, key));
const survey = surveyKeys(grid, KEYS, sheets);
const cells = [];
for (let z = 0; z < grid.h; z++) for (let x = 0; x < grid.w; x++) if (grid.walkable(x, z)) cells.push([x, z]);
const zoneOf = (x, z) => grid.zone[z * grid.w + x];
const gainsAt = (x, z, list = survey) => list.map((s) => keyGain(s, grid, x + 0.5, z + 0.5, zoneOf(x, z)));

test('every space of the site has a strong light: a quarter of its floor or more is in one', () => {
  const zones = new Map();
  for (const [x, z] of cells) {
    const i = z * grid.w + x;
    const s = zones.get(grid.zone[i]) || { cells: 0, reached: 0 };
    s.cells++;
    let sum = 0;
    for (const sheet of sheets) sum += sheet[i];
    if (sum > LIT) s.reached++;
    zones.set(grid.zone[i], s);
  }
  assert.equal(zones.size, ZONE_NAMES.length, 'a zone of the map has no floor');
  for (const [id, s] of zones)
    assert.ok(
      s.reached >= s.cells * 0.25,
      `${ZONE_NAMES[id]}: ${s.reached} of ${s.cells} cells are reached by a key light`,
    );
  // and no lamp is a dud: each lights a patch of floor somewhere
  survey.forEach((s, k) => assert.ok(s.lit >= 20, `${KEYS[k].name} shines on ${s.lit} cells`));
});

test('a lamp is where it can hang: in the open, under the roof of its room — and its name is its own', () => {
  assert.equal(new Set(KEYS.map((key) => key.name)).size, KEYS.length);
  for (const key of KEYS) {
    assert.ok(['flood', 'work', 'moon'].includes(key.kind), `${key.name}: kind ${key.kind}`);
    assert.ok(key.inner > 0 && key.inner < key.outer && key.outer <= 70, `${key.name}: beam ${key.inner}–${key.outer}`);
    assert.ok(key.range >= 8 && key.range <= 90, `${key.name}: reach ${key.range}`);
    if (key.sky) continue;
    const x = Math.floor(key.x);
    const z = Math.floor(key.z);
    assert.ok(grid.inside(x, z), `${key.name} is off the map`);
    const kind = grid.kind[z * grid.w + x];
    assert.ok(kind !== 2 && kind !== 5, `${key.name} hangs inside a wall or the rock, at (${key.x}, ${key.z})`);
    const ceil = grid.ceil[z * grid.w + x];
    if (ceil > 0) assert.ok(key.y < ceil, `${key.name} hangs at ${key.y} m, above its room's ceiling (${ceil} m)`);
  }
});

test('the lamps are of more than one colour: cold floods, a blue moon, sodium, green-white bays, red', () => {
  const tint = ({ r, g, b }) => {
    if (b / r >= 1.8) return 'moon';
    if (r / b >= 4) return 'red';
    if (r / b >= 2) return 'sodium';
    if (g > r * 1.08 && g > b * 1.05) return 'bay';
    if (b / r >= 1.05) return 'cold';
    return 'warm';
  };
  const tints = new Set(KEYS.map(tint));
  for (const wanted of ['cold', 'moon', 'sodium', 'bay', 'red'])
    assert.ok(tints.has(wanted), `no lamp is ${wanted}: ${[...tints]}`);
  // and none is so bright or so dim that it is another kind of thing (a lamp post gives a surface about 1.7)
  for (const key of KEYS) {
    const luma = keyLuma(key);
    assert.ok(luma >= 0.6 && luma <= 4.2, `${key.name}: ${luma.toFixed(2)}`);
  }
});

test('light and roofs: what stops a lamp’s light is asked of the map as light needs it asked', () => {
  const byName = (name) => KEYS.find((key) => key.name === name);
  const sees = (key, x, z, y = 1.3) => keySight(grid, key, x, y, z);
  const flood = byName('yard flood, south');
  // the lobby is under a built ceiling, behind the building's wall: a flood nine metres up in the cavern shines
  // into it through its doorway and nowhere else — and with the door shut, not at all
  const lobby = cells.filter(([x, z]) => ZONE_NAMES[zoneOf(x, z)] === 'Lobby');
  const reached = () => lobby.filter(([x, z]) => sees(flood, x + 0.5, z + 0.5));
  const throughDoor = reached();
  assert.ok(lobby.length > 50 && throughDoor.length > 0 && throughDoor.length < lobby.length * 0.15);
  const door = grid.doors.find((d) => d.z0 === 54 && d.x0 === 40);
  assert.ok(
    throughDoor.every(([x, z]) => Math.hypot(x - door.x, z - door.z) < 6),
    'light got in elsewhere',
  );
  door.open = 0;
  assert.deepEqual(reached(), []);
  door.open = 1;
  // …but a lamp that hangs higher than a room's ceiling does shine in under it from the side, where the room
  // is open: the drone bay is roofed at five metres and open to the north passage along its wire. (As first
  // written, "a lamp above a ceiling lights nothing under it" — and the picture disagreed at forty-two points.)
  const passage = byName('north passage, east');
  assert.ok(passage.y > 5);
  const bay = cells.filter(([x, z]) => ZONE_NAMES[zoneOf(x, z)] === 'Drone bay' && sees(passage, x + 0.5, z + 0.5));
  assert.ok(bay.length >= 20, `${bay.length} cells of the drone bay are reached from the passage`);
  // a low building does not stop light that passes over its roof: the gatehouse is 4.2 m tall, the flood on
  // the portal hangs at nine, and the yard beyond the gatehouse is lit by it. (The map's own ray — a round's —
  // stopped at the gatehouse's ceiling from above: 137 points disagreed with the picture.)
  const portal = byName('yard flood, portal');
  assert.equal(sees(portal, 87.5, 74.5), true, 'beyond the gatehouse');
  assert.equal(sees(portal, 73.5, 79.5), false, 'inside the gatehouse, under its roof');
  // the moon hangs outside the map: the forecourt sees it, the cavern does not — the rock is over it
  const moon = byName('the moon, on the forecourt');
  assert.equal(moon.sky, true);
  assert.equal(sees(moon, 64.5, 93.5), true, 'the middle of the forecourt');
  assert.equal(sees(moon, 40.5, 70.5), false, 'in the cavern');
  assert.equal(sees(moon, 30.5, 30.5), false, 'in the cavern, far side');
  // its light does not fade on the way: both ends of the forecourt get the same
  assert.equal(moon.even, true);
  assert.equal(keyReach(moon, 64.5, 0, 92.5), 1);
  assert.ok(keyReach(moon, 60.5, 0, 93.5) > 0.9);
  // the shaft's light comes down the shaft: on the pad, yes; a few metres to one side, under rock, no
  const shaft = byName('the moon, down the shaft');
  assert.equal(sees(shaft, 106.5, 34.5), true, 'on the pad');
  assert.equal(sees(shaft, 106.5, 22.5), false, 'twelve metres north of the pad');
  assert.equal(sees(shaft, 101.5, 34.5), false, 'at the cavern’s west wall');
  // a thing that stands in the way stops it by its box, or — asked finely — by its shape: a point behind a
  // container is in the south flood's shadow either way
  const behind = cells.find(
    ([x, z]) =>
      z < 62 &&
      z > 54 &&
      x > 20 &&
      x < 45 &&
      keyReach(flood, x + 0.5, 0.1, z + 0.5) > 0.3 &&
      !sees(flood, x + 0.5, z + 0.5, 0.1),
  );
  assert.ok(behind, 'nothing in the yard throws a shadow');
  assert.equal(lightReaches(grid, flood, behind[0] + 0.5, 0.1, behind[1] + 0.5, true), false);
  // the sheet a lamp gives the game is its reach where it can be seen, weighed as the game weighs light
  const k = KEYS.indexOf(flood);
  const at = 62 * grid.w + 35;
  assert.ok(Math.abs(sheets[k][at] - keyLuma(flood) * KEY_SEEN * keyReach(flood, 35.5, 1.3, 62.5)) < 1e-6);
});

// 16 November 2026, the plan's fifth step: "lights that shine". The air under a lamp is not empty — there is dust
// and damp in a mountain — and a strong lamp lights it: a cone of lit air from the lamp along its beam. Where
// that cone begins and ends is worked out here (look/key.js shaftOf); look/keylight.js makes it.
test('the lit air under a lamp: from the lamp, along its beam, ended before the floor — and the moon’s comes down the shaft', () => {
  let made = 0;
  for (const key of KEYS) {
    const shaft = shaftOf(key);
    const length = Math.hypot(key.tx - key.x, key.ty - key.y, key.tz - key.z);
    const dir = [(key.tx - key.x) / length, (key.ty - key.y) / length, (key.tz - key.z) / length];
    if (key.sky) {
      assert.equal(shaft, null, `${key.name}: under the open sky there is no dark air for a beam to show in`);
      continue;
    }
    assert.ok(shaft, `${key.name} lights no air`);
    made++;
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(shaft.dir[k] - dir[k]) < 1e-9, `${key.name}: not along its beam`);
    assert.ok(shaft.to > shaft.from && shaft.from >= 0, `${key.name}: from ${shaft.from} to ${shaft.to}`);
    // it ends in the air, or on the floor it is aimed at — never under it
    const endY = key.y + dir[1] * shaft.to;
    assert.ok(endY >= 0, `${key.name}: its lit air goes ${-endY} m into the floor`);
    assert.ok(shaft.to <= key.range, `${key.name}: lit air beyond its reach`);
    const wide = shaft.radius(shaft.to);
    assert.ok(wide >= shaft.radius(shaft.from) && wide <= 9, `${key.name}: ${wide} m across at its end`);
    assert.ok(shaft.strength > 0 && shaft.strength <= 1 && shaft.keeps >= 0 && shaft.keeps < 1);
    if (key.kind === 'moon') {
      // the moon's beam is lit air only where there is a cavern round it: from its roof down to the floor —
      // and no wider than the shaft it comes down (seven metres across)
      assert.ok(wide >= 2.5 && wide <= 3.5, `the moon's beam is ${wide * 2} m across at the floor`);
      assert.ok(Math.abs(endY) < 0.2, `the moon's beam ends ${endY} m off the floor`);
      const startY = key.y + dir[1] * shaft.from;
      assert.ok(startY >= 9 && startY <= 14, `the moon's beam is lit from ${startY} m up`);
      assert.ok(shaft.keeps >= 0.25, 'the moon’s beam reaches the floor: it does not fade out on the way');
    } else {
      assert.ok(shaft.from <= 0.5, `${key.name}: its lit air begins ${shaft.from} m from it`);
      assert.ok(shaft.to >= 1.5 && shaft.to <= 16, `${key.name}: ${shaft.to} m of lit air`);
      assert.equal(shaft.keeps, 0, `${key.name}: its lit air must be gone by its end, which is in mid-air`);
    }
  }
  assert.equal(made, KEYS.length - 1);
});

test('a place is captured for every space: from a point that is in it, in the open, under its roof', () => {
  assert.equal(new Set(MIRRORS.map((m) => m.name)).size, MIRRORS.length);
  assert.equal(MIRROR, MIRRORS[0], 'the slice’s capture is no longer the first');
  for (const m of MIRRORS) {
    const [x0, z0, x1, z1] = m.box;
    assert.ok(x1 > x0 && z1 > z0, `${m.name}: its box is inside out`);
    assert.ok(m.x > x0 && m.x < x1 && m.z > z0 && m.z < z1, `${m.name} is captured from outside its own box`);
    // …and its own box is the one a point there is in: no other, smaller, holds it
    assert.equal(mirrorAt(m.x, m.z), m, `${m.name}: where it is captured from is in another place's box`);
    const i = Math.floor(m.z) * grid.w + Math.floor(m.x);
    assert.ok(grid.kind[i] !== 2 && grid.kind[i] !== 5, `${m.name} is captured from inside a wall or the rock`);
    assert.ok(grid.block[i] === 0, `${m.name} is captured from inside something that stands there`);
    if (grid.ceil[i] > 0) assert.ok(m.y < grid.ceil[i] - 0.2, `${m.name} is captured from above its ceiling`);
    assert.ok(m.y >= 1.4 && m.y < m.top, `${m.name}: captured from ${m.y} m up, in a box ${m.top} m high`);
    assert.ok(m.fade > 0 && m.fade <= 2);
  }
  // every space somebody can walk into is in a box: all of its floor, bar the odd cell in a doorway
  const zones = new Map();
  for (const [x, z] of cells) {
    const zone = zones.get(zoneOf(x, z)) || { cells: 0, held: 0 };
    zone.cells++;
    if (mirrorAt(x + 0.5, z + 0.5)) zone.held++;
    zones.set(zoneOf(x, z), zone);
  }
  for (const [id, zone] of zones) {
    if (ZONE_NAMES[id] === 'Drone bay') continue;
    assert.ok(zone.held >= zone.cells * 0.97, `${ZONE_NAMES[id]}: ${zone.held} of ${zone.cells} cells are in a box`);
  }
  // a shed is inside the strip of cavern it stands in: in the shed it is the shed's capture that is mirrored
  assert.equal(mirrorAt(23.5, 32.5).name, 'generator shed');
  assert.equal(mirrorAt(21.5, 42.5).name, 'west strip');
  assert.equal(mirrorAt(60.5, 8.5), null, 'the drone bay has a capture');
});

test('nowhere on the site do more lamps ask to burn than a desk has slots for', () => {
  let worst = 0;
  for (const [x, z] of cells) {
    const asking = gainsAt(x, z).filter((gain) => gain > 0).length;
    if (asking > worst) worst = asking;
    assert.ok(asking <= DESK, `${asking} lamps ask to burn at (${x}, ${z})`);
  }
  assert.ok(worst >= 4, 'the test is not asking anything: no place has four');
  // and wherever a lamp shines at all, standing in it, it asks to: nobody stands in a key light that is not drawn
  survey.forEach((s, k) => {
    for (let n = 0; n < s.samples.length; n += 2) {
      const x = Math.floor(s.samples[n]);
      const z = Math.floor(s.samples[n + 1]);
      assert.ok(gainsAt(x, z)[k] >= 0.99, `${KEYS[k].name} does not burn for an eye standing in it at (${x}, ${z})`);
    }
  });
});

test('a phone has four slots and looks less far: a lamp left without one is never one the eye stands near', () => {
  const near = shortSighted(survey, HANDHELD.reach);
  let over = 0;
  let most = 0;
  for (const [x, z] of cells) {
    const gains = gainsAt(x, z, near).sort((a, b) => b - a);
    const left = gains[HANDHELD.slots] || 0;
    if (left > 0) over++;
    most = Math.max(most, left);
    assert.ok(left <= 0.5, `at (${x}, ${z}) a lamp at ${left.toFixed(2)} of its light has no slot`);
  }
  assert.ok(over < cells.length * 0.04, `${over} cells of ${cells.length} ask for more than four (most: ${most})`);
  // a lamp the eye stands IN always has its slot, short sight or not
  near.forEach((s, k) => {
    for (let n = 0; n < s.samples.length; n += 2) {
      const x = Math.floor(s.samples[n]);
      const z = Math.floor(s.samples[n + 1]);
      const gains = gainsAt(x, z, near);
      const rank = gains.filter((gain) => gain > gains[k]).length;
      assert.ok(gains[k] >= 0.99 && rank < HANDHELD.slots, `${KEYS[k].name} at (${x}, ${z}): rank ${rank}`);
    }
  });
});

test('the slots: never more holders than slots, and a holder is not put out by one that is only a little ahead', () => {
  const slots = createSlots(2);
  // three lamps; the first two burn
  assert.deepEqual(slots.update([1, 0.6, 0], 0.016, true), [0, 1]);
  assert.deepEqual(Array.from(slots.slotOf), [0, 1, -1]);
  assert.deepEqual(Array.from(slots.level), [1, Math.fround(0.6), 0]);
  // the third comes up to just past the second: the second keeps its slot
  for (let n = 0; n < 60; n++) slots.update([1, 0.6, 0.7], 0.016);
  assert.deepEqual(Array.from(slots.slotOf), [0, 1, -1]);
  assert.equal(slots.level[2], 0);
  // well past it: the second creeps out, and only then is its slot handed on — dark, to be drawn first
  let handed = -1;
  for (let n = 0; n < 200 && handed < 0; n++) {
    const before = slots.level[1];
    const draw = slots.update([1, 0.6, 0.9], 0.016);
    assert.ok(before - slots.level[1] <= 2.5 * 0.016 + 1e-6, 'a level jumped');
    if (slots.slotOf[2] >= 0) {
      handed = n;
      assert.ok(before <= OUT + 2.5 * 0.016, `the slot was taken from a lamp still at ${before}`);
      assert.deepEqual(draw, [1], 'the new holder’s depth picture was not asked for');
    } else assert.deepEqual(draw, []);
  }
  assert.ok(handed > 5, 'the slot changed hands at once');
  assert.deepEqual(Array.from(slots.slotOf), [0, -1, 1]);
  // and the newcomer creeps up from nothing
  const first = slots.level[2];
  assert.ok(first <= 2.5 * 0.016 + 1e-6, `it started at ${first}`);
  for (let n = 0; n < 60; n++) slots.update([1, 0.6, 0.9], 0.016);
  assert.ok(Math.abs(slots.level[2] - 0.9) < 1e-6);
  assert.ok(Array.from(slots.holder).filter((h) => h >= 0).length <= 2);
});

test('the slots: one depth picture a frame — unless the eye has jumped, and then all at once and nothing creeps', () => {
  const slots = createSlots(3);
  // four lamps want to burn from the first frame: three get slots, one picture is asked for each frame
  const asked = [];
  for (let n = 0; n < 6; n++) asked.push(slots.update([0.9, 0.8, 0.7, 0.6], 0.016).slice());
  assert.deepEqual(asked, [[0], [1], [2], [], [], []]);
  assert.equal(slots.slotOf[3], -1);
  // nothing is drawn with a slot before its picture is: a lamp's level is nothing until then
  const fresh = createSlots(3);
  fresh.update([0.9, 0.8, 0.7, 0.6], 0.016);
  assert.ok(fresh.level[0] > 0 && fresh.level[1] === 0 && fresh.level[2] === 0);
  // the pictures go stale (something that never moves has moved): each is drawn again, one a frame, and is used
  // meanwhile — no level drops
  for (let n = 0; n < 60; n++) slots.update([0.9, 0.8, 0.7, 0.6], 0.016);
  assert.deepEqual(Array.from(slots.level), [0.9, 0.8, 0.7, 0].map(Math.fround));
  slots.dirty();
  const again = [];
  for (let n = 0; n < 4; n++) {
    again.push(slots.update([0.9, 0.8, 0.7, 0.6], 0.016).slice());
    assert.deepEqual(Array.from(slots.level), [0.9, 0.8, 0.7, 0].map(Math.fround));
  }
  assert.deepEqual(again, [[0], [1], [2], []]);
  // the eye jumps to another part of the site: other lamps, at once, at their full gain
  const jumped = slots.update([0, 0, 0.5, 1], 0.016, true).slice();
  assert.deepEqual(Array.from(slots.level), [0, 0, 0.5, 1]);
  assert.equal(slots.slotOf[0], -1);
  assert.equal(slots.slotOf[1], -1);
  assert.ok(jumped.includes(slots.slotOf[3]), 'the lamp that is new to its slot was not drawn');
  assert.ok(!jumped.includes(slots.slotOf[2]), 'a lamp that kept its slot was drawn again for nothing');
});

test('walking the site: every lamp the eye comes to is burning, none jumps, and never two pictures in a frame', () => {
  // a walk from the adit's mouth that goes wherever it has not been, and back along its own trail, until there
  // is nowhere left to go: every cell that can be walked to, at a run
  const slots = createSlots(DESK);
  const dt = 1 / 60;
  const seen = new Set();
  let [x, z] = [Math.floor(site.start.x), Math.floor(site.start.z)];
  const trail = [];
  slots.update(gainsAt(x, z), dt, true);
  let lit = 0;
  for (let step = 0; step < 40000; step++) {
    seen.add(z * grid.w + x);
    // a neighbour not yet walked on, else back along the trail
    const next = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]
      .map(([dx, dz]) => [x + dx, z + dz])
      .find(([nx, nz]) => grid.walkable(nx, nz) && !seen.has(nz * grid.w + nx));
    if (next) {
      trail.push([x, z]);
      [x, z] = next;
    } else if (trail.length) [x, z] = trail.pop();
    else break;
    const gains = gainsAt(x, z);
    // a cell takes a twelfth of a second at a run: five frames
    for (let frame = 0; frame < 5; frame++) {
      const before = Float32Array.from(slots.level);
      const draw = slots.update(gains, dt);
      assert.ok(draw.length <= 1, `${draw.length} depth pictures in one frame at (${x}, ${z})`);
      for (let k = 0; k < gains.length; k++)
        assert.ok(Math.abs(slots.level[k] - before[k]) <= 2.5 * dt + 1e-6, `${KEYS[k].name} jumped at (${x}, ${z})`);
      assert.ok(Array.from(slots.holder).filter((h) => h >= 0).length <= DESK);
    }
    // a lamp the eye is well inside is being drawn by the time the cell has been crossed
    gains.forEach((gain, k) => {
      if (gain < 0.9) return;
      lit++;
      assert.ok(slots.level[k] > 0, `${KEYS[k].name} is dark at (${x}, ${z}) with the eye in it`);
    });
  }
  // all of it but the drone bay, which is behind a ledge: nothing that walks gets in there
  const onFoot = cells.filter(([cx, cz]) => ZONE_NAMES[zoneOf(cx, cz)] !== 'Drone bay').length;
  assert.ok(seen.size >= onFoot * 0.99, `the walk covered ${seen.size} cells of ${onFoot}`);
  assert.ok(lit > 3000, 'the walk met no lamps to speak of');
});
