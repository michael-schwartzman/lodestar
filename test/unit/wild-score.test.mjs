// The board's scoring (src/wild/score.js): arithmetic alone, no drawing and no browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIFFICULTY } from '../../src/difficulty.js';
import { POINTS, RULES, ceiling, score } from '../../src/wild/score.js';
import { buildSite, garrison } from '../../src/world/map.js';

/** a plausible, unremarkable run: enough that every line has something to say */
function figures(extra = {}) {
  return {
    difficulty: 'operator',
    result: 'won',
    seconds: 400,
    shots: 120,
    accuracy: 70,
    charges: 4,
    blown: true,
    takedowns: 3,
    alarms: 1,
    rollSentries: 8,
    rollDrones: 4,
    reinforcements: 2,
    retries: 1,
    ...extra,
  };
}

function total(extra) {
  return score(figures(extra)).total;
}

test('RULES is the version this file reckons by', () => {
  assert.equal(typeof RULES, 'number');
  assert.ok(RULES >= 1);
});

test('the breakdown sums to the total, line for line', () => {
  const { total: t, lines } = score(figures());
  assert.ok(lines.length > 0);
  for (const [label, points] of lines) {
    assert.equal(typeof label, 'string');
    assert.equal(typeof points, 'number');
    assert.ok(Number.isInteger(points));
  }
  assert.equal(
    lines.reduce((sum, [, points]) => sum + points, 0),
    t,
  );
});

test('nothing done scores nothing, and never less', () => {
  // (18 November 2026, at the merge: until then a mission lost in its first seconds took most of the time bonus
  // — six hundred points for going down at the door — and this test asked for the full fifteen minutes to
  // get round it. The bonus is for getting out fast: see the next test.)
  const s = score({
    difficulty: 'recruit',
    result: 'lost',
    seconds: 3,
    shots: 0,
    accuracy: 0,
    charges: 0,
    blown: false,
    takedowns: 0,
    alarms: 0,
    rollSentries: 0,
    rollDrones: 0,
    reinforcements: 0,
    retries: 0,
  });
  assert.equal(s.total, 0);
  assert.deepEqual(s.lines, []);
});

test('the time bonus is for getting out fast: a mission that was not won has none, however short it was', () => {
  const line = (extra) => score(figures(extra)).lines.find(([label]) => label === 'Time bonus') || null;
  assert.ok(line({ result: 'won', seconds: 300 })[1] > 0);
  for (const result of ['down', 'lost']) assert.equal(line({ result, seconds: 5 }), null, result);
  // all of it at nought, none of it from half an hour on, and never less for being quicker
  assert.equal(line({ result: 'won', seconds: 0 })[1], POINTS.timeMax);
  assert.equal(line({ result: 'won', seconds: POINTS.timeLimit }), null);
  assert.equal(POINTS.timeLimit, 1800);
  assert.ok(line({ result: 'won', seconds: 600 })[1] > line({ result: 'won', seconds: 1200 })[1]);
});

test('the most a row may claim is what the site can give: its four charges, and every machine Ghost fields', () => {
  // (18 November 2026, at the merge: the bounds were ten charges and forty of each machine, and the ceiling was
  // twice what any mission can score — room for a row written by hand to sit at the top looking earned)
  const site = buildSite();
  const roll = garrison(site, DIFFICULTY.ghost.tier);
  const best = {
    result: 'won',
    seconds: 0,
    shots: 100,
    accuracy: 100,
    charges: site.charges.length,
    blown: true,
    takedowns: roll.length,
    alarms: 0,
    rollSentries: roll.filter((unit) => unit.type === 'sentry').length,
    rollDrones: roll.filter((unit) => unit.type === 'drone').length,
    reinforcements: POINTS.reinforcementCap,
    retries: 0,
  };
  assert.deepEqual([best.charges, best.rollSentries, best.rollDrones], [4, 16, 4]);
  for (const difficulty of ['recruit', 'operator', 'ghost']) {
    const perfect = score({ ...best, difficulty }).total;
    // (a point or two of rounding, line by line)
    assert.ok(
      Math.abs(ceiling(difficulty, 'won') - perfect) <= 12,
      `${difficulty}: ${ceiling(difficulty, 'won')} / ${perfect}`,
    );
    // and more than the site has, claimed, is not worth more
    assert.equal(
      score({ ...best, difficulty, charges: 9, rollSentries: 30, rollDrones: 30, takedowns: 60 }).total,
      perfect,
    );
  }
});

