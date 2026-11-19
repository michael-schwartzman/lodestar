// Threads of light, in the built game (src/wild/tripwires.js holds the rules, test/unit/wild-tripwires.test.mjs
// holds them to their numbers; that the game DOES it — a thread drawn, a trip heard and told, an emitter shot
// dead, an EMP's reach, a checkpoint that remembers — is held here).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BEAM_DEFS } from '../../src/wild/tripwires.js';
import { LINES } from '../../src/wild/warden.js';
import { PLAY, openWith, sleep, startWild } from './helpers.mjs';

let harness;
let page;

before(async () => {
  harness = await startWild();
  // (18 November 2026: since that day a broken wire brings a wave, whose own note — INBOUND — is on the screen
  // two and a half seconds after the wire's, and WARDEN speaks of it eight seconds on: src/wild/response.js.
  // This suite reads the wire's note and WARDEN's line for the wire a moment after the crossing; so the site's
  // answer is switched off on its page. What a wire brings is asked in test/wild/response.test.mjs.)
  page = await openWith(harness)(`${PLAY}&response=0`);
});

after(async () => {
  await harness?.stop();
});

// three beams stand in for all eight in the scenarios below; every placement is proved against the real grid
// in test/unit/wild-tripwires.test.mjs, not here
const LOW_BEAM = BEAM_DEFS.find((b) => b.id === 'corridor-57'); // north-south, x = 57.5, z 42.5..46.5
const HIGH_BEAM = BEAM_DEFS.find((b) => b.id === 'hall-corridor'); // east-west, z = 42.5, x 43.5..46.5
const SHOT_BEAM = BEAM_DEFS.find((b) => b.id === 'switchgear-pass'); // its emitter is the one round is aimed at

const read = () =>
  page.json(`(() => {
    const beams = __G.wild.feature('tripwires').beams;
    return { beams, tally: { ...__G.wild.tally },
      alarm: { active: __G.enemies.alarm.active, count: __G.enemies.alarm.count },
      note: document.querySelector('#hud .note').textContent,
      radio: [...document.querySelectorAll('#hud .radio p')].map((p) => p.lastChild.textContent),
      time: __G.mission.time, x: __G.player.x, z: __G.player.z, y: __G.player.y, crouched: __G.player.crouched };
  })()`);
/** The one beam a scenario is about, read fresh. */
const beamOf = (snapshot, def) => snapshot.beams.find((b) => b.id === def.id);

test('walking through a live low beam trips it: the alarm, a note, a radio line naming the place, the tally', async () => {
  await page.evaluate('__G.debug.start(); __G.enemies.clear(); void 0');
  await page.stand(LOW_BEAM.x0 - 2.5, (LOW_BEAM.z0 + LOW_BEAM.z1) / 2, -Math.PI / 2); // facing east, into it
  await page.keyDown('KeyW', 'w', 0);
  await page.until(`__G.player.x > ${LOW_BEAM.x0 + 2.5}`, 'to cross the beam', 6000);
  await page.keyUp('KeyW', 'w', 0);
  const r = await read();
  assert.equal(r.alarm.active, true, 'the site alarm is raised');
  assert.equal(r.alarm.count, 1, 'a tripwire counts against the grade, once');
  assert.equal(r.note, 'TRIPWIRE');
  // Overwatch names the place — and WARDEN, whose thread it was, has the last word (src/wild/warden.js)
  assert.ok(
    r.radio.some((line) => new RegExp(`Tripwire — ${LOW_BEAM.place}`).test(line)),
    `the radio said: ${r.radio.join(' / ')}`,
  );
  assert.equal(r.radio.at(-1), LINES.tripwire[0]);
  assert.equal(r.tally.tripped, 1);
  const beam = beamOf(r, LOW_BEAM);
  assert.equal(beam.live, true, 'a re-arming beam still shows live: it is armed, not out');
  assert.ok(beam.rearmT > 0, 'it is quiet for a few seconds now');
});

