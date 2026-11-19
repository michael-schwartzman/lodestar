// Contract lock: lamps that can be put out (src/world/lamps.js). Pure — no three.js, no browser.
//
// Decision of 16 November 2026 — the owner, having played the second look: "i want to have the ability to shoot at
// the light to turn it off and turn on night goggles to use them also emp needs to turn of the light in a room".
// Until then the site's light was worked out once and nothing in the game could change it.
//
// What was decided, and is held here (nobody was asked; each is one number or one line to change):
//   - a lamp that is SHOT is out for the rest of the mission. A retry from a checkpoint brings back what was
//     shot after it;
//   - an EMP puts out every lamp of the ROOM it goes off in — in the open cavern, every lamp within fourteen
//     metres — for twenty seconds, and then they come back by themselves;
//   - the moon cannot be put out.
// What a lamp going out DOES to the picture and to how well a body is seen is held in a browser
// (test/smoke.test.mjs, test/second/look.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARMS } from '../../src/arms.js';
import { createLamps, lampsOf, rayBox } from '../../src/world/lamps.js';
import { KIND } from '../../src/world/grid.js';
import { buildSite, ZONE } from '../../src/world/map.js';
import { keyLampsOf } from '../../src/look/key.js';
import { KEYS, MIRRORS, mirrorAt, mirrorReached } from '../../src/look/keys.js';
import { createSlots, surveyKeys } from '../../src/look/slots.js';

/** four lamps in a row, a metre apart, each with a box 20 cm across; the last cannot be put out */
const row = () =>
  createLamps(
    [0, 1, 2, 3].map((n) => ({
      x: n,
      y: 3,
      z: 0,
      zone: 1,
      room: false,
      box: [n - 0.1, 2.9, -0.1, n + 0.1, 3.1, 0.1],
      fixed: n === 3,
    })),
  );
const outOf = (lamps) => Array.from({ length: lamps.count }, (_, i) => lamps.isOut(i));

test('a lamp that is shot is out, and stays out: nothing but a new mission or an older checkpoint lights it again', () => {
  const lamps = row();
  assert.deepEqual(outOf(lamps), [false, false, false, false]);
  assert.deepEqual(lamps.shoot(1), [1], 'the lamp that went dark is named, so that the level can be told');
  assert.deepEqual(outOf(lamps), [false, true, false, false]);
  // shot again it is still out, and nothing has changed
  assert.deepEqual(lamps.shoot(1), []);
  // time does not mend it
  assert.deepEqual(lamps.update(3600), []);
  assert.equal(lamps.isOut(1), true);
  // the moon cannot be shot out
  assert.deepEqual(lamps.shoot(3), []);
  assert.equal(lamps.isOut(3), false);
});

test('lamps that an EMP trips are out for as long as it says, and come back by themselves — all at once', () => {
  const lamps = row();
  assert.deepEqual(lamps.trip([0, 1, 3], 20), [0, 1], 'the moon is not tripped');
  assert.deepEqual(outOf(lamps), [true, true, false, false]);
  assert.deepEqual(lamps.update(19.9), [], 'not yet');
  assert.equal(lamps.isOut(0), true);
  assert.deepEqual(lamps.update(0.2), [0, 1], 'the ones that came back are named');
  assert.deepEqual(outOf(lamps), [false, false, false, false]);
  // …and are not named a second time
  assert.deepEqual(lamps.update(60), []);
});

test('tripped twice, a lamp is out until the later of the two; shot while it is tripped, it never comes back', () => {
  const lamps = row();
  lamps.trip([0, 1], 20);
  lamps.update(15);
  // a second EMP, fifteen seconds after the first: lamp 0 again, lamp 2 for the first time
  assert.deepEqual(lamps.trip([0, 2], 20), [2], 'lamp 0 was out already: only lamp 2 changed');
  assert.deepEqual(lamps.update(5.1), [1], 'the first EMP is over for lamp 1 alone');
  assert.deepEqual(outOf(lamps), [true, false, true, false]);
  // lamp 2 is shot in the dark: the fitting is still there to be hit
  assert.deepEqual(lamps.shoot(2), [], 'it was dark already, so nothing changes in the picture');
  assert.deepEqual(lamps.update(20), [0], 'lamp 0 comes back; lamp 2, shot, does not');
  assert.deepEqual(outOf(lamps), [false, false, true, false]);
  // a shorter trip does not cut a longer one short
  lamps.trip([0], 20);
  lamps.trip([0], 2);
  assert.deepEqual(lamps.update(10), []);
  assert.equal(lamps.isOut(0), true);
});

