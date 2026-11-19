// The board's scoring: pure arithmetic, no drawing and no browser in here. src/wild/board-live.js calls `score`
// once a mission ends and shows the breakdown it returns; src/wild/board.js calls `ceiling` to refuse a row no
// set of figures could ever have earned (test/unit/wild-score.test.mjs, test/unit/wild-board.test.mjs).
//
// The wild build (docs/WILD.md). The owner, 18 November 2026: "add a score board feature and save it to a shared
// database …". What one figure is worth against another is this file's own decision, made once and
// written down below — not asked of the owner, who asked only for the board to exist.
import { clamp } from '../core/math.js';

/** bumped if the shape of a line, or what it is worth, ever changes — a row says which version reckoned it, and
    the board refuses a row from a rules version that is not this one (a changed table makes old scores and new
    ones impossible to compare honestly, so it does not try) */
export const RULES = 1;

/**
 * The most of each thing the site can give: its four charges, and the machines Ghost — which fields them all —
 * has on its roll (16 sentries, 4 drones; a takedown is of a machine on the roll). The rules may not read the
 * map (src/wild/index.js: what a file of the wild build may import), so the figures are written here and
 * test/unit/wild-score.test.mjs holds them to the map. They bound what a claim is worth and what `ceiling`
 * allows: until 18 November 2026 they were ten and forty, and the ceiling twice what a mission can score.
 */
const MAX = Object.freeze({
  charges: 4,
  sentries: 16,
  drones: 4,
  takedowns: 20,
});

/** every number the scoring is made of, each explained where it is used below */
export const POINTS = Object.freeze({
  /** each charge set: the first half of the job */
  charge: 220,
  /** the cascades blown: the job itself, whether or not you then got out */
  blast: 600,
  /** clear of the mountain — the one thing that makes a mission 'won' rather than merely survived */
  exfil: 1500,
  /** a sentry on the roll shut down */
  sentry: 300,
  /** a drone on the roll shut down — quicker to lose than a sentry, so worth a little less */
  drone: 220,
  /** a reinforcement shut down: never going to be missed from the roll, so worth less than either — and capped,
      so that calling down wave after wave is not the way to the top (a later round adds many more of them a
      mission; 30 is generous without being a living) */
  reinforcement: 100,
  reinforcementCap: 30,
  /** a knife takedown, on top of the kill itself: for going in quiet rather than loud */
  takedown: 150,
  /** the time bonus, for a mission that was WON: all of it at nought seconds, none of it from half an hour on.
      (A mission that is lost in its first seconds was not finished quickly: it has none.) */
  timeLimit: 1800,
  timeMax: 1200,
  /** the accuracy bonus: none of it below this many rounds fired (three shots at 100% proves nothing) */
  accuracyShots: 10,
  accuracyMax: 900,
  /** lost for every alarm the site raised */
  alarmPenalty: 220,
  /** lost for every retry from a checkpoint (counted by board-live.js: load() is only ever called for one) */
  retryPenalty: 150,
  /** the difficulty the mission was played on multiplies the lot */
  difficulty: { recruit: 0.7, operator: 1, ghost: 1.4 },
  /** a mission not won still scores — reaching the site and doing something is not nothing — but at half */
  notWon: 0.5,
});

const num = (v, max = Infinity) => clamp(Math.round(Number(v) || 0), 0, max);

/**
 * The score for one mission's figures.
 * @param {object} i
 * @param {string} i.difficulty 'recruit' | 'operator' | 'ghost'
 * @param {string} i.result 'won' | 'lost' | 'down'
 * @param {number} i.seconds mission time, G.stats().seconds
 * @param {number} i.shots G.stats().shots
 * @param {number} i.accuracy G.stats().accuracy (0…100)
 * @param {number} i.charges G.stats().charges
 * @param {boolean} i.blown G.stats().blown
 * @param {number} i.takedowns G.stats().takedowns
 * @param {number} i.alarms G.stats().alarms
 * @param {number} i.rollSentries sentries on the roll shut down (on.kill)
 * @param {number} i.rollDrones drones on the roll shut down (on.kill)
 * @param {number} i.reinforcements kills of machines not on the roll (on.kill, unit.rollId < 0)
 * @param {number} i.retries times this mission was retried from a checkpoint
 * @returns {{ total: number, lines: [string, number][] }} the total, and the breakdown it is made of — every
 *   line already carries the difficulty's and the result's multiplier, so the lines sum to the total exactly
 *   (short of the hard clamp at the end, which a real run never reaches: see "lands well short of the clamp").
 */
