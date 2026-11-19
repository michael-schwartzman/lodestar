// Contract lock: the game on a phone. Every rule in docs/DESIGN.md §7 ("Phone rules" and "What each finger
// becomes") is pinned here against the built game, at a phone's pixel ratio, with real touch events.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sleep } from '../tools/lib/browser.mjs';
import { startHarness } from './helpers/harness.mjs';

// width × height in CSS pixels, and what the phone keeps for itself: top, right, bottom, left
const SIDEWAYS = [
  [874, 338, [0, 62, 21, 62]],
  [874, 296, [0, 62, 21, 62]],
  [874, 402, [0, 62, 21, 62]],
  [844, 340, [0, 47, 21, 47]],
  [932, 430, [0, 59, 21, 59]],
  [667, 331, [0, 0, 0, 0]],
];
const UPRIGHT = [402, 714, [62, 0, 34, 0]];

let harness;

async function openPhone([width, height, insets], query = 'touch=1&autostart=1&noaudio=1&dynres=0', quiet = false) {
  const page = await harness.browser.newPage();
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (quiet)
    // registered before any of the game's scripts, so it runs first and the game never hears a `resize`
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        'window.addEventListener("resize", (e) => e.stopImmediatePropagation(), true); window.visualViewport?.addEventListener("resize", (e) => e.stopImmediatePropagation(), true);',
    });
  await page.navigate(`${harness.url}/?${query}`);
  await page.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 90000, label: 'the game to start' });
  assert.equal(await page.evaluate('window.__fatal || null'), null);
  await setInsets(page, insets);
  page.size = { width, height };
  return page;
}

const setInsets = (page, [t, r, b, l]) =>
  page.evaluate(
    `(() => { const s = document.documentElement.style; s.setProperty('--sat', '${t}px'); s.setProperty('--sar', '${r}px'); s.setProperty('--sab', '${b}px'); s.setProperty('--sal', '${l}px'); })()`,
  );

async function reshape(page, [width, height, insets]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
  await setInsets(page, insets);
  page.size = { width, height };
  await sleep(350);
}

const touch = (page, type, points) =>
  page.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })),
  });
const fingers = (page) => page.evaluate('JSON.stringify(__G.input.debug())').then(JSON.parse);
const centre = (page, selector) =>
  page
    .evaluate(
      `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`,
    )
    .then(JSON.parse);
const until = (page, expression, label, timeoutMs = 8000) =>
  page.waitFor(expression, { timeoutMs, intervalMs: 60, label });
const calm = (page) =>
  page.evaluate('__G.debug.start(); __G.debug.clearSite(); __G.debug.teleport(64.5, 70.5, 0); void 0');

