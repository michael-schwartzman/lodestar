// The uplink, in the built game (src/wild/uplink.js holds the rules, test/unit/wild-uplink.test.mjs holds them to
// their numbers): the key held on a real machine, a turned sentry among its own kind, and what it must not break.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { UPLINK, WITNESS } from '../../src/wild/uplink.js';
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

const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
/**
 * A stage on the open ground of the main cavern (x 54 … 72, z 65 … 69 is bare floor; so is the ground south of it
 * to z 75 at x 59 … 64 and x 66 … 68): every machine cleared off but those named, each put where it is told
 * ([x, z, yaw]) and standing its post there; the player out of the way and not to be seen.
 */
const stage = (places) =>
  page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true; G.debug.teleport(36.5, 70.5, 0);
    const e = G.enemies, places = ${JSON.stringify(places)};
    e.remove(e.list.filter((u) => !(u.name in places)).map((u) => u.rollId));
    for (const [name, [x, z, yaw]] of Object.entries(places))
      Object.assign(e.byName(name), { x, z, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[Math.floor(x), Math.floor(z)]], routeI: 0, path: null, goalX: -1 });
  })()`);
const unit = (name) => `__G.enemies.byName("${name}")`;
const chipExpr = `([...document.querySelectorAll('#hud .w-chip')].map((c) => c.textContent).find((t) => /UPLINK/.test(t)) || '')`;
const read = () =>
  page.json(`(() => {
    const G = __G, f = G.wild.feature('uplink'), u = f.state, link = document.querySelector('#hud .w-link');
    const of = (name) => { const m = G.enemies.byName(name); return m && { turned: m.turned || 0, dead: m.dead, hp: m.hp, state: m.brain.state,
      aware: m.brain.awareness, x: m.x, z: m.z, eye: m.eyeMat ? m.eyeMat.uniforms.uColor.value.toArray() : null }; };
    return { progress: u.progress, cool: u.cool, usesLeft: u.usesLeft, target: f.target ? f.target.name : null,
      link: link.dataset.state || '', label: link.textContent,
      chip: ${chipExpr},
      note: document.querySelector('#hud .note').textContent, tally: { ...G.wild.tally }, kills: G.kills, down: G.mission.hostilesDown,
      alarm: { ...G.enemies.alarm }, mood: G.enemies.mood(), player: [G.player.x, G.player.z], gate: of('gate'), road: of('road') };
  })()`);
/** the player eight metres south of a machine, looking at the middle of it */
const lookAt = (name, metres = 8) =>
  page.evaluate(
    `{ const u = ${unit(name)}; __G.debug.teleport(u.x, u.z + ${metres}, 0); __G.player.pitch = Math.atan2(1.26 - __G.player.eye, ${metres}); }`,
  );

test('H held on a machine in the sights for a little over a second takes it; let go early, nothing is taken; and then the link must recharge', async () => {
  await stage({ gate: [60.5, 68.5, EAST], road: [66.5, 68.5, WEST] });
  await page.evaluate(`${unit('road')}.hp = 1e6; void 0`);
  await lookAt('gate');
  // a machine in the sights, within reach: the screen says it can be taken
  await page.until('document.querySelector("#hud .w-link").dataset.state === "ready"', 'the offer', 3000);
  const offered = await read();
  assert.equal(offered.target, 'gate');
  assert.match(offered.label, /H.*UPLINK/);
  // (17 November 2026, the owner: "limit the number of ... uplinks a use can do" — the chip counts uses, not READY)
  assert.match(offered.chip, /^HUPLINK×3$/);

  // held, but not for long enough: it builds, runs back down, and nothing is taken
  await page.holdKey('KeyH', 'h', 0, 450);
  const early = await read();
  assert.ok(early.progress > 0 || early.link === 'linking', JSON.stringify(early));
  await page.until('__G.wild.feature("uplink").state.progress === 0', 'what was built up to run down', 3000);
  const none = await read();
  assert.deepEqual([none.gate.turned, none.cool, none.tally.turned || 0], [0, 0, 0]);

  // held: it is the player's
  await page.keyDown('KeyH', 'h', 0);
  try {
    await page.until(`${unit('gate')}.turned > 0`, 'the machine to be taken', 4000);
  } finally {
    await page.keyUp('KeyH', 'h', 0);
  }
  await sleep(150);
  const taken = await read();
  assert.ok(taken.gate.turned > UPLINK.turned.seconds - 2, `it is the player's for ${taken.gate.turned} s`);
  assert.equal(taken.note, 'UPLINK — IT IS YOURS');
  assert.equal(taken.tally.turned, 1);
  // a fresh mind: nothing of what it knew
  assert.deepEqual([taken.gate.state, taken.gate.aware], ['patrol', 0]);
  // its eye is the eye of a machine that is held: blue
  assert.ok(taken.gate.eye[2] > 0.9 && taken.gate.eye[0] < 0.7, `its eye is ${taken.gate.eye}`);
  assert.match(taken.chip, /^HUPLINK\d+ s$/);
  assert.ok(taken.cool > UPLINK.recharge - 2);
  // it is not offered again, and it is nobody's target for a takedown
  assert.equal(taken.target, null);

  // while the link recharges another cannot be taken, and the screen says so
  await lookAt('road', 6);
  await page.until('__G.wild.feature("uplink").target === __G.enemies.byName("road")', 'the other in the sights', 3000);
  await page.holdKey('KeyH', 'h', 0, 500);
  const cold = await read();
  assert.equal(cold.note, 'UPLINK RECHARGING');
  assert.equal(cold.road.turned, 0);
  assert.equal(cold.link, 'cold');
});

