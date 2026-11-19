// The uplink (src/wild/uplink.js): the rules of taking a machine — the hold, the recharge, whom a turned machine
// fires on — with no browser in them. The wild branch's experiment: docs/WILD.md, "The uplink".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPLINK, WITNESS, createUplink, pickFoe, stepUplink, witnessed, witnessesOf } from '../../src/wild/uplink.js';

const run = (u, seconds, now, dt = 1 / 60) => {
  const said = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) said.push(...stepUplink(u, { dt, ...now }));
  return said;
};

test('held on a machine in the sights for a little over a second, the uplink has it — and then must recharge', () => {
  const u = createUplink();
  assert.deepEqual([u.target, u.progress, u.cool], [null, 0, 0]);
  const said = run(u, UPLINK.hold - 0.1, { held: true, target: 7 });
  assert.deepEqual(said, ['begin']);
  assert.equal(u.target, 7);
  assert.ok(u.progress > 0.85 && u.progress < 1, `after a second it is ${u.progress} of the way`);
  const end = run(u, 0.2, { held: true, target: 7 });
  assert.deepEqual(end, ['done']);
  assert.equal(u.taken, 7, 'which machine it was');
  assert.deepEqual([u.target, u.progress], [null, 0]);
  assert.equal(u.cool > UPLINK.recharge - 0.2, true);
  // while it recharges nothing is built up. The key still down from the taking says nothing…
  assert.deepEqual(run(u, 1, { held: true, target: 9 }), []);
  assert.equal(u.progress, 0);
  // …and pressed again, it says so: once for each time the key goes down
  assert.deepEqual(run(u, 0.5, { held: false, target: 9 }), []);
  assert.deepEqual(run(u, 0.5, { held: true, target: 9 }), ['cold']);
  assert.deepEqual(run(u, 0.5, { held: true, target: 9 }), []);
  // …and when it has, it can be done again
  run(u, UPLINK.recharge, { held: false, target: null });
  assert.equal(u.cool, 0);
  assert.deepEqual(run(u, UPLINK.hold + 0.1, { held: true, target: 9 }), ['begin', 'done']);
  assert.equal(u.taken, 9);
});

test('let go early, or with the eye off the machine, what was built up runs down — twice as fast — and nothing is taken', () => {
  const u = createUplink();
  run(u, 0.55, { held: true, target: 3 });
  const built = u.progress;
  assert.ok(Math.abs(built - 0.55 / UPLINK.hold) < 0.03);
  // the key let go
  run(u, 0.1, { held: false, target: 3 });
  assert.ok(Math.abs(u.progress - (built - (0.1 * UPLINK.slip) / UPLINK.hold)) < 0.03, `it is at ${u.progress}`);
  // the eye off it, the key still down: the same
  const before = u.progress;
  run(u, 0.1, { held: true, target: null });
  assert.ok(u.progress < before);
  const said = run(u, 1, { held: true, target: null });
  assert.deepEqual(said, ['lost']);
  assert.deepEqual([u.target, u.progress, u.cool], [null, 0, 0], 'nothing was spent');
});

test('the eye moved to another machine: it starts again from nothing on that one', () => {
  const u = createUplink();
  run(u, 0.8, { held: true, target: 3 });
  const said = run(u, 0.3, { held: true, target: 4 });
  assert.deepEqual(said, ['begin']);
  assert.equal(u.target, 4);
  assert.ok(u.progress < 0.3 / UPLINK.hold + 0.03, `it is at ${u.progress} on the new one`);
});

test('the progress never leaves 0 … 1, whatever the frame', () => {
  const u = createUplink();
  assert.deepEqual(stepUplink(u, { dt: 30, held: true, target: 1 }), ['begin', 'done']);
  assert.equal(u.progress, 0);
  const v = createUplink();
  stepUplink(v, { dt: 0.5, held: true, target: 1 });
  stepUplink(v, { dt: 30, held: false, target: null });
  assert.equal(v.progress, 0);
});

