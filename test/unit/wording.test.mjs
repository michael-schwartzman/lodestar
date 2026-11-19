// What the place is called.
//
// Decision of 12 November 2026 — the owner: "i don't [want] it to be a plant but rather uranium enrichment
// facility". The word is gone from the game: from what the player reads, and from the source that says it, so
// that it cannot drift back in through a comment that somebody later copies onto the screen. (`plantCharge` and
// `chargesPlanted` are about setting a charge, not about the place, and are not the word on its own.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.(js|css|html)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('the site is a uranium enrichment facility: the word "plant" is nowhere in the game', () => {
  const found = [];
  for (const file of [...sources(join(ROOT, 'src')), join(ROOT, 'index.html')])
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, n) => {
        if (/\bplants?\b/i.test(line)) found.push(`${relative(ROOT, file)}:${n + 1}: ${line.trim()}`);
      });
  assert.deepEqual(found, []);
});

test('the briefing says what it is, where it is, and what is to be done to it', () => {
  const menus = readFileSync(join(ROOT, 'src/ui/menus.js'), 'utf8').replace(/'\s*\+\s*'/g, '');
  assert.match(menus, /It is a uranium enrichment facility cut into the root of a mountain/);
  assert.match(menus, /its cascade hall under at least fifty metres of rock/);
  assert.match(menus, /Set a charge on each of the four centrifuge cascades, then blow them from the control room\./);
});
