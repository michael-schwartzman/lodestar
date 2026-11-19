// The sound-effect pack's rules (src/wild/sfx.js): every sample it names is a file of the right size, every
// sound that takes the place of one of the game's own keeps that sound's reach, the pack holds what passed the
// gate and nothing that did not, and the cascades' extra blasts come due on schedule. No browser: the samples
// are files on disk and the rest is arithmetic.
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LOOPS } from '../../src/audio/loops.js';
import { SOUNDS } from '../../src/audio/sounds.js';
import { BLAST_SCHEDULE, HALL, PACK, PRIORITY, dueBlasts } from '../../src/wild/sfx.js';

const DIR = fileURLToPath(new URL('../../src/wild/sfx/', import.meta.url));
/** the brief's one named exception: the five-second cascade blast may run to 110 kB; everything else, 80 kB */
const CEILING = { cascadeBlast: 110_000 };

test('every sample the pack names is a file, none oversize, and the whole pack is light to fetch', () => {
  let total = 0;
  let files = 0;
  for (const [name, rule] of Object.entries(PACK)) {
    for (let take = 0; take < rule.takes; take++) {
      const file = `${DIR}${name}-${take}.mp3`;
      assert.ok(existsSync(file), `${name}-${take} has no file: node tools/sound/sfx.mjs --only ${name}`);
      const bytes = statSync(file).size;
      assert.ok(bytes <= (CEILING[name] || 80_000), `${name}-${take} is ${bytes} bytes`);
      total += bytes;
      files++;
    }
  }
  assert.ok(files > 0);
  assert.ok(total < 1_200_000, `${total} bytes of sfx`);
});

test('the pack is fetched in the priority order the owner asked for, and names nothing twice', () => {
  assert.deepEqual([...PRIORITY].sort(), Object.keys(PACK).sort());
  assert.equal(new Set(PRIORITY).size, PRIORITY.length);
});

test("a sound that takes the place of one of the game's own keeps that sound's reach", () => {
  let checked = 0;
  for (const [name, rule] of Object.entries(PACK)) {
    if (!rule.replaces) continue;
    const gameSound = SOUNDS[rule.replaces] || LOOPS[rule.replaces];
    assert.ok(gameSound, `${rule.replaces} (replaced by ${name}) is not a sound the game has`);
    assert.equal(rule.reach, gameSound.reach, `${name} must keep ${rule.replaces}'s reach`);
    checked++;
  }
  assert.ok(checked > 0);
  // the hall the centrifuges spin in is the one the game's own cascade bed and blast already use
  assert.deepEqual(HALL, { x: 51, y: 2.5, z: 29 });
});

test('what the pack holds is what passed the gate — and nothing that did not', () => {
  // 18 November 2026. In: the sentry's rifle, the explosion, the cascades' blast, the centrifuges spinning — and,
  // from a second batch judged against the sounds the game has now, the player's pistol and shotgun.
  assert.deepEqual(Object.keys(PACK).sort(), [
    'cascadeBlast',
    'cascadeSpin',
    'explosion',
    'pistolShot',
    'shotSentry',
    'shotgunShot',
  ]);
  // Out: a drone's gun (six generations, never heard as a gunshot); the rotors tearing loose (three); the
  // player's carbine (heard as a gunshot, and no better than the one the game has); and a round going past,
  // which was in the pack for an hour — of six generations none was heard, blind, as a round going past, and
  // the three files that had been let in were heard as a footstep, a gunshot and a click.
  for (const name of ['shotDrone', 'rotorBreak', 'shot', 'whiz']) assert.equal(PACK[name], undefined, name);
});

test('the cascades going up schedules three more blasts, at the charges, in order', () => {
  assert.equal(BLAST_SCHEDULE.filter((e) => e.sound === 'cascadeBlast').length, 3);
  assert.deepEqual(
    BLAST_SCHEDULE.filter((e) => e.sound === 'cascadeBlast').map((e) => e.charge),
    [0, 1, 2],
  );
  // each extra blast is heard from the charge's own height as the brief asked, not the charge's mounting height
  for (const e of BLAST_SCHEDULE) if (e.sound === 'cascadeBlast') assert.equal(e.y, 1.5);
  // there is one take of it (18 November 2026: the other was heard as gunfire), so no two of the four that go
  // off are played alike: each of these at a speed of its own, and none at the speed of the game's first
  const rates = BLAST_SCHEDULE.map((e) => e.rate);
  assert.equal(new Set([1, ...rates]).size, rates.length + 1, `${rates}`);
  for (const rate of rates) assert.ok(rate >= 0.8 && rate <= 1.1, `${rate}`);
  // strictly increasing: nothing is due before what came before it
  const ats = BLAST_SCHEDULE.map((e) => e.at);
  assert.deepEqual(
    ats,
    [...ats].sort((a, b) => a - b),
  );

  const state = { from: 100, given: 0 };
  assert.deepEqual(dueBlasts(state, 100), []);
  assert.deepEqual(
    dueBlasts(state, 100.5).map((e) => e.sound),
    ['cascadeBlast'],
  );
  assert.deepEqual(dueBlasts(state, 100.5), []); // given already, not handed out twice
  assert.deepEqual(
    dueBlasts(state, 101.7).map((e) => e.sound),
    ['cascadeBlast', 'cascadeBlast'],
  );
  assert.equal(state.given, BLAST_SCHEDULE.length);
  assert.deepEqual(dueBlasts(state, 9999), []); // nothing left to give out

  // a fresh mission's clock starts again from its own first blast, not the last one's
  const again = { from: 500, given: 0 };
  assert.deepEqual(dueBlasts(again, 500), []);
});
