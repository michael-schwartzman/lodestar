// What the game tells the wild build of, that it did not tell anything before 17 November 2026 (the rest of
// what it tells is held by the suites of the features that listen: test/wild/warden.test.mjs and the others).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sleep } from '../../tools/lib/browser.mjs';
import { PLAY, openWith, startWild } from './helpers.mjs';

let harness;
let page;

before(async () => {
  harness = await startWild();
  // (18 November 2026: an alarm brings a wave of machines now — src/wild/response.js, held by its own suite —
  // and each test here stages a world of one machine and counts what it does: the site's answer is switched off)
  page = await openWith(harness)(`${PLAY}&response=0`);
});

after(async () => {
  await harness?.stop();
});

test('a machine fires on the player: the wild build is told of every round, by whom, and whether it struck', async () => {
  // (a round that passes close by is heard to: src/wild/pack — and that needs to be told of the ones that miss)
  await page.evaluate(`(() => {
    const G = __G; G.debug.start();
    const e = G.enemies, yaw = ${Math.PI / 2};
    e.remove(e.list.filter((u) => u.name !== 'gate').map((u) => u.rollId));
    Object.assign(e.byName('gate'), { x: 62.5, z: 67.5, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[62, 67]], routeI: 0, path: null, goalX: -1 });
    G.debug.teleport(56.5, 67.5, ${-Math.PI / 2});
    G.player.health = 100000;
    // every event the game tells, as it tells it
    const seen = (window.__seen = { fired: [], hurt: 0 });
    const emit = G.wild.emit;
    G.wild.emit = (name, a, b, c) => {
      if (name === 'fired') seen.fired.push([a.type, a.name, typeof b.hit, b.hit]);
      if (name === 'hurt') seen.hurt++;
      return emit(name, a, b, c);
    };
    G.debug.speed(4);
  })()`);
  try {
    await page.until('__seen.fired.length >= 20', 'twenty rounds to be fired', 90000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  const seen = await page.json('__seen');
  for (const [type, name, kind] of seen.fired) assert.deepEqual([type, name, kind], ['sentry', 'gate', 'boolean']);
  // the ones that struck are the ones that hurt (nothing is held in front of the player here)
  const struck = seen.fired.filter(([, , , hit]) => hit).length;
  assert.equal(struck, seen.hurt, JSON.stringify(seen));
  // …and at six metres, where a little over half of them strike, in twenty rounds some do and some go by
  // (all twenty one way or the other: less than once in a hundred thousand runs)
  assert.ok(struck >= 1 && struck < seen.fired.length, `${struck} of ${seen.fired.length} struck`);
  assert.deepEqual(await page.problems(), []);
});

/** one sentry, 2.4 metres east of the player and stopped where it stands; the carbine on SEMI */
async function faceOne() {
  await page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true;
    const e = G.enemies, yaw = ${Math.PI / 2};
    e.remove(e.list.filter((u) => u.name !== 'gate').map((u) => u.rollId));
    Object.assign(e.byName('gate'), { x: 58.9, z: 67.5, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[58, 67]], routeI: 0, path: null, goalX: -1, stunT: 1e6 });
    G.debug.teleport(56.5, 67.5, ${-Math.PI / 2});
    G.weapon.arms.mode = 'semi';
  })()`);
  await sleep(150);
}
/** one round at its head (the eye is at 1.62 m, the middle of the head at 1.74): on SEMI, one pull is one round */
const round = async () => {
  const shots = await page.evaluate(
    `(() => { const p = __G.player; p.yaw = ${-Math.PI / 2}; p.pitch = Math.atan2(1.74 - p.eye, 2.4); return __G.weapon.shots; })()`,
  );
  await page.keyDown('KeyX', 'x', 88);
  try {
    await page.until(`__G.weapon.shots === ${shots + 1}`, 'one round', 5000);
  } finally {
    await page.keyUp('KeyX', 'x', 88);
  }
  await sleep(350);
};

test('a round strikes a machine: the wild build is asked how much it counts — and unasked, or answered with nothing, it counts as it always did', async () => {
  // (18 November 2026: the seam for a plated head — src/wild/visor.js. A feature answers with a number, the
  // multiplier the round is to have; no feature answering, the zone's own stands: a head, three times.)
  await faceOne();
  await page.evaluate(`(() => {
    window.__asked = [];
    __G.wild.__plate = __G.wild.plate;
    __G.wild.plate = (s) => { window.__asked.push([s.unit.name, s.zone, s.multiplier]); return 0; };
  })()`);
  const hp = await page.evaluate('__G.enemies.byName("gate").hp');
  await round();
  assert.deepEqual(await page.json('window.__asked'), [['gate', 'head', 3]]);
  assert.equal(await page.evaluate('__G.enemies.byName("gate").hp'), hp, 'answered 0, the round did nothing');
  // answered with nothing: a head round is the carbine's 34, three times over — and a sentry is down
  await page.evaluate('__G.wild.plate = () => undefined; void 0');
  await round();
  assert.equal(await page.evaluate('__G.enemies.byName("gate").dead'), true);
  await page.evaluate('__G.wild.plate = __G.wild.__plate; void 0');
  assert.deepEqual(await page.problems(), []);
});

test('a machine in a fight: the wild build is asked where it should go, seeing the player and not — and told it is seen to, the game does not move it, and it fires all the same', async () => {
  // (18 November 2026: the seam for machines that fight together — src/wild/squad.js)
  await page.evaluate(`(() => {
    const G = __G; G.debug.start();
    const e = G.enemies, yaw = ${Math.PI / 2};
    e.remove(e.list.filter((u) => u.name !== 'gate').map((u) => u.rollId));
    Object.assign(e.byName('gate'), { x: 66.5, z: 67.5, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[66, 67]], routeI: 0, path: null, goalX: -1 });
    G.debug.teleport(56.5, 67.5, ${-Math.PI / 2});
    G.player.health = 100000;
    window.__squad = { seeing: 0, blind: 0, handled: false, fired: 0 };
    G.wild.__squad = G.wild.squad;
    G.wild.squad = (unit, dt, inner) => {
      window.__squad[unit.sees ? 'seeing' : 'blind']++;
      if (typeof inner.goTo !== 'function') throw new Error('it was not lent the walking');
      return window.__squad.handled;
    };
    const emit = G.wild.emit;
    G.wild.emit = (name, a, b, c) => { if (name === 'fired') window.__squad.fired++; return emit(name, a, b, c); };
    G.debug.speed(4);
  })()`);
  try {
    // it makes the player out, and fights: asked every step it sees him
    await page.until('__G.enemies.byName("gate").brain.state === "combat" && __squad.seeing > 30', 'the fight', 30000);
    // told "seen to": the game moves it no more (it would close in, back off or step aside) — and it still fires
    const at = await page.json(
      '(() => { const u = __G.enemies.byName("gate"); __squad.handled = true; __squad.fired = 0; return [u.x, u.z, __G.mission.time]; })()',
    );
    await page.until(`__G.mission.time > ${at[2] + 6} && __squad.fired >= 3`, 'six seconds of the fight', 30000);
    const now = await page.json('(() => { const u = __G.enemies.byName("gate"); return [u.x, u.z]; })()');
    assert.ok(
      Math.hypot(now[0] - at[0], now[1] - at[1]) < 0.05,
      `it moved ${Math.hypot(now[0] - at[0], now[1] - at[1]).toFixed(2)} m by itself`,
    );
    // out of its sight (behind the wall of the road tunnel): asked still, as one that does not see
    await page.evaluate('__squad.handled = false; __squad.blind = 0; __G.debug.teleport(36.5, 40.5, 0); void 0');
    await page.until('__squad.blind > 10', 'to be asked when it does not see him', 30000);
  } finally {
    await page.evaluate('__G.debug.speed(1); __G.wild.squad = __G.wild.__squad; void 0');
  }
  assert.deepEqual(await page.problems(), []);
});
