// Armour, in the built game (src/wild/armour.js holds the rule, test/unit/wild-armour.test.mjs the arithmetic):
// real rounds, fired at a machine, and the rounds there are to fire.
//
// 18 November 2026 — the owner: "the game is still too easy to shoot down drones and robots make it more
// difficult and require more shoots to take them down".
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GUNS, GUN_ORDER } from '../../src/arms.js';
import { ARMOUR } from '../../src/wild/armour.js';
import { PLAY, openWith, sleep, startWild } from './helpers.mjs';

let harness;
let open;
let page;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
  // (what a broken wire, an alarm and a task bring is asked in the response suite: here a mission is one machine)
  page = await open(`${PLAY}&response=0`);
});

after(async () => {
  await harness?.stop();
});

const EAST = -Math.PI / 2;
/** one sentry, 2.4 metres east of the player and stopped where it stands; the carbine on SEMI */
async function faceSentry(onPage) {
  await onPage.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true;
    const e = G.enemies, yaw = ${Math.PI / 2};
    e.remove(e.list.filter((u) => u.name !== 'gate').map((u) => u.rollId));
    Object.assign(e.byName('gate'), { x: 58.9, z: 67.5, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[58, 67]], routeI: 0, path: null, goalX: -1, stunT: 1e6 });
    G.debug.teleport(56.5, 67.5, ${EAST});
    G.weapon.arms.mode = 'semi';
    window.__it = e.byName('gate');
  })()`);
  await sleep(150);
}
/** one drone, hanging four metres east of the player and stopped where it hangs; the carbine on SEMI */
async function faceDrone(onPage) {
  await onPage.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true;
    const e = G.enemies;
    e.remove(e.list.map((u) => u.rollId));
    G.debug.teleport(56.5, 67.5, ${EAST});
    const drone = e.reinforce('drone', [[60, 67]], { x: 56.5, z: 67.5 })[0];
    Object.assign(drone, { x: 60.5, z: 67.5, stunT: 1e6 });
    G.weapon.arms.mode = 'semi';
    window.__it = drone;
  })()`);
  // (it settles to the height it flies at)
  await sleep(900);
}
/** one round at the middle of what `aim` says: a height on the sentry, or the drone itself. On SEMI, one pull is one round */
async function round(onPage, aim) {
  const shots = await onPage.evaluate(`(() => {
    const p = __G.player, u = __it;
    const height = ${typeof aim === 'number' ? aim : 'u.y'};
    p.yaw = ${EAST}; p.pitch = Math.atan2(height - p.eye, Math.hypot(u.x - p.x, u.z - p.z));
    return __G.weapon.shots;
  })()`);
  await onPage.keyDown('KeyX', 'x', 88);
  try {
    await onPage.until(`__G.weapon.shots === ${shots + 1}`, 'one round', 5000);
  } finally {
    await onPage.keyUp('KeyX', 'x', 88);
  }
  await sleep(350);
}
const read = (onPage) =>
  onPage.json(`(() => {
    const G = __G, u = __it;
    return { hp: u.hp, max: u.hpMax, dead: u.dead, hits: G.weapon.hits, tally: G.wild ? { ...G.wild.tally } : null,
      note: document.querySelector('#hud .note').textContent };
  })()`);
/** what is carried: [in the magazine, in reserve] for each gun, and the EMPs */
const carried = (onPage) =>
  onPage.json(`(() => {
    const a = __G.weapon.arms;
    return { guns: ${JSON.stringify(GUN_ORDER)}.map((key) => [a.guns[key].mag, a.guns[key].reserve]), grenades: a.grenades,
      total: document.querySelector('#hud .ammo .total').textContent };
  })()`);
const HEAD_Y = 1.74;
const BODY_Y = 1.26;
const half = GUNS.carbine.damage * ARMOUR.rounds.sentry;

