// Contract lock: a reload that looks like one (src/reload.js). Pure — no three.js, no browser.
//
// Decision of 16 November 2026 — the owner: "make the reload animation more realistic and make a sound". Until
// then a reload sank the gun out of the picture for two seconds and brought it back: the magazine moved, below
// the frame, and no hand did anything. What a reload is now is a choreography, written down as data: what the
// gun, the support hand, the magazine (or the shell) and the bolt do at each moment, and when each sound comes.
//
// What was decided, and is held here (nobody was asked; each is data in that one file):
//   - the gun stays in the picture — it is brought up and canted, not sunk;
//   - the hand leaves the fore-end, takes the magazine out, goes away for a fresh one, seats it, and comes back;
//   - a gun that had run DRY has its bolt held open, and the reload ends by letting it go, with the sound of it.
//     One with a round still in the chamber has no bolt to work and makes no such sound. Both take as long;
//   - with a machine held on the other arm there is no hand to show: the gun goes down out of the picture, as it
//     always did;
//   - how long a reload takes, and when its rounds are counted, are what they were (src/arms.js; its own lock).
// What it does to the parts of the model, and what is asked of the sound, is held in a browser
// (test/smoke.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUNS } from '../../src/arms.js';
import { RELOAD, blankPose, reloadCues, reloadPose } from '../../src/reload.js';
import { SOUNDS } from '../../src/audio/sounds.js';

const KINDS = ['carbine', 'pistol', 'shotgun'];
const MAGAZINES = ['carbine', 'pistol'];
/** every way a reload can go, for one gun */
const WAYS = (kind) =>
  kind === 'shotgun'
    ? [{ first: true }, { first: false }, { first: true, held: true }]
    : [{ dry: false }, { dry: true }, { dry: false, held: true }, { dry: true, held: true }];
const say = (kind, how) => `${kind} ${JSON.stringify(how)}`;
const poseAt = (kind, t, how) => reloadPose(kind, t, how, blankPose());
const far = (v) => Math.hypot(v[0], v[1], v[2]);
const STEPS = 480;

test('a reload begins and ends with everything where it was: the gun, the hand, the magazine', () => {
  for (const kind of KINDS)
    for (const how of WAYS(kind)) {
      // The shotgun is loaded a shell at a time, and each shell is a cycle of its own: only the first begins at
      // rest, and none ends there — a cycle ends with the hand at the port, where the next begins. What is left
      // of the pose when the loading stops is let go of by src/weapon.js, and held to that in a browser.
      const ends = kind === 'shotgun' ? (how.first ? [0] : []) : [0, 1];
      for (const t of ends) {
        const p = poseAt(kind, t, how);
        for (const part of ['gun', 'hand', 'mag'])
          for (const [k, v] of p[part].entries())
            assert.ok(Math.abs(v) < 1e-9, `${say(kind, how)}: ${part}[${k}] is ${v} at t = ${t}`);
      }
    }
  // a magazine gun's bolt is shut when the reload ends, however it began
  for (const kind of MAGAZINES)
    for (const how of WAYS(kind)) assert.equal(poseAt(kind, 1, how).bolt, 0, `${say(kind, how)}: the bolt at the end`);
});

test('nothing jumps: between two moments a 480th of the reload apart, no part moves more than a part can', () => {
  for (const kind of KINDS)
    for (const how of WAYS(kind)) {
      const seconds = GUNS[kind].reload;
      let before = poseAt(kind, 0, how);
      for (let n = 1; n <= STEPS; n++) {
        const now = poseAt(kind, n / STEPS, how);
        const dt = seconds / STEPS;
        for (const part of ['gun', 'hand', 'mag']) {
          // a shell that is not to be seen has no place: it is where it is from the moment it is shown
          if (part === 'mag' && kind === 'shotgun' && !(now.shown && before.shown)) continue;
          const moved = Math.hypot(
            now[part][0] - before[part][0],
            now[part][1] - before[part][1],
            now[part][2] - before[part][2],
          );
          const turned = Math.hypot(
            now[part][3] - before[part][3],
            now[part][4] - before[part][4],
            now[part][5] - before[part][5],
          );
          // a hand moves fast — six metres a second at the outside — and nothing turns faster than 25 rad/s
          assert.ok(
            moved / dt < 6,
            `${say(kind, how)}: ${part} moves at ${(moved / dt).toFixed(1)} m/s at t = ${(n / STEPS).toFixed(3)}`,
          );
          assert.ok(
            turned / dt < 25,
            `${say(kind, how)}: ${part} turns at ${(turned / dt).toFixed(1)} rad/s at t = ${(n / STEPS).toFixed(3)}`,
          );
        }
        before = now;
      }
    }
});

