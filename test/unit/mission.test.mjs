// Contract lock: the mission graph in docs/DESIGN.md §6 — every edge and every "cannot happen".
//
// Decision of 12 November 2026 — the owner: "i don't [want] it to be a plant but rather uranium enrichment
// facility and i want to blow up the centrefuges". Until then there were three charges (cascade hall, feed room,
// switchgear) that only went off in the ending. Now there are four, one on each cascade of centrifuges; when
// all four are set the player blows them; and the lodestar can only be raised once the cascades are blown and
// every guard machine is down.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PHASE,
  canDetonate,
  createMission,
  detonate,
  plantCharge,
  hostileDown,
  placeBeacon,
  step,
  objectives,
  isFinal,
} from '../../src/mission.js';

const CHARGES = ['c1', 'c2', 'c3', 'c4'];
const fresh = (hostiles = 3) => createMission({ charges: CHARGES, hostiles, exfilSeconds: 60 });
const alive = { dt: 0.1, health: 100, inPickup: false };

function readyToMark(m) {
  for (const id of CHARGES) plantCharge(m, id);
  for (let i = 0; i < m.hostilesTotal; i++) hostileDown(m, i);
  detonate(m);
  step(m, alive);
}

test('starts in infil with nothing done', () => {
  const m = fresh();
  assert.equal(m.phase, PHASE.INFIL);
  assert.equal(m.clock, 60);
  assert.equal(m.blown, false);
  assert.equal(isFinal(m), false);
  assert.ok(objectives(m).every((o) => !o.done));
});

test('infil → mark needs all four charges set, the cascades blown AND no hostiles left — no two of them are enough', () => {
  const noBlast = fresh();
  for (const id of CHARGES) plantCharge(noBlast, id);
  for (let i = 0; i < 3; i++) hostileDown(noBlast, i);
  step(noBlast, alive);
  assert.equal(noBlast.phase, PHASE.INFIL, 'rigged and cleared, but nothing has been blown');

  const guardsUp = fresh();
  for (const id of CHARGES) plantCharge(guardsUp, id);
  detonate(guardsUp);
  step(guardsUp, alive);
  assert.equal(guardsUp.phase, PHASE.INFIL, 'blown, but machines are still running');

  const onlyKills = fresh();
  for (let i = 0; i < 3; i++) hostileDown(onlyKills, i);
  step(onlyKills, alive);
  assert.equal(onlyKills.phase, PHASE.INFIL);

  const all = fresh();
  readyToMark(all);
  assert.equal(all.phase, PHASE.MARK);
});

test('the cascades can be blown only once every charge is set, and only once', () => {
  const m = fresh();
  assert.equal(canDetonate(m), false);
  for (const id of ['c1', 'c2', 'c3']) plantCharge(m, id);
  assert.equal(canDetonate(m), false, 'one cascade has no charge on it');
  assert.equal(detonate(m), false);
  assert.equal(m.blown, false);
  plantCharge(m, 'c4');
  assert.equal(canDetonate(m), true);
  assert.equal(detonate(m), true);
  assert.equal(m.blown, true);
  assert.equal(canDetonate(m), false);
  assert.equal(detonate(m), false, 'there is nothing left to blow');
});

test('blowing the cascades with machines still running is allowed — it is the loud way — and the order of the rest does not matter', () => {
  const loud = fresh(2);
  for (const id of CHARGES) plantCharge(loud, id);
  assert.equal(detonate(loud), true, 'the guards need not be down first');
  step(loud, alive);
  assert.equal(loud.phase, PHASE.INFIL);
  hostileDown(loud, 1);
  hostileDown(loud, 0);
  assert.deepEqual(step(loud, alive), [PHASE.MARK]);

  const quiet = fresh(2);
  hostileDown(quiet, 1);
  plantCharge(quiet, 'c4');
  plantCharge(quiet, 'c1');
  hostileDown(quiet, 0);
  plantCharge(quiet, 'c3');
  plantCharge(quiet, 'c2');
  step(quiet, alive);
  assert.equal(quiet.phase, PHASE.INFIL);
  detonate(quiet);
  assert.deepEqual(step(quiet, alive), [PHASE.MARK]);
});

