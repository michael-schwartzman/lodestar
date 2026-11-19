// A thrown magnet, in the built game (src/wild/lodestone.js holds the rules, test/unit/wild-lodestone.test.mjs
// holds them to their numbers; that the game DOES it — the key, the stick, the clamp, the field, the crush, what
// is seen and heard of it — is held here). Model: test/wild/slide.test.mjs.
//
// 17 November 2026 — rewritten after the owner's "the lodge stone doesn't seem to do anything fix it": the old
// suite staged machines 2 m from a stone thrown at the player's own feet, which never caught the real bugs (it
// bounced, it overshot, a crate hid half a pair). Every test below throws the way a player does, at a mission's
// own real machines, standing where the mission really puts them (or a short way off it, when the acceptance
// list asks for a distance the mission's own layout does not happen to have) — the `stage()` pattern of
// test/wild/slide.test.mjs and `.work/v10/lodestone-repro.mjs` (the very script that measured the old bug),
// never a fresh synthetic spawn.
//
// Every wait below is on the feature's own clock (`state.stones[i].t`, or `__G.mission.time` directly) or a
// condition `page.until` polls for — never a fixed number of real seconds standing in for game time (a short
// `sleep` is used only twice, for a negative check that has no condition of its own to wait on: nothing was
// thrown, see H1 and H4) — so the suite stays robust while several of us run browsers on this one machine at
// once.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LODESTONE } from '../../src/wild/lodestone.js';
import { PLAY, openWith, sleep, startWild } from './helpers.mjs';

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

const NORTH = 0;
const SOUTH = Math.PI;
const EAST = -Math.PI / 2;

/** The feature's own state (every stone alive, and what it rides or holds), the tally, and the note under the
 * crosshair. */
const read = () =>
  page.json(`(() => {
    const f = __G.wild.feature('lodestone').state;
    return { count: f.count, stones: f.stones, tally: { ...__G.wild.tally },
      note: document.querySelector('#hud .note').textContent };
  })()`);

/** A plain, JSON-safe projection of one real mission machine, read back by the name the map gave it. */
const of = (name) =>
  page.json(`(() => {
    const u = __G.enemies.byName('${name}');
    return u && { x: u.x, y: u.y, z: u.z, hp: u.hp, dead: !!u.dead, carried: !!u.carried, stunT: u.stunT,
      piloted: !!u.piloted, turned: u.turned || 0, state: u.brain.state };
  })()`);

/**
 * Clears every machine off the roll but those named, puts each where told (`[x, z, yaw]`; `null` leaves it
 * exactly where the mission puts it — gate and road below), freezes it (`stunT`, as a freshly-reinforced or
 * repositioned unit otherwise starts walking within a couple of hundred milliseconds, well before anything is
 * thrown) and hides the player. Only the lodestone's own pull should ever move one of these from here on.
 */