test('the gun stays in the picture: it is brought up and canted, not sunk — unless a machine is held on the other arm', () => {
  for (const kind of KINDS) {
    const how = kind === 'shotgun' ? { first: true } : { dry: true };
    const mid = poseAt(kind, kind === 'shotgun' ? 0.9 : 0.45, how);
    assert.ok(mid.gun[1] >= 0, `${kind}: mid-reload the gun is ${mid.gun[1]} m from where it is held, downwards`);
    assert.ok(Math.abs(mid.gun[5]) > 0.25, `${kind}: mid-reload it is canted by ${mid.gun[5]} rad`);
    // with a machine held: down and away, as it was before 16 November 2026 — and the hand does nothing
    const held = kind === 'shotgun' ? { first: true, held: true } : { dry: true, held: true };
    const low = poseAt(kind, kind === 'shotgun' ? 0.9 : 0.45, held);
    assert.ok(low.gun[1] < -0.05, `${kind}, a machine held: the gun is at ${low.gun[1]}`);
    for (let n = 0; n <= 40; n++)
      assert.ok(far(poseAt(kind, n / 40, held).hand) < 1e-9, `${kind}, a machine held: the hand moves at ${n / 40}`);
  }
});

test('a magazine change, in order: out, the hand away with it, back with another, home — and only then the bolt', () => {
  for (const kind of MAGAZINES)
    for (const dry of [false, true]) {
      const how = { dry };
      const R = RELOAD[kind];
      const cues = reloadCues(kind, how);
      const at = (name) => cues.find((c) => c[1] === name)?.[0];
      const out = at('reloadOut');
      const home = at('reloadIn');
      assert.ok(out > 0.05 && out < 0.35, `${kind}: the magazine comes out at ${out}`);
      assert.ok(home > out + 0.25 && home < 0.8, `${kind}: the next is home at ${home}`);
      // before it is let go the magazine is in the well, and once it is home it stays there
      for (let n = 0; n <= STEPS; n++) {
        const t = n / STEPS;
        const p = poseAt(kind, t, how);
        if (t <= out - 0.01)
          assert.ok(
            far(p.mag) < 0.004,
            `${kind}: the magazine is ${far(p.mag)} out of the well at ${t}, before it is let go`,
          );
        if (t >= home + 0.012)
          assert.ok(
            far(p.mag) < 0.004,
            `${kind}: the magazine is ${far(p.mag)} out of the well at ${t}, after it was seated`,
          );
      }
      // between the two it goes right away: below anything the picture shows
      let lowest = 0;
      let handLowest = 0;
      for (let n = 0; n <= STEPS; n++) {
        const p = poseAt(kind, n / STEPS, how);
        lowest = Math.min(lowest, p.mag[1]);
        handLowest = Math.min(handLowest, p.hand[1]);
      }
      assert.ok(lowest < -R.away, `${kind}: the magazine goes ${-lowest} m down; out of the picture is ${R.away}`);
      assert.ok(handLowest < -R.away, `${kind}: the hand goes ${-handLowest} m down for the next one`);
      // the seat is the sound of the magazine ARRIVING: at the cue it is within a centimetre of home, and a
      // fiftieth of the reload before it, it was not
      assert.ok(
        far(poseAt(kind, home, how).mag) < 0.01,
        `${kind}: at the sound of the seat the magazine is ${far(poseAt(kind, home, how).mag)} from home`,
      );
      assert.ok(
        far(poseAt(kind, home - 0.02, how).mag) > 0.012,
        `${kind}: the magazine was home before the sound of it`,
      );
      // …and the release is the sound of it LEAVING
      assert.ok(
        far(poseAt(kind, out + 0.03, how).mag) > 0.008,
        `${kind}: the magazine has not moved a moment after its release sounded`,
      );

      // the hand: off the fore-end all the while the magazine is out of the gun, and back on it at the end
      for (let n = 0; n <= STEPS; n++) {
        const t = n / STEPS;
        if (t > out && t < home)
          assert.ok(
            far(poseAt(kind, t, how).hand) > 0.05,
            `${kind}: the hand is on the fore-end at ${t}, with no magazine in the gun`,
          );
      }

      // the bolt
      const rack = at('boltRack');
      if (dry) {
        assert.ok(
          rack > home + 0.05 && rack < 0.92,
          `${kind}, dry: the bolt goes at ${rack}; the magazine was home at ${home}`,
        );
        assert.equal(poseAt(kind, 0, how).bolt, 1, `${kind}, dry: the bolt is held open from the start`);
        assert.equal(poseAt(kind, rack - 0.01, how).bolt, 1, `${kind}, dry: …until it is let go`);
        assert.ok(poseAt(kind, rack + 0.03, how).bolt < 0.05, `${kind}, dry: and then it is shut at once`);
      } else {
        assert.equal(rack, undefined, `${kind}, a round in the chamber: there is no bolt to work, and no sound of one`);
        for (let n = 0; n <= 60; n++) assert.equal(poseAt(kind, n / 60, how).bolt, 0);
      }
    }
});

