// Fighting as one, not each for itself. Rules only — no drawing, no browser and no Math.random in here (a random
// source is taken as an argument where one is wanted); src/wild/squad-live.js joins these rules to the game, so
// this file runs under `node --test` (test/unit/wild-squad.test.mjs).
//
// The wild build (docs/WILD-squad.md). The owner, 18 November 2026: "make the enemies smarter and coordinated
// with one another when firing at me". Today every machine that sees you fights you alone: it closes to 17 m,
// backs off under 4.5 m, else steps aside at random. Two machines on you end up doing the same thing from the
// same side — easy to stand behind one piece of cover and let them queue up. This is the squad's one picture of
// the fight (where you were last SEEN by any of them) and the posts it hands out round that point, so that two
// machines are a crossfire and not a file.
//
// It is a loop, run at most twice a second (not every frame — see squad-live.js `step`):
//   entry   two or more loyal machines are in COMBAT
//   each turn   gather who is engaged, build candidate posts round the last-seen point, hand out posts and roles
//   exit    fewer than two are engaged: nothing is kept, the game's own rules run as they did before this file
//   budget  a ring of posts costs at most RING.steps * RING.radii.length sight tests, once a turn, however many
//           machines are engaged; a fall-back (at most one a turn) costs at most FALLBACK.steps more sight tests
//           and one path search — see docs/WILD-squad.md "Cost" for what that comes to measured
// It never changes what a machine can do: not its damage, not its chance to hit, not how many may fire at once
// (that cap is fireControl's, in src/enemies/index.js, and stays). It only changes where a machine stands and
// when, inside its own rest, it fires.
import { angleDelta, clamp, lerp } from '../core/math.js';

const TAU = Math.PI * 2;

export const SQUAD = {
  /** fewer loyal machines than this in COMBAT: the squad does nothing (fence G) */
  minEngaged: 2,
  /** metres from the last-seen point a post may be, and the two rings of candidates sampled inside that band */
  ring: [7, 15],
  ringSteps: 24,
  ringRadii: [1 / 3, 2 / 3],
  /** metres two posts must keep apart — kept clear of the in-post shift below (its own worst case, two units
   *  shifting their full distance straight at one another, must not close this gap to nothing) */
  minPostGap: 3,
  /** seconds a unit keeps a post before it may be swapped again, even for a better one */
  swapCooldown: 2,
  /** seconds a post may go unseen before it counts as gone bad */
  staleSight: 1.5,
  /** how much a post's score is marked down per metre a unit must travel to reach it (closer candidates win ties) */
  travelWeight: 0.01,
  /** the line the GAME backs a lone machine off at (src/enemies/index.js, COMBAT: under 4.5 m). Not the squad's
   *  number, and no longer the squad's rule for a machine it has posted (18 November 2026: the two of them
   *  steering one machine by turns left it shaking on this line) — read here so that `keepOff` is held clear of it */
  tooClose: 4.5,
  /** metres from HIM, not from the last-seen point: a machine that sees him is never walked nearer than this,
   *  nor stood nearer — a metre and a half clear of the game's line, since a route ends at the middle of a cell,
   *  up to 0.71 m from the point asked for */
  keepOff: 6,
  /** the circle a machine is walked round him on when its straight line would cross `keepOff`, and how far
   *  round it each mark is set (radians). roundAt * cos(roundStep) >= keepOff: a machine making for a mark that
   *  far ahead never cuts inside the line, however often the mark is set anew */
  roundAt: 7,
  roundStep: (30 * Math.PI) / 180,
  /** where else a mark may be set when the first place for it cannot be walked to (a centrifuge stands there):
   *  this many metres further out than `roundAt`, and then the same again this much further round (radians) */
  roundOut: [0, 2, 4],
  roundMore: (20 * Math.PI) / 180,
  /** metres: a walk round him is BEGUN only for a straight line that comes this much inside `keepOff`, and once
   *  begun is left only for one clear of `keepOff` itself — so a machine whose line lies on the edge does not
   *  change its mind at every step (it did, for a second and a half, the first time this was run) */
  roundSlack: 0.75,
  /** seconds a posted machine may be inside the game's line (`tooClose`) in his sight, getting out by the
   *  squad's own way, before it is given back to the game's rule, which backs it straight off. From 3 m to the
   *  line at the pace a sentry gives ground at, after the game's wait on a new route, is 0.85 s */
  insideFor: 1.5,
  /** seconds a machine given back to the game stays the game's before the squad walks it again. One hand-over
   *  at a time, seconds apart: on the night of the merge it was four a second, and the machine stood shaking
   *  between them. Meanwhile it is planned a post on its own side (`stay`, in `plan`) */
  barFor: 4,
  /** a held post is not stood on: every so often a unit shifts this many metres, this often (fence B) */
  shiftEvery: [2, 3.5],
  shiftBy: [1, 1.5],
  /** radians: about how wide a gap a next post aims for past its nearest neighbour — "~110-140 degrees apart"
   *  (fence B), not the far side of the ring: a candidate already this well clear of its neighbour is as good as
   *  one wider still, so the plan does not send a unit on the long way round, past the player, for a few more
   *  degrees it does not need (and does not buy with a straight line close enough to trip the game's own
   *  too-close rule, which a point diametrically opposite always would) */
  targetGap: (125 * Math.PI) / 180,
  /** fraction of full health below which a unit breaks off (fence C) */
  fallBackAt: 0.35,
  /** how far off a hiding place may be, how long it is held, and how long before the same unit falls back again */
  fallBackRing: 9,
  fallBackSteps: 10,
  fallBackHold: [2.5, 4],
  fallBackCooldown: 15,
  /** metres from the last-seen point: a SEARCH unit this close is called in like a heard noise (fence A) */
  callRange: 40,
  /** radians: how close two drones' orbit phases may be before they are spread apart (fence D) */
  orbitMinGap: Math.PI / 3,
  /** seconds a burst's rest may be stretched by, at most, to stagger two machines' fire (fence E) */
  fireLag: 0.6,
  /** seconds between two "they are splitting up" lines (fence F) */
  radioGap: 25,
};

