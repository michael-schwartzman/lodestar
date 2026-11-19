// How the experiment is dressed (src/wild/index.js `screen`, src/wild/wild.css): what the briefing says of it, its
// rows on the Controls screen, its counts when a mission ends — and that none of it breaks the screens it is added
// to, on a desk and at a phone's shape.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openWith, sleep, startWild } from './helpers.mjs';

let harness;
let open;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
});

after(async () => {
  await harness?.stop();
});

const DESK = 'look=1&noaudio=1&dynres=0&touch=0';
const show = (page, name) => page.evaluate(`__G.menus.show("${name}"); void 0`);

/** the Controls table as it is drawn: how wide it and its panel are, the narrowest second cell, every action */
const table = (page) =>
  page.json(`(() => {
    const t = document.querySelector('.m-table'), rows = [...t.rows].slice(1);
    return { table: t.getBoundingClientRect().width, host: t.parentElement.getBoundingClientRect().width,
      second: Math.min(...rows.map((r) => r.cells[1].getBoundingClientRect().width)),
      actions: rows.map((r) => r.cells[0].textContent) };
  })()`);
const tab = (page, view) => page.evaluate(`document.querySelector('.m-seg__btn[data-view="${view}"]').click(); void 0`);

test('the briefing says what is new, a line a thing — its key, its name, a few words — and off, says nothing of it', async () => {
  const page = await open(DESK);
  await show(page, 'briefing');
  const kit = await page.json(`[...document.querySelectorAll('.w-kit li')].map((li) => ({
    key: li.querySelector('kbd').textContent, name: li.querySelector('b').textContent, text: li.querySelector('span').textContent,
    lines: Math.round(li.getBoundingClientRect().height / parseFloat(getComputedStyle(li).lineHeight)) }))`);
  const names = kit.map((line) => line.name);
  for (const name of ['FOCUS', 'REFLEX', 'UPLINK', 'OVERSPEED', 'SLIDE', 'WARDEN'])
    assert.ok(names.includes(name), `${name} is not in the briefing: ${names}`);
  const key = (name) => kit.find((line) => line.name === name).key;
  assert.deepEqual([key('FOCUS'), key('UPLINK'), key('OVERSPEED'), key('SLIDE')], ['Y', 'H', 'H', 'C']);
  for (const line of kit) {
    assert.equal(line.lines, 1, `"${line.name} ${line.text}" takes ${line.lines} lines`);
    assert.ok(line.text.length > 12 && line.text.length <= 50, `"${line.text}" is ${line.text.length} letters`);
    assert.doesNotMatch(line.text, /[.!]$/, 'a few words, not a sentence');
  }
  // …and all of each is there to be read: none is cut short by the panel's edge
  assert.equal(
    await page.evaluate('[...document.querySelectorAll(".w-kit span")].every((s) => s.scrollWidth <= s.clientWidth)'),
    true,
  );
  // (17 November 2026, the owner: "i like the go wild example make it the main" — it is the game now, and the
  // player is no longer told it is an experiment: until then this asked for /EXPERIMENT/)
  // (18 November 2026, the owner, of the experiment: "… i like it" — it is not a build beside the game any
  // more, and its box is headed by what is in it: until then /^WILD BUILD/)
  assert.equal(await page.evaluate('document.querySelector(".w-kit h3").textContent'), 'KIT AND HAZARDS');
  assert.doesNotMatch(
    await page.evaluate('document.querySelector(".w-kit").textContent'),
    /experiment|wild build|turns .* off/i,
  );
  // (a desk has the key: FOCUS's button is a phone's)
  assert.equal(await page.evaluate('document.querySelector("#hud .w-btn")'), null);
  // the choice of difficulty is still on the briefing's page, under it (it is scrolled to, as it always was)
  assert.match(await page.evaluate('document.querySelector(".m-panel__body").textContent'), /Difficulty/);

  const off = await open(`${DESK}&wild=0`);
  await show(off, 'briefing');
  assert.equal(await off.evaluate('document.querySelector(".w-kit, .w-brief")'), null);
  assert.deepEqual(await page.problems(), []);
});

