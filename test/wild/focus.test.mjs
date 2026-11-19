// Bent time, in the built game (src/wild/focus.js holds the rules, test/unit/wild-focus.test.mjs holds them to
// their numbers; that the game DOES it — two clocks, a key, what is seen of it — is held here).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FOCUS } from '../../src/wild/focus.js';
import { PLAYER } from '../../src/player.js';
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

const read = () =>
  page.json(`(() => {
    const f = __G.wild.feature('focus').state, p = __G.player;
    return { on: f.on, reflex: f.reflexT, meter: f.meter, usesLeft: f.usesLeft, world: f.world, own: f.own,
      time: __G.mission.time, real: __G.time, x: p.x, z: p.z, state: __G.state, fov: __G.camera.fov,
      veil: +getComputedStyle(document.querySelector('#hud .w-focus')).opacity,
      chip: [...document.querySelectorAll('#hud .w-chip')].map((c) => c.textContent).find((t) => /FOCUS/.test(t)) || '',
      note: document.querySelector('#hud .note').textContent, tally: { ...__G.wild.tally } };
  })()`);
const focus = '__G.wild.feature("focus").state';
/**
 * How fast the world's clock runs against the game's own, measured over `ms`. ("Real" seconds, here and below,
 * are the game's own: the seconds its frames add up to. A busy machine draws fewer frames, and cannot move them.)
 */
const worldRate = async (ms) => {
  const a = await read();
  await sleep(ms);
  const b = await read();
  return (b.time - a.time) / (b.real - a.real);
};

test('Y bends time: the world runs at three tenths and the player at a little over half; it is seen; and it ends by itself when the meter is empty', async () => {
  // a quiet stage: the open ground north of the road tunnel, nobody about
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.stand(64.5, 78.5, 0);
  await sleep(400);
  const rest = await read();
  // (17 November 2026, the owner: "limit the number of focus ... uses" — idle, no use is running: the meter
  // rests at nothing, not a full one, and the chip counts the uses left, not a percentage)
  assert.deepEqual([rest.on, rest.meter, rest.world, rest.own, rest.veil], [false, 0, 1, 1, 0]);
  await page.until('/^YFOCUS×3$/.test(document.querySelector("#hud .w-chip").textContent)', 'the chip', 4000);
  const usual = await worldRate(800);
  assert.ok(Math.abs(usual - 1) < 0.02, `left alone the world runs at ${usual.toFixed(2)} of real time`);

  await page.press('KeyY');
  await page.until(`${focus}.on === true`, 'FOCUS to come on', 4000);
  await page.until(`Math.abs(${focus}.world - ${FOCUS.world}) < 0.02`, 'the world to slow', 6000);
  await sleep(250);
  const bentNow = await read();
  assert.ok(Math.abs(bentNow.own - FOCUS.own) < 0.02, `the player's clock is at ${bentNow.own}`);
  assert.ok(bentNow.veil > 0.6, `the edges of the picture are at ${bentNow.veil}`);
  assert.ok(bentNow.fov < rest.fov - 1, `the view is ${bentNow.fov}° where it was ${rest.fov}°`);
  assert.match(bentNow.chip, /^YFOCUSON$/);
  // the world: the mission's own clock, measured against the real one
  const slow = await worldRate(1000);
  assert.ok(Math.abs(slow - FOCUS.world) < 0.03, `bent, the world runs at ${slow.toFixed(2)} of real time`);
  // the player: a walk, measured against the real clock, is a little over half a walk
  const from = await read();
  await page.keyDown('KeyW', 'w', 0);
  await sleep(800);
  const to = await read();
  await page.keyUp('KeyW', 'w', 0);
  const pace = Math.hypot(to.x - from.x, to.z - from.z) / (to.real - from.real);
  assert.ok(
    pace > PLAYER.walk * FOCUS.own * 0.6 && pace < PLAYER.walk * FOCUS.own * 1.1,
    `bent, a walk covers ${pace.toFixed(2)} m a second of real time`,
  );
  assert.ok(to.meter < 0.8 && to.meter > 0, `the meter is at ${to.meter}`);

  // it is spent, and ends: said, and the clocks come back
  await page.until(`${focus}.on === false`, 'FOCUS to be spent', 20000);
  const spent = await read();
  assert.equal(spent.note, 'FOCUS SPENT');
  assert.ok(spent.meter < 0.05);
  assert.ok(spent.tally.focused > 4 && spent.tally.focused < 5.6, `${spent.tally.focused} s of focus were counted`);
  await page.until(`Math.abs(${focus}.world - 1) < 0.01 && Math.abs(${focus}.own - 1) < 0.01`, 'the clocks', 6000);
  await page.until('+getComputedStyle(document.querySelector("#hud .w-focus")).opacity < 0.02', 'the veil', 4000);
  // (17 November 2026, the owner: a use spent does not mean the meter is empty of a floor — it is a second use
  // of three, and a fresh press begins it at a full meter again)
  assert.equal(spent.usesLeft, 2);
  await page.press('KeyY');
  await page.until(`${focus}.on === true`, 'a second use to begin', 3000);
  assert.ok((await read()).meter > 0.95, 'a fresh use begins at a full meter');
  await page.press('KeyY');
  await page.until(`${focus}.on === false`, 'the second use to be let go of', 3000);
});

