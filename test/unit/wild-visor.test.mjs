// A sentry's visor (src/wild/visor.js): how many rounds a head takes now — by arithmetic, against the game's own
// tables.
//
// THE CONTRACT (18 November 2026 — the owner: "don't make it so easy to just remove robots will headshots i want
// to feel i'm working for it"): no round of a gun that fires one at a time shuts a sentry down in one, on any
// setting; two to the head always do; and the head is still worth aiming for — fewer rounds than the body.
//
// Changed the same day, later — the owner: "the game is still too easy to shoot down drones and robots … require
// more shoots to take them down". A shotgun's shell is ONE shot: the shell that cracks the visor is stopped by
// it, every pellet of it (until then its first pellet cracked the visor and the other seven went through, and a
// shell to the face at arm's length was the one thing left that shut a sentry down at a stroke — once the
// plating of src/wild/armour.js is counted, which test/unit/wild-armour.test.mjs does). The rounds below are
// the visor's alone, as with `?armour=0`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GUNS, pelletDamage } from '../../src/arms.js';
import { DIFFICULTY } from '../../src/difficulty.js';
import { VISOR, plate } from '../../src/wild/visor.js';

/** a sentry as it is built (src/enemies/index.js keeps the table to itself: read off its text) */
const source = readFileSync(new URL('../../src/enemies/index.js', import.meta.url), 'utf8');
const HP = Number(/sentry: \{\s+hp: (\d+)/.exec(source)?.[1]);
const HEAD = Number(/\[[\d.]+, [\d.]+, (\d+), 'head'\]/.exec(source)?.[1]);

/** how many rounds of `gun`, all in `zone`, shut a sentry of `name`'s setting down — as weapon.js counts them */
function roundsToDown(gun, zone, name, visor = true) {
  const gone = new Map();
  const unit = { type: 'sentry' };
  let hp = HP * DIFFICULTY[name].health;
  for (let n = 1; n <= 20; n++) {
    const own = zone === 'head' ? HEAD : 1;
    const by = (visor ? plate(gone, unit, zone, n).by : undefined) ?? own;
    hp -= gun.damage * (zone === 'head' ? gun.head : 1) * by;
    if (hp <= 0) return n;
  }
  return Infinity;
}

test('the tables this reads are the ones it thinks they are', () => {
  assert.deepEqual([HP, HEAD], [100, 3]);
});

test('the first round to a sentry’s head cracks its visor and counts as a round to the body; the next count as a head', () => {
  const gone = new Map();
  const sentry = { type: 'sentry' };
  assert.deepEqual(plate(gone, sentry, 'head', 1), { by: VISOR.first, cracked: true });
  assert.equal(VISOR.first, 1);
  assert.deepEqual(plate(gone, sentry, 'head', 2), { by: undefined, cracked: false });
  assert.deepEqual(plate(gone, sentry, 'head', 3), { by: undefined, cracked: false });
  // each machine has its own
  assert.equal(plate(gone, { type: 'sentry' }, 'head', 3).cracked, true);
  // and asked without being told which shot it is, a second round is a second round
  const other = { type: 'sentry' };
  assert.equal(plate(gone, other, 'head').cracked, true);
  assert.deepEqual(plate(gone, other, 'head'), { by: undefined, cracked: false });
});

test('a round anywhere else is as it was, and so is a drone: neither is asked about', () => {
  const gone = new Map();
  const sentry = { type: 'sentry' };
  for (const zone of ['body', 'legs'])
    assert.deepEqual(plate(gone, sentry, zone, 1), { by: undefined, cracked: false });
  assert.equal(gone.size, 0, 'a round to the body does not crack a visor');
  assert.deepEqual(plate(gone, { type: 'drone' }, 'head', 1), { by: undefined, cracked: false });
  assert.deepEqual(plate(gone, { type: 'drone' }, 'body', 1), { by: undefined, cracked: false });
});

test('a sentry is never one round to the head: it is two, on every setting, with the carbine and with the pistol', () => {
  for (const name of Object.keys(DIFFICULTY))
    for (const key of ['carbine', 'pistol']) {
      const head = roundsToDown(GUNS[key], 'head', name);
      const body = roundsToDown(GUNS[key], 'body', name);
      assert.equal(head, 2, `${key} on ${name}: ${head} to the head`);
      assert.ok(body > head, `${key} on ${name}: ${body} to the body, ${head} to the head — the head is still better`);
      assert.ok(body <= 4, `${key} on ${name}: ${body} to the body`);
    }
  // what it was, and what this changed: one round did it on Recruit and Operator
  assert.equal(roundsToDown(GUNS.carbine, 'head', 'operator', false), 1);
  assert.equal(roundsToDown(GUNS.pistol, 'head', 'recruit', false), 1);
});

test('a shell is one shot: the shell that cracks the visor is stopped by it, every pellet — and the next goes through', () => {
  const gone = new Map();
  const unit = { type: 'sentry' };
  const shell = (shot) => {
    let dealt = 0;
    let cracks = 0;
    for (let p = 0; p < GUNS.shotgun.pellets; p++) {
      const { by, cracked } = plate(gone, unit, 'head', shot);
      if (cracked) cracks++;
      dealt += pelletDamage(2) * (by ?? HEAD);
    }
    return { dealt, cracks };
  };
  // the first shell: all eight pellets count as to the body, and the visor cracks once
  const first = shell(1);
  assert.deepEqual(first, { dealt: GUNS.shotgun.pellets * pelletDamage(2), cracks: 1 });
  // with the visor alone that is still a sentry down at arm's length, on every setting — as it always was
  assert.ok(first.dealt >= HP * DIFFICULTY.ghost.health, `${first.dealt} from one shell to the head at two metres`);
  // the second: through, every pellet a head
  assert.deepEqual(shell(2), { dealt: GUNS.shotgun.pellets * pelletDamage(2) * HEAD, cracks: 0 });
});
