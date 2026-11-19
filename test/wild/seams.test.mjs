// The seams the wild build's sound goes through (src/audio/audio.js: `graph`, `setMix`, `setScore`), in the built
// game with sound on. With nothing set through them the engine is the one it was — the suites written before the
// wild build hold that, with the switch off.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openWith, startWild } from './helpers.mjs';

let harness;
let page;

before(async () => {
  harness = await startWild();
  page = await openWith(harness)('look=1&dynres=0&touch=0&autostart=1');
  // sound runs from the first key or click (the game's own rule); M opens and shuts the map, and changes nothing
  await page.press('KeyM');
  await page.press('KeyM');
  await page.until('__G.audio.state === "running"', 'sound to be running', 10000);
});

after(async () => {
  await harness?.stop();
});

test('the engine says what it is built of, once it runs: one clock, and the three buses everything goes to', async () => {
  const graph = await page.json(`(() => {
    const g = __G.audio.graph();
    return g && { ctx: g.ctx.constructor.name, state: g.ctx.state, buses: [g.master, g.music, g.ambience].map((n) => n.constructor.name) };
  })()`);
  assert.deepEqual(graph, { ctx: 'AudioContext', state: 'running', buses: ['GainNode', 'GainNode', 'GainNode'] });
});

test('a mix that is set is handed every voice as it starts, and asked how far away sounds dull', async () => {
  const seen = JSON.parse(
    await page.evaluate(`(async () => {
    const G = __G, saw = { sends: [], cuts: [] };
    const was = G.audio.setMix({
      send(node, name, opts) { saw.sends.push([name, node.constructor.name, opts.x !== undefined]); },
      cut(far) { saw.cuts.push(far); return 20000; },
    });
    const p = G.player;
    // one sound with a place — 15 m off, of the 30 a bullet's strike is heard at — and one with none
    G.audio.play('hitWall', { x: p.x + 15, y: p.eye, z: p.z });
    G.audio.play('uiSelect');
    const loop = G.audio.loop('droneFly', { x: p.x + 5, y: 2, z: p.z, gain: 0.5 });
    await new Promise((done) => setTimeout(done, 300));
    loop.stop(0);
    G.audio.setMix(was || null);
    return JSON.stringify(saw);
  })()`),
  );
  const names = seen.sends.map(([name]) => name);
  assert.ok(
    names.includes('hitWall') && names.includes('uiSelect') && names.includes('droneFly'),
    JSON.stringify(seen.sends),
  );
  assert.ok(seen.sends.every(([, node]) => node === 'GainNode'));
  // how far off, as a part of how far the sound carries: the one with a place about half, the one with none nought
  assert.ok(
    seen.cuts.some((far) => Math.abs(far - 0.5) < 0.1),
    JSON.stringify(seen.cuts),
  );
  assert.ok(seen.cuts.includes(0), JSON.stringify(seen.cuts));
  assert.ok(seen.cuts.every((far) => far >= 0 && far <= 1));
});

test('a score that is set is told the scene instead of the game’s own — and the game’s own comes back when it is taken off', async () => {
  const told = await page.json(`(() => {
    const G = __G, told = [];
    const was = G.audio.setScore({ setState: (name) => told.push(name), update: () => told.push('.') });
    G.audio.music('combat');
    G.audio.update(0.016);
    const own = G.audio.setScore(was || null);
    G.audio.music('calm');
    return { told, tookOff: typeof own };
  })()`);
  assert.deepEqual(
    told.told.filter((t) => t !== '.'),
    ['combat'],
  );
  assert.ok(told.told.includes('.'), 'it is not stepped');
  assert.equal(told.tookOff, 'object');
  assert.deepEqual(await page.problems(), []);
});
