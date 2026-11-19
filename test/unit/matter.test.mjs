// Contract lock: what things are made of in the second look, and the light that throws real shadows.
//
// Decision of 15 November 2026 — the owner, to the plan in which every object gets a material ("a colour picture,
// a bump map and a map of how shiny each point is") and each space one strong light: "go ahead". Until then a part
// of a model had a colour, a roughness and a metalness and nothing else.
//
// The names below are what a model builder writes on a part (`paint(g, colour, { mat: 'rubber' })`), and the order
// is the order of the layers in the picture array the shader reads: changing either re-skins every model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { MATTER, MATTER_MID, MATTER_NAMES, NO_MATTER, layerOf, matterOf, toNeutral } from '../../src/gfx/matter.js';
import { GUESSED, box, cyl, guessedShare, merge, paint, setGeoDetail } from '../../src/gfx/geo.js';
import { lit, setLook } from '../../src/gfx/materials.js';
import { buildProp } from '../../src/gfx/propModels.js';
import { LOOK_GLSL } from '../../src/look/glsl.js';
import { keyReach, shadowTaps } from '../../src/look/key.js';

const NAMES = [
  'paint',
  'steel',
  'galv',
  'rust',
  'gunmetal',
  'polymer',
  'rubber',
  'fabric',
  'wood',
  'concrete',
  'glass',
  // 16 November 2026 — the owner, having looked at the one view: "continue the implementation plan". Its second
  // step is "a catalogue of about sixteen materials". These six are added AFTER the eleven that were there, so
  // that no layer a model already names changes its number.
  'aluminium',
  'brass',
  'enamel',
  'chequer',
  'canvas',
  'rock',
];
/** the materials a geometry is made of: the whole number of each `mat` (the half is the mark of an edge) */
const layersOf = (geometry) => Array.from(new Set(Array.from(geometry.attributes.mat.array, Math.floor)));
/** the second look on (what `look=2` does to how models are built), or off */
const second = (on) => setGeoDetail({ bevel: true, round: 1.5, matter: on });

test('without the switch a model is what it always was: four attributes, and none says what it is made of', () => {
  second(false);
  const painted = paint(new THREE.BoxGeometry(1, 1, 1), 0x202022, { rough: 0.85, metal: 0, mat: 'fabric' });
  assert.equal(painted.attributes.mat, undefined);
  const whole = merge([box(1, 1, 1, 0x3a5f2a, [0, 0, 0]), cyl(0.2, 0.2, 1, 0x101010, [0, 0, 0])]);
  assert.deepEqual(Object.keys(whole.attributes).sort(), ['color', 'normal', 'position', 'surf']);
  // a wrong name is still a mistake in the model, whichever look is on
  assert.throws(() => paint(new THREE.BoxGeometry(1, 1, 1), 0x808080, { mat: 'chrome' }), /chrome/);
});

test('the catalogue: seventeen materials, in the order of their layers', () => {
  assert.equal(NAMES.length, 17);
  assert.deepEqual(MATTER_NAMES, NAMES);
  NAMES.forEach((name, layer) => {
    const m = MATTER[name];
    assert.equal(m.layer, layer, `${name} is not layer ${layer}`);
    assert.ok(m.metres > 0.02 && m.metres <= 4, `${name}: a picture ${m.metres} m across`);
    assert.ok(m.bump >= 0 && m.bump <= 2, `${name}: bump ${m.bump}`);
    assert.ok(m.vary >= 0 && m.vary <= 1, `${name}: roughness varies by ${m.vary}`);
    assert.ok(m.wear >= 0 && m.wear <= 1, `${name}: edge wear ${m.wear}`);
    assert.equal(typeof m.picture, 'boolean');
  });
  // glass is the one material with no picture: a pane is what is behind it and what it reflects
  assert.deepEqual(
    NAMES.filter((name) => !MATTER[name].picture),
    ['glass'],
  );
  assert.equal(NO_MATTER, -1);
});

