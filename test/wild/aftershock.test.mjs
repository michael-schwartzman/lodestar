// Aftershocks, in the built game (src/wild/aftershock.js holds when one comes and how hard;
// test/unit/wild-aftershock.test.mjs holds that): nothing while the cascades stand; once they are gone the floor
// jumps, dust comes down off the roof and not out of the sky, the hall is heard coming down — and at the last
// they come fast and hard.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AFTERSHOCK } from '../../src/wild/aftershock.js';
import { LINES } from '../../src/wild/warden.js';
import { PLAY, openWith, startWild } from './helpers.mjs';

let harness;
let page;

before(async () => {
  harness = await startWild();
  page = await openWith(harness)(PLAY);
});

after(async () => {
  await harness?.stop();
});

const shock = '__G.wild.feature("aftershock")';
/** a mission with nobody in it; everything the game is asked to sound and every fall of dust is written down */
const begin = () =>
  page.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true; G.enemies.clear();
    const seen = (window.__seen = { heard: [], dust: [] });
    if (!G.audio.__play) {
      G.audio.__play = G.audio.play;
      G.fx.__dust = G.fx.dust;
      G.audio.play = (name, o = {}) => { window.__seen.heard.push([name, o.x ?? null, o.z ?? null, o.rate ?? 1, G.mission ? G.mission.time : 0]); return G.audio.__play(name, o); };
      G.fx.dust = (x, y, z, nx, ny, nz, ...rest) => { if (ny === -1) window.__seen.dust.push([x, y, z, G.world.openSky(x, z), G.world.grid.walkable(Math.floor(x), Math.floor(z), true), Math.hypot(x - G.player.x, z - G.player.z)]); return G.fx.__dust(x, y, z, nx, ny, nz, ...rest); };
    }
    void seen;
  })()`);
const fast = async (expression, label, timeoutMs = 30000) => {
  await page.evaluate('__G.debug.speed(8); void 0');
  try {
    await page.until(expression, label, timeoutMs);
  } finally {
    await page.evaluate('__G.debug.speed(1); void 0');
  }
};
const said = () =>
  page.json(
    '[...document.querySelectorAll("#hud .radio p")].filter((p) => p.firstChild.textContent === "WARDEN").map((p) => p.lastChild.textContent)',
  );

test('while the cascades stand the mountain is still; once they are gone the floor jumps, dust comes off the roof, and the hall is heard coming down', async () => {
  await begin();
  await fast('__G.mission.time > 20', 'twenty seconds of the mission');
  assert.equal(await page.evaluate(`${shock}.state.count`), 0);
  assert.deepEqual(await page.json('__seen.dust'), []);

  // the charges are fired from the control room (a built ceiling overhead)
  await page.evaluate(
    '__G.debug.teleport(__G.site.firing.x, __G.site.firing.z); __G.debug.rig(); __G.debug.blow(); void 0',
  );
  const blown = await page.evaluate('__G.mission.time');
  await fast(`${shock}.state.count >= 1`, 'the first aftershock');
  const first = await page.json(`${shock}.state.last`);
  // it waits for the blast to be over, and is one of the weak ones: nothing presses yet
  assert.ok(
    first.at - blown >= AFTERSHOCK.first - 0.1 && first.at - blown < AFTERSHOCK.first + 0.5,
    `${first.at - blown} s after`,
  );
  assert.ok(first.strength < AFTERSHOCK.secondary && first.secondary === false, JSON.stringify(first));
  assert.equal(await page.evaluate('document.querySelector("#hud .note").textContent'), 'THE MOUNTAIN IS MOVING');
  // the hall coming down again, from where the hall is, lower than the blast itself was
  const heard = (await page.json('__seen.heard')).filter(
    ([name, , , , at]) => name === 'cascadeBlast' && at > blown + 1,
  );
  assert.equal(heard.length, 1, JSON.stringify(heard));
  assert.deepEqual([heard[0][1], heard[0][2]], [51, 29]);
  assert.ok(heard[0][3] >= 0.75 && heard[0][3] < 0.95, `played at ${heard[0][3]} of its speed`);
  // dust: some of its falls found a roof — and what it shook loose lands after it
  assert.ok(first.fell >= 1 && first.fell <= first.falls.length, JSON.stringify(first));
  await fast(`${shock}.state.falling === 0`, 'the dust to be down');
  const seen = await page.json('__seen');
  assert.ok(seen.dust.length >= first.fell * 3, `${seen.dust.length} puffs for ${first.fell} falls`);
  assert.ok(
    seen.heard.some(([name, x]) => name === 'hitWall' && x !== null),
    'nothing landed',
  );
  // WARDEN has a word for it (at the first, or — if it had only just spoken of the alarm — at the next)
  await fast(`${shock}.state.count >= 2`, 'the second');
  assert.ok((await said()).includes(LINES.aftershock[0]), JSON.stringify(await said()));
  assert.equal(await page.evaluate('__G.wild.tally.aftershocks'), await page.evaluate(`${shock}.state.count`));
  assert.deepEqual(await page.problems(), []);
});

test('the dust comes off a roof and into a place there is: never out of the sky, never inside a wall, never on the player', async () => {
  // (from the test above: the control room; and now the forecourt, half of which is under the sky)
  await page.evaluate('__G.debug.teleport(__G.site.pickup.x, 86); void 0');
  const from = await page.evaluate(`${shock}.state.count`);
  await fast(
    `${shock}.state.count >= ${from + 3} && ${shock}.state.falling === 0`,
    'three more, and their dust down',
    60000,
  );
  const dust = await page.json('__seen.dust');
  assert.ok(dust.length > 0);
  for (const [x, y, z, sky, free] of dust) {
    assert.deepEqual([sky, free], [false, true], `dust at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    assert.ok(y > 0.5 && y <= 4.5, `dust at a height of ${y}`);
  }
  // (how far from the player each fall BEGAN is the rules' ring; by the time its last puff is drawn the player
  // may have been moved by this test: the first puff of each fall is the one that is asked about)
  const last = await page.json(`${shock}.state.last`);
  assert.ok(last.fell <= last.falls.length);
  for (const [dx, dz] of last.falls) assert.ok(Math.hypot(dx, dz) >= AFTERSHOCK.ring[0] - 1e-9);
  assert.deepEqual(await page.problems(), []);
});

