// Contract lock: the picture-size controller and the settings store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDynRes } from '../../src/gfx/dynres.js';
import { SCHEMA, STORAGE_KEY, createSettings, defaults } from '../../src/settings.js';

const feed = (d, ms, seconds) => {
  for (let t = 0; t < seconds * 1000; t += ms) d.frame(ms);
  return d.scale;
};

test('dynres: steps down when frames run long, one step at a time, never below the floor', () => {
  const d = createDynRes();
  assert.equal(d.scale, 1);
  feed(d, 40, 1.6);
  assert.equal(d.scale, 0.9);
  feed(d, 40, 30);
  assert.equal(d.scale, 0.6);
});

test('dynres: steps back up when there is room, never above 1', () => {
  const d = createDynRes();
  feed(d, 40, 30);
  feed(d, 8, 6);
  assert.equal(d.scale, 0.7);
  feed(d, 8, 60);
  assert.equal(d.scale, 1);
});

test('dynres: steady frames in the comfortable band change nothing', () => {
  const d = createDynRes();
  feed(d, 18, 20);
  assert.equal(d.scale, 1);
});

test('dynres: holds after the screen is re-shaped — the slow frames of a turn are not a slow device', () => {
  const d = createDynRes();
  d.hold(2);
  for (const ms of [180, 150, 130, 160, 140, 120, 110, 100]) d.frame(ms);
  feed(d, 40, 0.8);
  assert.equal(d.scale, 1, 'nothing learnt inside the hold');
  feed(d, 16, 5);
  assert.equal(d.scale, 1, 'and nothing carried out of it');
});

test('dynres: four turns in a row at a steady 60 a second leave the scale where it was', () => {
  const d = createDynRes();
  for (let turn = 0; turn < 4; turn++) {
    d.hold(2);
    for (const ms of [250, 190, 160, 140, 130]) d.frame(ms);
    feed(d, 16.7, 4);
  }
  assert.equal(d.scale, 1);
});

test('dynres: one long stall is not a measurement', () => {
  const d = createDynRes();
  feed(d, 16, 2);
  d.frame(900);
  feed(d, 16, 2);
  assert.equal(d.scale, 1);
});

test('dynres: switched off, it never moves', () => {
  const d = createDynRes({ enabled: false });
  feed(d, 60, 10);
  assert.equal(d.scale, 1);
});

function memoryStore(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)) };
}

test('settings: the defaults — FIRE on both sides, double tap on', () => {
  const s = createSettings(memoryStore());
  assert.equal(s.get('fireButton'), 'both');
  assert.equal(s.get('tapFire'), true);
  assert.equal(s.get('difficulty'), 'operator');
  assert.deepEqual(s.all(), defaults());
});

test('settings: only what was chosen is saved, so a changed default reaches everyone who never chose', () => {
  const store = memoryStore();
  const s = createSettings(store);
  assert.equal(store.data[STORAGE_KEY], undefined, 'nothing written just by looking');
  s.set('fireButton', 'left');
  s.set('fov', 90);
  assert.deepEqual(JSON.parse(store.data[STORAGE_KEY]), { fireButton: 'left', fov: 90 });
  s.set('fireButton', 'both');
  assert.deepEqual(JSON.parse(store.data[STORAGE_KEY]), { fov: 90 }, 'choosing the default again un-saves it');
  const again = createSettings(store);
  assert.equal(again.get('fov'), 90);
  assert.equal(again.get('fireButton'), 'both');
});

test('settings: values are fitted to their range and step; nonsense is refused', () => {
  const s = createSettings(memoryStore());
  assert.equal(s.set('fov', 500), 100);
  assert.equal(s.set('fov', 73.4), 73);
  assert.equal(s.set('sensitivity', 0), 0.2);
  assert.throws(() => s.set('fireButton', 'top'));
  assert.throws(() => s.set('invertY', 'yes'));
  assert.throws(() => s.set('fov', NaN));
  assert.throws(() => s.get('nope'));
});

test('settings: a broken, hostile or missing store never stops the game', () => {
  assert.equal(createSettings(memoryStore({ [STORAGE_KEY]: '{not json' })).get('fov'), 74);
  const hostile = createSettings(
    memoryStore({ [STORAGE_KEY]: JSON.stringify({ fov: 'wide', fireButton: 'top', extra: 1, quality: 'low' }) }),
  );
  assert.equal(hostile.get('fov'), 74);
  assert.equal(hostile.get('fireButton'), 'both');
  assert.equal(hostile.get('quality'), 'low', 'the one good value is kept');
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const s = createSettings(throwing);
  assert.equal(s.set('fov', 80), 80);
  assert.equal(s.get('fov'), 80);
  assert.equal(createSettings(null).get('volume'), 0.8);
});

test('settings: listeners hear every change, and reset puts everything back', () => {
  const s = createSettings(memoryStore());
  const heard = [];
  const stop = s.onChange((key, value) => heard.push(`${key}=${value}`));
  s.set('invertY', true);
  s.set('music', 0.25);
  s.reset();
  assert.deepEqual(heard.slice(0, 2), ['invertY=true', 'music=0.25']);
  assert.ok(heard.includes('invertY=false') && heard.includes('music=0.6'));
  assert.deepEqual(s.chosen(), {});
  stop();
  s.set('invertY', true);
  assert.equal(heard.length, 4);
});

test('settings: every entry of the list is well formed', () => {
  const keys = new Set();
  for (const item of SCHEMA) {
    assert.ok(!keys.has(item.key), `duplicate ${item.key}`);
    keys.add(item.key);
    assert.ok(item.label && item.group);
    if (item.type === 'range') assert.ok(item.min < item.max && item.def >= item.min && item.def <= item.max);
    else if (item.type === 'choice') assert.ok(item.options.some(([v]) => v === item.def));
    else assert.equal(typeof item.def, 'boolean');
  }
});