test('a name that is not in the catalogue is an error, not a silent coat of paint', () => {
  assert.equal(layerOf('paint'), 0);
  assert.equal(layerOf('glass'), 10);
  assert.equal(layerOf('rock'), 16);
  assert.throws(() => layerOf('ruber'), /ruber/);
  assert.throws(() => paint(new THREE.BoxGeometry(1, 1, 1), 0x808080, { mat: 'chrome' }), /chrome/);
});

test('a part that does not say what it is made of is given a material by rule', () => {
  // (linear r, g, b, rough, metal) → name. Metal first: how dark it is says which metal.
  assert.equal(matterOf(0.02, 0.02, 0.025, 0.5, 0.65), 'gunmetal');
  assert.equal(matterOf(0.09, 0.1, 0.11, 0.4, 0.85), 'steel');
  assert.equal(matterOf(0.55, 0.57, 0.58, 0.45, 0.8), 'galv');
  // not metal: black and rough is rubber; a colour is paint; dark and plain is polymer; pale, rough grey is concrete
  assert.equal(matterOf(0.012, 0.012, 0.014, 0.85, 0), 'rubber');
  assert.equal(matterOf(0.5, 0.2, 0.03, 0.55, 0), 'paint');
  assert.equal(matterOf(0.08, 0.3, 0.12, 0.6, 0), 'paint');
  assert.equal(matterOf(0.03, 0.03, 0.035, 0.72, 0), 'polymer');
  assert.equal(matterOf(0.42, 0.42, 0.4, 0.92, 0), 'concrete');
  // and whatever is left over — a mid grey, neither rough nor metal — is painted
  assert.equal(matterOf(0.2, 0.2, 0.21, 0.6, 0), 'paint');
  for (const name of [matterOf(0, 0, 0, 0, 0), matterOf(1, 1, 1, 1, 1), matterOf(0.3, 0.1, 0.5, 0.5, 0.5)])
    assert.ok(NAMES.includes(name), `the rule gave ${name}`);
});

test('paint() writes the material on every vertex: the one named, or the one the rule gives', () => {
  second(true);
  const named = paint(new THREE.BoxGeometry(1, 1, 1), 0x202022, { rough: 0.85, metal: 0, mat: 'fabric' });
  assert.equal(named.attributes.mat.itemSize, 1);
  assert.equal(named.attributes.mat.count, named.attributes.position.count);
  assert.deepEqual(layersOf(named), [layerOf('fabric')]);

  const ruled = paint(new THREE.BoxGeometry(1, 1, 1), 0x202022, { rough: 0.85, metal: 0 });
  assert.deepEqual(layersOf(ruled), [layerOf('rubber')]);
  // what it always wrote is still written
  for (const key of ['color', 'surf']) assert.equal(ruled.attributes[key].count, ruled.attributes.position.count);
});

test('box(), cyl() and merge() carry it through: each part of a model keeps its own material', () => {
  second(true);
  const tyre = cyl(0.5, 0.5, 0.3, 0x101010, [0, 0.5, 0], undefined, 12, { rough: 0.9, metal: 0, mat: 'rubber' });
  const hub = cyl(0.2, 0.2, 0.32, 0x8a8e92, [0, 0.5, 0], undefined, 12, { rough: 0.4, metal: 0.9, mat: 'steel' });
  const body = box(2, 1, 1, 0x3a5f2a, [0, 1.5, 0], undefined, { rough: 0.6, metal: 0, mat: 'paint' });
  const whole = merge([tyre, hub, body]);
  assert.deepEqual(Object.keys(whole.attributes).sort(), ['color', 'mat', 'normal', 'position', 'surf']);
  assert.equal(whole.attributes.mat.count, whole.attributes.position.count);
  assert.deepEqual(layersOf(whole).sort(), [layerOf('paint'), layerOf('steel'), layerOf('rubber')].sort());
  // every triangle is of one material: its three corners agree (the shader reads the layer off a corner)
  const mat = whole.attributes.mat.array;
  for (let i = 0; i < mat.length; i += 3)
    assert.ok(mat[i] === mat[i + 1] && mat[i] === mat[i + 2], `triangle ${i / 3}`);

  // a part painted by hand, vertex by vertex, has no material: merge() gives it one from its own colour
  const raw = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  raw.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(raw.attributes.position.count * 3).fill(0.6), 3),
  );
  const mixed = merge([raw, tyre]);
  assert.equal(mixed.attributes.mat.count, mixed.attributes.position.count);
  assert.ok(layersOf(mixed).every((layer) => layer >= 0 && layer < NAMES.length));
});