test('what is kept at a checkpoint is what was shot; a retry puts the lamps back as they were then, and says which changed', () => {
  const lamps = row();
  lamps.shoot(0);
  const kept = lamps.save();
  assert.deepEqual(kept, [0]);
  // after the checkpoint: another lamp shot, and an EMP
  lamps.shoot(1);
  lamps.trip([2], 20);
  assert.deepEqual(outOf(lamps), [true, true, true, false]);
  assert.deepEqual(lamps.load(kept).sort(), [1, 2], 'what was shot or tripped after the checkpoint is alight again');
  assert.deepEqual(outOf(lamps), [true, false, false, false]);
  // what was saved is a copy: it is not changed by what happens next
  lamps.shoot(2);
  assert.deepEqual(kept, [0]);
  // a new mission: every lamp alight, and the trip that was running forgotten
  lamps.trip([1], 20);
  assert.deepEqual(lamps.reset().sort(), [0, 1, 2]);
  assert.deepEqual(outOf(lamps), [false, false, false, false]);
  assert.deepEqual(lamps.update(100), [], 'a trip from before the reset does not light anything later');
  // rubbish in what was saved (a lamp that is not there, the moon) is left out, not thrown
  assert.deepEqual(lamps.load([99, -1, 3, 1]), [1]);
});

test('a round meets a lamp where its line enters the lamp’s box — the nearest one, before whatever it would have hit', () => {
  // a box, a line into it, a line past it, a line that starts inside it
  assert.equal(rayBox([0, 0, 0, 1, 1, 1], -1, 0.5, 0.5, 1, 0, 0, 10), 1);
  assert.equal(rayBox([0, 0, 0, 1, 1, 1], -1, 0.5, 0.5, 1, 0, 0, 0.9), -1, 'the round stops short of it');
  assert.equal(rayBox([0, 0, 0, 1, 1, 1], -1, 1.5, 0.5, 1, 0, 0, 10), -1, 'it passes over it');
  assert.equal(rayBox([0, 0, 0, 1, 1, 1], -1, 0.5, 0.5, -1, 0, 0, 10), -1, 'it flies the other way');
  assert.equal(rayBox([0, 0, 0, 1, 1, 1], 0.5, 0.5, 0.5, 0, 1, 0, 10), 0, 'fired from inside it');
  // a line along one of its faces' directions, exactly: no division by nothing
  assert.equal(rayBox([0, 0, 0, 1, 1, 1], 0.5, -2, 0.5, 0, 1, 0, 10), 2);

  const lamps = row();
  // along the row from the west, at the lamps' own height: the first one is met, 0.9 m off
  const first = lamps.hit(-1, 3, 0, 1, 0, 0, 50);
  assert.equal(first.i, 0);
  assert.ok(Math.abs(first.t - 0.9) < 1e-9, `met at ${first.t}`);
  // a wall half a metre off stops the round before it gets there
  assert.equal(lamps.hit(-1, 3, 0, 1, 0, 0, 0.5), null);
  // a lamp that has been shot is glass on the floor: the round goes on to the next
  lamps.shoot(0);
  assert.equal(lamps.hit(-1, 3, 0, 1, 0, 0, 50).i, 1);
  // one that an EMP has tripped is dark but whole: it can still be shot
  lamps.trip([1], 20);
  assert.equal(lamps.hit(-1, 3, 0, 1, 0, 0, 50).i, 1);
  // under them, nothing
  assert.equal(lamps.hit(-1, 1.6, 0, 1, 0, 0, 50), null);
  // a lamp with no box of its own (nothing of it is drawn) cannot be hit; the moon cannot either
  const bare = createLamps([{ x: 0, y: 3, z: 0, zone: 1, room: false, box: null }]);
  assert.equal(bare.hit(-1, 3, 0, 1, 0, 0, 50), null);
  assert.equal(lamps.hit(2.5, 3, 0, 1, 0, 0, 50), null, 'the moon’s box is not asked');
});