// 17 November 2026 — the owner: "also limit the number of focus and uplinks a use can do". Replaces the old
// test's implicit "it can be done again" without end: a use is spent only when a link completes, and there are
// three a mission.
test('UPLINK: three uses a mission, spent only when a link completes — a fourth is refused, said once, and builds nothing', () => {
  const u = createUplink();
  for (let n = 0; n < UPLINK.uses; n++) {
    const said = run(u, UPLINK.hold + 0.1, { held: true, target: n + 1 });
    assert.deepEqual(said, ['begin', 'done']);
    assert.equal(u.taken, n + 1);
    assert.equal(u.usesLeft, UPLINK.uses - n - 1);
    // the 28-second recharge between two links stays, whether or not any are left after
    run(u, UPLINK.recharge, { held: false, target: null });
  }
  assert.equal(u.usesLeft, 0);
  assert.equal(u.cool, 0, 'the last recharge still finishes on schedule');
  // none left: held on a machine, nothing is built, and it says so once a press
  assert.deepEqual(run(u, 1, { held: true, target: 99 }), ['none']);
  assert.equal(u.progress, 0);
  assert.deepEqual(run(u, 1, { held: true, target: 99 }), []);
  // let go and held again: said again, once
  assert.deepEqual(run(u, 0.3, { held: false, target: 99 }), []);
  assert.deepEqual(run(u, 0.3, { held: true, target: 99 }), ['none']);
});

const unit = (x, z, o = {}) => ({ x, z, dead: false, turned: 0, ...o });

test('whom a turned machine fires on: the nearest of its own kind that it has a clear line to, within its range', () => {
  const me = unit(0, 0, { turned: 30 });
  const near = unit(5, 0);
  const far = unit(12, 0);
  const all = [me, far, near];
  const clear = () => true;
  assert.equal(pickFoe(me, all, clear), near);
  // not one it cannot see
  assert.equal(
    pickFoe(me, all, (a, b) => b !== near),
    far,
  );
  // not the dead, not another turned machine, not itself, not one out of range
  near.dead = true;
  far.turned = 12;
  assert.equal(pickFoe(me, all, clear), null);
  const out = unit(UPLINK.turned.range + 1, 0);
  assert.equal(pickFoe(me, [me, out], clear), null);
  const edge = unit(UPLINK.turned.range - 1, 0);
  assert.equal(pickFoe(me, [me, out, edge], clear), edge);
  // …and for a loyal machine looking for a turned one to fire back at, it is the other way round
  const loyal = unit(0, 0);
  const mine = unit(6, 0, { turned: 20 });
  assert.equal(pickFoe(loyal, [loyal, unit(3, 0), mine], clear, { range: 36 }), mine);
  assert.equal(pickFoe(loyal, [loyal, unit(3, 0)], clear, { range: 36 }), null);
});

test('the numbers hold together', () => {
  assert.ok(UPLINK.hold > 0.5 && UPLINK.hold < 2, 'long enough to be a risk, short enough to be done under fire');
  assert.ok(UPLINK.recharge < UPLINK.turned.seconds, 'two can be yours at once, for a while');
  assert.ok(UPLINK.reach > 15 && UPLINK.reach <= 30);
  assert.ok(UPLINK.turned.damage * 4 >= 100, 'four of its rounds are a sentry');
  assert.ok(UPLINK.turned.back.damage < UPLINK.turned.damage, 'it gives better than it gets');
  assert.ok(UPLINK.turned.heel > 2);
  assert.ok(UPLINK.uses >= 1 && UPLINK.uses <= 5, 'a count worth having, not a flood');
});

// 17 November 2026 — the owner: "once other robots see that their friends are being fired at" the alarm must go
// up — not only once a loyal machine has itself been hit. witnessesOf() is the pure part: who counts.
const watcher = (x, z, view, o = {}) => ({ x, z, dead: false, turned: 0, stunT: 0, spec: { view }, ...o });

test('witnessesOf: the one fired at always counts, even with no line to anything', () => {
  const shooter = watcher(0, 0, 20, { turned: 30 });
  const victim = watcher(10, 0, 20);
  assert.deepEqual(
    witnessesOf(shooter, victim, [shooter, victim], () => false),
    [victim],
  );
});

test('witnessesOf: a loyal machine with a clear line to the victim, within its own view × 1.3, has seen it', () => {
  const shooter = watcher(0, 0, 20, { turned: 30 });
  const victim = watcher(10, 0, 20);
  const near = watcher(10, 5, 20); // 5 m from the victim, 20 × 1.3 = 26 m range
  const units = [shooter, victim, near];
  assert.deepEqual(
    witnessesOf(shooter, victim, units, (a, b) => b === victim),
    [victim, near],
  );
});

