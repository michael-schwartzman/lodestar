// The wild branch's experiment (src/wild; docs/WILD.md), driven in a real browser against the built game.
// Needs dist/ (`npm test` builds it first).
//
// Decision of 16 November 2026 — the owner: "i like this version lock it in … just go wild and make it maximum
// fun of a game and maximum creative don't holdback … but allow me to rollback if i wouldn't like it". Every
// other browser suite holds the game as it was locked, with the switch off (test/helpers/harness.mjs). This one
// holds the switch itself — the way back — and what the experiment does when it is on. Each feature's rules are
// held without a browser (test/unit/wild-*.test.mjs); that the built game DOES them is held in a file of its own
// beside this one.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PLAY, openWith, startWild } from './helpers.mjs';

let harness;
let open;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
});

after(async () => {
  await harness?.stop();
});

/** what of the experiment a page has fetched, and what of it is on the page */
const TRACES = `({
  wild: window.__G.wild === null ? null : typeof window.__G.wild,
  fetched: performance.getEntriesByType('resource').map((r) => r.name.split('/').pop()).filter((name) => /^wild-/.test(name)),
  overlay: document.querySelectorAll('#ui .wild').length,
  marked: document.querySelectorAll('[class^="w-"], [class*=" w-"]').length,
  look: window.__G.look,
})`;

