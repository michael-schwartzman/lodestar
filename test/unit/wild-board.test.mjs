// The board's rules (src/wild/board.js): building the request, and cleaning up whatever comes back from a table
// anyone on the internet can write a row into by hand. No network and no browser in here — src/wild/board-live.js
// does the fetching; this file only says what is safe to send and what is safe to believe.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES } from '../../src/wild/score.js';
import {
  LOCAL_LIMITS,
  WAIT,
  best,
  callsign,
  cleanLocal,
  created,
  createText,
  endpointOf,
  listed,
  listText,
  merge,
  parse,
  rank,
  refused,
  waiting,
} from '../../src/wild/board.js';

const GOOD = Object.freeze({
  id: 'a1',
  name: 'WRAITH',
  score: 4200,
  difficulty: 'operator',
  result: 'won',
  seconds: 410,
  kills: 12,
  alarms: 1,
  device: 'desk',
  mode: 'play',
  rules: RULES,
  at: '2026-11-18T01:30:00.000Z',
});
const items = (list) => ({ data: { scores: { items: list } } });

// ---------- callsign ----------

test('callsign: trims, upper-cases, collapses inner spaces, and asks for 2–16 of A–Z 0–9 space _ -', () => {
  assert.deepEqual(callsign('  echo   foxtrot  '), { ok: true, value: 'ECHO FOXTROT', why: '' });
  assert.deepEqual(callsign('wraith-1'), { ok: true, value: 'WRAITH-1', why: '' });
  assert.equal(callsign('a').ok, false, 'one letter is not a callsign');
  assert.equal(callsign(' '.repeat(5)).ok, false, 'blank is not a callsign');
  assert.equal(callsign('x'.repeat(17)).ok, false, 'seventeen is one too many');
  assert.equal(callsign('wraith!').ok, false, 'punctuation is refused, not stripped');
  assert.equal(callsign('<img src=x onerror=1>').ok, false, 'markup is refused outright');
  assert.equal(callsign(null).ok, false);
  assert.equal(callsign(42).ok, false);
  for (const bad of [callsign('a'), callsign('wraith!'), callsign(null)])
    assert.ok(bad.why.length > 0, 'a plain message next to the field');
});

// ---------- createText / listText ----------

test('createText: the inline mutation, built from sanitised values, with JSON.stringify quoting the strings', () => {
  const body = createText({
    name: 'WRAITH',
    score: 1234,
    difficulty: 'operator',
    result: 'won',
    seconds: 600,
    kills: 15,
    alarms: 1,
    device: 'desk',
    mode: 'play',
    rules: 1,
    at: '2026-11-18T01:30:00.000Z',
  });
  const parsed = JSON.parse(body); // it must be valid JSON, first of all
  assert.equal(typeof parsed.query, 'string');
  assert.match(parsed.query, /^mutation \{ createScore\(item: \{.*\}\) \{ id name score mode at \} \}$/);
  assert.match(parsed.query, /name: "WRAITH"/);
  assert.match(parsed.query, /score: 1234/);
  assert.match(parsed.query, /difficulty: "operator"/);
  assert.match(parsed.query, /at: "2026-11-18T01:30:00\.000Z"/);
  // mode and rules are the board's own, never the caller's
  const faked = createText({ ...GOOD, mode: 'check', rules: 999, score: 50 });
  assert.match(JSON.parse(faked).query, /mode: "play"/);
  assert.match(JSON.parse(faked).query, new RegExp(`rules: ${RULES}\\b`));
});

test('createText: a name with a quote in it is still safe (JSON.stringify escapes it, the charset never lets it through from the field)', () => {
  const body = createText({ ...GOOD, name: 'WRAITH "X"' });
  const parsed = JSON.parse(body);
  assert.equal(typeof parsed.query, 'string');
});

test('listText: the exact top-100 query, by score, play rows only', () => {
  const { query } = JSON.parse(listText());
  assert.equal(
    query,
    'query { scores(first: 100, filter: { mode: { eq: "play" } }, orderBy: { score: DESC }) { items { id name score difficulty result seconds kills alarms device mode rules at } } }',
  );
});

// ---------- parse: hostile input ----------

