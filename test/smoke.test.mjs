// The built game, driven end to end in a real browser: it starts, it plays, both endings can be reached, and
// nothing is logged as an error on the way. Needs dist/ (`npm test` builds it first).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sleep } from '../tools/lib/browser.mjs';
import { decodePng } from '../tools/lib/png.mjs';
import { startHarness } from './helpers/harness.mjs';
import { CASING, ZONE } from '../src/world/map.js';
import { ARMS } from '../src/arms.js';
import { BODY, bodyView } from '../src/enemies/bodies.js';

let harness;
let page;

const js = (expression) => page.evaluate(expression);
const state = () => js('__G.state');
const until = (expression, label, timeoutMs = 20000) => page.waitFor(expression, { timeoutMs, intervalMs: 100, label });
const press = async (code, ms) => page.holdKey(code, code.replace('Key', '').toLowerCase(), 0, ms);
/**
 * The key that uses things — sets a charge, raises the beacon, takes a sentry down. It was E or F until
 * 12 November 2026; E now leans to the right (with Q to the left), and F alone uses. Decision, not drift:
 * docs/DESIGN.md §7.
 */
const USE = 'KeyF';
const mouse = (type, button = 'left') =>
  page.send('Input.dispatchMouseEvent', { type, x: 640, y: 360, button, clickCount: 1 });
const click = (action) => js(`document.querySelector('#menus [data-action="${action}"]').click()`);
/** A machine by the name the map gives it (src/world/map.js). The roll depends on the setting; names do not. */
const unit = (name) => `__G.enemies.byName("${name}")`;

async function problems() {
  const own = JSON.parse(await js('JSON.stringify((window.__errors || []).concat(window.__rejections || []))'));
  const logged = page.console.filter((m) => m.type === 'error').map((m) => m.text);
  return [...own, ...page.exceptions, ...page.logErrors, ...logged];
}

before(async () => {
  harness = await startHarness();
  page = await harness.browser.newPage();
  await page.navigate(`${harness.url}/?seed=7&dynres=0`);
  await until('window.__ready === true || !!window.__fatal', 'the game to start', 90000);
});

after(async () => {
  await harness?.stop();
});

test('starts on the title screen with the site drawn behind it', async () => {
  assert.equal(await js('window.__fatal || null'), null);
  assert.equal(await state(), 'title');
  assert.equal(await js('document.querySelector("#menus").dataset.screen'), 'title');
  assert.equal(
    await js('!!document.querySelector("#boot.done, body:not(:has(#boot))")'),
    true,
    'the boot screen is gone',
  );
  const a = await js('__G.frames');
  await sleep(1000);
  const b = await js('__G.frames');
  assert.ok(b - a >= 20, `only ${b - a} frames in a second`);
  assert.ok((await js('__G.drawCalls')) >= 20, 'the site is being drawn');
  const world = JSON.parse(await js('JSON.stringify(__G.world.stats)'));
  assert.ok(world.triangles > 50000 && world.vertices > 50000, `world looks empty: ${JSON.stringify(world)}`);
  assert.ok(world.bakeMs < 4000, `the light bake took ${world.bakeMs} ms`);
  // the finishing passes (bloom, grade, grain) are on wherever the device can hold values brighter than white,
  // and the picture they work on is exactly the size of the canvas's drawing buffer
  const picture = JSON.parse(
    await js(
      'JSON.stringify({ enabled: __G.view.post.enabled, plan: __G.view.post.plan, size: __G.view.post.size, buffer: [__G.view.size.pixelWidth, __G.view.size.pixelHeight], handed: __G.view.post.enabled ? 1 : 0 })',
    ),
  );
  assert.equal(picture.enabled, true, `the finishing passes are off: ${JSON.stringify(picture.plan)}`);
  assert.deepEqual(picture.size, picture.buffer);
  assert.equal(picture.plan.fxaa, picture.plan.samples === 0, 'edges are smoothed one way or the other');
});

/** A value every lit material shares (src/gfx/materials.js `shared`), read off the first mesh that has it. */
const uniform = (name) =>
  js(
    `__G.world.group.children.find((mesh) => mesh.material && mesh.material.uniforms && mesh.material.uniforms.${name}).material.uniforms.${name}.value`,
  );
/** Where the camera is, how high the ground outside is under it, and whether there is sky over it. */
const camera = () =>
  js(
    'JSON.stringify({ x: __G.camera.position.x, y: __G.camera.position.y, z: __G.camera.position.z, ground: __G.world.mountainAt(__G.camera.position.x, __G.camera.position.z), sky: __G.world.openSky(__G.camera.position.x, __G.camera.position.z) })',
  ).then(JSON.parse);

test('on a desk the title is in the middle of the screen: the wordmark, the three buttons and the foot, centred', async () => {
  // Decision of 16 November 2026 — the owner: "center the start menu in pc to the center of the screen". It was
  // a column down the left-hand edge — as it still is on a phone, where the right thumb must stay clear of it
  // (test/phone.test.mjs).
  const box = JSON.parse(
    await js(`(() => {
      const at = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom]; };
      // where the LETTERS of a line are: its text, less the spacing that trails its last letter
      const letters = (sel) => {
        const el = document.querySelector(sel);
        const range = document.createRange();
        range.selectNodeContents(el);
        const b = range.getBoundingClientRect();
        return [b.left, b.right - (parseFloat(getComputedStyle(el).letterSpacing) || 0), b.top, b.bottom];
      };
      return JSON.stringify({
        w: innerWidth,
        h: innerHeight,
        word: letters('.m-wordmark'),
        tag: letters('.m-tagline'),
        list: at(document.querySelector('.m-menu-list')),
        buttons: [...document.querySelectorAll('.m-menu-list .m-btn')].map(at),
        foot: letters('.m-title-foot > :last-child'),
      });
    })()`),
  );
  const mid = (b) => (b[0] + b[1]) / 2;
  for (const [name, b] of [
    ['the wordmark', box.word],
    ['the line under it', box.tag],
    ['the buttons', box.list],
    ['the foot', box.foot],
  ])
    assert.ok(Math.abs(mid(b) - box.w / 2) <= 2, `${name} is ${(mid(b) - box.w / 2).toFixed(1)} px off the middle`);
  assert.equal(box.buttons.length, 3);
  for (const b of box.buttons) assert.ok(Math.abs(mid(b) - box.w / 2) <= 2, 'a button is off the middle');
  // a column of buttons, not a band across the screen
  const wide = box.list[1] - box.list[0];
  assert.ok(wide >= 260 && wide <= 480, `the buttons are ${wide} px wide`);
  // and up and down: the wordmark and the buttons, taken together, are about the middle of the screen
  const block = (box.word[2] + box.list[3]) / 2;
  assert.ok(Math.abs(block - box.h / 2) < box.h * 0.08, `the menu is ${(block - box.h / 2).toFixed(0)} px off`);
  // the foot is under them, and on the screen
  assert.ok(box.foot[2] > box.list[3] && box.foot[3] <= box.h, 'the foot is not under the buttons');
});

test('the site is inside a mountain, and the title says so: the picture is taken from the road outside, of the portal and the mountain over it', async () => {
  // Decision of 12 November 2026 — the owner: "I want it clear that this is a hidden centrifuge site inside a
  // mountain, underground, not just a hangar." Until then the title looked down on a fenced yard under the sky.
  const eye = await camera();
  assert.ok(eye.sky && eye.y > eye.ground + 1.5, `the title camera is under the mountain: ${JSON.stringify(eye)}`);
  assert.ok(eye.z > 100 && eye.y < 12, 'it stands on the road south of the forecourt, at about a standing height');
  assert.match(await js('document.querySelector("#menus").textContent'), /UNDER THE MOUNTAIN/);
  // what is drawn: a mountain outside, a rock roof inside, and no flat roof left on the facility
  const drawn = JSON.parse(
    await js(`JSON.stringify((() => {
      const count = {};
      for (const mesh of __G.world.group.children) {
        const tris = mesh.geometry && mesh.geometry.index ? mesh.geometry.index.count / 3 : 0;
        count[mesh.name] = (count[mesh.name] || 0) + tris;
      }
      return { terrain: count['terrain:rock'] || 0, roof: count['roof:rock'] || 0, tops: count.rock || 0, huts: count.roof || 0 };
    })())`),
  );
  assert.ok(drawn.terrain > 8000, `the mountain is ${drawn.terrain} triangles`);
  assert.ok(drawn.roof > 6000, `the cavern's roof is ${drawn.roof} triangles`);
  assert.equal(drawn.tops, 0, 'the old rock rim is still drawn');
  assert.equal(drawn.huts, 4, 'only the two huts that stand free in the cavern have roofs of their own');
  // the mountain is over the facility, a long way over
  assert.ok((await js('__G.world.mountainAt(50, 30)')) > 60);
  // nothing inside is lit by the moon: a dark corner of the cavern is dark, and the forecourt is not
  const light = JSON.parse(
    await js(
      'JSON.stringify({ cavern: __G.world.visibility(20.5, 50.5), sky: [__G.world.openSky(20.5, 50.5), __G.world.openSky(64, 92.5), __G.world.openSky(9.5, 67), __G.world.openSky(106.5, 34.5)], over: [__G.world.skyAt(20.5, 50.5), __G.world.skyAt(64, 92.5), __G.world.skyAt(9.5, 67), __G.world.skyAt(106.5, 34.5), __G.world.skyAt(64, 150)] })',
    ),
  );
  assert.ok(light.cavern < 0.05, `a corner of the cavern with no lamp near it is lit: ${light.cavern}`);
  assert.deepEqual(light.sky, [false, true, false, false], 'only the forecourt is under the sky');
  // what the sound of the air goes by (src/audio/air.js): rock, sky, rock, the shaft's foot, and open air off the map
  assert.deepEqual(light.over, [0, 1, 0, 2, 1]);
});

test('every sound renders and passes its own checks', async () => {
  const result = JSON.parse(await js('JSON.stringify(__G.audio.selfTest())'));
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.ok(result.sounds.length >= 40, `only ${result.sounds.length} sounds`);
});

test('the sounds have weight: nothing said to the player, or by a machine, is a bleep; a gun has a body and a room', async () => {
  // Decision of 16 November 2026 — the owner: "make the sounds more serious". Measured (src/audio/tone.js
  // `bareTone`: how much of a sound is one bare note, 0 … 1), what the game said to the player and what its
  // machines said were bleeps — a square or a sine at one pitch, or sliding between two: the hit marker 0.84, the
  // kill chime 0.96, the menus 0.76–0.83, the radio 0.70, the objective 1.00, the machines' voices 0.61–1.00,
  // their "power down" 0.49–0.90, a bullet on one 0.66, even a sentry's footstep 0.87. And the guns were a
  // thirtieth of a second long, with nothing after them. Each of those is now a knock, a click, a growl or a
  // thing struck — under 0.3 — and a gun lasts as long as the room it is fired in.
  const result = JSON.parse(await js('JSON.stringify(__G.audio.selfTest())'));
  const sound = {};
  for (const s of result.sounds) if (s.bleep !== undefined) (sound[s.name.split('#')[0]] ||= []).push(s);
  const NO_BLEEP = [
    // told to the player
    ...['hitMarker', 'killConfirm', 'hurt', 'uiMove', 'uiSelect', 'uiBack', 'radio', 'objective', 'alarmHit'],
    // said, and done, by the machines
    ...['sentrySuspicious', 'sentryAlert', 'sentryLost', 'sentryDown', 'droneDown', 'takedown', 'machineStun'],
    ...['hitMachine', 'stepSentry', 'shotSentry', 'shotDrone'],
    // the guns in the hand, and the working of them
    ...['shot', 'pistolShot', 'shotgunShot', 'dry', 'selector', 'weaponSwap'],
    ...['reloadOut', 'magSlide', 'reloadIn', 'boltRack', 'shotgunPump', 'kitRustle'],
  ];
  for (const name of NO_BLEEP) {
    assert.ok(sound[name]?.length, `there is no sound called ${name}`);
    for (const take of sound[name])
      assert.ok(take.bleep < 0.3, `${take.name} is ${(take.bleep * 100).toFixed(0)}% one bare note`);
  }
  // the measure does tell: a device that beeps on purpose — the lodestar — still measures as one
  assert.ok(sound.beaconPing[0].bleep > 0.6, `the beacon's ping measures ${sound.beaconPing[0].bleep}`);

  // A gun: how long it lasts (to 40 dB under its loudest), and how much of it is under 250 Hz. The carbine's and
  // the pistol's were 0.03 s; the machines' rifle 0.12 s.
  const every = (name, key) => Math.min(...sound[name].map((take) => take[key]));
  for (const [name, lasts, low] of [
    ['shot', 0.3, 0.5],
    ['pistolShot', 0.2, 0.4],
    ['shotSentry', 0.6, 0.5],
    ['shotgunShot', 0.2, 0.8],
  ]) {
    assert.ok(every(name, 'lasts') >= lasts, `${name} lasts ${every(name, 'lasts').toFixed(2)} s`);
    assert.ok(every(name, 'low') >= low, `${name}: ${(every(name, 'low') * 100).toFixed(0)}% of it is low down`);
  }
  // …and they are still in their order: the shotgun the loudest, then the machines' rifle, the carbine, the pistol
  const loud = (name) => Math.max(...sound[name].map((take) => take.loud));
  assert.ok(loud('shotgunShot') > loud('shotSentry'), 'the shotgun is not the loudest gun');
  assert.ok(loud('shotSentry') > loud('shot') * 1.5, 'an unsuppressed rifle is no louder than the suppressed carbine');
  assert.ok(loud('shot') > loud('pistolShot') * 1.3, 'the pistol is as loud as the carbine');

  // The working of a gun (the same day: "make the reload animation more realistic and make a sound"). A reload
  // was two blips of dull noise — a quarter as loud as the shot as they were built, turned up 2.2 times to be
  // heard at all, and 5% of them above 2 kHz, which is all a phone's speaker carries. A magazine going home and
  // a bolt going forward are now most of the way to as loud as the shot itself, and a fifth and more of every
  // one of these is above 2 kHz.
  for (const name of ['reloadIn', 'boltRack']) {
    const share = loud(name) / loud('shot');
    assert.ok(share > 0.5 && share < 1.1, `${name} is ${share.toFixed(2)} of the carbine's shot`);
  }
  assert.ok(loud('shotgunPump') > loud('shot') * 0.5, 'the pump cannot be heard');
  for (const name of ['reloadOut', 'magSlide', 'reloadIn', 'boltRack', 'shotgunPump', 'shellIn'])
    assert.ok(every(name, 'high') >= 0.2, `${name}: only ${(every(name, 'high') * 100).toFixed(0)}% above 2 kHz`);
});

test('the background is a hush, not a hum: nothing that plays all the time has a steady note in it', async () => {
  // Decision of 12 November 2026, after "change the annoying humming sounds". The measure is src/audio/tone.js
  // (how far the strongest steady note stands above the sound around it); the limit is 12 dB. The facility's hum,
  // the cascade and the drones measured 61, 82 and 70 dB before; noise of any colour measures under 5.
  const result = JSON.parse(await js('JSON.stringify(__G.audio.selfTest())'));
  const loop = Object.fromEntries(result.sounds.filter((s) => s.tonal !== undefined).map((s) => [s.name, s]));
  assert.deepEqual(
    Object.keys(loop)
      .filter((name) => loop[name].bed)
      .sort(),
    ['cascade', 'hum', 'wind'],
    'the three beds that play through the Ambience volume',
  );
  for (const name of ['wind', 'hum', 'cascade', 'droneFly', 'fire'])
    assert.ok(loop[name].tonal < 12, `${name}: a steady note stands ${loop[name].tonal.toFixed(1)} dB out of it`);
  // the measure does tell: the alarm is a horn, and it says so
  assert.ok(loop.alarm.tonal > 30, `the alarm measures ${loop.alarm.tonal.toFixed(1)} dB: the measure is broken`);

  // The score. Until 16 November 2026 a quiet site had no music under it at all, and this test said so. Then
  // the owner asked for "some background music that nice appropriate at the background" — four days after the
  // humming. Both are kept, in the form that fits a tune:
  //   - nothing that plays ALL THE TIME has a note in it: a breath of noise under a scene, or nothing (as before);
  //   - every scene has a score, and no note of it is HELD. `held` is src/audio/tone.js `heldFor`: how long the
  //     longest-held note of a sound holds its level. A drone measures as long as it sounds; these are struck,
  //     and measure a few tenths of a second (src/audio/score.js MAX_NOTE is the whole life of a note);
  //   - it is background: a quiet site's is the quietest, and a fight's is under a third of a carbine round.
  const HELD = 1;
  const bed = async (scene, hits) =>
    JSON.parse(
      await page.evaluate(`__G.audio.debugMusicBed("${scene}", 7, { hits: ${hits} }).then(JSON.stringify)`, {
        timeoutMs: 60000,
      }),
    );
  const quiet = await bed('calm', false);
  assert.ok(quiet.rms < 1e-4, `something in the calm scene never stops (rms ${quiet.rms})`);
  const level = {};
  for (const scene of ['calm', 'tense', 'combat', 'exfil']) {
    const score = await bed(scene, true);
    level[scene] = score.rms;
    assert.ok(score.held > 0.05, `${scene}: there is not a note in the score`);
    assert.ok(score.held < HELD, `${scene}: a note of the score is held for ${score.held.toFixed(2)} s`);
    assert.ok(score.peak > 0.1 && score.peak < 0.9, `${scene}: the score peaks at ${score.peak.toFixed(2)}`);
    if (scene === 'calm') continue;
    const always = await bed(scene, false);
    assert.ok(always.rms > 0.003, `${scene}: the breath under the scene is missing`);
    assert.ok(always.tonal < 12, `${scene}: a steady note stands ${always.tonal.toFixed(1)} dB out of the score`);
    assert.ok(always.held < 0.5, `${scene}: what never stops holds a note for ${always.held.toFixed(2)} s`);
    assert.ok(score.rms > always.rms * 1.15, `${scene}: the score adds nothing to the breath`);
  }
  assert.ok(level.calm > 0.01 && level.calm < 0.05, `the calm score's level is ${level.calm.toFixed(4)}`);
  assert.ok(level.calm < level.combat, 'a quiet site is played as loudly as a fight');
  const shot = Math.max(
    ...JSON.parse(await js('JSON.stringify(__G.audio.selfTest())'))
      .sounds.filter((s) => s.name.split('#')[0] === 'shot')
      .map((s) => s.loud),
  );
  for (const scene of ['combat', 'exfil'])
    assert.ok(level[scene] < shot / 3, `${scene}: the score (${level[scene].toFixed(3)}) against a round (${shot})`);

  // the Ambience volume is its own setting, and it is what the beds go through
  assert.equal(await js('__G.settings.get("ambience")'), 0.6);
});

test('DEPLOY → briefing → BEGIN puts you in the drainage adit, under the mountain, outside the grating', async () => {
  await click('deploy');
  assert.equal(await js('__G.menus.current()'), 'briefing');
  const briefing = await js('document.querySelector("#menus").textContent');
  assert.match(
    briefing,
    /cut into the root of a mountain.*drainage adit/s,
    'the briefing says where the site is and how you get in',
  );
  // …and what it says of the rock overhead is the figure test/unit/mountain.test.mjs holds the mountain to
  assert.match(briefing, /cascade hall under at least fifty metres of rock/);
  assert.doesNotMatch(briefing, /eighty metres/);
  // what the place is, and what is to be done to it (the owner, 12 November 2026: "i don't [want] it to be a
  // plant but rather uranium enrichment facility and i want to blow up the centrefuges")
  assert.match(briefing, /uranium enrichment facility/);
  assert.match(briefing, /Set a charge on each of the four centrifuge cascades, then blow them from the control room/);
  assert.doesNotMatch(briefing, /\bplant\b/i);
  await click('begin');
  assert.equal(await state(), 'playing');
  assert.equal(await js('__G.menus.current()'), null);
  assert.equal(await js('document.querySelector("#hud").hidden'), false);
  const m = JSON.parse(
    await js(
      'JSON.stringify({ phase: __G.mission.phase, total: __G.mission.hostilesTotal, alive: __G.enemies.remaining(), x: __G.player.x })',
    ),
  );
  assert.equal(m.phase, 'infil');
  // decisions of 12 November 2026: thirteen machines on Operator, not twenty-six — and then, "a bit harder",
  // fifteen (test/unit/difficulty.test.mjs)
  assert.deepEqual([m.total, m.alive], [15, 15]);
  assert.ok(m.x < 14, 'outside the grating');
  // under rock, under a low roof, and the screen names the place
  await until('document.querySelector("#hud .zone").textContent !== ""', 'the name of the place', 3000);
  const where = JSON.parse(
    await js(
      'JSON.stringify({ zone: document.querySelector("#hud .zone").textContent, sky: __G.world.openSky(__G.player.x, __G.player.z), roof: __G.world.grid.ceil[__G.world.grid.index(Math.floor(__G.player.x), Math.floor(__G.player.z))], tasks: document.querySelector("#hud .objectives").textContent })',
    ),
  );
  assert.equal(where.zone.toUpperCase(), 'DRAINAGE ADIT');
  assert.equal(where.sky, false);
  assert.ok(where.roof > 2.3 && where.roof < 3.4, `the adit's roof is ${where.roof} m`);
  assert.match(where.tasks, /under the exhaust shaft/);
  assert.match(where.tasks, /road tunnel/);
});

test('the map reference: the readout says which way you face and where the next thing to do lies; north turns with you', async () => {
  // the mission begins facing east, so north is on the left of the small map
  await until('__G.hud.drawn.north[0] < -0.95', 'the small map to be drawn', 5000);
  const read = () =>
    js(
      'JSON.stringify({ facing: document.querySelector("#hud .bearing .facing").textContent, goal: document.querySelector("#hud .bearing .goal").textContent, contact: document.querySelector("#hud .bearing .contact").textContent, north: __G.hud.drawn.north, radio: document.querySelector("#hud .radio").textContent })',
    ).then(JSON.parse);
  const east = await read();
  assert.equal(east.facing, 'FACING EAST');
  assert.match(east.goal, /^◆ (N|NE|E|SE|S|SW|W|NW) \d+ m$/, 'the nearest charge, by compass point and distance');
  assert.equal(east.contact, '', 'nobody is after you yet');
  assert.match(east.radio, /dead ahead of you, to the east/);
  // the nearest charge from the cut in the wire is the cascade hall, to the north-east
  assert.ok(east.goal.startsWith('◆ NE '), east.goal);

  await js('__G.player.yaw = 0; void 0');
  await until('__G.hud.drawn.north[1] < -0.95', 'north to come round to the top', 3000);
  assert.equal((await read()).facing, 'FACING NORTH');
  await js('__G.player.yaw = Math.PI / 2; void 0');
  await until('__G.hud.drawn.north[0] > 0.95', 'north to come round to the right', 3000);
  assert.equal((await read()).facing, 'FACING WEST');
  await js('__G.player.yaw = -Math.PI / 2; void 0');
});

