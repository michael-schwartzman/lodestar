// Flying a drone, in the built game (src/wild/pilot.js holds the rules of the flight, test/unit/wild-pilot.test.mjs
// holds them to their numbers): the key held on a real drone, the eye that goes into it, the body that is left
// behind — and every way the link ends.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PILOT, blastAt } from '../../src/wild/pilot.js';
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
/**
 * A stage on the open ground of the main cavern (x 54 … 72, z 65 … 69 is bare floor, and so is the ground north of
 * it to the building's wall at z 54 between x 56 … 71): every machine cleared off but those named, each put where
 * it is told ([x, z, yaw]) and keeping its post there; the player out of the way and not to be seen.
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
const pilot = '__G.wild.feature("pilot")';
const read = () =>
  page.json(`(() => {
    const G = __G, f = G.wild.feature('pilot'), d = G.enemies.byName('droneYard'), c = G.camera, p = G.player;
    const of = (name) => { const m = G.enemies.byName(name); return m && { dead: m.dead, hp: m.hp, state: m.brain.state, x: m.x, z: m.z }; };
    return { flying: f.flying, left: f.flight ? f.flight.t : null, drone: { x: d.x, y: d.y, z: d.z, dead: d.dead, piloted: !!d.piloted, carried: !!d.carried, drawn: d.model.root.visible },
      eye: [c.position.x, c.position.y, c.position.z], fov: c.fov, body: [p.x, p.z], head: [p.headX, p.eye, p.headZ], health: p.health, gun: G.weapon.visible,
      hud: G.hud.el.classList.contains('w-pilot'), cam: getComputedStyle(document.querySelector('#hud .w-cam')).display,
      ammo: getComputedStyle(document.querySelector('#hud .ammo')).display,
      chip: [...document.querySelectorAll('#hud .w-chip')].filter((c) => !c.hidden).map((c) => c.textContent).find((t) => /DRONE/.test(t)) || '',
      note: document.querySelector('#hud .note').textContent, tally: { ...G.wild.tally }, kills: G.kills, state: G.state,
      blocked: G.world.grid.blocked(Math.floor(d.x), Math.floor(d.z)), gate: of('gate'), road: of('road') };
  })()`);
const near = (a, b, within) => Math.hypot(...a.map((v, k) => v - b[k])) < within;
/** takes the drone as the uplink would, with the body where the test has put it */
const take = () => page.evaluate(`${pilot}.fly(${unit('droneYard')}); void 0`);

