// The board's rules: what is safe to send up, and what is safe to believe coming back down. No DOM, no fetch —
// src/wild/board-live.js does the talking; this file only knows shapes. Anyone on the internet can write a row
// into the real table by hand, so parse() treats every field as hostile until it has been checked.
import { RULES, ceiling } from './score.js';

/** the table's own limits (rayfin/data/Score.ts). The service holds the LENGTHS of the text columns; the ranges
    of the numbers it does NOT hold (a score of −1 and one of 9,999,999 are both taken: docs/WILD-board.md, "What
    the real service does"). So every number is checked here on the way in, and clamped on the way out. */
export const LIMITS = Object.freeze({
  name: Object.freeze({ min: 2, max: 16 }),
  score: Object.freeze({ min: 0, max: 999999 }),
  difficulty: Object.freeze(['recruit', 'operator', 'ghost']),
  result: Object.freeze(['won', 'lost', 'down']),
  seconds: Object.freeze({ min: 0, max: 99999 }),
  kills: Object.freeze({ min: 0, max: 9999 }),
  alarms: Object.freeze({ min: 0, max: 999 }),
  device: Object.freeze(['desk', 'phone']),
});

/** where the local store lives, and what it holds: this device's own best rows (newest first, capped), and a
    queue of rows the board has not managed to send yet (each with how many times it has tried) */
export const STORE_KEYS = Object.freeze({ callsign: 'lodestar.callsign.v1', scores: 'lodestar.wild.scores.v1' });
export const LOCAL_LIMITS = Object.freeze({ scores: 20, queue: 5, queueTries: 5 });

/**
 * How long the board is waited for, in milliseconds.
 *
 * An app whose capacity is over its allowance is throttled, and the service then holds EVERY answer — to a
 * question about nothing, too — for twenty seconds (status 200, the header `x-ms-mwc-throttling-delay: 20000`;
 * an answer takes 20 to 21 s in all). A game that gives up after six, as this one did until 18 November 2026,
 * never has one — and a request that is given up on is dropped by the service: the board is there and no game
 * can read it or add to it. So an answer is waited for longer than the service holds one, and while it is the
 * screen says that the board is slow — which it is — and not that it could not be reached.
 */
export const WAIT = Object.freeze({
  /** what the service holds an answer for when its capacity is throttled: its own figure, not this game's */
  throttle: 20000,
  /** how long one answer is waited for before the board is given up on: the service's delay, and as much again
      as was ever measured over it many times over — and still short of a player wondering what the game is at */
  answer: 35000,
  /** asked this long without an answer, the board is said to be slow (an ordinary answer takes a third of a
      second, so nothing is said of one) */
  slow: 5000,
  /** the scoreboard is not asked again sooner than this after it was asked — or, if later, after it answered */
  gap: 10000,
});

/**
 * What a question that is out is to be called: nothing is out ('idle'); it has been asked ('asking'); it was
 * asked a while ago and has not been answered ('slow'). `since` is when it was asked, or null; `now` is the same
 * clock.
 */
export function waiting(since, now) {
  if (since === null || since === undefined) return 'idle';
  return now - since >= WAIT.slow ? 'slow' : 'asking';
}

/** the shape a fresh/empty local store has — board-live.js falls back to this on first run or a corrupt read */
export function emptyLocal() {
  return { scores: [], queue: [] };
}

const CALLSIGN_RE = /^[A-Z0-9 _-]+$/;

/** upper-cases, trims, collapses inner runs of spaces, then asks for 2–16 characters of A–Z 0–9 space _ -.
    Nothing is ever stripped to make it fit: a character outside that set refuses the whole thing, so the name
    that ends up stored is always exactly what the charset allows (and so never needs escaping). */
export function callsign(text) {
  if (typeof text !== 'string') return { ok: false, value: '', why: 'enter a callsign' };
  const value = text.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!value) return { ok: false, value: '', why: 'enter a callsign' };
  if (!CALLSIGN_RE.test(value)) return { ok: false, value, why: 'letters, numbers, spaces, _ and - only' };
  if (value.length < LIMITS.name.min || value.length > LIMITS.name.max)
    return { ok: false, value, why: `2 to 16 characters (this is ${value.length})` };
  return { ok: true, value, why: '' };
}

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};
const oneOf = (list, v, fallback) => (list.includes(v) ? v : fallback);