test('the beacon cannot be placed in infil, whatever else is true', () => {
  const m = fresh();
  for (const id of CHARGES) plantCharge(m, id);
  detonate(m);
  hostileDown(m, 0);
  hostileDown(m, 1);
  assert.equal(placeBeacon(m), false);
  assert.equal(m.beacon, false);
  assert.equal(m.phase, PHASE.INFIL);
});

test('setting a charge twice counts once; an unknown charge counts never', () => {
  const m = fresh();
  assert.equal(plantCharge(m, 'c1'), true);
  assert.equal(plantCharge(m, 'c1'), false);
  assert.equal(plantCharge(m, 'canteen'), false);
  assert.equal(m.chargesPlanted, 1);
});

test('a kill counts once; a pursuer that was never on the roll counts never', () => {
  const m = fresh(3);
  assert.equal(hostileDown(m, 2), true);
  assert.equal(hostileDown(m, 2), false);
  assert.equal(hostileDown(m, 99), false);
  assert.equal(hostileDown(m, -1), false);
  assert.equal(m.hostilesDown, 1);
});

test('mark → exfil when the beacon is placed; it can only be placed once', () => {
  const m = fresh();
  readyToMark(m);
  assert.equal(placeBeacon(m), true);
  assert.equal(m.phase, PHASE.EXFIL);
  assert.equal(placeBeacon(m), false);
});

test('the clock runs only in exfil and never goes below zero', () => {
  const m = fresh();
  for (let i = 0; i < 100; i++) step(m, alive);
  assert.equal(m.clock, 60, 'still full in infil');
  readyToMark(m);
  for (let i = 0; i < 100; i++) step(m, alive);
  assert.equal(m.clock, 60, 'still full in mark');
  placeBeacon(m);
  for (let i = 0; i < 100; i++) step(m, alive);
  assert.ok(Math.abs(m.clock - 50) < 1e-6);
  for (let i = 0; i < 1000; i++) step(m, alive);
  assert.equal(m.clock, 0);
});

test('exfil → extracted inside the pickup; exfil → lost when the clock runs out', () => {
  const out = fresh();
  readyToMark(out);
  placeBeacon(out);
  step(out, { ...alive, inPickup: true });
  assert.equal(out.phase, PHASE.EXTRACTED);

  const late = fresh();
  readyToMark(late);
  placeBeacon(late);
  for (let i = 0; i < 601; i++) step(late, alive);
  assert.equal(late.phase, PHASE.LOST);
});

test('standing on the pickup before the beacon is up ends nothing', () => {
  const m = fresh();
  step(m, { ...alive, inPickup: true });
  assert.equal(m.phase, PHASE.INFIL);
  readyToMark(m);
  step(m, { ...alive, inPickup: true });
  assert.equal(m.phase, PHASE.MARK);
});

test('health 0 → down from infil, mark and exfil', () => {
  const a = fresh();
  step(a, { ...alive, health: 0 });
  assert.equal(a.phase, PHASE.DOWN);

  const b = fresh();
  readyToMark(b);
  step(b, { ...alive, health: 0 });
  assert.equal(b.phase, PHASE.DOWN);

  const c = fresh();
  readyToMark(c);
  placeBeacon(c);
  step(c, { ...alive, health: -5 });
  assert.equal(c.phase, PHASE.DOWN);
});

test('same tick: down beats extracted and lost; extracted beats lost', () => {
  const dead = fresh();
  readyToMark(dead);
  placeBeacon(dead);
  dead.clock = 0.05;
  step(dead, { dt: 0.1, health: 0, inPickup: true });
  assert.equal(dead.phase, PHASE.DOWN);

  const justOut = fresh();
  readyToMark(justOut);
  placeBeacon(justOut);
  justOut.clock = 0.05;
  step(justOut, { dt: 0.1, health: 40, inPickup: true });
  assert.equal(justOut.phase, PHASE.EXTRACTED);
});

