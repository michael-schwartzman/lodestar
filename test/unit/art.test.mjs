// Contract lock: the pictures the game ships (src/assets/art) and what they were made from.
// Decision of 12 November 2026 — the owner: "have you use nano banana to generate high quality assests for me".
// A picture is in the game only if tools/art/manifest.json says what it is, its source is kept beside the code,
// and all three sizes of it are there and small enough to be fetched by a phone. No browser needed.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MATTER_SIZES, SETS, SIZES, jobFor } from '../../tools/art/process.mjs';
import { promptFor } from '../../tools/art/generate.mjs';
import { BORROWED, MATTER, MATTER_NAMES } from '../../src/gfx/matter.js';
import { TEXTURE_NAMES } from '../../src/gfx/textures.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${ROOT}tools/art/manifest.json`, 'utf8'));
const size = (path) => statSync(`${ROOT}${path}`).size;

/** the most one picture may weigh, in bytes, at each size */
const CEILING = { 1024: 460_000, 512: 130_000, 256: 45_000 };
/** and the most all of them together may, at the size one detail level fetches */
const TOTAL = { 1024: 2_600_000, 512: 700_000, 256: 220_000 };

test('every picture in the game is in the manifest, with its source kept and all three sizes made', () => {
  const names = manifest.textures.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'a name is in the manifest twice');
  for (const name of names) {
    assert.ok(TEXTURE_NAMES.includes(name), `${name} is not a surface the game has`);
    assert.ok(existsSync(`${ROOT}art/source/${name}.jpg`), `the source of ${name} is not kept`);
    for (const s of SIZES)
      assert.ok(existsSync(`${ROOT}src/assets/art/${name}.${s}.webp`), `${name} at ${s} is missing`);
  }
  // and nothing is shipped that the manifest does not know of
  const shipped = readdirSync(`${ROOT}src/assets/art`).sort();
  const expected = names.flatMap((name) => SIZES.map((s) => `${name}.${s}.webp`)).sort();
  assert.deepEqual(shipped, expected);
});

test('no picture is too heavy to fetch: each under its ceiling, and each size under its total', () => {
  for (const s of SIZES) {
    let total = 0;
    for (const { name } of manifest.textures) {
      const bytes = size(`src/assets/art/${name}.${s}.webp`);
      total += bytes;
      assert.ok(bytes <= CEILING[s], `${name}.${s}.webp is ${bytes} bytes (ceiling ${CEILING[s]})`);
      assert.ok(bytes > 400, `${name}.${s}.webp is empty`);
    }
    assert.ok(total <= TOTAL[s], `the ${s}-pixel pictures weigh ${total} bytes together (ceiling ${TOTAL[s]})`);
  }
});

test('every entry says what it is a picture of, what kind of thing it is, and what colour it is graded to', () => {
  for (const entry of manifest.textures) {
    assert.ok(['tile', 'tileX', 'overlay', 'image'].includes(entry.kind), `${entry.name}: kind ${entry.kind}`);
    assert.ok(entry.prompt.length > 60, `${entry.name} has no description to speak of`);
    assert.ok(manifest.styles[entry.kind], `no style for ${entry.kind}`);
    assert.ok(promptFor(entry, manifest).startsWith(entry.prompt.trim()));
    assert.ok(Array.isArray(entry.target) && entry.target.length === 3, `${entry.name} has no target colour`);
    for (const v of entry.target) assert.ok(v > 0.1 && v < 0.9, `${entry.name}: target ${entry.target}`);
    const job = jobFor(entry);
    assert.deepEqual(
      job.sizes.map(([name]) => Number(name)),
      SIZES,
    );
    // a tile is made to meet itself; a wall only along its length; one picture of a door not at all
    assert.equal(!!job.seamless, entry.kind !== 'image');
    if (entry.kind === 'tileX')
      assert.deepEqual([job.seamless.x, job.seamless.y, job.flatten.axes], [true, false, 'x']);
    if (entry.kind === 'tile' || entry.kind === 'overlay')
      assert.deepEqual([job.seamless.x, job.seamless.y], [true, true]);
    assert.equal(job.grey, entry.kind === 'overlay');
  }
});