/** Every control and every panel that is on screen, as rectangles. */
const BOXES = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('#touch [data-btn], #hud [data-hud]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') continue;
    out.push({ name: el.dataset.btn || el.dataset.hud, left: r.left, top: r.top, right: r.right, bottom: r.bottom, button: !!el.dataset.btn });
  }
  return JSON.stringify(out);
})()`;

function overlaps(boxes) {
  const found = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0.5 && h > 0.5) found.push(`${a.name} × ${b.name} (${w.toFixed(0)} × ${h.toFixed(0)} px)`);
    }
  return found;
}

/**
 * Puts everything that can be on screen on screen: both of the buttons that only appear when there is something
 * to do (USE and SHIELD: a sentry stands a step ahead with its back turned), a radio line, the alarm banner,
 * contacts.
 */
async function crowd(page) {
  await page.evaluate(`(() => {
    __G.debug.start();
    const e = __G.enemies, keep = e.byName('gate');
    e.remove(e.list.filter((u) => u !== keep).map((u) => u.rollId));
    // facing north-west: the longest word the readout has to fit
    const yaw = Math.PI / 4;
    __G.debug.teleport(64.5, 70.5, yaw);
    const x = 64.5 - Math.sin(yaw) * 1.4, z = 70.5 - Math.cos(yaw) * 1.4;
    Object.assign(keep, { x, z, yaw, postYaw: yaw, route: [[Math.floor(x), Math.floor(z)]], routeI: 0, path: null, goalX: -1 });
    __G.hud.radio('OVERWATCH', 'Site is clear and rigged. Get the lodestar up on the pad under the exhaust shaft, and do not stop for anything.', 60);
    __G.enemies.alarm.active = true; __G.enemies.alarm.timeLeft = 40;
    // three machines after you, so that the readout under the small map is as long as it gets
    __G.player.hidden = true;
    __G.enemies.pursue(__G.site.reinforcements.slice(0, 3), __G.player);
  })()`);
  await until(
    page,
    '!document.querySelector(\'#touch [data-btn="use"]\').hidden && !document.querySelector(\'#touch [data-btn="grab"]\').hidden && !document.querySelector("#hud .banner").hidden && document.querySelector("#hud .bearing .more").textContent !== ""',
    'the crowded screen',
  );
  await sleep(120);
}

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness?.stop();
});

test('the title stays where the thumbs are not: down the left edge sideways, across the top upright — never centred, as a desk’s is', async () => {
  // 16 November 2026: on a desk the title went to the middle of the screen (test/smoke.test.mjs). A phone's did
  // not: sideways, the middle of the screen is where the picture of the site is, and the right is the thumb's.
  const page = await openPhone(SIDEWAYS[0], 'touch=1&noaudio=1&dynres=0');
  const read = () =>
    page
      .evaluate(
        `(() => { const b = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left, r.right]; }; return JSON.stringify({ w: innerWidth, screen: document.querySelector('#menus').dataset.screen, list: b('.m-menu-list'), col: b('.m-title-col') }); })()`,
      )
      .then(JSON.parse);
  const sideways = await read();
  assert.equal(sideways.screen, 'title');
  assert.ok(sideways.col[0] < 1, 'the title column has left the left edge');
  assert.ok(sideways.list[1] < sideways.w * 0.45, `the buttons reach ${sideways.list[1]} px of ${sideways.w}`);
  await reshape(page, UPRIGHT);
  const upright = await read();
  assert.ok(upright.col[0] < 1 && upright.col[1] > upright.w - 1, 'upright, the column is the width of the screen');
  await page.close();
});

test('held sideways: no control or panel overlaps another, at six phone shapes', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  for (const shape of SIDEWAYS) {
    await reshape(page, shape);
    await crowd(page);
    const boxes = JSON.parse(await page.evaluate(BOXES));
    const names = boxes.map((b) => b.name);
    for (const need of [
      'fireL',
      'fireR',
      'aim',
      'jump',
      'reload',
      'crouch',
      'use',
      'grab',
      'swap',
      'emp',
      'nv',
      'pause',
      'compass',
      'minimap',
      'bearing',
      'status',
      'ammo',
      'radio',
    ])
      assert.ok(names.includes(need), `${shape[0]}×${shape[1]}: ${need} is not on screen`);
    assert.deepEqual(overlaps(boxes), [], `${shape[0]}×${shape[1]}`);
    // the readout under the small map is at its fullest: the way you face, the next thing to do, two contacts
    // and a count of the rest — and every line of it is inside its box
    const readout = JSON.parse(
      await page.evaluate(
        `(() => { const box = document.querySelector('#hud .bearing'); const r = box.getBoundingClientRect(); return JSON.stringify([...box.children].filter((el) => el.textContent).map((el) => { const q = el.getBoundingClientRect(); return { text: el.textContent, inside: q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5, fits: el.scrollWidth <= el.clientWidth + 1 }; })); })()`,
      ),
    );
    assert.equal(readout.length, 5, `${shape[0]}×${shape[1]}: ${JSON.stringify(readout.map((line) => line.text))}`);
    for (const line of readout)
      assert.ok(line.inside && line.fits, `${shape[0]}×${shape[1]}: "${line.text}" does not fit under the small map`);
  }
  await page.close();
});

test('held sideways: everything is on screen, clear of the notch and the home bar, and big enough to hit', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  for (const shape of SIDEWAYS) {
    const [width, height, [t, r, b, l]] = shape;
    await reshape(page, shape);
    await crowd(page);
    for (const box of JSON.parse(await page.evaluate(BOXES))) {
      const where = `${width}×${height}: ${box.name}`;
      assert.ok(
        box.left >= l - 0.5 && box.right <= width - r + 0.5,
        `${where} is under the notch (${box.left.toFixed(0)}…${box.right.toFixed(0)})`,
      );
      assert.ok(
        box.top >= t - 0.5 && box.bottom <= height - b + 0.5,
        `${where} is under the home bar (${box.top.toFixed(0)}…${box.bottom.toFixed(0)})`,
      );
      if (box.button)
        assert.ok(box.right - box.left >= 40 && box.bottom - box.top >= 40, `${where} is too small to hit`);
    }
  }
  await page.close();
});

test('held upright: the same two rules hold', async () => {
  const page = await openPhone(UPRIGHT);
  await crowd(page);
  const [width, height, [t, r, b, l]] = UPRIGHT;
  const boxes = JSON.parse(await page.evaluate(BOXES));
  assert.deepEqual(overlaps(boxes), []);
  for (const box of boxes) {
    assert.ok(box.left >= l - 0.5 && box.right <= width - r + 0.5, `${box.name} is off the side`);
    assert.ok(box.top >= t - 0.5 && box.bottom <= height - b + 0.5, `${box.name} is under the notch or the home bar`);
  }
  await page.close();
});

test('health says what it is on a phone: the word, a number bigger than the words, a bar thicker than the light’s', async () => {
  // (18 November 2026 — the owner: "add a health hud for the player". It was there: a hairline of a bar beside
  // the word STAND. On a desk it is now as big as the rounds in the magazine — test/hud.test.mjs; on a phone
  // there is no room for that under the left FIRE, and the two tests above hold what there is clear of it.)
  const page = await openPhone(SIDEWAYS[2]);
  for (const shape of [SIDEWAYS[2], SIDEWAYS[1], SIDEWAYS[5], UPRIGHT]) {
    await reshape(page, shape);
    await calm(page);
    await page.evaluate('__G.player.hidden = true; __G.player.damage(38, __G.player.x, __G.player.z - 1); void 0');
    await until(
      page,
      'document.querySelector("#hud .status .vital .hp").textContent === "62"',
      'sixty-two to be shown',
    );
    // (the bar's width is eased to its new place: it is given the time to get there)
    await until(
      page,
      '(() => { const b = document.querySelector("#hud .status .vital .bar.health"); return Math.abs(b.querySelector("i").getBoundingClientRect().width / (b.getBoundingClientRect().width - 2) - 0.62) < 0.05; })()',
      'the bar to follow',
      4000,
    );
    const r = JSON.parse(
      await page.evaluate(`JSON.stringify((() => {
        const q = (s) => document.querySelector('#hud .status ' + s);
        const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
        const shown = (el) => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 1 && b.height > 1; };
        const word = q('.vital .count i'), hp = q('.vital .hp'), bar = q('.vital .bar.health');
        return { word: word.textContent, wordShown: shown(word), wordBox: box(word), wordSize: parseFloat(getComputedStyle(word).fontSize),
          hp: box(hp), size: parseFloat(getComputedStyle(hp).fontSize), bar: box(bar), filled: box(bar.querySelector('i')).w / (box(bar).w - 2),
          light: box(q('.bar.light')), panel: box(document.querySelector('#hud .status')) };
      })())`),
    );
    const where = `${shape[0]}×${shape[1]}`;
    assert.equal(r.word, 'HEALTH', where);
    assert.equal(r.wordShown, true, `${where}: the word is not shown`);
    assert.ok(
      r.size >= 14 && r.size >= r.wordSize * 1.4,
      `${where}: the number is ${r.size} px, the word ${r.wordSize}`,
    );
    assert.ok(
      r.bar.h >= 7 && r.bar.h >= r.light.h * 2,
      `${where}: the bar is ${r.bar.h} px high, the light's ${r.light.h}`,
    );
    assert.ok(r.bar.w >= 44, `${where}: the bar is ${r.bar.w} px wide`);
    assert.ok(Math.abs(r.filled - 0.62) < 0.05, `${where}: the bar is ${r.filled} full at 62`);
    for (const [name, b] of [
      ['the word', r.wordBox],
      ['the number', r.hp],
      ['the bar', r.bar],
    ])
      assert.ok(
        b.left >= r.panel.left - 0.5 &&
          b.right <= r.panel.right + 0.5 &&
          b.top >= r.panel.top - 0.5 &&
          b.bottom <= r.panel.bottom + 0.5,
        `${where}: ${name} is outside its panel`,
      );
  }
  await page.close();
});

