// The site speaks aloud (src/wild/voice.js): when the public address says which of its lines — and that every
// line anything says has a clip, made from the words the line has NOW. No browser: the rules are plain
// arithmetic, and the clips are files.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ADDRESS, SPOKEN, VOICE, announce, createAddress, due } from '../../src/wild/voice.js';
import { LINES, WARDEN } from '../../src/wild/warden.js';

const DIR = fileURLToPath(new URL('../../src/wild/voice/', import.meta.url));
const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** every line each speaker has: { speaker: { id: words } } */
const SAID = {
  warden: Object.fromEntries(
    Object.entries(LINES).flatMap(([event, lines]) => lines.map((line, n) => [`${event}-${n}`, line])),
  ),
  ...SPOKEN,
};

test('the address says its line a while after the thing: the alarm’s blare and the radio come first', () => {
  const a = createAddress();
  announce(a, 'alarm', 100);
  assert.deepEqual(due(a, 100), []);
  assert.deepEqual(due(a, 100 + ADDRESS.alarm.after - 0.01), []);
  assert.deepEqual(due(a, 100 + ADDRESS.alarm.after), ['alarm-0']);
  // …and once: it is not said again
  assert.deepEqual(due(a, 200), []);
});

test('its lines of one thing are said by turns', () => {
  const a = createAddress();
  const heard = [];
  for (let i = 0; i < 4; i++) {
    announce(a, 'alarm', i * 60);
    heard.push(...due(a, i * 60 + 30));
  }
  assert.deepEqual(heard, ['alarm-0', 'alarm-1', 'alarm-0', 'alarm-1']);
});

test('what has gone stale is not said: an alarm called off before it was read out, an alert once the hall is gone', () => {
  const a = createAddress();
  announce(a, 'alarm', 10);
  announce(a, 'clear', 11);
  assert.deepEqual(due(a, 60), ['clear-0']);
  // the alarm, and at once the blast: only the blast is spoken of
  announce(a, 'alarm', 100);
  announce(a, 'overspeed', 100.5);
  announce(a, 'blast', 101);
  assert.deepEqual(due(a, 160), ['blast-0']);
  // the same thing twice before it is read out is read out once
  announce(a, 'alarm', 200);
  announce(a, 'alarm', 201);
  assert.equal(due(a, 260).length, 1);
  // a thing it has no line for is nothing
  announce(a, 'nothing', 300);
  assert.deepEqual(due(a, 400), []);
});

test('every line the address can come to say is a line it has', () => {
  for (const [event, rule] of Object.entries(ADDRESS)) {
    assert.ok(rule.after >= 1, `${event} is said ${rule.after} s after`);
    for (const id of rule.lines) assert.ok(SPOKEN.pa[id], `${event}: ${id}`);
    for (const other of rule.drops) assert.ok(ADDRESS[other], `${event} drops ${other}`);
  }
  // …and it has no line that nothing brings it to say
  const used = new Set(Object.values(ADDRESS).flatMap((rule) => rule.lines));
  assert.deepEqual(Object.keys(SPOKEN.pa).sort(), [...used].sort());
});

test('every line has a clip, made from the words the line has now — and a model that listened heard those words', () => {
  for (const [who, lines] of Object.entries(SAID)) {
    const made = JSON.parse(readFileSync(`${DIR}${who}/lines.json`, 'utf8'));
    for (const [id, text] of Object.entries(lines)) {
      const file = `${DIR}${who}/${id}.mp3`;
      assert.ok(existsSync(file), `${who}/${id} has no clip: node tools/sound/voice.mjs --key-file <env file>`);
      // (a line that is reworded fails here until its clip is made again)
      assert.equal(made[id]?.text, text, `${who}/${id} was made from other words`);
      assert.equal(words(made[id].heard), words(text), `${who}/${id}: what was heard in it`);
      assert.equal(made[id].said, true);
      assert.equal(made[id].bytes, statSync(file).size, `${who}/${id} is not the file that was listened to`);
    }
    // …and there is no clip of a line nothing says
    const clips = readdirSync(`${DIR}${who}`)
      .filter((name) => name.endsWith('.mp3'))
      .map((name) => name.slice(0, -4));
    assert.deepEqual(clips.sort(), Object.keys(lines).sort(), who);
    assert.deepEqual(Object.keys(made).sort(), Object.keys(lines).sort(), who);
  }
});

test('a line is short enough to be said before the next can be, and the clips together are light to fetch', () => {
  let bytes = 0;
  for (const who of Object.keys(SAID)) {
    const made = JSON.parse(readFileSync(`${DIR}${who}/lines.json`, 'utf8'));
    for (const [id, clip] of Object.entries(made)) {
      bytes += clip.bytes;
      assert.ok(clip.seconds > 0.5, `${who}/${id} is ${clip.seconds} s`);
      // WARDEN says nothing for six seconds after it has spoken (WARDEN.gap): a line is over by then
      assert.ok(clip.seconds <= (who === 'warden' ? WARDEN.gap + 0.5 : 8), `${who}/${id} is ${clip.seconds} s`);
    }
  }
  assert.ok(bytes < 1_200_000, `${bytes} bytes of voice`);
  assert.ok(VOICE.level.pa < VOICE.level.warden && VOICE.send.pa > VOICE.send.warden);
});