test('Space jumps: up about a metre and back down, and not again in mid-air', async () => {
  await js('__G.debug.teleport(20.5, 70.5, 0)');
  await sleep(150);
  assert.deepEqual(JSON.parse(await js('JSON.stringify([__G.player.y, __G.player.grounded])')), [0, true]);
  const eye = await js('__G.player.eye');
  // watched from inside the page, every frame, so that a slow test machine cannot miss the top of it
  await js(
    'window.__jump = { top: 0, eye: 0, landings: 0 }; window.__watch = setInterval(() => { const p = __G.player; __jump.top = Math.max(__jump.top, p.y); __jump.eye = Math.max(__jump.eye, p.eye); }, 4); void 0',
  );
  await page.holdKey('Space', ' ', 32, 60);
  await until('__G.player.y > 0.4', 'the feet to leave the ground', 3000);
  await page.holdKey('Space', ' ', 32, 60);
  await until('__G.player.grounded && __G.player.y === 0 && __jump.top > 0.4', 'the landing', 5000);
  await js('clearInterval(window.__watch)');
  const jump = JSON.parse(await js('JSON.stringify(__jump)'));
  assert.ok(jump.top > 0.9 && jump.top < 1.2, `the jump went ${jump.top.toFixed(2)} m up`);
  assert.ok(jump.eye > eye + 0.9, 'the view goes up with you');
});

test('a crate is cover you can get on top of: walk into it and it stops you, jump and you are standing on it', async () => {
  // the lone crate south of the container stack, at cell 47,78; come at it from the south
  await js('__G.player.hidden = true; __G.debug.teleport(47.5, 81.5, 0)');
  await page.keyDown('KeyW', 'w', 87);
  try {
    await until('__G.player.speed < 0.05 && __G.player.z < 79.6', 'the crate to stop the walk', 5000);
    const stopped = JSON.parse(await js('JSON.stringify([__G.player.z, __G.player.y])'));
    assert.ok(Math.abs(stopped[0] - 79.32) < 0.03, `stopped at z = ${stopped[0].toFixed(2)}`);
    assert.equal(stopped[1], 0);
    await page.holdKey('Space', ' ', 32, 60);
    await until('__G.player.grounded && __G.player.y === 1', 'to be standing on the crate', 5000);
    assert.ok(Math.abs((await js('__G.player.eye')) - 2.62) < 0.15, 'the view is a metre higher');
    // keep walking: off the far edge and back to the ground
    await until('__G.player.grounded && __G.player.y === 0 && __G.player.z < 77.7', 'to walk off the far side', 5000);
  } finally {
    await page.keyUp('KeyW', 'w', 87);
  }
});

test('W walks you forward and the wall of the world stops you', async () => {
  // from the wire again: the tests above have moved the player about
  await js('__G.debug.start()');
  const before = JSON.parse(await js('JSON.stringify({ x: __G.player.x, z: __G.player.z })'));
  await press('KeyW', 900);
  const after = JSON.parse(await js('JSON.stringify({ x: __G.player.x, z: __G.player.z })'));
  assert.ok(after.x - before.x > 1.5, `moved ${after.x - before.x} m east`);
  await js('__G.debug.teleport(64.5, 56.2, 0)');
  await press('KeyW', 1200);
  const z = await js('__G.player.z');
  assert.ok(z > 55.3, `walked into the building wall: z = ${z}`);
});

test('left alone, the garrison walks its rounds: every patrol moves, and nobody ends up inside a wall', async () => {
  await js('__G.debug.start()');
  const snap = () =>
    js('JSON.stringify(__G.enemies.list.map((u) => ({ x: u.x, z: u.z, legs: u.route.length })))').then(JSON.parse);
  const before = await snap();
  const farthest = before.map(() => 0);
  // sampled over fourteen seconds of the game's own clock: a short beat brings a unit back to where it began
  const t0 = await js('__G.mission.time');
  for (let k = 1; k <= 7; k++) {
    await until(`__G.mission.time > ${t0 + k * 2}`, 'two more seconds of patrol', 30000);
    (await snap()).forEach((unit, n) => {
      farthest[n] = Math.max(farthest[n], Math.hypot(unit.x - before[n].x, unit.z - before[n].z));
    });
  }
  const idle = before.flatMap((unit, n) =>
    unit.legs > 1 && farthest[n] < 2 ? [`#${n} got ${farthest[n].toFixed(1)} m from its post`] : [],
  );
  assert.deepEqual(idle, [], 'patrols that did not walk');
  assert.equal(
    await js('__G.enemies.list.some((u) => u.brain.state === "combat")'),
    false,
    'nobody is fighting: the player is outside the wire',
  );
  const inWall = await js(
    'JSON.stringify(__G.enemies.list.filter((u) => !__G.world.grid.walkable(Math.floor(u.x), Math.floor(u.z), u.spec.flying)).map((u) => u.id))',
  );
  assert.equal(inWall, '[]', 'units standing where nothing can stand');
});

test('holding the trigger fires at the carbine’s rate, and R reloads from the reserve', async () => {
  await js('__G.debug.start(); __G.debug.teleport(20.5, 70.5, 0)');
  const t0 = await js('__G.time');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await until('__G.weapon.shots >= 6', 'six rounds', 15000);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  const w = JSON.parse(await js('JSON.stringify({ mag: __G.weapon.mag, shots: __G.weapon.shots, t: __G.time })'));
  // measured on the game's own clock, so a busy machine cannot make it look slow
  const expected = (w.t - t0) / (60 / 640);
  assert.ok(
    w.shots <= expected + 1.5,
    `${w.shots} rounds in ${(w.t - t0).toFixed(2)} s of game time is faster than the gun`,
  );
  assert.ok(w.shots >= 6 && w.shots <= 12);
  assert.equal(w.mag, 30 - w.shots);
  await sleep(150);
  assert.equal(await js('__G.weapon.shots'), w.shots, 'letting go stops it');
  await press('KeyR', 80);
  await until('__G.weapon.mag === 30', 'the reload to finish', 8000);
  // three magazines in reserve, where there were four until 12 November 2026 (test/unit/arms.test.mjs)
  assert.equal(await js('__G.weapon.reserve'), 90 - w.shots);
});

test('a reload is seen and heard: the hand leaves the gun for the magazine, every part of it sounds at its moment, and a gun that ran dry has its bolt let go', async () => {
  // Decision of 16 November 2026 — the owner: "make the reload animation more realistic and make a sound". Until
  // then the gun sank out of the picture for two seconds and two blips of dull noise were played. What a reload
  // looks like, moment by moment, is src/reload.js (test/unit/reload.test.mjs); that the game in the hands DOES
  // it — and says it, through the sound engine — is held here. Moments are measured as shares of the reload, on
  // the game's own clock: a busy machine cannot move them.
  await js(
    '__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); __G.debug.teleport(20.5, 70.5, 0); void 0',
  );
  await js(`(() => {
    const G = __G;
    window.__cues = [];
    if (window.__cueSpy) return;
    window.__cueSpy = true;
    const play = G.audio.play;
    G.audio.play = (name, opts) => {
      const w = G.weapon;
      window.__cues.push([name, w.reloadT > 0 ? 1 - w.reloadT / w.reloadLen : -1, (opts && opts.gain) ?? 1, (opts && opts.rate) ?? 1]);
      return play.call(G.audio, name, opts);
    };
  })()`);
  const parts = () =>
    js(`JSON.stringify((() => {
      const w = __G.weapon, m = w.model, p = m.parts;
      const at = (o) => (o ? [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z] : null);
      return { gun: at(m.root), hand: at(p.armL), mag: at(p.mag), bolt: p.bolt ? p.bolt.position.z : null,
        shell: p.shell ? p.shell.visible : null, done: w.reloadT > 0 ? 1 - w.reloadT / w.reloadLen : -1, how: w.reloadHow, rounds: w.mag };
    })())`).then(JSON.parse);
  const cues = () => js('JSON.stringify(window.__cues)').then(JSON.parse);
  const apart = (a, b, n = 3) => Math.hypot(...a.slice(0, n).map((v, k) => v - b[k]));
  const reloadTo = async (share) => {
    await js('window.__cues = []; void 0');
    await press('KeyR', 60);
    await until(
      `__G.weapon.reloadT > 0 && 1 - __G.weapon.reloadT / __G.weapon.reloadLen >= ${share}`,
      'the reload',
      6000,
    );
    return parts();
  };
  const settle = async () => {
    await until('__G.weapon.reloadT === 0', 'the reload to end', 8000);
    await sleep(900);
    return parts();
  };
  // (only the sounds of a gun being worked: water drips and doors go by the same engine)
  const WORKING = ['reloadOut', 'kitRustle', 'magSlide', 'reloadIn', 'boltRack', 'shellIn', 'shotgunPump'];
  const working = (list) => list.filter(([name]) => WORKING.includes(name));
  const said = (list) => working(list).map(([name]) => name);

  // ---------- the carbine, run dry ----------
  await js('__G.weapon.mag = 0; void 0');
  await sleep(500);
  const rest = await parts();
  const mid = await reloadTo(0.45);
  assert.deepEqual([mid.how.dry, mid.how.held], [true, false]);
  // the hand has left the fore-end and gone for a magazine; the old magazine is out and away; and the gun has
  // been brought UP to be worked on — it used to sink out of the picture
  assert.ok(
    apart(mid.hand, rest.hand) > 0.3,
    `the hand is ${apart(mid.hand, rest.hand).toFixed(2)} m from the fore-end`,
  );
  assert.ok(apart(mid.mag, rest.mag) > 0.2, `the magazine is ${apart(mid.mag, rest.mag).toFixed(2)} m from the well`);
  assert.ok(mid.gun[1] - rest.gun[1] > 0.08, `the gun was raised by ${(mid.gun[1] - rest.gun[1]).toFixed(3)} m`);
  // it ran dry: its bolt stands open, and still does with the old magazine out
  assert.ok(Math.abs(mid.bolt - rest.bolt) < 1e-4, 'the bolt of a dry gun moved before it was let go');
  const end = await settle();
  assert.equal(end.rounds, 30);
  // everything is back exactly where it was — and the bolt has gone forward
  assert.ok(apart(end.hand, rest.hand, 6) < 1e-3, `the hand came back ${apart(end.hand, rest.hand, 6)} out`);
  assert.ok(apart(end.mag, rest.mag, 6) < 1e-3, `the magazine came back ${apart(end.mag, rest.mag, 6)} out`);
  assert.ok(apart(end.gun, rest.gun, 6) < 5e-3, `the gun came back ${apart(end.gun, rest.gun, 6)} out`);
  assert.ok(rest.bolt - end.bolt > 0.02, `the bolt went forward ${(rest.bolt - end.bolt).toFixed(3)} m`);
  // what was heard, and when: the magazine out, the hand at the kit, the new one sliding up, home — and the bolt
  const dry = working(await cues());
  assert.deepEqual(said(dry), ['reloadOut', 'kitRustle', 'magSlide', 'reloadIn', 'boltRack']);
  [0.2, 0.43, 0.62, 0.655, 0.79].forEach((when, k) =>
    assert.ok(
      Math.abs(dry[k][1] - when) < 0.06,
      `${dry[k][0]} came at ${dry[k][1].toFixed(3)} of the reload, not ${when}`,
    ),
  );
  for (const [name, , gain] of dry) assert.ok(gain >= 0.5 && gain <= 1.2, `${name} is played at ${gain}`);

  // ---------- with a round still chambered: no bolt to let go, and none is heard ----------
  await js('__G.weapon.mag = 5; void 0');
  await sleep(300);
  const shut = await parts();
  assert.ok(rest.bolt - shut.bolt > 0.02, 'a gun with rounds in it stands with its bolt open');
  const wetMid = await reloadTo(0.5);
  assert.equal(wetMid.how.dry, false);
  assert.ok(Math.abs(wetMid.bolt - shut.bolt) < 1e-4);
  await settle();
  assert.deepEqual(said(await cues()), ['reloadOut', 'kitRustle', 'magSlide', 'reloadIn']);

  // ---------- cut short by a change of gun: nothing is left where the reload had put it ----------
  await js('__G.weapon.mag = 5; void 0');
  await sleep(300);
  const cut = await reloadTo(0.3);
  assert.ok(apart(cut.hand, shut.hand) > 0.1);
  await press('Digit2', 60);
  await until('__G.weapon.current === "pistol" && !__G.weapon.swapping', 'the sidearm', 6000);
  assert.equal(await js('__G.weapon.arms.guns.carbine.mag'), 5, 'a reload that was cut short counted its rounds');
  assert.ok(!said(await cues()).includes('reloadIn'), 'a magazine that never went home was heard going home');
  await press('Digit1', 60);
  await until('__G.weapon.current === "carbine" && !__G.weapon.swapping', 'the carbine again', 6000);
  await sleep(900);
  const back = await parts();
  assert.ok(
    apart(back.hand, shut.hand, 6) < 1e-3 && apart(back.mag, shut.mag, 6) < 1e-3,
    'the carbine came back out of true',
  );
  assert.ok(Math.abs(back.bolt - shut.bolt) < 1e-4);

  // ---------- the sidearm, run dry: its magazine drops free, and its slide is let go ----------
  await press('Digit2', 60);
  await until('__G.weapon.current === "pistol" && !__G.weapon.swapping', 'the sidearm', 6000);
  await js('__G.weapon.mag = 0; void 0');
  await sleep(500);
  const pistol = await parts();
  const drop = await reloadTo(0.3);
  assert.ok(
    pistol.mag[1] - drop.mag[1] > 0.1,
    `the sidearm's magazine has dropped ${(pistol.mag[1] - drop.mag[1]).toFixed(3)} m`,
  );
  const loaded = await settle();
  assert.ok(pistol.bolt - loaded.bolt > 0.015, 'the slide of a sidearm that ran dry did not go forward');
  assert.ok(apart(loaded.hand, pistol.hand, 6) < 1e-3 && apart(loaded.mag, pistol.mag, 6) < 1e-3);
  assert.deepEqual(said(await cues()), ['reloadOut', 'kitRustle', 'magSlide', 'reloadIn', 'boltRack']);

  // ---------- the shotgun: a shell at a time, each seen in the hand and heard as it goes in; and, from
  // empty, the pump is worked when the last is in ----------
  await press('Digit3', 60);
  await until('__G.weapon.current === "shotgun" && !__G.weapon.swapping', 'the shotgun', 6000);
  await js('Object.assign(__G.weapon.arms.guns.shotgun, { mag: 0, reserve: 2 }); void 0');
  await sleep(500);
  const pump = await parts();
  assert.equal(pump.shell, false, 'a shell is in sight with nobody loading');
  const carried = await reloadTo(0.6);
  assert.equal(carried.shell, true, 'the shell that is going in cannot be seen');
  assert.ok(apart(carried.hand, pump.hand) > 0.05);
  await until('__G.weapon.arms.guns.shotgun.mag === 2 && __G.weapon.reloadT === 0', 'both shells', 6000);
  await sleep(1200);
  const full = await parts();
  assert.equal(full.shell, false);
  assert.ok(apart(full.hand, pump.hand, 6) < 1e-3, 'the hand did not go back to the pump');
  const shells = await cues();
  assert.deepEqual(said(shells), ['kitRustle', 'shellIn', 'kitRustle', 'shellIn', 'shotgunPump']);
  for (const [name, when] of shells.filter(([name]) => name === 'shellIn'))
    assert.ok(Math.abs(when - 0.82) < 0.12, `${name} came at ${when.toFixed(3)} of its half second`);
  // with a shell still chambered it is not pumped again
  await js('Object.assign(__G.weapon.arms.guns.shotgun, { mag: 1, reserve: 1 }); void 0');
  await reloadTo(0.5);
  await until('__G.weapon.arms.guns.shotgun.mag === 2 && __G.weapon.reloadT === 0', 'the shell', 6000);
  await sleep(1000);
  assert.deepEqual(said(await cues()), ['kitRustle', 'shellIn']);
  await press('Digit1', 60);
  await until('__G.weapon.current === "carbine" && !__G.weapon.swapping', 'the carbine again', 6000);
});

test('on a laptop the sight can be kept up with nothing held, so that the trigger is free: a right click or Z raises it, the same lowers it', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; __G.debug.teleport(20.5, 70.5, 0)');
  const aim = () => js('JSON.stringify([__G.input.intent.aim, __G.input.intent.aimLatched])').then(JSON.parse);
  const up = () => until('__G.weapon.aim > 0.9', 'the sight to come up to the eye', 3000);
  const down = () => until('__G.weapon.aim < 0.1', 'the sight to come down', 3000);

  // held, the right button aims for as long as it is down — as it always did
  await mouse('mousePressed', 'right');
  await up();
  await sleep(350);
  assert.deepEqual(await aim(), [true, false]);
  await mouse('mouseReleased', 'right');
  await down();
  assert.deepEqual(await aim(), [false, false]);

  // clicked, it stays up, and the screen says how to lower it
  await mouse('mousePressed', 'right');
  await mouse('mouseReleased', 'right');
  await up();
  assert.deepEqual(await aim(), [true, true]);
  assert.equal(await js('document.querySelector("#hud .note").textContent'), 'SIGHT UP — RIGHT CLICK OR Z LOWERS IT');
  // …and with the sight up and nothing held, the left button fires
  let shots = await js('__G.weapon.shots');
  await mouse('mousePressed', 'left');
  await until(`__G.weapon.shots >= ${shots + 3}`, 'three rounds down the sight', 5000);
  await mouse('mouseReleased', 'left');
  assert.ok((await js('__G.weapon.aim')) > 0.9, 'the sight stayed at the eye while firing');
  // the next right click lowers it
  await mouse('mousePressed', 'right');
  await mouse('mouseReleased', 'right');
  await down();
  assert.deepEqual(await aim(), [false, false]);

  // Z does the same from the keyboard, and X is a trigger for a hand with no button to spare
  await press('KeyZ', 60);
  await up();
  assert.deepEqual(await aim(), [true, true]);
  shots = await js('__G.weapon.shots');
  await page.keyDown('KeyX', 'x', 88);
  await until(`__G.weapon.shots >= ${shots + 2}`, 'two rounds from the X key', 5000);
  await page.keyUp('KeyX', 'x', 88);
  assert.ok((await js('__G.weapon.aim')) > 0.9, 'the sight stayed at the eye while firing');
  await press('KeyZ', 60);
  await down();

  // nobody runs with the sight at the eye: Shift lowers it. And so does a reload.
  await press('KeyZ', 60);
  await up();
  await page.holdKey('ShiftLeft', 'Shift', 16, 60);
  await down();
  assert.deepEqual(await aim(), [false, false]);
  await press('KeyZ', 60);
  await up();
  await press('KeyR', 60);
  await until('__G.weapon.reloading', 'the reload to start', 2000);
  await down();
  assert.deepEqual(await aim(), [false, false]);
  await until('!__G.weapon.reloading', 'the reload to finish', 8000);
});

test('a tap on the trigger that is over before the next frame is drawn still fires its round', async () => {
  // a tap on a trackpad is pressed and let go within a few milliseconds: both can arrive between two frames
  await js('__G.debug.start(); __G.player.hidden = true; __G.debug.teleport(20.5, 70.5, 0)');
  await sleep(200);
  await js(
    '{ const c = document.querySelector("#view"); c.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true })); window.dispatchEvent(new MouseEvent("mouseup", { button: 0 })); }',
  );
  await sleep(300);
  assert.deepEqual(JSON.parse(await js('JSON.stringify([__G.weapon.shots, __G.weapon.mag])')), [1, 29]);
});

test('Q and E lean the head out to one side: the eye goes with it, the view tips, and a wall stops it', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; __G.debug.teleport(20.5, 70.5, 0)');
  const head = () =>
    js(
      'JSON.stringify({ lean: __G.player.lean, k: __G.player.leanK, hx: __G.player.headX - __G.player.x, hz: __G.player.headZ - __G.player.z, cx: __G.camera.position.x - __G.player.x, cz: __G.camera.position.z - __G.player.z, roll: __G.camera.rotation.z })',
    ).then(JSON.parse);
  // facing north, so that right is east
  await page.keyDown('KeyE', 'e', 69);
  await until('__G.player.leanK > 0.98', 'the lean to the right', 3000);
  const right = await head();
  await page.keyUp('KeyE', 'e', 69);
  assert.ok(right.hx > 0.48 && right.hx <= 0.5 && Math.abs(right.hz) < 1e-6, `the head is ${right.hx} m to the east`);
  assert.ok(
    Math.abs(right.cx - right.hx) < 1e-6 && Math.abs(right.cz - right.hz) < 1e-6,
    'the eye is where the head is',
  );
  assert.ok(right.roll < -0.13 && right.roll > -0.17, `the view tips over with it: ${right.roll} rad`);
  await until('__G.player.leanK === 0 && __G.player.headX === __G.player.x', 'to stand straight again', 3000);

  await page.keyDown('KeyQ', 'q', 81);
  await until('__G.player.leanK < -0.98', 'the lean to the left', 3000);
  const left = await head();
  await page.keyUp('KeyQ', 'q', 81);
  assert.ok(left.hx < -0.48 && left.roll > 0.13, 'and the same to the left');
  await until('__G.player.leanK === 0', 'to stand straight again', 3000);

  // beside the building's south wall, facing west so that right is north: into the wall
  await js('__G.debug.teleport(64.5, 55.4, Math.PI / 2)');
  await page.keyDown('KeyE', 'e', 69);
  await until('__G.player.lean > 0.98', 'the body to tip all the way', 3000);
  const wall = await head();
  await page.keyUp('KeyE', 'e', 69);
  assert.ok(wall.k > 0.3 && wall.k < 0.6, `the head got ${(wall.k * 0.5).toFixed(2)} m of its half metre`);
  assert.ok(55.4 + wall.hz - 0.16 >= 55 - 1e-6, `the head is in the wall: z = ${55.4 + wall.hz}`);
  assert.ok(wall.roll < -0.03 && wall.roll > -0.1, 'and the view tips only as far as the head went');
});