test('a sentry’s body: every round of the carbine counts half — five leave it standing, the sixth shuts it down', async () => {
  await faceSentry(page);
  const whole = await read(page);
  assert.equal(whole.hp, 100, 'Operator: a sentry has a hundred');
  await round(page, BODY_Y);
  const one = await read(page);
  assert.equal(one.hp, whole.hp - half, `one round: ${half} off it, where it was ${GUNS.carbine.damage}`);
  for (let n = 2; n <= 5; n++) await round(page, BODY_Y);
  const five = await read(page);
  assert.deepEqual([five.dead, five.hp], [false, whole.hp - 5 * half], 'five rounds, and it is still up');
  await round(page, BODY_Y);
  const six = await read(page);
  assert.equal(six.dead, true, 'the sixth');
  assert.equal(six.hits, 6);
  // and the debrief can say what the plating took
  assert.equal(six.tally.plated, 6);
  assert.deepEqual(await page.problems(), []);
});

test('its head: the round that cracks the visor counts half a round to the body, the next half a head — three, not two', async () => {
  await faceSentry(page);
  const whole = await read(page);
  await round(page, HEAD_Y);
  const cracked = await read(page);
  // (the plating is asked after the visor, about what the visor made of the round: seventeen, not thirty-four)
  assert.deepEqual([cracked.dead, cracked.hp, cracked.note], [false, whole.hp - half, 'VISOR CRACKED']);
  await round(page, HEAD_Y);
  const two = await read(page);
  assert.deepEqual([two.dead, two.hp], [false, whole.hp - half - 3 * half], 'two to the head, and it is still up');
  await round(page, HEAD_Y);
  const three = await read(page);
  assert.deepEqual([three.dead, three.note], [true, 'HEAD SHOT']);
  assert.deepEqual(await page.problems(), []);
});

test('a drone: three rounds leave it flying, the fourth brings it down', async () => {
  await faceDrone(page);
  const whole = await read(page);
  assert.equal(whole.hp, 55, 'Operator: a drone has fifty-five');
  for (let n = 1; n <= 3; n++) await round(page, 'drone');
  const three = await read(page);
  assert.deepEqual([three.dead, three.hp, three.hits], [false, whole.hp - 3 * half, 3]);
  await round(page, 'drone');
  assert.equal((await read(page)).dead, true, 'the fourth');
  assert.deepEqual(await page.problems(), []);
});

test('the shotgun at arm’s length: one shell does not do it any more — to the body, or to the face', async () => {
  for (const [height, where] of [
    [BODY_Y, 'the body'],
    [HEAD_Y, 'the head'],
  ]) {
    await faceSentry(page);
    await page.press('Digit3');
    await page.until('__G.weapon.arms.current === "shotgun" && !__G.weapon.swapping', 'the shotgun in hand', 4000);
    const whole = await read(page);
    await round(page, height);
    const one = await read(page);
    assert.equal(one.dead, false, `one shell to ${where} at 2.4 m, and it is still up`);
    // every pellet that landed counted half a pellet to the body — in the head too: the visor stops the whole
    // of the shell that cracks it
    const landed = (whole.hp - one.hp) / (GUNS.shotgun.damage * ARMOUR.rounds.sentry);
    assert.ok(Number.isInteger(landed) && landed >= 5 && landed <= GUNS.shotgun.pellets, `${whole.hp - one.hp} off it`);
    // (it has to be pumped: a pull before it is ready is a pull lost)
    await sleep(GUNS.shotgun.interval * 1000);
    await round(page, height);
    assert.equal((await read(page)).dead, true, `the second shell to ${where}`);
  }
  assert.deepEqual(await page.problems(), []);
});