test('the Controls screen has the experiment’s rows, and they leave the game’s own table as wide as it was — on both of its pages', async () => {
  const page = await open(DESK);
  const off = await open(`${DESK}&wild=0`);
  await show(page, 'controls');
  await show(off, 'controls');
  for (const view of ['desk', 'phone']) {
    await tab(page, view);
    await tab(off, view);
    const [on, was] = [await table(page), await table(off)];
    assert.ok(on.table <= on.host + 1, `${view}: the table is ${on.table} px in a panel of ${on.host}`);
    assert.ok(on.second >= was.second - 1, `${view}: the second column is ${on.second} px, and was ${was.second}`);
    const added = on.actions.filter((action) => !was.actions.includes(action));
    assert.equal(on.actions.length, was.actions.length + added.length);
    for (const word of ['Focus', 'Uplink', 'drone', 'Overspeed', 'Slide'])
      assert.ok(
        added.some((action) => action.includes(word)),
        `${view}: no row for "${word}" in ${JSON.stringify(added)}`,
      );
  }
});

test('when a mission ends, what the experiment did is counted under the game’s own figures', async () => {
  const page = await open(`${DESK}&autostart=1`);
  await page.evaluate(
    '__G.debug.start(); __G.wild.tally.knocked = 2; __G.wild.tally.turned = 1; __G.wild.tally.flights = 0; __G.debug.hurt(500); void 0',
  );
  await page.until('__G.menus.current() === "failed"', 'the mission to be lost', 20000);
  const rows = await page.json(
    '[...document.querySelectorAll(".w-tally .m-stats__row")].map((r) => [r.querySelector("dt").textContent, r.querySelector("dd").textContent])',
  );
  // (what was not done is not listed)
  assert.deepEqual(rows, [
    ['Machines turned', '1'],
    ['Sentries staggered by a slide', '2'],
  ]);
  // …under a line that says whose they are
  assert.equal(
    await page.evaluate('getComputedStyle(document.querySelector(".w-tally"), "::before").content'),
    '"FIELD NOTES"',
  );
  assert.deepEqual(await page.problems(), []);
});

// ---------- at a phone's shape ----------