test('at the last they come fast and hard: with the strike seconds away, more shake and something going off in the hall', async () => {
  const weak = await page.json(`${shock}.state.last`);
  // the lodestar is up with a long clock — the game itself says so to the wild build, a step later — and then
  // the clock is nearly out (the mission's own book-keeping is not what is asked about here: only how pressed
  // things are)
  await page.evaluate('__G.mission.phase = "exfil"; __G.mission.clock = 1000; void 0');
  await page.until(`${shock}.state.clock0 > 990`, 'the game to say the lodestar is up', 5000);
  await page.evaluate('__G.mission.clock = 60; void 0');
  const from = await page.evaluate(`${shock}.state.count`);
  // (the one that was already on its way comes when it was going to; the ones after it are the pressed ones)
  await fast(`${shock}.state.count >= ${from + 3}`, 'three more', 60000);
  const hard = await page.json(`${shock}.state.last`);
  assert.ok(hard.strength >= 0.8 && hard.secondary === true, JSON.stringify(hard));
  assert.ok(hard.shake > 1.8 * weak.shake, `${hard.shake} against ${weak.shake}`);
  const gap = await page.evaluate(`${shock}.state.wait`);
  assert.ok(gap <= AFTERSHOCK.gap[1] * (1 + AFTERSHOCK.jitter) + 1.5, `the next is ${gap} s off`);
  const heard = await page.json('__seen.heard');
  assert.ok(
    heard.some(([name, x, z, , at]) => name === 'explosion' && x === 51 && z === 29 && at >= hard.at - 0.05),
    'nothing went off in the hall',
  );
  assert.deepEqual(await page.problems(), []);
});

test('a retry from a checkpoint keeps how many there have been; a new mission is a still mountain again', async () => {
  const [count, clock0] = await page.json(`[${shock}.state.count, ${shock}.state.clock0]`);
  assert.ok(count >= 5 && clock0 > 990, `${count} aftershocks, a clock that began at ${clock0}`);
  const kept = await page.evaluate('JSON.stringify(__G.wild.save())');
  await begin();
  assert.deepEqual(await page.json(`[${shock}.state.count, ${shock}.state.clock0, ${shock}.state.falling]`), [0, 0, 0]);
  await page.evaluate(`__G.wild.load(${kept}); void 0`);
  assert.deepEqual(await page.json(`[${shock}.state.count, ${shock}.state.clock0]`), [count, clock0]);
  assert.deepEqual(await page.problems(), []);
});