test('UPLINK: three uses a mission, spent only when a link completes — a fourth is refused once, loud, and builds nothing; the chip counts them down', async () => {
  // (17 November 2026, the owner: "also limit the number of focus and uplinks a use can do")
  await stage({
    gate: [56.5, 68.5, EAST],
    road: [60.5, 68.5, EAST],
    yardEast: [64.5, 68.5, EAST],
    hallLoop: [68.5, 68.5, EAST],
  });
  const names = ['gate', 'road', 'yardEast'];
  for (let i = 0; i < names.length; i++) {
    await lookAt(names[i]);
    await page.until('document.querySelector("#hud .w-link").dataset.state === "ready"', `${names[i]} offered`, 3000);
    // the ring (every frame) can be ready before the chip (redrawn a few times a second) has caught up to it
    await page.until(`${chipExpr} === "HUPLINK×${3 - i}"`, `the chip to show ${3 - i} before use ${i + 1}`, 2000);
    await page.keyDown('KeyH', 'h', 0);
    try {
      await page.until(`${unit(names[i])}.turned > 0`, `use ${i + 1} to complete`, 4000);
    } finally {
      await page.keyUp('KeyH', 'h', 0);
    }
    await sleep(100);
    assert.equal((await read()).usesLeft, 2 - i, `${2 - i} left after use ${i + 1}`);
    // taken, then frozen and put out of the fight: so it cannot find or fire on the ones not yet taken while
    // this loop runs (that fight is the next test's claim, not this one's), and its recharge is skipped here —
    // the 28 s recharge between two links is the first test's claim, not this one's
    await page.evaluate(`{ ${unit(names[i])}.stunT = 1e6; __G.wild.feature('uplink').state.cool = 0; }`);
  }
  // a fourth: refused once, loud, and nothing is built
  await lookAt('hallLoop');
  await page.until(
    'document.querySelector("#hud .w-link").dataset.state === "spent"',
    'the ring to say none are left',
    3000,
  );
  await page.until(`${chipExpr} === "HUPLINK×0"`, 'the chip to say none are left', 2000);
  assert.match((await read()).chip, /^HUPLINK×0$/);
  await page.holdKey('KeyH', 'h', 0, 500);
  const refused = await read();
  assert.deepEqual([refused.note, refused.progress, refused.usesLeft], ['UPLINK SPENT', 0, 0]);
  assert.equal(await page.evaluate(`${unit('hallLoop')}.turned || 0`), 0, 'nothing was taken on the fourth try');
  assert.deepEqual(await page.problems(), []);
});