// ---------- the real site ----------

const site = buildSite();
const grid = site.grid;
const all = lampsOf(site.lamps, grid);
const lamps = createLamps(all);
const DARK = ARMS.grenades.dark;

test('the numbers: twenty seconds of dark, fourteen metres in the open, and a broken lamp is heard seven metres off', () => {
  assert.deepEqual(DARK, { seconds: 20, radius: 14 });
  // longer than the machines it stops are stopped for: the dark is what is left when they start again
  assert.ok(DARK.seconds > ARMS.grenades.stun * 2);
  // further than it stops machines: a lamp is a simpler thing than a machine
  assert.ok(DARK.radius > ARMS.grenades.radius);
  assert.deepEqual(ARMS.lamp, { noise: 7, proud: 0.15 });
  // heard less far than a round that hits a wall is not (5 m) … and less far than the EMP (10 m)
  assert.ok(ARMS.lamp.noise > 5 && ARMS.lamp.noise < ARMS.grenades.noise);
  // a fitting on a wall is looked for a hand's breadth past where the wall stops the round — and no further: a
  // wall is a metre thick, and a lamp on its far side must not be broken through it
  assert.ok(ARMS.lamp.proud > 0 && ARMS.lamp.proud <= 0.2);
});

test('every lamp of the site knows where it hangs: over open ground, in a zone, under a roof or not — and only the sky’s is fixed', () => {
  assert.equal(all.length, site.lamps.length);
  for (const [i, lamp] of all.entries()) {
    const cell = grid.index(Math.floor(lamp.x), Math.floor(lamp.z));
    assert.ok(
      [KIND.GROUND, KIND.FLOOR, KIND.DOOR].includes(grid.kind[cell]),
      `lamp ${i} (${site.lamps[i].kind}) at (${lamp.x}, ${lamp.z}) hangs over a ${grid.kind[cell]}`,
    );
    assert.equal(lamp.zone, grid.zone[cell]);
    assert.equal(lamp.room, grid.ceil[cell] > 0);
    assert.equal(lamp.fixed, site.lamps[i].kind === 'sky', `lamp ${i} is a ${site.lamps[i].kind}`);
  }
});

test('an EMP in a room puts out that room’s lamps, all of them, and no lamp of any other room', () => {
  // the control room, the switchgear room, the cascade hall: a point in the middle of each
  for (const [zone, name] of [
    [ZONE.CONTROL, 'the control room'],
    [ZONE.POWER, 'the switchgear room'],
    [ZONE.HALL, 'the cascade hall'],
    [ZONE.CORRIDOR, 'the corridor'],
  ]) {
    let at = null;
    let cells = 0;
    let sx = 0;
    let sz = 0;
    for (let z = 0; z < grid.h; z++)
      for (let x = 0; x < grid.w; x++)
        if (grid.zone[grid.index(x, z)] === zone && grid.walkable(x, z)) {
          cells++;
          sx += x;
          sz += z;
          at = at || [x, z];
        }
    // the walkable cell nearest the middle of the zone
    let best = Infinity;
    for (let z = 0; z < grid.h; z++)
      for (let x = 0; x < grid.w; x++)
        if (grid.zone[grid.index(x, z)] === zone && grid.walkable(x, z)) {
          const d = Math.hypot(x - sx / cells, z - sz / cells);
          if (d < best) {
            best = d;
            at = [x, z];
          }
        }
    const reached = lamps.reach(at[0] + 0.5, at[1] + 0.5, grid, DARK);
    const own = all.map((lamp, i) => (lamp.zone === zone && !lamp.fixed ? i : -1)).filter((i) => i >= 0);
    assert.ok(own.length >= 1, `${name} has ${own.length} lamps`);
    assert.deepEqual(
      reached.slice().sort((a, b) => a - b),
      own,
      `${name}: not its own lamps, all of them`,
    );
  }
});