test('the hub asks the visor and then the plating — each told what the one before made of the round', async () => {
  await faceSentry(page);
  const ask = `(unit, zone, multiplier) => __G.wild.plate({ unit, zone, multiplier, t: 4 })`;
  const asked = await page.json(`(() => {
    const G = __G, u = __it, ask = ${ask};
    // three pellets of ONE shot at a whole visor: it stops all of the shell that cracks it
    const shell = [ask(u, 'head', 3), ask(u, 'head', 3), ask(u, 'head', 3)];
    const body = ask(u, 'body', 1), legs = ask(u, 'legs', 0.75);
    const drone = G.enemies.reinforce('drone', [[60, 67]], { x: 56.5, z: 67.5 })[0];
    return { shell, body, legs, drone: ask(drone, 'body', 1), names: G.wild.features.map((f) => f.name) };
  })()`);
  assert.deepEqual(asked.shell, [0.5, 0.5, 0.5], 'a head: the visor’s one, halved — for every pellet of that shot');
  assert.deepEqual([asked.body, asked.legs, asked.drone], [0.5, 0.375, 0.5]);
  assert.ok(asked.names.indexOf('visor') >= 0 && asked.names.indexOf('visor') < asked.names.indexOf('armour'));
  // another pull of the trigger (a round into the rock behind him): the next round to that head goes through
  // the visor, and the plating halves the head's three
  const shots = await page.evaluate(
    `(() => { __G.player.yaw = ${-EAST}; __G.player.pitch = 0; return __G.weapon.shots; })()`,
  );
  await page.keyDown('KeyX', 'x', 88);
  try {
    await page.until(`__G.weapon.shots === ${shots + 1}`, 'one round', 5000);
  } finally {
    await page.keyUp('KeyX', 'x', 88);
  }
  assert.deepEqual(
    await page.json(`(() => { const ask = ${ask}; return [ask(__it, 'head', 3), ask(__it, 'head', 3)]; })()`),
    [1.5, 1.5],
  );
  assert.deepEqual(await page.problems(), []);
});

test('twice the rounds: in reserve when a mission starts, in a cache — and a mission begun again starts with no more', async () => {
  await page.evaluate('__G.debug.start(); __G.player.hidden = true; void 0');
  const start = await carried(page);
  assert.deepEqual(
    start.guns,
    GUN_ORDER.map((key) => [GUNS[key].mag, GUNS[key].reserve * ARMOUR.plenty]),
  );
  assert.deepEqual(start.guns, [
    [30, 180],
    [12, 72],
    [6, 36],
  ]);
  assert.equal(start.grenades, 2, 'the EMPs are as they were');
  await page.until('document.querySelector("#hud .ammo .total").textContent === "210"', 'the screen to say 210', 3000);
  // a cache: twice its rounds for every gun, one EMP as before
  await page.evaluate('{ const [x, z] = __G.site.ammo[0]; __G.debug.teleport(x, z, 0); }');
  await page.until('__G.caches.has(0)', 'the cache to be emptied', 4000);
  const after = await carried(page);
  assert.deepEqual(
    after.guns.map(([, reserve], i) => reserve - start.guns[i][1]),
    GUN_ORDER.map((key) => GUNS[key].cache * ARMOUR.plenty),
  );
  assert.equal(after.grenades, 3);
  // begun again — and again: what is carried is the table's twice over, not twice what was carried
  await page.evaluate('__G.debug.start(); __G.debug.start(); void 0');
  assert.deepEqual((await carried(page)).guns, start.guns);
  assert.deepEqual(await page.problems(), []);
});