test('FOCUS: three uses a mission — each ended early, so what was left of it is lost — and a fourth is refused once, loud; the chip counts them down', async () => {
  // (17 November 2026, the owner: "also limit the number of focus and uplinks a use can do")
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.until(
    '/×3$/.test(document.querySelector("#hud .w-chip").textContent)',
    'the chip to show three left',
    4000,
  );
  for (let left = 3; left >= 1; left--) {
    await page.press('KeyY');
    await page.until(
      `${focus}.on === true && ${focus}.usesLeft === ${left - 1}`,
      `use ${4 - left} to begin, spending one`,
      4000,
    );
    await page.press('KeyY'); // let go of early: what was left of it is lost, not kept for the next
    await page.until(`${focus}.on === false`, `use ${4 - left} to be let go of`, 4000);
    await page.until(
      `document.querySelector("#hud .w-chip").textContent.endsWith("×${left - 1}")`,
      `the chip to show ×${left - 1}`,
      4000,
    );
  }
  assert.equal((await read()).usesLeft, 0);
  // the third use's bend eases back to nothing (damp(), not a jump) before the fourth press is made of it
  await page.until(`${focus}.world > 0.999`, 'the bend to ease all the way back off', 2000);
  // a fourth: refused once, said once, and bends nothing
  await page.press('KeyY');
  await page.until('document.querySelector("#hud .note").textContent === "NO FOCUS LEFT"', 'the refusal', 4000);
  const refused = await read();
  assert.deepEqual([refused.on, refused.usesLeft], [false, 0]);
  // damp() eases toward 1 but, being exponential, never strikes it exactly — close enough is all of it there is
  assert.ok(refused.world > 0.999, `a refused press still bends nothing: world is ${refused.world}`);
});

test('paused, nothing runs: not the world, not the meter — and resumed, time is bent as it was', async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.press('KeyY');
  await page.until('__G.wild.feature("focus").state.on === true', 'FOCUS to come on', 3000);
  await sleep(500);
  await page.evaluate('__G.debug.pause(); void 0');
  const a = await read();
  await sleep(1200);
  const b = await read();
  assert.equal(b.state, 'paused');
  assert.deepEqual([b.meter, b.time, b.on], [a.meter, a.time, true]);
  await page.evaluate('__G.debug.resume(); void 0');
  await sleep(400);
  const c = await read();
  assert.ok(c.on && c.meter < b.meter && c.time > b.time);
  await page.press('KeyY');
  await page.until('__G.wild.feature("focus").state.on === false', 'FOCUS to be let go of', 3000);
});

