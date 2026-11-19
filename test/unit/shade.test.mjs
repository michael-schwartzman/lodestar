// Contract lock: the arithmetic behind the picture — the parts of it that are not a shader.
// What a surface is made of when nobody said, how the light that was worked out beforehand remembers where it
// came from, how big the bloom's steps are, and when the finishing passes are used at all.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bloomChain, chamferBox, createLightSum, postPlan, relight, surfaceOf } from '../../src/gfx/shade.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('light sum: one lamp — all of the light comes from where the lamp is', () => {
  const sum = createLightSum();
  sum.reset();
  sum.add(1, 0.5, 0.2, 0, 3, 4);
  const out = sum.finish({});
  assert.deepEqual([out.r, out.g, out.b], [1, 0.5, 0.2]);
  assert.ok(
    near(Math.hypot(out.dx, out.dy, out.dz), 1),
    'the direction is as long as the share of light it stands for',
  );
  assert.ok(near(out.dx, 0) && near(out.dy, 0.6) && near(out.dz, 0.8), 'and points at the lamp');
});

test('light sum: light with no direction (the sky, a dark room) shortens the arrow, never turns it', () => {
  const sum = createLightSum();
  sum.reset();
  sum.ambient(0.5, 0.5, 0.5);
  sum.add(0.5, 0.5, 0.5, 0, 1, 0);
  const out = sum.finish({});
  assert.deepEqual([out.r, out.g, out.b], [1, 1, 1]);
  assert.ok(near(out.dx, 0) && near(out.dz, 0));
  assert.ok(near(out.dy, 0.5), `half the light has a direction: ${out.dy}`);
});

test('light sum: two equal lamps on opposite sides cancel — the light is real, the direction is not', () => {
  const sum = createLightSum();
  sum.reset();
  sum.add(1, 1, 1, 5, 0, 0);
  sum.add(1, 1, 1, -5, 0, 0);
  const out = sum.finish({});
  assert.deepEqual([out.r, out.g, out.b], [2, 2, 2]);
  assert.ok(Math.hypot(out.dx, out.dy, out.dz) < 1e-9);
});

test('light sum: the brighter lamp pulls the direction towards itself; the arrow is never longer than 1', () => {
  const sum = createLightSum();
  sum.reset();
  sum.add(3, 3, 3, 1, 0, 0);
  sum.add(1, 1, 1, 0, 0, 1);
  const out = sum.finish({});
  assert.ok(out.dx > out.dz * 2.9 && out.dz > 0);
  const length = Math.hypot(out.dx, out.dy, out.dz);
  assert.ok(length > 0.75 && length <= 1, `length ${length}`);
});

test('light sum: nothing at all is black with no direction, and reset forgets everything', () => {
  const sum = createLightSum();
  sum.reset();
  assert.deepEqual(sum.finish({}), { r: 0, g: 0, b: 0, dx: 0, dy: 0, dz: 0 });
  sum.add(1, 1, 1, 0, 1, 0);
  sum.reset();
  assert.deepEqual(sum.finish({}), { r: 0, g: 0, b: 0, dx: 0, dy: 0, dz: 0 });
});

test('relight: a bump facing the light is brighter, one facing away darker, and flat is unchanged', () => {
  // geo: how squarely the flat surface faced the light when it was worked out; per: how squarely this pixel does
  assert.equal(relight(0.8, 0.8, 1), 1, 'no bump, no change');
  assert.ok(relight(0.8, 1.0, 1) > 1);
  assert.ok(relight(0.8, 0.4, 1) < 1);
  assert.equal(relight(0.8, 0.2, 0), 1, 'light with no direction cannot be re-aimed');
  assert.ok(near(relight(0.8, 0.4, 0.5), 0.75), 'half directional: half the change');
});

test('relight: never negative, never a blow-up on a surface the light only grazed', () => {
  for (const geo of [0, 0.01, 0.1, 0.5, 1])
    for (const per of [0, 0.3, 1])
      for (const k of [0, 0.5, 1]) {
        const v = relight(geo, per, k);
        assert.ok(v >= 0 && v <= 2, `relight(${geo}, ${per}, ${k}) = ${v}`);
      }
});