test('the edges of things are marked, from the model itself: the bevels and corners of a box, and nothing round', () => {
  second(true);
  // a box with its edges taken off is 44 triangles: 12 on its six faces, 24 along its twelve edges, 8 at its corners
  const crate = merge([box(1, 1, 1, 0x3a5f2a, [0, 0, 0], undefined, { mat: 'paint' })]);
  const marks = Array.from(crate.attributes.mat.array, (v) => v - Math.floor(v));
  assert.equal(marks.length, 44 * 3);
  assert.equal(marks.filter((m) => m === 0.5).length, 32 * 3, 'the 32 triangles of its edges and corners');
  assert.equal(marks.filter((m) => m === 0).length, 12 * 3, 'the 12 of its faces');
  assert.deepEqual(layersOf(crate), [layerOf('paint')]);
  // the faces of a round thing turn a little from one to the next, never by 70 degrees: it has no edge to wear
  const drum = merge([cyl(0.3, 0.3, 0.9, 0x2a4a7a, [0, 0, 0], undefined, 12, { mat: 'paint' })]);
  assert.ok(Array.from(drum.attributes.mat.array).every((v) => v === layerOf('paint')));
  // joining what has been joined marks nothing twice
  const again = merge([crate, drum]);
  assert.equal(Array.from(again.attributes.mat.array).filter((v) => v - Math.floor(v) === 0.5).length, 32 * 3);
  assert.ok(Array.from(again.attributes.mat.array).every((v) => Math.floor(v) === layerOf('paint')));
  // and with sharp boxes (a phone) there are no bevels, so nothing is marked
  setGeoDetail({ bevel: false, round: 1, matter: true });
  const plain = merge([box(1, 1, 1, 0x3a5f2a, [0, 0, 0], undefined, { mat: 'paint' })]);
  assert.ok(Array.from(plain.attributes.mat.array).every((v) => v === layerOf('paint')));
});

// 16 November 2026, the plan's second step: "a material on everything — by hand". Until now a part that did not
// say what it is made of was given a material by a rule, from its colour, and nothing told the two apart: "100%
// has a material" was true of a site that had been named by nobody. A guess is now marked as one — an eighth
// added to the layer's number, which the shader does not see (it reads the whole number, and the half that
// marks an edge) — so that it can be counted, and the count held down (test/second/look.test.mjs).
test('a part that does not say what it is made of is marked as a guess; one that says is not; and both still wear at their edges', () => {
  second(true);
  const fractions = (g) => Array.from(g.attributes.mat.array, (v) => +(v - Math.floor(v)).toFixed(3));
  const said = merge([box(1, 1, 1, 0x3a5f2a, [0, 0, 0], undefined, { mat: 'paint' })]);
  assert.equal(guessedShare(said), 0);
  assert.deepEqual([...new Set(fractions(said))].sort(), [0, 0.5]);

  const unsaid = merge([box(1, 1, 1, 0x3a5f2a, [0, 0, 0])]);
  assert.equal(guessedShare(unsaid), 1);
  // the same material the rule always gave, the same 32 triangles of edge and 12 of face
  assert.deepEqual(layersOf(unsaid), [layerOf('paint')]);
  assert.equal(fractions(unsaid).filter((f) => f === GUESSED).length, 12 * 3);
  assert.equal(fractions(unsaid).filter((f) => f === 0.5 + GUESSED).length, 32 * 3);
  // joining what has been joined changes nothing
  assert.deepEqual(fractions(merge([unsaid])), fractions(unsaid));

  // half and half: a model with one part that says and one that does not
  const drum = cyl(0.3, 0.3, 0.9, 0x2a4a7a, [0, 0, 0], undefined, 12);
  const lid = cyl(0.3, 0.3, 0.02, 0x2a4a7a, [0, 0.46, 0], undefined, 12, { mat: 'steel' });
  const share = guessedShare(merge([drum, lid]));
  assert.ok(share > 0.4 && share < 0.6, `${share} of a drum with a named lid is guessed`);

  // …and what was painted by hand, corner by corner, with no paint() at all, is a guess too
  const raw = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  raw.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(raw.attributes.position.count * 3).fill(0.6), 3),
  );
  assert.equal(guessedShare(merge([raw])), 1);
  // with the second look off nothing is marked, because nothing is written
  second(false);
  assert.equal(guessedShare(merge([box(1, 1, 1, 0x3a5f2a, [0, 0, 0])])), 0);
});