test('the REFLEX: a machine makes you out, and the world all but stops for a little over two seconds — once, and then it rests', async () => {
  await page.evaluate('__G.debug.start(); void 0');
  // the road patrol, seven metres in front of it, under the yard lamps (test/smoke.test.mjs does the same)
  await page.evaluate(
    '{ const u = __G.enemies.byName("road"); __G.debug.teleport(u.x - Math.sin(u.yaw) * 7, u.z - Math.cos(u.yaw) * 7, u.yaw + Math.PI); }',
  );
  await page.until('__G.wild.feature("focus").state.reflexT > 0', 'the reflex', 15000);
  const began = await read();
  assert.equal(await page.evaluate('__G.enemies.byName("road").brain.state'), 'combat');
  assert.equal(began.note, 'REFLEX');
  assert.equal(began.tally.reflexes, 1);
  // (17 November 2026, the owner: the meter rests at nothing when no use is running — a reflex does not touch
  // it either way, which is the same claim the original had, now at the new resting value)
  assert.equal(began.meter, 0, 'a reflex is not paid for out of the meter');
  await page.until(`Math.abs(${focus}.world - ${FOCUS.reflex.world}) < 0.03`, 'the world all but to stop', 6000);
  const deep = await read();
  assert.ok(deep.reflex > 0, 'the reflex was over before the world had slowed');
  assert.match(deep.chip, /^YFOCUSREFLEX$/);
  // while it lasts the machine that saw you has not had time to call the alarm
  assert.equal(await page.evaluate('__G.enemies.alarm.active'), false);
  // it ends by itself, about when it should on the real clock
  await page.until(`${focus}.reflexT === 0`, 'the reflex to end', 15000);
  const over = await read();
  const lasted = over.real - began.real;
  assert.ok(
    lasted > FOCUS.reflex.seconds - 0.5 && lasted < FOCUS.reflex.seconds + 0.5,
    `it lasted ${lasted.toFixed(2)} s`,
  );
  // …and there is not another straight away: break contact, be seen again, and time runs as it runs
  await page.evaluate('__G.debug.start(); void 0');
  await page.evaluate(
    '{ const f = __G.wild.feature("focus").state; f.coolT = 20; const u = __G.enemies.byName("road"); __G.debug.teleport(u.x - Math.sin(u.yaw) * 7, u.z - Math.cos(u.yaw) * 7, u.yaw + Math.PI); }',
  );
  await page.until('__G.enemies.byName("road").brain.state === "combat"', 'to be seen again', 15000);
  const again = await read();
  assert.deepEqual(
    [again.reflex, again.tally.reflexes || 0],
    [0, 0],
    'a second reflex came while the first was being rested from',
  );
});

test('the REFLEX is not a use: it is free even once every FOCUS use is spent', async () => {
  // (17 November 2026, the owner: the reflex "stays free, with its rest of 25 seconds, exactly as it is")
  await page.evaluate('__G.debug.start(); void 0');
  await page.evaluate('__G.wild.feature("focus").state.usesLeft = 0; void 0');
  await page.evaluate(
    '{ const u = __G.enemies.byName("road"); __G.debug.teleport(u.x - Math.sin(u.yaw) * 7, u.z - Math.cos(u.yaw) * 7, u.yaw + Math.PI); }',
  );
  await page.until('__G.wild.feature("focus").state.reflexT > 0', 'the reflex, with no FOCUS use left', 15000);
  // the ring/state (every frame) can be ahead of the chip (redrawn a few times a second)
  await page.until(
    'document.querySelector("#hud .w-chip").textContent === "YFOCUSREFLEX"',
    'the chip to catch up and say REFLEX',
    2000,
  );
  const began = await read();
  assert.equal(began.usesLeft, 0, 'the reflex spent no use of its own');
  assert.match(began.chip, /^YFOCUSREFLEX$/);
  await page.until(`Math.abs(${focus}.world - ${FOCUS.reflex.world}) < 0.03`, 'the world all but to stop', 6000);
});