test('a head leaned out round a corner is less to see than a body: a guard that saw nothing sees a little, and all of you once you step out', async () => {
  await js('__G.debug.start()');
  // a corner the site really has: a wall, a place to stand behind it, and a clear lane running north past it
  const corner = JSON.parse(
    await js(`JSON.stringify((() => {
      const g = __G.world.grid;
      const open = (x, z) => !g.solidAt(x, z, 0.1, 2.2);
      for (let z = 16; z < 84; z++)
        for (let x = 18; x < 108; x++) {
          if (!(g.occluder(x, z) >= 2.5)) continue;
          let ok = open(x, z + 1) && open(x + 1, z + 1);
          for (let k = 0; k <= 4 && ok; k++) ok = open(x + 1, z - k);
          if (ok) return { x, z };
        }
      return null;
    })())`),
  );
  assert.ok(corner, 'the site has a corner with a clear lane beside it');
  // one guard, alone on the site, posted five metres up the lane; the player behind the corner, facing north
  await js(`{
    const e = __G.enemies, u = e.byName("gate");
    e.remove(e.list.filter((other) => other !== u).map((other) => other.rollId));
    Object.assign(u, { x: ${corner.x + 1.5}, z: ${corner.z - 3.5}, route: [[${corner.x + 1}, ${corner.z - 4}]], routeI: 0, path: null, goalX: -1 });
    window.__peek = u;
    __G.debug.teleport(${corner.x + 0.5}, ${corner.z + 1.5}, 0);
  }`);
  // turns the guard's eyes on the player, so that what it sees is a matter of what there is to see
  const look = () =>
    js(
      '{ const u = __peek, p = __G.player; u.yaw = u.postYaw = Math.atan2(-(p.x - u.x), -(p.z - u.z)); u.headYaw = 0; u.scanT = 0; u.senseT = 0; }',
    );

  // standing straight behind the corner: nothing of you shows
  await look();
  await sleep(450);
  assert.deepEqual(JSON.parse(await js('JSON.stringify([__peek.sees, __peek.brain.awareness])')), [false, 0]);

  // leaning out: the head shows, and only the head
  await page.keyDown('KeyE', 'e', 69);
  await until('__G.player.leanK > 0.97', 'the lean', 3000);
  await look();
  await until('__peek.sees', 'the guard to see the head', 3000);
  const peek = JSON.parse(await js('JSON.stringify({ exposed: __peek.exposed, gain: __peek.gain })'));
  await page.keyUp('KeyE', 'e', 69);
  assert.equal(peek.exposed, 0.45, 'a head counts for 45% of a body');
  assert.ok(peek.gain > 0, 'it is not invisible');

  // back behind the corner, then out into the lane: all of you
  await until('__G.player.leanK === 0', 'to stand straight again', 3000);
  await js(`__G.debug.teleport(${corner.x + 1.5}, ${corner.z + 1.5}, 0)`);
  await look();
  await until('__peek.sees && __peek.exposed === 1', 'the guard to see the whole body', 3000);
});

test('ammunition is finite and the screen counts it twice: what is in the gun in hand, and every round that is left for it', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; __G.debug.teleport(20.5, 70.5, 0)');
  const panel = () =>
    js(
      'JSON.stringify({ mag: document.querySelector("#hud .ammo .mag").textContent, total: document.querySelector("#hud .ammo .total").textContent, labels: [...document.querySelectorAll("#hud .ammo .count i")].map((i) => i.textContent), cls: document.querySelector("#hud .ammo").className, hint: document.querySelector("#hud .ammo .knife").textContent, gun: document.querySelector("#hud .ammo .gun").textContent, rack: [...document.querySelectorAll("#hud .ammo .rack span")].map((s) => s.textContent + (s.classList.contains("on") ? " ←" : "") + (s.classList.contains("dry") ? " ✗" : "")) })',
    ).then(JSON.parse);
  const fire = async (done, label) => {
    await mouse('mousePressed', 'left');
    try {
      await until(done, label, 8000);
    } finally {
      await mouse('mouseReleased', 'left');
    }
    await sleep(200);
  };
  await sleep(150);
  let p = await panel();
  assert.deepEqual([p.mag, p.total, p.labels], ['30', '120', ['IN MAG', 'TOTAL LEFT']]);
  assert.equal(p.hint, 'KNIFE · V');
  // under the two counters: which gun that is, and everything else that is carried, by the key that takes it
  assert.equal(p.gun, 'K9 CARBINE · AUTO');
  assert.deepEqual(p.rack, ['1 CARBINE 120 ←', '2 SIDEARM 48', '3 SHOTGUN 24', 'T EMP 2']);

  // every round fired comes off both
  await fire('__G.weapon.shots >= 4', 'four rounds');
  const n = await js('__G.weapon.shots');
  p = await panel();
  assert.deepEqual([p.mag, p.total], [String(30 - n), String(120 - n)]);
  // a reload moves rounds from the reserve to the magazine: the total does not change
  await press('KeyR', 80);
  await until('__G.weapon.mag === 30', 'the reload to finish', 8000);
  await sleep(100);
  p = await panel();
  assert.deepEqual([p.mag, p.total], ['30', String(120 - n)]);

  // a cache gives a little for every gun, and a grenade — once
  await js('{ const [x, z] = __G.site.ammo[0]; __G.debug.teleport(x, z, 0); }');
  await until(`__G.weapon.total === ${120 - n + 30}`, 'the cache to be taken', 3000);
  assert.equal(await js('document.querySelector("#hud .note").textContent'), 'AMMUNITION — EVERY GUN · EMP +1');
  assert.deepEqual(JSON.parse(await js('JSON.stringify([...__G.caches])')), [0]);
  await js('__G.debug.teleport(20.5, 70.5, 0)');
  await sleep(200);
  await js('{ const [x, z] = __G.site.ammo[0]; __G.debug.teleport(x, z, 0); }');
  await sleep(400);
  assert.equal(await js('__G.weapon.total'), 120 - n + 30, 'the same cache gave twice');
  p = await panel();
  assert.equal(p.total, String(120 - n + 30));
  assert.deepEqual(p.rack, [`1 CARBINE ${150 - n} ←`, '2 SIDEARM 60', '3 SHOTGUN 30', 'T EMP 3']);

  // the carbine's last two rounds: the counts say so, and then it has none
  await js('__G.debug.teleport(20.5, 70.5, 0); __G.weapon.mag = 2; __G.weapon.reserve = 0; void 0');
  await sleep(150);
  p = await panel();
  assert.deepEqual([p.mag, p.total], ['2', '2']);
  assert.ok(/\blow\b/.test(p.cls) && /\bscarce\b/.test(p.cls) && !/\bout\b/.test(p.cls), p.cls);
  const before = await js('__G.weapon.shots');
  await fire('__G.weapon.total === 0', 'the last round');
  p = await panel();
  assert.deepEqual([p.mag, p.total, await js('__G.weapon.shots')], ['0', '0', before + 2]);
  assert.equal(p.rack[0], '1 CARBINE 0 ← ✗', 'an empty gun is struck out');
  assert.ok(!/\bout\b/.test(p.cls), 'there are two more guns');
  // holding the trigger down on it did nothing more; the NEXT pull brings the sidearm to hand, and says so
  assert.equal(await js('__G.weapon.current'), 'carbine');
  await fire('__G.weapon.current === "pistol" && !__G.weapon.swapping', 'the sidearm to come to hand');
  p = await panel();
  assert.deepEqual([p.mag, p.total, p.gun], ['12', '60', 'P5 SIDEARM · SUPPRESSED']);
  assert.equal(await js('__G.weapon.shots'), before + 2, 'the pull that changed guns also fired one');

  // not a round left for any gun: the screen says so, the trigger swings the knife, R reloads nothing, and no
  // round is fired from nowhere
  await js(
    'for (const key of ["carbine", "pistol", "shotgun"]) Object.assign(__G.weapon.arms.guns[key], { mag: 0, reserve: 0 }); void 0',
  );
  await sleep(150);
  p = await panel();
  assert.ok(/\bout\b/.test(p.cls), p.cls);
  assert.equal(p.hint, 'NO ROUNDS — KNIFE: FIRE OR V');
  assert.equal(await js('__G.weapon.out'), true);
  await mouse('mousePressed', 'left');
  await until('__G.weapon.knife.busy', 'the knife to be swung', 3000);
  await mouse('mouseReleased', 'left');
  await press('KeyR', 80);
  await sleep(150);
  assert.deepEqual(
    JSON.parse(
      await js('JSON.stringify([__G.weapon.reloading, __G.weapon.shots, __G.weapon.everything, __G.weapon.current])'),
    ),
    [false, before + 2, 0, 'pistol'],
  );
});

test('three guns and a grenade: 1, 2 and 3 take them in hand, the wheel goes round them, B is the carbine’s selector, and each does its own job', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; __G.debug.teleport(20.5, 70.5, 0); void 0');
  const hand = () =>
    js(
      'JSON.stringify({ gun: __G.weapon.current, mode: __G.weapon.mode, mag: __G.weapon.mag, total: __G.weapon.total, label: document.querySelector("#hud .ammo .gun").textContent })',
    ).then(JSON.parse);
  const take = async (code, gun) => {
    await press(code, 60);
    await until(`__G.weapon.current === "${gun}" && !__G.weapon.swapping`, `the ${gun} to come to hand`, 3000);
  };
  const wheel = (deltaY) =>
    page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY });
  const pull = async (ms = 60) => {
    await mouse('mousePressed');
    await sleep(ms);
    await mouse('mouseReleased');
    await sleep(140);
  };
  await sleep(150);
  assert.deepEqual(await hand(), { gun: 'carbine', mode: 'auto', mag: 30, total: 120, label: 'K9 CARBINE · AUTO' });

  // the carbine's selector: on SEMI a trigger held down gives one round, where on AUTO it gave a burst
  await press('KeyB', 60);
  await sleep(100);
  const semi = await hand();
  assert.deepEqual([semi.mode, semi.label], ['semi', 'K9 CARBINE · SEMI']);
  let shots = await js('__G.weapon.shots');
  await pull(600);
  assert.equal(await js('__G.weapon.shots'), shots + 1, 'SEMI fired more than one round for one pull');
  await pull();
  await pull();
  assert.equal(await js('__G.weapon.shots'), shots + 3, 'three pulls, three rounds');
  await press('KeyB', 60);
  await sleep(100);
  assert.equal((await hand()).mode, 'auto');

  // 2: the sidearm. One round a pull, twelve in it
  await take('Digit2', 'pistol');
  assert.deepEqual(await hand(), { gun: 'pistol', mode: 'semi', mag: 12, total: 48, label: 'P5 SIDEARM · SUPPRESSED' });
  shots = await js('__G.weapon.shots');
  await pull(500);
  assert.deepEqual(
    JSON.parse(await js('JSON.stringify([__G.weapon.shots, __G.weapon.mag])')),
    [shots + 1, 11],
    'the sidearm fires once a pull',
  );
  await press('KeyB', 60);
  await sleep(100);
  assert.equal((await hand()).mode, 'semi', 'the sidearm has no selector');
  // the carbine was untouched by all that: each gun has its own rounds
  assert.equal(await js('__G.weapon.arms.guns.carbine.mag + __G.weapon.arms.guns.carbine.reserve'), 117);

  // 3: the shotgun. One pull is eight pellets and one shell, and it has to be pumped before the next
  await take('Digit3', 'shotgun');
  assert.deepEqual(await hand(), { gun: 'shotgun', mode: 'semi', mag: 6, total: 24, label: 'M7 BREACHER · PUMP' });
  await js('__G.player.pitch = -0.5; void 0');
  await sleep(100);
  const marks = await js('__G.fx.marks');
  shots = await js('__G.weapon.shots');
  await pull();
  await pull();
  assert.deepEqual(
    JSON.parse(await js('JSON.stringify([__G.weapon.shots, __G.weapon.mag, __G.fx.marks])')),
    [shots + 1, 5, marks + 8],
    'two quick pulls: one blast, eight marks on the floor, and the second pull lost to the pump',
  );
  await sleep(800);
  await pull();
  assert.equal(await js('__G.weapon.mag'), 4);
  // R pushes shells in one at a time; a pull of the trigger stops that, and fires what is in the tube
  await sleep(800);
  await press('KeyR', 60);
  await until('__G.weapon.mag === 5', 'the first shell', 3000);
  assert.equal(await js('__G.weapon.reloading'), true, 'and it goes on to the next');
  shots = await js('__G.weapon.shots');
  await pull();
  await until(`__G.weapon.shots === ${shots + 1}`, 'the shot that interrupts the loading', 2000);
  assert.deepEqual(JSON.parse(await js('JSON.stringify([__G.weapon.reloading, __G.weapon.mag])')), [false, 4]);
  await sleep(900);
  await press('KeyR', 60);
  await until('__G.weapon.mag === 6 && !__G.weapon.reloading', 'the tube to be full', 6000);
  assert.equal(await js('__G.weapon.total'), 21, 'loading moves shells, it does not make them');
  await js('__G.player.pitch = 0; void 0');

  // the wheel goes round the three, one gun to a notch — and a flood of small turns is still one notch
  await wheel(100);
  await until('__G.weapon.current === "carbine" && !__G.weapon.swapping', 'the wheel to bring the carbine round', 3000);
  await sleep(320);
  await wheel(-100);
  await until('__G.weapon.current === "shotgun" && !__G.weapon.swapping', 'the wheel, the other way', 3000);
  await sleep(320);
  for (let k = 0; k < 12; k++) await wheel(12);
  await sleep(900);
  assert.equal(await js('__G.weapon.current'), 'carbine', 'one stroke of two fingers changed guns more than once');

  // with a machine held on one arm the shotgun cannot be worked: it is put away for the sidearm, and 3 is refused
  await take('Digit3', 'shotgun');
  await js(
    `{ const u = ${unit('gate')}; __G.debug.teleport(u.x + Math.sin(u.yaw) * 1.2, u.z + Math.cos(u.yaw) * 1.2, u.yaw); }`,
  );
  await until('__G.prompt && /SHIELD/.test(__G.prompt.text)', 'the sentry to be within reach', 3000);
  await press('KeyG', 60);
  await until('__G.enemies.held && __G.weapon.current === "pistol" && !__G.weapon.swapping', 'the sidearm', 3000);
  await press('Digit3', 60);
  await sleep(600);
  assert.equal(await js('__G.weapon.current'), 'pistol');
  assert.equal(await js('document.querySelector("#hud .note").textContent'), 'THE SHOTGUN TAKES BOTH HANDS');
  await press('Digit1', 60);
  await until('__G.weapon.current === "carbine" && !__G.weapon.swapping', 'the carbine, one-handed', 3000);
  await press('KeyG', 60);
  await until('!__G.enemies.held', 'the sentry to be let go', 2000);
});

test('the EMP grenade: T throws it, and what it goes off among is stopped — not harmed — and can be shut down by hand from the front', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  // The gate sentry. It is thrown at from six metres behind it, out in the open cavern, looking at the ground
  // between the two — a grenade is thrown a long way, and this one is wanted at the sentry's feet — and then
  // walked up to from the front. Both places are checked to be open ground: thrown from against a wall a
  // grenade goes where the wall sends it, and the test would be about the wall.
  const gate = unit('gate');
  const stand = (side, metres, pitch) =>
    js(
      `JSON.stringify((() => { const u = ${gate}, k = ${side === 'behind' ? 1 : -1}; const x = u.x + Math.sin(u.yaw) * ${metres} * k, z = u.z + Math.cos(u.yaw) * ${metres} * k; __G.debug.teleport(x, z, u.yaw + ${side === 'behind' ? 0 : 'Math.PI'}); __G.player.pitch = ${pitch}; const g = __G.world.grid; return { free: !g.blocked(Math.floor(x), Math.floor(z)), clear: g.sight(x, 1, z, u.x, 1, u.z) }; })())`,
    ).then(JSON.parse);
  assert.deepEqual(await stand('behind', 6, -0.35), { free: true, clear: true }, 'six metres behind the gate sentry');
  await sleep(200);
  assert.equal(await js('__G.enemies.takedownTarget(__G.player)'), null);
  const hp = await js(`${gate}.hp`);
  await press('KeyT', 60);
  await until('__G.weapon.grenades === 1', 'the grenade to leave the hand', 2000);
  assert.equal(await js('document.querySelector("#hud .ammo .rack .emp").textContent'), 'T EMP 1');
  await until(`${gate}.empT > 0`, 'the grenade to go off by the sentry', 5000);
  const stopped = JSON.parse(
    await js(
      `JSON.stringify({ hp: ${gate}.hp, stun: ${gate}.stunT, note: document.querySelector("#hud .note").textContent, dead: ${gate}.dead })`,
    ),
  );
  assert.equal(stopped.hp, hp, 'an EMP does no harm');
  assert.equal(stopped.dead, false);
  assert.ok(stopped.stun > 3 && stopped.stun <= 4, `it is stopped for ${stopped.stun} s`);
  // Decision of 16 November 2026 — the owner: "emp needs to turn of the light in a room". The note says both
  // things an EMP has done; until then it said only how many machines it had stopped, and where it puts out no
  // lamp it still says only that.
  const dark = await js('__G.debug.lamps.out().length');
  assert.match(stopped.note, dark ? /^EMP — \d STOPPED · LIGHTS OUT$/ : /^EMP — \d STOPPED$/);
  // while it is stopped it does not turn, move or see — walk up to its face and shut it down by hand
  const facing = await js(`${gate}.yaw`);
  await js('__G.player.hidden = false; void 0');
  assert.deepEqual(await stand('front', 1.3, 0), { free: true, clear: true }, 'face to face with it');
  await until('__G.prompt && /TAKE DOWN/.test(__G.prompt.text)', 'the takedown to be offered from the front', 2000);
  assert.deepEqual(
    JSON.parse(await js(`JSON.stringify([${gate}.yaw, ${gate}.brain.state, __G.enemies.alarm.active])`)),
    [facing, 'patrol', false],
    'it saw the player standing in front of it',
  );
  await press(USE, 60);
  await until(`${gate}.dead`, 'the takedown', 2000);
  assert.equal(await js('__G.takedowns'), 1);

  // one that is left alone comes round after four seconds, and goes to look at where it went off
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  await stand('behind', 6, -0.35);
  await sleep(200);
  await press('KeyT', 60);
  await until(`${gate}.empT > 0`, 'the second grenade', 5000);
  await js('__G.debug.speed(4); void 0');
  await until(`${gate}.stunT <= 0 && ${gate}.empT <= 0`, 'it to come round', 6000);
  await until(`${gate}.brain.state !== "patrol"`, 'it to go and look', 4000);
  await js('__G.debug.speed(1); void 0');
  // with none left T says so, and nothing is thrown
  await js('__G.weapon.arms.grenades = 0; void 0');
  await press('KeyT', 60);
  await sleep(150);
  assert.equal(await js('document.querySelector("#hud .note").textContent'), 'NO GRENADES');
  assert.equal(await js('__G.weapon.lob'), null);
});

// ---------- lamps that go out ----------
// Decision of 16 November 2026 — the owner, having played the second look: "i want to have the ability to shoot
// at the light to turn it off and turn on night goggles to use them also emp needs to turn of the light in a
// room". Until then the site's light was worked out once, when it was built, and nothing could change it. The
// rules are held without a browser (test/unit/lamps.test.mjs); what they DO to the built game is held here.

/** The light at chest height at (x, z), as one number: what machines, the gun and the light meter go by. */
const lightAt = (x, z) =>
  js(
    `(() => { const c = { setRGB(r, g, b) { this.v = r * 0.3 + g * 0.59 + b * 0.11; } }; __G.world.probe(${x}, ${z}, c); return c.v; })()`,
  );
/** The picture on the page, as pixels — and how bright it is on the whole, 0 to 255. */
const picture = async () => decodePng(await page.screenshot());
const brightness = ({ data }) => {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  return sum / (data.length / 4);
};
/** The lamp of the service corridor that hangs over (43.5, 44.5): its place in the game's list of lamps. */
const CORRIDOR_LAMP =
  '(() => { const d = __G.debug.lamps; for (let i = 0; i < d.site; i++) { const l = d.at(i); if (Math.abs(l.x - 43.5) < 0.01 && Math.abs(l.z - 44.5) < 0.01) return i; } return -1; })()';
/** How far the level's light is from what its lamps say it should be, every corner worked out again. */
const lightCheck = () => js('JSON.stringify(__G.world.lamps.check())').then(JSON.parse);
/** the light on a corner is kept in thirty-two bits: worked out again it is the same to that much, and no more */
const EXACT = 1e-5;

test('the light of the level can be worked out again from the level itself, and comes to what it was built with', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  const built = await lightCheck();
  assert.ok(built.corners > 400000, `only ${built.corners} corners can be lit again`);
  assert.equal(built.waiting, 0);
  assert.ok(built.worst < EXACT, `a corner of ${built.where} is ${built.worst} from what it was built with`);
  // everything but the outside of the mountain, which no lamp of the site lights: the moon alone does
  assert.deepEqual(built.left, ['terrain:rock']);
});

test('a lamp can be shot out: one round through its lens, and the place under it is dark from then on', async () => {
  await js(
    `__G.debug.start(); __G.player.hidden = true; __G.weapon.arms.mode = "semi"; window.__heard = [];
     if (!window.__hearing) { const noise = __G.enemies.noise; __G.enemies.noise = (x, z, r) => { window.__heard.push([x, z, r]); return noise.call(__G.enemies, x, z, r); }; window.__hearing = true; }
     void 0`,
  );
  const i = await js(CORRIDOR_LAMP);
  assert.ok(i >= 0, 'the corridor lamp is not where it was');
  const lamp = JSON.parse(await js(`JSON.stringify(__G.debug.lamps.at(${i}))`));
  assert.equal(lamp.zone, ZONE.CORRIDOR);
  assert.ok(lamp.box, 'it has no lens to hit');
  // four metres west of it along the corridor, looking up at its lens
  await js(
    `__G.debug.teleport(${lamp.x - 4}, ${lamp.z}, -Math.PI / 2); __G.player.pitch = Math.atan2(${(lamp.box[1] + lamp.box[4]) / 2} - __G.player.eye, 4); void 0`,
  );
  await sleep(700);
  const lens = `(() => { const g = __G.world.group.getObjectByName("glow").geometry.attributes, b = ${JSON.stringify(lamp.box)}; let most = 0; for (let k = 0; k < g.position.count; k++) { const x = g.position.getX(k), y = g.position.getY(k), z = g.position.getZ(k); if (x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5]) most = Math.max(most, g.color.getX(k), g.color.getY(k), g.color.getZ(k)); } return most; })()`;
  const before = {
    under: await lightAt(lamp.x, lamp.z),
    seen: await js(`__G.world.visibility(${lamp.x}, ${lamp.z})`),
    lens: await js(lens),
    picture: brightness(await picture()),
  };
  assert.ok(before.under > 1.5 && before.seen > 0.95, `under a lamp: ${JSON.stringify(before)}`);
  assert.ok(before.lens > 2, `its lens glows at ${before.lens}`);
  assert.deepEqual(JSON.parse(await js('JSON.stringify(__G.debug.lamps.out())')), []);

  await mouse('mousePressed');
  await sleep(60);
  await mouse('mouseReleased');
  await until('__G.debug.lamps.out().length > 0', 'the lamp to go out', 3000);
  assert.equal(await js('__G.weapon.shots'), 1, 'one round');
  assert.deepEqual(JSON.parse(await js('JSON.stringify(__G.debug.lamps.out())')), [i]);
  assert.equal(await js('document.querySelector("#hud .note").textContent'), 'LAMP OUT', 'the screen says so');
  // what a machine sees you by is right at once, in the same frame: the game does not wait for the picture
  const seen = await js(`__G.world.visibility(${lamp.x}, ${lamp.z})`);
  assert.ok(seen < 0.7, `somebody standing under it is still seen at ${seen}`);
  // the picture catches up over a few frames: finished here, so that it can be read
  await js('__G.debug.lamps.settle(); void 0');
  await sleep(400);
  const after = {
    under: await lightAt(lamp.x, lamp.z),
    lens: await js(lens),
    picture: brightness(await picture()),
  };
  assert.ok(after.under < before.under * 0.4, `the light under it went from ${before.under} to ${after.under}`);
  assert.ok(after.lens < 0.6, `its lens still glows at ${after.lens}`);
  assert.ok(
    after.picture < before.picture * 0.8,
    `the picture went from ${before.picture.toFixed(1)} to ${after.picture.toFixed(1)}`,
  );
  // it was heard: glass breaking carries seven metres
  const heard = JSON.parse(await js('JSON.stringify(window.__heard)'));
  assert.ok(
    heard.some(([x, z, r]) => r === ARMS.lamp.noise && Math.hypot(x - lamp.x, z - lamp.z) < 1),
    `nothing heard a lamp break: ${JSON.stringify(heard)}`,
  );
  // every corner within its reach has been lit again, and is as its lamps now say
  const check = await lightCheck();
  assert.equal(check.waiting, 0);
  assert.ok(check.worst < EXACT, `a corner of ${check.where} is ${check.worst} from what the lamps say`);

  // it stays out: time does not mend it, and a second round through it changes nothing
  await js('__G.debug.speed(8); void 0');
  await sleep(1500);
  await js('__G.debug.speed(1); void 0');
  await mouse('mousePressed');
  await sleep(60);
  await mouse('mouseReleased');
  await until('__G.weapon.shots === 2', 'the second round', 3000);
  await sleep(200);
  assert.deepEqual(JSON.parse(await js('JSON.stringify(__G.debug.lamps.out())')), [i]);
  // a new mission lights it again, exactly as it was
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  assert.deepEqual(JSON.parse(await js('JSON.stringify(__G.debug.lamps.out())')), []);
  assert.ok(Math.abs((await lightAt(lamp.x, lamp.z)) - before.under) < EXACT);
  assert.ok(Math.abs((await js(lens)) - before.lens) < EXACT);
  const again = await lightCheck();
  assert.ok(again.worst < EXACT && again.waiting === 0, JSON.stringify(again));
});

