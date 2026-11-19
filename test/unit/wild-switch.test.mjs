// The switch of the wild branch (src/wild/switch.js): when the experiment is on, and which look it is shown in.
// Decision of 16 November 2026 — the owner: "… just go wild … but allow me to rollback if i wouldn't like it".
// The way back is this switch: off, the game is the locked one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookWanted, wildWanted } from '../../src/wild/switch.js';
import { withWild, withoutWild } from '../helpers/harness.mjs';

const address = (query) => new URLSearchParams(query);

test('the suites written before the experiment open every page with the switch off — unless the address itself says', () => {
  assert.equal(withoutWild('http://h/'), 'http://h/?wild=0');
  assert.equal(withoutWild('http://h/?autostart=1'), 'http://h/?autostart=1&wild=0');
  assert.equal(withoutWild('http://h/?wild=1&autostart=1'), 'http://h/?wild=1&autostart=1');
  // the game reads that as off (and reads the address that was left alone as on)
  assert.equal(wildWanted(new URL(withoutWild('http://h/?autostart=1')).searchParams), false);
  // for the report only (WILD_COMPAT=1): on, and in the first look, unless the address says
  assert.equal(withWild('http://h/?autostart=1'), 'http://h/?autostart=1&wild=1&look=1');
  assert.equal(withWild('http://h/?look=2'), 'http://h/?look=2&wild=1');
  assert.equal(withWild('http://h/?wild=0'), 'http://h/?wild=0&look=1');
});

test('the wild build is the game: on unless the ADDRESS says otherwise — what was once chosen on the title is not asked any more', () => {
  // Decision of 18 November 2026 — the owner, of the experiment: "… i like it". It is the game. Until then the
  // title carried a switch (WILD BUILD: ON — TURN IT OFF) whose choice was kept in the browser and read here as
  // a second argument: `wildWanted(address(''), '0')` was false. A game that is no longer an experiment has no
  // such switch on its title; a browser that still holds an old '0' gets the game all the same. The address
  // keeps its word — `?wild=0` is the classic game, which the suites written before the wild build still hold.
  assert.equal(wildWanted(address('')), true, 'nothing said: on');
  assert.equal(wildWanted(address('wild=0')), false);
  assert.equal(wildWanted(address('wild=1')), true);
  assert.equal(wildWanted.length, 1, 'the address is all it is given');
  assert.equal(wildWanted(address(''), '0'), true, 'an old choice changes nothing');
  // anything but a plain 0 is not "off"
  assert.equal(wildWanted(address('wild=')), true);
});

test('the phone test page measures the look, not the experiment: with bench=1 it is off whatever else is said', () => {
  assert.equal(wildWanted(address('bench=1')), false);
  assert.equal(wildWanted(address('bench=1&wild=1')), false);
  assert.equal(wildWanted(address('bench=0&wild=1')), true);
});

test('which look: without the experiment exactly as it was — the second only when the address asks for it', () => {
  for (const touch of [false, true]) {
    assert.equal(lookWanted(address(''), { wild: false, touch }), 1);
    assert.equal(lookWanted(address('look=2'), { wild: false, touch }), 2);
    assert.equal(lookWanted(address('look=1'), { wild: false, touch }), 1);
    assert.equal(lookWanted(address('look=3'), { wild: false, touch }), 1);
  }
});

test('which look: with the experiment a desk gets the second unless the address says the first; a phone keeps the first', () => {
  assert.equal(lookWanted(address(''), { wild: true, touch: false }), 2);
  assert.equal(lookWanted(address('look=1'), { wild: true, touch: false }), 1);
  assert.equal(lookWanted(address('look=2'), { wild: true, touch: false }), 2);
  assert.equal(lookWanted(address(''), { wild: true, touch: true }), 1);
  assert.equal(lookWanted(address('look=2'), { wild: true, touch: true }), 2);
});