/** |the short way round the circle| between two bearings (radians), 0 … PI */
const circ = (a, b) => Math.abs(angleDelta(a, b));
/** the bearing of (x, z) from a centre, our own convention (0 = +z, growing toward +x) — never fed back to the
 *  game as a yaw: these posts are only ever handed to `inner.goTo` as plain x, z */
const bearingOf = (cx, cz, x, z) => Math.atan2(x - cx, z - cz);
const pointAt = (cx, cz, bearing, radius) => ({
  x: cx + Math.sin(bearing) * radius,
  z: cz + Math.cos(bearing) * radius,
});

/**
 * The widest gap between neighbours, the narrowest, and the widest difference between any two — of a set of
 * bearings (radians). What the browser A/B test measures is `widestPair`, in words: "the mean, over the last six
 * seconds, of the widest difference between two machines' bearings as the player sees them".
 * @param {number[]} bearings
 * @returns {{gaps: number[], widestGap: number, minGap: number, widestPair: number}}
 */
export function spread(bearings) {
  const n = bearings.length;
  if (n < 2) return { gaps: [], widestGap: 0, minGap: 0, widestPair: 0 };
  const sorted = bearings.map((b) => ((b % TAU) + TAU) % TAU).sort((a, b) => a - b);
  const gaps = sorted.map((b, i) => (i + 1 < n ? sorted[i + 1] - b : sorted[0] + TAU - b));
  let widestPair = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) widestPair = Math.max(widestPair, circ(bearings[i], bearings[j]));
  return { gaps, widestGap: Math.max(...gaps), minGap: Math.min(...gaps), widestPair };
}

/**
 * Candidate posts on a ring round `center`: walkable, with sight of it, as a {x, z, bearing}[] — at most
 * `SQUAD.ringSteps * SQUAD.ringRadii.length` of them, which is also the most `sight` is ever called: a fixed
 * cost, paid once a turn, whatever the number of machines engaged.
 * @param {{x: number, z: number}} center  the squad's last-seen point
 * @param {(x: number, z: number) => boolean} walkable
 * @param {(x: number, z: number) => boolean} sight   a clear line from (x, z) to the point being watched
 */
