// Contract lock: the guard graph in docs/DESIGN.md §5 — every edge, the awareness bounds, and that every state
// ends by the clock whether or not the unit gets anywhere.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AI,
  TUNING,
  createBrain,
  think,
  kill,
  hold,
  letGo,
  createAlarm,
  raiseAlarm,
  sightAlarm,
  stepAlarm,
} from '../../src/enemies/ai.js';

const nothing = () => ({
  sees: false,
  gain: 0,
  x: 0,
  z: 0,
  heard: null,
  hit: null,
  alarm: null,
  alarmActive: false,
  arrived: false,
});
const seeing = (gain = 1, x = 5, z = 5) => ({ ...nothing(), sees: true, gain, x, z });

/** Runs the brain for `seconds` with the same percept; returns every event it gave. */
function run(brain, percept, seconds, dt = 0.1) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...think(brain, percept, dt));
  return events;
}

test('a new unit patrols with no awareness', () => {
  const b = createBrain();
  assert.equal(b.state, AI.PATROL);
  assert.equal(b.awareness, 0);
});

test('patrol → suspicious when awareness passes the threshold, and it says so once', () => {
  const b = createBrain();
  const events = run(b, seeing(0.5), 0.6);
  assert.equal(b.state, AI.PATROL, 'not yet: 0.3 < 0.35');
  events.push(...run(b, seeing(0.5), 0.3));
  assert.equal(b.state, AI.SUSPICIOUS);
  assert.deepEqual(
    events.filter((e) => e === 'suspicious'),
    ['suspicious'],
  );
});

test('suspicious → combat at full awareness, with a "spotted" event', () => {
  const b = createBrain();
  const events = run(b, seeing(1), 1.2);
  assert.equal(b.state, AI.COMBAT);
  assert.ok(events.includes('spotted'));
  assert.equal(b.awareness, 1);
});

test('suspicious → patrol after awareness has stayed low for two seconds', () => {
  const b = createBrain();
  run(b, seeing(1), 0.5);
  assert.equal(b.state, AI.SUSPICIOUS);
  const events = run(b, nothing(), 12);
  assert.equal(b.state, AI.PATROL);
  assert.ok(events.includes('calm'));
});

test('awareness never leaves 0..1', () => {
  const b = createBrain();
  run(b, seeing(50), 3);
  assert.equal(b.awareness, 1);
  const c = createBrain();
  run(c, nothing(), 30);
  assert.equal(c.awareness, 0);
  c.awareness = 0.2;
  run(c, nothing(), 30);
  assert.ok(c.awareness >= 0);
});

test('a noise sends a patrolling or suspicious unit to investigate it', () => {
  for (const prime of [0, 0.5]) {
    const b = createBrain();
    if (prime) run(b, seeing(1), prime);
    think(b, { ...nothing(), heard: { x: 9, z: 3 } }, 0.1);
    assert.equal(b.state, AI.INVESTIGATE);
    assert.deepEqual([b.targetX, b.targetZ], [9, 3]);
  }
});

test('investigate → patrol after looking for four seconds at the place', () => {
  const b = createBrain();
  think(b, { ...nothing(), heard: { x: 9, z: 3 } }, 0.1);
  run(b, { ...nothing(), arrived: true }, TUNING.lookTime - 0.5);
  assert.equal(b.state, AI.INVESTIGATE);
  run(b, { ...nothing(), arrived: true }, 1);
  assert.equal(b.state, AI.PATROL);
});

test('investigate gives up after fourteen seconds even if it never arrives', () => {
  const b = createBrain();
  think(b, { ...nothing(), heard: { x: 9, z: 3 } }, 0.1);
  run(b, nothing(), TUNING.investigateMax - 1);
  assert.equal(b.state, AI.INVESTIGATE);
  run(b, nothing(), 2);
  assert.equal(b.state, AI.PATROL);
});

test('more noises cannot keep one investigation going for ever', () => {
  const b = createBrain();
  const events = [];
  for (let t = 0; t < TUNING.investigateMax + 2; t += 0.1)
    events.push(...think(b, { ...nothing(), heard: { x: t, z: 1 } }, 0.1));
  // a noise heard on patrol starts a NEW investigation, so the state alone proves nothing: count the endings
  assert.ok(events.includes('calm'), 'the first investigation ended inside its limit, noises or not');
});

test('investigate → combat when it sees enough', () => {
  const b = createBrain();
  think(b, { ...nothing(), heard: { x: 9, z: 3 } }, 0.1);
  run(b, seeing(2), 1);
  assert.equal(b.state, AI.COMBAT);
});

