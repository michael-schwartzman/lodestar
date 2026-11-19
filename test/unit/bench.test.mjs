// Contract lock: the list the phone test page works through (src/look/setups.js). Pure — no browser.
// The page itself is run in a browser by test/second/look.test.mjs, and on a phone by a person.
//
// 16 November 2026 — the second version of it. The owner ran the first on his iPhone that night and pasted its
// line: two of its five rows were missing (the browser had loaded the page afresh and thrown the rows away with
// it), the phone had been given the desk's level, and its rates — 30, 20.7, 15 — could not be told from a screen
// that shows thirty pictures a second. So: the rows travel in the address, where a fresh load cannot lose them;
// the screen's own rate is measured first and written down; what level the device was given is written down;
// and the set-ups begin with ALL of the look as the device is given it and then leave one piece out at a time —
// which is what says what to drop. The line begins `LODESTAR-BENCH 2`, so the two cannot be mistaken.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEPT, SETUPS, addressOf, lineOf, packRows, unpackRows } from '../../src/look/setups.js';

test('the set-ups: the game as it is, the second look as the device is given it, then that with one thing changed', () => {
  assert.equal(new Set(SETUPS.map((s) => s.id)).size, SETUPS.length, 'two set-ups have the same letter');
  assert.deepEqual(
    SETUPS.map((s) => s.id),
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  );
  assert.equal(SETUPS[0].query, 'look=1');
  assert.equal(SETUPS[1].query, 'look=2');
  // every other one is the second look with exactly one switch beside it — so that two rows differ by one thing
  const changed = SETUPS.slice(2).map((setup) => {
    const p = [...new URLSearchParams(setup.query)];
    assert.deepEqual(p[0], ['look', '2'], setup.query);
    assert.equal(p.length, 2, `${setup.id} changes ${p.length - 1} things: ${setup.query}`);
    return p[1].join('=');
  });
  assert.deepEqual(changed, ['key=0', 'mats=0', 'env=0', 'mats=cheap', 'q=medium']);
});

test('every set-up is loaded the same way: started, silent, at a resolution that does not move, and told its place', () => {
  SETUPS.forEach((setup, step) => {
    const p = new URLSearchParams(
      addressOf(step, [['q', 'low']], { rows: 'A.60-60-41.5.0.1000', hz: 60, level: 'hand' }),
    );
    assert.deepEqual(
      [p.get('bench'), p.get('step'), p.get('autostart'), p.get('noaudio'), p.get('dynres')],
      ['1', String(step), '1', '1', '0'],
    );
    for (const [key, value] of new URLSearchParams(setup.query)) assert.equal(p.get(key), value);
    // what the set-up itself says comes first: the one that is "at Detail: Medium" is that whatever was asked for
    assert.equal(p.get('q'), setup.query.includes('q=') ? 'medium' : 'low');
    // …and what the run has found out so far goes with it
    assert.deepEqual([p.get('rows'), p.get('hz'), p.get('level')], ['A.60-60-41.5.0.1000', '60', 'hand']);
  });
  // with nothing found out yet, nothing is carried
  const first = new URLSearchParams(addressOf(0));
  assert.deepEqual([first.has('rows'), first.has('hz'), first.has('level')], [false, false, false]);
  // what a person may ask for is passed on, and only that
  assert.deepEqual(KEPT, ['q', 'touch', 'fast']);
});

test('the rows travel in the address: packed and unpacked they are the same, a failed one too, and rubbish is no rows', () => {
  const rows = [
    { id: 'A', rates: [60, 60, 41.5], broken: 0, triangles: 310000 },
    { id: 'B', failed: 'did not start' },
    { id: 'C', rates: [30, 20.7, 15], broken: 2, triangles: 468123 },
  ];
  const packed = packRows(rows);
  assert.equal(packed, 'A.60-60-41.5.0.310000~B.x~C.30-20.7-15.2.468123');
  // it goes into an address as it is: nothing in it needs escaping
  assert.equal(encodeURIComponent(packed), packed);
  const back = unpackRows(packed);
  assert.deepEqual(
    back.map(({ id, rates, broken, triangles, failed }) => ({ id, rates, broken, triangles, failed })),
    [
      { id: 'A', rates: [60, 60, 41.5], broken: 0, triangles: 310000, failed: undefined },
      { id: 'B', rates: undefined, broken: undefined, triangles: undefined, failed: 'did not start' },
      { id: 'C', rates: [30, 20.7, 15], broken: 2, triangles: 468123, failed: undefined },
    ],
  );
  // each has its set-up's name again, for the table
  assert.deepEqual(
    back.map((row) => row.name),
    rows.map((row) => SETUPS.find((s) => s.id === row.id).name),
  );
  for (const rubbish of [null, '', 'A', 'Z.1-2-3.0.5', 'A.1-2.0.5', 'A.a-b-c.0.5', '~~~', 'A.60-60-60.0.5~A.1-1-1.0.5'])
    assert.ok(unpackRows(rubbish).length <= 1, `${rubbish} gave ${JSON.stringify(unpackRows(rubbish))}`);
  assert.deepEqual(unpackRows('Z.1-2-3.0.5'), []);
  assert.deepEqual(unpackRows('A.a-b-c.0.5'), []);
});

test('the line to copy names the device, its screen and its level, and gives every set-up its three rates', () => {
  const line = lineOf({
    device: 'iPhone; 390x844@3',
    canvas: '1170x540',
    quality: 'low',
    gpu: 'Apple GPU',
    shadowFilter: 'blended',
    hz: 60,
    level: 'hand',
    rows: [
      { id: 'A', rates: [60, 60, 41.5], broken: 0 },
      { id: 'B', failed: 'did not start' },
      // a set-up whose shaders did not all compile draws less than it should, and so looks fast: the line says so
      { id: 'C', rates: [60, 60, 60], broken: 2 },
    ],
  });
  assert.equal(
    line,
    'LODESTAR-BENCH 2 | iPhone; 390x844@3 | canvas 1170x540 | q=low | Apple GPU | shadows blended | screen 60 Hz | level hand | A 60/60/41.5 | B failed | C 60/60/60 (2 shaders failed)',
  );
  // a screen that could not be timed is written down as that, not as a number
  assert.match(
    lineOf({ device: 'x', canvas: 'y', quality: 'low', gpu: 'z', shadowFilter: 'nearest', rows: [] }),
    /\| screen \? \| level \? *$/,
  );
});
