// WARDEN speaks, in the built game (src/wild/warden.js holds its lines and when it holds its tongue;
// test/unit/wild-warden.test.mjs holds that): its line on the radio, in its own colour — and not too often.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LINES, WARDEN } from '../../src/wild/warden.js';
import { PLAY, openWith, startWild } from './helpers.mjs';

let harness;
let page;

before(async () => {
  harness = await startWild();
  // (18 November 2026: since that day an alarm and a charge each bring a wave, and WARDEN says so eight seconds
  // later — src/wild/response.js. This suite asks what WARDEN says of a thing and when it holds its tongue, by
  // the second: a line of the waves' landing in the middle of that is not what is asked here — it made "it
  // does not chatter" fail once, on a machine under load. The site's answer is switched off on this page;
  // that WARDEN speaks of a wave is asked in test/wild/response.test.mjs.)
  page = await openWith(harness)(`${PLAY}&response=0`);
});

after(async () => {
  await harness?.stop();
});

/** every line on the radio just now: who, what, and whether it is drawn as WARDEN's */
const radio = () =>
  page.json(
    '[...document.querySelectorAll("#hud .radio p")].map((p) => [p.firstChild.textContent, p.lastChild.textContent, p.classList.contains("w-warden")])',
  );
const said = async () => (await radio()).filter(([who]) => who === 'WARDEN').map(([, text]) => text);
const quiet = () => page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
/** lets so many seconds of the mission go by, quickly */
const pass = async (seconds) => {
  const until = (await page.evaluate('__G.mission.time')) + seconds;
  await page.evaluate('__G.debug.speed(8); void 0');
  try {
    await page.until(`__G.mission.time >= ${until}`, `${seconds} s of the mission to pass`, 30000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
};

test('the alarm goes up, and WARDEN says so: on the radio, in its own colour — and counted', async () => {
  await quiet();
  assert.deepEqual(await said(), []);
  // (as the game says it when a machine raises the alarm: main.js, the `alarm` hook)
  await page.evaluate('__G.wild.emit("alarm", true); void 0');
  const lines = await radio();
  const last = lines[lines.length - 1];
  assert.deepEqual(last, ['WARDEN', LINES.alarm[0], true]);
  assert.equal(await page.evaluate('__G.wild.tally.warden'), 1);
});

test('Overwatch’s lines stay Overwatch’s: when a machine really raises the alarm, only WARDEN’s own are in its colour', async () => {
  // (found in review, 16 November 2026: the test above once claimed this, and could not have failed — it says the
  // alarm itself, and so Overwatch, whose line the game's own hook speaks, never spoke in it)
  await page.evaluate(`(() => {
    const G = __G; G.debug.start();
    const e = G.enemies, yaw = ${Math.PI / 2};
    e.remove(e.list.filter((u) => u.name !== 'gate').map((u) => u.rollId));
    Object.assign(e.byName('gate'), { x: 62.5, z: 67.5, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[62, 67]], routeI: 0, path: null, goalX: -1 });
    G.debug.teleport(56.5, 67.5, ${-Math.PI / 2});
    // (it will be shot at for as long as this takes: it is not what is being asked about)
    G.player.health = 1000;
    G.debug.speed(4);
  })()`);
  try {
    await page.until('__G.enemies.alarm.active === true', 'a machine to raise the alarm', 40000);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
  const lines = await radio();
  const theirs = lines.filter(([who]) => who.toUpperCase() === 'OVERWATCH');
  const its = lines.filter(([who]) => who === 'WARDEN');
  assert.ok(theirs.length >= 1 && its.length >= 1, JSON.stringify(lines));
  assert.ok(
    theirs.every(([, , warden]) => warden === false),
    JSON.stringify(lines),
  );
  assert.ok(
    its.every(([, , warden]) => warden === true),
    JSON.stringify(lines),
  );
});

test('it does not chatter: a thing that happens a moment later goes unsaid, and is said when it happens again', async () => {
  await quiet();
  await page.evaluate('__G.wild.emit("alarm", true); __G.wild.emit("charge", __G.site.charges[0]); void 0');
  assert.deepEqual(await said(), [LINES.alarm[0]]);
  await pass(WARDEN.gap + 0.5);
  await page.evaluate('__G.wild.emit("charge", __G.site.charges[1]); void 0');
  const now = await said();
  assert.equal(now[now.length - 1], LINES.charge[0]);
});

test('it speaks of what the experiment does to it: a machine turned, a drone flown, the drives pushed', async () => {
  await quiet();
  await page.evaluate(
    '{ const [u] = __G.enemies.reinforce("sentry", [[60, 68]], { x: 60, z: 68 }); __G.wild.feature("uplink").turn(u); }',
  );
  assert.equal((await said()).pop(), LINES.turned[0]);
  await pass(WARDEN.gap + 0.5);
  await page.evaluate(
    '{ const [d] = __G.enemies.reinforce("drone", [[62, 66]], { x: 62, z: 66 }); __G.wild.feature("pilot").fly(d); }',
  );
  assert.equal((await said()).pop(), LINES.pilot[0]);
  await page.evaluate('__G.wild.feature("pilot").end("over"); void 0');
  await pass(WARDEN.gap + 0.5);
  // the third lamp shot out
  await page.evaluate('for (let i = 0; i < 3; i++) __G.wild.emit("lamp", i); void 0');
  assert.equal((await said()).pop(), LINES.lamp[0]);
  // a new mission is a new WARDEN: nothing is said, and the first line is its first again
  await quiet();
  assert.deepEqual(await said(), []);
  await page.evaluate('__G.wild.emit("alarm", true); void 0');
  assert.deepEqual(await said(), [LINES.alarm[0]]);
  assert.deepEqual(await page.problems(), []);
});