test('FIRE is on both sides unless the player picks one', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  const shown = () =>
    page
      .evaluate(
        'JSON.stringify(["fireL", "fireR"].map((n) => getComputedStyle(document.querySelector(`#touch [data-btn="${n}"]`)).display !== "none"))',
      )
      .then(JSON.parse);
  assert.deepEqual(await shown(), [true, true]);
  await page.evaluate('__G.settings.set("fireButton", "left")');
  assert.deepEqual(await shown(), [true, false]);
  await page.evaluate('__G.settings.set("fireButton", "right")');
  assert.deepEqual(await shown(), [false, true]);
  await page.evaluate('__G.settings.set("fireButton", "both")');
  assert.deepEqual(await shown(), [true, true]);
  await page.close();
});

test('the page never zooms or scrolls under the game', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  const facts = JSON.parse(
    await page.evaluate(`JSON.stringify({
      app: getComputedStyle(document.querySelector('#app')).touchAction,
      view: getComputedStyle(document.querySelector('#view')).touchAction,
      fire: getComputedStyle(document.querySelector('#touch [data-btn="fireR"]')).touchAction,
      scrollable: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
      gesture: (() => { const e = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })(),
      doubleClick: (() => { const e = new MouseEvent('dblclick', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })(),
    })`),
  );
  assert.deepEqual(facts, {
    app: 'none',
    view: 'none',
    fire: 'none',
    scrollable: false,
    gesture: true,
    doubleClick: true,
  });
  // two fingers pulled apart on the view: a pinch
  await touch(page, 'touchStart', [[500, 160, 0]]);
  await touch(page, 'touchStart', [
    [500, 160, 0],
    [560, 160, 1],
  ]);
  for (let k = 1; k <= 6; k++)
    await touch(page, 'touchMove', [
      [500 - k * 15, 160, 0],
      [560 + k * 15, 160, 1],
    ]);
  await touch(page, 'touchEnd', []);
  assert.equal(await page.evaluate('window.visualViewport.scale'), 1);
  assert.equal(await page.evaluate('window.scrollY + window.scrollX'), 0);
  await page.close();
});

test('a finger on the left becomes the stick; a finger on the right turns the view; a third does nothing', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const start = JSON.parse(await page.evaluate('JSON.stringify({ z: __G.player.z, yaw: __G.player.yaw })'));

  await touch(page, 'touchStart', [[150, 220, 0]]);
  await touch(page, 'touchMove', [[150, 160, 0]]);
  let f = await fingers(page);
  assert.equal(f.stick, true);
  assert.ok(f.stickY > 0.95, 'pushed up = forward');
  await until(page, `__G.player.z < ${start.z - 0.6}`, 'the player to walk north');

  await touch(page, 'touchStart', [
    [150, 160, 0],
    [600, 150, 1],
  ]);
  await touch(page, 'touchMove', [
    [150, 160, 0],
    [700, 150, 1],
  ]);
  f = await fingers(page);
  assert.deepEqual([f.stick, f.look, f.fire], [true, true, false]);
  await until(page, `__G.player.yaw < ${start.yaw - 0.2}`, 'the view to turn right');

  // a third finger on the view is nobody
  await touch(page, 'touchStart', [
    [150, 160, 0],
    [700, 150, 1],
    [420, 250, 2],
  ]);
  const yaw = await page.evaluate('__G.player.yaw');
  await touch(page, 'touchMove', [
    [150, 160, 0],
    [700, 150, 1],
    [300, 100, 2],
  ]);
  await sleep(120);
  assert.ok(Math.abs((await page.evaluate('__G.player.yaw')) - yaw) < 1e-6);

  await touch(page, 'touchEnd', []);
  await sleep(250);
  f = await fingers(page);
  assert.deepEqual([f.stick, f.look], [false, false]);
  const z = await page.evaluate('__G.player.z');
  await sleep(400);
  assert.ok(Math.abs((await page.evaluate('__G.player.z')) - z) < 0.15, 'letting go of the stick stops the walk');
  await page.close();
});