test('a hit means combat from any living state, aimed at where the shot came from', () => {
  for (const state of [AI.PATROL, AI.SUSPICIOUS, AI.INVESTIGATE, AI.SEARCH]) {
    const b = createBrain();
    b.state = state;
    const events = think(b, { ...nothing(), hit: { x: 4, z: 8 } }, 0.1);
    assert.equal(b.state, AI.COMBAT, state);
    assert.deepEqual([b.targetX, b.targetZ], [4, 8]);
    assert.ok(events.includes('spotted'));
  }
});

test('combat → search once the target has been out of sight for three seconds', () => {
  const b = createBrain();
  run(b, seeing(5, 7, 7), 0.5);
  assert.equal(b.state, AI.COMBAT);
  run(b, nothing(), TUNING.loseSightAfter - 0.5);
  assert.equal(b.state, AI.COMBAT);
  const events = run(b, nothing(), 1);
  assert.equal(b.state, AI.SEARCH);
  assert.ok(events.includes('lost'));
  assert.deepEqual([b.targetX, b.targetZ], [7, 7], 'it searches where it last saw the target');
});

test('combat entered without ever seeing the target still times out', () => {
  const b = createBrain();
  think(b, { ...nothing(), hit: { x: 1, z: 1 } }, 0.1);
  run(b, nothing(), TUNING.loseSightAfter + 0.5);
  assert.equal(b.state, AI.SEARCH);
});

test('search → combat at once on sight; search → patrol after twelve seconds', () => {
  const b = createBrain();
  think(b, { ...nothing(), hit: { x: 1, z: 1 } }, 0.1);
  run(b, nothing(), TUNING.loseSightAfter + 0.5);
  think(b, seeing(0.01), 0.1);
  assert.equal(b.state, AI.COMBAT, 'an alerted unit needs no time to make up its mind');

  run(b, nothing(), TUNING.loseSightAfter + 0.5);
  assert.equal(b.state, AI.SEARCH);
  run(b, nothing(), TUNING.searchTime - 1);
  assert.equal(b.state, AI.SEARCH);
  run(b, nothing(), 1.5);
  assert.equal(b.state, AI.PATROL);
});

test('under alarm a search lasts thirty seconds, not twelve', () => {
  const b = createBrain();
  think(b, { ...nothing(), alarm: { x: 2, z: 2 }, alarmActive: true }, 0.1);
  assert.equal(b.state, AI.SEARCH);
  run(b, { ...nothing(), alarmActive: true }, TUNING.searchTime + 5);
  assert.equal(b.state, AI.SEARCH);
  run(b, { ...nothing(), alarmActive: true }, TUNING.searchTimeAlarm - TUNING.searchTime);
  assert.equal(b.state, AI.PATROL);
});

test('the alarm sends patrolling, suspicious and investigating units to search; fighters keep fighting', () => {
  for (const state of [AI.PATROL, AI.SUSPICIOUS, AI.INVESTIGATE]) {
    const b = createBrain();
    b.state = state;
    think(b, { ...nothing(), alarm: { x: 3, z: 4 }, alarmActive: true }, 0.1);
    assert.equal(b.state, AI.SEARCH, state);
    assert.deepEqual([b.targetX, b.targetZ], [3, 4]);
  }
  const fighter = createBrain();
  run(fighter, seeing(5), 0.5);
  think(fighter, { ...seeing(5), alarm: { x: 3, z: 4 }, alarmActive: true }, 0.1);
  assert.equal(fighter.state, AI.COMBAT);
});

test('a unit asks for the alarm once, after four seconds of combat in total', () => {
  const b = createBrain();
  const early = run(b, seeing(5), TUNING.callAlarmAfter - 0.5);
  assert.ok(!early.includes('alarm'));
  const late = run(b, seeing(5), 6);
  assert.equal(late.filter((e) => e === 'alarm').length, 1);
});

test('a dead unit does nothing, whatever it is shown', () => {
  const b = createBrain();
  kill(b);
  assert.equal(b.state, AI.DEAD);
  const events = run(b, { ...seeing(9), hit: { x: 1, z: 1 }, heard: { x: 1, z: 1 }, alarm: { x: 1, z: 1 } }, 5);
  assert.equal(b.state, AI.DEAD);
  assert.deepEqual(events, []);
});

test('left alone, every living state finds its way back to patrol', () => {
  for (const state of [AI.SUSPICIOUS, AI.INVESTIGATE, AI.COMBAT, AI.SEARCH, AI.HELD]) {
    const b = createBrain();
    b.state = state;
    b.awareness = 1;
    run(b, nothing(), 80);
    assert.equal(b.state, AI.PATROL, `${state} never ended`);
    assert.equal(b.awareness < TUNING.suspiciousAt, true);
  }
});