test('better in each good thing never scores less', () => {
  const base = total();
  assert.ok(total({ charges: 5 }) >= base, 'one more charge set');
  assert.ok(total({ blown: false }) <= base, 'the cascades not blown');
  assert.ok(total({ result: 'lost', retries: 1 }) <= base, 'not won');
  assert.ok(total({ rollSentries: 9 }) >= base, 'one more sentry');
  assert.ok(total({ rollDrones: 5 }) >= base, 'one more drone');
  assert.ok(total({ reinforcements: 3 }) >= base, 'one more reinforcement');
  assert.ok(total({ takedowns: 4 }) >= base, 'one more takedown');
  assert.ok(total({ seconds: 200 }) >= base, 'faster out');
  assert.ok(total({ shots: 200, accuracy: 90 }) >= base, 'sharper shooting');
});

test('worse in each bad thing never scores more', () => {
  const base = total();
  assert.ok(total({ alarms: 2 }) <= base, 'one more alarm');
  assert.ok(total({ retries: 2 }) <= base, 'one more retry');
  assert.ok(total({ seconds: 800 }) <= base, 'slower out');
  assert.ok(total({ rollSentries: 2 }) <= base, 'fewer sentries down');
});

test('reinforcement kills are capped, so farming waves is not the way to the top', () => {
  const capped = total({ reinforcements: POINTS.reinforcementCap });
  const over = total({ reinforcements: POINTS.reinforcementCap + 50 });
  assert.equal(over, capped, 'past the cap, more reinforcements add nothing');
  assert.ok(capped > total({ reinforcements: 0 }), 'up to the cap, they do count');
});

test('won beats not-won for the same figures', () => {
  const won = score(figures({ result: 'won' })).total;
  const lost = score(figures({ result: 'lost' })).total;
  const down = score(figures({ result: 'down' })).total;
  assert.ok(won > lost, `${won} is not more than ${lost}`);
  assert.ok(won > down, `${won} is not more than ${down}`);
});

test('a harder difficulty beats an easier one for the same figures', () => {
  const recruit = score(figures({ difficulty: 'recruit' })).total;
  const operator = score(figures({ difficulty: 'operator' })).total;
  const ghost = score(figures({ difficulty: 'ghost' })).total;
  assert.ok(ghost > operator, `${ghost} is not more than ${operator}`);
  assert.ok(operator > recruit, `${operator} is not more than ${recruit}`);
});

test('the accuracy bonus asks for a minimum of shots fired', () => {
  const few = total({ shots: POINTS.accuracyShots - 1, accuracy: 100 });
  const enough = total({ shots: POINTS.accuracyShots, accuracy: 100 });
  assert.ok(enough > few, 'a handful of rounds proves nothing');
});

test('a flawless ghost run lands well short of the clamp', () => {
  const flawless = score({
    difficulty: 'ghost',
    result: 'won',
    seconds: 1,
    shots: 300,
    accuracy: 100,
    charges: 6,
    blown: true,
    takedowns: 20,
    alarms: 0,
    rollSentries: 20,
    rollDrones: 10,
    reinforcements: 30,
    retries: 0,
  }).total;
  assert.ok(flawless > 10000, `${flawless} is a thin result for a flawless run`);
  assert.ok(flawless < 200000, `${flawless} is too close to the clamp of 999999`);
});

test('never negative and never above the ceiling, over a seeded sweep', () => {
  // (a small generator of its own, so the sweep is the same from one run to the next)
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  for (let i = 0; i < 2000; i++) {
    const difficulty = pick(['recruit', 'operator', 'ghost']);
    const result = pick(['won', 'lost', 'down']);
    const input = {
      difficulty,
      result,
      seconds: Math.floor(rand() * 2000),
      shots: Math.floor(rand() * 600),
      accuracy: Math.floor(rand() * 101),
      charges: Math.floor(rand() * 12),
      blown: rand() > 0.5,
      takedowns: Math.floor(rand() * 50),
      alarms: Math.floor(rand() * 30),
      rollSentries: Math.floor(rand() * 50),
      rollDrones: Math.floor(rand() * 50),
      reinforcements: Math.floor(rand() * 80),
      retries: Math.floor(rand() * 15),
    };
    const { total: t } = score(input);
    assert.ok(t >= 0, `${t} is negative for ${JSON.stringify(input)}`);
    assert.ok(t <= ceiling(difficulty, result), `${t} is above the ceiling for ${JSON.stringify(input)}`);
    assert.ok(t <= 999999, `${t} is above the hard clamp`);
  }
});

test('the ceiling never exceeds what a row may hold', () => {
  for (const difficulty of ['recruit', 'operator', 'ghost'])
    for (const result of ['won', 'lost', 'down']) assert.ok(ceiling(difficulty, result) <= 999999);
  // winning is worth more headroom than not — the ceiling says so too
  assert.ok(ceiling('ghost', 'won') > ceiling('ghost', 'lost'));
});