export function candidates(center, walkable, sight) {
  const out = [];
  for (const frac of SQUAD.ringRadii) {
    const radius = lerp(SQUAD.ring[0], SQUAD.ring[1], frac);
    for (let i = 0; i < SQUAD.ringSteps; i++) {
      const bearing = (i / SQUAD.ringSteps) * TAU;
      const { x, z } = pointAt(center.x, center.z, bearing, radius);
      if (!walkable(x, z) || !sight(x, z)) continue;
      out.push({ x, z, bearing });
    }
  }
  return out;
}

/** Is a kept post still a legitimate one — on the ring, walkable, with sight of the point being watched? */
function stillValid(post, center, walkable, sight) {
  const d = Math.hypot(post.x - center.x, post.z - center.z);
  // a little looser than the band candidates are built in: a post a player's one metre did not invalidate
  return d >= SQUAD.ring[0] - 2 && d <= SQUAD.ring[1] + 2 && walkable(post.x, post.z) && sight(post.x, post.z);
}

/**
 * Hands out posts and a role to the engaged sentries. Loop contract: entry at two or more units; each call is
 * one turn (squad-live.js calls it at most twice a second); exit (fewer than two, or no open candidate) is an
 * empty map — everything falls back to the game's own COMBAT rules.
 * @param {object} i
 * @param {{x: number, z: number}} i.lastSeen        where the player was last SEEN by any of these units
 * @param {{id: number, x: number, z: number, dist: number, stay?: boolean}[]} i.units   the engaged sentries;
 *   `stay` — this one could not get round him a moment ago (squad-live.js gave it back to the game): it is
 *   posted on its own side, like the anchor, and not sent round again
 * @param {(x: number, z: number) => boolean} i.walkable
 * @param {(x: number, z: number) => boolean} i.sight
 * @param {number} i.now                              the game's clock (seconds)
 * @param {Map<number, {x: number, z: number, role: string, bearing: number, since: number, unseenAtPost: number}>} i.previous
 *   the last turn's posts, kept by squad-live.js between calls (it also keeps `unseenAtPost` current every frame)
 * @returns {Map<number, {x: number, z: number, role: string, bearing: number, since: number, unseenAtPost: number}>}
 */
export function plan({ lastSeen, units, walkable, sight, now, previous }) {
  const posts = new Map();
  if (!units || units.length < SQUAD.minEngaged) return posts;
  const cands = candidates(lastSeen, walkable, sight);
  if (!cands.length) return posts;

  // the anchor is the nearest to the fight (ties broken by id, so that two equal distances do not flip-flop)
  const order = [...units].sort((a, b) => a.dist - b.dist || a.id - b.id);
  const finalized = [];
  const fresh = new Map();

  const openFor = (c) => finalized.every((t) => Math.hypot(t.x - c.x, t.z - c.z) >= SQUAD.minPostGap);

  for (let idx = 0; idx < order.length; idx++) {
    const unit = order[idx];
    const isAnchor = idx === 0;
    // the anchor keeps roughly where it already is — and so does one that could not get round him (`stay`)
    const keeps = isAnchor || unit.stay === true;
    const ownBearing = bearingOf(lastSeen.x, lastSeen.z, unit.x, unit.z);
    let best = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      if (!openFor(c)) continue;
      const travel = Math.hypot(c.x - unit.x, c.z - unit.z) * SQUAD.travelWeight;
      // every other unit widens the spread of bearings instead — the gap to the CLOSEST bearing already taken
      // is what a crossfire needs widened, not the average of them
      let score;
      if (keeps) score = -circ(c.bearing, ownBearing) - travel;
      else {
        let minGap = Math.PI;
        for (const t of finalized) minGap = Math.min(minGap, circ(c.bearing, t.bearing));
        // widening the gap to the closest bearing already taken is what a crossfire needs — but only up to
        // about SQUAD.targetGap: a candidate already that well clear is as good a score as the far side of the
        // ring, so ties go to the nearer one (less travel), rather than always the one diametrically opposite
        score = Math.min(minGap, SQUAD.targetGap) - travel;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) continue;
    finalized.push(best);
    fresh.set(unit.id, { ...best, role: isAnchor ? 'anchor' : unit.stay === true ? 'hold' : 'flank' });
  }

  // hysteresis: a bad post (gone invalid, unseen too long, or stolen by this turn's assignment) is replaced;
  // a good one is kept, however the fresh plan would have done it — least surprising, and never flaps
  const keptThisTurn = [];
  for (const unit of order) {
    const prev = previous.get(unit.id);
    const next = fresh.get(unit.id);
    const role = next?.role ?? prev?.role ?? 'flank';
    if (prev) {
      const stolen = !keptThisTurn.every((t) => Math.hypot(t.x - prev.x, t.z - prev.z) >= SQUAD.minPostGap);
      const bad = stolen || prev.unseenAtPost > SQUAD.staleSight || !stillValid(prev, lastSeen, walkable, sight);
      if (!bad) {
        keptThisTurn.push(prev);
        posts.set(unit.id, { ...prev, role });
        continue;
      }
    }
    if (!next) continue;
    keptThisTurn.push(next);
    posts.set(unit.id, { x: next.x, z: next.z, role, bearing: next.bearing, since: now, unseenAtPost: 0 });
  }
  return posts;
}

