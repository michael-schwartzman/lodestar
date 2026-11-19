// Contract lock: the arithmetic that turns a generated picture into a tile (tools/art/pixels.mjs).
// A picture from an image model is not a tile: its left edge does not meet its right, and it is rarely lit quite
// evenly. These are the rules the processing keeps, whatever picture it is given.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatten, grade, mute, seamError, seamless, stats } from '../../tools/art/pixels.mjs';

/** A repeatable stream of numbers in 0..1. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Noise round 0.5, with a slow drift from left to right and from top to bottom: nothing like a tile. */
function drifting(w, h, seed = 7) {
  const r = rng(seed);
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = 0.3 + 0.3 * (x / w) + 0.15 * (y / h) + (r() - 0.5) * 0.2;
  return rgb;
}

const spread = (rgb, w, h, x0, x1) => {
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = 0; y < h; y++)
    for (let x = x0; x < x1; x++) {
      const v = rgb[(y * w + x) * 3];
      n++;
      sum += v;
      sq += v * v;
    }
  return Math.sqrt(sq / n - (sum / n) ** 2);
};

test('a picture that drifts across is no tile; flattened and made seamless, its edges meet as well as its middle does', () => {
  const w = 120;
  const h = 120;
  const raw = drifting(w, h);
  const before = seamError(raw, w, h);
  assert.ok(before.x > 2 && before.y > 1.3, `the test picture already tiles: ${JSON.stringify(before)}`);
  const tile = seamless(flatten(raw, w, h), w, h, { band: 0.2 });
  // the strip that was laid over the far edge is gone from the near one: the tile is that much smaller
  assert.deepEqual([tile.w, tile.h], [96, 96]);
  assert.equal(tile.rgb.length, 96 * 96 * 3);
  const after = seamError(tile.rgb, tile.w, tile.h);
  assert.ok(after.x < 1.25 && after.y < 1.25, `the edges still show: ${JSON.stringify(after)}`);
});

test('past the band that is remade, the picture is left exactly as it was', () => {
  const w = 100;
  const h = 100;
  const raw = drifting(w, h, 11);
  const tile = seamless(raw, w, h, { band: 0.2 });
  for (let y = 20; y < tile.h; y++)
    for (let x = 20; x < tile.w; x++)
      for (let c = 0; c < 3; c++) assert.equal(tile.rgb[(y * tile.w + x) * 3 + c], raw[(y * w + x) * 3 + c]);
});

test('nothing in the picture is used twice: one mark in it is one mark in the tile', () => {
  // The first way this was done blended the picture with itself moved on by half its size. That meets at the
  // edges too — and puts the middle of the picture at every edge as well, so that each stain and crack in it
  // comes round twice as often when the tile is laid. Seen in the first tiles made, 13 November 2026.
  const w = 100;
  const h = 100;
  const raw = new Float32Array(w * h * 3).fill(0.4);
  for (let y = 45; y < 55; y++)
    for (let x = 45; x < 55; x++) for (let c = 0; c < 3; c++) raw[(y * w + x) * 3 + c] = 0.9;
  const tile = seamless(raw, w, h, { band: 0.2 });
  let bright = 0;
  let nearEdge = 0;
  for (let y = 0; y < tile.h; y++)
    for (let x = 0; x < tile.w; x++)
      if (tile.rgb[(y * tile.w + x) * 3] > 0.6) {
        bright++;
        if (x < 20 || y < 20 || x >= tile.w - 5 || y >= tile.h - 5) nearEdge++;
      }
  assert.equal(bright, 100, 'the mark is not the size it was');
  assert.equal(nearEdge, 0, 'the mark has come up again at the edge');
});