test('parse: a non-object, a hung response, an errors array — nothing, never a throw', () => {
  for (const bad of [null, undefined, 42, 'nope', [], items(null), { data: {} }, { data: { scores: {} } }])
    assert.deepEqual(parse(bad), []);
  assert.deepEqual(parse({ errors: [{ message: 'nope' }] }), []);
  assert.deepEqual(parse({ data: { scores: { items: [GOOD] } }, errors: [{ message: 'also nope' }] }), []);
});

test('parse: a row of the right shape comes through unchanged', () => {
  assert.deepEqual(parse(items([GOOD])), [{ ...GOOD }]);
});

test('parse: markup in a name is never an element — dropped outright, the sanitiser would not leave it unchanged', () => {
  const planted = { ...GOOD, name: '<img src=x onerror=alert(1)>' };
  assert.deepEqual(parse(items([planted])), []);
});

test('parse: strings where numbers should be, and the other way round', () => {
  for (const bad of [
    { ...GOOD, score: '4200' },
    { ...GOOD, seconds: '410' },
    { ...GOOD, kills: '12' },
    { ...GOOD, alarms: '1' },
    { ...GOOD, name: 12345 },
    { ...GOOD, score: 42.5 },
  ])
    assert.deepEqual(parse(items([bad])), [], JSON.stringify(bad));
});

test('parse: a check row never appears — the board is a record of play, not of a deployment proving itself', () => {
  assert.deepEqual(parse(items([{ ...GOOD, mode: 'check' }])), []);
});

test('parse: a row of rules other than the current version is dropped (an old table is not this one)', () => {
  assert.deepEqual(parse(items([{ ...GOOD, rules: RULES + 1 }])), []);
  assert.deepEqual(parse(items([{ ...GOOD, rules: 0 }])), []);
});

test('parse: a score above what the rules could ever give for that difficulty and result is dropped', () => {
  assert.deepEqual(parse(items([{ ...GOOD, difficulty: 'recruit', result: 'lost', score: 999999 }])), []);
});

test('parse: missing fields, the wrong difficulty/result/device, a bare id', () => {
  for (const bad of [
    { ...GOOD, id: undefined },
    { ...GOOD, difficulty: 'elite' },
    { ...GOOD, result: 'escaped' },
    { ...GOOD, device: 'tablet' },
    { ...GOOD, at: 12345 },
    { ...GOOD, at: 'not a date' },
  ])
    assert.deepEqual(parse(items([bad])), [], JSON.stringify(bad));
});

test('parse: ten thousand rows does not choke, and at most 100 come through', () => {
  const many = Array.from({ length: 10000 }, (_, i) => ({ ...GOOD, id: `r${i}`, name: `UNIT${i % 50}` }));
  const clean = parse(items(many));
  assert.ok(clean.length <= 100, `${clean.length} rows came through`);
});

// ---------- best / rank / merge ----------

test('best: one row a callsign — the higher score, ties going to the earlier `at`', () => {
  const rows = [
    { ...GOOD, id: '1', name: 'ALPHA', score: 100, at: '2026-11-01T00:00:00.000Z' },
    { ...GOOD, id: '2', name: 'ALPHA', score: 300, at: '2026-11-02T00:00:00.000Z' },
    { ...GOOD, id: '3', name: 'ALPHA', score: 300, at: '2026-11-03T00:00:00.000Z' },
    { ...GOOD, id: '4', name: 'BRAVO', score: 150, at: '2026-11-01T00:00:00.000Z' },
  ];
  const result = best(rows);
  assert.equal(result.length, 2);
  const alpha = result.find((r) => r.name === 'ALPHA');
  assert.equal(alpha.id, '2', 'the earlier of the two tied at 300');
});

test('best: sorted by score descending, then seconds ascending, then `at`', () => {
  const rows = [
    { ...GOOD, id: '1', name: 'ALPHA', score: 100, seconds: 300, at: '2026-11-01T00:00:00.000Z' },
    { ...GOOD, id: '2', name: 'BRAVO', score: 300, seconds: 500, at: '2026-11-01T00:00:00.000Z' },
    { ...GOOD, id: '3', name: 'CHARLIE', score: 300, seconds: 200, at: '2026-11-01T00:00:00.000Z' },
    { ...GOOD, id: '4', name: 'DELTA', score: 300, seconds: 200, at: '2026-11-02T00:00:00.000Z' },
  ];
  assert.deepEqual(
    best(rows).map((r) => r.name),
    ['CHARLIE', 'DELTA', 'BRAVO', 'ALPHA'],
  );
});