// ---------- round him, never through ----------
// A post is a place round where he was last seen; the way to it can lie straight across him. Walked straight, a
// machine came inside the line the game backs a lone machine off at (4.5 m), the game backed it out, the squad
// sent it in again, and it stood shaking on that line in front of him (found by the full suite on the night of
// the merge, 18 November 2026: three staged fights in sixteen). So the squad keeps its own, wider line round
// him — `keepOff` — and walks a machine round it; and squad-live.js steers a posted machine alone, without
// handing it back to the game by distance, so that no two rules take turns with it.

/** How near `c` the straight walk from `from` to `to` comes, and whether that is where it begins. */
function nearestOn(c, from, to) {
  const fx = from.x - c.x;
  const fz = from.z - c.z;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return { d: Math.hypot(fx, fz), atStart: true };
  const t = clamp(-(fx * dx + fz * dz) / len2, 0, 1);
  return { d: Math.hypot(fx + dx * t, fz + dz * t), atStart: t === 0 };
}

/**
 * Does the straight walk from `from` to `to` keep `keep` metres clear of `c`? A walker already inside that, and
 * going out of it or along it (nearest at its first step), counts as clear: it is not to be sent round to leave.
 * @param {{x: number, z: number}} c     him
 * @param {{x: number, z: number}} from
 * @param {{x: number, z: number}} to
 * @param {number} [keep] metres
 */
export function keepsClear(c, from, to, keep = SQUAD.keepOff) {
  const { d, atStart } = nearestOn(c, from, to);
  return atStart || d >= keep - 1e-6;
}

/**
 * A place to stand, held off him: `to` itself if it is `keep` metres from `c` or more — else the point of that
 * line straight out from him through it (through where the walker is, if the place is right on top of him).
 * @returns {{x: number, z: number}}
 */
export function standOff(c, from, to, keep = SQUAD.keepOff) {
  const tx = to.x - c.x;
  const tz = to.z - c.z;
  const rt = Math.hypot(tx, tz);
  if (rt >= keep) return { x: to.x, z: to.z };
  if (rt > 1e-6) return { x: c.x + (tx / rt) * keep, z: c.z + (tz / rt) * keep };
  const fx = from.x - c.x;
  const fz = from.z - c.z;
  const rf = Math.hypot(fx, fz);
  return rf > 1e-6 ? { x: c.x + (fx / rf) * keep, z: c.z + (fz / rf) * keep } : { x: c.x, z: c.z + keep };
}

/**
 * Where to walk NOW so as to end at `to` (a place already held off him: see standOff) without crossing the
 * keep-off line round `c`: `to` itself where the straight walk is clear — else a mark on the circle walked
 * (`SQUAD.roundAt`), at the tangent to it from where the walker stands, or one step (`SQUAD.roundStep`) round
 * it once the walker is on it. Called again from the mark, or at every stride, it leads round and then in.
 * Loop contract (squad-live.js and the unit test both walk it): each mark is at least `roundStep` nearer the
 * place by bearing, so there are at most PI / roundStep of them before the straight walk is clear; the side is
 * chosen once (the short way) and handed back in, so a walk is never turned round half-way; and a walk is begun
 * only for a line `roundSlack` inside the one it is left at, so it is not begun again the step after it ends.
 * @param {{x: number, z: number}} c     him
 * @param {{x: number, z: number}} from  the walker
 * @param {{x: number, z: number}} to    the place
 * @param {number} [side]  +1 / -1: a walk round is under way, on this side; 0: none is (the short way is taken)
 * @returns {{x: number, z: number, round: boolean, side: number}}
 */