test('a kill while a use runs puts the time back on it — never above a full meter; it is spent on no use while FOCUS is off (the unit tests hold that one down)', async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; void 0');
  // (17 November 2026, the owner: earn now puts time back on the use that is RUNNING — so one must be running)
  await page.press('KeyY');
  await page.until('__G.wild.feature("focus").state.on === true', 'a use to be running', 3000);
  const set = (meter) => page.evaluate(`__G.wild.feature("focus").state.meter = ${meter}; void 0`);
  // (18 November 2026: the meter is set, the machine taken down and the meter read in ONE step. A use that is
  // running runs down, a fifth of the meter a second: set, done and read in three steps, on a machine under
  // load the steps were once 170 ms apart and the figure 0.03 short. What is asked is the same, and exactly.)
  const taken = await page.json(`(() => {
    const f = __G.wild.feature("focus").state;
    f.meter = 0.2;
    __G.enemies.takedown(__G.enemies.byName("road"));
    return { meter: __G.wild.feature("focus").state.meter };
  })()`);
  assert.ok(
    Math.abs(taken.meter - (0.2 + FOCUS.gain.takedown)) < 1e-9,
    `after a takedown the meter is at ${taken.meter}`,
  );
  // a head shot: the gate's sentry, from four metres behind it, with the sight at the eye — one round.
  // (18 November 2026: a head is behind a visor now, and the first round to it only cracks it — src/wild/visor.js.
  // This sentry's has been cracked by a round before, so that the one fired here is the one that shuts it down.)
  // (The meter is set to 0.6 here, three seconds of a use: at 0.2 there was one second for the sight to come up
  // in, and on a machine busy with other things it took 1.24 — the use ran out, and a use that is over earns
  // nothing. What is asked is the same: what is left, and a head shot's share on top of it.)
  // (18 November 2026, later: the machines are plated as well — src/wild/armour.js — and a round through a
  // cracked visor is 51, not 102. What is asked here is what a head shot that SHUTS A MACHINE DOWN earns: the
  // sentry is left with forty, so that this one round is that shot.)
  await set(0.6);
  const t0 = await page.evaluate('Date.now()');
  await page.evaluate(
    `{ const u = __G.enemies.byName("gate"); const p = __G.player; __G.weapon.arms.mode = "semi";
       __G.wild.plate({ unit: u, zone: 'head', multiplier: 3, t: 4 });
       u.hp = 40;
       __G.debug.teleport(u.x + Math.sin(u.yaw) * 4, u.z + Math.cos(u.yaw) * 4, u.yaw);
       p.pitch = Math.atan2(u.spec.hit[0][0] - p.eye, 4); }`,
  );
  await page.press('KeyZ');
  await page.until('__G.weapon.aim > 0.98', 'the sight to come up', 4000);
  await sleep(150);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await sleep(60);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await page.until('__G.enemies.byName("gate").dead === true', 'the head shot to land', 4000);
  // (raising the sight takes real time, during which the meter it is added to has itself been running down)
  const t1 = await page.evaluate('Date.now()');
  const ranDownTo = Math.max(0, 0.6 - (t1 - t0) / 1000 / FOCUS.seconds);
  const shot = await read();
  assert.ok(
    Math.abs(shot.meter - (ranDownTo + FOCUS.gain.head)) < 0.02,
    `after a head shot (${((t1 - t0) / 1000).toFixed(2)} s raising the sight) the meter is at ${shot.meter}, wanted near ${(ranDownTo + FOCUS.gain.head).toFixed(3)}`,
  );
  await page.press('KeyZ');
  await page.evaluate('__G.weapon.arms.mode = "auto"; void 0');
});

test('a mission that ends while time is bent lets go of it: the next one begins with the clocks at 1, no use running, and three fresh uses', async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.press('KeyY');
  await page.until('__G.wild.feature("focus").state.on === true', 'FOCUS to come on', 3000);
  await sleep(400);
  await page.evaluate('__G.debug.hurt(500); void 0');
  await page.until('__G.menus.current() === "failed"', 'the failed screen', 10000);
  const down = await read();
  assert.deepEqual([down.on, down.world, down.own], [false, 1, 1]);
  assert.ok(down.veil < 0.02);
  await page.evaluate('__G.debug.start(); void 0');
  await sleep(300);
  const fresh = await read();
  assert.deepEqual([fresh.on, fresh.meter, fresh.world, fresh.usesLeft], [false, 0, 1, FOCUS.uses]);
  // a checkpoint keeps the uses left too (asked in one breath: a frame between would let the mission run)
  assert.deepEqual(
    await page.json(
      '(() => { const f = __G.wild.feature("focus").state; f.usesLeft = 1; const kept = __G.wild.save(); __G.wild.reset(); const after = f.usesLeft; __G.wild.load(kept); return [after, f.usesLeft]; })()',
    ),
    [FOCUS.uses, 1],
  );
  assert.deepEqual(await page.problems(), []);
});
