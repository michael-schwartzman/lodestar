// The slide, in the built game (src/wild/slide.js holds its rules, test/unit/wild-slide.test.mjs holds them to
// their numbers; test/unit/player.test.mjs holds the body's side of it): C at a run, the body carried on along the
// floor — and the sentry in its way.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PLAYER } from '../../src/player.js';
import { AI } from '../../src/enemies/ai.js';
import { SLIDE, slideLength } from '../../src/wild/slide.js';
import { LINES } from '../../src/wild/warden.js';
import { PLAY, openWith, startWild } from './helpers.mjs';

let harness;
let page;
let open;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
  page = await open(PLAY);
});

after(async () => {
  await harness?.stop();
});

const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
/**
 * A stage on the open ground of the main cavern (x 54 … 72, z 65 … 69 is bare floor): every machine cleared off
 * but those named, each put where it is told ([x, z, yaw]) and keeping its post there; the player at the west end
 * of it, facing east, and not to be seen.
 */
const stage = (on, places) =>
  on.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true;
    const e = G.enemies, places = ${JSON.stringify(places)};
    e.remove(e.list.filter((u) => !(u.name in places)).map((u) => u.rollId));
    for (const [name, [x, z, yaw]] of Object.entries(places))
      Object.assign(e.byName(name), { x, z, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[Math.floor(x), Math.floor(z)]], routeI: 0, path: null, goalX: -1 });
    G.debug.teleport(54.6, 67.5, ${EAST});
  })()`);

/**
 * Goes east along the stage — at a run, or at a walk — and presses C once it is really going and has passed
 * x = `at`. Everything is done in the page, a frame at a time, so that where the body is when the key goes down
 * does not depend on how busy the machine running the test is. Returns what was seen each frame (`seen`), and how
 * things stood `after` seconds of the mission later (`end`).
 * @param {object} on    the page
 * @param {object} opts  at; walk (no Shift); letGo (W and Shift come up as C goes down); jump (seconds after C
 *                       that Space is pressed); after (seconds after C that it is all read)
 */
async function go(on, { at = 57, walk = false, letGo = true, jump = null, after = 1.4 } = {}) {
  await on.evaluate(`(() => {
    const G = __G, p = G.player;
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
    const log = (window.__slide = { seen: [], dropped: null, jumped: false, end: null });
    const up = () => { key('keyup', 'ShiftLeft'); key('keyup', 'KeyW'); };
    const of = (name) => { const m = G.enemies.byName(name); return m ? { x: m.x, z: m.z, stunT: m.stunT, empT: m.empT, state: m.brain.state, dead: m.dead } : null; };
    ${walk ? '' : "key('keydown', 'ShiftLeft');"} key('keydown', 'KeyW');
    const tick = () => {
      const t = G.mission.time;
      log.seen.push({ t, on: !!p.slide, x: p.x, z: p.z, speed: p.speed, eye: p.eye, crouched: p.crouched, running: p.running, grounded: p.grounded, fov: G.camera.fov, gate: of('gate') });
      if (!log.dropped && p.speed > ${walk ? 4 : 6.3} && p.x >= ${at}) {
        log.dropped = { x: p.x, t };
        key('keydown', 'KeyC'); key('keyup', 'KeyC');
        ${letGo ? 'up();' : ''}
      }
      if (log.dropped && !log.jumped && ${jump === null ? 'false' : `t >= log.dropped.t + ${jump}`}) {
        log.jumped = true;
        key('keydown', 'Space'); key('keyup', 'Space');
      }
      if (log.dropped && t >= log.dropped.t + ${after}) {
        up();
        const target = G.enemies.takedownTarget(p);
        log.end = { target: target ? target.name : null, note: document.querySelector('#hud .note').textContent,
          tally: G.wild ? { ...G.wild.tally } : null, gate: of('gate'), road: of('road'),
          warden: [...document.querySelectorAll('#hud .radio p.w-warden')].map((l) => l.lastChild.textContent) };
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  await on.until('!!window.__slide.end', 'the run, the drop and what came of it', 30000);
  return on.json('window.__slide');
}

test('C at a run drops the body and carries it on along the floor: faster than a run, lower than a crouch, five metres, not to be steered — and it ends in a crouch', async () => {
  await stage(page, {});
  // (the keys are let go as C goes down: it goes on all the same)
  const log = await go(page, { letGo: true, after: 1.5 });
  const on = log.seen.filter((s) => s.on);
  assert.ok(on.length > 5, `the body was carried for ${on.length} frames`);
  const [first, last] = [on[0], on[on.length - 1]];
  const speeds = on.map((s) => s.speed);
  assert.ok(Math.max(...speeds) > PLAYER.run + 1, `at its fastest it went ${Math.max(...speeds).toFixed(1)} m/s`);
  assert.ok(last.speed < PLAYER.walk, `at its end it was going ${last.speed.toFixed(1)} m/s`);
  // for as long and as far as its rules say — give or take the frame it began in and the frame it ended in
  const far = Math.hypot(last.x - first.x, last.z - first.z);
  assert.ok(far > slideLength() - 1 && far < slideLength() + 0.3, `it went ${far.toFixed(2)} m`);
  assert.ok(Math.abs(last.t - first.t - SLIDE.seconds) < 0.15, `it lasted ${(last.t - first.t).toFixed(2)} s`);
  assert.ok(Math.abs(last.z - first.z) < 0.05, 'it went straight east');
  // lower than a crouch, and a wider view, while it lasts
  const lowest = Math.min(...on.map((s) => s.eye));
  assert.ok(lowest < PLAYER.eyeCrouch - 0.12, `the eye went down to ${lowest.toFixed(2)} m`);
  const base = log.seen[0].fov;
  assert.ok(Math.max(...on.map((s) => s.fov)) > base * 1.02);
  // …and after it: crouched, at rest, the eye where a crouch has it, the view as it was
  const end = log.seen[log.seen.length - 1];
  assert.deepEqual([end.on, end.crouched], [false, true]);
  assert.ok(end.speed < 0.3, `it is still moving at ${end.speed.toFixed(2)} m/s`);
  assert.ok(Math.abs(end.eye - PLAYER.eyeCrouch) < 0.05, `the eye is at ${end.eye.toFixed(2)} m`);
  assert.ok(Math.abs(end.fov - base) < 0.3);
  assert.deepEqual(await page.problems(), []);
});

test('a sentry in its way is staggered — stopped, helpless from the front, shoved on — and the slide stops at it; F then shuts it down. One beside the line only hears it', async () => {
  // one square in the line, facing the body that comes at it; one two metres to the south of the line
  await stage(page, { gate: [61.5, 67.5, WEST], road: [58.5, 69.7, WEST] });
  const log = await go(page, { letGo: true, after: 0.9 });
  const on = log.seen.filter((s) => s.on);
  const end = log.seen[log.seen.length - 1];
  // (it heard the slide begin and had set off towards it: where it was when it was met is where it was the frame
  // before it was stopped)
  const met = log.seen.filter((s) => s.gate.stunT === 0).pop().gate;
  // it is as an EMP leaves one: it does nothing, and it can be shut down from the front
  assert.ok(log.end.gate.stunT > 1 && log.end.gate.empT > 1, JSON.stringify(log.end.gate));
  assert.equal(log.end.target, 'gate');
  // shoved on, the way the slide was going
  const shoved = log.end.gate.x - met.x;
  assert.ok(Math.abs(shoved - SLIDE.knock.shove) < 0.12, `it was shoved ${shoved.toFixed(2)} m`);
  assert.ok(Math.abs(log.end.gate.z - 67.5) < 0.05);
  // the slide ended there: short of its time, in front of where the machine stood, and with no speed left
  assert.ok(on[on.length - 1].t - on[0].t < SLIDE.seconds - 0.1, 'the slide ran its whole time');
  const short = met.x - end.x;
  assert.ok(short > 0.35 && short < SLIDE.knock.reach + 0.02, `the body stopped ${short.toFixed(2)} m short of it`);
  assert.ok(end.speed < 0.3);
  // said, counted — and WARDEN has a word to say to its machine
  assert.equal(log.end.note, 'SENTRY STAGGERED');
  assert.equal(log.end.tally.knocked, 1);
  assert.deepEqual(log.end.warden, LINES.knocked.slice(0, 1));
  // the one beside the line is not stopped: it heard that, and is on its way to look
  assert.equal(log.end.road.stunT, 0);
  assert.notEqual(log.end.road.state, AI.PATROL);
  // F, while it is helpless
  await page.press('KeyF');
  await page.until('__G.enemies.byName("gate").dead === true', 'F to shut the staggered sentry down', 4000);
  assert.deepEqual(await page.problems(), []);
});

test('Space jumps out of it, and the jump keeps the speed the slide had', async () => {
  await stage(page, {});
  const log = await go(page, { letGo: true, jump: 0.25, after: 1 });
  const air = log.seen.filter((s) => !s.grounded);
  assert.ok(air.length > 3, 'the feet did not leave the ground');
  assert.ok(air[1].speed > PLAYER.run + 0.8, `in the air it was going ${air[1].speed.toFixed(1)} m/s`);
  // the slide is over once the feet have left the ground
  assert.ok(air.slice(3).every((s) => !s.on));
});

test('it begins at a run and nowhere else: C at a walk is the crouch it always was', async () => {
  await stage(page, {});
  const log = await go(page, { walk: true, letGo: false, after: 0.9 });
  const end = log.seen[log.seen.length - 1];
  assert.ok(
    log.seen.every((s) => !s.on),
    'the body was carried',
  );
  assert.equal(end.crouched, true);
  assert.ok(Math.abs(end.speed - PLAYER.crouch) < 0.25, `it is going ${end.speed.toFixed(2)} m/s`);
});

test('with the experiment off there is no slide: C at a run does what it did — nothing, the run goes on', async () => {
  const off = await open(`${PLAY}&wild=0`);
  await stage(off, {});
  const log = await go(off, { letGo: false, after: 0.6 });
  const end = log.seen[log.seen.length - 1];
  assert.ok(log.seen.every((s) => !s.on));
  assert.deepEqual([end.running, end.crouched], [true, false]);
  assert.ok(Math.abs(end.speed - PLAYER.run) < 0.3, `it is going ${end.speed.toFixed(2)} m/s`);
  assert.deepEqual(await off.problems(), []);
});