test('a drone that is struck jinks: it turns back round its circle and is somewhere else — once, not at every round of a burst', async () => {
  const staged = await page.json(`(() => {
    const G = __G, e = G.enemies; G.debug.start(); G.player.hidden = false; G.player.health = 1e6;
    e.remove(e.list.map((u) => u.rollId));
    // the open middle of the cavern, a drone already in the fight and on its circle round him
    G.debug.teleport(62.5, 68.5, 0);
    const drone = e.reinforce('drone', [[68, 68]], { x: 62.5, z: 68.5 })[0];
    drone.brain.state = 'combat'; drone.brain.awareness = 3;
    window.__it = drone;
    return { id: drone.id };
  })()`);
  assert.ok(staged.id > 0);
  // on its circle, and going round it
  await page.until(
    '__it.sees && Math.abs(Math.hypot(__it.x - __G.player.x, __it.z - __G.player.z) - 8) < 1.5',
    'the drone to be on its circle',
    20000,
  );
  const angle = '(() => Math.atan2(__it.z - __G.player.z, __it.x - __G.player.x))()';
  const struck = await page.json(`(() => {
    const G = __G, u = __it, before = { orbit: u.orbit, dir: u.orbitDir, at: ${angle}, t: G.mission.time };
    const by = G.wild.plate({ unit: u, zone: 'body', multiplier: 1, t: 8 });
    const first = { orbit: u.orbit, dir: u.orbitDir };
    // the rest of a burst, a tenth of a second apart: it holds the line it has taken
    for (let k = 0; k < 4; k++) G.wild.plate({ unit: u, zone: 'body', multiplier: 1, t: 8 });
    return { by, before, first, burst: { orbit: u.orbit, dir: u.orbitDir } };
  })()`);
  assert.equal(struck.by, ARMOUR.rounds.drone);
  assert.equal(struck.first.dir, -struck.before.dir, 'it turns back the other way');
  assert.ok(Math.abs(struck.first.orbit - (struck.before.orbit + struck.first.dir * ARMOUR.jink)) < 1e-9);
  assert.deepEqual(struck.burst, struck.first, 'four more rounds at once change nothing');
  // and it goes: a second and a quarter on it is round the circle the NEW way from where it was struck
  await page.until(`__G.mission.time >= ${struck.before.t + 1.25}`, 'a second and a quarter', 10000);
  const moved = await page.json(`(() => {
    let d = ${angle} - ${struck.before.at};
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return { turned: d, dir: __it.orbitDir, dead: __it.dead };
  })()`);
  assert.equal(moved.dead, false);
  assert.ok(
    moved.turned * struck.first.dir > 0.25,
    `it was to be at least a quarter of a radian round the new way: ${JSON.stringify(moved)} after ${JSON.stringify(struck)}`,
  );
  // its time up, the next round sends it back again
  await page.until(`__G.mission.time >= ${struck.before.t + ARMOUR.jinkEvery + 0.1}`, 'the time between two', 10000);
  const again = await page.json(`(() => {
    const u = __it, dir = u.orbitDir;
    __G.wild.plate({ unit: u, zone: 'body', multiplier: 1, t: 8 });
    return { was: dir, is: u.orbitDir };
  })()`);
  assert.equal(again.is, -again.was);
  assert.deepEqual(await page.problems(), []);
});

test('armour=0: the machines as they were — three to a body, two to a head — and the rounds as they were', async () => {
  const off = await open(`${PLAY}&response=0&armour=0`);
  try {
    assert.equal(await off.evaluate('__G.wild.feature("armour")'), null);
    assert.equal(await off.evaluate('__G.wild.plenty()'), 1);
    await faceSentry(off);
    assert.deepEqual((await carried(off)).guns, [
      [30, 90],
      [12, 36],
      [6, 18],
    ]);
    const whole = await read(off);
    await round(off, BODY_Y);
    assert.equal((await read(off)).hp, whole.hp - GUNS.carbine.damage);
    await round(off, BODY_Y);
    await round(off, BODY_Y);
    const three = await read(off);
    assert.deepEqual([three.dead, three.tally.plated], [true, undefined]);
    // the visor alone: one cracks it, one goes through
    await faceSentry(off);
    await round(off, HEAD_Y);
    assert.equal((await read(off)).dead, false);
    await round(off, HEAD_Y);
    assert.equal((await read(off)).dead, true);
    assert.deepEqual(await off.problems(), []);
  } finally {
    await off.close();
  }
});
