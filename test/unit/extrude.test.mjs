// Contract lock: an outline pushed out into a solid (src/gfx/next/extrude.js) — and that the second look's
// models do not reach for the class of three's it stands in for.
//
// 16 November 2026. three is in the script every player downloads; what a model of the second look uses of it
// is added there, not to the look's own file. The sentry's second pass used THREE.ExtrudeGeometry, which brings
// three's shapes, curves and triangulator with it, and the script went from 858.4 kB to 886.7 — over the 870 it
// is held under (test/second/look.test.mjs), for the sake of models only `look=2` draws. The lock that caught
// it is that one, in a browser, against the built game; this file says why, earlier and without a build.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Outline, extrude, triangulate } from '../../src/gfx/next/extrude.js';

const trianglesOf = (geometry) => {
  const p = geometry.attributes.position.array;
  const out = [];
  for (let i = 0; i < p.length; i += 9)
    out.push([
      [p[i], p[i + 1], p[i + 2]],
      [p[i + 3], p[i + 4], p[i + 5]],
      [p[i + 6], p[i + 7], p[i + 8]],
    ]);
  return out;
};
/** the volume a closed surface holds, if its faces all look outwards: negative if they look in */
const volumeOf = (geometry) =>
  trianglesOf(geometry).reduce(
    (sum, [a, b, c]) =>
      sum +
      (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6,
    0,
  );
const boundsOf = (geometry) => {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  return [min.x, min.y, min.z, max.x, max.y, max.z].map((v) => +v.toFixed(6));
};
/** every edge of a closed surface is the side of exactly two triangles, once each way */
const open = (geometry) => {
  const key = (p) => p.map((v) => v.toFixed(6)).join(',');
  const edges = new Map();
  for (const [a, b, c] of trianglesOf(geometry))
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const there = `${key(from)}>${key(to)}`;
      const back = `${key(to)}>${key(from)}`;
      if (edges.get(back) > 0) edges.set(back, edges.get(back) - 1);
      else edges.set(there, (edges.get(there) || 0) + 1);
    }
  return [...edges.values()].reduce((sum, n) => sum + n, 0);
};
const SQUARE = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

test('a square pushed out is a box: twelve triangles, closed, its faces outwards, as deep as asked', () => {
  const box = extrude(SQUARE, { depth: 1, bevelEnabled: false });
  assert.equal(trianglesOf(box).length, 12);
  assert.deepEqual(boundsOf(box), [-1, -1, 0, 1, 1, 1]);
  assert.ok(Math.abs(volumeOf(box) - 4) < 1e-9, `it holds ${volumeOf(box)}`);
  assert.equal(open(box), 0, 'it has an open edge');
  // the same solid whichever way round the outline was given
  const turned = extrude([...SQUARE].reverse(), { depth: 1, bevelEnabled: false });
  assert.ok(Math.abs(volumeOf(turned) - 4) < 1e-9, `given clockwise it holds ${volumeOf(turned)}`);
  // every corner has a normal one long
  const n = box.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) assert.ok(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1) < 1e-6);
});

test('with its edges taken off: the caps are the outline, beyond the walls’ ends; the walls stand out from it', () => {
  const solid = extrude(SQUARE, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  // as three's own: z from −bevelThickness to depth + bevelThickness, x and y out by bevelSize
  assert.deepEqual(boundsOf(solid), [-1.05, -1.05, -0.1, 1.05, 1.05, 1.1]);
  assert.equal(open(solid), 0, 'it has an open edge');
  const volume = volumeOf(solid);
  assert.ok(volume > 4 && volume < 2.1 * 2.1 * 1.2, `it holds ${volume}`);
  // the two caps are the square itself (positions are kept as single-precision numbers: a millionth is exact enough)
  const caps = trianglesOf(solid).filter((t) =>
    t.every((p) => Math.abs(p[2] - -0.1) < 1e-6 || Math.abs(p[2] - 1.1) < 1e-6),
  );
  for (const t of caps)
    for (const p of t) assert.ok(Math.abs(Math.abs(p[0]) - 1) < 1e-6 && Math.abs(Math.abs(p[1]) - 1) < 1e-6);
  assert.equal(caps.length, 4);
  // no bevel asked for by size or thickness is no bevel
  assert.equal(
    trianglesOf(extrude(SQUARE, { depth: 1, bevelEnabled: true, bevelThickness: 0, bevelSize: 0 })).length,
    12,
  );
});

test('an outline with a corner cut into it is filled, and nothing outside it: an L of three squares', () => {
  const L = [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 2],
    [0, 2],
  ];
  const triangles = triangulate(L);
  assert.equal(triangles.length, 4);
  let area = 0;
  for (const [a, b, c] of triangles) {
    const twice = (L[b][0] - L[a][0]) * (L[c][1] - L[a][1]) - (L[b][1] - L[a][1]) * (L[c][0] - L[a][0]);
    assert.ok(twice > 0, 'a triangle is turned the wrong way');
    area += twice / 2;
    // none of it lies in the corner that was cut out
    const mid = [(L[a][0] + L[b][0] + L[c][0]) / 3, (L[a][1] + L[b][1] + L[c][1]) / 3];
    assert.ok(!(mid[0] > 1 && mid[1] > 1), `a triangle's middle is at ${mid}`);
  }
  assert.ok(Math.abs(area - 3) < 1e-9, `it covers ${area}`);
  const solid = extrude(L, { depth: 0.5, bevelEnabled: false });
  assert.ok(Math.abs(volumeOf(solid) - 1.5) < 1e-9);
  assert.equal(open(solid), 0);
});

test('an outline is drawn as three’s Shape is: lines, and curves cut into as many pieces as asked', () => {
  const outline = new Outline();
  outline.moveTo(-1, 0).lineTo(1, 0).quadraticCurveTo(1, 1, 0, 1).quadraticCurveTo(-1, 1, -1, 0);
  const points = outline.points(8);
  // two corners and two curves of eight pieces; the last point is the first again, and is not given twice
  assert.equal(points.length, 2 + 8 + 8 - 1);
  assert.deepEqual(points[0], [-1, 0]);
  // half way along the first curve: a quarter of each end and a half of what it is pulled towards
  assert.deepEqual(
    points[1 + 4].map((v) => +v.toFixed(6)),
    [0.25 * 1 + 0.5 * 1 + 0.25 * 0, 0.25 * 0 + 0.5 * 1 + 0.25 * 1],
  );
  const solid = extrude(outline, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 8,
  });
  assert.equal(open(solid), 0);
  assert.ok(volumeOf(solid) > 0);
  assert.equal(trianglesOf(extrude(new Outline(), {})).length, 0, 'an outline of nothing is a solid of nothing');
});

test('nothing of the second look reaches for three’s shapes and curves: they would land in the script every player downloads', () => {
  const FORBIDDEN =
    /THREE\.(ExtrudeGeometry|ShapeGeometry|TubeGeometry|Shape|ShapePath|Path|CurvePath|[A-Za-z]+Curve3?)\b/;
  const found = [];
  for (const dir of ['../../src/gfx/next/', '../../src/look/']) {
    const path = fileURLToPath(new URL(dir, import.meta.url));
    for (const name of readdirSync(path).filter((n) => n.endsWith('.js')))
      readFileSync(`${path}${name}`, 'utf8')
        .split('\n')
        .forEach((line, n) => {
          const code = line.trim();
          // what a comment says about the class is not a use of it
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
          if (FORBIDDEN.test(code)) found.push(`${name}:${n + 1}: ${code.slice(0, 90)}`);
        });
  }
  assert.deepEqual(found, []);
});