async function stage(places) {
  await page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true;
    const e = G.enemies, places = ${JSON.stringify(places)};
    e.remove(e.list.filter((u) => !(u.name in places)).map((u) => u.rollId));
    for (const [name, at] of Object.entries(places)) {
      if (!at) continue;
      const [x, z, yaw] = at;
      Object.assign(e.byName(name), { x, z, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6,
        route: [[Math.floor(x), Math.floor(z)]], routeI: 0, path: null, goalX: -1, stunT: 1e6 });
    }
  })()`);
  await sleep(150); // one settle: a frame or two for a repositioned unit to take, before anything is thrown
}

/** Stands the player and throws — `__G.mission.time` at the instant of the throw, the game's own clock, for
 * tests measured against it (A, B). */
async function throwAt(x, z, yaw, pitch) {
  await page.stand(x, z, yaw, pitch);
  const t0 = await page.evaluate('__G.mission.time');
  await page.press('Digit4');
  return t0;
}

const missionTime = () => page.evaluate('__G.mission.time');

const waitDead = (name, timeoutMs = 10000) =>
  page.until(`__G.enemies.byName('${name}')?.dead === true`, `${name} to be destroyed`, timeoutMs);

const waitGone = (timeoutMs = 10000) =>
  page.until('__G.wild.feature("lodestone").state.stones.length === 0', 'the stone to finish its cycle', timeoutMs);

test('A — the gate pair where the mission puts them, thrown level from 12 m north: both destroyed inside 6 mission-seconds (the crate between no longer saves one)', async () => {
  await stage({ gate: null, road: null });
  const t0 = await throwAt(61.5, 70.5, SOUTH, 0);
  await waitDead('gate');
  await waitDead('road');
  const took = (await missionTime()) - t0;
  assert.ok(took <= 6, `took ${took.toFixed(2)} mission-seconds, more than the 6s the acceptance list allows`);
  assert.deepEqual(await page.problems(), []);
});

test('B — the same pair, thrown at their feet from 8 m north (pitch −0.25): both destroyed', async () => {
  await stage({ gate: null, road: null });
  const t0 = await throwAt(61.0, 74.5, SOUTH, -0.25);
  await waitDead('gate');
  await waitDead('road');
  const took = (await missionTime()) - t0;
  assert.ok(took <= 6, `took ${took.toFixed(2)} mission-seconds`);
  assert.deepEqual(await page.problems(), []);
});

test('C — three in the open, 9–11 m out: all three destroyed, the tally says so, and the notes name the count', async () => {
  await stage({ gate: [65.5, 66.5, 1.57], road: [66.5, 68.5, 1.57], lobby: [67.5, 67.2, 1.57] });
  const before = await read();
  await throwAt(56.5, 67.5, EAST, 0.05);
  await page.until(
    `document.querySelector('#hud .note').textContent === 'LODESTONE — 3 HELD'`,
    'the wake note to say all three were held',
  );
  await waitDead('gate');
  await waitDead('road');
  await waitDead('lobby');
  await page.until(
    `document.querySelector('#hud .note').textContent === 'LODESTONE — 3 CRUSHED'`,
    'the crush note to say all three were crushed',
  );
  const after = await read();
  assert.equal(after.tally.crushed - (before.tally.crushed || 0), 3, 'the crushed tally should count all three');
  assert.deepEqual(await page.problems(), []);
});

// D — the cascade hall. `node -e "import('./src/world/map.js').then(m => console.log(m.printSite(m.buildSite())))"`
// (X runs east, row = Z south), the two casing blocks sit at roughly x 34–49 and x 53–68 between z 17 and z 41,
// each cut into 2-row bands every few metres — so most columns inside a block are NOT a clear aisle (a level
// throw along one sticks on the very first band, a metre or two in). The true aisles are the gaps either side of
// and between the blocks: x 31–33, x 50–52 and x 69–71 each run open, floor to wall, the whole z 17…41. x = 51 is
// used below (middle aisle); hallAisle, the mission's own sentry for this hall, is moved onto it, 10 m down it.
test('D — the cascade hall, a real aisle between the casings (x = 51, verified above): a level throw 10 m down it sticks (it does not come back) and drags the sentry in', async () => {
  await stage({ hallAisle: [51.5, 28.5, SOUTH] });
  await throwAt(51.5, 38.5, NORTH, 0);
  await page.until(
    '__G.wild.feature("lodestone").state.stones[0]?.stuck === true',
    'the stone to stick in the aisle (not bounce back past the player)',
    4000,
  );
  const stuck = (await read()).stones[0];
  assert.ok(
    stuck.z < 35,
    `it should have travelled well down the aisle, not stuck near the player at z=38.5 (stuck at z=${stuck.z.toFixed(2)})`,
  );
  await waitDead('hallAisle');
  assert.deepEqual(await page.problems(), []);
});

test('E — a wall: a sentry the far side of it, more than 3 m but less than 5 m from a stone stuck in the service corridor, is neither held nor hurt', async () => {
  await stage({ control: [55.5, 39.2, SOUTH] });
  const before = await of('control');
  await throwAt(55.5, 44.5, NORTH, 0);
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.awake === true', 'the stone to wake', 4000);
  const mid = await read();
  assert.equal(
    mid.stones[0].held,
    0,
    'a true wall should hide the sentry from the field, whatever height it starts at',
  );
  await waitGone();
  const afterUnit = await of('control');
  assert.equal(afterUnit.hp, before.hp, 'hidden by the wall, the crush should not have reached it either');
  assert.deepEqual(await page.problems(), []);
});

test('F — a drone hanging 3 m up, within 8 m of where the stone sticks: drawn down and destroyed', async () => {
  await stage({ droneYard: [64.5, 70.5, SOUTH] });
  await page.evaluate(`Object.assign(__G.enemies.byName('droneYard'), { y: 3 }); void 0`);
  await throwAt(64.5, 65.5, NORTH, -1.3);
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.awake === true', 'the stone to wake', 4000);
  await page.until(`__G.enemies.byName('droneYard')?.carried === true`, 'the drone to be drawn in and down', 4000);
  await waitDead('droneYard');
  assert.deepEqual(await page.problems(), []);
});

test('G — a direct hit: thrown straight at a sentry 6 m away, the stone clamps onto it at once (before the field even wakes) and it is held and destroyed', async () => {
  await stage({ feed: [66.5, 65.5, SOUTH] });
  await throwAt(60.5, 65.5, EAST, 0);
  await page.until(
    `__G.wild.feature("lodestone").state.stones[0]?.rides === 'feed'`,
    'the stone to clamp onto it',
    2000,
  );
  const clamped = (await read()).stones[0];
  assert.equal(clamped.held, 1, 'held the instant it clamps');
  assert.equal(clamped.awake, false, 'held before the field even wakes — this is the clamp, not the normal capture');
  await waitDead('feed');
  assert.deepEqual(await page.problems(), []);
});

test('H1 — while a drone is being flown the 4 is not the body’s to press, and a field does not take the flown drone out of the player’s hands', async () => {
  await stage({ droneYard: [64.5, 70.5, SOUTH] });
  await page.evaluate(`Object.assign(__G.enemies.byName('droneYard'), { y: 3 }); void 0`);
  await page.stand(64.5, 76.5, NORTH, 0);
  const before = await read();
  await page.evaluate(`__G.wild.feature('pilot').fly(__G.enemies.byName('droneYard')); void 0`);
  await page.until('__G.wild.feature("pilot").flying === true', 'the drone to be flown', 4000);
  await page.press('Digit4');
  await sleep(250); // no positive condition to wait on: this checks that nothing happened at all
  const flying = await read();
  assert.equal(flying.count, before.count, "a lodestone left the hand of a body that wasn't asking");
  assert.equal(flying.stones.length, 0);

  // a stone already awake, right under the flown drone: the drone flown a moment ago is taken off the field
  // first — let go with the link, it is a machine like any — before anything else near it is drawn in
  await page.evaluate(`__G.wild.feature('pilot').end('over'); void 0`);
  await page.evaluate(`Object.assign(__G.enemies.byName('droneYard'), { y: 3 }); __G.player.pitch = -1.3; void 0`);
  await page.press('Digit4');
  await page.until('__G.wild.feature("lodestone").state.stones.length === 1', 'the throw', 4000);
  await page.evaluate(`__G.wild.feature('pilot').fly(__G.enemies.byName('droneYard')); void 0`);
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.awake === true', 'the stone to wake', 8000);
  const held = await page.json(`(() => {
    const d = __G.enemies.byName('droneYard');
    return { held: __G.wild.feature('lodestone').state.stones[0].held, piloted: !!d.piloted,
      flying: __G.wild.feature('pilot').flying };
  })()`);
  assert.deepEqual([held.flying, held.piloted, held.held], [true, true, 0], JSON.stringify(held));
  await waitGone();
  const after = await page.json(`(() => {
    const d = __G.enemies.byName('droneYard'); return { y: d.y, carried: !!d.carried, dead: !!d.dead };
  })()`);
  assert.ok(after.y > 2.4, `the flown drone should not have been drawn down, at y=${after.y.toFixed(2)}`);
  assert.equal(after.dead, false, 'nor crushed');
  await page.evaluate(`__G.wild.feature('pilot').end('over'); void 0`);
  assert.deepEqual(await page.problems(), []);
});

test('H1b — a drone the field already holds, flown before the crush, is the player’s from that moment: the field lets go of it and the crush does not touch it', async () => {
  // (found in review, 17 November 2026: this test once gave the drone 500 of health "because the crush itself is
  // not what is being asked about" and asked only that it was not dead — and the crush was hurting the very
  // drone the player was flying. It has the health a drone has, and is asked what the crush did to it.)
  await stage({ droneYard: [64.5, 70.5, SOUTH] });
  await page.evaluate(`Object.assign(__G.enemies.byName('droneYard'), { y: 3 }); void 0`);
  const before = await of('droneYard');
  await throwAt(64.5, 65.5, NORTH, -1.3);
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.held === 1', 'the field to take the drone', 8000);
  await page.evaluate(`__G.wild.feature('pilot').fly(__G.enemies.byName('droneYard')); void 0`);
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.held === 0', 'the field to let go of it', 2000);
  await waitGone();
  const kept = await page.json(`(() => {
    const d = __G.enemies.byName('droneYard');
    return { carried: !!d.carried, piloted: !!d.piloted, dead: !!d.dead, flying: __G.wild.feature('pilot').flying, hp: d.hp };
  })()`);
  assert.deepEqual(kept, { carried: true, piloted: true, dead: false, flying: true, hp: before.hp });
  assert.equal((await read()).tally.crushed || 0, 0, 'nothing was crushed');
  await page.evaluate(`__G.wild.feature('pilot').end('over'); void 0`);
  assert.deepEqual(await page.problems(), []);
});

test('H2 — a sentry the player has turned is not taken by the field, and takes no damage from the crush', async () => {
  await stage({ feed: [64.5, 70.5, SOUTH] });
  await page.evaluate(`__G.enemies.byName('feed').turned = 10; void 0`);
  const before = await of('feed');
  await throwAt(64.5, 69.5, NORTH, -1.3); // 1 m from it: well within reach and close, if not for being turned
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.awake === true', 'the stone to wake', 4000);
  const mid = await read();
  assert.equal(mid.stones[0].held, 0, 'a turned sentry should not be counted as held');
  await waitGone();
  const afterUnit = await of('feed');
  assert.equal(afterUnit.hp, before.hp, 'turned, it should take no damage from the crush either');
  assert.deepEqual(await page.problems(), []);
});

test('H2b — a sentry the field already holds, turned by the uplink before the crush, is the player’s from that moment: let go of, not frozen, not crushed — and its forty seconds run', async () => {
  // (found in review, 17 November 2026: the field would not TAKE a turned machine, but one it held already and
  // the player then turned stayed held — stopped where it stood, its forty seconds not running — and was
  // crushed with the rest: a link spent on a machine the player's own stone then destroyed.)
  await stage({ feed: [64.5, 70.5, SOUTH] });
  const before = await of('feed');
  await throwAt(64.5, 65.5, NORTH, -1.3);
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.held === 1', 'the field to take the sentry', 8000);
  await page.evaluate(`__G.wild.feature('uplink').turn(__G.enemies.byName('feed')); void 0`);
  const turnedAt = await missionTime();
  await page.until('__G.wild.feature("lodestone").state.stones[0]?.held === 0', 'the field to let go of it', 2000);
  await waitGone();
  const kept = await of('feed');
  const ran = (await missionTime()) - turnedAt;
  assert.deepEqual([kept.dead, kept.hp], [false, before.hp], 'the crush touched a machine that was the player’s');
  assert.ok(kept.stunT < 0.3, `it is still stopped: ${kept.stunT}`);
  // its forty seconds have been running for as long as it has been turned (they did not, while it was held)
  assert.ok(
    kept.turned > 0 && kept.turned < 40 - ran * 0.6,
    `${ran.toFixed(2)} s after it was turned it has ${kept.turned.toFixed(2)} s left`,
  );
  assert.equal((await read()).tally.crushed || 0, 0, 'nothing was crushed');
  assert.deepEqual(await page.problems(), []);
});

test('H3 — a mission begun again while a field is awake leaves no stone, and nothing still held or carried', async () => {
  await stage({ droneYard: [64.5, 70.5, SOUTH] });
  await page.evaluate(`Object.assign(__G.enemies.byName('droneYard'), { y: 3 });
    __G.debug.speed(4); window.__g = __G.enemies.byName('droneYard'); void 0`);
  await throwAt(64.5, 65.5, NORTH, -1.3);
  await page.until('window.__g.carried === true', 'the drone to be drawn in and held by the field', 8000);

  await page.evaluate('__G.debug.start(); void 0');
  const afterRestart = await read();
  assert.equal(afterRestart.stones.length, 0, 'no stone should be left in the scene');
  assert.equal(afterRestart.count, LODESTONE.start, 'ammunition should be back to the start of a mission');
  // the old unit is off the roll now, but the same object: still reachable through window.__g, still telling
  // whether the feature let it go properly rather than abandoning it mid-hold
  const old = await page.json('({ carried: !!window.__g.carried, stunT: window.__g.stunT })');
  assert.equal(old.carried, false, 'a machine must never be left carried by a stone that is gone');
  assert.equal(
    old.stunT,
    LODESTONE.releaseStun,
    'it must be properly released (stunT set to the release value), not abandoned mid-hold',
  );
  assert.deepEqual(await page.problems(), []);
});

test('H4 — with the experiment off, the 4 key does nothing', async () => {
  const off = await open(`${PLAY}&wild=0`);
  assert.equal(await off.evaluate('__G.wild'), null);
  await off.stand(61.5, 70.5, SOUTH, 0);
  await off.press('Digit4');
  await sleep(200); // no positive condition to wait on: this checks that nothing happened at all
  assert.equal(await off.evaluate('__G.wild'), null);
  assert.deepEqual(await off.problems(), []);
});

test('H5 — it still sticks, wakes and crushes in the second look, with no error logged', async () => {
  const look2 = await open(PLAY.replace('look=1', 'look=2'));
  await look2.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true;
    const e = G.enemies;
    e.remove(e.list.filter((u) => u.name !== 'feed').map((u) => u.rollId));
    Object.assign(e.byName('feed'), { x: 64.5, z: 70.5, yaw: ${SOUTH}, postYaw: ${SOUTH}, headYaw: 0, scanT: 0,
      waitT: 1e6, route: [[64, 70]], routeI: 0, path: null, goalX: -1, stunT: 1e6 });
    G.debug.speed(4);
  })()`);
  await look2.stand(64.5, 65.5, NORTH, -1.3);
  await look2.press('Digit4');
  await look2.until(
    '__G.wild.feature("lodestone").state.stones[0]?.awake === true',
    'the stone to wake in look=2',
    8000,
  );
  await look2.until('__G.wild.feature("lodestone").state.stones.length === 0', 'the crush in look=2', 8000);
  assert.deepEqual(await look2.problems(), []);
});

test('no error was logged by the main page across every test above', async () => {
  assert.deepEqual(await page.problems(), []);
});
