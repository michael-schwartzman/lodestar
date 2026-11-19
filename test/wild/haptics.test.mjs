// Haptics, in the built game (src/wild/haptics.js holds the rules and their numbers, tested without a browser in
// test/unit/wild-haptics.test.mjs; src/wild/haptics-live.js joins them to the game): what a real shot, a real
// hurt and a real blast ask of `navigator.vibrate`, the Settings row that turns it off, and what an iPhone sees
// instead of any of this.
//
// A CDP page's own helper (test/wild/helpers.mjs `openWith`) cannot put a stub on `navigator.vibrate` before the
// game's first script runs — only once the page says `window.__ready`, which is after the feature has already
// been built. So every test here defines its stub AFTER that, and the feature is written to match: it looks
// `navigator.vibrate` up fresh each time it might ask for a buzz (src/wild/haptics-live.js, `canVibrate`), never
// once at the top. The same is true the other way around: making the real API go away for a test has to be
// `navigator.vibrate = undefined` and not `delete navigator.vibrate` — Chromium puts the method on
// `Navigator.prototype`, not on the `navigator` instance itself, so `delete` finds nothing there to remove.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PLAY, openWith, sleep, startWild } from './helpers.mjs';

let harness;
let open;
let page;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
  page = await open(PLAY);
});

after(async () => {
  await harness?.stop();
});

const haptics = '__G.wild.feature("haptics")';
/** records every call this page's game makes to `navigator.vibrate`, from here on */
const recordVibrate = (p) =>
  p.evaluate(`(() => {
    window.__vib = [];
    navigator.vibrate = (pattern) => { window.__vib.push(pattern); return true; };
  })()`);
const mouse = (p, type) => p.send('Input.dispatchMouseEvent', { type, x: 640, y: 360, button: 'left', clickCount: 1 });
/** one round from the player's own gun — a press and a release close enough together to be one shot, not a burst */
async function fireOnce(p = page) {
  await mouse(p, 'mousePressed');
  await sleep(60);
  await mouse(p, 'mouseReleased');
}

test('a real round from the player’s own gun ticks once; being hit ticks once; the hall going up overrides both — and once its own feeling has run its course, a lesser one ticks again', async () => {
  await recordVibrate(page);
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  assert.equal(await page.evaluate('__G.weapon.current'), 'carbine');

  await fireOnce();
  await page.until(`${haptics}.state.last && ${haptics}.state.last.kind === 'carbine'`, 'the carbine to tick', 4000);
  assert.deepEqual(await page.json('window.__vib'), [10]);

  await page.evaluate('__G.wild.emit("hurt"); void 0');
  assert.deepEqual(await page.json('window.__vib'), [10, [70]]);

  // the cascades, right where the hall is: full strength, nothing between the player and the blast
  await page.evaluate('__G.debug.teleport(51, 29, 0); __G.wild.emit("blast"); void 0');
  assert.deepEqual(await page.json('window.__vib'), [10, [70], [200, 60, 200, 60, 300]]);

  // a lesser kind, asked for while the blast is still playing (its own ~820 ms are nowhere near up): dropped
  await page.evaluate(`${haptics}.buzz('carbine', 1); void 0`);
  assert.equal(await page.json('window.__vib.length'), 3, 'a tick during the blast must not be felt');

  // …but reachable all the same — `ctx.buzz` and the feature's own `buzz` are the one door (src/wild/index.js)
  assert.equal(await page.evaluate(`typeof ${haptics}.buzz`), 'function');
  await sleep(850); // past the blast's own length: the motor is free again
  await page.evaluate(`${haptics}.buzz('land', 1); void 0`);
  assert.deepEqual(await page.json('window.__vib'), [10, [70], [200, 60, 200, 60, 300], 15]);
  assert.deepEqual(await page.problems(), []);
});

