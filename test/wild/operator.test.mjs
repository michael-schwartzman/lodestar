// The player's own figure, seen from outside while a drone is flown (src/wild/operator-live.js holds when it is
// drawn; src/wild/operator.js holds what it looks like, and test/unit/wild-operator.test.mjs its numbers): that
// it stands exactly where the body is, that it comes and goes with the link precisely, and that a drone looking
// back at it a few metres off actually sees it — in both looks.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { decodePng } from '../../tools/lib/png.mjs';
import { PLAY, QUIET, openWith, startWild } from './helpers.mjs';

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
/** The same bare, flat stretch test/wild/pilot.test.mjs stages its flights on. */
const stage = (on, places) =>
  on.evaluate(`(() => {
    const G = __G; G.debug.start(); G.player.hidden = true; G.debug.teleport(36.5, 70.5, 0);
    const e = G.enemies, places = ${JSON.stringify(places)};
    e.remove(e.list.filter((u) => !(u.name in places)).map((u) => u.rollId));
    for (const [name, [x, z, yaw]] of Object.entries(places))
      Object.assign(e.byName(name), { x, z, yaw, postYaw: yaw, headYaw: 0, scanT: 0, waitT: 1e6, route: [[Math.floor(x), Math.floor(z)]], routeI: 0, path: null, goalX: -1 });
  })()`);
const unit = (name) => `__G.enemies.byName("${name}")`;
const pilot = '__G.wild.feature("pilot")';
const operator = '__G.wild.feature("operator")';
/** takes the drone as the uplink would, with the body where the test has put it */
const take = (on) => on.evaluate(`${pilot}.fly(${unit('droneYard')}); void 0`);
const opState = (on) =>
  on.json(`(() => {
    const g = ${operator}.group, p = __G.player;
    return { visible: g.visible, pos: [g.position.x, g.position.y, g.position.z], yaw: g.rotation.y,
      body: [p.x, p.y, p.z], bodyYaw: p.yaw, upperScale: ${operator}.parts.upperBody.scale.y };
  })()`);
/** waits for a frame beyond this one to have been drawn — the game's own clock, never a fixed sleep */
const nextFrame = async (on) => {
  const at = await on.json('__G.frames');
  await on.until(`__G.frames > ${at + 1}`, 'the next frame to be drawn', 4000);
};

test('not flying nothing of it is drawn; flying, it stands exactly where the body is and faces the way it does — the body moved first, to prove it is followed; crouched, it crouches', async () => {
  assert.equal(await page.json(`${operator}.group.visible`), false);

  await stage(page, { droneYard: [62.5, 66.5, EAST] });
  // well away from the drone, and a yaw no coincidence would match
  await page.evaluate('__G.debug.teleport(40.5, 58.5, 1.1); void 0');
  await take(page);
  await page.until(`${operator}.group.visible === true`, 'the figure to appear', 4000);
  const s = await opState(page);
  assert.deepEqual(s.pos, s.body);
  assert.equal(s.yaw, s.bodyYaw);
  assert.equal(s.upperScale, 1);

  // crouched when the link is taken, the figure crouches with it (test/unit/wild-operator.test.mjs holds the
  // numbers; here only that the live wiring reaches it)
  await page.evaluate('__G.player.crouched = true; void 0');
  await page.until(`${operator}.parts.upperBody.scale.y < 1`, 'the figure to crouch', 2000);
  await page.evaluate('__G.player.crouched = false; void 0');
  await page.until(`${operator}.parts.upperBody.scale.y === 1`, 'the figure to stand again', 2000);
});

test('however the link ends — spent, hit, lost or blown, or the mission itself — the figure goes with it; a mission begun again leaves only the one, and it hidden', async () => {
  for (const why of ['spent', 'hit', 'lost', 'blown']) {
    await stage(page, { droneYard: [62.5, 66.5, EAST] });
    await take(page);
    await page.until(`${operator}.group.visible === true`, `visible before '${why}' ends it`, 4000);
    await page.evaluate(`${pilot}.end('${why}'); void 0`);
    await page.until(`${operator}.group.visible === false`, `hidden once '${why}' ends it`, 4000);
  }
  // the mission ending under a flight without the link having dropped first (pilot-live.js, 16 November 2026)
  await stage(page, { droneYard: [62.5, 66.5, EAST] });
  await take(page);
  await page.until(`${operator}.group.visible === true`, 'visible before the mission ends', 4000);
  await page.evaluate('__G.wild.emit("end"); void 0');
  await page.until(`${operator}.group.visible === false`, 'hidden once the mission ends', 4000);

  // a mission begun again: not visible, and the figure built once is never built a second time
  await stage(page, { droneYard: [62.5, 66.5, EAST] });
  await take(page);
  await page.until(`${operator}.group.visible === true`, 'visible before the restart', 4000);
  await page.evaluate('__G.debug.start(); void 0');
  await page.until(`${operator}.group.visible === false`, 'hidden once begun again', 4000);
  const named = await page.json('__G.world.group.parent.children.filter((o) => o.name === "wild-operator").length');
  assert.equal(named, 1);
  assert.deepEqual(await page.problems(), []);
});

