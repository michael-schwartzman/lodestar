// The site speaks aloud, in the built game with sound on (src/wild/voice.js holds when the address says what,
// test/unit/wild-voice.test.mjs holds that and that every line has a clip): WARDEN's line is SAID as it is put
// on the radio, the address reads its alert out after it — and a clip that cannot be had costs nothing but itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { ADDRESS, SPOKEN, VOICE } from '../../src/wild/voice.js';
import { PACK } from '../../src/wild/sfx.js';
import { LINES } from '../../src/wild/warden.js';
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

const voice = '__G.wild.feature("voice")';
const made = (who) => JSON.parse(readFileSync(new URL(`../../src/wild/voice/${who}/lines.json`, import.meta.url)));
/** a mission begun with nobody in it, sound running (it runs from the first key: M, which on a mission is the map) */
async function withSound(query = '') {
  const page = await open(`look=1&dynres=0&touch=0&autostart=1${query}`);
  await page.press('KeyM');
  await page.press('KeyM');
  await page.until('__G.audio.state === "running"', 'sound to be running', 10000);
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  return page;
}
const state = (page) => page.json(`${voice}.state`);
const said = (page) =>
  page.json(
    '[...document.querySelectorAll("#hud .radio p")].filter((p) => p.firstChild.textContent === "WARDEN").map((p) => p.lastChild.textContent)',
  );
const not404 = (line) => !/404|Failed to load resource/.test(line);