test('before the player has touched the page nothing is asked of the browser, which would refuse it and log an error; after, it is', async () => {
  // (18 November 2026, at the merge: Chromium answers a vibration asked for before any tap with "Blocked call to
  // navigator.vibrate because user hasn't tapped on the frame" — an error in the console, once a call. A fight
  // staged by a test, or a player hit before their first tap, filled the console with it.)
  const fresh = await open(PLAY);
  await fresh.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  // the browser's own `navigator.vibrate`, not a stand-in: what it logs is the point
  for (let i = 0; i < 3; i++) await fresh.evaluate('__G.wild.emit("hurt"); void 0');
  await sleep(200);
  assert.equal(await fresh.json(`${haptics}.state.count`), 0, 'nothing was asked for');
  assert.deepEqual(await fresh.problems(), []);
  // a real press of the mouse: the page has been touched
  await fireOnce(fresh);
  await sleep(300);
  await fresh.evaluate('__G.wild.emit("hurt"); void 0');
  assert.equal(await fresh.json(`${haptics}.state.last.kind`), 'hurt');
  assert.deepEqual(await fresh.problems(), []);
  await fresh.close();
});

test('what the other features ask to be felt arrives: a wave on its way, a visor cracked, and feet coming down hard', async () => {
  // (18 November 2026, at the merge: the kinds this feature left for whoever causes them)
  await recordVibrate(page);
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; void 0');
  // (a press of the mouse, so that this test stands by itself: the page has been touched)
  await fireOnce();
  await sleep(900);
  const last = () => page.json(`${haptics}.state.last && ${haptics}.state.last.kind`);
  // machines are sent for an alarm (src/wild/response-live.js)
  await page.evaluate('__G.wild.feature("response").respond("alarm", { x: 60, z: 44 }); void 0');
  assert.equal(await last(), 'wave');
  await sleep(250);
  // the first round to a sentry's head (src/wild/visor-live.js, asked as weapon.js asks it)
  await page.evaluate(
    '__G.wild.plate({ unit: __G.enemies.list.find((u) => u.type === "sentry" && !u.dead), zone: "head", multiplier: 3, t: 5 }); void 0',
  );
  assert.equal(await last(), 'visor');
  await sleep(250);
  // a drop of four metres, out under the sky: the feet come down at ten metres a second, and it is felt in full
  await page.evaluate(
    '{ __G.debug.teleport(64.5, 90.5, 0); const p = __G.player; p.y = 4; p.vy = 0; p.grounded = false; }',
  );
  await page.until('__G.player.grounded === true', 'to land', 5000);
  await page.until(`${haptics}.state.last.kind === 'land'`, 'the landing to be felt', 2000);
  assert.deepEqual(await page.json('window.__vib.slice(-3)'), [[30, 50, 30], 22, 15]);
  // …and a step off a kerb is not
  const count = await page.json(`${haptics}.state.count`);
  await sleep(250);
  await page.evaluate('{ const p = __G.player; p.y = 0.3; p.vy = 0; p.grounded = false; }');
  await page.until('__G.player.grounded === true', 'to land', 5000);
  await sleep(150);
  assert.equal(await page.json(`${haptics}.state.count`), count);
  assert.deepEqual(await page.problems(), []);
});

test('`?haptics=0`: there is no feature at all, and nothing this page does ever asks the browser to vibrate', async () => {
  const off = await open(`${PLAY}&haptics=0`);
  await recordVibrate(off);
  await off.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  assert.equal(await off.evaluate(`${haptics}`), null);
  await off.evaluate('__G.debug.teleport(51, 29, 0); __G.wild.emit("hurt"); __G.wild.emit("blast"); void 0');
  await fireOnce(off);
  await sleep(150);
  assert.deepEqual(await off.json('window.__vib'), []);
  assert.deepEqual(await off.problems(), []);
  await off.close();
});

test('without `navigator.vibrate` nothing throws, and the Settings row says so, disabled — on a phone, in the owner’s own words for the one he carries', async () => {
  const desk = await open(PLAY);
  await desk.evaluate('navigator.vibrate = undefined; void 0');
  await desk.evaluate('__G.menus.show("settings"); void 0');
  const row = (p) =>
    p.json(`(() => {
      const row = [...document.querySelectorAll('.m-row')].find((r) => r.querySelector('.m-row__label')?.textContent === 'Haptics');
      const btn = row.querySelector('[role=switch]');
      return { disabled: btn.disabled, hint: row.querySelector('.m-row__hint')?.textContent || null };
    })()`);
  assert.deepEqual(await row(desk), { disabled: true, hint: 'not available in this browser' });
  assert.deepEqual(await desk.problems(), []);
  await desk.close();

  // the phone he actually has: `G.touch` is true, the same as his — and the one line that names what Safari does
  const phone = await open(`${PLAY.replace('touch=0', 'touch=1')}`);
  await phone.evaluate('navigator.vibrate = undefined; void 0');
  await phone.evaluate('__G.menus.show("settings"); void 0');
  assert.deepEqual(await row(phone), {
    disabled: true,
    hint: 'Safari on iPhone does not let a web page vibrate',
  });
  assert.deepEqual(await phone.problems(), []);
  await phone.close();
});

