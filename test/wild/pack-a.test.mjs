// Sounds made again, pack A (src/wild/pack-a-live.js; docs/WILD-sound-a.md), in the built game with sound: what
// is in the pack is made, passes every check the game's own sounds pass, and is what plays under the name — and
// with the switch off the game's own are untouched.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SOUNDS } from '../../src/audio/sounds.js';
import { PACK_A } from '../../src/wild/pack-a-live.js';
import { GUNS } from '../../src/wild/pack/guns.js';
import { IMPACTS } from '../../src/wild/pack/impacts.js';
import { openWith, startWild } from './helpers.mjs';

let harness;
let open;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
});

after(async () => {
  await harness?.stop();
});

const MADE = { ...GUNS, ...IMPACTS };
/** the player's own two guns that are in the pack: held to the shape of a shot */
const SHOTS = ['shot', 'shotgunShot'];
/** every take of every sound, as the game's own check reports it: name → what it measured */
async function sounds(page) {
  const result = await page.json('__G.audio.selfTest()');
  assert.deepEqual(result.problems, []);
  return new Map(result.sounds.map((s) => [s.name, s]));
}

test('what is in the pack is a sound the game already had, made again — and nothing the listeners turned down', () => {
  assert.equal(PACK_A.length, 9);
  for (const name of PACK_A) {
    assert.ok(MADE[name], `${name} has no recipe`);
    assert.ok(SOUNDS[name], `${name} is not a sound of the game's`);
    // heard as far off as the one it replaces
    assert.equal(MADE[name].reach, SOUNDS[name].reach, `${name} carries ${MADE[name].reach} m`);
  }
  // (17 November 2026: heard by the dearer model as worse than what they would replace, or as no such thing)
  for (const name of ['pistolShot', 'shotSentry', 'shotDrone', 'knifeHit', 'casing', 'whiz', 'ricochet'])
    assert.ok(!PACK_A.includes(name), `${name} is in the pack`);
});

test('with sound, every take of the pack is made and passes the game’s own checks; a shot is not a note, and has its room', async () => {
  // (18 November 2026: the sample pack — src/wild/sfx-live.js, held by its own suite — takes the shotgun's
  // place once it is fetched; what is asked here is what pack A makes, so that pack is switched off)
  const page = await open('look=1&dynres=0&touch=0&autostart=1&sfx=0');
  await page.evaluate('__G.wild.ready.then(() => (window.__wildSounds = true)); void 0');
  await page.until('window.__wildSounds === true', 'the pack’s sounds to be made', 60000);
  const made = await sounds(page);
  for (const name of PACK_A) {
    const takes = MADE[name].takes ?? 1;
    for (let i = 0; i < takes; i++) {
      const s = made.get(takes > 1 ? `${name}#${i}` : name);
      assert.ok(s, `${name} take ${i} was not made`);
      // it is the pack's, not the game's own under the same name: as long as the pack's recipe says
      assert.equal(s.seconds, MADE[name].seconds, `${name} is ${s.seconds} s long`);
    }
  }
  for (const name of SHOTS) {
    assert.ok(MADE[name].takes >= 3, `${name} has ${MADE[name].takes} takes`);
    // the room it is fired in: longer than the dry sweep it replaces
    assert.ok(MADE[name].seconds > SOUNDS[name].seconds, `${name} is no longer than the old one`);
    for (let i = 0; i < MADE[name].takes; i++) {
      const s = made.get(`${name}#${i}`);
      // no bare note; a body under 250 Hz that is noise; a crack over 2 kHz — never only one of the two
      assert.ok(s.bleep < 0.2, `${name}#${i} is a note: ${s.bleep.toFixed(3)}`);
      assert.ok(s.low > 0.15, `${name}#${i} has no body: ${s.low.toFixed(3)}`);
      assert.ok(s.high > 0.01, `${name}#${i} has no crack: ${s.high.toFixed(3)}`);
    }
  }
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

test('with the switch off the sounds the pack replaces are the game’s own', async () => {
  const page = await open('wild=0&look=1&dynres=0&touch=0&autostart=1');
  const made = await sounds(page);
  for (const name of PACK_A) {
    const s = made.get(SOUNDS[name].takes > 1 ? `${name}#0` : name);
    assert.ok(s, `${name} was not made`);
    assert.equal(s.seconds, SOUNDS[name].seconds, `${name} is ${s.seconds} s long with the switch off`);
  }
  assert.deepEqual(await page.problems(), []);
  await page.close();
});