test('the alarm goes up: WARDEN’s line is on the radio AND said, the music gives way under it — and then the address reads out its alert', async () => {
  // (18 November 2026: since that day an alarm brings a wave, and WARDEN says so eight seconds of the mission
  // later — src/wild/response.js. What is said is listed exactly below; on a machine under load this test ran
  // past those eight seconds once, and the list had a third line in it. The site's answer is switched off on
  // this page, and that line has a test of its own, the next.)
  const page = await withSound('&response=0');
  await page.until('__G.wild.feature("mix").state.built', 'the room to be built', 5000);
  // (every source that is taken out of the engine's graph from here on is counted)
  await page.evaluate(`(() => {
    window.__out = 0;
    const disconnect = AudioBufferSourceNode.prototype.disconnect;
    AudioBufferSourceNode.prototype.disconnect = function (...args) { window.__out++; return disconnect.apply(this, args); };
  })()`);
  // (a machine raises the alarm: the alarm itself is up, and the game says so to the wild build)
  await page.evaluate('__G.enemies.alert(__G.player.x, __G.player.z); __G.wild.emit("alarm", true); void 0');
  assert.deepEqual(await said(page), [LINES.alarm[0]]);
  await page.until(`${voice}.state.spoken.includes("warden/alarm-0")`, 'WARDEN to say it', 8000);
  await page.until(`${voice}.state.sounding === 1`, 'it to be sounding', 3000);
  // the music gives way under it, and comes back when it has spoken
  await page.until(`__G.wild.feature("music").state.under < ${VOICE.duck + 0.2}`, 'the music to give way', 4000);
  await page.until(`${voice}.state.sounding === 0`, 'it to have spoken', 12000);
  // …and, said, the line is taken out of the graph
  assert.ok((await page.json('window.__out')) >= 1, 'the line that was said was left connected');
  await page.until('__G.wild.feature("music").state.under > 0.9', 'the music to come back', 6000);
  // the public address has not spoken yet at the moment of the alarm: it waits for the blare and the radio
  await page.evaluate('__G.debug.speed(4); void 0');
  try {
    await page.until(`${voice}.state.spoken.includes("pa/alarm-0")`, 'the address to read out its alert', 12000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  const now = await state(page);
  assert.deepEqual(now.spoken, ['warden/alarm-0', 'pa/alarm-0']);
  // both are heard in the room the listener stands in
  assert.deepEqual(now.sent, { warden: true, pa: true });
  // the alarm stands down (its time runs out, as the game runs it out): the address says so — and when it goes
  // up again, raised this time by something that is not a machine (a charge, a tripwire), reads its other line
  await page.evaluate('__G.enemies.alarm.timeLeft = 0.05; __G.debug.speed(4); void 0');
  try {
    await page.until(`${voice}.state.spoken.includes("pa/clear-0")`, 'the address to call it off', 12000);
    await page.evaluate('__G.enemies.alert(__G.player.x, __G.player.z); void 0');
    await page.until(`${voice}.state.spoken.includes("pa/alarm-1")`, 'its other line', 12000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  assert.deepEqual(await page.problems(), []);
});

test('a wave is sent for the alarm: WARDEN says that too, some seconds after — on the radio and aloud', async () => {
  const page = await withSound();
  try {
    await page.evaluate('__G.enemies.alert(__G.player.x, __G.player.z); __G.wild.emit("alarm", true); void 0');
    assert.deepEqual(await said(page), [LINES.alarm[0]]);
    await page.evaluate('__G.debug.speed(4); void 0');
    try {
      await page.until(
        `${voice}.state.spoken.includes("warden/response-0")`,
        'WARDEN to say that more of it is coming',
        30000,
      );
    } finally {
      await page.evaluate('__G.debug.speed(1); void 0');
    }
    assert.deepEqual(await said(page), [LINES.alarm[0], LINES.response[0]]);
    const now = await state(page);
    assert.ok(
      now.spoken.indexOf('warden/alarm-0') < now.spoken.indexOf('warden/response-0'),
      JSON.stringify(now.spoken),
    );
    assert.deepEqual(await page.problems(), []);
  } finally {
    await page.close();
  }
});

test('a speaker never talks over itself, and a line asked for in one mission is not said into the next', async () => {
  const page = await withSound('&music=0');
  const a = made('warden')['alarm-1'].seconds;
  const b = made('warden')['found-0'].seconds;
  const from = await page.evaluate('__G.audio.graph().ctx.currentTime');
  await page.evaluate(`${voice}.speak("warden", "alarm-1"); ${voice}.speak("warden", "found-0"); void 0`);
  await page.until(`${voice}.state.spoken.length === 2`, 'both to be given a time', 8000);
  const now = await state(page);
  // the second begins when the first is over, and a breath: together they take both their lengths and more
  assert.ok(
    now.until.warden - from >= a + b + VOICE.breath - 0.1,
    `${(now.until.warden - from).toFixed(2)} s for ${a} + ${b}`,
  );
  // a new mission: what was being said is cut off, and what was waiting to be is not said
  await page.evaluate(`${voice}.speak("warden", "lamp-0"); __G.debug.start(); void 0`);
  await page.evaluate('new Promise((done) => setTimeout(done, 1200))');
  const fresh = await state(page);
  assert.deepEqual([fresh.spoken, fresh.sounding, fresh.waiting], [[], 0, []]);
  assert.deepEqual(await page.problems(), []);
});

test('a clip that cannot be had: the line is on the radio all the same, it is asked for twice and then left, and nothing breaks', async () => {
  const page = await withSound('&music=0');
  await page.evaluate(`${voice}.debug({ file: { 'warden/alarm-0': '/there-is-no-such-file.mp3' } }); void 0`);
  await page.evaluate('__G.wild.emit("alarm", true); void 0');
  assert.deepEqual(await said(page), [LINES.alarm[0]]);
  await page.until(`${voice}.state.failed["warden/alarm-0"] === 1`, 'it to have failed', 8000);
  assert.equal(await page.evaluate(`${voice}.speak("warden", "alarm-0")`), true);
  await page.until(`${voice}.state.failed["warden/alarm-0"] === 2`, 'it to have failed again', 8000);
  // …and then it is not asked for again: the blare is all of WARDEN's voice, as it was before it had one
  assert.equal(await page.evaluate(`${voice}.speak("warden", "alarm-0")`), false);
  assert.deepEqual((await state(page)).spoken, []);
  // a line there is no clip of is not said either, and is no error
  assert.equal(await page.evaluate(`${voice}.speak("warden", "no-such-line")`), false);
  assert.deepEqual((await page.problems()).filter(not404), []);
});

test('every clip is in the build, and this browser decodes each to the length it was made', async () => {
  const page = await withSound('&music=0');
  const lines = {
    warden: Object.entries(LINES).flatMap(([event, all]) => all.map((_, n) => `${event}-${n}`)),
    pa: Object.keys(SPOKEN.pa),
  };
  assert.equal((await state(page)).clips, lines.warden.length + lines.pa.length);
  for (const [who, ids] of Object.entries(lines)) {
    const lengths = JSON.parse(
      await page.evaluate(
        `(async () => JSON.stringify(await Promise.all(${JSON.stringify(ids)}.map((id) => ${voice}.seconds("${who}/" + id)))))()`,
      ),
    );
    const record = made(who);
    ids.forEach((id, i) =>
      assert.ok(
        Math.abs(lengths[i] - record[id].seconds) < 0.2,
        `${who}/${id}: ${lengths[i]} s, made ${record[id].seconds} s`,
      ),
    );
  }
  // (the address's lines are the ones its rules name)
  assert.deepEqual([...new Set(Object.values(ADDRESS).flatMap((rule) => rule.lines))].sort(), lines.pa.sort());
  assert.deepEqual(await page.problems(), []);
});

test('with ?voice=0 nothing is said and nothing is fetched: the line is on the radio, as it was', async () => {
  const page = await withSound('&voice=0&music=0');
  assert.equal(await page.evaluate(`${voice}`), null);
  await page.evaluate('__G.wild.emit("alarm", true); void 0');
  assert.deepEqual(await said(page), [LINES.alarm[0]]);
  await page.evaluate('new Promise((done) => setTimeout(done, 800))');
  // (18 November 2026: the sfx pack — src/wild/sfx-live.js — fetches on its own switch, `?sfx=0`, regardless of
  // voice's; its names, whatever the pack holds, are not voice's concern here)
  const fetched = await page.json(
    `performance.getEntriesByType("resource").map((r) => r.name).filter((name) => /\\.mp3$/.test(name)).filter((name) => !${JSON.stringify(Object.keys(PACK))}.some((sfx) => name.includes("/" + sfx + "-")))`,
  );
  assert.deepEqual(fetched, []);
  assert.deepEqual(await page.problems(), []);
});