test('H held on a drone flies it: the eye goes into the drone, the hands work it, and the body stands where it was', async () => {
  await stage({ droneYard: [62.5, 66.5, EAST] });
  await page.evaluate(
    '__G.debug.teleport(62.5, 74.5, 0); __G.player.pitch = Math.atan2(3.0 - __G.player.eye, 8); void 0',
  );
  await page.until('document.querySelector("#hud .w-link").dataset.state === "ready"', 'the offer', 4000);
  assert.match(await page.evaluate('document.querySelector("#hud .w-link").textContent'), /UPLINK — FLY IT/);
  const before = await read();
  await page.keyDown('KeyH', 'h', 0);
  try {
    await page.until(`${pilot}.flying === true`, 'the drone to be taken', 4000);
  } finally {
    await page.keyUp('KeyH', 'h', 0);
  }
  await sleep(200);
  const up = await read();
  // the eye is the drone's; the drone itself is not drawn (the eye is inside it); the body has not moved
  assert.ok(near(up.eye, [up.drone.x, up.drone.y, up.drone.z], 0.3), `the eye is at ${up.eye}`);
  assert.deepEqual([up.drone.piloted, up.drone.carried, up.drone.drawn], [true, true, false]);
  assert.deepEqual(up.body, before.body);
  assert.equal(up.fov, PILOT.fov);
  // the gun is not in the hand, and the screen is the drone's
  assert.deepEqual([up.gun, up.hud, up.cam, up.ammo], [false, true, 'block', 'none']);
  await page.until(
    '[...document.querySelectorAll("#hud .w-chip")].some((c) => !c.hidden && /^FDRONE\\d+ s$/.test(c.textContent))',
    'the chip to say so',
    4000,
  );
  assert.equal(up.note, 'UPLINK — YOU HAVE THE DRONE');
  assert.equal(up.tally.flights, 1);

  // W flies it the way the player was looking — north — and the body stays where it is
  const drone = unit('droneYard');
  await page.keyDown('KeyW', 'w', 0);
  try {
    await page.until(`${drone}.z < ${up.drone.z - 3}`, 'it to fly three metres north', 8000);
  } finally {
    await page.keyUp('KeyW', 'w', 0);
  }
  const flown = await read();
  assert.ok(Math.abs(flown.drone.x - up.drone.x) < 0.5);
  assert.deepEqual(flown.body, before.body);
  // Space lifts it; C lets it down — never lower than what a drone flies over
  await page.keyDown('Space', ' ', 0);
  try {
    await page.until(`${drone}.y > ${flown.drone.y + 1.2}`, 'it to rise', 8000);
  } finally {
    await page.keyUp('Space', ' ', 0);
  }
  await page.keyDown('KeyC', 'c', 0);
  try {
    await page.until(`Math.abs(${drone}.y - ${PILOT.low}) < 0.02`, 'it to be let down as far as it goes', 12000);
    await sleep(400);
  } finally {
    await page.keyUp('KeyC', 'c', 0);
  }
  const low = await read();
  assert.ok(Math.abs(low.drone.y - PILOT.low) < 0.02, `let down, it hangs at ${low.drone.y}`);
  // into the building's wall (the south wall, z = 54) and no further
  await page.keyDown('KeyW', 'w', 0);
  try {
    await page.until(`${drone}.z < 55.6`, 'it to reach the wall', 12000);
    await sleep(500);
  } finally {
    await page.keyUp('KeyW', 'w', 0);
  }
  const stopped = await read();
  assert.equal(stopped.blocked, false);
  assert.ok(stopped.drone.z > 55.3 && stopped.drone.z < 56.2, `it stopped at z = ${stopped.drone.z}`);
  assert.equal(stopped.flying, true);
});

const mouse = (type) => page.send('Input.dispatchMouseEvent', { type, x: 640, y: 360, button: 'left', clickCount: 1 });

test('its gun is in the player’s hand, and its end is the player’s to choose: F blows it up where it hangs', async () => {
  await stage({ droneYard: [62.5, 66.5, EAST], gate: [62.5, 59.5, EAST], road: [64.5, 66.5, EAST] });
  // (the sentry beside it is held still, so that how far off it stands when the drone goes up can be read)
  await page.evaluate(`{ ${unit('gate')}.hp = 30; const r = ${unit('road')}; r.hp = r.hpMax = 100; r.stunT = 1e6; }`);
  await page.evaluate('__G.debug.teleport(62.5, 74.5, 0); void 0');
  await sleep(600);
  await take();
  // looking down at the sentry seven metres north of it
  await page.evaluate(
    `{ const f = ${pilot}.flight, d = ${unit('droneYard')}; f.yaw = 0; f.pitch = Math.atan2(1.26 - d.y, 7); }`,
  );
  await mouse('mousePressed');
  try {
    await page.until(`${unit('gate')}.dead === true`, 'its gun to shut the sentry down', 6000);
  } finally {
    await mouse('mouseReleased');
  }
  const shot = await read();
  assert.deepEqual([shot.kills, shot.tally.flownKills], [1, 1], 'a machine shut down from the air is a machine down');
  assert.equal(shot.flying, true);

  // F: it goes up where it hangs. What is near is hurt as the rule says; the drone is gone; the eye is back in
  // the head and the gun back in the hand.
  const there = await read();
  const apart = Math.hypot(there.road.x - there.drone.x, 1.2 - there.drone.y, there.road.z - there.drone.z);
  await page.press('KeyF');
  // (ten seconds, not three, since 18 November 2026: the key is taken at once — input.js keeps a press until
  // the next frame — but on a machine under load the frame that takes it was once more than three seconds off)
  await page.until(`${pilot}.flying === false`, 'the link to end', 10000);
  await sleep(200);
  const blown = await read();
  assert.equal(blown.drone.dead, true);
  assert.ok(
    Math.abs(100 - blown.road.hp - blastAt(apart)) < 3,
    `the sentry ${apart.toFixed(1)} m off lost ${100 - blown.road.hp}`,
  );
  assert.equal(blown.note, 'DRONE BLOWN');
  assert.deepEqual([blown.gun, blown.hud, blown.cam, blown.ammo], [true, false, 'none', 'block']);
  assert.ok(near(blown.eye, blown.head, 0.2), `the eye is at ${blown.eye}, the head at ${blown.head}`);
  assert.deepEqual([blown.drone.piloted, blown.drone.carried], [false, false]);
  // the F that ended it was the drone's: the body did nothing with it
  assert.equal(blown.state, 'playing');
});