test('a turned sentry fires on its own kind; they fire back once hit; and the alarm that is raised names IT — not the player, who was never seen', async () => {
  await stage({ gate: [60.5, 68.5, EAST], road: [68.5, 68.5, WEST] });
  // (so that the fight lasts long enough to be read)
  await page.evaluate(
    `{ const g = ${unit('gate')}, r = ${unit('road')}; g.hp = g.hpMax = 1e6; r.hp = r.hpMax = 1e6; __G.wild.feature('uplink').turn(g); }`,
  );
  const quiet = await read();
  assert.equal(quiet.road.state, 'patrol', 'its own kind do not know it yet');
  await page.until(`${unit('road')}.hp < 1e6`, 'the turned machine to hit one of its own kind', 8000);
  await page.until(`${unit('road')}.brain.state === "combat"`, 'the one it hit to turn on it', 3000);
  await page.until(`${unit('gate')}.hp < 1e6`, 'the loyal one to fire back', 10000);
  await page.until('__G.enemies.alarm.active', 'the alarm', 15000);
  const fought = await read();
  const off = Math.hypot(fought.alarm.x - fought.gate.x, fought.alarm.z - fought.gate.z);
  assert.ok(off < 3, `the alarm names a place ${off.toFixed(1)} m from the turned machine`);
  assert.ok(
    Math.hypot(fought.alarm.x - fought.player[0], fought.alarm.z - fought.player[1]) > 15,
    'the alarm names where the player is',
  );
  assert.equal(fought.alarm.count, 1, 'a machine raised it: it counts');
  // a kill of its is a machine down, counted on the roll, and on the experiment's tally
  await page.evaluate(`${unit('road')}.hp = 1; void 0`);
  await page.until(`${unit('road')}.dead === true`, 'the turned machine to finish it', 8000);
  const won = await read();
  assert.deepEqual([won.kills, won.down, won.tally.turnedKills], [1, 1, 1]);
});

