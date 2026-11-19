// The room in the sound (src/wild/mix.js): which space a place is, what that space does to a sound, which sounds
// have a room at all, and how far away a sound dulls — with no browser in it.
// The wild build: docs/WILD.md, "The room in the sound".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPACES, cutAt, decayOf, impulse, sendOf, spaceOf } from '../../src/wild/mix.js';
import { ZONE_NAMES } from '../../src/world/map.js';

const RATE = 44100;

test('every place of the site is one of five spaces: under the sky, the cavern, a tunnel, a hall, a room', () => {
  assert.deepEqual(Object.keys(SPACES).sort(), ['cave', 'hall', 'open', 'room', 'tunnel']);
  const names = Object.values(ZONE_NAMES).filter(Boolean);
  assert.ok(names.length >= 15, `the site has ${names.length} named places`);
  for (const name of names) assert.ok(SPACES[spaceOf(name, false)], `${name} is no space`);
  assert.equal(spaceOf('Cascade hall', false), 'hall');
  assert.equal(spaceOf('Main cavern', false), 'cave');
  assert.equal(spaceOf('Shaft cavern', false), 'cave');
  assert.equal(spaceOf('Drainage adit', false), 'tunnel');
  assert.equal(spaceOf('Road tunnel', false), 'tunnel');
  assert.equal(spaceOf('Service corridor', false), 'room');
  assert.equal(spaceOf('Control room', false), 'room');
  // under the sky it is the open air, whatever the map calls the ground
  assert.equal(spaceOf('Forecourt', true), 'open');
  assert.equal(spaceOf('Main cavern', true), 'open');
  // a place the map has no name for is the rock it was cut from
  assert.equal(spaceOf(undefined, false), 'cave');
});

test('a space rings for as long as it is big: the cavern longest, then the hall, a tunnel, the open air, a room', () => {
  const rings = Object.fromEntries(Object.keys(SPACES).map((space) => [space, decayOf(impulse(space, RATE), RATE)]));
  for (const [space, seconds] of Object.entries(rings)) {
    const want = SPACES[space].decay;
    assert.ok(Math.abs(seconds - want) / want < 0.3, `${space} rings ${seconds.toFixed(2)} s, and was to ring ${want}`);
  }
  assert.ok(rings.cave > rings.hall && rings.hall > rings.tunnel, JSON.stringify(rings));
  assert.ok(rings.tunnel > rings.open && rings.open > rings.room, JSON.stringify(rings));
  assert.ok(rings.cave > 2.5 && rings.room < 0.8);
});

test('what a space does to a sound is the same every time, is finite, begins after the sound, and adds no more than the sound had', () => {
  for (const space of Object.keys(SPACES)) {
    const [left, right] = impulse(space, RATE);
    const again = impulse(space, RATE);
    assert.deepEqual(Array.from(left.subarray(0, 4000)), Array.from(again[0].subarray(0, 4000)), `${space} differs`);
    let energy = 0;
    let finite = true;
    let same = true;
    for (let i = 0; i < left.length; i++) {
      if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) finite = false;
      if (left[i] !== right[i]) same = false;
      energy += left[i] * left[i];
    }
    assert.ok(finite, `${space} has something in it that is not a number`);
    assert.equal(same, false, `${space}: the two ears hear the same thing — it has no width`);
    assert.ok(Math.abs(energy - 1) < 0.02, `${space} holds ${energy.toFixed(3)} of a sound's energy, not 1`);
    // nothing of it before the sound itself has been heard (the first reflection has a way to go)
    const before = Math.round(SPACES[space].pre * RATE) - 1;
    assert.ok(before > 100, `${space} has no gap before its first reflection`);
    for (let i = 0; i < before; i++) assert.equal(left[i], 0, `${space} answers ${i} samples in`);
  }
});

test('a tunnel flutters: its echoes come back at one spacing, again and again', () => {
  const [left] = impulse('tunnel', RATE);
  const gap = Math.round(SPACES.tunnel.flutter * RATE);
  const start = Math.round(SPACES.tunnel.pre * RATE);
  // the loudest sample of each of the first four stretches a flutter long sits at the same place in its stretch —
  // to within the echo's own length (six tenths of a millisecond: it is a click, not a point)
  const at = [];
  for (let k = 0; k < 4; k++) {
    let best = 0;
    for (let i = 0; i < gap; i++)
      if (Math.abs(left[start + k * gap + i]) > Math.abs(left[start + k * gap + best])) best = i;
    at.push(best);
  }
  assert.ok(
    Math.max(...at) - Math.min(...at) <= Math.round(0.0006 * RATE) + 1,
    `the echoes fall at ${at} samples into their stretches`,
  );
  // …and each is weaker than the one before
  const loud = at.map((i, k) => Math.abs(left[start + k * gap + i]));
  assert.ok(loud[0] > loud[1] && loud[1] > loud[2] && loud[2] > loud[3], `${loud.map((v) => v.toFixed(3))}`);
});

test('the menus, the radio and what is only in the operator’s head have no room; what happens in the site has', () => {
  const DRY =
    'uiMove uiSelect uiBack hitMarker killConfirm objective radio heartbeat hurt nvOn nvOff focusIn focusOut tick';
  const WET = 'shot shotSentry explosion stepConcrete stepSentry hitWall sentryAlert doorOpen droneFly lodestoneBlow';
  for (const dry of DRY.split(' ')) assert.equal(sendOf(dry), 0, dry);
  for (const wet of WET.split(' ')) assert.ok(sendOf(wet) > 0.15 && sendOf(wet) <= 1, `${wet}: ${sendOf(wet)}`);
  // the beds are the room already: they are not sent round it again
  for (const bed of ['wind', 'hum', 'cascade']) assert.equal(sendOf(bed), 0, bed);
  // a blast fills a space more than a footstep does; a sound nobody has named gets a little
  assert.ok(sendOf('explosion') > sendOf('stepConcrete'));
  assert.ok(sendOf('something-new') > 0);
});

test('far off, a sound is duller: nothing is cut near to, and at the edge of its reach only the low half is left', () => {
  assert.equal(cutAt(0), 20000);
  assert.equal(cutAt(0.1), 20000);
  let last = 20000;
  for (let far = 0.15; far <= 1.0001; far += 0.05) {
    const cut = cutAt(far);
    assert.ok(cut <= last, `at ${far.toFixed(2)} it is brighter than nearer to`);
    last = cut;
  }
  assert.ok(cutAt(1) >= 1500 && cutAt(1) <= 3500, `at the edge of its reach it is cut at ${cutAt(1)} Hz`);
  assert.ok(cutAt(0.5) > 5000);
});
