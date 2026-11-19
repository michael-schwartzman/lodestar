// The overspeed, in the built game (src/wild/overspeed.js holds the rules, test/unit/wild-overspeed.test.mjs holds
// them to their numbers): the key at the firing point, what the site and the hall do while it runs, how it ends.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { OVERSPEED, spinAt } from '../../src/wild/overspeed.js';
import { SPIN } from '../../src/world/spin.js';
import { PLAY, openWith, sleep, startWild } from './helpers.mjs';

let harness;
let page;

before(async () => {
  harness = await startWild();
  page = await openWith(harness)(PLAY);
});

after(async () => {
  await harness?.stop();
});

const over = '__G.wild.feature("overspeed")';
const read = () =>
  page.json(`(() => {
    const G = __G, f = G.wild.feature('overspeed'), o = f.state, mesh = G.world.group.getObjectByName('cascade');
    const m = mesh.instanceMatrix.array, c = mesh.instanceColor.array;
    let lean = 0, warm = 0;
    for (let i = 0; i < mesh.count; i++) { lean = Math.max(lean, 1 - m[i * 16 + 5]); warm += c[i * 3] - c[i * 3 + 2]; }
    const bar = document.querySelector('#hud .w-over'), offer = document.querySelector('#hud .w-offer');
    return { running: o.running, done: o.done, progress: o.progress, need: o.need, lean, warm: warm / mesh.count,
      alarm: { active: G.enemies.alarm.active, count: G.enemies.alarm.count },
      sent: G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).length, out: G.debug.lamps.out().length,
      angle: G.world.cascade.spinning.angle, time: G.mission.time, blown: G.mission.blown, charges: G.mission.chargesPlanted,
      standing: !G.world.cascade.state.blown, bar: bar.hidden ? '' : bar.textContent, weak: bar.classList.contains('weak'),
      offer: offer.hidden ? '' : offer.textContent, note: document.querySelector('#hud .note').textContent,
      radio: document.querySelector('#hud .radio').textContent, tally: { ...G.wild.tally }, state: G.state };
  })()`);
/** a quiet site, and the player at the firing point in the control room, looking at the hall through its window */
const atTheFiringPoint = async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.evaluate('__G.debug.teleport(__G.site.firing.x, __G.site.firing.z, Math.PI / 2); void 0');
};
/** holds H until the overspeed is running */
const begin = async () => {
  await page.keyDown('KeyH', 'h', 0);
  try {
    await page.until(`${over}.state.running === true`, 'the overspeed to begin', 6000);
  } finally {
    await page.keyUp('KeyH', 'h', 0);
  }
};