test('a mark a round has left is lit like the floor it is on: it goes dark when the lamp over it goes out, and is lit again when the lamps come back', async () => {
  // Found in review, 16 November 2026. A bullet mark took the light of the place once, when it was made: on a
  // wall that then went dark it stayed as bright as it had been — a pale spot on a black wall — and one made in
  // the dark stayed dark when the lamps came back.
  await js('__G.debug.start(); __G.player.hidden = true; __G.weapon.arms.mode = "semi"; void 0');
  const i = await js(CORRIDOR_LAMP);
  const lamp = JSON.parse(await js(`JSON.stringify(__G.debug.lamps.at(${i}))`));
  /** how brightly the last mark left is drawn */
  const MARK =
    '(() => { const m = __G.world.group.parent.getObjectByName("holes"), n = m.count - 1, c = m.instanceColor.array; return n < 0 ? -1 : c[n * 3] * 0.3 + c[n * 3 + 1] * 0.59 + c[n * 3 + 2] * 0.11; })()';
  const fireAtTheFloor = async (x, z) => {
    await js(`__G.debug.teleport(${x}, ${z}, -Math.PI / 2); __G.player.pitch = -0.9; void 0`);
    await sleep(600);
    const marks = await js('__G.fx.marks');
    await mouse('mousePressed');
    await sleep(60);
    await mouse('mouseReleased');
    await until(`__G.fx.marks > ${marks}`, 'a mark on the floor', 3000);
  };
  // under the corridor's lamp: the mark is made in its light, and the lamp is then shot out
  await fireAtTheFloor(lamp.x - 1.5, lamp.z);
  const lit = await js(MARK);
  assert.ok(lit > 1, `a mark under a lamp is drawn at ${lit}`);
  await js(`__G.debug.lamps.shoot(${i}); void 0`);
  const dark = await js(MARK);
  assert.ok(dark < lit * 0.5, `with the lamp out the mark went from ${lit} to ${dark}`);
  // in the control room, with its lamps tripped: the mark is made in the dark, and the lamps then come back
  const at = JSON.parse(await js('JSON.stringify(__G.site.firing)'));
  await js(`__G.debug.lamps.trip(${at.x}, ${at.z}); void 0`);
  await fireAtTheFloor(at.x + 1.5, at.z);
  const made = await js(MARK);
  await js('__G.debug.speed(8); void 0');
  await until(`__G.debug.lamps.out().length === 1`, 'the room’s lamps to come back', 12000);
  await js('__G.debug.speed(1); void 0');
  const back = await js(MARK);
  assert.ok(back > made * 1.5, `with the lamps back the mark went from ${made} to ${back}`);
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
});

test('every lamp of the site but the sky’s can be broken by a round from somewhere a player can stand', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  const found = JSON.parse(
    await js(`JSON.stringify((() => {
      const d = __G.debug.lamps, g = __G.world.grid, hit = {}, proud = ${ARMS.lamp.proud};
      const stuck = [];
      let fixed = 0;
      for (let i = 0; i < d.site; i++) {
        const lamp = d.at(i);
        if (lamp.fixed) { fixed++; continue; }
        if (!lamp.box) { stuck.push([i, 'no lens']); continue; }
        const cx = (lamp.box[0] + lamp.box[3]) / 2, cy = (lamp.box[1] + lamp.box[4]) / 2, cz = (lamp.box[2] + lamp.box[5]) / 2;
        let can = false;
        for (let z = Math.floor(lamp.z - 12); z <= lamp.z + 12 && !can; z++)
          for (let x = Math.floor(lamp.x - 12); x <= lamp.x + 12 && !can; x++) {
            if (!g.inside(x, z) || !g.walkable(x, z)) continue;
            const ex = x + 0.5, ey = 1.62, ez = z + 0.5;
            const far = Math.hypot(cx - ex, cy - ey, cz - ez);
            const dx = (cx - ex) / far, dy = (cy - ey) / far, dz = (cz - ez) / far;
            const reach = g.raycast(ex, ey, ez, dx, dy, dz, 120, hit) ? hit.t : 120;
            const met = d.hit(ex, ey, ez, dx, dy, dz, reach + proud);
            can = !!met && met.i === i;
          }
        if (!can) stuck.push([i, 'out of reach']);
      }
      return { lamps: d.site, fixed, stuck };
    })())`),
  );
  assert.equal(found.fixed, 1, 'the glow of the sky down the shaft, and nothing else, cannot be put out');
  assert.deepEqual(found.stuck, [], 'lamps that no round can break');
  assert.ok(found.lamps >= 90);
});

test('an EMP puts out the lamps of the room it goes off in — for twenty seconds, and then they come back by themselves', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  // the control room: thrown from the firing point, down the aisle between its two rows of desks
  const at = JSON.parse(await js('JSON.stringify(__G.site.firing)'));
  await js(`__G.debug.teleport(${at.x}, ${at.z}, -Math.PI / 2); __G.player.pitch = -0.5; void 0`);
  await sleep(400);
  const before = {
    light: await lightAt(at.x, at.z),
    seen: await js(`__G.world.visibility(${at.x}, ${at.z})`),
    corridor: await lightAt(43.5, 44.5),
  };
  assert.ok(before.seen > 0.7, `the firing point is lit: ${JSON.stringify(before)}`);
  await press('KeyT', 60);
  await until('__G.debug.lamps.out().length > 0', 'the lamps to go out', 6000);
  const began = await js('__G.mission.time');
  const dark = JSON.parse(
    await js(`JSON.stringify((() => {
      const d = __G.debug.lamps;
      return {
        out: d.out(),
        own: Array.from({ length: d.count }, (_, i) => i).filter((i) => d.at(i).zone === ${ZONE.CONTROL} && d.at(i).room && !d.at(i).fixed),
        note: document.querySelector("#hud .note").textContent,
        seen: __G.world.visibility(${at.x}, ${at.z}),
      };
    })())`),
  );
  assert.ok(dark.own.length >= 3, `the control room has ${dark.own.length} lamps`);
  assert.deepEqual(dark.out, dark.own, 'the control room’s lamps, all of them, and no lamp of any other room');
  assert.match(dark.note, /^EMP — (\d STOPPED · )?LIGHTS OUT$/);
  assert.ok(dark.seen < 0.45, `somebody at the firing point is still seen at ${dark.seen}`);
  assert.ok((await lightAt(at.x, at.z)) < before.light * 0.45);
  assert.ok(Math.abs((await lightAt(43.5, 44.5)) - before.corridor) < EXACT, 'the corridor outside is as it was');

  // twenty seconds of the mission's clock later they are back, by themselves, and the room is as it was
  await js('__G.debug.speed(6); void 0');
  await until('__G.debug.lamps.out().length === 0', 'the lamps to come back', 12000);
  await js('__G.debug.speed(1); void 0');
  const took = (await js('__G.mission.time')) - began;
  assert.ok(
    took > ARMS.grenades.dark.seconds - 1.5 && took < ARMS.grenades.dark.seconds + 1.5,
    `they were out for ${took.toFixed(1)} s`,
  );
  assert.equal(await js('document.querySelector("#hud .note").textContent'), 'LIGHTS BACK ON');
  await js('__G.debug.lamps.settle(); void 0');
  assert.ok(Math.abs((await lightAt(at.x, at.z)) - before.light) < EXACT);
  assert.ok(Math.abs((await js(`__G.world.visibility(${at.x}, ${at.z})`)) - before.seen) < EXACT);
  const check = await lightCheck();
  assert.ok(check.worst < EXACT && check.waiting === 0, JSON.stringify(check));
});

test('a drone can be found far off: at seventy metres and at ninety-five its lights are in the picture', async () => {
  // Decision of 16 November 2026 — the owner: "the drones sometimes get lost in the distance". A machine more
  // than ninety metres from the eye was not drawn at all, and from forty a drone was a line a pixel or two high
  // (test/unit/lights.test.mjs has the numbers).
  await js(
    '__G.debug.start(); __G.player.hidden = true; document.getElementById("ui").style.visibility = "hidden"; __G.weapon.scene.visible = false; __G.debug.teleport(18.5, 72.5, -Math.PI / 2); __G.player.pitch = 0.02; void 0',
  );
  await sleep(600);
  // one drone is held where it is put, down a clear line across the cavern, for as long as it is looked at
  const hold = (metres) =>
    js(`(() => {
      const u = __G.enemies.list.find((u) => u.type === "drone" && !u.dead);
      window.__held = { u, x: 18.5 + ${metres}, z: 72.5 };
      if (!window.__holding) {
        window.__holding = true;
        (function again() {
          const h = window.__held;
          if (h) { h.u.x = h.x; h.u.z = h.z; h.u.y = 3.1; h.u.speed = 0; }
          requestAnimationFrame(again);
        })();
      }
      u.x = 18.5 + ${metres}; u.z = 72.5; u.y = 3.1; u.cullT = 0;
      const v = __G.camera.position.clone().set(u.x, u.y, u.z).project(__G.camera);
      return JSON.stringify({ px: Math.round((v.x + 1) * innerWidth / 2), py: Math.round((1 - v.y) * innerHeight / 2), clear: __G.world.grid.sight(__G.camera.position.x, __G.camera.position.y, __G.camera.position.z, u.x, u.y, u.z) });
    })()`).then(JSON.parse);
  /** the most any pixel within `r` of (px, py) differs between two pictures, in its most different colour */
  const differs = (a, b, px, py, r) => {
    let most = 0;
    for (let y = py - r; y <= py + r; y++)
      for (let x = px - r; x <= px + r; x++) {
        const i = (y * a.width + x) * 4;
        for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(a.data[i + c] - b.data[i + c]));
      }
    return most;
  };
  try {
    for (const metres of [70, 95]) {
      const at = await hold(metres);
      assert.equal(at.clear, true, `nothing stands between the eye and a drone ${metres} m down the cavern`);
      await until('window.__held.u.inSight === true', `the drone at ${metres} m to be drawn`, 3000);
      await sleep(250);
      const withIt = await picture();
      // …and the same view without it: the drone put behind the eye
      await hold(-6);
      await until('window.__held.u.inSight === false', 'the drone to be out of the picture', 3000);
      await sleep(250);
      const without = await picture();
      const again = await picture();
      const lit = differs(withIt, without, at.px, at.py, 9);
      const grain = differs(without, again, at.px, at.py, 9);
      assert.ok(grain < 40, `two pictures of the same thing differ by ${grain} there`);
      assert.ok(lit >= 70 && lit > grain * 2, `at ${metres} m a drone changes the picture by ${lit} (grain: ${grain})`);
    }
  } finally {
    await js(
      'window.__held = null; document.getElementById("ui").style.visibility = ""; __G.weapon.scene.visible = true; void 0',
    );
  }
});

test('the knife: V swings it — two blows put a sentry down from the front, and one from behind an unaware one is the silent takedown', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  const gate = unit('gate');
  // face to face with the gate guard, a little over a metre from it (the wire is at its feet)
  await js(`{ const u = ${gate}; __G.debug.teleport(u.x, u.z + 1.1, 0); __G.player.pitch = 0; }`);
  await sleep(150);
  assert.equal(await js('!!__G.enemies.takedownTarget(__G.player)'), false, 'from the front there is no takedown');
  await press('KeyV', 60);
  await until(`${gate}.hp < ${gate}.hpMax`, 'the first blow to land', 3000);
  const first = JSON.parse(
    await js(
      `JSON.stringify({ lost: ${gate}.hpMax - ${gate}.hp, dead: ${gate}.dead, shots: __G.weapon.shots, hits: __G.weapon.hits, alarm: __G.enemies.alarm.active, state: ${gate}.brain.state })`,
    ),
  );
  assert.deepEqual(first, { lost: 65, dead: false, shots: 0, hits: 0, alarm: false, state: 'combat' });
  await until('!__G.weapon.knife.busy', 'the swing to end', 3000);
  // it has turned on where the blow came from; step back in front of it and cut again
  await sleep(700);
  await js(
    `{ const u = ${gate}, p = __G.player; const d = Math.hypot(p.x - u.x, p.z - u.z); if (d < 0.9 || d > 1.5) __G.debug.teleport(u.x, u.z - 1.1, Math.PI); else p.yaw = Math.atan2(-(u.x - p.x), -(u.z - p.z)); p.pitch = 0; }`,
  );
  await sleep(100);
  await press('KeyV', 60);
  await until(`${gate}.dead`, 'the second blow to finish it', 3000);
  assert.deepEqual(
    JSON.parse(
      await js(
        'JSON.stringify({ kills: __G.kills, takedowns: __G.takedowns, shots: __G.weapon.shots, note: document.querySelector("#hud .note").textContent })',
      ),
    ),
    { kills: 1, takedowns: 0, shots: 0, note: 'SHUT DOWN — KNIFE' },
  );

  // from behind a sentry that does not know you are there, the knife is the takedown it always was: silent
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  await js(
    `{ const u = ${gate}; __G.debug.teleport(u.x + Math.sin(u.yaw) * 1.3, u.z + Math.cos(u.yaw) * 1.3, u.yaw); }`,
  );
  await until('!!__G.enemies.takedownTarget(__G.player)', 'the chance to take it down', 3000);
  await press('KeyV', 60);
  await until('__G.takedowns === 1', 'the takedown', 3000);
  assert.deepEqual(
    JSON.parse(
      await js(
        `JSON.stringify({ kills: __G.kills, dead: ${gate}.dead, alarm: __G.enemies.alarm.active, note: document.querySelector("#hud .note").textContent })`,
      ),
    ),
    { kills: 1, dead: true, alarm: false, note: 'SHUT DOWN — SILENT' },
  );

  // a wall is only a wall: the swing ends and nothing is counted
  await js('__G.debug.teleport(64.5, 55.4, 0); __G.player.pitch = 0; void 0');
  await until('!__G.weapon.knife.busy', 'the swing to end', 3000);
  await press('KeyV', 60);
  await until('__G.weapon.knife.busy', 'the knife to be swung', 3000);
  await until('!__G.weapon.knife.busy', 'the swing to end', 3000);
  assert.deepEqual(JSON.parse(await js('JSON.stringify([__G.kills, __G.weapon.hits])')), [1, 0]);
});

/**
 * Stands the player a step behind the gate guard, looking at its back, with every other machine off the site but
 * one: the road sentry, posted on the open asphalt north-west of the gate (there is a lamp post just north of the
 * gate guard, so the tests that need room in front of the player go to OPEN_GROUND once the sentry is in hand).
 */
const BEHIND_THE_GATE = `{
  const e = __G.enemies, gate = e.byName("gate"), road = e.byName("road");
  e.remove(e.list.filter((u) => u !== gate && u !== road).map((u) => u.rollId));
  Object.assign(road, { x: 54.5, z: 73.5, yaw: Math.PI, postYaw: Math.PI, route: [[54, 73]], routeI: 0, path: null, goalX: -1 });
  __G.debug.teleport(58.5, 81.4, Math.PI);
  window.__gate = gate; window.__road = road;
  void 0;
}`;
/** Three and a half metres south of the road sentry's post, with nothing near: `yaw` 0 faces it. */
const OPEN_GROUND = (yaw) => `__G.debug.teleport(54.5, 77, ${yaw})`;

test('a sentry taken from behind is held in front of you as a shield: you are slowed, your hands are full, and your rounds pass it', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  await js(BEHIND_THE_GATE);
  await until('__G.enemies.takedownTarget(__G.player) === __gate', 'the chance to take it', 3000);
  await press('KeyG', 60);
  await until('__G.enemies.held === __gate', 'the sentry to be held', 3000);
  await sleep(250);
  const held = JSON.parse(
    await js(`JSON.stringify((() => {
      const p = __G.player, u = __gate;
      const ahead = (u.x - p.x) * -Math.sin(p.yaw) + (u.z - p.z) * -Math.cos(p.yaw);
      const left = (u.x - p.x) * -Math.cos(p.yaw) + (u.z - p.z) * Math.sin(p.yaw);
      return {
        state: u.brain.state, holding: p.holding, ahead: +ahead.toFixed(2), left: +left.toFixed(2),
        facing: Math.abs(u.yaw - p.yaw) < 1e-6, prompt: document.querySelector("#hud .prompt span").textContent,
        shown: !document.querySelector("#hud .prompt").hidden, mood: __G.enemies.mood(),
      };
    })())`),
  );
  assert.deepEqual(held, {
    state: 'held',
    holding: true,
    ahead: 0.72,
    left: 0.26,
    facing: true,
    prompt: 'SHIELD — [F] SHUT DOWN · [G] LET GO',
    shown: true,
    mood: 'calm',
  });

  // hands full: no jump, no crouch, no sight to the eye, no lean — and no faster than a slow walk.
  // (Out on open ground, and westwards, away from the other sentry: footsteps are heard 3.5 m off.)
  await js(OPEN_GROUND('Math.PI / 2'));
  await page.holdKey('Space', ' ', 32, 60);
  await press('KeyC', 60);
  await mouse('mousePressed', 'right');
  await page.keyDown('KeyE', 'e', 69);
  await js(
    'window.__fast = 0; window.__watch = setInterval(() => { __fast = Math.max(__fast, __G.player.speed); }, 4); void 0',
  );
  await page.keyDown('ShiftLeft', 'Shift', 16);
  await page.keyDown('KeyW', 'w', 87);
  await sleep(700);
  const full = JSON.parse(
    await js(
      'JSON.stringify({ y: __G.player.y, grounded: __G.player.grounded, crouched: __G.player.crouched, aim: __G.weapon.aim, lean: __G.player.leanK, running: __G.player.running, fast: __fast })',
    ),
  );
  await page.keyUp('KeyW', 'w', 87);
  await page.keyUp('ShiftLeft', 'Shift', 16);
  await page.keyUp('KeyE', 'e', 69);
  await mouse('mouseReleased', 'right');
  await js('clearInterval(window.__watch)');
  assert.deepEqual(
    [full.y, full.grounded, full.crouched, full.lean, full.running],
    [0, true, false, 0, false],
    JSON.stringify(full),
  );
  assert.ok(full.aim < 0.05, `the sight came up: ${full.aim}`);
  assert.ok(full.fast > 2 && full.fast <= 2.45, `walking at ${full.fast.toFixed(2)} m/s with a machine in your arms`);

  // a round aimed low goes straight through where the shield is, and into what is beyond it
  await js(`{ ${OPEN_GROUND(0)}; __G.player.pitch = Math.atan2(0.74 - 1.62, 3.5); }`);
  await sleep(200);
  const line = JSON.parse(
    await js(`JSON.stringify((() => {
      const p = __G.player, e = __G.enemies, cp = Math.cos(p.pitch);
      const d = [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
      const first = e.raycast(p.headX, p.eye, p.headZ, d[0], d[1], d[2], 60, 1, null);
      const past = e.raycast(p.headX, p.eye, p.headZ, d[0], d[1], d[2], 60, 1, e.held);
      return { first: first && first.unit.name, past: past && past.unit.name };
    })())`),
  );
  assert.deepEqual(line, { first: 'gate', past: 'road' }, 'the shield is on the line of fire, and the line goes on');
  await mouse('mousePressed', 'left');
  try {
    await until('__road.hp < __road.hpMax', 'a round to reach the sentry beyond the shield', 5000);
  } finally {
    await mouse('mouseReleased', 'left');
  }
  assert.deepEqual(
    JSON.parse(
      await js('JSON.stringify([__gate.hp === __gate.hpMax, __G.enemies.held === __gate, __G.weapon.hits >= 1])'),
    ),
    [true, true, true],
    'your own rounds do not touch the machine you are holding',
  );
});

test('the shield takes what its own side fires from in front of you — and nothing that comes from behind', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  await js(BEHIND_THE_GATE);
  await until('__G.enemies.takedownTarget(__G.player) === __gate', 'the chance to take it', 3000);
  await press('KeyG', 60);
  await until('__G.enemies.held === __gate', 'the sentry to be held', 3000);
  // out on open ground, facing north, where the other sentry is put seven metres off — and allowed to see
  await js(
    `{ ${OPEN_GROUND(0)}; const p = __G.player, u = __road; Object.assign(u, { x: 54.5, z: 70, route: [[54, 70]] }); u.brain.state = "combat"; u.brain.awareness = 1; u.brain.targetX = p.x; u.brain.targetZ = p.z; p.hidden = false; __G.debug.speed(3); }`,
  );
  await until('__G.enemies.held && __gate.hp <= __gate.hpMax - 16', 'the shield to be hit twice', 60000);
  const front = JSON.parse(
    await js(
      'JSON.stringify({ held: __G.enemies.held === __gate, health: __G.player.health, taken: __G.player.damageTaken, bar: __G.prompt.progress, wedge: __G.player.hitFlash })',
    ),
  );
  assert.deepEqual(
    [front.held, front.health, front.taken, front.wedge],
    [true, 100, 0, 0],
    'every round that would have found you found the shield',
  );
  assert.ok(front.bar < 0.9 && front.bar > 0, `the bar under the prompt is the shield's health: ${front.bar}`);

  // turn your back: the shield is on the wrong side now
  await js('__G.player.yaw = Math.PI; void 0');
  await until('__G.player.health < 100', 'a round in the back', 60000);
  await js('__G.player.hidden = true; __G.debug.speed(1); __G.player.health = 100; void 0');
});