/** the inline mutation body (see rayfin's proven form) built from sanitised values only: numbers go in as plain
    integers, strings go through JSON.stringify so the quoting takes care of itself. mode and rules are always
    the board's own — never the caller's — so this file can never be made to write a 'check' row or an old one. */
export function createText(row) {
  const r = row || {};
  const fields = {
    name: String(r.name ?? '').slice(0, LIMITS.name.max),
    score: clampInt(r.score, LIMITS.score.min, LIMITS.score.max),
    difficulty: oneOf(LIMITS.difficulty, r.difficulty, 'recruit'),
    result: oneOf(LIMITS.result, r.result, 'lost'),
    seconds: clampInt(r.seconds, LIMITS.seconds.min, LIMITS.seconds.max),
    kills: clampInt(r.kills, LIMITS.kills.min, LIMITS.kills.max),
    alarms: clampInt(r.alarms, LIMITS.alarms.min, LIMITS.alarms.max),
    device: oneOf(LIMITS.device, r.device, 'desk'),
    mode: 'play',
    rules: RULES,
    at: typeof r.at === 'string' && r.at ? r.at : new Date().toISOString(),
  };
  const query =
    `mutation { createScore(item: { name: ${JSON.stringify(fields.name)}, score: ${fields.score}, ` +
    `difficulty: ${JSON.stringify(fields.difficulty)}, result: ${JSON.stringify(fields.result)}, ` +
    `seconds: ${fields.seconds}, kills: ${fields.kills}, alarms: ${fields.alarms}, ` +
    `device: ${JSON.stringify(fields.device)}, mode: ${JSON.stringify(fields.mode)}, rules: ${fields.rules}, ` +
    `at: ${JSON.stringify(fields.at)} }) { id name score mode at } }`;
  return JSON.stringify({ query });
}

/** the top-100 list query: play rows only, highest score first. Fixed text — nothing in it is ever interpolated. */
export function listText() {
  return JSON.stringify({
    query:
      'query { scores(first: 100, filter: { mode: { eq: "play" } }, orderBy: { score: DESC }) ' +
      '{ items { id name score difficulty result seconds kills alarms device mode rules at } } }',
  });
}

const isInt = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** one row, cleaned, or null if any field is missing, of the wrong type, out of range, not play, not this
    version of the rules, or a name the sanitiser would not have left untouched. A row of the table's has an id;
    one this device kept for itself (`own`) has not been given one yet. */
function cleanRow(item, own = false) {
  if (!item || typeof item !== 'object') return null;
  if (!own && (typeof item.id !== 'string' || !item.id)) return null;
  if (typeof item.name !== 'string') return null;
  const sign = callsign(item.name);
  if (!sign.ok || sign.value !== item.name) return null;
  if (item.mode !== 'play') return null;
  if (!LIMITS.difficulty.includes(item.difficulty)) return null;
  if (!LIMITS.result.includes(item.result)) return null;
  if (!LIMITS.device.includes(item.device)) return null;
  if (!isInt(item.score, LIMITS.score.min, LIMITS.score.max)) return null;
  if (!isInt(item.seconds, LIMITS.seconds.min, LIMITS.seconds.max)) return null;
  if (!isInt(item.kills, LIMITS.kills.min, LIMITS.kills.max)) return null;
  if (!isInt(item.alarms, LIMITS.alarms.min, LIMITS.alarms.max)) return null;
  if (item.rules !== RULES) return null;
  if (typeof item.at !== 'string' || !Number.isFinite(new Date(item.at).getTime())) return null;
  if (item.score > ceiling(item.difficulty, item.result)) return null;
  const { id, name, score, difficulty, result, seconds, kills, alarms, device, mode, rules, at } = item;
  const row = { name, score, difficulty, result, seconds, kills, alarms, device, mode, rules, at };
  return own ? row : { id, ...row };
}

/**
 * What this device kept (board-live.js reads it from the browser's store), believed no more than what the table
 * sends: its own rows and the rows still waiting to be sent, each checked field by field as a row of the table
 * is; a waiting row keeps how often it has been tried, and one tried too often is dropped. Anything that is not
 * a store at all is an empty one.
 */