test('the remade band is as busy as the rest: blending two pieces does not wash it out', () => {
  const w = 160;
  const h = 160;
  const r = rng(3);
  const noise = new Float32Array(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = 0.5 + (r() - 0.5) * 0.4;
  const tile = seamless(noise, w, h, { band: 0.2 });
  const middle = spread(tile.rgb, tile.w, tile.h, 60, 100);
  const band = spread(tile.rgb, tile.w, tile.h, 6, 26);
  assert.ok(band > middle * 0.85 && band < middle * 1.15, `band ${band.toFixed(4)}, middle ${middle.toFixed(4)}`);
});

test('a wall that tiles from side to side only keeps its height, and what it has from top to bottom', () => {
  const w = 80;
  const h = 64;
  const r = rng(5);
  const wall = new Float32Array(w * h * 3);
  // a dark band along the bottom quarter, light above it
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++)
        wall[(y * w + x) * 3 + c] = (y >= 48 ? 0.2 : 0.7) + (r() - 0.5) * 0.06 + 0.1 * (x / w);
  const tile = seamless(flatten(wall, w, h, { axes: 'x' }), w, h, { y: false, band: 0.2 });
  assert.deepEqual([tile.w, tile.h], [64, 64]);
  const rowMean = (rgb, width, y) => {
    let sum = 0;
    for (let x = 0; x < width; x++) sum += rgb[(y * width + x) * 3];
    return sum / width;
  };
  assert.ok(
    Math.abs(rowMean(tile.rgb, tile.w, 60) - rowMean(wall, w, 60)) < 0.02,
    'the dark band is no longer as dark',
  );
  assert.ok(
    Math.abs(rowMean(tile.rgb, tile.w, 10) - rowMean(wall, w, 10)) < 0.02,
    'the light part is no longer as light',
  );
  const edges = seamError(tile.rgb, tile.w, tile.h);
  assert.ok(edges.x < 1.3, `it does not tile from side to side: ${edges.x.toFixed(2)}`);
});

test('grading brings a picture to the brightness asked for, and as far towards the colour as it is told to', () => {
  const raw = drifting(32, 32, 21);
  const target = [0.3, 0.26, 0.22];
  const luma = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const kept = stats(grade(raw, { target, tint: 0 })).mean;
  assert.ok(Math.abs(luma(kept) - luma(target)) < 0.005, `brightness ${luma(kept)} for ${luma(target)}`);
  // with no tint asked for, grey noise stays grey
  assert.ok(Math.abs(kept[0] - kept[2]) < 0.01);
  const tinted = stats(grade(raw, { target, tint: 1 })).mean;
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(tinted[c] - target[c]) < 0.01, `channel ${c}: ${tinted[c]}`);
  // nothing leaves the range a picture can hold
  for (const v of grade(raw, { target: [0.95, 0.95, 0.95], tint: 1 })) assert.ok(v >= 0 && v <= 1);
});

test('muting takes out as much of a picture’s own colour as it is told to, and none of its light and dark', () => {
  // rust: orange in one half, blue-grey in the other. As the picture of a MATERIAL it multiplies a part's own
  // paint — whatever colour it has of its own would tint that paint
  const rusty = new Float32Array(2 * 3);
  rusty.set([0.7, 0.4, 0.2], 0);
  rusty.set([0.3, 0.35, 0.5], 3);
  const luma = (rgb, i) => rgb[i] * 0.3 + rgb[i + 1] * 0.59 + rgb[i + 2] * 0.11;
  const chroma = (rgb, i) => Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) - Math.min(rgb[i], rgb[i + 1], rgb[i + 2]);
  const half = mute(rusty, 0.5);
  const none = mute(rusty, 0);
  for (const i of [0, 3]) {
    assert.ok(Math.abs(luma(half, i) - luma(rusty, i)) < 1e-6, 'its brightness changed');
    assert.ok(Math.abs(chroma(half, i) - chroma(rusty, i) * 0.5) < 1e-6, 'half of its colour is not half');
    assert.ok(chroma(none, i) < 1e-6, 'told to keep none, it kept some');
  }
  assert.deepEqual([...mute(rusty, 1)], [...rusty]);
  assert.notEqual(mute(rusty, 1), rusty, 'the picture given was handed back, not a new one');
});

test('the same picture in gives the same tile out, and the picture given is not changed', () => {
  const w = 60;
  const h = 60;
  const raw = drifting(w, h, 9);
  const copy = Float32Array.from(raw);
  const a = seamless(flatten(raw, w, h), w, h);
  const b = seamless(flatten(raw, w, h), w, h);
  assert.deepEqual(a, b);
  assert.deepEqual(raw, copy);
});