test('right FIRE: holds the trigger, and sliding off it aims without letting go', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const [x, y] = await centre(page, '#touch [data-btn="fireR"]');
  await touch(page, 'touchStart', [[x, y, 0]]);
  await until(page, '__G.weapon.shots >= 2', 'rounds to go');
  assert.equal(await page.evaluate('document.querySelector("#touch").classList.contains("firing")'), true);
  const yaw = await page.evaluate('__G.player.yaw');
  for (let k = 1; k <= 6; k++) await touch(page, 'touchMove', [[x - k * 15, y - k * 4, 0]]);
  await until(page, `__G.player.yaw > ${yaw + 0.25}`, 'the view to turn left');
  const shots = await page.evaluate('__G.weapon.shots');
  await until(page, `__G.weapon.shots > ${shots}`, 'it to keep firing while aiming');
  assert.equal((await fingers(page)).fireR, true);
  await touch(page, 'touchEnd', []);
  await sleep(150);
  const after = await page.evaluate('__G.weapon.shots');
  await sleep(300);
  assert.equal(await page.evaluate('__G.weapon.shots'), after, 'lifting stops it');
  assert.equal(await page.evaluate('document.querySelector("#touch").classList.contains("firing")'), false);
  await page.close();
});

test('left FIRE: holds the trigger, and sliding off it walks without letting go', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const [x, y] = await centre(page, '#touch [data-btn="fireL"]');
  const z = await page.evaluate('__G.player.z');
  await touch(page, 'touchStart', [[x, y, 0]]);
  await until(page, '__G.weapon.shots >= 2', 'rounds to go');
  await sleep(200);
  assert.ok(Math.abs((await page.evaluate('__G.player.z')) - z) < 0.05, 'holding still does not walk');
  for (let k = 1; k <= 5; k++) await touch(page, 'touchMove', [[x, y - k * 14, 0]]);
  await until(page, `__G.player.z < ${z - 0.6}`, 'the player to walk north');
  const shots = await page.evaluate('__G.weapon.shots');
  await until(page, `__G.weapon.shots > ${shots}`, 'it to keep firing while walking');
  await touch(page, 'touchEnd', []);
  await sleep(250);
  assert.deepEqual([(await fingers(page)).fire, await page.evaluate('__G.input.intent.moveY')], [false, 0]);
  await page.close();
});

test('the trigger stays pulled while ANY of left FIRE, right FIRE or a firing press is held', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const L = await centre(page, '#touch [data-btn="fireL"]');
  const R = await centre(page, '#touch [data-btn="fireR"]');
  await touch(page, 'touchStart', [[...L, 0]]);
  await touch(page, 'touchStart', [
    [...L, 0],
    [...R, 1],
  ]);
  assert.deepEqual(await fingers(page).then((f) => [f.fireL, f.fireR, f.fire]), [true, true, true]);
  await touch(page, 'touchEnd', [[...L, 0]]);
  assert.deepEqual(await fingers(page).then((f) => [f.fireL, f.fireR, f.fire]), [false, true, true]);
  await touch(page, 'touchEnd', [[...R, 1]]);
  assert.equal((await fingers(page)).fire, false);

  // a double-tap press and a button together: letting go of the button leaves the press firing
  await touch(page, 'touchStart', [[600, 150, 0]]);
  await touch(page, 'touchEnd', [[600, 150, 0]]);
  await sleep(90);
  await touch(page, 'touchStart', [[604, 152, 0]]);
  assert.equal((await fingers(page)).firingPress, true);
  await touch(page, 'touchStart', [
    [604, 152, 0],
    [...L, 1],
  ]);
  await touch(page, 'touchEnd', [[...L, 1]]);
  assert.deepEqual(await fingers(page).then((f) => [f.fireL, f.firingPress, f.fire]), [false, true, true]);
  await touch(page, 'touchEnd', [[604, 152, 0]]);
  assert.equal((await fingers(page)).fire, false);
  await page.close();
});

test('double tap in the aiming area: tap, then press — fires while held and still aims', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  await touch(page, 'touchStart', [[620, 160, 0]]);
  await sleep(60);
  await touch(page, 'touchEnd', [[620, 160, 0]]);
  assert.equal(await page.evaluate('__G.weapon.shots'), 0, 'one tap fires nothing');
  await sleep(120);
  await touch(page, 'touchStart', [[626, 158, 0]]);
  let f = await fingers(page);
  assert.deepEqual([f.look, f.firingPress, f.fire], [true, true, true]);
  await until(page, '__G.weapon.shots >= 3', 'rounds to go');
  assert.equal(
    await page.evaluate('document.querySelector("#touch").classList.contains("firing")'),
    true,
    'both FIRE buttons light',
  );
  const yaw = await page.evaluate('__G.player.yaw');
  for (let k = 1; k <= 6; k++) await touch(page, 'touchMove', [[626 + k * 16, 158, 0]]);
  await until(page, `__G.player.yaw < ${yaw - 0.25}`, 'the view to turn while firing');
  await touch(page, 'touchEnd', [[722, 158, 0]]);
  f = await fingers(page);
  assert.deepEqual([f.look, f.firingPress, f.fire], [false, false, false]);

  // the press that ended is not itself a tap: pressing again straight away only aims
  await sleep(100);
  await touch(page, 'touchStart', [[722, 158, 0]]);
  assert.equal((await fingers(page)).firingPress, false);
  await touch(page, 'touchEnd', [[722, 158, 0]]);
  await page.close();
});