test('a shield ends six ways: let go, shut down, shot to pieces, breaking free after thirty seconds, when you go down, or when the mission ends', async () => {
  const take = async () => {
    await js('__G.debug.start(); __G.player.hidden = true; void 0');
    await js(BEHIND_THE_GATE);
    await until('__G.enemies.takedownTarget(__G.player) === __gate', 'the chance to take it', 3000);
    await press('KeyG', 60);
    await until('__G.enemies.held === __gate', 'the sentry to be held', 3000);
  };
  const after = () =>
    js(
      'JSON.stringify({ held: __G.enemies.held === null, holding: __G.player.holding, dead: __gate.dead, state: __gate.brain.state, reeling: __gate.stunT > 0, note: document.querySelector("#hud .note").textContent, kills: __G.kills, takedowns: __G.takedowns, alarm: __G.enemies.alarm.active })',
    ).then(JSON.parse);

  // G again lets it go: it reels for a moment, and then it is a machine that knows where you are
  await take();
  await press('KeyG', 60);
  await until('__G.enemies.held === null', 'it to be let go', 3000);
  assert.deepEqual(await after(), {
    held: true,
    holding: false,
    dead: false,
    state: 'combat',
    reeling: true,
    note: 'LET GO',
    kills: 0,
    takedowns: 0,
    alarm: false,
  });
  // …and it cannot be taken again: it is fighting
  await sleep(200);
  assert.equal(await js('!!__G.enemies.takedownTarget(__G.player)'), false);

  // F shuts it down in your arms: a silent takedown like any other
  await take();
  await press(USE, 60);
  await until('__gate.dead', 'it to be shut down', 3000);
  assert.deepEqual(await after(), {
    held: true,
    holding: false,
    dead: true,
    state: 'dead',
    reeling: false,
    note: 'SHUT DOWN — SILENT',
    kills: 1,
    takedowns: 1,
    alarm: false,
  });

  // shot to pieces by its own side
  await take();
  await js('__G.enemies.damage(__gate, 1e6, 58.5, 70); void 0');
  await until('__gate.dead', 'it to be destroyed', 3000);
  await sleep(100);
  const destroyed = await after();
  assert.deepEqual(
    [destroyed.held, destroyed.holding, destroyed.note, destroyed.kills, destroyed.takedowns],
    [true, false, 'SHIELD DESTROYED', 1, 0],
  );

  // held for thirty seconds, it breaks free
  await take();
  await js('__gate.brain.timer = 29.5; void 0');
  await sleep(200);
  assert.equal(await js('__G.enemies.held === __gate'), true, 'not before thirty seconds');
  await until('__G.enemies.held === null', 'it to break free', 3000);
  const free = await after();
  assert.deepEqual(
    [free.holding, free.dead, free.state, free.note],
    [false, false, 'combat', 'IT BROKE FREE'],
    JSON.stringify(free),
  );

  // and if you go down, it is not held by anybody
  await take();
  await js('__G.debug.hurt(500)');
  await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
  assert.deepEqual(
    JSON.parse(await js('JSON.stringify([__G.enemies.held === null, __G.player.holding, __gate.dead])')),
    [true, false, false],
  );
  await click('restart');
  assert.equal(await state(), 'playing');

  // nor if the mission ends with it still in your arms: here the clock runs out (found in review, 12 November
  // 2026: only going down let go of it, and the player was left "holding" nothing through the ending)
  await take();
  await js('__G.mission.phase = "exfil"; __G.mission.clock = 0.3; void 0');
  await until('__G.state === "ending" || __G.state === "over"', 'the strike', 5000);
  assert.deepEqual(JSON.parse(await js('JSON.stringify([__G.enemies.held === null, __G.player.holding])')), [
    true,
    false,
  ]);
  await until('__G.menus.current() === "failed"', 'the failed screen', 10000);
  await click('restart');
  assert.equal(await state(), 'playing');
});

// Decision of 12 November 2026 — the owner: "there's a bug where i fire at transparent objects but they get bullet
// marks". A round used to stop on the one-metre box of the cell a thing stands in — in the air beside a barrel,
// under a truck, between two casings of the cascade — and leave its mark there; and a mark left on a door stayed
// in the doorway when the door slid open. Now a round stops on what is drawn (test/unit/grid.test.mjs has the
// rule; this has the game), and a door keeps no marks.
test('a round stops on what is drawn, not on the box a thing stands in: no marks in the air, and none on a door', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  // the comparison, with the things' own shapes in use or taken away (as the game was until this change)
  const linesOfFire = async (ownShapes) =>
    JSON.parse(
      await page.evaluate(
        `JSON.stringify((() => {
        const G = __G, grid = G.world.grid, shapes = G.world.shapes;
        window.__shapes = window.__shapes || grid.shapes;
        grid.shapes = ${ownShapes} ? window.__shapes : null;
        // every triangle of the furniture, exactly as it is drawn
        const meshes = G.world.group.children.filter((m) => m.name === 'props');
        const near = (box) => {
          const out = [];
          for (const mesh of meshes) {
            const p = mesh.geometry.attributes.position.array, ix = mesh.geometry.index.array;
            for (let k = 0; k < ix.length; k += 3) {
              const a = ix[k] * 3, b = ix[k + 1] * 3, c = ix[k + 2] * 3;
              const inside = (v) => p[v] > box[0] - 0.05 && p[v] < box[3] + 0.05 && p[v + 2] > box[2] - 0.05 && p[v + 2] < box[5] + 0.05;
              if (inside(a) || inside(b) || inside(c)) out.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
            }
          }
          return out;
        };
        // the nearest of those triangles a ray meets (Möller–Trumbore), written out again here on purpose
        const nearest = (v, ox, oy, oz, dx, dy, dz) => {
          let best = Infinity;
          for (let k = 0; k < v.length; k += 9) {
            const e1x = v[k + 3] - v[k], e1y = v[k + 4] - v[k + 1], e1z = v[k + 5] - v[k + 2];
            const e2x = v[k + 6] - v[k], e2y = v[k + 7] - v[k + 1], e2z = v[k + 8] - v[k + 2];
            const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
            const det = e1x * hx + e1y * hy + e1z * hz;
            if (Math.abs(det) < 1e-10) continue;
            const sx = ox - v[k], sy = oy - v[k + 1], sz = oz - v[k + 2];
            const u = (sx * hx + sy * hy + sz * hz) / det;
            if (u < 0 || u > 1) continue;
            const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
            const w = (dx * qx + dy * qy + dz * qz) / det;
            if (w < 0 || u + w > 1) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) / det;
            if (t > 1e-4 && t < best) best = t;
          }
          return best;
        };
        const tally = { kinds: [], rays: 0, sure: 0, agree: 0, through: 0, inAir: [], passed: [] };
        const hit = {};
        for (const kind of ['barrel', 'truck', 'forklift', 'container', 'crate', 'rack', 'console', 'tank', 'transformer', 'locker', 'desk', 'barrier', 'cylinder', 'switchgear', 'generator']) {
          const p = G.site.props.find((q) => q.kind === kind && q.y === 0);
          const box = p && shapes.boxOf(Math.floor(p.x), Math.floor(p.z));
          if (!box) continue;
          tally.kinds.push(kind);
          const tris = near(box);
          const cx = (box[0] + box[3]) / 2, cz = (box[2] + box[5]) / 2;
          // the cells it stands on: what used to stop a round was the faces of these
          const foot = [Math.floor(box[0] + 0.02), Math.floor(box[2] + 0.02), Math.ceil(box[3] - 0.02), Math.ceil(box[5] - 0.02)];
          const onIt = (x, z, slack) => x > foot[0] - slack && x < foot[2] + slack && z > foot[1] - slack && z < foot[3] + slack;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const half = dx ? (box[5] - box[2]) / 2 : (box[3] - box[0]) / 2;
            const reach = (dx ? (box[3] - box[0]) / 2 : (box[5] - box[2]) / 2) + 2.5;
            for (let a = 0; a < 9; a++)
              for (let b = 0; b < 6; b++) {
                // never quite on a line of the model: a step that no edge of it shares
                const side = (a / 8 - 0.5) * 2 * (half + 0.07) * 0.983 + 0.0037;
                const oy = 0.09 + (b / 5) * (box[4] + 0.15) * 0.991;
                const ox = cx - dx * reach + (dx ? 0 : side), oz = cz - dz * reach + (dz ? 0 : side);
                tally.rays++;
                const got = grid.raycast(ox, oy, oz, dx, 0, dz, 40, hit) ? { t: hit.t, what: hit.what, x: hit.x, z: hit.z } : null;
                // something else stands in the way before this thing: says nothing about this thing
                if (got && got.t < 1.9) continue;
                const drawn = nearest(tris, ox, oy, oz, dx, 0, dz);
                tally.sure++;
                if (got && got.what === 'prop' && onIt(got.x, got.z, 0.03)) {
                  if (Math.abs(got.t - drawn) < 0.02) tally.agree++;
                  else tally.inAir.push([kind, +ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2), dx, dz, +got.t.toFixed(3), drawn === Infinity ? null : +drawn.toFixed(3)]);
                } else if (drawn < Infinity && onIt(ox + dx * drawn, oz + dz * drawn, -0.01) && (!got || got.t > drawn + 0.02))
                  tally.passed.push([kind, +ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2), dx, dz, +drawn.toFixed(3), got ? +got.t.toFixed(3) : null]);
                else tally.through++;
              }
          }
        }
        // the cascade: a round at a casing stops on it; a round between the two casings of a cell flies down the row
        const [ax, az] = G.site.centrifuges[0];
        const R = shapes.casing.radius;
        const at = grid.raycast(ax, 1.5, az - 3, 0, 0, 1, 40, hit) ? { t: hit.t, what: hit.what } : null;
        const cell = Math.floor(ax);
        const between = grid.raycast(cell + 0.5, 1.5, az - 3, 0, 0, 1, 40, hit) ? { t: hit.t, what: hit.what, z: hit.z } : null;
        grid.shapes = window.__shapes;
        return { ...tally, inAirCount: tally.inAir.length, passedCount: tally.passed.length, inAir: tally.inAir.slice(0, 4), passed: tally.passed.slice(0, 4), casing: { R, at, between, az } };
      })())`,
        { timeoutMs: 120000 },
      ),
    );
  // first, that the comparison can tell: with the shapes taken away, rounds stop in the air again
  const before = await linesOfFire(false);
  assert.ok(
    before.inAirCount > 200,
    `the check found only ${before.inAirCount} rounds stopping in the air when things were boxes: it cannot tell`,
  );
  assert.ok(before.casing.between?.what === 'prop', 'between two casings there was a box');
  const report = await linesOfFire(true);
  assert.equal(await js('__G.world.grid.shapes === window.__shapes && !!window.__shapes'), true);
  assert.ok(report.kinds.length >= 10, `only ${report.kinds.join(', ')} were found to fire at`);
  assert.ok(report.sure > 1500, `only ${report.sure} of ${report.rays} lines of fire were clear`);
  assert.equal(report.inAirCount, 0, `a round stopped where nothing is drawn: ${JSON.stringify(report.inAir)}`);
  assert.equal(report.passedCount, 0, `a round went through what is drawn: ${JSON.stringify(report.passed)}`);
  // and the comparison had something to compare: rounds that struck, and rounds that flew through a gap
  assert.ok(report.agree > 600 && report.through > 150, `${report.agree} struck, ${report.through} flew on`);
  const { casing } = report;
  assert.ok(casing.R > 0.05 && casing.R < 0.3, `a casing is ${casing.R} m in radius`);
  // (what it says it met was 'prop' until 16 November 2026: since the casings turn, a casing says that it is
  // one, so that — like a door — it is left with no mark that would stand still on its turning skin)
  assert.ok(
    casing.at && casing.at.what === 'casing' && Math.abs(casing.at.t - (3 - casing.R)) < 0.01,
    JSON.stringify(casing),
  );
  assert.ok(
    !(casing.between && ['prop', 'casing'].includes(casing.between.what) && casing.between.z < casing.az + 2),
    `a round between two casings stopped in the air: ${JSON.stringify(casing.between)}`,
  );

  // a shut door: rounds strike it, and it keeps no mark; the wall beside it does
  const door = JSON.parse(
    await js(`JSON.stringify((() => {
      const grid = __G.world.grid, hit = {};
      for (const d of grid.doors) {
        const cells = d.cells.map((i) => [i % grid.w, Math.floor(i / grid.w)]);
        const mx = cells.reduce((s, c) => s + c[0] + 0.5, 0) / cells.length, mz = cells.reduce((s, c) => s + c[1] + 0.5, 0) / cells.length;
        for (const sign of [1, -1]) {
          const nx = d.along === 'x' ? 0 : sign, nz = d.along === 'x' ? sign : 0;
          const x = mx + nx * 6, z = mz + nz * 6;
          if (grid.blocked(Math.floor(x), Math.floor(z))) continue;
          if (grid.raycast(x, 1.62, z, -nx, 0, -nz, 12, hit) && hit.what === 'door') return { x, z, yaw: Math.atan2(nx, nz), id: d.id };
        }
      }
      return null;
    })())`),
  );
  assert.ok(door, 'no shut door could be found to fire at');
  await js(`__G.debug.teleport(${door.x}, ${door.z}, ${door.yaw}); __G.player.pitch = 0; void 0`);
  await sleep(150);
  await press('KeyZ', 60);
  await until('__G.weapon.aim > 0.95', 'the sight', 4000);
  const fire = async (rounds) => {
    const from = await js('__G.weapon.shots');
    await mouse('mousePressed');
    try {
      await until(`__G.weapon.shots >= ${from + rounds}`, 'rounds', 6000);
    } finally {
      await mouse('mouseReleased');
    }
    await sleep(120);
  };
  let marks = await js('__G.fx.marks');
  await fire(4);
  assert.equal(await js('__G.fx.marks'), marks, 'a door that slides away was left with bullet marks on it');
  assert.ok((await js(`__G.world.grid.doors[${door.id}].open`)) < 0.1, 'the door opened: the test fired through it');
  // turned a quarter away from the door there is something that stays where it is
  await js(`__G.player.yaw = ${door.yaw} + 1.2; __G.player.pitch = -0.5; void 0`);
  await sleep(100);
  marks = await js('__G.fx.marks');
  await fire(3);
  assert.ok((await js('__G.fx.marks')) >= marks + 3, 'rounds into the floor left no marks');
  await press('KeyZ', 60);
});

/** How many casings of the cascade are over (their own "up" no longer points up), and how many there are. */
const CASINGS_OVER = `(() => {
  const mesh = __G.world.group.getObjectByName('cascade');
  const a = mesh.instanceMatrix.array;
  let over = 0;
  for (let i = 0; i < mesh.count; i++) if (a[i * 16 + 5] < 0.95) over++;
  return [over, mesh.count];
})()`;

test('the casings turn: the skin of each goes round, between a foot and a head that stand still — and keeps no mark', async () => {
  // Decision of 16 November 2026 — the owner: "make the centrifuge spin". The rules of it are held without a
  // browser (test/unit/spin.test.mjs); that the built game DOES it, and that it can be seen, is held here.
  await js('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); __G.weapon.arms.mode = "semi"; void 0');
  const read = () =>
    js(`JSON.stringify((() => {
      const mesh = __G.world.group.getObjectByName('cascade'), g = mesh.geometry;
      const spin = g.attributes.spin, lot = g.attributes.spinLot, p = g.attributes.position;
      let skin = 0, low = Infinity, high = -Infinity, out = 0;
      for (let i = 0; i < spin.count; i++) {
        if (!spin.getX(i)) continue;
        skin++;
        low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i));
        out = Math.max(out, Math.abs(Math.hypot(p.getX(i), p.getZ(i)) - __G.world.shapes.casing.radius));
      }
      const lots = new Set();
      for (let i = 0; i < lot.count; i++) lots.add(Math.floor(lot.getX(i) * 5));
      return {
        skin, corners: spin.count, low, high, out, casings: mesh.count, lots: lot.count, speeds: lots.size,
        each: lot.isInstancedBufferAttribute === true, told: mesh.material.defines.LODE_SPIN,
        angle: mesh.material.uniforms.uSpin.value, turning: __G.world.cascade.spinning,
      };
    })())`).then(JSON.parse);
  const a = await read();
  assert.equal(a.told, 1, 'the cascade is not drawn by the program that turns it');
  // the skin is the casing's side, the height of it, at the radius a round meets: and it is not the whole casing
  assert.ok(a.skin >= 16 && a.skin < a.corners / 2, `${a.skin} of ${a.corners} corners turn`);
  assert.ok(Math.abs(a.low - 0.14) < 0.01 && Math.abs(a.high - 2.78) < 0.01, `the skin runs ${a.low} … ${a.high}`);
  assert.ok(a.out < 0.005, `the skin is ${a.out} m from where a round meets a casing`);
  // every casing has drawn its own lot, and between them they turn at every speed there is
  assert.ok(a.each && a.lots === a.casings && a.casings >= 400, JSON.stringify(a));
  assert.equal(a.speeds, 5);
  await sleep(500);
  const b = await read();
  assert.equal(b.turning.speed, 1);
  assert.notEqual(b.angle, a.angle, 'half a second went by and nothing turned');
  assert.ok(b.angle >= 0 && b.angle < Math.PI * 16 + 1e-6);

  // It is SEEN. From the aisle, a row of casings fills the picture; two pictures a third of a second apart differ
  // on their skins — the streaks have gone round — and not on their heads, which stand still. (Taken sixteen
  // pixels at a time: every picture has its own grain, pixel by pixel, and that is not what is being asked.)
  await js(
    '__G.debug.teleport(40.5, 23.7, 0); __G.player.pitch = 0; __G.weapon.visible = false; document.getElementById("ui").style.opacity = 0; void 0',
  );
  await sleep(500);
  const one = await picture();
  await sleep(330);
  const two = await picture();
  const BLOCK = 16;
  const coarse = ({ width, height, data }) => {
    const w = Math.floor(width / BLOCK);
    const h = Math.floor(height / BLOCK);
    const out = new Float64Array(w * h);
    for (let y = 0; y < h * BLOCK; y++)
      for (let x = 0; x < w * BLOCK; x++) {
        const i = (y * width + x) * 4;
        out[Math.floor(y / BLOCK) * w + Math.floor(x / BLOCK)] +=
          (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / (BLOCK * BLOCK);
      }
    return { w, h, out };
  };
  const first = coarse(one);
  const second = coarse(two);
  const moved = (x0, y0, x1, y1) => {
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(first.h * y0); y < first.h * y1; y++)
      for (let x = Math.floor(first.w * x0); x < first.w * x1; x++, n++)
        sum += Math.abs(first.out[y * first.w + x] - second.out[y * first.w + x]);
    return sum / n;
  };
  const skins = moved(0.1, 0.2, 0.9, 0.6);
  const heads = moved(0.1, 0, 0.9, 0.09);
  assert.ok(skins > 2, `the skins changed by ${skins.toFixed(2)} of 255 in a third of a second`);
  assert.ok(skins > heads * 4, `the skins changed by ${skins.toFixed(2)}, and the heads by ${heads.toFixed(2)}`);

  // a round into a casing: it sparks, it rings — and it leaves no mark to stand still on a skin that turns
  // (turned a little to the left: straight ahead is the gap between the two casings of a cell)
  await js('__G.player.yaw = 0.113; __G.weapon.visible = true; void 0');
  await sleep(120);
  assert.equal(
    await js(
      '(() => { const hit = {}; const p = __G.player; return __G.world.grid.raycast(p.x, p.eye, p.z, -Math.sin(p.yaw), 0, -Math.cos(p.yaw), 30, hit) ? hit.what : null; })()',
    ),
    'casing',
  );
  const marks = await js('__G.fx.marks');
  const shots = await js('__G.weapon.shots');
  for (let n = 0; n < 3; n++) {
    await mouse('mousePressed');
    await sleep(60);
    await mouse('mouseReleased');
    await sleep(160);
  }
  assert.ok((await js('__G.weapon.shots')) >= shots + 2, 'the rounds were not fired');
  assert.equal(await js('__G.fx.marks'), marks, 'a casing that turns was left with a bullet mark on it');
  await js('document.getElementById("ui").style.opacity = ""; __G.weapon.arms.mode = "auto"; void 0');
});

