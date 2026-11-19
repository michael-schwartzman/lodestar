// The firing, blast and centrifuge samples a video model's audio track gave (src/wild/sfx.js holds which;
// src/wild/sfx-live.js how they are fetched and played), in the built game with sound: the pack is fetched and
// decoded and the game's own sounds become the samples — those that pack A had made again among them; with the
// switch off nothing of it is fetched; a sample that cannot be had leaves the game's own sound in place; the
// centrifuges spin while the cascades stand and wind down when they go; the extra blasts come on the mission's
// own clock and a new mission drops them.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SOUNDS } from '../../src/audio/sounds.js';
import { PACK, PRIORITY } from '../../src/wild/sfx.js';
import { secondsOf } from '../../tools/sound/cut.mjs';
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

const sfx = '__G.wild.feature("sfx")';
/** a page with sound running: it runs from the first key (the game's own rule), M, which does nothing itself */
async function withSound(query) {
  const page = await open(query);
  await page.press('KeyM');
  await page.until('__G.audio.state === "running"', 'sound to be running', 10000);
  return page;
}
/** every resource the page has fetched whose name is one of the pack's, by its base name (the build adds a take
 *  number and then its own hash: "shotSentry-0-xyz.mp3" is still "shotSentry" here) */
const PACK_NAMES = JSON.stringify(Object.keys(PACK));
const fetchedNames = (page) =>
  page.json(
    `performance.getEntriesByType("resource").map((r) => r.name.split("/").pop().split("-")[0]).filter((name) => ${PACK_NAMES}.includes(name))`,
  );
/** waits for every take of every sound the pack wants to have been tried, one way or the other */
async function settled(page) {
  await page.evaluate(`${sfx}.state.ready.then(() => (window.__sfxReady = true)); void 0`);
  await page.until('window.__sfxReady === true', 'the pack to be tried', 20000);
  return page.json(`${sfx}.state`);
}