export function wayRound(c, from, to, side = 0) {
  if (keepsClear(c, from, to, side ? SQUAD.keepOff : SQUAD.keepOff - SQUAD.roundSlack))
    return { x: to.x, z: to.z, round: false, side: 0 };
  const from0 = bearingOf(c.x, c.z, from.x, from.z);
  const rf = Math.hypot(from.x - c.x, from.z - c.z);
  const way = side || (angleDelta(from0, bearingOf(c.x, c.z, to.x, to.z)) >= 0 ? 1 : -1);
  const lead = rf > SQUAD.roundAt ? Math.acos(SQUAD.roundAt / rf) : 0;
  const mark = pointAt(c.x, c.z, from0 + way * Math.max(lead, SQUAD.roundStep), SQUAD.roundAt);
  return { x: mark.x, z: mark.z, round: true, side: way };
}

/**
 * The places a mark may be set, in the order they are to be tried, for a walker going round `c` on one side:
 * the first is `wayRound`'s own (the tangent to the circle walked, or one step round it); then the same
 * bearing further out (`roundOut`); then all of those a little further round (`roundMore`). A fixed, short list
 * — six — so that one thing standing on the circle does not end the walk; squad-live.js takes the first that
 * can be walked to in a straight line that keeps clear of him.
 * @param {{x: number, z: number}} c     him
 * @param {{x: number, z: number}} from  the walker
 * @param {number} side  +1 / -1
 * @returns {{x: number, z: number, side: number}[]}
 */
export function marksRound(c, from, side) {
  const from0 = bearingOf(c.x, c.z, from.x, from.z);
  const rf = Math.hypot(from.x - c.x, from.z - c.z);
  const out = [];
  for (const more of [0, SQUAD.roundMore])
    for (const add of SQUAD.roundOut) {
      const radius = SQUAD.roundAt + add;
      const lead = rf > radius ? Math.acos(radius / rf) : 0;
      const p = pointAt(c.x, c.z, from0 + side * (Math.max(lead, SQUAD.roundStep) + more), radius);
      out.push({ x: p.x, z: p.z, side });
    }
  return out;
}

// ---------- the net under it ----------
// The way round is for open ground. Where there is none — a corridor, a hall with things in it — a machine goes
// by its route, and its route may lead through him; and a place to stand that was moved off him may be in a
// wall. So a posted machine found inside the game's line (`tooClose`) in his sight is given back to the game —
// at once if it is going by its route, after `insideFor` seconds if it is not out by its own way — and the game
// backs it off, as it does a machine with no squad. It is the game's then for `barFor` seconds: authority over
// a machine changes hands seconds apart, never step by step.

/**
 * How long a posted machine has been inside the game's line in his sight: runs on the steps it sees him, holds
 * on the steps it does not (sight comes and goes at a corner), and is nothing once it is out of the line.
 * @param {number} prev  the figure as it stood, seconds
 * @param {boolean} sees
 * @param {number} dist  metres from him
 * @param {number} dt    seconds
 */
export function lingered(prev, sees, dist, dt) {
  if (dist >= SQUAD.tooClose) return 0;
  return sees ? prev + dt : prev;
}

/**
 * Is a posted machine to be given back to the game's own rules, now?
 * @param {object} i
 * @param {boolean} i.sees
 * @param {number} i.dist      metres from him
 * @param {boolean} i.through  it found no way round on this walk, and is going by its route
 * @param {number} i.inside    `lingered`, seconds
 */
export function givenBack({ sees, dist, through, inside }) {
  return sees && dist < SQUAD.tooClose && (through || inside > SQUAD.insideFor);
}

