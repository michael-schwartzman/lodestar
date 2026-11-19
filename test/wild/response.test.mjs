// The site answers, in the built game (src/wild/response.js holds the rules, test/unit/wild-response.test.mjs
// the arithmetic): a broken wire, an alarm and a task done each bring machines — by doors the player cannot see
// and from the bay, never more at once than the cap, and a wave shut down gives its rounds.
//
// 18 November 2026 — the owner: "every trip wire and every site alarm and completion of a task needs to bring a
// significant amount of enemies".
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GUNS } from '../../src/arms.js';
import { ARMOUR } from '../../src/wild/armour.js';
import { RESPONSE, capOf, sizeOf } from '../../src/wild/response.js';
import { BEAM_DEFS } from '../../src/wild/tripwires.js';
import { LINES } from '../../src/wild/warden.js';
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

const BEAM = BEAM_DEFS.find((b) => b.id === 'corridor-57'); // north-south, x = 57.5, z 42.5..46.5
const MID = (BEAM.z0 + BEAM.z1) / 2;
const OPERATOR = 1;

/** a mission begun with nobody on the site, and every machine that is brought in from now on written down */
const fresh = (target = page) =>
  target.evaluate(`(() => {
    const G = __G, e = G.enemies;
    G.debug.start(); e.clear(); G.debug.speed(1);
    G.player.hidden = false; G.player.health = 1e6;
    window.__came = [];
    if (!e.__reinforce) {
      e.__reinforce = e.reinforce.bind(e);
      e.reinforce = (type, cells, to) => {
        const p = G.player;
        for (const [x, z] of cells)
          window.__came.push({ type, cell: [x, z], t: G.mission.time, to: [to.x, to.z],
            seen: G.world.grid.sight(p.x, p.eye, p.z, x + 0.5, 1.6, z + 0.5),
            off: Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) });
        return e.__reinforce(type, cells, to);
      };
    }
  })()`);
const read = (target = page) =>
  target.json(`(() => {
    const G = __G, f = G.wild.feature('response');
    return { state: f ? f.state() : null, came: window.__came, tally: { ...G.wild.tally }, time: G.mission.time,
      note: document.querySelector('#hud .note').textContent,
      radio: [...document.querySelectorAll('#hud .radio p')].map((p) => p.lastChild.textContent),
      waves: G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).map((u) => ({ type: u.type, wave: u.wave })),
      rounds: Object.fromEntries(Object.entries(G.weapon.arms.guns).map(([k, g]) => [k, g.mag + g.reserve])),
      entries: G.site.entries, bays: G.site.reinforcements };
  })()`);
const running = '__G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).length';
const waiting = '__G.wild.feature("response").state().waiting';

/** walks east through the wire in the service corridor, and is not to be seen once through */
async function cross(target = page) {
  await target.stand(BEAM.x0 - 2.5, MID, -Math.PI / 2);
  await target.keyDown('KeyW', 'w', 0);
  await target.until(`__G.player.x > ${BEAM.x0 + 1.5}`, 'to cross the wire', 6000);
  await target.keyUp('KeyW', 'w', 0);
  await target.evaluate('__G.player.hidden = true; void 0');
}