test('the cascades are blown from the control room: four charges, a window on the hall, and every casing comes down', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  const before = JSON.parse(
    await js(
      `JSON.stringify({ casing: __G.world.shapes.casing, over: ${CASINGS_OVER}, charges: __G.site.charges.map((c) => c.name), tasks: document.querySelector("#hud .objectives").textContent, drawn: (() => {
        // how wide a casing is DRAWN at chest height: where its triangles cross that height, nearest and furthest
        // from its axis (it has eight sides: the flats are nearer than the corners)
        const g = __G.world.group.getObjectByName('cascade').geometry, p = g.attributes.position, ix = g.index;
        const n = ix ? ix.count : p.count, at = (k) => (ix ? ix.getX(k) : k);
        let near = Infinity, far = 0;
        for (let k = 0; k + 2 < n; k += 3)
          for (let e = 0; e < 3; e++) {
            const a = at(k + e), b = at(k + ((e + 1) % 3));
            const ya = p.getY(a), yb = p.getY(b);
            if ((ya - 1.6) * (yb - 1.6) >= 0) continue;
            const t = (1.6 - ya) / (yb - ya);
            const r = Math.hypot(p.getX(a) + (p.getX(b) - p.getX(a)) * t, p.getZ(a) + (p.getZ(b) - p.getZ(a)) * t);
            near = Math.min(near, r); far = Math.max(far, r);
          }
        return [near, far];
      })() })`,
    ),
  );
  assert.deepEqual(before.charges, ['Cascade 1', 'Cascade 2', 'Cascade 3', 'Cascade 4']);
  assert.equal(before.casing.standing, true);
  // a casing is as wide to a round as it is drawn (between its flats and its corners), and a charge hangs on
  // its skin (world/map.js CASING): three numbers from three files, held together here
  assert.ok(
    before.casing.radius >= before.drawn[0] - 0.005 && before.casing.radius <= before.drawn[1] + 0.005,
    `a casing is ${before.casing.radius} m to a round, and drawn ${before.drawn.map((r) => r.toFixed(3)).join(' … ')} m`,
  );
  assert.ok(Math.abs(before.casing.radius - CASING) < 0.01, `${before.casing.radius} m, and a charge at ${CASING} m`);
  assert.equal(before.over[0], 0, 'casings were over before anything was fired');
  assert.ok(before.over[1] >= 400, `only ${before.over[1]} casings in the hall`);
  assert.match(before.tasks, /Rig the centrifuge cascades\s+0 \/ 4/);
  assert.match(before.tasks, /Blow the cascades from the control room/);

  // the firing point is in the control room, at a window: the hall can be seen from it, and not walked into
  const point = JSON.parse(
    await js(`JSON.stringify((() => {
      const G = __G, grid = G.world.grid, f = G.site.firing;
      G.debug.teleport(f.x, f.z, Math.PI / 2);
      return {
        zone: G.world.zoneAt(f.x, f.z), hall: G.world.zoneAt(f.x - 3.5, f.z),
        sees: grid.sight(f.x, 1.6, f.z, f.x - 3.5, 1.6, f.z),
        sill: G.site.window.every(([x, z]) => grid.blocked(x, z, false, 0) && grid.blocked(x, z, false, 1.2)),
        low: grid.sight(f.x, 0.6, f.z, f.x - 3.5, 0.6, f.z),
      };
    })())`),
  );
  assert.deepEqual(point, { zone: 5, hall: 4, sees: true, sill: true, low: false });

  // nothing is offered there until every charge is set — and then holding it for a moment is not enough
  await sleep(250);
  assert.equal(await js('__G.prompt'), null);
  await js('__G.debug.rig(); void 0');
  await until('__G.prompt && __G.prompt.text === "HOLD [F] BLOW THE CASCADES"', 'the prompt', 3000);
  await until(
    '__G.hud.el.querySelector(".bearing .goal").textContent.startsWith("◆ ")',
    'the firing point to be named as the next thing to do',
    3000,
  );
  await press(USE, 300);
  assert.equal(await js('__G.mission.blown'), false, 'a tap fired the charges');
  await press(USE, 1500);
  await until('__G.mission.blown', 'the charges to be fired', 3000);

  // at once: to a round and to an eye the rows are wreckage; the site knows; and on Operator two drones are up.
  // The three machines that were in the hall went with it. (That alarm is the site's own: it is not counted
  // against you as one a machine raised.)
  const fired = JSON.parse(
    await js(`JSON.stringify((() => {
      const G = __G, grid = G.world.grid;
      const [x, z] = G.site.centrifuges[0];
      return {
        standing: G.world.shapes.casing.standing,
        heap: Math.round(grid.block[grid.index(Math.floor(x), Math.floor(z))] * 100) / 100,
        alarm: G.enemies.alarm.active, counted: G.enemies.alarm.count,
        drones: G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).length,
        hall: ['hallLoop', 'hallAisle', 'droneHall'].map((name) => G.enemies.byName(name).dead),
        kills: G.kills, phase: G.mission.phase, offered: /BLOW/.test(G.prompt ? G.prompt.text : ''),
      };
    })())`),
  );
  assert.deepEqual(fired, {
    standing: false,
    heap: 0.7,
    alarm: true,
    counted: 0,
    drones: 2,
    hall: [true, true, true],
    kills: 3,
    phase: 'infil',
    offered: false,
  });

  // over the next few seconds every one of them goes over, and none of them ends up across an aisle
  await until('__G.world.cascade.state.down === 1', 'every casing to come down', 8000);
  const wreck = JSON.parse(
    await js(`JSON.stringify((() => {
      const G = __G, mesh = G.world.group.getObjectByName('cascade'), a = mesh.instanceMatrix.array;
      const rows = new Set(G.site.centrifuges.map(([x, z]) => Math.floor(z) * 1000 + Math.floor(x)));
      const top = G.world.shapes.casing.top;
      let astray = 0;
      for (let i = 0; i < mesh.count; i++) {
        const x = a[i * 16 + 12] + a[i * 16 + 4] * top, z = a[i * 16 + 14] + a[i * 16 + 6] * top;
        if (!rows.has(Math.floor(z) * 1000 + Math.floor(x))) astray++;
      }
      return { over: ${CASINGS_OVER}, astray, seconds: G.world.cascade.duration };
    })())`),
  );
  assert.equal(wreck.over[0], wreck.over[1], 'some casings are still standing');
  assert.equal(wreck.astray, 0, `${wreck.astray} casings lie with their heads out of the rows, across an aisle`);
  assert.ok(wreck.seconds > 2 && wreck.seconds < 5, `it takes ${wreck.seconds} s`);
  // …and what lies in the wreck lies still: the turning of the skins has run down (world/spin.js), and stays so
  await until('__G.world.cascade.spinning.speed === 0', 'the casings to stop turning', 6000);
  const still = await js('__G.world.cascade.spinning.angle');
  await sleep(300);
  assert.equal(await js('__G.world.cascade.spinning.angle'), still, 'a casing in the wreck is still turning');
  await until(
    '/every cascade is down/.test(document.querySelector("#hud .radio").textContent)',
    'Overwatch to say so',
    8000,
  );
  assert.match(await js('document.querySelector("#hud .radio").textContent'), /12 of its machines are still running/);

  // a round fired into the wreck stops on it, and leaves no mark hanging in the air over it; one fired over it
  // goes on to the far wall
  const rounds = JSON.parse(
    await js(`JSON.stringify((() => {
      const grid = __G.world.grid, low = {}, high = {};
      grid.raycast(51.5, 0.4, 20.5, -1, 0, 0, 60, low);
      grid.raycast(51.5, 1.5, 20.5, -1, 0, 0, 60, high);
      return { low: [low.what, Math.round(low.t * 10) / 10], high: [high.what, Math.round(high.x)] };
    })())`),
  );
  assert.deepEqual(rounds, { low: ['wreck', 1.5], high: ['wall', 31] });
  await js('__G.debug.teleport(51.5, 20.5, Math.PI / 2); __G.player.pitch = -0.35; void 0');
  await sleep(150);
  const marks = await js('__G.fx.marks');
  const shots = await js('__G.weapon.shots');
  await mouse('mousePressed');
  try {
    await until(`__G.weapon.shots >= ${shots + 4}`, 'rounds', 6000);
  } finally {
    await mouse('mouseReleased');
  }
  await sleep(150);
  assert.equal(await js('__G.fx.marks'), marks, 'bullet marks were left on the heap, which is not what is drawn');

  // shutting down what is left opens the beacon: cleared, rigged AND blown
  await js('__G.debug.clearSite(); void 0');
  await until('__G.mission.phase === "mark"', 'the mark phase', 5000);
});

test('the blast is a checkpoint: RETRY puts you back in the control room with the cascades down, and a new mission stands them up again', async () => {
  // carries on from the blast above
  const saved = JSON.parse(await js('JSON.stringify({ time: __G.mission.time, kills: __G.kills })'));
  await js('__G.debug.hurt(500)');
  await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
  const text = await js('document.querySelector("#menus").textContent');
  assert.match(text, /RETRY puts you back in the control room, with the cascades blown\./);
  assert.match(text, /Charges set\s*4 \/ 4/);
  assert.match(text, /Cascades\s*Blown/);
  await click('restart');
  assert.equal(await state(), 'playing');
  const back = JSON.parse(
    await js(`JSON.stringify((() => {
      const G = __G, f = G.site.firing;
      return {
        blown: G.mission.blown, charges: G.mission.chargesPlanted, phase: G.mission.phase,
        standing: G.world.shapes.casing.standing, over: ${CASINGS_OVER},
        // what was shut down before the charges were fired is still down; what was shut down after is back
        hall: ['hallLoop', 'hallAisle', 'droneHall'].every((name) => G.enemies.byName(name).dead),
        kills: G.kills, alive: G.enemies.remaining(), total: G.mission.hostilesTotal,
        drones: G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).length, alarm: G.enemies.alarm.active,
        near: Math.hypot(G.player.x - f.x, G.player.z - f.z) < f.radius, health: G.player.health,
        radio: document.querySelector('#hud .radio').textContent,
      };
    })())`),
  );
  assert.equal(back.over[0], back.over[1], 'the casings were standing again after RETRY');
  assert.match(back.radio, /Back in the control room, Wraith\. The cascades are still down/);
  delete back.over;
  delete back.radio;
  assert.deepEqual(back, {
    blown: true,
    charges: 4,
    phase: 'infil',
    standing: false,
    hall: true,
    kills: saved.kills - 12,
    alive: 12,
    total: 15,
    // the drones that answered the blast answer it again; the alarm is not raised a second time
    drones: 2,
    alarm: false,
    near: true,
    health: 100,
  });
  assert.equal(saved.kills, 15);

  // a whole new mission: every casing stands, nothing is rigged, and the firing point offers nothing
  await js('__G.debug.start(); void 0');
  const fresh = JSON.parse(
    await js(
      `JSON.stringify({ blown: __G.mission.blown, standing: __G.world.shapes.casing.standing, over: ${CASINGS_OVER}[0], heap: Math.round(__G.world.grid.block[__G.world.grid.index(Math.floor(__G.site.centrifuges[0][0]), Math.floor(__G.site.centrifuges[0][1]))] * 100) / 100, blast: __G.blast, down: __G.world.cascade.state.down })`,
    ),
  );
  assert.deepEqual(fresh, { blown: false, standing: true, over: 0, heap: 3.3, blast: null, down: 0 });
});

test('rounds find their mark: three in the body put a sentry down, one in the head does, and the crosshair says so', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  const hold = async (done, label) => {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 640,
      y: 360,
      button: 'left',
      clickCount: 1,
    });
    try {
      await until(done, label, 6000);
    } finally {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 640,
        y: 360,
        button: 'left',
        clickCount: 1,
      });
    }
  };

  // the gate guard, six metres ahead with its back to you: aim at the middle of its back
  await js(
    `{ const u = ${unit('gate')}; __G.debug.teleport(u.x, u.z - 6, Math.PI); __G.player.pitch = Math.atan2(1.26 - 1.62, 6); }`,
  );
  await sleep(120);
  await hold(`${unit('gate')}.dead`, 'the sentry to go down');
  await sleep(150);
  const body = JSON.parse(
    await js(
      'JSON.stringify({ shots: __G.weapon.shots, hits: __G.weapon.hits, kills: __G.kills, note: document.querySelector("#hud .note").textContent, alarm: __G.enemies.alarm.active })',
    ),
  );
  assert.equal(body.hits, 3, 'three rounds of 34 against 100');
  assert.ok(body.shots >= 3 && body.shots <= 5, `${body.shots} rounds fired at a still target six metres away`);
  assert.deepEqual([body.kills, body.note, body.alarm], [1, 'SENTRY DOWN', false]);

  // the switchgear guard, three metres away: one round at its head
  await js(
    `{ const u = ${unit('switchgear')}; __G.debug.teleport(u.x + 3, u.z, Math.PI / 2); __G.player.pitch = Math.atan2(1.74 - 1.62, 3); }`,
  );
  await sleep(350);
  const before = await js('__G.weapon.shots');
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await until(`__G.weapon.shots > ${before}`, 'one round', 3000);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await until(`${unit('switchgear')}.dead`, 'the head shot to count', 3000);
  const head = JSON.parse(
    await js(
      'JSON.stringify({ kills: __G.kills, note: document.querySelector("#hud .note").textContent, hits: __G.weapon.hits, shots: __G.weapon.shots })',
    ),
  );
  assert.deepEqual([head.kills, head.note], [2, 'HEAD SHOT']);
  assert.ok(head.hits <= head.shots);

  // a round into a wall is not a hit
  await js('__G.debug.teleport(20.5, 70.5, 0); __G.player.pitch = 0; void 0');
  const hitsBefore = await js('__G.weapon.hits');
  const shotsBefore = await js('__G.weapon.shots');
  await hold(`__G.weapon.shots >= ${shotsBefore + 2}`, 'two more rounds');
  assert.equal(await js('__G.weapon.hits'), hitsBefore);
});

test('a sentry with its back to you can be shut down by hand, silently', async () => {
  await js('__G.debug.start()');
  // Stand right behind the gate guard, looking the way it looks. Unseen while the screen is read: a sentry feels
  // somebody standing at its back within about half a second, and then there is nothing to take down.
  await js(
    `{ const u = ${unit('gate')}; __G.player.hidden = true; __G.debug.teleport(u.x + Math.sin(u.yaw) * 1.3, u.z + Math.cos(u.yaw) * 1.3, u.yaw); }`,
  );
  await until('!!__G.enemies.takedownTarget(__G.player)', 'the chance to take it down', 3000);
  // …and the screen is read once a frame has been drawn since: the chance is there the moment the player is put
  // behind it, the words only when the next frame has written them (16 November 2026: read between the two, on a
  // busy machine, the prompt was still empty)
  await until('document.querySelector("#hud .prompt span").textContent !== ""', 'the prompt to be written', 3000);
  assert.equal(
    await js('document.querySelector("#hud .prompt span").textContent'),
    '[F] TAKE DOWN · [G] SHIELD',
    'the screen says which keys do what',
  );
  // E is not the use key any more (it leans): pressing it here does nothing to the sentry
  await press('KeyE', 80);
  await sleep(200);
  assert.deepEqual(JSON.parse(await js(`JSON.stringify([__G.takedowns, ${unit('gate')}.dead])`)), [0, false]);
  await until('__G.player.leanK === 0', 'to stand straight again', 3000);
  await js('__G.player.hidden = false; void 0');
  await press(USE, 80);
  await until('__G.takedowns === 1', 'the takedown', 3000);
  const r = JSON.parse(
    await js(
      `JSON.stringify({ kills: __G.kills, down: __G.mission.hostilesDown, dead: ${unit('gate')}.dead, alarm: __G.enemies.alarm.active })`,
    ),
  );
  assert.deepEqual(r, { kills: 1, down: 1, dead: true, alarm: false });
  assert.equal(
    await js('!!__G.enemies.takedownTarget(__G.player)'),
    false,
    'a machine that is down cannot be taken down again',
  );
});

test('a machine that is fighting cannot be taken down by hand', async () => {
  await js(
    `{ const u = ${unit('yardEast')}; u.brain.state = "combat"; __G.debug.teleport(u.x + Math.sin(u.yaw) * 1.3, u.z + Math.cos(u.yaw) * 1.3, u.yaw); }`,
  );
  assert.equal(await js('!!__G.enemies.takedownTarget(__G.player)'), false);
});

// ---------- the fallen ----------
// Decision of 16 November 2026 — the owner: "make the robots smarter, when they see a friend of their that died
// they need to trigger the site alarm you can add a feature where you can drag and hide the body so it won't be
// seen". The rules are held without a browser (test/unit/bodies.test.mjs); what the built game does is held here.

/**
 * A stage for it, on the road into the mountain: every machine cleared off but two. One watches, standing on the
 * road at (63.5, `at`) and looking the way `facing` says (0 is up the road, north); the other is put `d` metres
 * up the road from it, shut down silently, and lies there. The player is out of the way and cannot be seen.
 */
const fallen = (d, facing, at = 93.5) =>
  js(`JSON.stringify((() => {
    const G = __G; G.debug.start(); G.player.hidden = true; G.debug.teleport(64.5, 70.5, 0);
    const e = G.enemies, watch = e.byName('gate'), fall = e.byName('yardEast');
    e.remove(e.list.filter((u) => u !== watch && u !== fall).map((u) => u.rollId));
    const put = (u, x, z, yaw) => Object.assign(u, { x, z, yaw, postYaw: yaw, headYaw: 0, scanT: 0, route: [[Math.floor(x), Math.floor(z)]], routeI: 0, path: null, goalX: -1 });
    put(watch, 63.5, ${at}, ${facing}); put(fall, 63.5, ${at} - ${d}, 0);
    e.takedown(fall);
    return { time: G.time, light: G.world.visibility(fall.x, fall.z), setting: G.level.bodies,
      clear: G.world.grid.sight(watch.x, 1.72, watch.z, fall.x, ${BODY.height}, fall.z), free: !G.world.grid.blocked(Math.floor(fall.x), Math.floor(fall.z)) };
  })())`).then(JSON.parse);
const wreck = () =>
  js(`JSON.stringify((() => {
    const G = __G, fall = G.enemies.byName('yardEast');
    return { time: G.time, alarm: G.enemies.alarm.active, counted: G.enemies.alarm.count, at: [G.enemies.alarm.x, G.enemies.alarm.z],
      found: !!fall.found, where: [fall.x, fall.z], watching: G.enemies.byName('gate').brain.state,
      note: document.querySelector('#hud .note').textContent, radio: document.querySelector('#hud .radio').textContent };
  })())`).then(JSON.parse);

test('a machine that has a fallen one in sight for a second raises the alarm, and it counts; behind its back, or too far off for the light it lies in, the wreck lies unfound', async () => {
  // how far up the road a wreck can lie and still be seen, for the light that falls there
  const reach = async (d) => {
    const { light, setting } = JSON.parse(
      await js(`JSON.stringify({ light: __G.world.visibility(63.5, 93.5 - ${d}), setting: __G.level.bodies })`),
    );
    return bodyView(light, setting);
  };
  await js('__G.debug.start(); void 0');
  let near = 0;
  for (const d of [5, 4, 3, 2.5]) if (!near && d <= 0.7 * (await reach(d))) near = d;
  assert.ok(near >= 2.5, 'nowhere on the road is a wreck near enough to be seen');

  // in front of it, near enough for the light: a second, and the alarm is up — at the wreck, and counted
  const staged = await fallen(near, 0);
  assert.ok(staged.clear && staged.free, JSON.stringify(staged));
  assert.equal((await wreck()).alarm, false, 'the alarm was up before anybody had looked');
  await until('__G.enemies.alarm.active', 'the wreck to be found', 4000);
  const found = await wreck();
  assert.ok(
    found.time - staged.time >= BODY.notice * 0.8,
    `it was found after ${(found.time - staged.time).toFixed(2)} s`,
  );
  assert.equal(found.counted, 1, 'a machine finding a wreck is a machine raising the alarm: it counts');
  assert.equal(found.found, true);
  assert.ok(Math.hypot(found.at[0] - found.where[0], found.at[1] - found.where[1]) < 0.01, 'the alarm names the wreck');
  assert.match(found.note, /A WRECK HAS BEEN FOUND/);
  assert.match(found.radio, /One of them has found the sentry you left to the south\. The whole site is awake\./);
  // …and the one that found it goes to look
  await until(`${unit('gate')}.brain.state === "search"`, 'the watcher to go and look', 3000);

  // behind its back: it lies there, and nothing happens
  await fallen(near, Math.PI);
  await sleep(2500);
  const behind = await wreck();
  assert.deepEqual(
    [behind.alarm, behind.counted, behind.found],
    [false, 0, false],
    'a wreck behind its back was found',
  );

  // too far off for the light it lies in: the same
  let far = 0;
  for (let d = 6; d <= 21 && !far; d++) if (d >= 1.3 * (await reach(d))) far = d;
  assert.ok(far > 0, 'nowhere on the road is too far');
  const distant = await fallen(far, 0);
  assert.ok(distant.clear && distant.free, `the line to ${far} m up the road is not clear`);
  await sleep(2500);
  const beyond = await wreck();
  assert.deepEqual([beyond.alarm, beyond.counted, beyond.found], [false, 0, false], `a wreck ${far} m off was found`);

  // a machine that goes down while the alarm is already sounding is no news: it is known at once, and raises nothing
  await js('__G.debug.start(); __G.player.hidden = true; __G.enemies.alert(64, 80); void 0');
  await js(`__G.enemies.takedown(${unit('yardEast')}); void 0`);
  const during = await wreck();
  assert.deepEqual([during.found, during.counted], [true, 0]);
});

test('a fallen machine can be dragged out of sight: G takes hold of it, it comes after you, one hand is full — and where it is left, it is not found', async () => {
  // the watcher stands on the road with its back to the wreck, five metres down the road from it
  await fallen(5, Math.PI, 90.5);
  const state = () =>
    js(`JSON.stringify((() => {
      const G = __G, e = G.enemies, fall = e.byName('yardEast'), p = G.player;
      return { dragged: e.dragged === fall, holding: p.holding, gun: G.weapon.current, prompt: document.querySelector('#hud .prompt span').textContent,
        apart: Math.hypot(fall.x - p.x, fall.z - p.z), where: [fall.x, fall.z], yaw: fall.yaw, speed: p.speed, note: document.querySelector('#hud .note').textContent,
        seen: G.world.grid.sight(63.5, 1.72, 90.5, fall.x, ${BODY.height}, fall.z), alarm: e.alarm.active, found: !!fall.found };
    })())`).then(JSON.parse);
  // stand over it, looking at it: the screen offers it
  await js(`{ const u = ${unit('yardEast')}; __G.debug.teleport(u.x, u.z + 0.9, 0); __G.player.pitch = -0.6; }`);
  await until('document.querySelector("#hud .prompt span").textContent === "[G] DRAG"', 'the offer to drag it', 3000);
  const before = await state();
  assert.equal(before.seen, true, 'the watcher, turned round, would see it where it lies');
  assert.equal(before.dragged, false);
  await press('KeyG', 80);
  await until('!!__G.enemies.dragged', 'the wreck to be taken hold of', 3000);
  // one hand is full: the carbine is held in the other, as it is behind a shield
  await until('__G.weapon.hold > 0.9', 'the gun to be taken into one hand', 3000);
  const taken = await state();
  assert.equal(taken.holding, true, 'a hand is full');
  assert.equal(taken.gun, 'carbine');
  assert.match(taken.prompt, /^DRAGGING — \[G\] LET GO · HERE IT IS SEEN FROM \d+ m$/);

  // Away up the road, out of the tunnel's mouth, and then west along the front of the rock, round the corner
  // of the tunnel wall: it comes after, never further off than the rope is long, and the walk is a slow one.
  let fastest = 0;
  let furthest = 0;
  const walk = async (yaw, samples) => {
    await js(`__G.player.yaw = ${yaw}; __G.player.pitch = 0; void 0`);
    await page.keyDown('KeyW', 'w', 0);
    try {
      for (let n = 0; n < samples; n++) {
        await sleep(120);
        const s = await state();
        fastest = Math.max(fastest, s.speed);
        furthest = Math.max(furthest, s.apart);
        assert.equal(s.dragged, true, `it was let go of at ${s.where}`);
      }
    } finally {
      await page.keyUp('KeyW', 'w', 0);
    }
  };
  await walk(0, 13);
  await walk(Math.PI / 2, 34);
  assert.ok(fastest > 1.5 && fastest <= 2.45, `dragging, the fastest was ${fastest.toFixed(2)} m/s`);
  assert.ok(furthest <= BODY.rope + 0.05, `it fell ${furthest.toFixed(2)} m behind`);
  const moved = await state();
  assert.ok(Math.hypot(moved.where[0] - 63.5, moved.where[1] - 85.5) > 5, `it has come ${JSON.stringify(moved.where)}`);
  assert.equal(moved.seen, false, 'where it is now the watcher has no line to it');

  // let go: it lies where it is, the hand is free, and the screen says how far off it can be seen there
  await press('KeyG', 80);
  await until('!__G.enemies.dragged', 'the wreck to be let go of', 3000);
  const left = await state();
  assert.equal(left.holding, false);
  assert.match(left.note, /^LEFT WHERE IT IS SEEN FROM \d+ m$/);
  await sleep(300);
  assert.deepEqual((await state()).where, left.where, 'let go of, it went on moving');

  // the watcher turns round and looks up the road, where it lay: there is nothing there to find
  await js(`Object.assign(${unit('gate')}, { yaw: 0, postYaw: 0, headYaw: 0 }); void 0`);
  await sleep(2600);
  const after = await state();
  assert.deepEqual([after.alarm, after.found], [false, false], 'hidden round the corner, it was found all the same');

  // a wreck is let go of by itself when the hand that holds it goes down
  await js(`__G.debug.teleport(${left.where[0]}, ${left.where[1]} + 0.9, 0); __G.player.pitch = -0.6; void 0`);
  await until('document.querySelector("#hud .prompt span").textContent === "[G] DRAG"', 'the offer again', 3000);
  await press('KeyG', 80);
  await until('!!__G.enemies.dragged', 'the wreck to be taken hold of again', 3000);
  await js('__G.debug.hurt(500)');
  await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
  assert.deepEqual(JSON.parse(await js('JSON.stringify([!!__G.enemies.dragged, __G.player.holding])')), [false, false]);
  await js('__G.debug.start(); void 0');
});