/**
 * Where a hurt unit should fall back to: the nearest walkable cell within `SQUAD.fallBackRing` metres that the
 * point being watched cannot see — or null (too healthy still, on cooldown, or nowhere hides it). At most
 * `SQUAD.fallBackSteps` sight tests; at most one `path` call, only to confirm the one place chosen is reachable.
 * @param {object} i
 * @param {{id: number, x: number, z: number, hp: number, hpMax: number}} i.unit
 * @param {number} i.now
 * @param {Map<number, {at: number}>} i.previous   when each unit last fell back
 * @param {(x: number, z: number) => boolean} i.walkable
 * @param {(x: number, z: number) => boolean} i.sight       can the point being watched see (x, z)?
 * @param {(x: number, z: number) => boolean} [i.path]      is (x, z) reachable? (omit to skip the check)
 * @returns {{x: number, z: number} | null}
 */
export function fallBack({ unit, now, previous, walkable, sight, path }) {
  if (unit.hp / unit.hpMax >= SQUAD.fallBackAt) return null;
  const last = previous.get(unit.id);
  if (last && now - last.at < SQUAD.fallBackCooldown) return null;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < SQUAD.fallBackSteps; i++) {
    const bearing = (i / SQUAD.fallBackSteps) * TAU;
    const { x, z } = pointAt(unit.x, unit.z, bearing, SQUAD.fallBackRing);
    if (!walkable(x, z) || sight(x, z)) continue;
    const d = Math.hypot(x - unit.x, z - unit.z);
    if (d < bestD) {
      bestD = d;
      best = { x, z };
    }
  }
  if (!best || (path && !path(best.x, best.z))) return null;
  return best;
}

/**
 * Spaces engaged drones' orbit phases apart: a one-shot redistribution (squad-live.js eases a drone's `orbit`
 * towards its share of it, over a second or two, rather than snapping it there). Alternates `orbitDir` so that
 * two neighbours do not fly the same way round. Below the minimum gap for the count given, it spreads them
 * evenly instead (the best that fits) rather than failing.
 * @param {{id: number, orbit: number}[]} drones
 * @param {number} [minGap] radians
 * @returns {Map<number, {orbit: number, orbitDir: number}>} only entries worth moving (already-spread drones are left alone)
 */
export function orbits(drones, minGap = SQUAD.orbitMinGap) {
  const out = new Map();
  const n = drones.length;
  if (n < 2) return out;
  const norm = (b) => ((b % TAU) + TAU) % TAU;
  const sorted = [...drones].sort((a, b) => norm(a.orbit) - norm(b.orbit));
  const gaps = sorted.map((d, i) =>
    i + 1 < n ? norm(sorted[i + 1].orbit) - norm(d.orbit) : norm(sorted[0].orbit) + TAU - norm(d.orbit),
  );
  if (Math.min(...gaps) >= minGap) return out;
  const gap = Math.min(minGap, TAU / n);
  // kept near where they already are: spread out from the circular mean of the sorted set, in the same order
  let mean = 0;
  for (const d of sorted) mean += norm(d.orbit);
  mean /= n;
  const start = mean - (gap * (n - 1)) / 2;
  sorted.forEach((d, i) => out.set(d.id, { orbit: start + gap * i, orbitDir: i % 2 === 0 ? 1 : -1 }));
  return out;
}

/**
 * How much to add to each of a group of machines' rest between bursts, so that their fire does not land in the
 * same instant: 0 for the first, a growing delay for the rest, never past `cap`. Applied once, only when a unit
 * has just finished a burst (squad-live.js tells the difference) — called again mid-rest it would only shorten
 * what is left, which this never does either (it is an addition, made once).
 * @param {{id: number}[]} entries  already in the order the delay is to grow in (e.g. nearest first)
 * @param {number} [cap] seconds
 * @returns {Map<number, number>} seconds to add to `unit.fireT`, 0 … cap
 */
export function stagger(entries, cap = SQUAD.fireLag) {
  const out = new Map();
  const n = entries.length;
  if (n < 2) return out;
  const step = cap / (n - 1);
  entries.forEach((e, i) => out.set(e.id, clamp(i * step, 0, cap)));
  return out;
}