test('a broken wire brings a wave — three on Operator, by doors the player cannot see and from the bay — and brings it once', async () => {
  await fresh();
  await cross();
  const size = sizeOf('tripwire', OPERATOR);
  await page.until(`${running} === ${size} && ${waiting} === 0`, 'the wave to walk in', 10000);
  const r = await read();
  assert.deepEqual(r.came.map((c) => c.type).sort(), ['drone', 'sentry', 'sentry']);
  for (const c of r.came) {
    const where = c.type === 'sentry' ? r.entries : r.bays;
    assert.ok(
      where.some(([x, z]) => x === c.cell[0] && z === c.cell[1]),
      `a ${c.type} came in at ${c.cell}`,
    );
    // they are sent to the wire
    assert.ok(Math.hypot(c.to[0] - BEAM.x0, c.to[1] - MID) < 0.1, `sent to ${c.to}`);
    if (c.type === 'sentry') {
      assert.equal(c.seen, false, `the door at ${c.cell} was in his sight`);
      assert.ok(c.off >= RESPONSE.far, `the door at ${c.cell} was ${c.off.toFixed(1)} m from him`);
    }
  }
  // by two doors, not one after the other through the same
  const doors = r.came.filter((c) => c.type === 'sentry').map((c) => String(c.cell));
  assert.equal(new Set(doors).size, 2, `both came in at ${doors[0]}`);
  // one at a time
  const times = r.came.map((c) => c.t);
  for (let k = 1; k < times.length; k++)
    assert.ok(times[k] - times[k - 1] >= RESPONSE.gap - 0.1, `${(times[k] - times[k - 1]).toFixed(2)} s between two`);
  // what he is told: Overwatch in the wire's own line, and a note when the first is on its way
  const told = /^Tripwire — Service corridor\. Three coming for the wire — two on foot from the [a-z-]+, one by air\.$/;
  assert.ok(
    r.radio.some((line) => told.test(line)),
    `the radio said: ${r.radio.join(' / ')}`,
  );
  await page.until(`document.querySelector('#hud .note').textContent === 'INBOUND — ${size}'`, 'the note', 6000);
  assert.equal(r.tally.waves, 1);
  assert.deepEqual([r.state.called, r.state.shed, r.state.wires.length], [1, 0, 1]);

  // the same wire, once it is live again: the alarm it always raised, and nobody new
  await page.until(
    `__G.wild.feature('tripwires').beams.find((b) => b.id === '${BEAM.id}').rearmT <= 0`,
    'the wire to be live again',
    12000,
  );
  await page.evaluate('__G.player.hidden = false; void 0');
  await cross();
  await page.until('__G.wild.tally.tripped === 2', 'the second crossing', 4000);
  await sleep(1500);
  const again = await read();
  assert.deepEqual([again.state.called, again.came.length, again.tally.waves], [1, size, 1]);
  assert.deepEqual(await page.problems(), []);
});

