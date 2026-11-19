// A sentry's visor, in the built game (src/wild/visor.js holds the rule, test/unit/wild-visor.test.mjs the
// arithmetic): real rounds, fired at a machine's head.
//
// 18 November 2026 — the owner: "don't make it so easy to just remove robots will headshots i want to feel i'm
// working for it".
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GUNS } from '../../src/arms.js';
import { LINES } from '../../src/wild/warden.js';
import { PLAY, openWith, sleep, startWild } from './helpers.mjs';

let harness;
let open;
let page;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
  // (18 November 2026, later: the machines are plated as well — src/wild/armour.js — and a round counts half
  // against one. This suite asks what the VISOR does to a round, by the figure: the plating is switched off on
  // its pages, as it is in the arithmetic of test/unit/wild-visor.test.mjs. The two together — a head is three
  // rounds, not two — are asked in test/wild/armour.test.mjs.)
  page = await open(`${PLAY}&armour=0`);
});

after(async () => {
  await harness?.stop();
});

/** one sentry, 2.4 metres east of the player and stopped where it stands; the carbine on SEMI */
async function faceOne(page) {
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
/** one round at a height: 1.74 m is the middle of its head, 1.26 of its body (the eye is at 1.62). On SEMI, one
 * pull is one round */
async function round(page, height) {
  const shots = await page.evaluate(
    `(() => { const p = __G.player; p.yaw = ${-Math.PI / 2}; p.pitch = Math.atan2(${height} - p.eye, 2.4); return __G.weapon.shots; })()`,
  );
  await page.keyDown('KeyX', 'x', 88);
  try {
    await page.until(`__G.weapon.shots === ${shots + 1}`, 'one round', 5000);
  } finally {
    await page.keyUp('KeyX', 'x', 88);
  }
  await sleep(350);
}
const read = (page) =>
  page.json(`(() => {
    const G = __G, u = G.enemies.byName('gate'), f = G.wild?.feature('visor');
    return { hp: u.hp, dead: u.dead, cracked: f ? f.cracked(u) : null, tally: G.wild ? { ...G.wild.tally } : null,
      note: document.querySelector('#hud .note').textContent,
      radio: [...document.querySelectorAll('#hud .radio p')].map((p) => p.lastChild.textContent),
      eye: [u.parts.eye.scale.x, Math.abs(u.parts.eye.position.x)] };
  })()`);

test('the first round to a sentry’s head cracks its visor and no more; the second shuts it down', async () => {
  await faceOne(page);
  const whole = await read(page);
  assert.deepEqual([whole.cracked, whole.eye], [false, [1, 0]]);
  await round(page, 1.74);
  const cracked = await read(page);
  assert.equal(cracked.dead, false, 'one round to the head, and it is still up');
  assert.equal(cracked.hp, whole.hp - GUNS.carbine.damage, 'it counted as a round to the body');
  assert.equal(cracked.cracked, true);
  assert.equal(cracked.note, 'VISOR CRACKED');
  assert.equal(cracked.tally.visors, 1);
  // it shows: what is left of the bar of light in its visor is short, and to one side
  assert.ok(cracked.eye[0] < 0.5 && cracked.eye[1] > 0.03, `the bar of light: ${cracked.eye}`);
  // and WARDEN, whose machine it is, has a word for it
  assert.equal(cracked.radio.at(-1), LINES.visor[0]);
  await round(page, 1.74);
  const down = await read(page);
  assert.equal(down.dead, true, 'the second round to the head');
  assert.equal(down.note, 'HEAD SHOT');
  assert.equal(down.tally.visors, 1, 'a visor cracks once');
  assert.deepEqual(await page.problems(), []);
});

test('rounds to the body are as they were, and crack nothing', async () => {
  await faceOne(page);
  const whole = await read(page);
  await round(page, 1.26);
  await round(page, 1.26);
  const two = await read(page);
  assert.equal(two.hp, whole.hp - 2 * GUNS.carbine.damage);
  assert.deepEqual([two.cracked, two.dead, two.tally.visors], [false, false, undefined]);
  await round(page, 1.26);
  assert.equal((await read(page)).dead, true, 'three to the body, as before');
  assert.deepEqual(await page.problems(), []);
});

test('the classic game, and visor=0: one round to the head, as it always was', async () => {
  for (const query of [`${PLAY}&wild=0`, `${PLAY}&visor=0&armour=0`]) {
    const other = await open(query);
    await faceOne(other);
    await round(other, 1.74);
    const r = await read(other);
    assert.equal(r.dead, true, query);
    assert.equal(r.cracked, null, query);
    assert.deepEqual(await other.problems(), []);
    await other.close();
  }
});
