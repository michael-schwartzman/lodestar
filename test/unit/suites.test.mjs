// Contract lock: `npm test` runs every suite there is.
//
// Until 15 November 2026 one pattern ran everything under test/. The second look's suite (test/second) keeps three
// copies of the game drawing at once for as long as it runs; run beside the others it starved them of frames, and
// two tests that read the screen a moment after an action failed for no fault of the game's. It now runs after
// the rest, alone — which means the patterns name folders, and a pattern that names folders can miss a new one.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const scripts = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')).scripts;

const found = [];
(function walk(folder) {
  for (const entry of readdirSync(`${ROOT}${folder}`, { withFileTypes: true }))
    if (entry.isDirectory()) walk(`${folder}/${entry.name}`);
    else if (entry.name.endsWith('.test.mjs')) found.push(`${folder}/${entry.name}`);
})('test');

test('every test file is in a folder that npm test runs', () => {
  // (16 November 2026: the wild branch's experiment has a suite of its own, test/wild, run by `test:wild` — which
  // is how this test said it was missing, the day it was added)
  const run = `${scripts.test} ${scripts['test:second']} ${scripts['test:wild']}`;
  const folders = [...run.matchAll(/"(test(?:\/[a-z]+)?)\/\*\.test\.mjs"/g)].map((m) => m[1]);
  assert.ok(folders.length >= 3, `npm test names ${folders.join(', ')}`);
  for (const file of found)
    assert.ok(folders.includes(file.slice(0, file.lastIndexOf('/'))), `${file} is in a folder npm test does not run`);
  for (const name of ['test:second', 'test:wild'])
    assert.ok(
      scripts.test.split('&&').some((part) => part.trim() === `npm run ${name}`),
      `npm test does not run ${name}`,
    );
});

test('the experiment’s suite runs by itself as well: after the first suites, and before the second look’s', () => {
  const parts = scripts.test.split('&&').map((part) => part.trim());
  assert.equal(parts.indexOf('npm run test:wild'), parts.length - 2);
  assert.ok(!scripts.test.includes('test/wild'), 'it is also run beside the others');
  assert.ok(
    found.some((file) => file.startsWith('test/wild/')),
    'there is no suite of the experiment',
  );
});

test('the experiment’s suite draws no more than four games at once', () => {
  // Decision of 16 November 2026. Each file of test/wild keeps a game drawing in a browser of its own. When there
  // were six of them node ran them all at once and that was well; the day there were eleven, on a machine of ten
  // cores, one browser died under the others and the file that owned it waited for ever for an answer (the run
  // was stopped by hand after six minutes; that file alone takes twenty-two seconds). Four at a time.
  const files = found.filter((file) => file.startsWith('test/wild/')).length;
  const at = /--test-concurrency=(\d+)/.exec(scripts['test:wild']);
  assert.ok(files > 4, `there are only ${files} files: this lock has nothing to hold`);
  assert.ok(at && +at[1] >= 2 && +at[1] <= 4, `test:wild is "${scripts['test:wild']}"`);
});

test('the second look’s suite runs after the others have finished, not beside them', () => {
  const [first, ...rest] = scripts.test
    .split('&&')
    .map((part) => part.trim())
    .reverse();
  assert.equal(first, 'npm run test:second', 'it is not the last thing npm test does');
  assert.ok(!rest.join(' ').includes('test/second'), 'it is also run beside the others');
  assert.ok(
    found.some((file) => file.startsWith('test/second/')),
    'there is no second-look suite',
  );
});