test('the site’s own furniture says what it is made of: every kind still built the old way, nine parts in ten or more', () => {
  second(true);
  // the kinds no helper has built again (look/index.js `props` has the rest)
  for (const kind of ['wallLight', 'ceilingLight', 'lampPost', 'tower', 'rock', 'ventStack', 'roofUnit', 'dish'])
    for (const variant of [0, 1, 2]) {
      const share = guessedShare(buildProp(kind, variant).solid);
      assert.ok(share <= 0.1, `${kind} ${variant}: ${(share * 100).toFixed(0)}% of it is a guess`);
    }
  second(false);
});

// Found on 15 November 2026 by reading the loader against the shader — not by looking: the pictures taken until
// then all had it in them, and none gave it away. A material's picture multiplies a part's own paint, so on the whole it must multiply it by
// ONE: the picture is brought to a middle grey and the shader divides by that grey. The pictures are stored the
// way pictures are (sRGB), in which middle grey is the number one half — but the shader is handed LIGHT, in which
// that grey is 0.214. It divided by one half: every part was drawn at 43% of its paint from near to, and 80% from
// far off — things grew darker as they were walked up to.
const toLight = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lightOf = (pixels) => {
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += toLight(pixels[i + c] / 255);
  return sum.map((s) => s / (pixels.length / 4));
};

test('a material’s picture is brought to one middle grey, measured as light — whatever colour it came in', () => {
  // the middle grey is the one a picture graded to "one half" has (tools/art, target 0.5): as light, 0.214
  assert.ok(Math.abs(MATTER_MID - toLight(0.5)) < 1e-4, `the middle grey is ${MATTER_MID}`);
  // rust, of all things: orange flakes and blue-black pits, in unequal parts — and a pale, almost white picture
  const rusty = new Uint8ClampedArray(64 * 4);
  for (let i = 0; i < 64; i++) rusty.set(i % 3 ? [182, 96, 44, 255] : [38, 44, 61, 255], i * 4);
  const pale = new Uint8ClampedArray(64 * 4);
  for (let i = 0; i < 64; i++) pale.set(i % 5 ? [226, 224, 219, 255] : [120, 118, 110, 255], i * 4);
  for (const [name, pixels] of [
    ['rust', rusty],
    ['pale paint', pale],
  ]) {
    const before = Array.from(pixels);
    toNeutral(pixels);
    for (const [c, mean] of lightOf(pixels).entries())
      assert.ok(Math.abs(mean - MATTER_MID) < MATTER_MID * 0.02, `${name}, channel ${c}: ${mean.toFixed(4)} as light`);
    // what was lighter is still lighter, and nothing is done to how solid a pixel is
    for (let i = 0; i + 4 < pixels.length; i += 4)
      assert.equal(
        Math.sign(pixels[i] - pixels[i + 4]),
        Math.sign(before[i] - before[i + 4]),
        `${name}, pixel ${i / 4}`,
      );
    for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], before[i]);
    // done again, it changes nothing to speak of: it is where it was put
    const once = Array.from(pixels);
    toNeutral(pixels);
    for (let i = 0; i < pixels.length; i++) assert.ok(Math.abs(pixels[i] - once[i]) <= 1, `${name}: it moved again`);
  }
});