test('witnessesOf: a loyal machine with a clear line to the shooter instead (its back to the victim) still counts', () => {
  const shooter = watcher(0, 0, 20, { turned: 30 });
  const victim = watcher(10, 0, 20);
  const near = watcher(2, 4, 20); // close to the shooter, nowhere near the victim
  const units = [shooter, victim, near];
  assert.deepEqual(
    witnessesOf(shooter, victim, units, (a, b) => b === shooter),
    [victim, near],
  );
});

test('witnessesOf: outside its own view × 1.3 of both, or with a clear line to neither, it has not seen it', () => {
  const shooter = watcher(0, 0, 20, { turned: 30 });
  const victim = watcher(10, 0, 20);
  const clear = () => true;
  const far = watcher(10, 100, 20); // a clear line, but far past 20 × 1.3 of either
  const blind = watcher(10, 5, 20); // within range of the victim, but nothing clear
  assert.deepEqual(witnessesOf(shooter, victim, [shooter, victim, far], clear), [victim]);
  assert.deepEqual(
    witnessesOf(shooter, victim, [shooter, victim, blind], () => false),
    [victim],
  );
  // the edge of its own view × 1.3 holds; one step past it does not
  const edge = watcher(10, 20 * WITNESS.range - 0.5, 20);
  const past = watcher(10, 20 * WITNESS.range + 0.5, 20);
  assert.deepEqual(witnessesOf(shooter, victim, [shooter, victim, edge], clear), [victim, edge]);
  assert.deepEqual(witnessesOf(shooter, victim, [shooter, victim, past], clear), [victim]);
});

test('witnessesOf: not one that is itself turned, dead, or stunned — only loyal, running, unstunned machines', () => {
  const shooter = watcher(0, 0, 20, { turned: 30 });
  const victim = watcher(10, 0, 20);
  const clear = () => true;
  const turnedToo = watcher(10, 5, 20, { turned: 12 });
  const dead = watcher(10, 5, 20, { dead: true });
  const stunned = watcher(10, 5, 20, { stunT: 2 });
  const units = [shooter, victim, turnedToo, dead, stunned];
  assert.deepEqual(witnessesOf(shooter, victim, units, clear), [victim]);
});

test('witnessesOf: more than one witness, each by its own line — all of them are named', () => {
  const shooter = watcher(0, 0, 20, { turned: 30 });
  const victim = watcher(10, 0, 20);
  const bySight = watcher(10, 3, 20);
  const byShooter = watcher(1, 1, 20);
  const units = [shooter, victim, bySight, byShooter];
  const seen = witnessesOf(shooter, victim, units, (a, b) => (a === bySight ? b === victim : b === shooter));
  assert.deepEqual(seen, [victim, bySight, byShooter]);
});

test('the numbers around a witnessed shot hold together', () => {
  assert.ok(WITNESS.range > 1, 'further than a plain sighting, the way an alerted machine already sees further');
  assert.ok(WITNESS.alarmDelay > 0 && WITNESS.alarmDelay <= 4, 'faster than a lone fight calls it on its own');
  assert.ok(WITNESS.noise >= UPLINK.turned.range * 0.5, 'carries well past where a line of sight would reach');
});

// fix (the lead, after review, 17 November 2026): "the first such shot starts the clock" — a second of the
// player's machines firing while the first shot's alarm is still pending must not restart or rename it.
test('witnessed: the record is made once, by the first shot — a second shooter neither renames it nor restarts its clock, and witnesses from both are kept', () => {
  const first = watcher(0, 0, 20, { turned: 30 });
  const second = watcher(5, 5, 20, { turned: 30 });
  const w1 = watcher(1, 1, 20);
  const w2 = watcher(2, 2, 20);
  const pending = witnessed(null, first, [w1]);
  assert.deepEqual([pending.shooter, pending.t, [...pending.witnesses]], [first, 0, [w1]]);
  // the clock has run a while (step() ticking it) before the second machine fires
  pending.t = 1.8;
  const again = witnessed(pending, second, [w2]);
  assert.equal(again, pending, 'the same record — not thrown away and rebuilt');
  assert.equal(again.shooter, first, 'still named at the first shooter, not the second');
  assert.equal(again.t, 1.8, 'its running clock was not restarted');
  assert.deepEqual([...again.witnesses], [w1, w2], 'witnesses of both shots are kept');
});
