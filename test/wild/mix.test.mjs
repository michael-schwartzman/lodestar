// The room in the sound, in the built game with sound on (src/wild/mix.js holds its rules and arithmetic,
// test/unit/wild-mix.test.mjs holds them to their numbers): the space follows the listener, what happens in the
// site is sent round it and the menus are not — and it is HEARD: a shot in the cavern rings on, a shot in a room
// does not.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SPACES } from '../../src/wild/mix.js';
import { openWith, startWild } from './helpers.mjs';

let harness;
let page;
let open;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
  page = await open('look=1&dynres=0&touch=0&autostart=1');
  // sound runs from the first key or click (the game's own rule); M opens and shuts the map, and changes nothing
  await page.press('KeyM');
  await page.press('KeyM');
  await page.until('__G.audio.state === "running"', 'sound to be running', 10000);
  await page.until('__G.wild.feature("mix").state.built === true', 'the spaces to be built', 10000);
});

after(async () => {
  await harness?.stop();
});

const mix = '__G.wild.feature("mix")';

test('the space is the one the listener stands in: the adit a tunnel, the cavern the cavern, the hall a hall, a corridor a room, the forecourt the open air', async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  for (const [x, z, want, where] of [
    [9.5, 67, 'tunnel', 'where the mission begins, in the drainage adit'],
    [62.5, 68.5, 'cave', 'the main cavern'],
    [47.5, 30.5, 'hall', 'the cascade hall'],
    [60.5, 44.5, 'room', 'the service corridor'],
    [64, 92.5, 'open', 'the forecourt, under the sky'],
  ]) {
    await page.evaluate(`__G.debug.teleport(${x}, ${z}, 0); void 0`);
    await page.until(`${mix}.state.space === "${want}"`, `${where} to be heard as ${want}`, 5000);
  }
});

test('what happens in the site is sent round the space; the menus and the radio are not', async () => {
  // (18 November 2026: counted in one step, with no waiting between. A send is counted in the same step as the
  // sound that causes it, and the site makes sounds of its own — a drip in the cavern — which, with eighty
  // milliseconds of waiting on a machine under load, was once counted as a menu's.)
  const counted = await page.json(`(() => {
      const G = __G, f = G.wild.feature('mix'), p = G.player;
      const a = f.state.sends;
      G.audio.play('uiSelect'); G.audio.play('radio'); G.audio.play('hitMarker');
      const b = f.state.sends;
      G.audio.play('hitWall', { x: p.x + 4, y: 1.5, z: p.z });
      G.audio.play('explosion', { x: p.x + 9, y: 1.5, z: p.z });
      return { menus: b - a, site: f.state.sends - b };
    })()`);
  assert.deepEqual(counted, { menus: 0, site: 2 });
});

test('it is heard: the carbine’s shot rings on in the cavern for seconds, and in a room is over in a moment', async () => {
  // the game's own shot, laid through what each space does to a sound — worked out off to one side, as the engine
  // does it while the game is played — and how much of it is still sounding a second after the trigger
  const rings = JSON.parse(
    await page.evaluate(`(async () => {
      const G = __G, f = G.wild.feature('mix'), shot = G.audio.debugBuffers().sounds.get('shot')[0];
      const out = {};
      for (const space of ${JSON.stringify(Object.keys(SPACES))}) {
        // (at the engine's own rate: what a space does is built for the clock the game's sound runs on)
        const rate = f.answer(space).sampleRate;
        const offline = new OfflineAudioContext(2, rate * 4, rate);
        const source = offline.createBufferSource();
        source.buffer = shot;
        const room = offline.createConvolver();
        room.normalize = false;
        room.buffer = f.answer(space);
        source.connect(room).connect(offline.destination);
        source.start(0);
        const heard = await offline.startRendering();
        const data = heard.getChannelData(0);
        const rms = (from, to) => { let sum = 0; for (let i = Math.round(from * rate); i < Math.round(to * rate); i++) sum += data[i] * data[i]; return Math.sqrt(sum / ((to - from) * rate)); };
        out[space] = { early: rms(0, 0.3), late: rms(1, 2) };
      }
      // the shot itself, over its own first three tenths of a second
      let dry = 0; const d = shot.getChannelData(0), n = Math.round(0.3 * shot.sampleRate); for (let i = 0; i < n; i++) dry += d[i] * d[i];
      out.dry = Math.sqrt(dry / n);
      return JSON.stringify(out);
    })()`),
  );
  const db = (a, b) => 20 * Math.log10(a / b);
  // in the cavern a second later it is still there — within 30 dB of the shot itself; in a room it is gone
  assert.ok(
    db(rings.cave.late, rings.dry) > -30,
    `the cavern, a second on: ${db(rings.cave.late, rings.dry).toFixed(1)} dB`,
  );
  assert.ok(
    db(rings.room.late, rings.dry) < -70,
    `a room, a second on: ${db(rings.room.late, rings.dry).toFixed(1)} dB`,
  );
  assert.ok(db(rings.cave.late, rings.hall.late) > 3, 'the hall rings as long as the cavern');
  assert.ok(db(rings.hall.late, rings.tunnel.late) > 3, 'a tunnel rings as long as the hall');
  // and each space answers at once with about as much as it was sent
  for (const space of Object.keys(SPACES))
    assert.ok(
      db(rings[space].early, rings.dry) > -12 && db(rings[space].early, rings.dry) < 9,
      `${space}: ${db(rings[space].early, rings.dry).toFixed(1)} dB`,
    );
});

test('with the switch off no mix is set: the engine is the one it was', async () => {
  const off = await open('look=1&dynres=0&touch=0&autostart=1&wild=0');
  await off.press('KeyM');
  await off.press('KeyM');
  await off.until('__G.audio.state === "running"', 'sound to be running', 10000);
  assert.equal(await off.evaluate('__G.audio.setMix(null)'), null);
  assert.equal(await off.evaluate('__G.audio.setScore(null)'), null);
  assert.deepEqual(await off.problems(), []);
  assert.deepEqual(await page.problems(), []);
});
