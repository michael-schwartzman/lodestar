// Haptics (src/wild/haptics.js): the rules alone, by arithmetic — every kind, the scaling, the rate limit, the
// priority that lets a blast cut a tick short and never the other way round, and distance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ask, createHaptics, near, PATTERNS, RATE_MS, scale } from '../../src/wild/haptics.js';

const KINDS = [
  'carbine',
  'pistol',
  'shotgun',
  'knife',
  'hurt',
  'kill',
  'charge',
  'alarm',
  'emp',
  'blast',
  'aftershock',
  'crush',
  'slide',
  'land',
  // (18 November 2026, the same night: what the round's other features ask to be felt — a wave of machines on
  // its way and one shut down to the last, src/wild/response-live.js; a visor cracked, src/wild/visor-live.js)
  'wave',
  'salvage',
  'visor',
];

test('every kind the owner asked for has a pattern (or, for the one that is felt by how pressed things are, a range) and a priority', () => {
  for (const kind of KINDS) {
    const def = PATTERNS[kind];
    assert.ok(def, `${kind} has no entry`);
    assert.ok(typeof def.priority === 'number' && def.priority > 0, `${kind}'s priority is ${def.priority}`);
    if (kind === 'aftershock') {
      assert.deepEqual(def.range, [60, 220]);
    } else {
      assert.ok(
        typeof def.pattern === 'number' || Array.isArray(def.pattern),
        `${kind}'s pattern is ${JSON.stringify(def.pattern)}`,
      );
    }
  }
  // nothing here that was not asked for is silently missing one or the other
  assert.deepEqual(Object.keys(PATTERNS).sort(), [...KINDS].sort());
});

test('scale: a phone motor is given 0.4…1 of a kind’s milliseconds by strength, pauses untouched, nothing under 5 ms', () => {
  assert.equal(scale(100, 1), 100);
  assert.equal(scale(100, 0), 40);
  assert.equal(scale(100, 0.5), 70);
  assert.equal(scale(10, 0), 5, 'never under 5 ms even at zero strength');
  assert.equal(scale(1, 1), 5, 'never under 5 ms even at full strength of a tiny pattern');
  const shape = scale([200, 60, 200, 60, 300], 0.5);
  assert.deepEqual(
    [shape[1], shape[3]],
    [60, 60],
    'the gaps (the odd places) are a silence, not scaled down with the feeling',
  );
  assert.ok(shape[0] < 200 && shape[2] < 200 && shape[4] < 300, JSON.stringify(shape));
  assert.ok(scale([10], 0.1)[0] >= 5);
});

test('off: ask never answers, at any strength or kind', () => {
  const h = createHaptics();
  h.off = true;
  for (const kind of KINDS) assert.equal(ask(h, kind, 1, 1000), null);
  assert.equal(h.count, 0);
  assert.equal(h.last, null);
});

test('a kind nothing knows, or a strength of zero (an explosion past its reach), is silence — not a 5 ms floor', () => {
  const h = createHaptics();
  assert.equal(ask(h, 'nonsense', 1, 0), null);
  assert.equal(ask(h, 'emp', 0, 0), null);
  assert.equal(h.count, 0);
});

test('the rate limit: nothing plays again inside 45 ms of when the last one began, once that one has finished playing', () => {
  const h = createHaptics();
  // land (15 ms): well clear of its own length by 20 ms, but inside the 45 ms rest
  assert.ok(ask(h, 'land', 1, 0));
  assert.equal(ask(h, 'land', 1, 20), null, '20 ms after the last began, and it is long since finished playing');
  assert.ok(ask(h, 'land', 1, RATE_MS), 'exactly the rest, allowed');
  assert.ok(ask(h, 'land', 1, RATE_MS + 50 + RATE_MS), 'well clear of the rest too');
});

test('priority: a tick during a blast is dropped; a blast during a tick replaces it outright; after the blast’s length a tick plays again', () => {
  const h = createHaptics();
  const blastAt = 1000;
  const blast = ask(h, 'blast', 1, blastAt);
  assert.ok(blast);
  const blastLen = blast.reduce((sum, ms) => sum + ms, 0);
  // a low-priority tick while the blast still has most of its length to run: dropped
  assert.equal(ask(h, 'carbine', 1, blastAt + 30), null);
  assert.deepEqual(h.last, { kind: 'blast', pattern: blast, at: blastAt });

  // a tick begins; a blast arrives five milliseconds later, well inside the tick's own short length: it
  // replaces the tick outright, even though that is far inside the 45 ms rest a lower kind would be held to
  const h2 = createHaptics();
  ask(h2, 'carbine', 1, 2000);
  const replaced = ask(h2, 'blast', 1, 2005);
  assert.ok(replaced, 'the blast must not be held back by a tick it outranks');
  assert.equal(h2.last.kind, 'blast');
  assert.equal(h2.last.at, 2005);

  // once the blast's own whole length has elapsed, a tick is felt again
  assert.equal(ask(h, 'carbine', 1, blastAt + blastLen - 5), null, 'the blast still has a few ms left to run');
  assert.ok(ask(h, 'carbine', 1, blastAt + blastLen + 1), 'the blast is over: the tick is free to play');
});

test('equal priority replaces too: the same kind, back to back while it is still playing, always ticks again', () => {
  const h = createHaptics();
  ask(h, 'carbine', 1, 0);
  const again = ask(h, 'carbine', 1, 4); // well inside its own 10 ms, and inside the 45 ms rest besides
  assert.ok(again, 'a kind does not drop its own repeat');
  assert.equal(h.last.at, 4);
});

test('continuous fire: the carbine on AUTO, every 94 ms, ticks every single round', () => {
  const h = createHaptics();
  let now = 0;
  let ticks = 0;
  for (let i = 0; i < 20; i++, now += 94) if (ask(h, 'carbine', 1, now)) ticks++;
  assert.equal(ticks, 20, 'every round must tick: that is the point of the carbine kind');
});

test('distance: near falls from strength at 0 m to 0 at reach and beyond, in a straight line', () => {
  assert.equal(near(1, 0, 20), 1);
  assert.equal(near(1, 10, 20), 0.5);
  assert.equal(near(1, 20, 20), 0);
  assert.equal(near(1, 30, 20), 0, 'never negative past reach');
  assert.equal(near(0.5, 10, 20), 0.25, 'the explosion’s own strength scales the whole line');
});

test('aftershock: felt nowhere near a fixed pattern, but lerped 60…220 ms straight across its own range by strength', () => {
  const h = createHaptics();
  assert.equal(ask(h, 'aftershock', 0, 1000), null, 'strength 0 is silence, not 60 ms');
  assert.equal(ask(createHaptics(), 'aftershock', 0.0001, 0), 60, '~0 strength: ~the bottom of the range');
  assert.equal(ask(createHaptics(), 'aftershock', 1, 0), 220, 'full strength: the top of the range');
  assert.equal(ask(createHaptics(), 'aftershock', 0.5, 0), 140, 'half strength: the middle');
});