async function openPhone(query, [width, height] = [844, 390]) {
  const page = await harness.browser.newPage();
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.navigate(`${harness.url}/?${query}`);
  await page.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 120000, label: 'the game to start' });
  assert.equal(await page.evaluate('window.__fatal || null'), null);
  page.json = async (expression) => JSON.parse(await page.evaluate(`JSON.stringify(${expression})`));
  page.until = (expression, label, timeoutMs = 20000) => page.waitFor(expression, { timeoutMs, intervalMs: 80, label });
  page.problems = async () => [
    ...JSON.parse(await page.evaluate('JSON.stringify((window.__errors || []).concat(window.__rejections || []))')),
    ...page.exceptions,
    ...page.logErrors,
    ...page.console.filter((m) => m.type === 'error').map((m) => m.text),
  ];
  return page;
}
const tap = async (page, selector) => {
  const [x, y] = await page.json(
    `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`,
  );
  const points = [{ x, y, id: 7, radiusX: 8, radiusY: 8, force: 1 }];
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await sleep(60);
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
/**
 * What of the experiment's is on the screen and overlaps something a thumb presses or the game shows: every
 * visible piece of the overlay that says something, against every button and every panel of the HUD.
 */
const COLLISIONS = `(() => {
  const seen = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 ? r : null; };
  const theirs = [...document.querySelectorAll('#touch [data-btn], #hud [data-hud]')].map((el) => [el.dataset.btn || el.dataset.hud, seen(el)]).filter(([, r]) => r);
  const ours = [['offer', '.w-offer'], ['bar', '.w-over'], ['link', '.w-link[data-state]:not([data-state=""]) b'], ['chip', '.w-chip'], ['focus', '.w-btn'], ['lode', '.w-lode']]
    .flatMap(([name, selector]) => [...document.querySelectorAll('#hud ' + selector)].map((el) => [name, seen(el)])).filter(([, r]) => r);
  const out = [];
  for (const [mine, a] of ours) for (const [name, b] of theirs)
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(mine + ' over ' + name);
  return { ours: ours.map(([name]) => name), out };
})()`;
const grabSays = (label) =>
  `(() => { const b = document.querySelector('#touch [data-btn=grab]'); return !b.hidden && b.dataset.label === '${label}'; })()`;
const PHONES = [
  [844, 390],
  [667, 331],
  [932, 430],
  // held upright
  [402, 714],
];

for (const shape of PHONES)
  test(`on a phone (${shape.join(' × ')}) the experiment plays, and nothing of it lies over a button or a panel: FOCUS on a button of its own, the offer at the firing point, the bar while the drives run, the uplink`, async () => {
    const page = await openPhone('look=1&touch=1&autostart=1&noaudio=1&dynres=0', shape);
    await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
    // a phone has no Y: FOCUS is a button, beside NV — one touch bends time, another lets it go
    const focus = '__G.wild.feature("focus").state.on';
    let now = await page.json(COLLISIONS);
    assert.ok(now.ours.includes('focus'), JSON.stringify(now.ours));
    assert.deepEqual(now.out, []);
    await tap(page, '#hud .w-btn');
    await page.until(`${focus} === true`, 'FOCUS', 4000);
    await page.until('document.querySelector("#hud .w-btn").classList.contains("on")', 'the button to say so', 3000);
    await tap(page, '#hud .w-btn');
    await page.until(`${focus} === false`, 'FOCUS to be let go', 4000);
    // a phone has no 4 either: LODESTONE is a button of its own, a row under the pause — a touch on it throws
    // one exactly as the key does, and the count on its face goes down by one
    const lode = '__G.wild.feature("lodestone").state';
    const lodeBefore = await page.json(lode);
    assert.ok(lodeBefore.count > 0, `expected to start carrying one or more, got ${lodeBefore.count}`);
    now = await page.json(COLLISIONS);
    assert.ok(now.ours.includes('lode'), JSON.stringify(now.ours));
    assert.deepEqual(now.out, []);
    await tap(page, '#hud .w-lode');
    await page.until(`${lode}.stones.length === 1`, 'a stone to be thrown by the touch', 4000);
    assert.equal((await page.json(lode)).count, lodeBefore.count - 1, 'one less carried after the touch');
    // (thirty seconds, not eight, since 18 November 2026: a stone's cycle is seconds of the game, and on a
    // machine under load the game's seconds were once longer than that — nothing is asked here of how long)
    await page.until(`${lode}.stones.length === 0`, 'that stone to finish its cycle before the next step', 30000);
    // the firing point: the second button offers the overspeed, and the line that says what it costs is clear
    await page.evaluate('__G.debug.teleport(__G.site.firing.x, __G.site.firing.z, 0); void 0');
    await page.until('!document.querySelector("#hud .w-offer").hidden', 'the overspeed to be offered', 5000);
    await page.until(grabSays('OVERSPEED'), 'the button to say OVERSPEED', 5000);
    now = await page.json(COLLISIONS);
    assert.ok(now.ours.includes('offer'), JSON.stringify(now.ours));
    assert.deepEqual(now.out, []);
    // pressed, it is held for the player: the drives are pushed, and the bar is clear too
    await tap(page, '#touch [data-btn=grab]');
    await page.until('__G.wild.feature("overspeed").state.running === true', 'the overspeed to begin', 6000);
    await page.until('!document.querySelector("#hud .w-over").hidden', 'its bar', 3000);
    await sleep(300);
    now = await page.json(COLLISIONS);
    assert.ok(now.ours.includes('bar'), JSON.stringify(now.ours));
    assert.deepEqual(now.out, []);
    // a machine in the middle of the screen: the button says UPLINK, a press takes it — and the word over the
    // crosshair is clear
    await page.evaluate(`(() => {
      const G = __G; G.debug.start(); G.player.hidden = true;
      const e = G.enemies, yaw = ${Math.PI / 2};
      e.remove(e.list.filter((u) => u.name !== 'gate').map((u) => u.rollId));
      Object.assign(e.byName('gate'), { x: 64.5, z: 67.5, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[64, 67]], routeI: 0, path: null, goalX: -1 });
      G.debug.teleport(56.5, 67.5, ${-Math.PI / 2});
      G.player.pitch = Math.atan2(1.2 - G.player.eye, 8);
    })()`);
    await page.until(grabSays('UPLINK'), 'the button to say UPLINK', 6000);
    now = await page.json(COLLISIONS);
    assert.ok(now.ours.includes('link'), JSON.stringify(now.ours));
    assert.deepEqual(now.out, []);
    await tap(page, '#touch [data-btn=grab]');
    await page.until('__G.enemies.list.some((u) => u.turned > 0)', 'the sentry to be turned', 8000);
    // the bar of chips is a desk's: a phone has no keys to be told of
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#hud .w-bar")).display'), 'none');
    assert.deepEqual(await page.problems(), []);
  });