test('while the magazine is in the hand the two move together', () => {
  for (const kind of MAGAZINES) {
    const how = { dry: true };
    const R = RELOAD[kind];
    // from the moment the hand has it to the moment it is home: `carried` says when (a pistol's old magazine
    // falls by itself; only the new one is carried)
    const [from, to] = R.carried;
    const gap = (t) => {
      const p = poseAt(kind, t, how);
      return [p.mag[0] - p.hand[0], p.mag[1] - p.hand[1], p.mag[2] - p.hand[2]];
    };
    const first = gap(from);
    for (let n = 0; n <= 100; n++) {
      const t = from + ((to - from) * n) / 100;
      const g = gap(t);
      const drift = Math.hypot(g[0] - first[0], g[1] - first[1], g[2] - first[2]);
      assert.ok(
        drift < 0.012,
        `${kind}: at ${t.toFixed(3)} the magazine is ${drift.toFixed(3)} m from where the hand holds it`,
      );
    }
  }
});

test('a shell at a time: the hand goes for one, comes to the port with it and pushes it in — at the end of its half second', () => {
  const R = RELOAD.shotgun;
  const how = { first: false };
  const cues = reloadCues('shotgun', how);
  const push = cues.find((c) => c[1] === 'shellIn')?.[0];
  // a shell is counted when its half second is up (src/arms.js): the sound of it going in is not long before —
  // a pull of the trigger that stops the loading must not leave a shell that was heard and is not there
  assert.ok(push > 0.7 && push < 0.95, `the shell goes in at ${push}`);
  // the shell is to be seen only while it is being brought and pushed
  const [from, to] = R.shown;
  assert.ok(from > 0.2 && from < push && to >= push && to < 0.98, `the shell is shown from ${from} to ${to}`);
  for (let n = 0; n <= 100; n++) {
    const t = n / 100;
    assert.equal(poseAt('shotgun', t, how).shown, t >= from && t <= to, `the shell at ${t}`);
  }
  // a cycle begins and ends with the hand at the port, so that one follows another without a jump…
  const begin = poseAt('shotgun', 0, how);
  const end = poseAt('shotgun', 1, how);
  for (let k = 0; k < 6; k++)
    assert.ok(Math.abs(begin.hand[k] - end.hand[k]) < 1e-9, 'a cycle does not close on itself');
  assert.ok(far(begin.hand) > 0.15, 'between shells the hand is back on the pump');
  // …and in between it goes right away for the next shell: below anything the picture shows
  let lowest = 0;
  for (let n = 0; n <= 100; n++) lowest = Math.min(lowest, poseAt('shotgun', n / 100, how).hand[1]);
  assert.ok(lowest < -R.away, `the hand goes ${-lowest} m down for the next shell; out of the picture is ${R.away}`);
  // at the sound of it the shell is at the port, and going forward into the tube
  assert.ok(far(poseAt('shotgun', push, how).mag) < 0.035, 'at the sound of it the shell is not at the port');
  assert.ok(poseAt('shotgun', to, how).mag[2] < -0.03, 'the shell does not go forward into the tube');
  // while it is carried it is in the hand
  const gap = (t) => {
    const p = poseAt('shotgun', t, how);
    return [p.mag[0] - p.hand[0], p.mag[1] - p.hand[1], p.mag[2] - p.hand[2]];
  };
  const first = gap(from);
  for (let n = 0; n <= 50; n++) {
    const t = from + ((R.carried[1] - from) * n) / 50;
    const g = gap(t);
    assert.ok(
      Math.hypot(g[0] - first[0], g[1] - first[1], g[2] - first[2]) < 1e-9,
      `the shell leaves the hand at ${t}`,
    );
  }
  // the gun is held canted, and still, for as long as shells go in
  for (let n = 0; n <= 20; n++) {
    const p = poseAt('shotgun', n / 20, how);
    for (let k = 0; k < 6; k++) assert.equal(p.gun[k], begin.gun[k], 'the gun does not hold still between shells');
  }
  assert.ok(Math.abs(begin.gun[5]) > 0.25);
  // the first shell: the gun comes up from where it is held, and the hand comes off the pump
  assert.ok(far(poseAt('shotgun', 0, { first: true }).hand) < 1e-9);
  assert.ok(far(poseAt('shotgun', 0, { first: true }).gun) < 1e-9);
  assert.deepEqual(poseAt('shotgun', 1, { first: true }), end, 'the first shell does not end where every other does');
});