test('standing in the light in front of a guard gets you seen, shot at, and the alarm raised', async () => {
  await js('__G.debug.start()');
  // the road patrol: stand seven metres in front of it, under the yard lamps
  await js(
    `{ const u = ${unit('road')}; __G.debug.teleport(u.x - Math.sin(u.yaw) * 7, u.z - Math.cos(u.yaw) * 7, u.yaw + Math.PI); }`,
  );
  await until(`${unit('road')}.brain.state === "combat"`, 'the sentry to spot the player', 15000);

  // where it is coming from: Overwatch says so by the compass, and the screen shows it three ways.
  // The patrol set out northwards and the player stands north of it, facing it: the contact is to the south, ahead.
  // (The line is there from the moment the sentry stops and stares; it turns red at the next tenth of a second
  // after it has made up its mind — that is what is waited for here, and then asserted.)
  await until(
    'document.querySelector("#hud .bearing .contact").textContent !== "" && document.querySelector("#hud .bearing .contact").classList.contains("hot")',
    'the contact line, in red',
    3000,
  );
  const seen = JSON.parse(
    await js(
      'JSON.stringify({ radio: document.querySelector("#hud .radio").textContent, line: document.querySelector("#hud .bearing .contact").textContent, hot: document.querySelector("#hud .bearing .contact").classList.contains("hot"), facing: document.querySelector("#hud .bearing .facing").textContent, drawn: __G.hud.drawn, total: __G.contacts.total })',
    ),
  );
  assert.match(seen.radio, /Contact — sentry to the south, (5|10) metres\./);
  assert.match(seen.line, /^↑ S \d+ m$/, 'ahead of you, to the south, so many metres');
  assert.equal(seen.hot, true, 'a machine that is fighting is marked in red');
  assert.equal(seen.facing, 'FACING SOUTH');
  assert.ok(seen.total >= 1 && seen.drawn.ticks >= 1, 'and it is marked on the compass strip');
  assert.ok(seen.drawn.dots >= 1, 'and on the small map');
  assert.ok(seen.drawn.north[1] > 0.95, 'north is at the bottom of the small map when you face south');

  await until('__G.enemies.alarm.active', 'the alarm', 15000);
  await until('__G.player.health < 100', 'a hit on the player', 20000);
  assert.equal(await js('__G.enemies.alarm.count'), 1);
  assert.ok((await js('document.querySelector("#hud .banner").textContent')).startsWith('SITE ALARM'));

  // With the whole site awake and the player in the open, only two machines may be firing at any moment on
  // Operator (it was three until 12 November 2026). First wait until at least two have the player in their
  // sights, so that the limit is what holds the third back and not the lack of one.
  await js('__G.player.health = 1e6; __G.debug.speed(4)');
  const inSight = '__G.enemies.list.filter((u) => !u.dead && u.brain.state === "combat" && u.sees).length';
  await until(`${inSight} >= 2`, 'two machines to have the player in their sights', 90000);
  let most = 0;
  let fighting = 0;
  for (let k = 0; k < 40; k++) {
    await sleep(100);
    most = Math.max(most, await js('__G.enemies.firing()'));
    fighting = Math.max(fighting, await js(inSight));
  }
  // the alarm has sent the rest of the site looking: they are named as contacts too, wherever they are
  const hunt = JSON.parse(await js('JSON.stringify({ total: __G.contacts.total, drawn: __G.hud.drawn })'));
  await js('__G.debug.speed(1); __G.player.health = 60');
  assert.ok(most >= 1, 'somebody is shooting');
  assert.ok(most <= 2, `${most} machines were firing at once`);
  assert.ok(fighting >= 2, `only ${fighting} machine(s) had the player in sight, so the limit was never tested`);
  assert.ok(hunt.total >= 3, `only ${hunt.total} machine(s) are named as after you with the whole site awake`);
  assert.ok(hunt.drawn.dots + hunt.drawn.arrows >= 3, 'each is on the small map, as a dot or an arrow on its rim');
});

test('an alarm always ends: lose them, and the site stands down and goes back to its rounds', async () => {
  // carries on from the alarm above; the player vanishes, and the world runs twelve steps a frame
  await js('__G.player.hidden = true; __G.player.health = 100; __G.debug.speed(12)');
  const t0 = await js('__G.mission.time');
  await until('!__G.enemies.alarm.active', 'the alarm to stand down', 120000);
  const stoodDown = (await js('__G.mission.time')) - t0;
  assert.ok(
    stoodDown >= 40 && stoodDown <= 60,
    `stood down after ${stoodDown.toFixed(0)} s; 45 s after the last sighting is the rule`,
  );
  await until(
    '__G.enemies.list.every((u) => u.dead || u.brain.state === "patrol")',
    'every machine to be back on patrol',
    120000,
  );
  const all = (await js('__G.mission.time')) - t0;
  assert.ok(all <= 100, `the last machine gave up after ${all.toFixed(0)} s`);
  assert.equal(await js('__G.enemies.alarm.count'), 1, 'and nobody raised it again');
  assert.equal(await js('document.querySelector("#hud .banner").hidden'), true);
  await js('__G.debug.speed(1)');
});

test('clearing the site, rigging the cascades and blowing them unlocks the beacon; raising it starts the clock and brings pursuers', async () => {
  // cleared and rigged is not enough any more: the beacon stays locked until the cascades have gone up
  await js('__G.debug.clearSite(); __G.debug.rig();');
  await sleep(300);
  await js('__G.debug.teleport(__G.site.beacon.x, __G.site.beacon.z, 0); __G.player.health = 100;');
  await sleep(250);
  assert.deepEqual(
    JSON.parse(await js('JSON.stringify([__G.mission.phase, __G.mission.blown, __G.prompt])')),
    ['infil', false, null],
    'the pad offered the lodestar before the cascades were blown',
  );
  assert.match(
    await js('document.querySelector("#hud .objectives").textContent'),
    /Rig the centrifuge cascades\s+4 \/ 4/,
  );
  await js('__G.debug.blow();');
  await until('__G.mission.phase === "mark"', 'the mark phase', 5000);
  assert.equal(await js('__G.enemies.remaining()'), 0);
  // the drones that answer the blast are not on the roll; here they are put out of the way of what follows
  await js(
    'for (const u of [...__G.enemies.list]) if (!u.dead && u.rollId < 0) __G.enemies.damage(u, 1e6, 0, 0); void 0',
  );
  await js('__G.debug.teleport(__G.site.beacon.x, __G.site.beacon.z, 0); __G.player.health = 100;');
  await sleep(150);
  await press(USE, 3500);
  await until('__G.mission.phase === "exfil"', 'the exfil phase', 3000);
  const r = JSON.parse(
    await js(
      'JSON.stringify({ clock: __G.mission.clock, pursuers: __G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).length, remaining: __G.enemies.remaining(), radio: document.querySelector("#hud .radio").textContent })',
    ),
  );
  // five seconds less than it was: decision of 12 November 2026, "a bit harder" (test/unit/difficulty.test.mjs)
  assert.ok(r.clock <= 60 && r.clock > 45, `Operator gets 60 seconds; the clock shows ${r.clock}`);
  assert.equal(r.pursuers, 3, 'three drones come after you on Operator');
  assert.equal(r.remaining, 0, 'pursuers are not on the roll');
  assert.ok((await js('document.querySelector("#hud .banner").textContent')).startsWith('HAMMERFALL'));
  // Overwatch says where they are coming from and where the way out lies, by the compass
  assert.match(r.radio, /Drones inbound from the north-west — the pickup is south-west\. Run\./);
  await until('__G.contacts.total === 3 && __G.hud.drawn.arrows === 3', 'the pursuers to be marked', 3000);
  assert.match(
    await js('document.querySelector("#hud .bearing .contact").textContent'),
    /^[↑↗→↘↓↙←↖] (N|NW|W) \d+ m$/,
    'the nearest of them, named under the small map',
  );
  assert.match(
    await js('document.querySelector("#hud .bearing .goal").textContent'),
    /^◆ SW \d+ m$/,
    'and so is the pickup',
  );
});

test('reaching the pickup plays the ending and shows the debrief; it is watched from the valley, and the mountain comes down on the facility', async () => {
  await js('__G.debug.teleport(__G.site.pickup.x, __G.site.pickup.z, 0)');
  // the pickup is the forecourt: out of the tunnel, under the sky
  await sleep(120);
  assert.deepEqual(
    JSON.parse(
      await js(
        'JSON.stringify([__G.world.openSky(__G.player.x, __G.player.z), document.querySelector("#hud .zone").textContent.toUpperCase()])',
      ),
    ),
    [true, 'FORECOURT'],
  );
  await until('__G.state === "ending"', 'the ending to start', 3000);
  // once the picture has cut away, the camera is outside and stays outside
  await until('__G.cine && __G.cine.cut && __G.cine.t > 1.4', 'the cut to the valley', 5000);
  let eye = await camera();
  assert.ok(eye.sky && eye.y > eye.ground + 1.5 && eye.z > 125, `the ending is watched from ${JSON.stringify(eye)}`);
  assert.equal(await uniform('uCraterGo'), 0, 'nothing has come down yet');
  await until('__G.cine && __G.cine.hit', 'the strike', 15000);
  await until('__G.menus.current() === "debrief"', 'the debrief', 30000);
  assert.equal(await js('__G.mission.phase'), 'extracted');
  assert.equal(await js('__G.fx !== null && window.__G.state'), 'over');
  const text = await js('document.querySelector("#menus").textContent');
  assert.match(text, /SITE HOLLOW NINE IS GONE/i);
  assert.match(text, /[SABC]/);
  // The debrief counts the alarms machines raised: one, in the test above. (Until 12 November 2026 it always
  // said none — the count was read after the machines, and their alarm with them, had been cleared away for the
  // ending.) The two the site sounds for itself, at the blast and at the beacon, are not held against you.
  assert.match(text, /Alarms raised\s*1(?!\d)/);
  assert.ok(JSON.parse(await js('localStorage.getItem("lodestar.record.v1")')).seconds >= 0, 'the run is remembered');
  // the mountain over the facility has sunk into a hollow, and the facility itself was never pulled down in the open
  assert.equal(await uniform('uCraterGo'), 1);
  assert.equal(await uniform('uRuin'), 0);
  assert.equal(
    await js('__G.world.group.getObjectByName("flares").visible'),
    false,
    'lamps were left alight in the air',
  );
  eye = await camera();
  assert.ok(eye.sky && eye.y > eye.ground + 10, `the debrief looks down from ${JSON.stringify(eye)}`);
});

test('PLAY AGAIN starts a clean mission', async () => {
  await click('restart');
  assert.equal(await state(), 'playing');
  // the mountain is whole again and its lamps are lit
  assert.equal(await uniform('uCraterGo'), 0);
  assert.equal(await js('__G.world.group.getObjectByName("flares").visible'), true);
  const m = JSON.parse(
    await js(
      'JSON.stringify({ phase: __G.mission.phase, down: __G.mission.hostilesDown, alive: __G.enemies.remaining(), health: __G.player.health, mag: __G.weapon.mag, alarm: __G.enemies.alarm.active })',
    ),
  );
  assert.deepEqual(m, {
    phase: 'infil',
    down: 0,
    alive: await js('__G.mission.hostilesTotal'),
    health: 100,
    mag: 30,
    alarm: false,
  });
});

test('pause stops the clock of the world and resume starts it again', async () => {
  await js('__G.debug.pause()');
  assert.equal(await state(), 'paused');
  assert.equal(await js('__G.menus.current()'), 'pause');
  const t = await js('__G.mission.time');
  await sleep(400);
  assert.equal(await js('__G.mission.time'), t);
  await click('resume');
  assert.equal(await state(), 'playing');
  await sleep(300);
  assert.ok((await js('__G.mission.time')) > t);
});

test('health 0 ends the mission on the failed screen, and RETRY works', async () => {
  await js('__G.debug.hurt(500)');
  await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
  assert.equal(await js('__G.mission.phase'), 'down');
  assert.match(await js('document.querySelector("#menus").textContent'), /WRAITH IS DOWN/i);
  await click('restart');
  assert.equal(await state(), 'playing');
  assert.equal(await js('__G.player.health'), 100);
});

test('setting a charge wakes the site: its alarm — the site’s own, not counted — and a wave of machines for the charge, from where they are not seen', async () => {
  // Decision of 16 November 2026 — the owner: "every time you rig a centrifuge fire an alarm with new guards and
  // drones that are coming to you". How many is the setting's (test/unit/difficulty… wave.test.mjs holds the
  // table and the choosing of the doors); that the built game does it is held here.
  const rig = async (id, planted) => {
    await js(
      `{ const c = __G.site.charges.find((c) => c.id === "${id}"); __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); __G.player.hidden = true; }`,
    );
    await sleep(150);
    await press(USE, 2400);
    await until(`__G.mission.chargesPlanted === ${planted}`, 'the charge', 3000);
  };
  const wave = (id) =>
    js(`JSON.stringify((() => {
      const G = __G, p = G.player, c = G.site.charges.find((c) => c.id === "${id}");
      const off = G.enemies.list.filter((u) => u.rollId < 0 && !u.dead);
      return {
        guards: off.filter((u) => u.type === 'sentry').length, drones: off.filter((u) => u.type === 'drone').length,
        seen: off.filter((u) => G.world.grid.sight(p.x, p.eye, p.z, u.x, 1.6, u.z)).length,
        nearest: Math.min(...off.map((u) => Math.hypot(u.x - p.x, u.z - p.z))),
        states: [...new Set(off.map((u) => u.brain.state))],
        astray: off.filter((u) => Math.hypot(u.brain.targetX - c.x, u.brain.targetZ - c.z) > 5).length,
        alarm: G.enemies.alarm.active, counted: G.enemies.alarm.count, at: [G.enemies.alarm.x, G.enemies.alarm.z],
        garrison: G.enemies.byName('corridor').brain.state, charge: [c.x, c.z],
        radio: document.querySelector('#hud .radio').textContent, note: document.querySelector('#hud .note').textContent,
        roll: G.enemies.remaining(), total: G.mission.hostilesTotal,
      };
    })())`).then(JSON.parse);

  await js('__G.settings.set("difficulty", "operator"); __G.debug.start(); void 0');
  assert.equal(
    await js('__G.enemies.list.filter((u) => u.rollId < 0).length'),
    0,
    'nothing is off the roll at the start',
  );
  await rig('c1', 1);
  await until('__G.enemies.byName("corridor").brain.state === "search"', 'the garrison to be told', 3000);
  const first = await wave('c1');
  // Operator: one guard on foot and one drone — and neither appeared where the player could see it, or near
  assert.deepEqual([first.guards, first.drones], [1, 1]);
  assert.equal(first.seen, 0, 'a machine of the wave appeared in plain sight');
  assert.ok(first.nearest >= 14, `a machine of the wave appeared ${first.nearest.toFixed(1)} m away`);
  // they have been told where: each is on its way to look at the charge, and so is the garrison
  assert.deepEqual(first.states, ['search']);
  assert.equal(first.astray, 0, 'a machine of the wave was sent somewhere else');
  assert.equal(first.garrison, 'search');
  // the alarm is up, at the charge — and it is the site's own: not counted against the grade
  assert.equal(first.alarm, true);
  assert.equal(first.counted, 0);
  assert.ok(Math.hypot(first.at[0] - first.charge[0], first.at[1] - first.charge[1]) < 0.01);
  // nobody on the roll was added or taken away
  assert.equal(first.roll, first.total);
  assert.match(first.note, /CHARGE SET — CASCADE 1/);
  assert.match(
    first.radio,
    /Charge 1 is live\. WARDEN felt it go on — the alarm is up, and one guard and one drone are coming for it from the (north|south|east|west|north-east|north-west|south-east|south-west)\./,
  );
  // and they do come: the guard is nearer the charge a few seconds on than it was
  const gap = () =>
    js(
      '(() => { const c = __G.site.charges[0]; const u = __G.enemies.list.find((u) => u.rollId < 0 && u.type === "sentry"); return Math.hypot(u.x - c.x, u.z - c.z); })()',
    );
  const from = await gap();
  await until(
    `(() => { const c = __G.site.charges[0]; const u = __G.enemies.list.find((u) => u.rollId < 0 && u.type === "sentry"); return Math.hypot(u.x - c.x, u.z - c.z); })() < ${from - 3}`,
    'the guard of the wave to come three metres nearer',
    12000,
  );

  // every charge brings one: the second, another guard and another drone
  await rig('c2', 2);
  await sleep(250);
  const second = await wave('c2');
  assert.deepEqual([second.guards, second.drones], [2, 2]);
  assert.equal(second.counted, 0);
  assert.match(second.radio, /Charge 2 is live\. WARDEN felt it go on/);

  // the other settings: Recruit sends a guard and no drone; Ghost two guards and a drone
  for (const [setting, guards, drones, words] of [
    ['recruit', 1, 0, /one guard is coming for it from the/],
    ['ghost', 2, 1, /two guards and one drone are coming for it from the/],
  ]) {
    await js(`__G.settings.set("difficulty", "${setting}"); __G.debug.start(); void 0`);
    await rig('c4', 1);
    await sleep(250);
    const sent = await wave('c4');
    assert.deepEqual([sent.guards, sent.drones], [guards, drones], setting);
    assert.equal(sent.seen, 0, `${setting}: a machine of the wave appeared in plain sight`);
    assert.match(sent.radio, words);
  }
  await js('__G.settings.set("difficulty", "operator"); __G.debug.start(); void 0');
});

test('a charge is a checkpoint: RETRY after it puts you back there, with what you had done still done', async () => {
  await js('__G.debug.start()');
  // shut three machines down, use up some of what is carried, then set the charge on the third cascade
  // (the three wrecks are the stage, not the play: the site is told of them — `known` — so that nobody finds
  // one and raises an alarm that this test would then have to count. Since 16 November 2026 they would.)
  await js(
    'for (const name of ["yardEast", "hallLoop", "droneYard"]) __G.enemies.damage(__G.enemies.byName(name), 1e6, 0, 0); __G.enemies.known(); __G.weapon.mag = 21; __G.weapon.reserve = 60; Object.assign(__G.weapon.arms.guns.pistol, { mag: 5, reserve: 24 }); __G.weapon.arms.grenades = 1; __G.weapon.arms.mode = "semi"; void 0',
  );
  await js(
    '{ const c = __G.site.charges.find((c) => c.id === "c3"); __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); __G.player.hidden = true; }',
  );
  await sleep(150);
  await press(USE, 2400);
  await until('__G.mission.chargesPlanted === 1', 'the charge', 3000);
  const saved = JSON.parse(await js('JSON.stringify({ time: __G.mission.time, kills: __G.kills })'));
  assert.equal(saved.kills, 3);

  // wander off, lose some more of everything, take another gun in hand, shut down one more machine, and die
  await js(
    '__G.debug.teleport(64.5, 70.5, 0); __G.weapon.mag = 2; Object.assign(__G.weapon.arms.guns.pistol, { mag: 0, reserve: 0 }); __G.weapon.arms.grenades = 0; __G.weapon.arms.mode = "auto"; __G.weapon.arms.current = "shotgun"; __G.enemies.damage(__G.enemies.byName("corridor"), 1e6, 0, 0); __G.debug.hurt(500)',
  );
  await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
  assert.match(
    await js('document.querySelector("#menus").textContent'),
    /RETRY puts you back at the charge you set on cascade 3\. What you had done by then is still done\./,
    'the failed screen says what RETRY will do',
  );
  await click('restart');
  assert.equal(await state(), 'playing');
  const back = JSON.parse(
    await js(`JSON.stringify({
      phase: __G.mission.phase, charges: __G.mission.chargesPlanted, c3: __G.mission.charges.c3, down: __G.mission.hostilesDown,
      kills: __G.kills, alive: __G.enemies.remaining(), total: __G.mission.hostilesTotal,
      gone: ["yardEast", "hallLoop", "droneYard"].every((name) => __G.enemies.byName(name).dead), nine: __G.enemies.byName("corridor").dead,
      health: __G.player.health, mag: __G.weapon.mag, reserve: __G.weapon.reserve,
      arms: [__G.weapon.current, __G.weapon.mode, __G.weapon.arms.guns.pistol.mag, __G.weapon.arms.guns.pistol.reserve, __G.weapon.grenades],
      near: Math.hypot(__G.player.x - (__G.site.charges.find((c) => c.id === "c3").stand[0] + 0.5), __G.player.z - (__G.site.charges.find((c) => c.id === "c3").stand[1] + 0.5)),
      time: __G.mission.time, alarm: __G.enemies.alarm.active,
    })`),
  );
  assert.deepEqual(
    {
      phase: back.phase,
      charges: back.charges,
      c3: back.c3,
      down: back.down,
      kills: back.kills,
      gone: back.gone,
      nine: back.nine,
    },
    { phase: 'infil', charges: 1, c3: true, down: 3, kills: 3, gone: true, nine: false },
    'the charge and the three machines are still done; the fourth, shut down after the checkpoint, is back',
  );
  assert.equal(back.alive, back.total - 3);
  assert.deepEqual(
    [back.health, back.mag, back.reserve, back.alarm],
    [100, 21, 60, false],
    'health full, ammunition as it was at the charge',
  );
  assert.deepEqual(
    back.arms,
    ['carbine', 'semi', 5, 24, 1],
    'and so is every other gun, the grenades, the gun that was in hand and the way the carbine was set',
  );
  assert.ok(back.near < 0.2, 'standing where the charge was set');
  assert.ok(
    Math.abs(back.time - saved.time) < 1.5,
    `the clock carries on from the checkpoint (${saved.time.toFixed(1)} s), so a retry is not a faster run: ${back.time.toFixed(1)} s`,
  );
  // The wave that charge brought is on its way again (16 November 2026) — as the drones the blast brought are —
  // one guard and one drone on Operator, from where they are not seen; and the alarm (above) is not raised again.
  const again = JSON.parse(
    await js(`JSON.stringify((() => {
      const G = __G, p = G.player, c = G.site.charges.find((c) => c.id === "c3");
      const off = G.enemies.list.filter((u) => u.rollId < 0 && !u.dead);
      return {
        kinds: off.map((u) => u.type).sort(),
        seen: off.filter((u) => G.world.grid.sight(p.x, p.eye, p.z, u.x, 1.6, u.z)).length,
        astray: off.filter((u) => Math.hypot(u.pingP.x - c.x, u.pingP.z - c.z) > 0.01).length,
        counted: G.enemies.alarm.count,
      };
    })())`),
  );
  assert.deepEqual(again, { kinds: ['drone', 'sentry'], seen: 0, astray: 0, counted: 0 });

  // RESTART from the pause menu is a different thing: the whole mission, from the wire
  await js('__G.debug.pause()');
  await click('restart');
  await click('restart'); // "Sure? Yes"
  await until('__G.state === "playing"', 'the mission to restart', 3000);
  assert.deepEqual(
    JSON.parse(await js('JSON.stringify([__G.mission.chargesPlanted, __G.mission.hostilesDown, __G.player.x < 14])')),
    [0, 0, true],
  );
});