test('at the firing point with charges unset, H pushes the drives: the site answers, the hall shakes, glows and goes dark — and the cascades come down with no charge set by hand', async () => {
  await atTheFiringPoint();
  await page.until('!document.querySelector("#hud .w-offer").hidden', 'the offer', 4000);
  const rest = await read();
  assert.match(rest.offer, /HOLD H.*OVERSPEED THE DRIVES.*32 s/);
  assert.deepEqual([rest.running, rest.lean, rest.alarm.active, rest.charges, rest.bar], [false, 0, false, 0, '']);

  await begin();
  const begun = await read();
  // the site's own alarm, as a charge raises it: up, and not counted against the grade
  assert.deepEqual(begun.alarm, { active: true, count: 0 });
  assert.equal(begun.need, OVERSPEED.seconds);
  assert.match(begun.bar, /OVERSPEED.*1 0\d\d Hz.*HOLD THE ROOM/);
  assert.equal(begun.offer, '');
  assert.match(begun.radio, /You are in their drives\. Hold that room for 32 seconds/);

  await page.evaluate('__G.debug.speed(8); void 0');
  try {
    // a third of the way: a wave has been sent for it — a guard and a drone, on Operator
    await page.until(`${over}.state.progress > 0.34`, 'a third of the way', 30000);
    const third = await read();
    assert.ok(third.sent >= 2, `${third.sent} machines have been sent for it`);
    assert.match(third.radio, /WARDEN is answering/);
    // past the half: the casings shake in their seats and are warmer than they were, a second wave has come,
    // and the drives have pulled the hall's lamps down
    await page.until(`${over}.state.progress > 0.56`, 'past the half', 30000);
    const half = await read();
    assert.ok(half.lean > 2e-5, `the casings stand as still as they were built: ${half.lean}`);
    assert.ok(half.warm > rest.warm + 0.02, `the casings are no warmer: ${rest.warm} → ${half.warm}`);
    assert.ok(half.out > 0, 'no lamp went out');
    assert.ok(half.sent >= 4, `${half.sent} machines have been sent for it by the second wave`);
    // the end
    await page.until(`${over}.state.done === true`, 'the end of it', 60000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  await sleep(300);
  const end = await read();
  assert.deepEqual([end.blown, end.charges, end.standing, end.running], [true, 4, false, false]);
  assert.equal(end.tally.overspeed, 1);
  assert.equal(end.bar, '');
  assert.equal(end.offer, '', 'it is offered again when it has been done');
  assert.equal(end.alarm.count, 0, 'none of it was a machine finding the player');
  assert.deepEqual(await page.problems(), []);
});

test('the skins are seen to turn faster as it goes — and out of the room it runs back down, until the casings stand as they were built', async () => {
  await atTheFiringPoint();
  const rest = await read();
  await begin();
  // (put four fifths of the way along, to be read there)
  await page.evaluate(`${over}.state.progress = 0.8; ${over}.state.at = 9; void 0`);
  await sleep(300);
  const a = await read();
  await sleep(350);
  const b = await read();
  const wrap = SPIN.wrap;
  const turned = (((b.angle - a.angle) % wrap) + wrap) % wrap;
  const rate = turned / (b.time - a.time) / (SPIN.rate * Math.PI * 2);
  assert.ok(
    rate > spinAt(0.78) * 0.85 && rate < spinAt(0.86) * 1.15,
    `the skins turn ${rate.toFixed(2)} times as fast as they do at rest`,
  );
  assert.ok(b.lean > 0.0005, `at four fifths the casings lean ${b.lean}`);

  // out of the room — down the corridor — it runs back down, and says so
  await page.evaluate('__G.debug.teleport(60.5, 44.5, 0); void 0');
  await page.until(`${over}.state.progress < 0.78`, 'it to run down', 8000);
  const away = await read();
  assert.equal(away.weak, true);
  assert.match(away.bar, /OUT OF THE ROOM/);
  // back in the room it builds again
  await page.evaluate('__G.debug.teleport(__G.site.firing.x + 2, __G.site.firing.z, Math.PI / 2); void 0');
  const low = (await read()).progress;
  await page.until(`${over}.state.progress > ${low + 0.01}`, 'it to build again', 8000);
  assert.equal((await read()).weak, false);
  // left for good: abandoned at nought, and every casing stands as it was built
  await page.evaluate('__G.debug.teleport(60.5, 44.5, 0); __G.debug.speed(8); void 0');
  try {
    await page.until(`${over}.state.running === false`, 'it to be abandoned', 60000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  await sleep(300);
  const left = await read();
  assert.deepEqual([left.done, left.progress, left.blown, left.standing], [false, 0, false, true]);
  assert.equal(left.lean, 0);
  assert.ok(Math.abs(left.warm - rest.warm) < 1e-6, 'the casings are still warm');
  assert.equal(left.note, 'THE DRIVES SETTLE — IT IS LOST');
  // …and it can be begun again
  await page.evaluate('__G.debug.teleport(__G.site.firing.x, __G.site.firing.z, Math.PI / 2); void 0');
  await page.until('!document.querySelector("#hud .w-offer").hidden', 'the offer again', 4000);
});

test('each charge already set takes six seconds off; with all four set it is not offered at all — F fires them, as always', async () => {
  await atTheFiringPoint();
  // one charge, set by hand at its cascade (which brings its own alarm and wave, as it does)
  await page.evaluate('{ const c = __G.site.charges[0]; __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); }');
  await sleep(200);
  await page.keyDown('KeyF', 'f', 0);
  try {
    await page.until('__G.mission.chargesPlanted === 1', 'the charge', 8000);
  } finally {
    await page.keyUp('KeyF', 'f', 0);
  }
  await page.evaluate('__G.debug.teleport(__G.site.firing.x, __G.site.firing.z, Math.PI / 2); void 0');
  await page.until('!document.querySelector("#hud .w-offer").hidden', 'the offer', 4000);
  assert.match((await read()).offer, new RegExp(`${OVERSPEED.seconds - OVERSPEED.perCharge} s`));
  // all four
  await page.evaluate('__G.debug.rig(); void 0');
  await page.until('document.querySelector("#hud .w-offer").hidden', 'the offer to go', 4000);
  await page.until('/BLOW THE CASCADES/.test(document.querySelector("#hud .prompt span").textContent)', 'F', 4000);
  // H does nothing there now
  await page.holdKey('KeyH', 'h', 0, 1600);
  assert.equal((await read()).running, false);
});

test('a mission that ends or begins again while it runs leaves nothing running, and every casing standing', async () => {
  await atTheFiringPoint();
  await begin();
  await page.evaluate(`${over}.state.progress = 0.7; void 0`);
  await sleep(300);
  assert.ok((await read()).lean > 0);
  await page.evaluate('__G.debug.hurt(500); void 0');
  await page.until('__G.menus.current() === "failed"', 'the failed screen', 10000);
  assert.equal((await read()).running, false);
  await page.evaluate('__G.debug.start(); void 0');
  await sleep(300);
  const fresh = await read();
  assert.deepEqual([fresh.running, fresh.done, fresh.progress, fresh.lean, fresh.standing], [false, false, 0, 0, true]);
  assert.deepEqual(await page.problems(), []);
});

test('with no uplink left, H at the firing point still pushes the drives: the overspeed is not a use of its own', async () => {
  // (17 November 2026, the owner: "limit the number of focus and uplinks a use can do" — not this one)
  await atTheFiringPoint();
  await page.evaluate('__G.wild.feature("uplink").state.usesLeft = 0; void 0');
  await page.until('!document.querySelector("#hud .w-offer").hidden', 'the offer', 4000);
  await begin();
  const begun = await read();
  assert.equal(begun.running, true);
  assert.equal(begun.need, OVERSPEED.seconds);
  assert.equal(
    await page.json('__G.wild.feature("uplink").state.usesLeft'),
    0,
    'holding H for the overspeed neither spends nor gives back an uplink use',
  );
  assert.deepEqual(await page.problems(), []);
});