test('a jump clears a low beam: pinned above it, nothing trips', async () => {
  await page.evaluate('__G.debug.start(); __G.enemies.clear(); void 0');
  await page.stand(LOW_BEAM.x0 - 2.5, (LOW_BEAM.z0 + LOW_BEAM.z1) / 2, -Math.PI / 2);
  // isCleared only ever reads G.player.y at the instant a crossing is seen, so holding the feet above a low
  // beam proves the same rule a real jump would — and far more reliably: a real jump's time above 0.45 m is
  // under a second, tight against the frame-rate dips a busy, shared machine gets, where a single 50 ms-capped
  // physics tick (src/main.js clamps dt at 0.05 s) only costs a few centimetres, so pinning well clear of both
  // LOW and the floor and re-asserting it faster than any such tick keeps the player there for the whole walk.
  await page.evaluate(`{
    const p = __G.player;
    p.y = 1; p.vy = 0; p.grounded = false;
    window.__pin = setInterval(() => { p.y = 1; p.vy = 0; }, 16);
  }`);
  await page.keyDown('KeyW', 'w', 0);
  await page.until(`__G.player.x > ${LOW_BEAM.x0 + 2.5}`, 'to cross the beam pinned up', 6000);
  await page.keyUp('KeyW', 'w', 0);
  await page.evaluate('clearInterval(window.__pin); void 0');
  const r = await read();
  assert.equal(r.tally.tripped || 0, 0, 'cleared by height, nothing trips');
  assert.equal(r.alarm.active, false);
  assert.equal(beamOf(r, LOW_BEAM).rearmT, 0, 'the beam never sensed the crossing');
});

/**
 * Goes east along the service corridor (z = 44.5: bare floor from end to end) through one of the two threads across
 * it, and presses a key — once, a frame at a time in the page, so that where the body is when the key goes down
 * does not depend on how busy the machine running the test is — when it has come within `before` metres of the
 * thread. Says what came of it.
 */