test('what a part is made of when nobody said: dark greys are metal, strong colours are paint, black is rubber', () => {
  const gunmetal = surfaceOf(0.12, 0.13, 0.14);
  const paint = surfaceOf(0.7, 0.2, 0.1);
  const rubber = surfaceOf(0.006, 0.006, 0.007);
  const concrete = surfaceOf(0.55, 0.55, 0.52);
  assert.ok(gunmetal.metal > 0.5 && gunmetal.rough < 0.55, JSON.stringify(gunmetal));
  assert.ok(paint.metal < 0.1 && paint.rough > 0.4, JSON.stringify(paint));
  assert.ok(rubber.metal < 0.2 && rubber.rough > 0.7, JSON.stringify(rubber));
  assert.ok(concrete.metal < 0.35, JSON.stringify(concrete));
  for (const s of [gunmetal, paint, rubber, concrete]) {
    assert.ok(s.rough >= 0.05 && s.rough <= 1);
    assert.ok(s.metal >= 0 && s.metal <= 1);
  }
});

test('a chamfered box: 24 corners like a plain box, 44 triangles, every one of them facing outwards', () => {
  const { position, normal, index } = chamferBox(2, 1, 0.5, 0.05);
  assert.equal(position.length, 24 * 3);
  assert.equal(normal.length, 24 * 3);
  assert.equal(index.length, 44 * 3);
  // it fills its box exactly, and no further
  const max = [0, 0, 0];
  for (let i = 0; i < position.length; i++) max[i % 3] = Math.max(max[i % 3], Math.abs(position[i]));
  assert.deepEqual(max, [1, 0.5, 0.25]);
  // every triangle's own face points away from the middle
  for (let t = 0; t < index.length; t += 3) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((a) => position[index[t + k] * 3 + a]));
    const u = p[1].map((v, a) => v - p[0][a]);
    const w = p[2].map((v, a) => v - p[0][a]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const mid = [0, 1, 2].map((a) => (p[0][a] + p[1][a] + p[2][a]) / 3);
    assert.ok(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0, `triangle ${t / 3} faces inwards`);
  }
  // normals are unit length and point along one axis: the faces are flat, the bevels blend between them
  for (let v = 0; v < 24; v++) {
    const n = [normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]];
    assert.ok(near(Math.hypot(...n), 1));
    assert.equal(n.filter((c) => c !== 0).length, 1);
  }
});

test('a chamfered box: the bevel is never more than the box can spare', () => {
  const { position } = chamferBox(0.02, 1, 1, 0.5);
  let innerX = 0;
  for (let i = 0; i < position.length; i += 3)
    if (Math.abs(position[i]) < 0.01 - 1e-9) innerX = Math.max(innerX, Math.abs(position[i]));
  assert.ok(innerX > 0.001, 'a thin plate still has a face on each side of its bevel');
});

test('bloom: each step is half the one before, never smaller than two pixels, and there are as many as asked', () => {
  assert.deepEqual(bloomChain(1280, 720, 5), [
    [640, 360],
    [320, 180],
    [160, 90],
    [80, 45],
    [40, 22],
  ]);
  assert.deepEqual(bloomChain(7, 5, 4), [
    [3, 2],
    [2, 2],
    [2, 2],
    [2, 2],
  ]);
  assert.equal(bloomChain(1920, 1080, 3).length, 3);
});

test('the finishing passes: used where the device can hold bright values, and never otherwise', () => {
  const can = { webgl2: true, halfFloat: true };
  assert.deepEqual(postPlan({ post: true, msaa: 4 }, can, true), { enabled: true, samples: 4, fxaa: false });
  assert.deepEqual(postPlan({ post: true, msaa: 0 }, can, true), { enabled: true, samples: 0, fxaa: true });
  assert.equal(postPlan({ post: true, msaa: 4 }, { webgl2: true, halfFloat: false }, true).enabled, false);
  assert.equal(postPlan({ post: true, msaa: 4 }, { webgl2: false, halfFloat: true }, true).enabled, false);
  assert.equal(postPlan({ post: false, msaa: 4 }, can, true).enabled, false, 'a detail level can go without');
  assert.equal(postPlan({ post: true, msaa: 4 }, can, false).enabled, false, 'and so can the player (?post=0)');
});