test('rank: the 1-based place of a callsign in a sorted list, or null', () => {
  const rows = best([
    { ...GOOD, id: '1', name: 'ALPHA', score: 300 },
    { ...GOOD, id: '2', name: 'BRAVO', score: 200 },
    { ...GOOD, id: '3', name: 'CHARLIE', score: 100 },
  ]);
  assert.equal(rank(rows, 'ALPHA'), 1);
  assert.equal(rank(rows, 'CHARLIE'), 3);
  assert.equal(rank(rows, 'NOBODY'), null);
});

test('merge: this device’s own local rows stand in for what the network has not confirmed yet', () => {
  const remote = [{ ...GOOD, id: '1', name: 'ALPHA', score: 100 }];
  const local = { scores: [{ ...GOOD, id: 'local-1', name: 'BRAVO', score: 900 }], queue: [] };
  const merged = merge(remote, local);
  assert.deepEqual(
    merged.map((r) => r.name),
    ['BRAVO', 'ALPHA'],
  );
});

test('merge: a queued row (not yet sent) counts too', () => {
  const local = { scores: [], queue: [{ row: { ...GOOD, id: 'q1', name: 'ECHO', score: 50 }, tries: 1 }] };
  assert.deepEqual(
    merge([], local).map((r) => r.name),
    ['ECHO'],
  );
  assert.deepEqual(merge([], { scores: [], queue: [] }), []);
  assert.deepEqual(merge(null, null), []);
});

// ---------- where it talks to, and what counts as an answer ----------

test('where the board talks to: the app’s database at its GraphQL address, only from the app’s own pages; a link’s address only if it is this machine’s', () => {
  // (A build is given the service's root, and the board is at its /graphql. Asked at the root the service answers
  // 405 — and the first board took that for an empty board and a score posted: no test had a server that
  // answers as the real one does.)
  const base = 'https://region.example/v1/tenants/t/workspaces/w/appbackends/i/BaaSService';
  const env = { url: base, key: 'pk-1', item: 'item-1' };
  const at = (board, hostname, given = env) => endpointOf({ board, hostname, ...given });
  // (a made-up app: what matters is where the name ends)
  const app = 'some-game.webapp.fabricapps.net';
  assert.deepEqual(at(null, app), { url: `${base}/graphql`, key: 'pk-1', item: 'item-1' });
  assert.equal(at(null, app, { ...env, url: `${base}/` }).url, `${base}/graphql`, 'a slash at its end is no matter');
  // not one of the app's own pages: a developer's machine, a test, somebody else's site
  for (const host of ['localhost', '127.0.0.1', 'example.com', 'fabricapps.net.example.com', 'notfabricapps.net', ''])
    assert.equal(at(null, host), null, host);
  // a build that was not given all three
  for (const missing of ['url', 'key', 'item']) assert.equal(at(null, app, { ...env, [missing]: '' }), null, missing);
  assert.equal(at(null, app, {}), null);
  // the switch in the address
  assert.equal(at('0', app), null);
  assert.deepEqual(at('http://127.0.0.1:4010/graphql', app), {
    url: 'http://127.0.0.1:4010/graphql',
    key: 'test',
    item: 'test',
  });
  assert.equal(at('http://localhost:4010/graphql', 'localhost').url, 'http://localhost:4010/graphql');
  for (const elsewhere of [
    'https://example.invalid/graphql',
    'http://127.0.0.1.example.com/graphql',
    'not an address',
    '//x',
  ])
    assert.equal(at(elsewhere, app), null, elsewhere);
});