test('the link ends by itself: when the body is hit, when the battery is spent — and a mission that ends or begins again leaves nothing behind', async () => {
  // the body is hit
  await stage({ droneYard: [62.5, 66.5, EAST] });
  await take();
  await sleep(300);
  await page.evaluate('__G.debug.hurt(10); void 0');
  await page.until(`${pilot}.flying === false`, 'the link to drop', 3000);
  const hit = await read();
  assert.equal(hit.note, 'YOU ARE HIT — LINK DROPPED');
  assert.deepEqual([hit.drone.dead, hit.gun, hit.hud], [true, true, false]);

  // the battery is spent
  await stage({ droneYard: [62.5, 66.5, EAST] });
  await take();
  await page.evaluate('__G.debug.speed(8); void 0');
  try {
    await page.until(`${pilot}.flying === false`, 'the battery to be spent', 8000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  const spent = await read();
  assert.equal(spent.note, 'LINK SPENT');
  assert.equal(spent.drone.dead, true);

  // the mission begun again while flying
  await stage({ droneYard: [62.5, 66.5, EAST] });
  await take();
  await sleep(200);
  await page.evaluate('__G.debug.start(); void 0');
  await sleep(300);
  const again = await read();
  assert.deepEqual(
    [again.flying, again.gun, again.hud, again.drone.piloted, again.drone.dead],
    [false, true, false, false, false],
  );
  assert.ok(near(again.eye, again.head, 0.2));
  assert.deepEqual(again.tally, {});

  // the body goes down while flying
  await stage({ droneYard: [62.5, 66.5, EAST] });
  await take();
  await sleep(200);
  await page.evaluate('__G.debug.hurt(500); void 0');
  await page.until('__G.menus.current() === "failed"', 'the failed screen', 10000);
  const down = await read();
  assert.deepEqual([down.flying, down.hud, down.gun], [false, false, false]);
  await page.evaluate('__G.debug.start(); void 0');
  await sleep(300);
  assert.equal((await read()).gun, true);

  // the mission ends under a flight without the link having dropped first — a shot that kills lands after the
  // experiment's step and before the mission's, so that is how every death in the air comes (found in review,
  // 16 November 2026: the drone was left the player's, for a million seconds, and fought on over the body)
  await stage({ droneYard: [62.5, 66.5, EAST] });
  await take();
  await sleep(200);
  await page.evaluate('window.__flown = __G.enemies.byName("droneYard"); __G.wild.emit("end"); void 0');
  const left = await page.json(
    '(({ turned, piloted, carried, dead }) => ({ turned: !!turned, piloted: !!piloted, carried: !!carried, dead: !!dead }))(window.__flown)',
  );
  assert.deepEqual(left, { turned: false, piloted: false, carried: false, dead: false });
  assert.equal(await page.evaluate(`${pilot}.flying`), false);
  assert.deepEqual(await page.problems(), []);
});
