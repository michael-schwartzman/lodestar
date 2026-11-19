// WARDEN speaks (src/wild/warden.js): which line, when, and when it holds its tongue — with no browser in it.
// The wild branch's experiment: docs/WILD.md, "WARDEN speaks".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINES, WARDEN, createWarden, speak } from '../../src/wild/warden.js';

test('it has something to say about each thing that happens, in its own order, and never the same thing twice', () => {
  const w = createWarden();
  const said = [];
  for (let n = 0; n < LINES.turned.length + 2; n++) said.push(speak(w, 'turned', n * 100));
  assert.deepEqual(said.slice(0, LINES.turned.length), LINES.turned);
  // when it has said all it has to say about a thing, it says nothing
  assert.deepEqual(said.slice(LINES.turned.length), [null, null]);
  // a thing it knows nothing about is passed over in silence
  assert.equal(speak(w, 'a thing nobody wrote a line for', 1e6), null);
});

test('it does not chatter: a second thing within six seconds of the first goes unsaid — and is not saved up', () => {
  const w = createWarden();
  assert.equal(speak(w, 'alarm', 10), LINES.alarm[0]);
  assert.equal(speak(w, 'turned', 10 + WARDEN.gap - 0.1), null);
  // the line that went unsaid is still there for the next time the thing happens
  assert.equal(speak(w, 'turned', 10 + WARDEN.gap + 0.1), LINES.turned[0]);
});

test('…except what must be heard: the end of the overspeed is said whatever was said a moment before', () => {
  const w = createWarden();
  speak(w, 'overspeed-2', 50);
  assert.equal(speak(w, 'overspeed-3', 51), LINES['overspeed-3'][0]);
  assert.equal(speak(w, 'overspeed-done', 52), LINES['overspeed-done'][0]);
  for (const event of WARDEN.always) assert.ok(LINES[event], `${event} has no line`);
});

test('a new mission is a new WARDEN: it says its first lines again', () => {
  const w = createWarden();
  speak(w, 'alarm', 0);
  assert.equal(speak(createWarden(), 'alarm', 0), LINES.alarm[0]);
});

test('every line is short enough to be read while playing, is a sentence, and shouts nothing', () => {
  const events = Object.keys(LINES);
  assert.ok(events.length >= 20, `${events.length} things it speaks of`);
  let lines = 0;
  for (const event of events)
    for (const line of LINES[event]) {
      lines++;
      assert.ok(line.length >= 4 && line.length <= 92, `"${line}" is ${line.length} letters`);
      assert.match(line, /[.?]$/, `"${line}" does not end`);
      assert.notEqual(line, line.toUpperCase(), `"${line}" is shouted`);
      assert.doesNotMatch(line, /\bplant/i);
    }
  assert.ok(lines >= 28, `${lines} lines`);
});
