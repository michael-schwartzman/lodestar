// The health on the screen (src/ui/hud.js, src/ui/hud.css), in the built game on a desk.
//
// 18 November 2026 — the owner: "also add a health hud for the player". The game showed his health already: a
// bar six pixels high and a small number beside the word STAND. Nothing on it said health, and nobody would
// have looked for it there. Now it is a number as big as the rounds in the magazine, the word HEALTH under it
// and a bar that can be seen — and it says so when health is lost and when there is little left.
//
// (On a phone: test/phone.test.mjs, where the overlap tests at seven shapes hold it clear of every button.)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/harness.mjs';

let harness;
let page;

before(async () => {
  harness = await startHarness();
  page = await harness.browser.newPage();
  await page.navigate(`${harness.url}/?autostart=1&noaudio=1&dynres=0&touch=0`);
  await page.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 90000, label: 'the game to start' });
  assert.equal(await page.evaluate('window.__fatal || null'), null);
});

after(async () => {
  await harness?.stop();
});

const until = (expression, label, timeoutMs = 5000) => page.waitFor(expression, { timeoutMs, intervalMs: 50, label });
/** a mission begun, nobody about to shoot, the player whole */
const fresh = () => page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
/** health is lost as the game takes it: a hit from somewhere in front */
const hurt = (amount) => page.evaluate(`__G.player.damage(${amount}, __G.player.x, __G.player.z - 1); void 0`);
/** the flash is a moment long: every time it is put on is counted in the page, not looked for from here */
const watch = () =>
  page.evaluate(`(() => {
    if (window.__flashes !== undefined) return;
    const vital = document.querySelector('#hud .status .vital');
    window.__flashes = 0;
    let on = false;
    new MutationObserver(() => {
      const now = vital.classList.contains('hit');
      if (now && !on) window.__flashes++;
      on = now;
    }).observe(vital, { attributes: true, attributeFilter: ['class'] });
  })()`);
const flashes = () => page.evaluate('window.__flashes');
const read = async () =>
  JSON.parse(
    await page.evaluate(`JSON.stringify((() => {
      const q = (s) => document.querySelector('#hud .status ' + s);
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
      const vital = q('.vital'), hp = q('.vital .hp'), bar = q('.vital .bar.health'), fill = q('.vital .bar.health i');
      const css = getComputedStyle(hp);
      return {
        health: __G.player.health, text: hp.textContent, caption: q('.vital .count i').textContent,
        size: parseFloat(css.fontSize), colour: css.color, shown: css.visibility !== 'hidden' && +css.opacity > 0.5,
        bar: box(bar), filled: box(fill).w / (box(bar).w - 2), classes: [...vital.classList].filter((c) => c !== 'vital').sort(),
        stance: q('.stance').textContent, panel: box(document.querySelector('#hud .status')),
        mag: parseFloat(getComputedStyle(document.querySelector('#hud .ammo .mag')).fontSize),
        light: box(q('.bar.light')), screen: [innerWidth, innerHeight],
      };
    })())`),
  );

test('health is on the screen and says what it is: a number as big as the rounds in the magazine, the word, a bar', async () => {
  await fresh();
  await until('document.querySelector("#hud .status .vital .hp")?.textContent === "100"', 'a hundred to be shown');
  const r = await read();
  assert.equal(r.caption, 'HEALTH');
  assert.equal(r.shown, true);
  assert.ok(
    r.size >= 28 && r.size >= r.mag - 0.5,
    `the number is ${r.size} px high; the rounds in the magazine are ${r.mag}`,
  );
  // a bar that can be seen: three times as high as the one for the light, and most of the panel wide
  assert.ok(r.bar.h >= 9 && r.bar.h >= r.light.h * 2.5, `the bar is ${r.bar.h} px high, the light's ${r.light.h}`);
  assert.ok(r.bar.w >= 120, `the bar is ${r.bar.w} px wide`);
  assert.ok(Math.abs(r.filled - 1) < 0.02, `full: ${r.filled}`);
  assert.deepEqual(r.classes, [], 'whole: nothing is said of it');
  // where it was, bottom left, and all of it on the screen
  const [w, h] = r.screen;
  assert.ok(
    r.panel.x >= 0 && r.panel.right <= w / 2 && r.panel.y >= h / 2 && r.panel.bottom <= h,
    JSON.stringify(r.panel),
  );
  // the stance is still said — beside it, not in its place
  assert.equal(r.stance, 'STAND');
});