test('the sounds of a reload are sounds the game has, in order, each in its moment — and a reload is as long as it was', () => {
  for (const kind of KINDS)
    for (const how of WAYS(kind)) {
      const cues = reloadCues(kind, how);
      assert.ok(cues.length >= (kind === 'shotgun' ? 1 : 2), `${say(kind, how)}: ${cues.length} sounds`);
      let before = -1;
      for (const [at, name, gain, rate] of cues) {
        assert.ok(SOUNDS[name], `${say(kind, how)}: there is no sound called ${name}`);
        assert.ok(at > before && at > 0 && at < 1, `${say(kind, how)}: ${name} at ${at}, after one at ${before}`);
        assert.ok(gain > 0.2 && gain <= 2.5, `${say(kind, how)}: ${name} is played at ${gain}`);
        assert.ok(rate === undefined || (rate > 0.6 && rate < 1.8), `${say(kind, how)}: ${name} at a rate of ${rate}`);
        before = at;
      }
      // the same sounds whether or not a machine is held: only the bolt's is a matter of dry or not
      if (how.held) {
        const free = reloadCues(kind, { ...how, held: false });
        assert.deepEqual(
          cues.map((c) => c[1]),
          free.map((c) => c[1]),
        );
      }
    }
  // what a reload costs in time is src/arms.js's to say, and it says what it said
  assert.deepEqual([GUNS.carbine.reload, GUNS.pistol.reload, GUNS.shotgun.reload], [2.1, 1.5, 0.5]);
});

test('a moment before the start or after the end is the start or the end: nothing is worked out from outside the reload', () => {
  for (const kind of KINDS) {
    const how = kind === 'shotgun' ? { first: true } : { dry: true };
    assert.deepEqual(poseAt(kind, -0.3, how), poseAt(kind, 0, how));
    assert.deepEqual(poseAt(kind, 1.7, how), poseAt(kind, 1, how));
  }
  // and a gun the file does not know is given nothing to do
  const none = poseAt('crossbow', 0.5, {});
  assert.deepEqual(none, blankPose());
  assert.deepEqual(reloadCues('crossbow', {}), []);
});