test('an EMP in the open cavern puts out the lamps within fourteen metres of it that hang in the open — not those of a room behind a wall', () => {
  // by the first lamp post of the yard
  const post = all.findIndex((lamp, i) => site.lamps[i].kind === 'post');
  const { x, z } = all[post];
  const reached = lamps.reach(x, z, grid, DARK);
  assert.ok(reached.includes(post), 'the post it went off under is still alight');
  assert.ok(reached.length >= 2, `it put out ${reached.length} lamps`);
  for (const i of reached) {
    assert.equal(all[i].room, false, `lamp ${i} hangs under a roof`);
    assert.ok(Math.hypot(all[i].x - x, all[i].z - z) <= DARK.radius + 1e-9);
    assert.equal(all[i].fixed, false);
  }
  // …and every lamp in the open within that distance is among them
  const near = all
    .map((lamp, i) => (!lamp.room && !lamp.fixed && Math.hypot(lamp.x - x, lamp.z - z) <= DARK.radius ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(
    reached.slice().sort((a, b) => a - b),
    near,
  );
  // off the map, or in solid rock, it puts out nothing and throws nothing
  assert.deepEqual(lamps.reach(-5, -5, grid, DARK), []);
  assert.deepEqual(lamps.reach(0.5, 0.5, grid, DARK), []);
});

// ---------- the second look's key lights are lamps too ----------
// They are the strong lamps of each space (src/look/keys.js): a room whose own lamps went out and whose key light
// did not would be as bright as before. So they are in the same list, after the site's own, and the same rules
// put them out.
const keyLamps = keyLampsOf(KEYS, grid);
const keyNamed = (name) => KEYS.findIndex((key) => key.name === name);

test('a key light is the lamp of the space it lights: the first open ground along its beam — and the moon is no lamp', () => {
  assert.equal(keyLamps.length, KEYS.length);
  // light goes through a doorway whether its door is shut or not
  for (const door of grid.doors) door.open = 1;
  const survey = surveyKeys(grid, KEYS);
  for (const [k, lamp] of keyLamps.entries()) {
    const key = KEYS[k];
    assert.deepEqual([lamp.x, lamp.y, lamp.z], [key.x, key.y, key.z], `${key.name} is where it hangs`);
    assert.equal(lamp.fixed, key.kind === 'moon', `${key.name}: fixed`);
    assert.equal(lamp.box, null, 'its box is whoever draws it’s to give');
    if (lamp.fixed) continue;
    assert.ok(survey[k].zones.has(lamp.zone), `${key.name} is counted to a zone it does not shine in (${lamp.zone})`);
  }
  for (const [name, zone, room] of [
    ['control room', ZONE.CONTROL, true],
    ['cascade hall, south-west', ZONE.HALL, true],
    ['cascade hall, north-east', ZONE.HALL, true],
    ['switchgear', ZONE.POWER, true],
    ['corridor, west', ZONE.CORRIDOR, true],
    ['tunnel lamp', ZONE.TUNNEL, true],
    ['adit lamp', ZONE.ADIT, true],
    ['drone bay', ZONE.BAY, true],
    ['yard flood, south', ZONE.YARD, false],
    ['shaft cavern flood', ZONE.STACK, false],
  ]) {
    const lamp = keyLamps[keyNamed(name)];
    assert.deepEqual([lamp.zone, lamp.room], [zone, room], name);
  }
  assert.equal(
    keyLamps.filter((lamp) => lamp.fixed).length,
    2,
    'the moon down the shaft, and the moon on the forecourt',
  );
});

test('an EMP in a room puts out that room’s key light with its own lamps; in the open, the floods within fourteen metres', () => {
  const both = createLamps([...all, ...keyLamps]);
  const first = all.length;
  // the firing point, in the control room
  const inRoom = both.reach(site.firing.x, site.firing.z, grid, DARK);
  assert.ok(inRoom.includes(first + keyNamed('control room')), 'the control room’s key light is still alight');
  for (const i of inRoom) assert.equal(both.list[i].zone, ZONE.CONTROL);
  assert.deepEqual(
    inRoom.filter((i) => i >= first).map((i) => KEYS[i - first].name),
    ['control room'],
  );
  // under the south flood of the yard: it, and no key light of any room
  const flood = KEYS[keyNamed('yard flood, south')];
  const open = both.reach(flood.x, flood.z - 2, grid, DARK);
  assert.ok(open.includes(first + keyNamed('yard flood, south')));
  for (const i of open) assert.equal(both.list[i].room, false);
  // and neither moon is ever among them
  for (const i of [...inRoom, ...open]) assert.equal(both.list[i].fixed, false);
});

test('the slots: a key light that is cut is dark at once and its slot is free — and no other lamp jumps', () => {
  const slots = createSlots(2);
  for (let n = 0; n < 80; n++) slots.update([1, 0.6, 0.5], 0.016);
  assert.deepEqual(Array.from(slots.level), [1, 0.6, 0].map(Math.fround));
  const held = slots.slotOf[0];
  slots.cut(0);
  assert.equal(slots.level[0], 0, 'a lamp that is shot does not fade');
  assert.equal(slots.slotOf[0], -1);
  assert.equal(slots.holder[held], -1);
  assert.equal(slots.level[1], Math.fround(0.6), 'the lamp beside it jumped');
  // the lamp that had no slot takes the one left free: dark until its picture has been drawn, then it creeps up
  const asked = slots.update([0, 0.6, 0.5], 0.016).slice();
  assert.deepEqual(asked, [held], 'the picture of the slot’s new holder is asked for');
  assert.equal(slots.slotOf[2], held);
  assert.ok(slots.level[2] <= 2.5 * 0.016 + 1e-6, `it started at ${slots.level[2]}`);
  assert.equal(slots.level[0], 0);
  // cutting a lamp that holds nothing, or that is not there, does nothing
  slots.cut(0);
  slots.cut(7);
  slots.cut(-1);
  assert.equal(slots.level[1], Math.fround(0.6));
});

test('a lamp that goes out makes stale only the captured places its light reaches', () => {
  // What metal mirrors is a capture of each place (look/keys.js MIRRORS), taken once and kept. A lamp going out
  // changes what is IN some of them — those its light reaches — and no others: a lamp shot in the control room
  // is no reason to capture the yard again the next time the eye is in it.
  all.forEach((lamp, i) => assert.equal(lamp.reach, site.lamps[i].radius, `lamp ${i} reaches as far as it lights`));
  keyLamps.forEach((lamp, k) => assert.equal(lamp.reach, KEYS[k].range, `${KEYS[k].name} reaches its range`));
  const reached = (lamp) => MIRRORS.filter((s) => mirrorReached(s, lamp.x, lamp.z, lamp.reach)).map((s) => s.name);
  const control = reached(keyLamps[keyNamed('control room')]);
  assert.ok(control.includes('control room'), `the control room's own lamp reaches ${control}`);
  for (const far of ['drainage adit', 'yard, west', 'tunnel and forecourt', 'generator shed', 'shaft cavern'])
    assert.ok(!control.includes(far), `the control room's lamp makes "${far}" stale`);
  assert.ok(control.length < MIRRORS.length / 2, `it reaches ${control.length} of ${MIRRORS.length} places`);
  // a lamp reaches the place it hangs in, however short its reach
  for (const [k, lamp] of keyLamps.entries()) {
    const own = mirrorAt(lamp.x, lamp.z);
    if (own) assert.ok(mirrorReached(own, lamp.x, lamp.z, 0.01), `${KEYS[k].name} does not reach ${own.name}`);
  }
  // …and not one that is further off than it reaches, by a hair
  const box = { box: [10, 10, 20, 20] };
  assert.equal(mirrorReached(box, 25, 15, 5.01), true);
  assert.equal(mirrorReached(box, 25, 15, 4.99), false);
  assert.equal(mirrorReached(box, 23, 24, 5.01), true, 'three across and four down from its corner is five away');
  assert.equal(mirrorReached(box, 23, 24, 4.99), false);
});