async function through(beam, code, before, { run = false } = {}) {
  await page.evaluate('__G.debug.start(); __G.enemies.clear(); void 0');
  await page.stand(beam.x0 - 7, 44.5, -Math.PI / 2);
  await page.evaluate(`(() => {
    const p = __G.player, key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
    const log = (window.__thread = { pressed: null, over: null, slid: 0, done: false });
    ${run ? "key('keydown', 'ShiftLeft');" : ''} key('keydown', 'KeyW');
    let was = p.x;
    const tick = () => {
      if (p.slide) log.slid++;
      if (!log.pressed && p.x >= ${beam.x0 - before} && p.speed > ${run ? 6.3 : 4}) {
        log.pressed = { x: p.x, speed: p.speed };
        key('keydown', '${code}'); key('keyup', '${code}');
      }
      // the frame the body went over the thread's line: how high its feet were, and how it stood
      if (was < ${beam.x0} && p.x >= ${beam.x0}) log.over = { y: p.y, crouched: p.crouched, sliding: !!p.slide };
      was = p.x;
      if (p.x > ${beam.x0 + 2.5}) { key('keyup', 'ShiftLeft'); key('keyup', 'KeyW'); log.done = true; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  await page.until('window.__thread.done', 'to pass the thread', 15000);
  return { ...(await page.json('window.__thread')), ...(await read()) };
}

test('a real jump clears a low beam: Space a metre and a half short of it, at a walk', async () => {
  const went = await through(LOW_BEAM, 'Space', 1.5);
  assert.ok(went.over.y > LOW_BEAM.y, `over the thread the feet were ${went.over.y.toFixed(2)} m up`);
  assert.equal(went.tally.tripped || 0, 0, 'jumped, nothing trips');
  assert.equal(went.alarm.active, false);
  // …and the same walk with no jump in it is the walk that trips it (the first test above): the key was the difference
});

test('the slide goes under a high beam: C at a run, three metres short of it', async () => {
  const HIGH_ACROSS = BEAM_DEFS.find((b) => b.id === 'corridor-73'); // north-south, x = 73.5, across the corridor
  const went = await through(HIGH_ACROSS, 'KeyC', 3, { run: true });
  assert.ok(went.slid > 3, 'there was no slide');
  assert.deepEqual([went.over.sliding, went.over.crouched], [true, true], JSON.stringify(went.over));
  assert.equal(went.tally.tripped || 0, 0, 'slid under it, nothing trips');
  assert.equal(went.alarm.active, false);
});

test('a high beam: crouched under it nothing trips; standing, it does', async () => {
  await page.evaluate('__G.debug.start(); __G.enemies.clear(); void 0');
  const midX = (HIGH_BEAM.x0 + HIGH_BEAM.x1) / 2; // 45, inside the two-cell doorway
  const north = HIGH_BEAM.z0 - 3.5; // inside the cascade hall
  const south = HIGH_BEAM.z0 + 2.5; // inside the service corridor, short of its south wall

  await page.stand(midX, north, Math.PI); // facing south, into the door
  await page.press('KeyC');
  await page.until('__G.player.crouched === true', 'to crouch', 2000);
  await page.keyDown('KeyW', 'w', 0);
  await page.until(`__G.player.z > ${HIGH_BEAM.z0 + 1.5}`, 'to cross the beam crouched', 6000);
  await page.keyUp('KeyW', 'w', 0);
  const crouched = await read();
  assert.equal(crouched.tally.tripped || 0, 0, 'crouched under a high beam, nothing trips');
  assert.equal(beamOf(crouched, HIGH_BEAM).rearmT, 0, 'the beam never sensed the crouched crossing');

  await page.press('KeyC');
  await page.until('__G.player.crouched === false', 'to stand up', 2000);
  await page.stand(midX, south, 0); // facing north, back through the same door
  await page.keyDown('KeyW', 'w', 0);
  await page.until(`__G.player.z < ${HIGH_BEAM.z0 - 1.5}`, 'to cross the beam standing', 6000);
  await page.keyUp('KeyW', 'w', 0);
  const standing = await read();
  assert.equal(standing.tally.tripped, 1, 'standing through a high beam trips it');
  assert.equal(standing.note, 'TRIPWIRE');
});

test('a round into the emitter puts the beam out for good, and a checkpoint retry keeps it out', async () => {
  await page.evaluate('__G.debug.start(); __G.enemies.clear(); void 0');
  const e = SHOT_BEAM.emitter;
  // the emitter is a box let into the wall: a round only carries ARMS.lamp.proud (0.15 m) past whichever
  // face it strikes, so it is only ever in reach from inside the passage its own beam crosses — stand on
  // the thread itself, well clear of either wall, and aim across from there (works for either end's emitter).
  const standX = (SHOT_BEAM.x0 + SHOT_BEAM.x1) / 2;
  await page.evaluate(`{
    const e = ${JSON.stringify(e)};
    __G.weapon.arms.mode = 'semi';
    __G.debug.teleport(${standX}, ${SHOT_BEAM.z0}, 0);
    const p = __G.player;
    const toX = e.x - p.x, toZ = e.z - p.z;
    p.yaw = Math.atan2(-toX, -toZ);
    p.pitch = Math.atan2(e.y - p.eye, Math.hypot(toX, toZ));
  }`);
  await page.press('KeyZ');
  await page.until('__G.weapon.aim > 0.98', 'the sight to come up', 4000);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await sleep(60); // a press, then a release: a click, not a drag — not a game-timed wait
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await page.until(
    `__G.wild.feature('tripwires').beams.find((b) => b.id === '${SHOT_BEAM.id}').dead === true`,
    'the round to land',
    4000,
  );
  const hit = await read();
  assert.equal(beamOf(hit, SHOT_BEAM).live, false);
  assert.equal(hit.tally.beamsOut, 1);
  await page.press('KeyZ');
  await page.evaluate("__G.weapon.arms.mode = 'auto'; void 0");

  const saved = await page.json('__G.wild.save()');
  await page.evaluate('__G.debug.start(); void 0'); // a fresh mission: live again, until it is loaded
  const fresh = await read();
  assert.equal(beamOf(fresh, SHOT_BEAM).live, true, 'a fresh mission starts every emitter live');
  await page.evaluate(`__G.wild.load(${JSON.stringify(saved)}); void 0`);
  const loaded = await read();
  assert.equal(beamOf(loaded, SHOT_BEAM).live, false, 'the checkpoint remembers it was shot out');
});

test("an EMP puts the near beam out, and it comes back by itself, on the mission's own clock", async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  const mx = (LOW_BEAM.x0 + LOW_BEAM.x1) / 2;
  const mz = (LOW_BEAM.z0 + LOW_BEAM.z1) / 2;
  const before1 = await read();
  await page.evaluate(`__G.wild.emit('emp', ${mx}, ${mz}, 2); void 0`);
  const hit = await read();
  assert.equal(beamOf(hit, LOW_BEAM).live, false, 'the near beam is put out');
  assert.equal(beamOf(hit, HIGH_BEAM).live, true, 'a beam 12-plus metres off is not touched');
  await page.until(
    `__G.wild.feature('tripwires').beams.find((b) => b.id === '${LOW_BEAM.id}').live === true`,
    'the beam to come back',
    8000,
  );
  const back = await read();
  const elapsed = back.time - before1.time;
  assert.ok(
    elapsed > 1.3 && elapsed < 6,
    `it was out for ${elapsed.toFixed(2)} mission-seconds, not close to the 2 s given`,
  );
});

test('nothing trips while the player is hidden', async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
  await page.stand(LOW_BEAM.x0 - 2.5, (LOW_BEAM.z0 + LOW_BEAM.z1) / 2, -Math.PI / 2);
  await page.keyDown('KeyW', 'w', 0);
  await page.until(`__G.player.x > ${LOW_BEAM.x0 + 2.5}`, 'to cross the beam hidden', 6000);
  await page.keyUp('KeyW', 'w', 0);
  const r = await read();
  assert.equal(r.tally.tripped || 0, 0);
  assert.equal(r.alarm.active, false);
  assert.equal(beamOf(r, LOW_BEAM).rearmT, 0);
});

test('with the experiment off there are no beams at all', async () => {
  const off = await openWith(harness)(`${PLAY}&wild=0`);
  await off.evaluate('__G.debug.start(); void 0');
  assert.equal(await off.json('__G.wild'), null);
  assert.equal(await off.json("!!__G.world.group.parent.getObjectByName('wild-tripwires')"), false);
  assert.deepEqual(await off.problems(), []);
  await off.close();
});

test('the second look: a start and a walk through a beam, nothing logged as an error', async () => {
  const look2 = await openWith(harness)(PLAY.replace('look=1', 'look=2'));
  await look2.evaluate('__G.debug.start(); __G.enemies.clear(); void 0');
  await look2.stand(LOW_BEAM.x0 - 2.5, (LOW_BEAM.z0 + LOW_BEAM.z1) / 2, -Math.PI / 2);
  await look2.keyDown('KeyW', 'w', 0);
  await look2.until(`__G.player.x > ${LOW_BEAM.x0 + 2.5}`, 'to cross the beam', 6000);
  await look2.keyUp('KeyW', 'w', 0);
  assert.equal(await look2.json('__G.wild.tally.tripped'), 1);
  assert.deepEqual(await look2.problems(), []);
  await look2.close();
});

test('look=1: across everything above, nothing was ever logged as an error', async () => {
  assert.deepEqual(await page.problems(), []);
});