test('an alarm a machine raises brings a wave — four on Operator — and while it stands, no second one', async () => {
  await page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.debug.speed(1);
    const e = G.enemies, yaw = ${Math.PI / 2};
    e.remove(e.list.filter((u) => u.name !== 'gate').map((u) => u.rollId));
    Object.assign(e.byName('gate'), { x: 62.5, z: 67.5, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[62, 67]], routeI: 0, path: null, goalX: -1 });
    G.debug.teleport(56.5, 67.5, ${-Math.PI / 2});
    G.player.hidden = false; G.player.health = 1e6;
    window.__came = [];
    G.debug.speed(4);
  })()`);
  try {
    await page.until('__G.enemies.alarm.active', 'the gate to raise the alarm', 30000);
    const size = sizeOf('alarm', OPERATOR);
    await page.until(`${running} === ${size} && ${waiting} === 0`, 'the wave to come in', 20000);
    const r = await read();
    assert.deepEqual([r.state.called, r.state.last.cause, r.state.last.total], [1, 'alarm', size]);
    assert.deepEqual(r.waves.map((u) => u.type).sort(), ['drone', 'sentry', 'sentry', 'sentry']);
    await page.until(
      `[...document.querySelectorAll('#hud .radio p')].some((p) => /^Four coming for the alarm — three on foot from the [a-z-]+, one by air\\.$/.test(p.lastChild.textContent))`,
      'Overwatch to say who is coming',
      20000,
    );
    // …and WARDEN says it too, in its own voice, some seconds after (asked here since 18 November 2026: the
    // suite of WARDEN's own lines runs with the waves switched off)
    await page.until(
      `[...document.querySelectorAll('#hud .radio p')].some((p) => p.firstChild.textContent === 'WARDEN' && ${JSON.stringify(LINES.response)}.includes(p.lastChild.textContent))`,
      'WARDEN to say that more of it is coming',
      20000,
    );
    // it stands, the gate still has him: ten more seconds bring nobody
    const at = r.time;
    await page.until(`__G.mission.time > ${at + 10}`, 'ten seconds of the alarm', 20000);
    const later = await read();
    assert.equal(later.state.called, 1);
    assert.equal(later.tally.waves, 1);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  assert.deepEqual(await page.problems(), []);
});

test('a task done brings a wave that counts what the game sends for it — and shut down to the last machine, it gives its rounds', async () => {
  await page.evaluate('__G.debug.start(); __G.debug.speed(1); __G.player.health = 1e6; window.__came = []; void 0');
  await page.evaluate(
    '{ const c = __G.site.charges.find((c) => c.id === "c3"); __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); __G.player.hidden = true; }',
  );
  await sleep(150);
  await page.press('KeyF', 2400);
  await page.until('__G.mission.chargesPlanted === 1', 'the charge', 3000);
  const size = sizeOf('task', OPERATOR);
  await page.until(`${running} === ${size} && ${waiting} === 0`, 'the wave to come in', 10000);
  const r = await read();
  // the game sent a guard and a drone for the charge, as it always did; two more on foot make four
  assert.deepEqual(
    [r.state.last.cause, r.state.last.total, r.state.last.sentries, r.state.last.drones],
    ['task', size, 2, 0],
  );
  assert.deepEqual(r.waves.map((u) => u.type).sort(), ['drone', 'sentry', 'sentry', 'sentry']);
  assert.equal(new Set(r.waves.map((u) => u.wave)).size, 1, 'they are one wave, whoever sent them');
  await page.until(
    `[...document.querySelectorAll('#hud .radio p')].some((p) => /^Two more coming for the charge — two on foot from the [a-z-]+\\.$/.test(p.lastChild.textContent))`,
    'Overwatch to say who else is coming',
    10000,
  );

  // all but one shut down: nothing yet
  await page.evaluate(
    '{ const w = __G.enemies.list.filter((u) => u.rollId < 0 && !u.dead); for (const u of w.slice(1)) __G.enemies.damage(u, 1e6, 0, 0); }',
  );
  const most = await read();
  assert.deepEqual(most.rounds, r.rounds);
  assert.equal(most.tally.salvaged, undefined);
  // and the last: a cache's worth for every gun — twice over, since the machines were plated (18 November 2026,
  // src/wild/armour.js: a round counts half, and there are twice the rounds)
  await page.evaluate(
    '{ for (const u of __G.enemies.list.filter((u) => u.rollId < 0 && !u.dead)) __G.enemies.damage(u, 1e6, 0, 0); }',
  );
  const done = await read();
  for (const key of Object.keys(GUNS))
    assert.equal(
      done.rounds[key],
      r.rounds[key] + GUNS[key].cache * ARMOUR.plenty,
      `${key} after the wave was shut down`,
    );
  assert.equal(done.note, 'WAVE DOWN — AMMUNITION FROM THE WRECKS');
  assert.equal(done.tally.salvaged, 1);
  assert.deepEqual(done.state.waves, []);
  assert.deepEqual(await page.problems(), []);
});

test('a retry from a checkpoint: the wires that have brought their wave bring none again, and the task’s wave comes again in full', async () => {
  await fresh();
  await cross();
  await page.until(`${running} === 3 && ${waiting} === 0`, 'the wire’s wave', 10000);
  await page.evaluate(
    '{ const c = __G.site.charges.find((c) => c.id === "c3"); __G.debug.teleport(c.stand[0] + 0.5, c.stand[1] + 0.5, 0); }',
  );
  await sleep(150);
  await page.press('KeyF', 2400);
  await page.until('__G.mission.chargesPlanted === 1', 'the charge', 3000);
  const before = await read();
  assert.equal(before.state.wires.length, 1);
  // down, and back
  await page.evaluate('__G.player.health = 100; __G.debug.hurt(1e6); void 0');
  await page.until('__G.menus.current() === "failed"', 'the failed screen', 12000);
  await page.evaluate('window.__came = []; document.querySelector("#menus [data-action=restart]").click(); void 0');
  await page.until('__G.state === "playing"', 'the retry', 8000);
  await page.evaluate('__G.player.health = 1e6; __G.player.hidden = true; void 0');
  const size = sizeOf('task', OPERATOR);
  await page.until(`${running} === ${size} && ${waiting} === 0`, 'the charge’s wave again', 10000);
  const back = await read();
  assert.deepEqual(back.state.wires, before.state.wires, 'the wire is still one that has been');
  assert.equal(new Set(back.waves.map((u) => u.wave)).size, 1, 'one wave: what the game sent again, and the rest');
  assert.equal(back.came.length, size, `${back.came.length} came on the retry`);
  // and that wire, crossed now, brings nobody
  await page.evaluate('__G.player.hidden = false; void 0');
  await cross();
  await page.until('__G.wild.tally.tripped >= 1', 'the crossing', 4000);
  await sleep(1500);
  assert.equal((await read()).came.length, size);
  assert.deepEqual(await page.problems(), []);
});

test('however much is set off, no more than the cap are running — and as they fall, those waiting walk in', async () => {
  await fresh();
  await page.evaluate(`(() => {
    const G = __G, f = G.wild.feature('response');
    G.player.hidden = true;
    for (let k = 0; k < 8; k++) f.respond('alarm', { x: 60, z: 44 });
    window.__most = 0;
    window.__watch = setInterval(() => {
      window.__most = Math.max(window.__most, G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).length);
    }, 50);
    G.debug.speed(4);
  })()`);
  const cap = capOf(OPERATOR);
  try {
    const first = await read();
    assert.deepEqual(
      [first.state.cap, first.state.waiting <= cap, first.state.shed],
      [cap, true, 8 * sizeOf('alarm', OPERATOR) - cap],
    );
    await page.until(`${running} === ${cap}`, 'the cap to be reached', 20000);
    const at = (await read()).time;
    await page.until(`__G.mission.time > ${at + 12}`, 'twelve seconds more', 20000);
    assert.equal(await page.evaluate('window.__most'), cap, 'never more than the cap');
    assert.equal(await page.evaluate(waiting), 0);
    // more is set off with the cap already running: they wait — and walk in as those running fall
    await page.evaluate(
      '{ const f = __G.wild.feature("response"); for (let k = 0; k < 3; k++) f.respond("alarm", { x: 60, z: 44 }); }',
    );
    assert.equal(await page.evaluate(waiting), cap);
    const then = (await read()).time;
    await page.until(`__G.mission.time > ${then + 6}`, 'six seconds at the cap', 20000);
    assert.deepEqual([await page.evaluate(running), await page.evaluate(waiting)], [cap, cap], 'nobody walked in');
    await page.evaluate(
      '{ for (const u of __G.enemies.list.filter((u) => u.rollId < 0 && !u.dead).slice(0, 3)) __G.enemies.damage(u, 1e6, 0, 0); }',
    );
    await page.until(
      `${running} === ${cap} && ${waiting} === ${cap - 3}`,
      'three to walk in for the three down',
      20000,
    );
    assert.equal(await page.evaluate('window.__most'), cap, 'and still never more than the cap');
  } finally {
    await page.evaluate('clearInterval(window.__watch); __G.debug.speed(1); void 0');
  }
  assert.deepEqual(await page.problems(), []);
});

test('the fallen of a wave are cleared away once nobody is looking; those of the roll lie where they fell', async () => {
  await page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true; G.player.health = 1e6;
    // far from everything, in the adit the mission starts in
    const f = G.wild.feature('response');
    f.respond('alarm', { x: 60, z: 44 });
  })()`);
  await page.until(`${running} >= 1`, 'a machine of a wave', 6000);
  await page.evaluate(`(() => {
    const G = __G;
    window.__wave = G.enemies.list.find((u) => u.rollId < 0 && !u.dead);
    window.__roll = G.enemies.list.find((u) => u.rollId >= 0 && !u.dead && u.type === 'sentry');
    G.enemies.damage(window.__wave, 1e6, 0, 0);
    G.enemies.damage(window.__roll, 1e6, 0, 0);
    G.enemies.known();
    G.debug.speed(8);
  })()`);
  try {
    const at = await page.evaluate('__G.mission.time');
    await page.until(`__G.mission.time > ${at + RESPONSE.wreck.after / 2}`, 'half the wait', 20000);
    assert.equal(await page.evaluate('!!window.__wave.gone'), false, 'not before its time');
    await page.until('window.__wave.gone === true', 'the wreck to be cleared away', 30000);
    assert.equal(await page.evaluate('window.__wave.model.root.visible'), false);
    assert.equal(await page.evaluate('!!window.__roll.gone'), false);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  assert.deepEqual(await page.problems(), []);
});

test('response=0: nothing answers — a wire raises the alarm it always did and brings nobody; and a phone is asked to draw fewer', async () => {
  const off = await open(`${PLAY}&response=0`);
  assert.equal(await off.json('__G.wild.feature("response")'), null);
  await fresh(off);
  await cross(off);
  await off.until('__G.wild.tally.tripped === 1', 'the crossing', 4000);
  await sleep(2500);
  const r = await read(off);
  assert.deepEqual([r.came.length, r.waves.length, r.tally.waves], [0, 0, undefined]);
  assert.ok(r.radio.includes('Tripwire — Service corridor.'), `the radio said: ${r.radio.join(' / ')}`);
  assert.deepEqual(await off.problems(), []);
  await off.close();

  const phone = await open(PLAY.replace('touch=0', 'touch=1'));
  await phone.evaluate('__G.debug.start(); void 0');
  assert.equal(await phone.json('__G.wild.feature("response").state().cap'), capOf(OPERATOR, true));
  assert.deepEqual(await phone.problems(), []);
  await phone.close();
});