export function cleanLocal(raw) {
  const scores = [];
  const queue = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const item of Array.isArray(raw.scores) ? raw.scores : []) {
      const row = cleanRow(item, true);
      if (row && scores.length < LOCAL_LIMITS.scores) scores.push(row);
    }
    for (const waiting of Array.isArray(raw.queue) ? raw.queue : []) {
      const row = waiting && typeof waiting === 'object' ? cleanRow(waiting.row, true) : null;
      if (!row) continue;
      const tries = Number.isInteger(waiting.tries) && waiting.tries >= 1 ? waiting.tries : 1;
      if (tries < LOCAL_LIMITS.queueTries && queue.length < LOCAL_LIMITS.queue) queue.push({ row, tries });
    }
  }
  return { scores, queue };
}

/**
 * Where the board talks to, or null for "nowhere: scores are kept on this device".
 *   `board=0` in the address       nowhere
 *   `board=<address>`              that address, if it is this machine's own (127.0.0.1, localhost): it is for
 *                                  tests. Any other is ignored — a link must not be able to send a player's
 *                                  callsign and score wherever its writer likes
 *   otherwise                      the app's own database, at its GraphQL address (`<what the build was given>
 *                                  /graphql` — asked at its root the service answers 405), and only from one of
 *                                  the app's own pages: a build made where the app was published carries the
 *                                  real address, and a developer's machine or a test must never write to it
 * @param {object} o
 * @param {string | null} o.board what the page's address says for `board`
 * @param {string} o.hostname the page's host
 * @param {string} [o.url] the service's address, as the build was given it
 * @param {string} [o.key] its public key
 * @param {string} [o.item] the app's id
 */
export function endpointOf({ board, hostname, url, key, item }) {
  if (board === '0') return null;
  if (board) {
    let host = '';
    try {
      host = new URL(board).hostname;
    } catch {
      return null;
    }
    return host === '127.0.0.1' || host === 'localhost' ? { url: board, key: 'test', item: 'test' } : null;
  }
  if (!url || !key || !item || !String(hostname || '').endsWith('.fabricapps.net')) return null;
  return { url: `${String(url).replace(/\/+$/, '')}/graphql`, key, item };
}

/** The service said no to what was sent: that is an answer, and what was sent is not to be sent again. */
export const refused = (json) =>
  !!json && typeof json === 'object' && Array.isArray(json.errors) && json.errors.length > 0;

/** A row was made: the service says so by giving it an id. Nothing else is a row made. */
export const created = (json) =>
  !!json &&
  typeof json === 'object' &&
  !refused(json) &&
  typeof json.data?.createScore?.id === 'string' &&
  !!json.data.createScore.id;

/** The answer is a list of the table's rows (which may be none). Nothing else is the board. */
export const listed = (json) =>
  !!json && typeof json === 'object' && !refused(json) && Array.isArray(json.data?.scores?.items);

/** the GraphQL response, turned into clean rows. An errors array, a shape that doesn't match, a non-object —
    all come back as an empty list, never a throw. At most 100 rows survive, however many were sent. */
export function parse(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  if (Array.isArray(json.errors) && json.errors.length) return [];
  const items = json?.data?.scores?.items;
  if (!Array.isArray(items)) return [];
  const clean = [];
  for (const item of items) {
    const row = cleanRow(item);
    if (row) clean.push(row);
    if (clean.length >= 100) break;
  }
  return clean;
}

const rowTime = (row) => {
  const t = new Date(row.at).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** display order: highest score first; a tie runs to whoever took less time; still tied, whoever set it first */
function compareRows(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return rowTime(a) - rowTime(b);
}

/** one row a callsign — its best score, a tie going to the one set first (so posting the same score again
    never bumps the row that already holds it) — sorted into display order. */
export function best(rows) {
  const byName = new Map();
  for (const row of rows || []) {
    const prev = byName.get(row.name);
    if (!prev || row.score > prev.score || (row.score === prev.score && rowTime(row) < rowTime(prev)))
      byName.set(row.name, row);
  }
  return [...byName.values()].sort(compareRows);
}

/** the 1-based place of a callsign in an already-deduplicated, already-sorted list (the output of best()); null
    if that callsign is not in it. */
export function rank(rows, name) {
  const i = (rows || []).findIndex((r) => r.name === name);
  return i < 0 ? null : i + 1;
}

/** the remote list plus whatever this device knows locally (its own saved bests, and rows still queued to send)
    that the remote fetch may not have caught up with yet — reduced the same way, so the player's own row is
    never missing just because the network has not confirmed it. */
export function merge(remote, local) {
  const own = [...((local && local.scores) || []), ...((local && local.queue) || []).map((q) => q.row)];
  return best([...(remote || []), ...own]);
}