test('the shader divides by that same grey: a picture changes how a part looks, not how light it is on the whole', () => {
  // the line is the second look's own (src/look/glsl.js): a material has it only when the look is switched on
  setLook({ on: true, matter: true, glsl: LOOK_GLSL });
  let shader;
  try {
    shader = lit({ vertexColors: true }).fragmentShader;
  } finally {
    setLook({ on: false, matter: false, glsl: null });
  }
  const factor = /mc\.rgb \* ([0-9.]+)/.exec(shader);
  assert.ok(factor, 'the line that lays a picture on a part is not where it was');
  assert.ok(
    Math.abs(Number(factor[1]) * MATTER_MID - 1) < 1e-3,
    `it multiplies by ${factor[1]}; the grey is ${MATTER_MID}`,
  );
});

test('the key light: full inside its beam, nothing outside it, fading with distance and at the edge', () => {
  // a flood 8 m up, aimed level along +x: beam 40° to the edge, soft from 30°, reaching 40 m
  const key = { x: 0, y: 8, z: 0, tx: 10, ty: 8, tz: 0, inner: 30, outer: 40, range: 40 };
  const on = (x, y, z) => keyReach(key, x, y, z);
  assert.ok(on(10, 8, 0) > 0.8, 'ten metres down the middle of the beam');
  assert.ok(on(10, 8, 0) > on(20, 8, 0) && on(20, 8, 0) > on(35, 8, 0), 'it fades with distance');
  assert.equal(on(41, 8, 0), 0, 'and is gone past its reach');
  assert.equal(on(-5, 8, 0), 0, 'nothing behind it');
  assert.equal(on(10, 8, 10), 0, '45° off the axis is outside a 40° beam');
  // inside the soft edge it is between nothing and what the middle gets at that distance
  const d = 10 / Math.cos((35 * Math.PI) / 180);
  const edge = on(10, 8, 10 * Math.tan((35 * Math.PI) / 180));
  const middle = on(d, 8, 0);
  assert.ok(edge > 0.05 * middle && edge < 0.95 * middle, `at 35°: ${edge} of ${middle}`);
  // no step anywhere along a sweep across the beam: neighbours a tenth of a degree apart differ by little
  let last = on(20, 8, 0);
  for (let a = 0.1; a < 50; a += 0.1) {
    const now = on(20 * Math.cos((a * Math.PI) / 180), 8, 20 * Math.sin((a * Math.PI) / 180));
    assert.ok(Math.abs(now - last) < 0.02, `a step of ${Math.abs(now - last)} at ${a.toFixed(1)}°`);
    last = now;
  }
});

// Found in review, 16 November 2026: a phone whose graphics card could not be asked how it samples a shadow was
// treated as one that had answered well, and given the fewest points. Not knowing is not good news.
test('how many points a shadow’s edge is asked at: sixteen on a desk, four on a phone that is known to blend them, nine otherwise', () => {
  for (const filter of ['blended', 'nearest', 'unknown']) assert.equal(shadowTaps({ phone: false, filter }), 16);
  assert.equal(shadowTaps({ phone: true, filter: 'blended' }), 4);
  assert.equal(shadowTaps({ phone: true, filter: 'nearest' }), 9);
  assert.equal(shadowTaps({ phone: true, filter: 'unknown' }), 9);
  assert.equal(shadowTaps({ phone: true, filter: undefined }), 9);
});
