// Aftershocks (src/wild/aftershock.js): when the mountain shakes and how hard — the rules alone, by arithmetic.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AFTERSHOCK, createAftershock, stepAftershock, urgency } from '../../src/wild/aftershock.js';

/** everything that comes in `seconds` at one urgency, stepped as the game steps (sixty a second) */
function run(u, seconds, seed = 7) {
  const a = createAftershock(seed);
  const came = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    const shock = stepAftershock(a, 1 / 60, u);
    if (shock) came.push({ at: t, ...shock });
  }
  return came;
}
const mean = (list) => list.reduce((sum, v) => sum + v, 0) / list.length;

test('while the cascades stand the mountain is still: nothing presses, nothing comes, and the wait does not run', () => {
  assert.equal(urgency(null, 60), null);
  assert.equal(urgency({ blown: false, phase: 'infil', clock: 60 }, 60), null);
  const a = createAftershock(3);
  for (let i = 0; i < 6000; i++) assert.equal(stepAftershock(a, 1 / 60, null), null);
  assert.deepEqual([a.wait, a.count], [AFTERSHOCK.first, 0]);
});

test('how pressed things are: a little once the cascades are gone, and by the clock once the lodestar is up', () => {
  assert.equal(urgency({ blown: true, phase: 'mark', clock: 75 }, 75), AFTERSHOCK.idle);
  // the clock has just started: no less pressed than before it did
  assert.equal(urgency({ blown: true, phase: 'exfil', clock: 75 }, 75), AFTERSHOCK.idle);
  assert.equal(urgency({ blown: true, phase: 'exfil', clock: 37.5 }, 75), 0.5);
  assert.equal(urgency({ blown: true, phase: 'exfil', clock: 0 }, 75), 1);
  // (a clock nobody saw start — a retry from a checkpoint — is not divided by nothing)
  assert.equal(urgency({ blown: true, phase: 'exfil', clock: 0 }, 0), 1);
});

test('the first waits for the blast to be over; then they come seldom when nothing presses and fast at the last', () => {
  const idle = run(AFTERSHOCK.idle, 120);
  const last = run(1, 120);
  assert.ok(idle[0].at >= AFTERSHOCK.first - 0.02 && idle[0].at < AFTERSHOCK.first + 0.05, `${idle[0].at}`);
  // two minutes of each: about one every ten seconds, and about one every two and a half
  assert.ok(idle.length >= 9 && idle.length <= 15, `${idle.length} with nothing pressing`);
  assert.ok(last.length >= 36 && last.length <= 54, `${last.length} at the last`);
  // never two on top of each other, never a silence longer than the longest gap and its jitter
  for (const list of [idle, last])
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].at - list[i - 1].at;
      assert.ok(gap >= AFTERSHOCK.gap[1] * (1 - AFTERSHOCK.jitter) - 0.02, `${gap} s between two`);
      assert.ok(gap <= AFTERSHOCK.gap[0] * (1 + AFTERSHOCK.jitter) + 0.02, `${gap} s between two`);
    }
});

test('they are harder at the last: more shake, more dust, and only the hard ones set something off in the hall', () => {
  const idle = run(AFTERSHOCK.idle, 300);
  const last = run(1, 300);
  assert.ok(mean(last.map((s) => s.strength)) > mean(idle.map((s) => s.strength)) + 0.35);
  assert.ok(mean(last.map((s) => s.shake)) > 2 * mean(idle.map((s) => s.shake)));
  assert.ok(mean(last.map((s) => s.falls.length)) > mean(idle.map((s) => s.falls.length)) + 2);
  assert.equal(idle.filter((s) => s.secondary).length, 0);
  assert.ok(last.filter((s) => s.secondary).length > last.length * 0.9);
  for (const shock of [...idle, ...last]) {
    assert.ok(shock.strength > 0.25 && shock.strength <= 1);
    // it rattles the camera less than a blast at your feet does (1), and the weakest more than nothing
    assert.ok(shock.shake >= AFTERSHOCK.shake[0] && shock.shake <= AFTERSHOCK.shake[1]);
    assert.equal(shock.secondary, shock.strength >= AFTERSHOCK.secondary);
    assert.ok(shock.falls.length >= AFTERSHOCK.falls[0] && shock.falls.length <= AFTERSHOCK.falls[1]);
    // the dust comes down round the player, not on them and not out of sight
    for (const [dx, dz] of shock.falls) {
      const far = Math.hypot(dx, dz);
      assert.ok(far >= AFTERSHOCK.ring[0] - 1e-9 && far <= AFTERSHOCK.ring[1] + 1e-9, `${far} m off`);
    }
  }
});

test('a mission’s aftershocks are the same every time from the same seed, and different from another', () => {
  assert.deepEqual(run(0.6, 90, 11), run(0.6, 90, 11));
  assert.notDeepEqual(run(0.6, 90, 11), run(0.6, 90, 12));
});