export function score(i) {
  const won = i.result === 'won';
  const mult = (POINTS.difficulty[i.difficulty] ?? POINTS.difficulty.recruit) * (won ? 1 : POINTS.notWon);

  const charges = num(i.charges, MAX.charges);
  const sentries = num(i.rollSentries, MAX.sentries);
  const drones = num(i.rollDrones, MAX.drones);
  const reinforcements = num(i.reinforcements, POINTS.reinforcementCap);
  const takedowns = num(i.takedowns, MAX.takedowns);
  const alarms = num(i.alarms);
  const retries = num(i.retries);
  const seconds = Math.max(0, Number(i.seconds) || 0);
  const shots = num(i.shots);
  const accuracy = clamp(Number(i.accuracy) || 0, 0, 100);

  const timeBonus = won ? POINTS.timeMax * clamp(1 - seconds / POINTS.timeLimit, 0, 1) : 0;
  const accuracyBonus = shots >= POINTS.accuracyShots ? POINTS.accuracyMax * (accuracy / 100) : 0;

  const raw = [
    ['Charges set', charges * POINTS.charge],
    ['Cascades blown', i.blown ? POINTS.blast : 0],
    ['Clear of the mountain', won ? POINTS.exfil : 0],
    ['Sentries shut down', sentries * POINTS.sentry],
    ['Drones shut down', drones * POINTS.drone],
    ['Reinforcements shut down', reinforcements * POINTS.reinforcement],
    ['Silent takedowns', takedowns * POINTS.takedown],
    ['Time bonus', timeBonus],
    ['Accuracy bonus', accuracyBonus],
    ['Alarms raised', -alarms * POINTS.alarmPenalty],
    ['Retries from a checkpoint', -retries * POINTS.retryPenalty],
  ];
  // what was not earned (and, for the two penalties, what was not incurred) is not shown — only the lines with
  // something to say for themselves, the game's own convention for a mission's end (src/wild/index.js `screen`)
  const lines = raw.filter(([, points]) => points !== 0).map(([label, points]) => [label, Math.round(points * mult)]);
  const total = clamp(
    lines.reduce((sum, [, points]) => sum + points, 0),
    0,
    999999,
  );
  return { total, lines };
}

/** the most the rules above could ever pay out for that difficulty and that result — every line at its best, the
    two penalties at nought. `src/wild/board.js` refuses a row that claims more: nothing real could have earned
    it. (A difficulty or a result this file does not know gets the most generous figure it has, rather than
    guessing low and refusing an honest row — board.js has already turned away anything but the three of each.) */
export function ceiling(difficulty, result) {
  const won = result === 'won';
  const mult = (POINTS.difficulty[difficulty] ?? POINTS.difficulty.ghost) * (won ? 1 : POINTS.notWon);
  const best =
    MAX.charges * POINTS.charge +
    POINTS.blast +
    (won ? POINTS.exfil : 0) +
    MAX.sentries * POINTS.sentry +
    MAX.drones * POINTS.drone +
    POINTS.reinforcementCap * POINTS.reinforcement +
    MAX.takedowns * POINTS.takedown +
    (won ? POINTS.timeMax : 0) +
    POINTS.accuracyMax;
  // (each line is rounded by itself in `score`: half a point a line of room, so that no honest row is refused)
  return Math.min(999999, Math.ceil(best * mult) + 6);
}