test('what counts as an answer: a row made says so with its id, a list is a list — anything else is no answer at all', () => {
  const made = { data: { createScore: { id: '7', name: 'WRAITH', score: 440, mode: 'play', at: GOOD.at } } };
  assert.equal(created(made), true);
  // what a service answers when it is asked at the wrong address, or is not the service: none of it is a row made
  for (const not of [
    null,
    undefined,
    'ok',
    [],
    {},
    { message: 'Method Not Allowed' },
    { data: null },
    { data: {} },
    { data: { createScore: null } },
    { data: { createScore: {} } },
    { ...made, errors: [{ message: 'no' }] },
  ])
    assert.equal(created(not), false, JSON.stringify(not));
  assert.equal(listed(items([])), true);
  assert.equal(listed(items([GOOD])), true);
  for (const not of [
    null,
    {},
    { message: 'Method Not Allowed' },
    { data: null },
    { data: { scores: null } },
    { data: { scores: { items: 'none' } } },
    { ...items([]), errors: [{ message: 'no' }] },
  ])
    assert.equal(listed(not), false, JSON.stringify(not));
  // refused: the service itself said no — which is an answer, and the row is not to be sent again
  assert.equal(refused({ errors: [{ message: 'The value provided does not meet the required constraints.' }] }), true);
  for (const not of [null, {}, { errors: [] }, { errors: 'no' }, made])
    assert.equal(refused(not), false, JSON.stringify(not));
});

test('what the device kept is believed no more than what the table sends: rows and the queue are checked field by field', () => {
  // (18 November 2026, the review: the store was read with a look at its shape only, and a queued row went back
  // to the table as it was found)
  const row = { ...GOOD };
  delete row.id; // a row of this device's own has no id: the table gives one
  const kept = cleanLocal({
    scores: [
      row,
      { ...row, name: '<img src=x>' },
      { ...row, score: 'many' },
      { ...row, score: 999999 },
      null,
      7,
      { ...row, mode: 'check' },
    ],
    queue: [
      { row, tries: 2 },
      { row: { ...row, name: 'lowercase' }, tries: 1 },
      { row, tries: 'often' },
      { row: null, tries: 1 },
      'row',
      { row: { ...row, name: 'MAKO' }, tries: 99 },
    ],
  });
  assert.deepEqual(kept.scores, [row]);
  // a queued row that is whole is kept, with a count that is a count; one that has been tried too often is not
  assert.deepEqual(kept.queue, [
    { row, tries: 2 },
    { row, tries: 1 },
  ]);
  // nothing, something that is not a store, more than a store may hold
  for (const not of [null, undefined, 'x', 7, [], { scores: 'none', queue: {} }])
    assert.deepEqual(cleanLocal(not), { scores: [], queue: [] });
  const many = cleanLocal({
    scores: Array.from({ length: 500 }, () => row),
    queue: Array.from({ length: 500 }, () => ({ row, tries: 1 })),
  });
  assert.deepEqual([many.scores.length, many.queue.length], [LOCAL_LIMITS.scores, LOCAL_LIMITS.queue]);
});

test('how long the board is waited for: longer than a throttled service holds an answer, and not for ever', () => {
  // An app whose capacity is over its allowance is throttled, and the service then holds EVERY answer — to a
  // question about nothing, too — for twenty seconds and a little (status 200, the header
  // x-ms-mwc-throttling-delay: 20000). Until 18 November 2026 the game gave up after six, and a request that is
  // given up on is dropped by the service: the board everyone shares is there, and no game can read it or add to
  // it. Slow is not gone.
  assert.equal(WAIT.throttle, 20000, 'what the service’s own header says it holds an answer for');
  assert.ok(
    WAIT.answer >= WAIT.throttle + 10000,
    `an answer is waited ${WAIT.answer} ms for: the service’s ${WAIT.throttle} and ten seconds over, at the least`,
  );
  assert.ok(WAIT.answer <= 45000, 'a board that is gone is not waited most of a minute for');
  // slow is said before the old patience would have run out, and not of an answer that is merely not instant
  assert.ok(WAIT.slow >= 3000 && WAIT.slow <= 6000, `${WAIT.slow}`);
  assert.ok(WAIT.gap >= 5000, 'the board is not asked again the moment it has answered');
});

test('what a question that is out is called: asked — and, after a while without an answer, slow', () => {
  assert.equal(waiting(null, 123456), 'idle', 'nothing is out');
  assert.equal(waiting(1000, 1000), 'asking');
  assert.equal(waiting(1000, 1000 + WAIT.slow - 1), 'asking');
  assert.equal(waiting(1000, 1000 + WAIT.slow), 'slow');
  assert.equal(waiting(1000, 1000 + WAIT.answer), 'slow');
  assert.equal(waiting(0, WAIT.slow), 'slow', 'a question asked at nought on the clock is still a question');
  assert.equal(waiting(1000, 400), 'asking', 'a clock that went back is not a wait');
});