test('with the switch off the game is the locked one: nothing of the experiment is fetched, drawn or bound', async () => {
  const page = await open(`wild=0&${PLAY}`);
  const off = await page.json(TRACES);
  assert.deepEqual(off, { wild: null, fetched: [], overlay: 0, marked: 0, look: 1 });
  // the keys the experiment uses do nothing at all
  const state = () =>
    page.json(
      '({ t: __G.mission.time > 0, x: __G.player.x, z: __G.player.z, grenades: __G.weapon.grenades, prompt: document.querySelector("#hud .prompt").hidden, note: document.querySelector("#hud .note").textContent })',
    );
  const before = await state();
  for (const [code, key] of [
    ['KeyH', 'h'],
    ['KeyY', 'y'],
    ['Digit4', '4'],
  ])
    await page.holdKey(code, key, 0, 300);
  assert.deepEqual(await state(), before);
  // the title is the locked title: three buttons, and no word of the experiment
  await page.evaluate('__G.debug.title(); void 0');
  const title = await page.json(
    '({ buttons: document.querySelectorAll(".m-menu-list .m-btn").length, text: document.querySelector("#menus").textContent })',
  );
  assert.equal(title.buttons, 3);
  assert.doesNotMatch(title.text, /wild/i);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

test('the experiment is a file of its own: it is in the build, and the script everybody downloads is still one script', () => {
  const assets = fileURLToPath(new URL('../../dist/assets/', import.meta.url));
  const scripts = readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.slice(0, name.indexOf('-')))
    .sort();
  // The game's script; the second look's, its probe and the phone test page, fetched when asked for; and the
  // experiment's. A sixth file means the bundler has moved something both the experiment and the second look
  // import out of the game's own script — as it did, 199 kB of it and three.js with it, the first time the
  // experiment imported the materials for itself (16 November 2026; src/wild/index.js says what may be imported).
  assert.deepEqual(scripts, ['bench', 'index', 'look', 'probe', 'wild']);
  // …and the page itself asks for one script, and for no other to be fetched ahead of it
  const page = readFileSync(fileURLToPath(new URL('../../dist/index.html', import.meta.url)), 'utf8');
  assert.deepEqual(
    [...page.matchAll(/assets\/([a-z]+)-[^"]+\.js/g)].map((m) => m[1]),
    ['index'],
  );
});

test('said by nobody, the wild build is on — and it is simply the game: fetched, with no label and no switch on the title; only the address turns it off', async () => {
  // Decision of 18 November 2026 — the owner, of the experiment: "… i like it". It is the game. Until then this
  // test held a tag on the title (WILD BUILD) and a switch at its foot (… TURN IT OFF) whose choice was kept in
  // the browser. Both are gone; a browser that still holds an old choice gets the game all the same.
  // (the address names the look, so that this is not also a test of the second look's weight: see below)
  const page = await open('look=1&dynres=0&touch=0&noaudio=1');
  const on = await page.json(TRACES);
  assert.equal(on.wild, 'object');
  assert.equal(on.fetched.filter((name) => /\.js$/.test(name)).length, 1, `${on.fetched}`);
  assert.equal(on.overlay, 1);
  const title = () =>
    page.json(`(() => ({ buttons: document.querySelectorAll('.m-menu-list .m-btn').length,
      tag: document.querySelectorAll('#menus .w-title').length, way: document.querySelectorAll('#menus [data-action="wild"]').length,
      text: document.querySelector('#menus').textContent }))()`);
  const shown = await title();
  assert.equal(shown.buttons, 3, 'the three buttons are where they were');
  assert.deepEqual([shown.tag, shown.way], [0, 0], 'no label, no switch');
  assert.doesNotMatch(shown.text, /wild build|experiment/i);

  // a browser in which the old switch was once turned off: it is the game all the same
  await page.evaluate('localStorage.setItem("lodestar.wild.v1", "0"); void 0');
  await page.navigate(`${harness.url}/?look=1&dynres=0&touch=0&noaudio=1`);
  await page.waitFor('window.__ready === true', { timeoutMs: 60000, label: 'the game again' });
  assert.equal(await page.evaluate('!!window.__G.wild'), true, 'an old choice kept the game from being the game');
  // the address alone turns it off: the classic game, which says nothing of any of it
  await page.navigate(`${harness.url}/?wild=0&look=1&dynres=0&touch=0&noaudio=1`);
  await page.waitFor('window.__ready === true', { timeoutMs: 60000, label: 'the classic game' });
  const off = await page.json(TRACES);
  assert.deepEqual([off.wild, off.fetched, off.overlay], [null, [], 0]);
  const classic = await title();
  assert.deepEqual([classic.buttons, classic.tag, classic.way], [3, 0, 0]);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

test('with the experiment a desk is shown the second look unless the address says the first; a phone keeps the first', async () => {
  const desk = await open('dynres=0&touch=0&noaudio=1');
  assert.equal(await desk.evaluate('__G.look'), 2);
  assert.deepEqual(await desk.problems(), []);
  await desk.close();
  const phone = await open('dynres=0&touch=1&noaudio=1');
  assert.equal(await phone.evaluate('__G.look'), 1);
  assert.deepEqual(await phone.problems(), []);
  await phone.close();
});

test('with sound, the experiment’s own sounds are made after the game’s and pass the game’s own checks — and none of them is a bleep', async () => {
  const page = await open('look=1&dynres=0&touch=0&autostart=1');
  await page.evaluate('__G.wild.ready.then(() => (window.__wildSounds = true)); void 0');
  await page.until('window.__wildSounds === true', 'the experiment’s sounds to be made', 60000);
  const result = await page.json('__G.audio.selfTest()');
  assert.deepEqual(result.problems, []);
  const made = new Map(result.sounds.map((s) => [s.name.split('#')[0], s]));
  const own = await page.json(
    '__G.wild.features.flatMap((f) => [...Object.keys(f.sounds?.sounds || {}), ...Object.keys(f.sounds?.loops || {})])',
  );
  assert.ok(own.length >= 4, `the experiment brings ${own.length} sounds`);
  for (const name of own) assert.ok(made.has(name), `${name} was not made`);
  // the game's rule for its own (test/smoke.test.mjs, "the sounds have weight"): how much of a sound is one bare
  // note. Under 0.3 is a knock, a rush, a thing struck
  for (const s of result.sounds.filter((s) => own.includes(s.name.split('#')[0]) && s.bleep !== undefined))
    assert.ok(s.bleep < 0.3, `${s.name} is a bleep: ${s.bleep.toFixed(2)}`);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

test('in the second look the experiment draws what it draws in the first and logs nothing: time bent, a machine turned, the hall under strain, a drone flown', async () => {
  const page = await open('dynres=0&touch=0&noaudio=1&autostart=1');
  assert.equal(await page.evaluate('__G.look'), 2);
  const pass = async (seconds, label) => {
    const until = (await page.evaluate('__G.time')) + seconds;
    await page.until(`__G.time >= ${until}`, label, 30000);
  };
  // the hall, with the drives most of the way to their end: the casings lean in their seats and are warm
  await page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true; G.enemies.clear(); G.debug.teleport(47.5, 38.5, 0);
    Object.assign(G.wild.feature('overspeed').state, { running: true, need: 1000, progress: 0.85, at: 99 });
  })()`);
  await pass(0.6, 'the hall to be drawn under strain');
  const hall = await page.json(`(() => {
    const mesh = __G.world.group.getObjectByName('cascade'), m = mesh.instanceMatrix.array, c = mesh.instanceColor.array;
    let lean = 0, warm = 0;
    for (let i = 0; i < mesh.count; i++) { lean = Math.max(lean, 1 - m[i * 16 + 5]); warm += c[i * 3] - c[i * 3 + 2]; }
    return { lean, warm: warm / mesh.count };
  })()`);
  assert.ok(hall.lean > 1e-4 && hall.warm > 0.02, JSON.stringify(hall));
  // time bent, a sentry turned in front of the eye, then a drone flown
  await page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true;
    const e = G.enemies, keep = ['gate', 'droneYard'];
    e.remove(e.list.filter((u) => !keep.includes(u.name)).map((u) => u.rollId));
    for (const [name, x, z] of [['gate', 62.5, 67.5], ['droneYard', 64.5, 66.5]])
      Object.assign(e.byName(name), { x, z, waitT: 1e6, route: [[Math.floor(x), Math.floor(z)]], routeI: 0, path: null, goalX: -1 });
    G.debug.teleport(56.5, 67.5, ${-Math.PI / 2});
    G.wild.feature('uplink').turn(e.byName('gate'));
  })()`);
  await page.press('KeyY');
  await page.until('__G.wild.feature("focus").state.on === true', 'FOCUS', 4000);
  await pass(0.4, 'a turned machine to be drawn, with time bent');
  assert.ok((await page.evaluate('__G.enemies.byName("gate").turned')) > 0);
  await page.evaluate('__G.wild.feature("pilot").fly(__G.enemies.byName("droneYard")); void 0');
  await pass(0.4, 'the drone’s eye to be drawn');
  assert.equal(await page.evaluate('__G.wild.feature("pilot").flying'), true);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});