test('with sound, every sound of the pack is fetched and decoded, and the engine’s own sound becomes the sample', async () => {
  const page = await withSound('look=1&dynres=0&touch=0&autostart=1');
  const state = await settled(page);
  assert.deepEqual(state.failed, {});
  for (const name of PRIORITY) assert.ok(state.loaded.includes(name), `${name} was not made ready`);
  assert.deepEqual(new Set(await fetchedNames(page)), new Set(PRIORITY));

  const result = await page.json('__G.audio.selfTest()');
  assert.deepEqual(result.problems, []);
  const made = new Map(result.sounds.map((s) => [s.name, s]));
  // (the shotgun is one pack A makes again as well, src/wild/pack-a-live.js: whichever of the two is ready
  // first, what the engine has in the end is the sample — the loop below holds that, by its length)
  for (const [name, { takes }] of Object.entries(PACK)) {
    for (let i = 0; i < takes; i++) {
      const key = takes > 1 ? `${name}#${i}` : name;
      const s = made.get(key);
      assert.ok(s, `${name} take ${i} is not in the engine’s own report`);
      // the engine renders the length the recipe gives it: the decoded sample’s own length, not the old one’s —
      // except a loop, which the engine always plays 0.3 s shorter than it was rendered (it crossfades that
      // much of the end back into the start, audio.js)
      const seconds = secondsOf(`src/wild/sfx/${name}-${i}.mp3`) - (PACK[name].loop ? 0.3 : 0);
      assert.ok(
        Math.abs(s.seconds - seconds) < 0.08,
        `${key}: the engine says ${s.seconds} s, the file is ${seconds} s`,
      );
    }
  }
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

test('with ?sfx=0, or with ?wild=0, nothing under sfx/ is fetched and the game’s own sounds are the game’s own', async () => {
  for (const query of ['look=1&dynres=0&touch=0&autostart=1&sfx=0', 'look=1&dynres=0&touch=0&autostart=1&wild=0']) {
    const page = await withSound(query);
    await page.evaluate('new Promise((done) => setTimeout(done, 1200))');
    assert.deepEqual(await fetchedNames(page), [], query);
    const result = await page.json('__G.audio.selfTest()');
    assert.deepEqual(result.problems, []);
    const shotSentry = result.sounds.find((s) => s.name === 'shotSentry#0');
    assert.equal(shotSentry.seconds, SOUNDS.shotSentry.seconds, `${query}: shotSentry is not the game’s own`);
    assert.deepEqual(await page.problems(), []);
    await page.close();
  }
});

test('a sample that cannot be had leaves the game’s own sound in place and logs no error of its own', async () => {
  const page = await open('look=1&dynres=0&touch=0&autostart=1');
  // the last in PRIORITY (sfx.js): those ahead of it take a real fetch, decode and render each, which leaves
  // this called long before its own turn comes up
  const last = PRIORITY.at(-1);
  await page.evaluate(`${sfx}.debug({ file: { ${last}: ['/there-is-no-such-file.mp3'] } }); void 0`);
  await page.press('KeyM');
  await page.until('__G.audio.state === "running"', 'sound to be running', 10000);
  const state = await settled(page);
  assert.ok(state.failed[last], JSON.stringify(state.failed));
  assert.ok(!state.loaded.includes(last), JSON.stringify(state.loaded));
  for (const name of PRIORITY) if (name !== last) assert.ok(state.loaded.includes(name), name);
  const result = await page.json('__G.audio.selfTest()');
  assert.deepEqual(result.problems, []);
  // …and under its name the engine still has a sound: the one it had (as long as that one's recipe says)
  const kept = result.sounds.find((s) => s.name === `${last}#0`);
  assert.ok(kept && Math.abs(kept.seconds - secondsOf(`src/wild/sfx/${last}-0.mp3`)) > 0.08, JSON.stringify(kept));
  // the browser says the file was not there; the game itself says nothing went wrong
  const problems = (await page.problems()).filter((line) => !/404|Failed to load resource/.test(line));
  assert.deepEqual(problems, []);
  await page.close();
});

test('the centrifuges are heard spinning while the cascades stand, wind down when they are blown, and the extra blasts come on the mission’s own clock; a new mission drops all of it', async () => {
  const page = await withSound('look=1&dynres=0&touch=0&autostart=1');
  await settled(page);
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.until(`${sfx}.state.spinning === true`, 'the centrifuges to be heard', 10000);

  await page.evaluate(`(() => {
    const G = __G;
    G.audio.__play = G.audio.play;
    window.__heard = [];
    G.audio.play = (name, o = {}) => {
      window.__heard.push([name, o.x ?? null, o.z ?? null, G.mission ? G.mission.time : null]);
      return G.audio.__play(name, o);
    };
  })(); void 0`);
  await page.evaluate(
    '__G.debug.teleport(__G.site.firing.x, __G.site.firing.z); __G.debug.rig(); __G.debug.blow(); void 0',
  );
  const blownAt = await page.json('__G.mission.time');
  await page.until(`${sfx}.state.windingDown === true`, 'the run-down to begin', 5000);
  await page.until(`${sfx}.state.spinning === false`, 'the centrifuges to fall quiet', 5000);

  // three more blasts, at the three charges BLAST_SCHEDULE names, after the game’s own first one
  await page.until(`${sfx}.state.given === 3`, 'the three extra blasts', 10000);
  const charges = await page.json('__G.site.charges');
  const extra = (await page.json('window.__heard')).filter(
    ([name, , , at]) => name === 'cascadeBlast' && at > blownAt + 0.05,
  );
  assert.equal(extra.length, 3, JSON.stringify(extra));
  for (let i = 0; i < 3; i++) {
    assert.deepEqual([extra[i][1], extra[i][2]], [charges[i].x, charges[i].z], JSON.stringify(extra[i]));
    assert.ok(extra[i][3] - blownAt >= [0.5, 1.0, 1.7][i] - 0.1, `blast ${i} at ${extra[i][3] - blownAt}`);
  }
  assert.deepEqual(await page.problems(), []);

  // a new mission: nothing stays queued or winding down from the one before (the loop itself may already have
  // begun again by the time this is read — the cascades stand once more, and so should it)
  await page.evaluate('__G.debug.start(); void 0');
  const fresh = await page.json(`${sfx}.state`);
  assert.deepEqual([fresh.windingDown, fresh.blasting], [false, false]);
  await page.until(`${sfx}.state.spinning === true`, 'the centrifuges again, a new mission on', 10000);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});
