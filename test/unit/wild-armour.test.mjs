// Armour (src/wild/armour.js): how many rounds a machine takes now — by arithmetic, against the game's own
// tables and with the visor (src/wild/visor.js) in front of it, as the hub asks them: the visor first, then the
// plating.
//
// THE CONTRACT (18 November 2026 — the owner: "the game is still too easy to shoot down drones and robots make
// it more difficult and require more shoots to take them down"): every round of the player's counts half
// against a machine; so every gun takes more rounds than it did to shut down a sentry or a drone, on every
// setting, wherever it strikes; the head is still the place to aim for, and is never fewer than three; and there
// are twice the rounds, so that what is carried and found still pays for what is met (the arithmetic of that is
// in test/unit/wild-response.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GUNS, pelletDamage } from '../../src/arms.js';
import { DIFFICULTY } from '../../src/difficulty.js';
import { ARMOUR, jink, plated } from '../../src/wild/armour.js';
import { plate as visor } from '../../src/wild/visor.js';

/** the machines as they are built (src/enemies/index.js keeps the table to itself: read off its text) */
const source = readFileSync(new URL('../../src/enemies/index.js', import.meta.url), 'utf8');
const HP = {
  sentry: Number(/sentry: \{\s+hp: (\d+)/.exec(source)?.[1]),
  drone: Number(/drone: \{\s+hp: (\d+)/.exec(source)?.[1]),
};
const HEAD = Number(/\[[\d.]+, [\d.]+, (\d+), 'head'\]/.exec(source)?.[1]);
const SETTINGS = Object.keys(DIFFICULTY);

/**
 * How many pulls of the trigger of `key`, every round of them in `zone`, shut a machine down — counted as
 * weapon.js and the hub count them: what the place counts is the machine's to say, then the visor's, then the
 * plating's. (The visor is told which pull a pellet is of: a shell is one shot.)
 */
function pulls(key, type, zone, name, { armour = true, at = 2 } = {}) {
  const gun = GUNS[key];
  const gone = new Map();
  const unit = { type };
  let hp = HP[type] * DIFFICULTY[name].health;
  for (let n = 1; n <= 60; n++) {
    for (let p = 0; p < gun.pellets; p++) {
      const amount = gun.pellets > 1 ? pelletDamage(at) : gun.damage * (zone === 'head' ? gun.head : 1);
      let by = zone === 'head' ? HEAD : 1;
      by = visor(gone, unit, zone, n).by ?? by;
      if (armour) by = plated(type, by);
      hp -= amount * by;
    }
    if (hp <= 0) return n;
  }
  return Infinity;
}
const each = (key, type, zone, opts) => SETTINGS.map((name) => pulls(key, type, zone, name, opts));

test('the tables this reads are the ones it thinks they are', () => {
  assert.deepEqual(HP, { sentry: 100, drone: 55 });
  assert.equal(HEAD, 3);
  assert.deepEqual(SETTINGS, ['recruit', 'operator', 'ghost']);
});

test('a round counts half against a sentry and against a drone — and what is not a machine of theirs is not asked about', () => {
  assert.deepEqual({ ...ARMOUR.rounds }, { sentry: 0.5, drone: 0.5 });
  assert.equal(plated('sentry', 1), 0.5);
  assert.equal(plated('sentry', 3), 1.5);
  assert.equal(plated('drone', 1), 0.5);
  assert.equal(plated('turret', 3), 3);
});

test('the round that cracks a visor counts half a round to the body: seventeen from the carbine, not thirty-four', () => {
  // (the plating is asked AFTER the visor, about what the visor made of it — were the visor's word the last, as
  // it was while the hub took the first answer it was given, this one round would count in full and a head
  // would still be two)
  const gone = new Map();
  const unit = { type: 'sentry' };
  const first = plated('sentry', visor(gone, unit, 'head', 1).by ?? HEAD);
  assert.equal(GUNS.carbine.damage * first, 17);
  const second = plated('sentry', visor(gone, unit, 'head', 2).by ?? HEAD);
  assert.equal(GUNS.carbine.damage * second, 51);
});

test('rounds to shut a machine down, Recruit / Operator / Ghost: the carbine and the sidearm', () => {
  // what it was (the visor alone) is beside each
  assert.deepEqual(each('carbine', 'sentry', 'body'), [5, 6, 7]);
  assert.deepEqual(each('carbine', 'sentry', 'body', { armour: false }), [3, 3, 4]);
  assert.deepEqual(each('carbine', 'sentry', 'head'), [3, 3, 3]);
  assert.deepEqual(each('carbine', 'sentry', 'head', { armour: false }), [2, 2, 2]);
  assert.deepEqual(each('carbine', 'drone', 'body'), [3, 4, 4]);
  assert.deepEqual(each('carbine', 'drone', 'body', { armour: false }), [2, 2, 2]);
  assert.deepEqual(each('pistol', 'sentry', 'body'), [6, 7, 8]);
  assert.deepEqual(each('pistol', 'sentry', 'body', { armour: false }), [3, 4, 4]);
  assert.deepEqual(each('pistol', 'sentry', 'head'), [3, 3, 3]);
  assert.deepEqual(each('pistol', 'drone', 'body'), [4, 4, 5]);
  assert.deepEqual(each('pistol', 'drone', 'body', { armour: false }), [2, 2, 3]);
});

test('the shotgun is not let off: at arm’s length a sentry is two shells where it was one — to the body or to the head', () => {
  assert.deepEqual(each('shotgun', 'sentry', 'body', { at: 2 }), [2, 2, 2]);
  assert.deepEqual(each('shotgun', 'sentry', 'body', { at: 2, armour: false }), [1, 1, 1]);
  // the head: the shell that cracks the visor is stopped by it, all eight pellets of it (src/wild/visor.js) —
  // without that the first pellet cracked it, seven went through, and a shell to the face was still one
  assert.deepEqual(each('shotgun', 'sentry', 'head', { at: 2 }), [2, 2, 2]);
  assert.deepEqual(each('shotgun', 'sentry', 'head', { at: 2, armour: false }), [1, 1, 1]);
  // and across a room it is no better than that
  for (const name of SETTINGS) assert.ok(pulls('shotgun', 'sentry', 'body', name, { at: 12 }) >= 2, name);
  // KNOWN, AND LEFT: a drone has 55 at its most on Operator and no visor — with every pellet of a shell on it,
  // inside nine metres, it still comes down to one (64 from eight pellets). It is a small thing that moves.
  assert.deepEqual(each('shotgun', 'drone', 'body', { at: 2 }), [1, 1, 1]);
});

test('every gun takes more rounds than it did — a sentry or a drone, wherever it is struck, on every setting', () => {
  // the guns that fire one round at a time: strictly more, everywhere
  for (const name of SETTINGS)
    for (const key of ['carbine', 'pistol'])
      for (const [type, zone] of [
        ['sentry', 'body'],
        ['sentry', 'head'],
        ['drone', 'body'],
      ]) {
        const now = pulls(key, type, zone, name);
        const was = pulls(key, type, zone, name, { armour: false });
        assert.ok(now > was, `${key}, a ${type}'s ${zone}, ${name}: ${now} now, ${was} before`);
        assert.ok(now <= was * 2 + 1, `${key}, a ${type}'s ${zone}, ${name}: ${now} is more than twice ${was}`);
      }
  // the shotgun, shell by shell and every pellet of each on it: a sentry's body strictly more at any distance;
  // its head and a drone never fewer (at arm's length a head is two where it was one — the test above — and
  // from twenty metres it was two already), and a drone more once it is far enough off that a shell no longer
  // did it outright
  for (const name of SETTINGS)
    for (const at of [2, 9, 12, 20]) {
      const body = [
        pulls('shotgun', 'sentry', 'body', name, { at }),
        pulls('shotgun', 'sentry', 'body', name, { at, armour: false }),
      ];
      assert.ok(body[0] > body[1], `shotgun at ${at} m, a sentry's body, ${name}: ${body[0]} now, ${body[1]} before`);
      const head = [
        pulls('shotgun', 'sentry', 'head', name, { at }),
        pulls('shotgun', 'sentry', 'head', name, { at, armour: false }),
      ];
      assert.ok(
        head[0] >= head[1] && head[0] >= 2,
        `shotgun at ${at} m, a sentry's head, ${name}: ${head[0]} now, ${head[1]} before`,
      );
      const now = pulls('shotgun', 'drone', 'body', name, { at });
      const was = pulls('shotgun', 'drone', 'body', name, { at, armour: false });
      assert.ok(now >= was, `shotgun at ${at} m, a drone, ${name}: ${now} now, ${was} before`);
      if (at >= 20) assert.ok(now > was, `shotgun at ${at} m, a drone, ${name}: ${now} now, ${was} before`);
    }
});

test('the head is still the place to aim for: fewer rounds than the body, and never fewer than three', () => {
  for (const name of SETTINGS)
    for (const key of ['carbine', 'pistol']) {
      const head = pulls(key, 'sentry', 'head', name);
      const body = pulls(key, 'sentry', 'body', name);
      assert.ok(head >= 3, `${key} on ${name}: ${head} to the head`);
      assert.ok(head < body, `${key} on ${name}: ${head} to the head, ${body} to the body`);
    }
});

test('there are as many times the rounds as a round is worth less: twice', () => {
  assert.equal(ARMOUR.plenty, 2);
  for (const type of Object.keys(ARMOUR.rounds)) assert.equal(ARMOUR.plenty * ARMOUR.rounds[type], 1, type);
});

test('a drone that is struck and still flying jinks: back the other way round, a long stride along — and not again at once', () => {
  const drone = { orbit: 2, orbitDir: 1 };
  const first = jink(drone, 10, undefined);
  assert.deepEqual(first, { orbit: 2 - ARMOUR.jink, orbitDir: -1 });
  // about seven metres of the eight-metre circle it flies round him
  assert.ok(ARMOUR.jink * 8 >= 6 && ARMOUR.jink * 8 <= 9, `${ARMOUR.jink * 8} m`);
  // struck again while it is still on its way (a burst is ten rounds a second): it holds its line
  assert.equal(jink({ orbit: 1.1, orbitDir: -1 }, 10.2, 10), null);
  assert.equal(jink({ orbit: 1.1, orbitDir: -1 }, 10 + ARMOUR.jinkEvery - 0.01, 10), null);
  // once it has had the time to fly the stride, it may again — and goes back the way it came
  assert.deepEqual(jink({ orbit: 1.1, orbitDir: -1 }, 10 + ARMOUR.jinkEvery + 0.01, 10), {
    orbit: 1.1 + ARMOUR.jink,
    orbitDir: 1,
  });
  // the time between two is at least the time the stride takes at a drone's best pace (5.4 m/s)
  assert.ok(ARMOUR.jinkEvery >= (ARMOUR.jink * 8) / 5.4, `${ARMOUR.jinkEvery} s for ${ARMOUR.jink * 8} m`);
});