test('what is NOT a double tap: too slow, too far, a drag, a cancelled touch, or the setting switched off', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const tap = async (x, y, holdMs = 50, end = 'touchEnd') => {
    await touch(page, 'touchStart', [[x, y, 0]]);
    await sleep(holdMs);
    await touch(page, end, end === 'touchEnd' ? [[x, y, 0]] : []);
  };
  const pressFires = async (x, y) => {
    await touch(page, 'touchStart', [[x, y, 0]]);
    const firing = (await fingers(page)).firingPress;
    await sleep(40);
    // a long hold, so that this press cannot itself be taken for a tap by what follows
    await sleep(320);
    await touch(page, 'touchEnd', [[x, y, 0]]);
    return firing;
  };

  await tap(600, 150);
  await sleep(480);
  assert.equal(await pressFires(600, 150), false, 'more than 350 ms later');

  await tap(600, 150);
  await sleep(100);
  assert.equal(await pressFires(720, 150), false, 'more than 80 px away');

  await touch(page, 'touchStart', [[600, 150, 0]]);
  await touch(page, 'touchMove', [[640, 150, 0]]);
  await touch(page, 'touchEnd', [[640, 150, 0]]);
  await sleep(100);
  assert.equal(await pressFires(640, 150), false, 'a drag is not a tap');

  await tap(600, 150, 420);
  await sleep(100);
  assert.equal(await pressFires(600, 150), false, 'a long press is not a tap');

  await tap(600, 150, 50, 'touchCancel');
  await sleep(100);
  assert.equal(await pressFires(600, 150), false, 'a cancelled touch is not a tap');

  await page.evaluate('__G.settings.set("tapFire", false)');
  await tap(600, 150);
  await sleep(100);
  assert.equal(await pressFires(600, 150), false, 'switched off in settings');

  await page.evaluate('__G.settings.set("tapFire", true)');
  await tap(600, 150);
  await sleep(100);
  assert.equal(await pressFires(600, 150), true, 'and the real thing still works');
  assert.equal(await page.evaluate('__G.settings.get("tapFire")'), true);
  await page.close();
});

test('AIM, CROUCH and NV toggle; RELOAD reloads; the pause button pauses', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const tapButton = async (name) => {
    const [x, y] = await centre(page, `#touch [data-btn="${name}"]`);
    await touch(page, 'touchStart', [[x, y, 0]]);
    await sleep(50);
    await touch(page, 'touchEnd', [[x, y, 0]]);
    await sleep(120);
  };
  await tapButton('aim');
  assert.equal(await page.evaluate('__G.input.intent.aim'), true);
  await until(page, '__G.weapon.aim > 0.9', 'the sight to come up');
  await tapButton('aim');
  assert.equal(await page.evaluate('__G.input.intent.aim'), false);

  await tapButton('crouch');
  assert.equal(await page.evaluate('__G.player.crouched'), true);
  await tapButton('crouch');
  assert.equal(await page.evaluate('__G.player.crouched'), false);

  await tapButton('nv');
  assert.equal(await page.evaluate('__G.nv'), true);
  assert.equal(
    await page.evaluate('document.querySelector(\'#touch [data-btn="nv"]\').classList.contains("on")'),
    true,
  );
  await tapButton('nv');
  assert.equal(await page.evaluate('__G.nv'), false);

  await page.evaluate('__G.weapon.mag = 12');
  await tapButton('reload');
  assert.equal(await page.evaluate('__G.weapon.reloading'), true);

  await tapButton('pause');
  assert.equal(await page.evaluate('__G.state'), 'paused');
  assert.equal(
    await page.evaluate('document.querySelector("#touch").hidden'),
    true,
    'the controls are put away under a menu',
  );
  await page.close();
});

test('the gun in hand is named on a button of its own: a tap takes the next, a hold works the carbine’s selector; EMP throws a grenade', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const label = (name) => page.evaluate(`document.querySelector('#touch [data-btn="${name}"] b').textContent`);
  const tap = async (name, ms = 60) => {
    const [x, y] = await centre(page, `#touch [data-btn="${name}"]`);
    await touch(page, 'touchStart', [[x, y, 0]]);
    await sleep(ms);
    await touch(page, 'touchEnd', [[x, y, 0]]);
  };
  await sleep(150);
  assert.equal(await label('swap'), 'CARBINE');
  // a tap: the sidearm; another: the shotgun; a third: round to the carbine again — and the button says which
  for (const [gun, name] of [
    ['pistol', 'SIDEARM'],
    ['shotgun', 'SHOTGUN'],
    ['carbine', 'CARBINE'],
  ]) {
    await tap('swap');
    await until(page, `__G.weapon.current === "${gun}" && !__G.weapon.swapping`, `the ${gun} to come to hand`);
    await until(page, `document.querySelector('#touch [data-btn="swap"] b').textContent === "${name}"`, 'its name');
    const f = await fingers(page);
    assert.deepEqual([f.stick, f.look, f.fire], [false, false, false], 'the button is not the view');
  }

  // held: nothing changes hands — the carbine's selector goes over to SEMI
  const [sx, sy] = await centre(page, '#touch [data-btn="swap"]');
  await touch(page, 'touchStart', [[sx, sy, 0]]);
  await until(page, '__G.weapon.mode === "semi"', 'the selector', 3000);
  await touch(page, 'touchEnd', [[sx, sy, 0]]);
  await sleep(600);
  assert.equal(await page.evaluate('__G.weapon.current'), 'carbine', 'letting go of a hold changed guns');
  // set to SEMI, FIRE held down gives one round — where it gave a burst
  const shots = await page.evaluate('__G.weapon.shots');
  await tap('fireR', 700);
  await sleep(150);
  assert.equal(await page.evaluate('__G.weapon.shots'), shots + 1);

  // EMP: the button counts what is left, throws one a tap, and goes away with the last
  assert.equal(await label('emp'), 'EMP 2');
  await tap('emp');
  await until(page, '__G.weapon.grenades === 1 && __G.weapon.lob === null', 'the first grenade to be thrown');
  await until(page, `document.querySelector('#touch [data-btn="emp"] b').textContent === "EMP 1"`, 'the count');
  await tap('emp');
  await until(page, '__G.weapon.grenades === 0', 'the second');
  await until(page, 'document.querySelector(\'#touch [data-btn="emp"]\').hidden', 'the EMP button to go');
  await page.close();
});