test('it follows what is lost, and says so: a flash when it goes, amber at sixty and under, red under thirty-five', async () => {
  await fresh();
  await until('document.querySelector("#hud .status .vital .hp")?.textContent === "100"', 'a hundred to be shown');
  await watch();
  const counted = await flashes();
  const settled = async () => {
    await until('!document.querySelector("#hud .status .vital").classList.contains("hit")', 'the flash to pass', 4000);
    return read();
  };
  // (no health comes back for five seconds after a hit: what is read here is what was left)
  await hurt(38);
  await until('document.querySelector("#hud .status .vital .hp").textContent === "62"', 'sixty-two to be shown');
  const lost = await settled();
  assert.equal(await flashes(), counted + 1, 'the moment it is lost, it says so');
  assert.ok(Math.abs(lost.filled - 0.62) < 0.04, `the bar: ${lost.filled}`);
  assert.deepEqual(lost.classes, [], 'at sixty-two it is not yet amber');
  await hurt(12);
  await until('document.querySelector("#hud .status .vital .hp").textContent === "50"', 'fifty to be shown');
  const half = await settled();
  assert.equal(await flashes(), counted + 2);
  assert.deepEqual(half.classes, ['warn']);
  assert.notEqual(half.colour, lost.colour, 'amber is not the colour it had');
  await hurt(20);
  await until('document.querySelector("#hud .status .vital .hp").textContent === "30"', 'thirty to be shown');
  const low = await settled();
  assert.equal(await flashes(), counted + 3);
  assert.deepEqual(low.classes, ['low']);
  assert.notEqual(low.colour, half.colour, 'red is not amber');
  assert.ok(Math.abs(low.filled - 0.3) < 0.04, `the bar: ${low.filled}`);
});

test('it comes back as health does, and is whole again', async () => {
  await fresh();
  await watch();
  await hurt(70);
  await until('document.querySelector("#hud .status .vital .hp").textContent === "30"', 'thirty to be shown');
  await until('!document.querySelector("#hud .status .vital").classList.contains("hit")', 'the flash to pass', 4000);
  const before = await flashes();
  // (the five seconds are skipped: the game is told the last hit was long ago)
  await page.evaluate('__G.player.sinceHit = 99; void 0');
  await until('document.querySelector("#hud .status .vital .hp").textContent === "100"', 'a hundred again', 15000);
  // (the bar's width is eased: it is given the time to arrive)
  await until(
    '(() => { const b = document.querySelector("#hud .status .vital .bar.health"), i = b.querySelector("i"); return i.getBoundingClientRect().width >= (b.getBoundingClientRect().width - 2) * 0.98; })()',
    'the bar to be full',
    4000,
  );
  const whole = await read();
  assert.deepEqual(whole.classes, []);
  assert.equal(await flashes(), before, 'health coming back is not a hit');
});

test('crouched, the word beside it says so', async () => {
  await fresh();
  await page.holdKey('KeyC', 'c', 67, 120);
  await until('document.querySelector("#hud .status .stance").textContent === "CROUCH"', 'CROUCH to be said');
  await page.holdKey('KeyC', 'c', 67, 120);
  await until('document.querySelector("#hud .status .stance").textContent === "STAND"', 'STAND to be said');
  const errors = JSON.parse(
    await page.evaluate('JSON.stringify((window.__errors || []).concat(window.__rejections || []))'),
  );
  assert.deepEqual(errors, []);
});