test('with the experiment off there is no such thing', async () => {
  const off = await openWith(harness)(`${PLAY}&wild=0`);
  await off.evaluate('__G.debug.start(); void 0');
  assert.equal(await off.json('__G.wild'), null);
  assert.equal(await off.json("!!__G.world.group.parent.getObjectByName('wild-operator')"), false);
  assert.deepEqual(await off.problems(), []);
  await off.close();
});

/**
 * With the drone seven metres from the body and looking at it, a picture with the figure drawn differs from one
 * with it hidden over a patch at least 12 px wide and 40 tall where the body stands, and nowhere far from it. The
 * feature's own frame() — which would otherwise put the figure straight back — is turned off first, so hiding the
 * group is the only difference between the two pictures.
 */
async function seenFromTheDrone(on) {
  // the boot screen (index.html #boot) fades over half a second after the page says it is ready; left alone it
  // would still be animating — changing the whole picture, frame to frame — when the two screenshots are taken
  await on.until('!document.getElementById("boot")', 'the boot screen to be gone', 4000);
  await stage(on, { droneYard: [62.5, 66.5, EAST] });
  await on.evaluate('__G.debug.teleport(62.5, 59.5, 0); void 0');
  await take(on);
  await on.until(`${operator}.group.visible === true`, 'the figure to appear', 4000);
  const d = await on.json(`(({ x, y, z }) => ({ x, y, z }))(${unit('droneYard')})`);
  // the body stands 7 m north of the drone: look straight at it (yaw 0), tipped to its chest height
  await on.evaluate(`{ const f = ${pilot}.flight; f.yaw = 0; f.pitch = Math.atan2(0.9 - ${d.y}, 7); }`);
  await on.evaluate(QUIET);
  // film grain (src/gfx/post.js) changes every pixel every frame by design — off for this picture, so the
  // figure's being drawn or not is the only thing that can tell the two apart
  await on.evaluate('{ const look = __G.view.post && __G.view.post.look; if (look) look.grain = 0; }');
  await nextFrame(on);
  const shown = decodePng(await on.screenshot());

  await on.evaluate(`{
    const op = ${operator};
    window.__opFrame = op.frame;
    op.frame = () => {};
    op.group.visible = false;
  }`);
  await nextFrame(on);
  const hidden = decodePng(await on.screenshot());
  await on.evaluate(`{ const op = ${operator}; op.frame = window.__opFrame; delete window.__opFrame; }`);

  assert.equal(shown.width, hidden.width);
  assert.equal(shown.height, hidden.height);
  const differs = (a, b, i) =>
    Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]) >
    40;
  // the ground has its own glint, twinkling pixel to scattered pixel every frame, on top of the figure: so the
  // changed pixels are grouped into touching patches first, and it is the one patch the figure actually makes —
  // the biggest — that must be the right size and shape; a twinkle never touches enough of its neighbours to
  // grow into something that size
  const { width, height } = shown;
  const seen = new Uint8Array(width * height);
  const stack = [];
  let best = null;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (seen[start] || !differs(shown, hidden, start * 4)) continue;
      seen[start] = 1;
      stack.push(start);
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        size = 0;
      while (stack.length) {
        const p = stack.pop();
        const px = p % width;
        const py = (p - px) / width;
        size++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = px + dx,
            ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (seen[n] || !differs(shown, hidden, n * 4)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (!best || size > best.size) best = { size, minX, maxX, minY, maxY };
    }
  assert.ok(best, 'hiding the figure changed no pixel at all');
  const w = best.maxX - best.minX + 1;
  const h = best.maxY - best.minY + 1;
  assert.ok(w >= 12 && h >= 40, `the biggest patch that changed together is only ${w}×${h} px (${best.size} px)`);
  assert.ok(
    w < shown.width * 0.4 && h < shown.height * 0.7,
    `the biggest patch that changed together spreads far beyond the figure: ${w}×${h} px of ${shown.width}×${shown.height}`,
  );
  assert.deepEqual(await on.problems(), []);
}

test('from the drone’s eye the figure is seen — the first look', async () => {
  const look1 = await openWith(harness)(PLAY);
  try {
    await seenFromTheDrone(look1);
  } finally {
    await look1.close();
  }
});

test('from the drone’s eye the figure is seen — the second look too', async () => {
  const look2 = await openWith(harness)(PLAY.replace('look=1', 'look=2'));
  try {
    await seenFromTheDrone(look2);
  } finally {
    await look2.close();
  }
});