test('JUMP: one tap and you are off the ground, about a metre up, and back down — and it is nobody’s aiming finger', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  await page.evaluate(
    'window.__top = 0; setInterval(() => { window.__top = Math.max(window.__top, __G.player.y); }, 4); void 0',
  );
  const yaw = await page.evaluate('__G.player.yaw');
  const [x, y] = await centre(page, '#touch [data-btn="jump"]');
  await touch(page, 'touchStart', [[x, y, 0]]);
  const f = await fingers(page);
  assert.deepEqual([f.stick, f.look, f.fire], [false, false, false], 'the button is not the view');
  // a thumb that slides on the button does not turn the view either
  await touch(page, 'touchMove', [[x - 30, y - 10, 0]]);
  await touch(page, 'touchEnd', [[x - 30, y - 10, 0]]);
  await until(page, '__top > 0.4', 'the feet to leave the ground');
  await until(page, '__G.player.grounded && __G.player.y === 0', 'the landing');
  const top = await page.evaluate('__top');
  assert.ok(top > 0.9 && top < 1.2, `the jump went ${top.toFixed(2)} m up`);
  assert.equal(await page.evaluate('__G.player.yaw'), yaw, 'and the view did not turn');
  // a jump stands you up
  const crouch = await centre(page, '#touch [data-btn="crouch"]');
  await touch(page, 'touchStart', [[...crouch, 0]]);
  await touch(page, 'touchEnd', [[...crouch, 0]]);
  await until(page, '__G.player.crouched', 'the crouch');
  await touch(page, 'touchStart', [[x, y, 0]]);
  await touch(page, 'touchEnd', [[x, y, 0]]);
  await until(page, '!__G.player.crouched && __G.player.y > 0.3', 'the jump out of the crouch');
  await page.close();
});

test('USE appears where there is something to use; holding it sets a charge, letting go early does not', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  assert.equal(await page.evaluate('document.querySelector(\'#touch [data-btn="use"]\').hidden'), true);
  await page.evaluate('const c = __G.site.charges[0]; __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0)');
  await until(page, '!document.querySelector(\'#touch [data-btn="use"]\').hidden', 'the USE button');
  assert.equal(await page.evaluate('document.querySelector(\'#touch [data-btn="use"] b\').textContent'), 'SET CHARGE');
  const [x, y] = await centre(page, '#touch [data-btn="use"]');

  await touch(page, 'touchStart', [[x, y, 0]]);
  await sleep(700);
  await touch(page, 'touchEnd', [[x, y, 0]]);
  await sleep(200);
  assert.equal(await page.evaluate('__G.mission.chargesPlanted'), 0, 'not held long enough');

  await touch(page, 'touchStart', [[x, y, 0]]);
  await until(page, '__G.mission.chargesPlanted === 1', 'the charge to be set', 6000);
  await touch(page, 'touchEnd', [[x, y, 0]]);
  await until(page, 'document.querySelector(\'#touch [data-btn="use"]\').hidden', 'the USE button to go');

  // with all four set, the same button at the window of the control room says BLOW — and holding it does
  await page.evaluate('__G.debug.rig(); __G.debug.teleport(__G.site.firing.x, __G.site.firing.z, Math.PI / 2); void 0');
  await until(
    page,
    '!document.querySelector(\'#touch [data-btn="use"]\').hidden',
    'the USE button, at the firing point',
  );
  assert.equal(await page.evaluate('document.querySelector(\'#touch [data-btn="use"] b\').textContent'), 'BLOW');
  const [bx, by] = await centre(page, '#touch [data-btn="use"]');
  await touch(page, 'touchStart', [[bx, by, 0]]);
  await until(page, '__G.mission.blown', 'the cascades to be blown', 6000);
  await touch(page, 'touchEnd', [[bx, by, 0]]);
  await until(page, '__G.world.cascade.state.down === 1', 'every casing to come down', 10000);
  await page.close();
});

