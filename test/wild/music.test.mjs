// Music a scene, in the built game with sound on (src/wild/music.js holds which cue a moment calls for,
// test/unit/wild-music.test.mjs holds that): the cues are fetched, played, laid over one another and brought round —
// and when one cannot be had, the game goes on with what it has.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MUSIC } from '../../src/wild/music.js';
import { PACK } from '../../src/wild/sfx.js';
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

const music = '__G.wild.feature("music")';
/** a page with sound running: it runs from the first key (the game's own rule) — M, which on the title does nothing */
async function withSound(query) {
  const page = await open(query);
  await page.press('KeyM');
  await page.until('__G.audio.state === "running"', 'sound to be running', 10000);
  return page;
}
const fetched = (page) =>
  page.json(
    // (18 November 2026: the sfx pack — src/wild/sfx-live.js — fetches on its own switch, `?sfx=0`, regardless
    // of music's; its names, whatever the pack holds, are not music's concern here)
    `performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((name) => /\\.mp3$/.test(name)).map((name) => name.split("-")[0]).filter((name) => !${JSON.stringify(Object.keys(PACK))}.includes(name))`,
  );
const state = (page) => page.json(`${music}.state`);

test('on the title its music is fetched and played, and the game’s own score falls silent; on a mission the quiet of the place comes in over it', async () => {
  const page = await withSound('look=1&dynres=0&touch=0');
  await page.until(`${music}.state.cue === "title"`, 'the title’s music', 20000);
  const title = await state(page);
  assert.equal(title.installed, true);
  assert.ok(title.seconds > 60 && title.seconds < 90, `the cue is ${title.seconds} s long`);
  assert.ok((await fetched(page)).includes('title'));
  await page.until(`${music}.state.level > 0.95 && ${music}.state.sounding === 1`, 'it to have come in', 6000);
  // the game's own score is told nothing while this one is set: taking it off hands the same object back
  assert.equal(
    await page.evaluate(
      '(() => { const s = __G.audio.setScore(null); __G.audio.setScore(s); return typeof s.setState; })()',
    ),
    'function',
  );

  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.until(`${music}.state.cue === "infil"`, 'the quiet of the mission', 20000);
  // what is likely next was fetched ahead of its time: a fight comes without warning
  await page.until(
    `${music}.state.loaded.includes("combat") && ${music}.state.loaded.includes("tense")`,
    'the fight’s music to be ready',
    30000,
  );
  const calm = await state(page);
  assert.ok(calm.loaded.length <= MUSIC.keep + 1, `${calm.loaded} are kept decoded`);
  assert.deepEqual(await page.problems(), []);
});

test('the alarm brings the fight’s music in fast; the hall has its own quiet; the run out is over everything', async () => {
  const page = await withSound('look=1&dynres=0&touch=0&autostart=1');
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.until(`${music}.state.cue === "infil"`, 'the quiet of the mission', 30000);
  // the cascade hall
  await page.evaluate('__G.debug.teleport(47.5, 30.5, 0); void 0');
  await page.until(`${music}.state.cue === "hall"`, 'the hall’s own', 20000);
  // the site's alarm (as a charge raises it)
  await page.until(`${music}.state.loaded.includes("combat")`, 'the fight’s music to be ready', 30000);
  const t0 = await page.evaluate('__G.time');
  await page.evaluate('__G.enemies.alert(47.5, 30.5); void 0');
  await page.until(`${music}.state.cue === "combat"`, 'the fight’s music', 5000);
  const took = (await page.evaluate('__G.time')) - t0;
  assert.ok(took < 1.5, `it took ${took.toFixed(2)} s to come in`);
  // …and the hall's goes out under it: one cue is left sounding
  await page.until(`${music}.state.level > 0.95`, 'it to be all the way in', 5000);
  // the run out
  await page.evaluate(`${music}.debug({ force: 'exfil' }); void 0`);
  await page.until(`${music}.state.cue === "exfil"`, 'the run out', 20000);
  const out = await state(page);
  assert.ok(out.loaded.length <= MUSIC.keep + 1, `${out.loaded} are kept decoded`);
  assert.deepEqual(await page.problems(), []);
});

test('a cue comes round on itself without a gap: the next playing is laid over the end of the last', async () => {
  const page = await withSound('look=1&dynres=0&touch=0');
  // (a round of six seconds instead of the cue's seventy-eight, so that this does not take four minutes)
  await page.evaluate(`${music}.debug({ round: 6 }); void 0`);
  // every node that is taken out of the engine's graph from here on is counted
  await page.evaluate(`(() => {
    window.__out = { gain: 0, source: 0 };
    for (const [key, Node] of [['gain', GainNode], ['source', AudioBufferSourceNode]]) {
      const disconnect = Node.prototype.disconnect;
      Node.prototype.disconnect = function (...args) { window.__out[key]++; return disconnect.apply(this, args); };
    }
  })()`);
  await page.until(`${music}.state.cue === "title"`, 'the title’s music', 20000);
  const seen = JSON.parse(
    await page.evaluate(`(async () => {
      const f = __G.wild.feature('music'), seen = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 9000) { seen.push(f.state.sounding); await new Promise((done) => setTimeout(done, 50)); }
      return JSON.stringify({ rounds: f.state.rounds, least: Math.min(...seen), most: Math.max(...seen), out: window.__out });
    })()`),
  );
  // every 3.5 s (six less the overlap) another begins; there is never nothing sounding, and never more than two
  assert.ok(seen.rounds >= 3, `it came round ${seen.rounds} times in nine seconds`);
  assert.deepEqual([seen.least, seen.most], [1, 2]);
  // …and a playing that is over is taken out of the graph, it and its own level: nothing is left connected for
  // every time a cue has come round (found in review, 17 November 2026: they were all left)
  assert.ok(
    seen.out.source >= seen.rounds - 2 && seen.out.gain >= seen.rounds - 2,
    `${seen.rounds} playings begun, ${JSON.stringify(seen.out)} taken out`,
  );
  assert.deepEqual(await page.problems(), []);
});

test('a cue that cannot be had is asked for twice and then left: what was playing plays on, and nothing breaks', async () => {
  const page = await withSound('look=1&dynres=0&touch=0');
  await page.until(`${music}.state.cue === "title"`, 'the title’s music', 20000);
  await page.evaluate(`${music}.debug({ file: { tense: '/there-is-no-such-file.mp3' }, force: 'tense' }); void 0`);
  await page.until(`${music}.state.failed.tense === 2`, 'it to be given up', 15000);
  const left = await state(page);
  assert.deepEqual([left.cue, left.wanted, left.sounding >= 1], ['title', 'tense', true]);
  // the browser says the file was not there (twice); the game says nothing went wrong
  const problems = (await page.problems()).filter((line) => !/404|Failed to load resource/.test(line));
  assert.deepEqual(problems, []);
  // and a cue that CAN be had still comes when it is called for
  await page.evaluate(`${music}.debug({ force: 'combat' }); void 0`);
  await page.until(`${music}.state.cue === "combat"`, 'the fight’s music', 20000);
});

test('with the switch off, or with ?music=0, no music is fetched and the game’s own score is the score', async () => {
  for (const query of ['look=1&dynres=0&touch=0&wild=0', 'look=1&dynres=0&touch=0&music=0']) {
    const page = await withSound(query);
    await page.evaluate('new Promise((done) => setTimeout(done, 1500))');
    assert.deepEqual(await fetched(page), [], query);
    assert.equal(await page.evaluate('__G.audio.setScore(null)'), null, query);
    assert.deepEqual(await page.problems(), []);
  }
});