test('with nothing to fire on it comes to heel — and after forty seconds it burns out: a machine down', async () => {
  await stage({ gate: [60.5, 68.5, EAST] });
  await page.evaluate('__G.debug.teleport(62.5, 78.5, 0); void 0');
  await page.evaluate(`__G.wild.feature('uplink').turn(${unit('gate')}); void 0`);
  const heel = `Math.hypot(${unit('gate')}.x - __G.player.x, ${unit('gate')}.z - __G.player.z)`;
  await page.until(`${heel} < ${UPLINK.turned.heel + 1.2}`, 'it to come to heel', 15000);
  const near = await read();
  assert.deepEqual([near.gate.dead, near.mood], [false, 'calm'], 'a turned machine is not the site waking up');
  // behind it, at arm's length: it is not there to be taken down by hand
  assert.equal(
    await page.evaluate(
      `(() => { const u = ${unit('gate')}, p = __G.player; __G.debug.teleport(u.x + Math.sin(u.yaw) * 1.2, u.z + Math.cos(u.yaw) * 1.2, u.yaw); return __G.enemies.takedownTarget(p) === null; })()`,
    ),
    true,
  );
  await page.evaluate('__G.debug.speed(8); void 0');
  try {
    await page.until(`${unit('gate')}.dead === true`, 'it to burn out', 12000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  const burned = await read();
  assert.equal(burned.note, 'YOUR MACHINE HAS BURNED OUT');
  assert.deepEqual([burned.kills, burned.down], [1, 1]);
});

test('a mission begun again while a machine is turned begins with every machine loyal and the link ready', async () => {
  await stage({ gate: [60.5, 68.5, EAST], road: [68.5, 68.5, WEST] });
  await page.evaluate(`__G.wild.feature('uplink').turn(${unit('gate')}); void 0`);
  // two uses spent (one would also do, but this shows the restart gives back however many are gone, not just one)
  await page.evaluate('__G.wild.feature("uplink").state.usesLeft = 1; void 0');
  await sleep(300);
  await page.evaluate('__G.debug.start(); void 0');
  await sleep(300);
  assert.deepEqual(
    await page.json(
      '({ turned: __G.enemies.list.filter((u) => u.turned).length, cool: __G.wild.feature("uplink").state.cool, tally: __G.wild.tally })',
    ),
    { turned: 0, cool: 0, tally: {} },
  );
  // a mission begun again gives back three uses, however many were spent
  assert.equal(await page.json('__G.wild.feature("uplink").state.usesLeft'), UPLINK.uses);
  // a checkpoint keeps how far the link has recharged and how many uses are left (asked in one breath: a frame
  // between would run the recharge down) — (17 November 2026, the owner: "limit the number of ... uplinks")
  assert.deepEqual(
    await page.json(
      `(() => { const u = __G.wild.feature("uplink").state; u.cool = 17; u.usesLeft = 1; const kept = __G.wild.save();
        __G.wild.reset(); const fresh = [u.cool, u.usesLeft]; __G.wild.load(kept); return [fresh, [u.cool, u.usesLeft]]; })()`,
    ),
    [
      [0, UPLINK.uses],
      [17, 1],
    ],
  );
  assert.deepEqual(await page.problems(), []);
});

// ---------- PART 2: witnesses (17 November 2026, the owner: "once uplink fire is being used the alarm still
// should be triggered once other robots see that their friends are being fired at") ----------
// The pure part — who counts as a witness, by range/line/loyalty/running/unstunned — is held without a browser
// in test/unit/wild-uplink.test.mjs. These four stage it for real: real machines, a real shot, the site's own
// alarm.count and a watcher's own brain.state read back from the page.
const mouse = (type) => page.send('Input.dispatchMouseEvent', { type, x: 640, y: 360, button: 'left', clickCount: 1 });
/** the player far enough off (20+ m) to rule out the player's own sight ever being the reason the alarm comes */
const hideFar = () => page.evaluate('__G.debug.teleport(36.5, 40.5, 0); void 0');

test('a turned sentry fires on loyal B; loyal C, 10–12 m off with a clear line to B and its back to the fight, has seen it: the alarm is called within 2.5 s of the first shot, named at the turned machine, far from the player, counted once — and C fights though it was never fired at', async () => {
  await stage({ gate: [54.5, 68.5, EAST], road: [58.5, 68.5, EAST], yardEast: [69.5, 68.5, EAST] });
  await hideFar();
  await page.evaluate(
    `{ const g = ${unit('gate')}, r = ${unit('road')}; g.hp = g.hpMax = 1e6; r.hp = r.hpMax = 1e6; }`,
  );
  const t0 = await page.json('__G.mission.time');
  await page.evaluate(`__G.wild.feature('uplink').turn(${unit('gate')}); void 0`);
  await page.until('__G.enemies.alarm.active', 'the alarm', 6000);
  const t2 = await page.json('__G.mission.time');
  const fought = await read();
  const off = Math.hypot(fought.alarm.x - fought.gate.x, fought.alarm.z - fought.gate.z);
  assert.ok(off < 2, `the alarm names a place ${off.toFixed(1)} m from the turned machine`);
  assert.ok(
    Math.hypot(fought.alarm.x - fought.player[0], fought.alarm.z - fought.player[1]) > 15,
    'far from the player, who was never seen',
  );
  assert.equal(fought.alarm.count, 1, "a witness's machine raised it: it counts once");
  // the first shot fires once the windup (a known, fixed constant) has run since turn() — gate was already
  // facing road, so no turning time is spent first; this is this suite's own measured alarm delay
  const delay = t2 - t0 - UPLINK.turned.windup;
  assert.ok(
    delay <= WITNESS.alarmDelay + 0.6,
    `the alarm came ${delay.toFixed(2)} s after the first shot a witness saw`,
  );
  const c = await page.json(`(() => { const u = ${unit('yardEast')}; return [u.brain.state, u.hp]; })()`);
  assert.deepEqual(c, ['combat', 100], 'C fights the shooter, and was never itself hit');
});

test('loyal B at 1 hp dies on the hit that lands; loyal C, watching, still saw it happen — the alarm still comes', async () => {
  await stage({ gate: [54.5, 68.5, EAST], road: [58.5, 68.5, EAST], yardEast: [69.5, 68.5, EAST] });
  await hideFar();
  // C must outlast the 2.5 s window regardless of what gate does once B is gone (it will retarget onto the
  // only other loyal machine left, same as it would onto any of its own kind still standing) — only B is the
  // one meant to go down here
  await page.evaluate(
    `{ const g = ${unit('gate')}, c = ${unit('yardEast')}; g.hp = g.hpMax = 1e6; c.hp = c.hpMax = 1e6; ${unit('road')}.hp = 1; }`,
  );
  await page.evaluate(`__G.wild.feature('uplink').turn(${unit('gate')}); void 0`);
  await page.until(`${unit('road')}.dead === true`, 'B to die on the hit that lands', 6000);
  await page.until('__G.enemies.alarm.active', 'the alarm still called though the one fired at is gone', 6000);
  assert.equal(await page.json('__G.enemies.alarm.count'), 1, 'counted once');
  assert.equal(
    await page.json(`${unit('yardEast')}.brain.state`),
    'combat',
    "C — the one whose line carried the alarm once B's own was gone — fights the shooter",
  );
});

test('the alarm a witness raises is HEARD — the stroke, the siren, Overwatch saying why — when no machine could have called it itself', async () => {
  // (found in review, 17 November 2026: this alarm was raised and counted and not sounded — the scripted alarm
  // it is raised through says nothing by itself. The tests above could not have shown it: in them a machine that
  // is fighting the turned one may call the alarm itself, through the game, which does sound. Here nothing can:
  // B dies on the first hit, and C — which saw it — is stopped where it stands, as an EMP stops a machine.)
  await stage({ gate: [54.5, 68.5, EAST], road: [58.5, 68.5, EAST], yardEast: [69.5, 68.5, EAST] });
  await hideFar();
  await page.evaluate(`(() => {
    const a = __G.audio;
    window.__heard = { play: [], loop: [] };
    if (a.__play) return;
    a.__play = a.play;
    a.__loop = a.loop;
    a.play = (name, o) => { window.__heard.play.push(name); return a.__play(name, o); };
    a.loop = (name, o) => { window.__heard.loop.push(name); return a.__loop(name, o); };
  })()`);
  await page.evaluate(
    `{ const g = ${unit('gate')}, c = ${unit('yardEast')}; g.hp = g.hpMax = 1e6; c.hp = c.hpMax = 1e6; ${unit('road')}.hp = 1; }`,
  );
  await page.evaluate(`__G.wild.feature('uplink').turn(${unit('gate')}); void 0`);
  await page.until(`${unit('road')}.dead === true`, 'B to die on the hit that lands', 6000);
  const shot = await page.json('__G.mission.time');
  await page.evaluate(`${unit('yardEast')}.stunT = 60; void 0`);
  assert.equal(
    await page.json('__G.enemies.alarm.active'),
    false,
    'the alarm was up before the witness rule could call it',
  );
  await page.until('__G.enemies.alarm.active', 'the alarm', 6000);
  const after = (await page.json('__G.mission.time')) - shot;
  assert.ok(after <= WITNESS.alarmDelay + 0.2, `the alarm came ${after.toFixed(2)} s after the shot that was seen`);
  const heard = await page.json('window.__heard');
  assert.ok(heard.play.includes('alarmHit'), `the stroke was not heard: ${heard.play}`);
  assert.ok(heard.loop.includes('alarm'), `the siren was not started: ${heard.loop}`);
  const radio = await page.json(
    '[...document.querySelectorAll("#hud .radio p")].map((p) => [p.firstChild.textContent, p.lastChild.textContent])',
  );
  assert.ok(
    radio.some(([who, text]) => who === 'OVERWATCH' && /saw your machine fire on their own/.test(text)),
    JSON.stringify(radio),
  );
  const fought = await read();
  assert.equal(fought.alarm.count, 1, 'counted once');
  assert.ok(
    Math.hypot(fought.alarm.x - fought.gate.x, fought.alarm.z - fought.gate.z) < 2,
    'named at the turned machine',
  );
  assert.deepEqual(await page.problems(), []);
});

test('loyal B alone at 1 hp, with every other machine behind real walls: a hit lands, but with no witness that has a line, no alarm from this rule comes within six seconds', async () => {
  await stage({
    gate: [54.5, 68.5, EAST],
    road: [58.5, 68.5, EAST],
    control: [79.5, 39.5, 0],
    switchgear: [94.5, 36.5, 0],
  });
  // a sanity check, so this test fails loudly (not mysteriously) if the map's own walls ever move: confirm by
  // hand that control and switchgear truly have no line to either machine in the fight
  const lineOf = (name) =>
    page.json(`(() => { const g = ${unit('gate')}, r = ${unit('road')}, u = ${unit(name)};
      return __G.world.grid.sight(u.x, u.spec.eye, u.z, g.x, 1.4, g.z) || __G.world.grid.sight(u.x, u.spec.eye, u.z, r.x, 1.25, r.z); })()`);
  assert.equal(await lineOf('control'), false, 'control must truly have no line here for this test to mean anything');
  assert.equal(
    await lineOf('switchgear'),
    false,
    'switchgear must truly have no line here for this test to mean anything',
  );
  await hideFar();
  await page.evaluate(`{ const g = ${unit('gate')}; g.hp = g.hpMax = 1e6; ${unit('road')}.hp = 1; }`);
  const t0 = await page.json('__G.mission.time');
  await page.evaluate(`__G.wild.feature('uplink').turn(${unit('gate')}); void 0`);
  await page.until(`${unit('road')}.dead === true`, 'B to die', 6000);
  await page.until(`__G.mission.time - ${t0} >= 6`, "six seconds of the game's own clock to pass", 12000);
  assert.equal(await page.json('__G.enemies.alarm.active'), false, 'no witness had a line: no alarm from this rule');
});

test("the flown drone's own gun, firing on a loyal machine, is seen the same way: a witness calls the alarm", async () => {
  await stage({ droneYard: [62.5, 66.5, EAST], gate: [62.5, 59.5, EAST], road: [68.5, 59.5, EAST] });
  await hideFar();
  await page.evaluate(`{ const g = ${unit('gate')}; g.hp = g.hpMax = 1e6; }`);
  await page.evaluate(`__G.wild.feature('pilot').fly(${unit('droneYard')}); void 0`);
  // looking straight down the row at the sentry seven metres north of it, same as test/wild/pilot.test.mjs
  await page.evaluate(
    `{ const f = __G.wild.feature('pilot').flight, d = ${unit('droneYard')}; f.yaw = 0; f.pitch = Math.atan2(1.26 - d.y, 7); }`,
  );
  await mouse('mousePressed');
  try {
    await page.until(`${unit('gate')}.hp < 1e6`, "the drone's gun to hit the loyal sentry", 6000);
  } finally {
    await mouse('mouseReleased');
  }
  await page.until('__G.enemies.alarm.active', "the alarm, called by a witness of the drone's own gun", 6000);
  assert.equal(await page.json('__G.enemies.alarm.count'), 1, 'counted once');
  assert.equal(await page.json(`${unit('road')}.brain.state`), 'combat', 'the witness fights, though never fired at');
  assert.deepEqual(await page.problems(), []);
});