test('behind a sentry USE takes it down and SHIELD takes it hostage; held, the same two buttons shut it down or let it go', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  const label = (name) =>
    page.evaluate(
      `(() => { const b = document.querySelector('#touch [data-btn="${name}"]'); return b.hidden ? null : b.querySelector('b').textContent; })()`,
    );
  const tapButton = async (name) => {
    const [x, y] = await centre(page, `#touch [data-btn="${name}"]`);
    await touch(page, 'touchStart', [[x, y, 0]]);
    await sleep(50);
    await touch(page, 'touchEnd', [[x, y, 0]]);
    await sleep(150);
  };
  const behind = () =>
    page.evaluate(
      '{ __G.debug.start(); __G.player.hidden = true; const u = __G.enemies.byName("gate"); __G.debug.teleport(u.x, u.z - 1.1, Math.PI); window.__gate = u; void 0; }',
    );
  await calm(page);
  assert.deepEqual([await label('use'), await label('grab')], [null, null], 'nothing to do: neither button is there');

  await behind();
  await until(page, '!document.querySelector(\'#touch [data-btn="grab"]\').hidden', 'the SHIELD button');
  assert.deepEqual([await label('use'), await label('grab')], ['TAKE DOWN', 'SHIELD']);
  await tapButton('grab');
  await until(page, '__G.enemies.held === __gate', 'the sentry to be held');
  await until(page, 'document.querySelector(\'#touch [data-btn="grab"] b\').textContent === "LET GO"', 'LET GO');
  assert.deepEqual([await label('use'), await label('grab')], ['SHUT DOWN', 'LET GO']);
  // the ring round USE is the shield's health
  await page.evaluate('__gate.hp = __gate.hpMax * 0.4; void 0');
  await until(
    page,
    'Math.abs(parseFloat(document.querySelector(\'#touch [data-btn="use"]\').style.getPropertyValue("--fill")) - 0.4) < 0.01',
    'the ring to show the shield’s health',
  );
  await tapButton('grab');
  await until(page, '__G.enemies.held === null', 'it to be let go');
  assert.deepEqual(
    JSON.parse(await page.evaluate('JSON.stringify([__gate.dead, __gate.brain.state, __G.player.holding])')),
    [false, 'combat', false],
  );

  // again, and this time USE: shut down in your arms
  await behind();
  await until(page, '!document.querySelector(\'#touch [data-btn="grab"]\').hidden', 'the SHIELD button');
  await tapButton('grab');
  await until(page, '__G.enemies.held === __gate', 'the sentry to be held');
  await tapButton('use');
  await until(page, '__gate.dead', 'it to be shut down');
  assert.deepEqual(JSON.parse(await page.evaluate('JSON.stringify([__G.takedowns, __G.enemies.alarm.active])')), [
    1,
    false,
  ]);
  // USE goes — there is nothing left to shut down. The second button does not (until 16 November 2026 both went):
  // the machine lies at your feet, and what lies there can be dragged out of the others' sight.
  await until(
    page,
    'document.querySelector(\'#touch [data-btn="use"]\').hidden && document.querySelector(\'#touch [data-btn="grab"] b\').textContent === "DRAG"',
    'USE to go, and the second button to offer the wreck',
  );

  // DRAG takes hold of it; held, the button lets it go; and walked away from, it is offered no longer
  await tapButton('grab');
  await until(page, '__G.enemies.dragged === __gate', 'the wreck to be taken hold of');
  await until(page, 'document.querySelector(\'#touch [data-btn="grab"] b\').textContent === "LET GO"', 'LET GO');
  assert.deepEqual([await label('use'), await label('grab')], [null, 'LET GO']);
  assert.equal(await page.evaluate('__G.player.holding'), true, 'a hand is full');
  // a phone has no line under the crosshair (its buttons carry the words): how far off the wreck is seen where
  // it lies is said as a note, and said again each time it changes
  await until(
    page,
    '/^HERE IT IS SEEN FROM \\d+ m$/.test(document.querySelector("#hud .note").textContent)',
    'the note that says how far off it is seen',
  );
  await tapButton('grab');
  await until(page, '__G.enemies.dragged === null', 'it to be let go of');
  assert.equal(await page.evaluate('__G.player.holding'), false);
  await page.evaluate('__G.debug.teleport(__G.player.x - 12, __G.player.z, 0); void 0');
  await until(
    page,
    'document.querySelector(\'#touch [data-btn="use"]\').hidden && document.querySelector(\'#touch [data-btn="grab"]\').hidden',
    'both buttons to go',
  );
  await page.close();
});

test('the knife on a phone: USE says KNIFE when a machine is in reach of the blade, and FIRE swings it once the rounds are gone', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  // face to face with the gate guard: no takedown from the front, so USE is the knife
  await page.evaluate(
    '{ __G.debug.start(); __G.player.hidden = true; const u = __G.enemies.byName("gate"); __G.debug.teleport(u.x, u.z + 1.1, 0); __G.player.pitch = 0; window.__gate = u; void 0; }',
  );
  await until(page, '!document.querySelector(\'#touch [data-btn="use"]\').hidden', 'the USE button');
  assert.equal(await page.evaluate('document.querySelector(\'#touch [data-btn="use"] b\').textContent'), 'KNIFE');
  assert.equal(await page.evaluate('document.querySelector(\'#touch [data-btn="grab"]\').hidden'), true);
  const [x, y] = await centre(page, '#touch [data-btn="use"]');
  await touch(page, 'touchStart', [[x, y, 0]]);
  await touch(page, 'touchEnd', [[x, y, 0]]);
  await until(page, '__gate.hp < __gate.hpMax', 'the blow to land');
  assert.deepEqual(JSON.parse(await page.evaluate('JSON.stringify([__G.weapon.shots, __gate.dead])')), [0, false]);

  // no rounds left for any gun: the ammunition panel says so, and FIRE is the knife
  await page.evaluate(
    '__G.debug.start(); __G.player.hidden = true; __G.debug.teleport(64.5, 70.5, 0); for (const key of ["carbine", "pistol", "shotgun"]) Object.assign(__G.weapon.arms.guns[key], { mag: 0, reserve: 0 }); void 0',
  );
  await sleep(200);
  const panel = JSON.parse(
    await page.evaluate(
      'JSON.stringify({ mag: document.querySelector("#hud .ammo .mag").textContent, total: document.querySelector("#hud .ammo .total").textContent, out: document.querySelector("#hud .ammo").classList.contains("out") })',
    ),
  );
  assert.deepEqual(panel, { mag: '0', total: '0', out: true });
  const fire = await centre(page, '#touch [data-btn="fireR"]');
  await touch(page, 'touchStart', [[...fire, 0]]);
  await until(page, '__G.weapon.knife.busy', 'the knife to be swung');
  await touch(page, 'touchEnd', [[...fire, 0]]);
  assert.equal(await page.evaluate('__G.weapon.shots'), 0);
  await page.close();
});

test('tapping the small map opens the big one, and tapping that closes it', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  await calm(page);
  const [x, y] = await centre(page, '#hud .mini');
  await touch(page, 'touchStart', [[x, y, 0]]);
  await touch(page, 'touchEnd', [[x, y, 0]]);
  await until(page, '!document.querySelector("#hud .bigmap").hidden', 'the big map');
  await touch(page, 'touchStart', [[437, 170, 0]]);
  await touch(page, 'touchEnd', [[437, 170, 0]]);
  await until(page, 'document.querySelector("#hud .bigmap").hidden', 'the big map to close');
  await page.close();
});