// ---------- held: a machine taken from behind and kept in front of you as a shield ----------

test('a machine can be taken hold of from any living state, and a held machine senses nothing', () => {
  for (const state of [AI.PATROL, AI.SUSPICIOUS, AI.INVESTIGATE, AI.SEARCH, AI.COMBAT]) {
    const b = createBrain();
    b.state = state;
    assert.equal(hold(b), true, state);
    assert.equal(b.state, AI.HELD);
    assert.equal(b.timer, 0);
    // it is shown everything at once: none of it gets through, and it says nothing
    const events = run(
      b,
      { ...seeing(9), hit: { x: 1, z: 1 }, heard: { x: 1, z: 1 }, alarm: { x: 1, z: 1 }, alarmActive: true },
      TUNING.holdMax - 1,
    );
    assert.equal(b.state, AI.HELD, `${state}: it got free early`);
    assert.deepEqual(events, []);
  }
});

test('a hold ends by the clock: after thirty seconds the machine breaks free and turns on you, once', () => {
  assert.equal(TUNING.holdMax, 30);
  const b = createBrain();
  hold(b);
  const early = run(b, nothing(), TUNING.holdMax - 0.5);
  assert.equal(b.state, AI.HELD);
  assert.deepEqual(early, []);
  const late = run(b, { ...nothing(), x: 7, z: 8 }, 1);
  assert.equal(b.state, AI.COMBAT);
  assert.equal(b.awareness, 1);
  assert.deepEqual(late, ['broke-free']);
});

test('let go, it turns on whoever held it — and it has not forgotten how long it has been fighting', () => {
  const b = createBrain();
  hold(b);
  run(b, nothing(), 5);
  assert.equal(letGo(b, 12, 13), true);
  assert.equal(b.state, AI.COMBAT);
  assert.deepEqual([b.targetX, b.targetZ, b.awareness], [12, 13, 1]);
  assert.equal(letGo(b, 1, 1), false, 'only a held machine can be let go');
  // and from there it is an ordinary fight: unseen for three seconds, it goes looking
  run(b, nothing(), TUNING.loseSightAfter + 0.2);
  assert.equal(b.state, AI.SEARCH);
});

test('a held machine cannot call the alarm, and holding it does not wipe one it had already called', () => {
  const fresh = createBrain();
  hold(fresh);
  assert.ok(!run(fresh, seeing(9), 20).includes('alarm'));
  const veteran = createBrain();
  run(veteran, seeing(5), TUNING.callAlarmAfter + 1);
  assert.equal(veteran.calledAlarm, true);
  hold(veteran);
  letGo(veteran, 0, 0);
  assert.ok(!run(veteran, seeing(5), 10).includes('alarm'), 'it does not call a second time');
});

test('a dead machine cannot be held, and a held one can be shut down', () => {
  const dead = createBrain();
  kill(dead);
  assert.equal(hold(dead), false);
  assert.equal(dead.state, AI.DEAD);
  const b = createBrain();
  hold(b);
  assert.equal(hold(b), false, 'it is already held');
  kill(b);
  assert.equal(b.state, AI.DEAD);
  assert.deepEqual(run(b, nothing(), 60), []);
});

test('the alarm: raised once, re-armed by a sighting, and always ends', () => {
  const alarm = createAlarm();
  assert.equal(alarm.active, false);
  assert.equal(raiseAlarm(alarm, 5, 6), true, 'newly raised');
  assert.equal(raiseAlarm(alarm, 5, 6), false, 'already sounding');
  assert.equal(alarm.count, 1);
  for (let t = 0; t < TUNING.alarmTime - 5; t += 0.5) stepAlarm(alarm, 0.5);
  assert.equal(alarm.active, true);
  sightAlarm(alarm, 9, 9);
  assert.deepEqual([alarm.x, alarm.z], [9, 9]);
  for (let t = 0; t < TUNING.alarmTime - 5; t += 0.5) stepAlarm(alarm, 0.5);
  assert.equal(alarm.active, true, 'the sighting bought it another 45 s');
  let ended = 0;
  for (let t = 0; t < 10; t += 0.5) if (stepAlarm(alarm, 0.5)) ended++;
  assert.equal(alarm.active, false);
  assert.equal(ended, 1, 'it reports its end exactly once');
  sightAlarm(alarm, 1, 1);
  assert.equal(alarm.active, false, 'a sighting does not start an alarm; only a call does');
});