test('a checkpoint remembers which caches were empty: taken before the charge stays taken, taken after it is full again', async () => {
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  const at = (n) => js(`{ const [x, z] = __G.site.ammo[${n}]; __G.debug.teleport(x, z, 0); }`);
  await at(0);
  await until('__G.caches.has(0)', 'the first cache', 3000);
  await js(
    '{ const c = __G.site.charges.find((c) => c.id === "c3"); __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); }',
  );
  await sleep(150);
  await press(USE, 2400);
  await until('__G.mission.chargesPlanted === 1', 'the charge', 3000);
  // every round for every gun (192 at the start), and what a cache holds of each (48)
  const all = '__G.weapon.everything';
  assert.deepEqual(
    JSON.parse(await js(`JSON.stringify([${all}, __G.weapon.total, __G.weapon.grenades])`)),
    [240, 150, 3],
  );
  await at(1);
  await until('__G.caches.has(1)', 'the second cache', 3000);
  assert.deepEqual(
    JSON.parse(await js(`JSON.stringify([${all}, __G.weapon.total, __G.weapon.grenades])`)),
    [288, 180, 4],
  );

  await js('__G.debug.hurt(500)');
  await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
  await click('restart');
  assert.equal(await state(), 'playing');
  assert.deepEqual(
    JSON.parse(
      await js(
        `JSON.stringify({ taken: [...__G.caches], all: ${all}, total: __G.weapon.total, emp: __G.weapon.grenades })`,
      ),
    ),
    { taken: [0], all: 240, total: 150, emp: 3 },
  );
  // the second gives again; the first, emptied before the charge, does not
  await js('__G.player.hidden = true; void 0');
  await at(1);
  await until(`${all} === 288`, 'the second cache to give again', 3000);
  await at(0);
  await sleep(400);
  assert.equal(await js(all), 288, 'a cache emptied before the checkpoint gave again');
  // and a whole new mission fills all three
  await js('__G.debug.start()');
  assert.deepEqual(JSON.parse(await js(`JSON.stringify([[...__G.caches], ${all}, __G.weapon.total])`)), [[], 192, 120]);
});

test('a checkpoint remembers which lamps had been shot out: one shot before the charge stays out, one shot after it burns again', async () => {
  // Decision of 16 November 2026 (with "i want to have the ability to shoot at the light to turn it off"): a lamp
  // that is shot is out for the mission, and a retry is the mission as it stood at the charge — so what was
  // broken by then is still broken, and what was broken after it, or only tripped by an EMP, is whole.
  await js('__G.debug.start(); __G.player.hidden = true; void 0');
  const first = await js(CORRIDOR_LAMP);
  // …and the next lamp along the corridor
  const second = await js(
    '(() => { const d = __G.debug.lamps; for (let i = 0; i < d.site; i++) { const l = d.at(i); if (Math.abs(l.x - 51.5) < 0.01 && Math.abs(l.z - 44.5) < 0.01) return i; } return -1; })()',
  );
  assert.ok(first >= 0 && second >= 0 && first !== second, `the corridor's lamps: ${first}, ${second}`);
  const built = { first: await lightAt(43.5, 44.5), second: await lightAt(51.5, 44.5) };
  const out = () => js('JSON.stringify(__G.debug.lamps.out())').then(JSON.parse);
  await js(`__G.debug.lamps.shoot(${first}); void 0`);
  assert.deepEqual(await out(), [first]);
  await js(
    '{ const c = __G.site.charges.find((c) => c.id === "c3"); __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); }',
  );
  await sleep(150);
  await press(USE, 2400);
  await until('__G.mission.chargesPlanted === 1', 'the charge', 3000);
  // after the charge: another lamp is shot, an EMP trips the control room, and the player goes down
  await js(`__G.debug.lamps.shoot(${second}); __G.debug.lamps.trip(__G.site.firing.x, __G.site.firing.z); void 0`);
  const broken = await out();
  assert.ok(broken.includes(first) && broken.includes(second) && broken.length > 3, JSON.stringify(broken));
  await js('__G.debug.hurt(500)');
  await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
  await click('restart');
  assert.equal(await state(), 'playing');
  assert.deepEqual(await out(), [first], 'the lamp shot before the charge, and only that one');
  // the level is lit to match, at once: a retry does not begin with the light still catching up
  assert.equal(await js('__G.debug.lamps.waiting()'), 0);
  const now = { first: await lightAt(43.5, 44.5), second: await lightAt(51.5, 44.5) };
  assert.ok(
    now.first < built.first * 0.4,
    `under the lamp shot before the charge: ${now.first}; built, ${built.first}`,
  );
  assert.ok(now.second > built.second * 0.6, `under the lamp shot after it: ${now.second}; built, ${built.second}`);
  const check = await lightCheck();
  assert.ok(check.worst < EXACT && check.waiting === 0, JSON.stringify(check));
  // RESTART — the whole mission again — lights every lamp
  await js('__G.debug.pause()');
  await click('restart');
  await click('restart'); // "Sure? Yes"
  await until('__G.state === "playing"', 'the mission to restart', 3000);
  assert.deepEqual(await out(), []);
  assert.ok(Math.abs((await lightAt(43.5, 44.5)) - built.first) < EXACT);
  assert.ok(Math.abs((await lightAt(51.5, 44.5)) - built.second) < EXACT);
});

test('a checkpoint outlives a change of setting: machines are remembered by name, not by their place on the roll', async () => {
  await js('__G.debug.start()');
  try {
    // on Operator: shut down the gate guard (there on every setting) and the stack-yard sentry (not there on
    // Recruit), then set a charge
    await js(
      'for (const name of ["gate", "stackYard"]) __G.enemies.damage(__G.enemies.byName(name), 1e6, 0, 0); void 0',
    );
    await js(
      '{ const c = __G.site.charges.find((c) => c.id === "c4"); __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); __G.player.hidden = true; }',
    );
    await sleep(150);
    await press(USE, 2400);
    await until('__G.mission.chargesPlanted === 1', 'the charge', 3000);
    assert.deepEqual(JSON.parse(await js('JSON.stringify([__G.mission.hostilesTotal, __G.kills])')), [15, 2]);

    // the setting is turned down (the pause menu allows it), and then the player goes down
    await js('__G.settings.set("difficulty", "recruit"); __G.debug.hurt(500)');
    await until('__G.menus.current() === "failed"', 'the failed screen', 8000);
    await click('restart');
    assert.equal(await state(), 'playing');
    const back = JSON.parse(
      await js(`JSON.stringify({
        total: __G.mission.hostilesTotal, down: __G.mission.hostilesDown, kills: __G.kills, alive: __G.enemies.remaining(),
        charges: __G.mission.chargesPlanted, dead: __G.enemies.list.filter((u) => u.dead).map((u) => u.name),
        stackYard: __G.enemies.byName("stackYard") === undefined,
      })`),
    );
    assert.deepEqual(
      back,
      { total: 10, down: 1, kills: 1, alive: 9, charges: 1, dead: ['gate'], stackYard: true },
      'Recruit’s ten machines, with the one of them that had been shut down still down — and no other',
    );
  } finally {
    await js('__G.settings.set("difficulty", "operator"); __G.debug.start()');
  }
  assert.equal(await js('__G.mission.hostilesTotal'), 15);
});

test('running out the clock inside the mountain ends in the strike', async () => {
  await js('__G.debug.clearSite(); __G.debug.rig(); __G.debug.blow();');
  await until('__G.mission.phase === "mark"', 'the mark phase', 5000);
  await js('__G.debug.teleport(__G.site.beacon.x, __G.site.beacon.z, 0)');
  await sleep(150);
  await press(USE, 3500);
  await until('__G.mission.phase === "exfil"', 'the exfil phase', 3000);
  await js('__G.mission.clock = 0.4');
  await until('__G.menus.current() === "failed"', 'the failed screen', 10000);
  assert.equal(await js('__G.mission.phase'), 'lost');
  assert.match(await js('document.querySelector("#menus").textContent'), /HAMMERFALL LANDED/i);
  // seen from inside: the facility is down round you, and the mountain was not hollowed out for a camera that is not there
  assert.deepEqual([await uniform('uRuin'), await uniform('uCraterGo')], [1, 0]);
  await click('quit');
  assert.equal(await state(), 'title');
  assert.equal(await uniform('uRuin'), 0, 'the title is shown over a ruin');
});

// A walker that plays the objectives for real: it steers the player along routes through the game's own collision
// and doors, and holds USE where the mission asks for it. It does not teleport and it does not set mission state.
const WALKER = `
window.__walk = () => new Promise((resolve) => {
  const G = __G, grid = G.world.grid, p = G.player, site = G.site;
  const targets = [
    ...site.charges.map((c) => ({ name: 'charge ' + c.id, x: c.stand[0] + 0.5, z: c.stand[1] + 0.5, reach: 0.5, hold: () => G.mission.charges[c.id] })),
    { name: 'firing point', x: site.firing.x, z: site.firing.z, reach: 0.8, hold: () => G.mission.blown },
    { name: 'beacon', x: site.beacon.x, z: site.beacon.z, reach: 0.8, hold: () => G.mission.beacon },
    { name: 'pickup', x: site.pickup.x, z: site.pickup.z, reach: 1.2, hold: null },
  ];
  const real = G.input.frame;
  const log = { reached: [], metres: 0, doors: new Set(), from: [p.x, p.z] };
  let ti = 0, path = null, pi = 0, lastX = p.x, lastZ = p.z, stillSince = G.mission.time, began = G.mission.time;
  const finish = (why) => { G.input.frame = real; log.why = why; log.seconds = G.mission.time - began; log.doors = log.doors.size; resolve(log); };
  G.input.frame = () => {
    const intent = real();
    if (G.state !== 'playing') { finish(G.state); return intent; }
    const moved = Math.hypot(p.x - lastX, p.z - lastZ);
    log.metres += moved;
    if (moved > 0.01) stillSince = G.mission.time;
    lastX = p.x; lastZ = p.z;
    const cell = Math.floor(p.z) * grid.w + Math.floor(p.x);
    if (grid.doorAt[cell] >= 0) log.doors.add(grid.doorAt[cell]);
    if (ti >= targets.length) { finish('done'); return intent; }
    const t = targets[ti];
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < t.reach) {
      if (t.hold && !t.hold()) { intent.use = true; stillSince = G.mission.time; return intent; }
      log.reached.push(t.name); ti++; path = null;
      return intent;
    }
    if (G.mission.time - stillSince > 6) { finish('stuck on the way to ' + t.name + ' at ' + p.x.toFixed(1) + ', ' + p.z.toFixed(1)); return intent; }
    if (!path) {
      path = grid.path(Math.floor(p.x), Math.floor(p.z), Math.floor(t.x), Math.floor(t.z));
      pi = 0;
      if (!path) { finish('no route to ' + t.name); return intent; }
    }
    while (pi < path.length - 2 && Math.hypot(path[pi] - p.x, path[pi + 1] - p.z) < 0.45) pi += 2;
    const last = pi >= path.length - 2;
    const gx = last ? t.x : path[pi], gz = last ? t.z : path[pi + 1];
    p.yaw = Math.atan2(-(gx - p.x), -(gz - p.z));
    intent.moveY = 1;
    return intent;
  };
});`;

test('the whole mission can be walked: four charges, the firing point, the beacon and the pickup, through real doors, on foot', async () => {
  await js('__G.debug.start()');
  // the garrison is shut down by script (fights are tested above); everything else here is done the way a player does it
  await js('__G.debug.clearSite(); __G.player.hidden = true; __G.debug.speed(6); void 0');
  await js(WALKER);
  const walk = JSON.parse(await page.evaluate('__walk().then(JSON.stringify)', { timeoutMs: 180000 }));
  assert.equal(walk.why, 'ending', `the walk stopped: ${walk.why} (reached: ${walk.reached.join(', ') || 'nothing'})`);
  assert.deepEqual(walk.reached, ['charge c1', 'charge c2', 'charge c3', 'charge c4', 'firing point', 'beacon']);
  assert.ok(walk.from[0] < 14, 'it set out from the adit, outside the grating');
  assert.ok(walk.metres > 200, `only ${walk.metres.toFixed(0)} m walked`);
  assert.ok(walk.doors >= 4, `only ${walk.doors} doors were walked through`);
  const m = JSON.parse(
    await js(
      'JSON.stringify({ phase: __G.mission.phase, charges: __G.mission.chargesPlanted, blown: __G.mission.blown, beacon: __G.mission.beacon, clock: __G.mission.clock })',
    ),
  );
  assert.deepEqual([m.phase, m.charges, m.blown, m.beacon], ['extracted', 4, true, true]);
  assert.ok(
    m.clock > 20,
    `a walk from the beacon to the pickup left ${m.clock.toFixed(0)} s on the clock: the clock is too tight`,
  );
  await until('__G.menus.current() === "debrief"', 'the debrief', 40000);
  await click('quit');
  assert.equal(await state(), 'title');
  // back at the title the mountain is whole, its lamps are lit, and the picture is the one from the road again
  assert.deepEqual([await uniform('uCraterGo'), await uniform('uRuin')], [0, 0]);
  assert.equal(await js('__G.world.group.getObjectByName("flares").visible'), true);
  await sleep(100);
  const eye = await camera();
  assert.ok(eye.sky && eye.z > 100 && eye.y < 12, `the title is taken from ${JSON.stringify(eye)}`);
});

/** Opens the game in a page of its own and says what went wrong in it, if anything did. */
async function another(query) {
  const other = await harness.browser.newPage();
  await other.navigate(`${harness.url}/?${query}`);
  await other.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 90000, label: 'the game to start' });
  other.problems = async () => [
    ...JSON.parse(await other.evaluate('JSON.stringify(window.__errors || [])')),
    ...other.exceptions,
    ...other.logErrors,
    ...other.console.filter((m) => m.type === 'error').map((m) => m.text),
  ];
  other.framesIn = async (ms) => {
    const a = await other.evaluate('__G.frames');
    await sleep(ms);
    return (await other.evaluate('__G.frames')) - a;
  };
  return other;
}

// How many triangles a thing may be made of, at the two levels of detail that are picked for a player (a phone
// gets `low`, a desk `medium`). The models were rebuilt in more detail on 12 November 2026 — the owner: "… the
// level of assets i want you to reach" — against these ceilings, which are what keeps "more detail" from
// becoming "too slow": a model that grows past one fails here, not on somebody's phone.
const CEILINGS = {
  low: {
    world: 260000,
    sentry: 3200,
    drone: 1900,
    casing: 150,
    carbine: 4400,
    pistol: 3300,
    shotgun: 4300,
    knife: 700,
    grenade: 1400,
  },
  medium: {
    world: 400000,
    sentry: 9000,
    drone: 5000,
    casing: 220,
    carbine: 10000,
    pistol: 6500,
    shotgun: 8500,
    knife: 1200,
    grenade: 2000,
  },
};
const WEIGH = `JSON.stringify((() => {
  const tris = (root) => { let n = 0; root.traverse((m) => { if (m.geometry) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return Math.round(n); };
  const G = __G, first = (type) => G.enemies.list.find((u) => u.type === type);
  const [carbine, pistol, shotgun, knife, grenade] = G.weapon.scene.children.map(tris);
  return { level: G.quality, world: G.world.stats.triangles, sentry: tris(first('sentry').model.root), drone: tris(first('drone').model.root), casing: tris(G.world.group.getObjectByName('cascade')), carbine, pistol, shotgun, knife, grenade };
})())`;

test('nothing is heavier than was agreed: the world and every model, on a phone and on a desk', async () => {
  for (const level of ['low', 'medium']) {
    const other = await another(`q=${level}&autostart=1&noaudio=1&dynres=0`);
    const weight = JSON.parse(await other.evaluate(WEIGH));
    assert.equal(weight.level, level);
    for (const [name, most] of Object.entries(CEILINGS[level])) {
      assert.ok(weight[name] <= most, `${level}: ${name} is ${weight[name]} triangles; the ceiling is ${most}`);
      // …and a ceiling that nothing comes near is no ceiling: each thing uses at least a third of its own
      assert.ok(weight[name] >= most / 3, `${level}: ${name} is only ${weight[name]} triangles of ${most}`);
    }
    // the three guns really are three models, not the carbine three times (weapon.js falls back to it)
    assert.ok(new Set([weight.carbine, weight.pistol, weight.shotgun]).size === 3, JSON.stringify(weight));
    assert.deepEqual(await other.problems(), []);
    await other.close();
  }
});

test('without the finishing passes (?post=0) the game still draws and plays: every material finishes itself', async () => {
  const plain = await another('post=0&autostart=1&noaudio=1&dynres=0');
  assert.equal(await plain.evaluate('window.__fatal || null'), null);
  assert.deepEqual(
    JSON.parse(await plain.evaluate('JSON.stringify([__G.view.post.enabled, __G.state, __G.mission.hostilesTotal])')),
    [false, 'playing', 15],
  );
  assert.ok((await plain.framesIn(1000)) >= 20, 'frames are being drawn');
  assert.ok((await plain.evaluate('__G.drawCalls')) >= 20, 'and the site is in them');
  assert.deepEqual(await plain.problems(), []);
  await plain.close();
});

// Decision of 12 November 2026 — the owner: "have you use nano banana to generate high quality assests for me".
// Until then every surface was painted in code. Ten of them are pictures now (src/assets/art, made by an image
// model and worked into tiles by tools/art); the painting is still there, and is what the game falls back on.
const PICTURES = [
  'asphalt',
  'concrete',
  'dirt',
  'door',
  'floorConcrete',
  'floorEpoxy',
  'hallWall',
  'rock',
  'wallPanel',
  'wear',
];

test('ten surfaces are pictures, loaded at the size the detail level asks for', async () => {
  const art = JSON.parse(await js('JSON.stringify(__G.art)'));
  assert.deepEqual(art.names, PICTURES);
  assert.deepEqual(art.failed, []);
  assert.equal(art.size, 512, 'medium detail asks for the 512-pixel pictures');
  // the rock that is drawn is the picture: far busier than the painted rock ever was
  const spread = await js(`(() => {
    const mesh = __G.world.group.children.find((m) => m.name === 'roof:rock');
    const c = mesh.material.uniforms.uMap.value.image;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sq = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; sum += l; sq += l * l; }
    const n = d.length / 4;
    return Math.sqrt(sq / n - (sum / n) ** 2);
  })()`);
  assert.ok(spread > 0.05, `the rock's picture has a spread of ${spread.toFixed(3)}: that is the painted one (0.024)`);
});

test('without the pictures (?art=0), or when none of them can be fetched, every surface is painted as before', async () => {
  for (const [query, failed] of [
    ['art=0', []],
    ['art=miss', PICTURES],
  ]) {
    const plain = await another(`${query}&autostart=1&noaudio=1&dynres=0`);
    assert.equal(await plain.evaluate('window.__fatal || null'), null, query);
    const art = JSON.parse(await plain.evaluate('JSON.stringify(__G.art)'));
    assert.deepEqual([art.names, art.failed], [[], failed], query);
    assert.equal(await plain.evaluate('__G.state'), 'playing', query);
    assert.ok((await plain.framesIn(1000)) >= 20, `${query}: frames are being drawn`);
    assert.ok((await plain.evaluate('__G.drawCalls')) >= 20, `${query}: and the site is in them`);
    // a picture that is not there is the browser's to complain about, and the only thing it may complain about
    const problems = (await plain.problems()).filter((p) => !/a-picture-that-is-not-there/.test(p));
    assert.deepEqual(problems, [], query);
    await plain.close();
  }
});

test('a device that cannot keep up gives the finishing passes up — after six seconds at the smallest picture, once, and for good', async () => {
  const slow = await another('autostart=1&noaudio=1&dynres=0');
  assert.equal(await slow.evaluate('__G.view.post.enabled'), true);
  // three seconds at the smallest picture is not enough…
  await slow.evaluate('__G.view.dynres.scale = __G.view.dynres.min; void 0');
  const t0 = await slow.evaluate('__G.time');
  await slow.waitFor(`__G.time > ${t0 + 3}`, { timeoutMs: 20000, label: 'three seconds' });
  assert.equal(await slow.evaluate('__G.view.post.enabled'), true, 'gone after only three seconds');
  // …and a moment of relief starts the count again
  await slow.evaluate('__G.view.dynres.scale = 1; void 0');
  await sleep(200);
  await slow.evaluate('__G.view.dynres.scale = __G.view.dynres.min; void 0');
  const t1 = await slow.evaluate('__G.time');
  await slow.waitFor(`__G.time > ${t1 + 4.5}`, { timeoutMs: 20000, label: 'four and a half seconds more' });
  assert.equal(await slow.evaluate('__G.view.post.enabled'), true, 'the count did not start again');
  await slow.waitFor('__G.view.post.enabled === false', { timeoutMs: 20000, label: 'the passes to be given up' });
  assert.ok((await slow.evaluate('__G.time')) - t1 >= 6, 'not before six seconds');
  // from then on the game draws straight to the screen, and having room again does not bring them back
  await slow.evaluate('__G.view.dynres.scale = 1; void 0');
  assert.ok((await slow.framesIn(1500)) >= 30, 'frames are still being drawn');
  assert.equal(await slow.evaluate('__G.view.post.enabled'), false, 'they came back');
  assert.deepEqual(
    (await slow.problems()).filter((line) => !/finishing passes switched off/.test(line)),
    [],
  );
  await slow.close();
});

test('nothing was logged as an error from start to finish', async () => {
  assert.deepEqual(await problems(), []);
});