// The second look (decision of 15 November 2026 — the owner, to the plan for it: "go ahead"): the materials
// things are made of have pictures too. They are fetched only when the second look is asked for.
/**
 * the most one material picture may weigh, in bytes, at each size — and all of them together.
 * Decision of 16 November 2026: the totals were 760 000 and 240 000 for nine pictures. The plan the owner agreed
 * to on the 15th gave the cost of its second step as "roughly 1 MB more on a desk, 0.4 MB more on a phone", and on
 * the 16th he said to go on with it: fourteen pictures now. No single picture may weigh more than before.
 */
const MATTER_CEILING = { 512: 120_000, 256: 40_000 };
const MATTER_TOTAL = { 512: 1_150_000, 256: 360_000 };
/** concrete and rock are pictures the level's surfaces have already; glass has none */
const OWN_MATTER = MATTER_NAMES.filter((name) => MATTER[name].picture && !BORROWED[name]);

test('every material with a picture of its own is in the manifest, its source kept, both sizes made and light', () => {
  const names = manifest.matter.map((t) => t.name);
  assert.deepEqual(names.slice().sort(), OWN_MATTER.slice().sort());
  assert.deepEqual(SETS.matter, { out: 'src/assets/matter', sizes: MATTER_SIZES, chroma: 0.5 });
  for (const s of MATTER_SIZES) {
    let total = 0;
    for (const name of names) {
      assert.ok(existsSync(`${ROOT}art/source/${name}.jpg`), `the source of ${name} is not kept`);
      const file = `src/assets/matter/${name}.${s}.webp`;
      assert.ok(existsSync(`${ROOT}${file}`), `${file} is missing`);
      const bytes = size(file);
      total += bytes;
      assert.ok(bytes > 400 && bytes <= MATTER_CEILING[s], `${file} is ${bytes} bytes (ceiling ${MATTER_CEILING[s]})`);
    }
    assert.ok(total <= MATTER_TOTAL[s], `the ${s}-pixel materials weigh ${total} bytes (ceiling ${MATTER_TOTAL[s]})`);
  }
  const shipped = readdirSync(`${ROOT}src/assets/matter`).sort();
  assert.deepEqual(shipped, names.flatMap((name) => MATTER_SIZES.map((s) => `${name}.${s}.webp`)).sort());
});

test('a material picture is a tile that meets itself both ways, as wide as the catalogue says, graded to grey', () => {
  for (const entry of manifest.matter) {
    assert.equal(entry.kind, 'tile', `${entry.name}: kind ${entry.kind}`);
    assert.ok(entry.prompt.length > 60, `${entry.name} has no description to speak of`);
    assert.ok(promptFor(entry, manifest).startsWith(entry.prompt.trim()));
    // the shader multiplies a part's own paint by the picture: a picture with a colour of its own would tint it
    assert.deepEqual(entry.target, [0.5, 0.5, 0.5], `${entry.name} is not graded to a neutral grey`);
    assert.ok(entry.tint >= 0.8, `${entry.name}: tint ${entry.tint} leaves it too much of its own colour`);
    assert.equal(entry.metres, MATTER[entry.name].metres, `${entry.name}: the catalogue and the manifest differ`);
    const job = jobFor(entry, SETS.matter);
    assert.deepEqual(
      job.sizes.map(([name]) => Number(name)),
      MATTER_SIZES,
    );
    assert.deepEqual([job.seamless.x, job.seamless.y, job.grey], [true, true, false]);
    // …and whatever colour is left in it after that is at most half of what it had: the paint is the part's own
    assert.ok(job.chroma > 0 && job.chroma <= 0.5, `${entry.name} keeps ${job.chroma} of its own colour`);
  }
  // a surface's picture, on the other hand, IS its colour: none of it is taken out
  for (const entry of manifest.textures) assert.equal(jobFor(entry).chroma, 1, entry.name);
});

test('nothing about the key that makes the pictures is in the repository', () => {
  // the tool reads it from the environment or from a file outside the repository, and never writes it anywhere
  const files = ['tools/art/generate.mjs', 'tools/art/process.mjs', 'tools/art/manifest.json', 'tools/art/bench.html'];
  for (const file of files) {
    const text = readFileSync(`${ROOT}${file}`, 'utf8');
    assert.doesNotMatch(text, /AIza[0-9A-Za-z_-]{20,}/, `${file} has something that looks like a key in it`);
    assert.doesNotMatch(text, /[?&]key=/, `${file} puts a key in an address`);
  }
  assert.match(readFileSync(`${ROOT}.gitignore`, 'utf8'), /^art\/candidates\/$/m);
});