test('the Settings row turns it off, is remembered in storage across a reload, and nothing vibrates while it is off — then turned back on, it says so with one tick', async () => {
  const query = `${PLAY}&haptics=1`; // (its own page: the toggling here must not disturb the shared `page` above)
  let p = await open(query);
  await recordVibrate(p);
  await p.evaluate('__G.menus.show("settings"); void 0');
  const click = () =>
    p.evaluate(`(() => {
      const row = [...document.querySelectorAll('.m-row')].find((r) => r.querySelector('.m-row__label')?.textContent === 'Haptics');
      row.querySelector('[role=switch]').click();
    })()`);
  const switchState = () =>
    p.json(`(() => {
      const row = [...document.querySelectorAll('.m-row')].find((r) => r.querySelector('.m-row__label')?.textContent === 'Haptics');
      const b = row.querySelector('[role=switch]');
      return { on: b.classList.contains('is-on'), checked: b.getAttribute('aria-checked') };
    })()`);
  assert.deepEqual(await switchState(), { on: true, checked: 'true' }, 'on by default: no choice stored yet');

  await click();
  assert.deepEqual(await switchState(), { on: false, checked: 'false' });
  assert.equal(await p.evaluate('localStorage.getItem("lodestar.haptics.v1")'), '0');
  await p.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await fireOnce();
  await sleep(200);
  assert.deepEqual(await p.json('window.__vib'), [], 'off is off: the gun still fires, nothing is felt');
  assert.deepEqual(await p.problems(), []);

  // the same page, loaded again — the choice is the storage's, not this tab's own memory of it
  await p.navigate(`${harness.url}/?${query}`);
  await p.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 120000, label: 'the game to start' });
  await recordVibrate(p);
  await p.evaluate('__G.menus.show("settings"); void 0');
  assert.deepEqual(await switchState(), { on: false, checked: 'false' }, 'remembered after the reload');

  // turned back on: one short tick says so, at once — not gated on a mission being played
  await click();
  assert.deepEqual(await switchState(), { on: true, checked: 'true' });
  assert.deepEqual(await p.json('window.__vib'), [20], 'felt it took');
  assert.equal(await p.evaluate('localStorage.getItem("lodestar.haptics.v1")'), '1');
  assert.deepEqual(await p.problems(), []);
  await p.close();
});

// ---------- at a phone's shape (see test/wild/dress.test.mjs `openPhone`: not exported, so copied here) ----------

async function openPhone(query, [width, height] = [844, 390]) {
  const p = await harness.browser.newPage();
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.navigate(`${harness.url}/?${query}`);
  await p.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 120000, label: 'the game to start' });
  assert.equal(await p.evaluate('window.__fatal || null'), null);
  p.json = async (expression) => JSON.parse(await p.evaluate(`JSON.stringify(${expression})`));
  p.problems = async () => [
    ...JSON.parse(await p.evaluate('JSON.stringify((window.__errors || []).concat(window.__rejections || []))')),
    ...p.exceptions,
    ...p.logErrors,
    ...p.console.filter((m) => m.type === 'error').map((m) => m.text),
  ];
  return p;
}

test('at a phone’s shape (844 × 390) the Haptics row sits inside its panel, as wide as the panel and no wider', async () => {
  const p = await openPhone('look=1&touch=1&autostart=1&noaudio=1&dynres=0');
  await p.evaluate('__G.menus.show("settings"); void 0');
  const fit = await p.json(`(() => {
    const row = [...document.querySelectorAll('.m-row')].find((r) => r.querySelector('.m-row__label')?.textContent === 'Haptics');
    const body = document.querySelector('.m-panel__body');
    const r = row.getBoundingClientRect(), b = body.getBoundingClientRect();
    return { row: r.width, body: b.width, within: r.left >= b.left - 1 && r.right <= b.right + 1 };
  })()`);
  assert.ok(fit.row <= fit.body + 1, `the row is ${fit.row}px in a panel of ${fit.body}px`);
  assert.equal(fit.within, true, 'the row must not run past either edge of its panel');
  assert.deepEqual(await p.problems(), []);
});