const PICTURE = `JSON.stringify((() => {
  const c = document.querySelector('#view');
  const ratio = Math.min(devicePixelRatio, __G.view.level.ratioCap) * __G.view.dynres.scale;
  return {
    css: [c.clientWidth, c.clientHeight],
    window: [innerWidth, innerHeight],
    fits: Math.abs(c.width - c.clientWidth * ratio) <= 1 && Math.abs(c.height - c.clientHeight * ratio) <= 1,
    aspect: Math.abs(__G.camera.aspect - c.clientWidth / c.clientHeight) < 0.002,
    hold: __G.view.dynres.holdFor,
    scale: __G.view.dynres.scale,
  };
})())`;

test('turning the phone: the picture follows the screen, every time', async () => {
  const page = await openPhone(SIDEWAYS[0]);
  for (const shape of [UPRIGHT, SIDEWAYS[0], UPRIGHT, SIDEWAYS[4], UPRIGHT, SIDEWAYS[5]]) {
    await reshape(page, shape);
    const p = JSON.parse(await page.evaluate(PICTURE));
    assert.deepEqual(p.css, [shape[0], shape[1]], 'the canvas fills the screen');
    assert.equal(p.fits, true, `${shape[0]}×${shape[1]}: the drawing buffer does not match the canvas`);
    assert.equal(p.aspect, true, `${shape[0]}×${shape[1]}: the camera is stretched`);
  }
  await page.close();
});

test('turning the phone when the browser sends no resize event at all', async () => {
  const page = await openPhone(SIDEWAYS[0], 'touch=1&autostart=1&noaudio=1&dynres=0', true);
  for (const shape of [UPRIGHT, SIDEWAYS[2]]) {
    await reshape(page, shape);
    const p = JSON.parse(await page.evaluate(PICTURE));
    assert.equal(p.fits && p.aspect, true, `${shape[0]}×${shape[1]}: the picture did not follow`);
  }
  await page.close();
});

test('a turn is not a slow phone: the picture size holds for two seconds after every re-shape', async () => {
  const page = await openPhone(SIDEWAYS[0], 'touch=1&autostart=1&noaudio=1');
  await sleep(2300);
  for (let turn = 0; turn < 4; turn++) {
    await reshape(page, turn % 2 ? SIDEWAYS[0] : UPRIGHT);
    const p = JSON.parse(await page.evaluate(PICTURE));
    assert.ok(p.hold > 1.2, `turn ${turn + 1}: hold is ${p.hold}`);
    // the frames of a turn are long; feed the controller some, as a phone would
    await page.evaluate('for (const ms of [190, 170, 150, 140, 130]) __G.view.dynres.frame(ms)');
    assert.equal(JSON.parse(await page.evaluate(PICTURE)).scale, 1, `turn ${turn + 1} lowered the picture size`);
  }
  await page.close();
});

test('a near miss lands on a phone and misses on a desk: the touch aim assist, and only there', async () => {
  // six metres behind the gate guard with the sight up, aimed 43 cm to one side of its spine: outside its body
  // (36 cm) but inside the body a thumb is allowed (36 cm × 1.4)
  const lineUp = `{ const u = __G.enemies.byName("gate"); __G.player.hidden = true; __G.debug.teleport(u.x, u.z - 6, Math.PI + Math.atan2(0.43, 6)); __G.player.pitch = Math.atan2(1.26 - 1.62, 6); }`;

  const phone = await openPhone(SIDEWAYS[0]);
  await phone.evaluate('__G.debug.start(); void 0');
  await phone.evaluate(lineUp);
  const aim = await centre(phone, '#touch [data-btn="aim"]');
  await touch(phone, 'touchStart', [[...aim, 0]]);
  await touch(phone, 'touchEnd', [[...aim, 0]]);
  await until(phone, '__G.weapon.aim > 0.97', 'the sight to come up');
  await phone.evaluate(lineUp);
  const fire = await centre(phone, '#touch [data-btn="fireR"]');
  await touch(phone, 'touchStart', [[...fire, 0]]);
  await until(phone, '__G.weapon.shots >= 1', 'a round');
  await touch(phone, 'touchEnd', [[...fire, 0]]);
  const onPhone = JSON.parse(
    await phone.evaluate('JSON.stringify({ shots: __G.weapon.shots, hits: __G.weapon.hits })'),
  );
  assert.ok(onPhone.hits >= 1, `on a phone the near miss should land: ${JSON.stringify(onPhone)}`);
  await phone.close();

  const desk = await harness.browser.newPage();
  await desk.navigate(`${harness.url}/?touch=0&autostart=1&noaudio=1&dynres=0`);
  await desk.waitFor('window.__ready === true', { timeoutMs: 90000 });
  await desk.evaluate(lineUp);
  await desk.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'right', clickCount: 1 });
  await until(desk, '__G.weapon.aim > 0.97', 'the sight to come up');
  await desk.evaluate(lineUp);
  await desk.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await until(desk, '__G.weapon.shots >= 1', 'a round');
  await desk.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await desk.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 640,
    y: 360,
    button: 'right',
    clickCount: 1,
  });
  const onDesk = JSON.parse(await desk.evaluate('JSON.stringify({ shots: __G.weapon.shots, hits: __G.weapon.hits })'));
  assert.ok(onDesk.shots >= 1);
  assert.equal(onDesk.hits, 0, `on a desk the same shot is a miss: ${JSON.stringify(onDesk)}`);
  await desk.close();
});

test('sound starts on the first touch', async () => {
  const page = await openPhone(SIDEWAYS[0], 'touch=1');
  assert.equal(await page.evaluate('__G.audio.state'), 'locked', 'no sound before the player has touched anything');
  await touch(page, 'touchStart', [[700, 60, 0]]);
  await touch(page, 'touchEnd', [[700, 60, 0]]);
  await until(page, '__G.audio.state === "running"', 'sound to start');
  await page.close();
});