test('a final phase is final', () => {
  for (const end of ['down', 'lost', 'extracted']) {
    const m = fresh();
    readyToMark(m);
    placeBeacon(m);
    if (end === 'down') step(m, { ...alive, health: 0 });
    if (end === 'lost') for (let i = 0; i < 700; i++) step(m, alive);
    if (end === 'extracted') step(m, { ...alive, inPickup: true });
    const phase = m.phase;
    assert.equal(isFinal(m), true);
    const clock = m.clock;
    step(m, { dt: 5, health: 0, inPickup: true });
    step(m, { dt: 5, health: 100, inPickup: false });
    assert.equal(plantCharge(m, 'c1'), false);
    assert.equal(hostileDown(m, 0), false);
    assert.equal(placeBeacon(m), false);
    assert.equal(detonate(m), false);
    assert.equal(m.phase, phase);
    assert.equal(m.clock, clock);
  }
  // going down with the charges set and nothing blown: the detonator dies with you
  const early = fresh();
  for (const id of CHARGES) plantCharge(early, id);
  step(early, { ...alive, health: 0 });
  assert.deepEqual([canDetonate(early), detonate(early), early.blown], [false, false, false]);
});

test('step reports each change of phase exactly once', () => {
  const m = fresh();
  for (const id of CHARGES) plantCharge(m, id);
  for (let i = 0; i < 3; i++) hostileDown(m, i);
  assert.deepEqual(step(m, alive), []);
  detonate(m);
  assert.deepEqual(step(m, alive), [PHASE.MARK]);
  assert.deepEqual(step(m, alive), []);
  placeBeacon(m);
  assert.deepEqual(step(m, alive), [PHASE.EXFIL]);
  assert.deepEqual(step(m, { ...alive, inPickup: true }), [PHASE.EXTRACTED]);
  assert.deepEqual(step(m, alive), []);
});

test('the objective list follows the mission, and the blast is locked until the cascades are rigged', () => {
  const m = fresh(2);
  const text = () => objectives(m).map((o) => `${o.done ? 'x' : o.locked ? '.' : '-'} ${o.id}`);
  assert.deepEqual(text(), ['- clear', '- rig', '. blow', '. mark', '. exfil']);
  hostileDown(m, 0);
  assert.match(objectives(m)[0].text, /1 \/ 2/);
  for (const id of ['c1', 'c2', 'c3']) plantCharge(m, id);
  assert.match(objectives(m)[1].text, /3 \/ 4/);
  assert.deepEqual(text(), ['- clear', '- rig', '. blow', '. mark', '. exfil']);
  plantCharge(m, 'c4');
  assert.deepEqual(text(), ['- clear', 'x rig', '- blow', '. mark', '. exfil']);
  detonate(m);
  assert.deepEqual(text(), ['- clear', 'x rig', 'x blow', '. mark', '. exfil']);
  hostileDown(m, 1);
  step(m, alive);
  assert.deepEqual(text(), ['x clear', 'x rig', 'x blow', '- mark', '. exfil']);
  placeBeacon(m);
  assert.deepEqual(text(), ['x clear', 'x rig', 'x blow', 'x mark', '- exfil']);
  step(m, { ...alive, inPickup: true });
  assert.deepEqual(text(), ['x clear', 'x rig', 'x blow', 'x mark', 'x exfil']);
});

test('what the objectives say: cascades of centrifuges in a facility — and the word "plant" nowhere', () => {
  const m = fresh();
  const said = objectives(m)
    .map((o) => o.text)
    .join(' | ');
  assert.match(said, /centrifuge cascades/i);
  assert.match(said, /blow the cascades/i);
  assert.doesNotMatch(said, /plant/i, said);
});

test('a mission with no hostiles on the roll needs the charges and the blast, and nothing else', () => {
  const m = fresh(0);
  for (const id of CHARGES) plantCharge(m, id);
  step(m, alive);
  assert.equal(m.phase, PHASE.INFIL);
  detonate(m);
  step(m, alive);
  assert.equal(m.phase, PHASE.MARK);
});
