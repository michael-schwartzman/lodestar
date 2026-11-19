// The squad, joined to the game: who is engaged, where the fight was last SEEN, the posts handed out and held,
// the fall-back, the drones spaced apart, the fire staggered, and Overwatch's word of it. The rules are
// src/wild/squad.js; the design is docs/WILD-squad.md.
import {
  SQUAD,
  fallBack,
  givenBack,
  keepsClear,
  lingered,
  marksRound,
  orbits,
  plan,
  stagger,
  standOff,
  wayRound,
} from './squad.js';

// `AI.COMBAT` and `AI.SEARCH` (enemies/ai.js), copied rather than imported: no other file under src/wild/ crosses
// the chunk boundary for that export, and importing it here was the one thing that made the main script grow by
// a couple of bytes (checked by building before and after) — these two words are not going to change under us.
const COMBAT = 'combat';
const SEARCH = 'search';

const rnd = (a, b) => a + Math.random() * (b - a);
/** the sentry's own eye height (src/enemies/index.js SPEC.sentry.eye) — posts are chosen with sight at this height,
 *  since only sentries ever stand at one (drones are spaced by `orbits`, never given a post) */
const EYE = 1.72;

export function createSquadLive(ctx) {
  if (ctx.params.get('squad') === '0') return null;
  const { G } = ctx;
  const { player, enemies } = G;
  const grid = G.world.grid;

  /** where the player was last SEEN by any loyal machine now in COMBAT — the one picture of the fight (fence A) */
  let lastSeen = null;
  let planClock = 0;
  let engagedCount = 0;
  let radioT = 0;
  let clock = 0;
  /** unit.id -> the post plan.js gave it: {x, z, role, bearing, since, unseenAtPost} */
  let posts = new Map();
  /** unit.id -> seconds to its next in-post shift, and the offset it is holding (fence B, "does not stand still") */
  const shiftT = new Map();
  const shiftAt = new Map();
  /** unit.id -> seconds left holding a fall-back spot, the spot itself, and `{at}` for fallBack's own cooldown */
  const fallHold = new Map();
  const fallSpot = new Map();
  const fallPrev = new Map();
  /** unit.id -> last frame's burstLeft, so a burst ending is seen exactly once (fence E) */
  const burstSeen = new Map();
  /** unit.id -> its way round him to the post in hand: which post, which side of him, the mark being walked to
   *  (null between two marks), `fresh` — the next mark may be on either side (the walk is new, or he has moved) —
   *  and `through` — no way round was open, so it goes by its route, to the end of it */
  const rounds = new Map();
  /** unit.id -> seconds it has been inside the game's line in his sight while posted (squad.js `lingered`) */
  const insideT = new Map();
  /** unit.id -> the squad's clock until which a machine given back to the game is the game's alone: the plan
   *  goes on counting it (and gives it a post on its own side for afterwards) but it is not walked meanwhile */
  const barred = new Map();
  /** how long the last plan() took (fence H: "measure a plan with 12 machines engaged, kept in state()") */
  let planMs = 0;
  /** the engaged sentries' ids as of the last step() — for the stealth guard: a machine never on this list was
   *  never reached for, whatever else it does */
  let engagedIds = [];

  const walkable = (x, z) => grid.walkable(Math.floor(x), Math.floor(z));
  /** can the point watched (the last-seen spot) be seen from (x, z)? candidates() and stillValid() ask this */
  const sightOf = (x, z) => lastSeen && grid.sight(x, EYE, z, lastSeen.x, player.eye, lastSeen.z);
  const pathOf = (x, z) => !!grid.path(Math.floor(player.x), Math.floor(player.z), Math.floor(x), Math.floor(z), false);
  /** can it walk a straight line from where it stands to (x, z)? A mark is only ever set where it can. */
  const walkLine = (unit, x, z) => walkable(x, z) && grid.clearWalk(unit.x, unit.z, x, z, unit.spec.radius, false);
  /** the first place for a mark, going round `c` on `side`, that it can walk straight to, clear of him */
  function markFor(unit, c, side) {
    for (const p of marksRound(c, unit, side))
      if (walkLine(unit, p.x, p.z) && keepsClear(c, unit, p, SQUAD.keepOff - SQUAD.roundSlack)) return p;
    return null;
  }

  /**
   * Where a posted machine walks now, to end at `to` (its post, shifted): the place itself, held off him — or,
   * where the straight walk there would cross the line the squad keeps round him, a mark on the way round
   * (squad.js `wayRound`, `marksRound`). "Him" is `c`, where the squad last saw him: the one picture all of
   * them share, and the same from one step to the next — NOT whether this machine sees him this step (at a
   * corner that comes and goes, and a machine sent by it was sent two ways by turns and stood there: 18
   * November 2026).
   * Loop contract: entry when the straight walk is not clear; each turn is one mark, kept until reached or
   * until he steps into the way to it (a mark set anew every frame would change the route's last cell several
   * times a second, and the game's `goTo` waits out each change); a mark reached is followed by one further
   * round on the same side, never back; one lost because he moved may be followed by one on either side; exit
   * when the straight walk is clear (at most PI / roundStep marks, if he stands). Exhaustion is soft: none of
   * the six places for a mark can be walked to in a straight line, and the machine goes by its route to its
   * place, `through`, for the rest of that walk (not marks again half-way: back and forth between the two is
   * a walk that never ends). If that route leads up to him, `squad()` below gives it back to the game.
   * @returns {{x: number, z: number}}
   */
  function wayFor(unit, post, to, c) {
    const place = standOff(c, unit, to);
    let way = rounds.get(unit.id);
    if (way && (way.px !== post.x || way.pz !== post.z)) {
      rounds.delete(unit.id);
      way = null;
    }
    if (way?.through) {
      if (Math.hypot(unit.x - place.x, unit.z - place.z) < 2.5) rounds.delete(unit.id);
      return place;
    }
    const next = wayRound(c, unit, place, way ? way.side : 0);
    if (!next.round) {
      rounds.delete(unit.id);
      return place;
    }
    if (!way) {
      way = { px: post.x, pz: post.z, side: next.side, mark: null, fresh: true, through: false };
      rounds.set(unit.id, way);
    }
    const mark = way.mark;
    if (mark) {
      if (Math.hypot(unit.x - mark.x, unit.z - mark.z) < 1.5) way.mark = null;
      else if (
        Math.abs(Math.hypot(mark.x - c.x, mark.z - c.z) - mark.r) > 2 ||
        !keepsClear(c, unit, mark, SQUAD.keepOff - SQUAD.roundSlack)
      ) {
        // he has moved: the mark is off the circle it was set on, or the walk to it now leads across him
        way.mark = null;
        way.fresh = true;
      }
    }
    if (!way.mark) {
      const at = markFor(unit, c, way.side) ?? (way.fresh ? markFor(unit, c, -way.side) : null);
      way.fresh = false;
      if (at) {
        way.side = at.side;
        way.mark = { x: at.x, z: at.z, r: Math.hypot(at.x - c.x, at.z - c.z) };
      } else way.through = true;
    }
    return way.mark ?? place;
  }

  function engagedSentries() {
    const out = [];
    for (const u of enemies.list)
      if (
        u.type === 'sentry' &&
        !u.dead &&
        u.brain.state === COMBAT &&
        !u.turned &&
        !u.piloted &&
        !u.carried &&
        u.stunT <= 0 &&
        u !== enemies.held
      )
        out.push(u);
    return out;
  }

  /** The side the player would call a post on — "left", "right" or (near enough dead astern) "behind" (fence F). */
  function sideOf(post) {
    const vx = post.x - player.x;
    const vz = post.z - player.z;
    const yaw = player.yaw;
    const right = vx * Math.cos(yaw) - vz * Math.sin(yaw);
    const forward = -vx * Math.sin(yaw) - vz * Math.cos(yaw);
    const angle = Math.atan2(right, forward);
    if (Math.abs(angle) > 2.2) return 'behind you.';
    return angle > 0 ? 'your right.' : 'your left.';
  }

  /** Once a burst it just finished, a growing delay is added to its rest — never touching the burst itself. */
  function applyStagger(units) {
    const justEnded = units.filter((u) => (burstSeen.get(u.id) ?? 0) > 0 && u.burstLeft <= 0 && u.fireT > u.spec.gap);
    for (const u of units) burstSeen.set(u.id, u.burstLeft);
    if (justEnded.length < 2) return;
    // nearest to the last-seen point first: the one most likely already firing keeps its rest, the rest wait a touch more
    justEnded.sort((a, b) => a.dist - b.dist);
    for (const [id, add] of stagger(justEnded)) {
      const u = justEnded.find((e) => e.id === id);
      u.fireT += add;
    }
  }

  return {
    name: 'squad',
    tallies: { squadFlanks: 'Times they went round you' },

    /** for tests and the curious: who is engaged, the posts held, who is falling back, and the plan's own cost */
    get state() {
      return {
        engaged: engagedCount,
        engagedIds,
        lastSeen,
        posts: Object.fromEntries([...posts].map(([id, p]) => [id, { x: p.x, z: p.z, role: p.role }])),
        fallenBack: [...fallHold.entries()].filter(([, t]) => t > 0).map(([id]) => id),
        /** who is being walked round him just now, which side, and whether it gave up on a way round */
        rounding: [...rounds].map(([id, w]) => ({ id, side: w.side, through: w.through })),
        /** who has been given back to the game's own rules, and is not being walked to its post yet */
        barred: [...barred].filter(([, until]) => until > clock).map(([id]) => id),
        planMs,
      };
    },

    reset() {
      lastSeen = null;
      planClock = 0;
      engagedCount = 0;
      radioT = 0;
      clock = 0;
      posts = new Map();
      shiftT.clear();
      shiftAt.clear();
      fallHold.clear();
      fallSpot.clear();
      fallPrev.clear();
      burstSeen.clear();
      rounds.clear();
      insideT.clear();
      barred.clear();
      planMs = 0;
      engagedIds = [];
    },

    step(dt) {
      clock += dt;
      radioT -= dt;
      const sentries = engagedSentries();
      // any loyal machine in COMBAT counts towards the fight, and towards "has anyone seen him just now" — not
      // only the sentries a post is chosen for (drones see him just as well, and the squad still wants to know)
      let combatCount = 0;
      for (const u of enemies.list) {
        if (u.dead || u.turned || u.piloted || u.carried || u.stunT > 0 || u === enemies.held) continue;
        if (u.brain.state !== COMBAT) continue;
        combatCount++;
        if (u.sees) lastSeen = { x: player.x, z: player.z };
      }
      engagedCount = combatCount;

      // SEARCH units near the last-seen point are called in exactly as a heard noise calls them (fence A) — not
      // `enemies.noise`, which would reach every machine within range, loyal and not yet in the fight alike
      if (lastSeen && engagedCount >= SQUAD.minEngaged)
        for (const u of enemies.list) {
          if (u.dead || u.turned || u.piloted || u.carried || u.stunT > 0 || u === enemies.held) continue;
          if (u.brain.state !== SEARCH) continue;
          if (Math.hypot(u.x - lastSeen.x, u.z - lastSeen.z) > SQUAD.callRange) continue;
          u.heardP.x = lastSeen.x;
          u.heardP.z = lastSeen.z;
          u.heard = u.heardP;
        }

      if (engagedCount < SQUAD.minEngaged || !lastSeen) {
        posts = new Map();
        rounds.clear();
        return;
      }

      // the stagger looks at every engaged sentry's burst every frame; the plan itself is a turn, at most twice a second
      applyStagger(sentries);

      planClock -= dt;
      if (planClock > 0) return;
      planClock = 0.5;

      engagedIds = sentries.map((u) => u.id);
      for (const [id, until] of barred) if (until <= clock) barred.delete(id);
      // one given back to the game a moment ago is planned a post on its own side meanwhile (`stay`): it could
      // not get round, and sent to the same post again it would only walk the same way again
      const units = sentries.map((u) => ({ id: u.id, x: u.x, z: u.z, dist: u.dist, stay: barred.has(u.id) }));
      const t0 = performance.now();
      const fresh = plan({ lastSeen, units, walkable, sight: sightOf, now: clock, previous: posts });
      planMs = performance.now() - t0;
      // F: a post that is new this turn, and a flank, is the one Overwatch tells the player about — at most once
      // a turn (several starting together are one line, not a chorus) and never inside its own 25 s
      if (radioT <= 0)
        for (const post of fresh.values())
          if (post.role === 'flank' && post.since === clock) {
            radioT = SQUAD.radioGap;
            ctx.act.radio('Overwatch', `They are splitting up. One is going round ${sideOf(post)}`, 5);
            ctx.tally.squadFlanks = (ctx.tally.squadFlanks || 0) + 1;
            break;
          }
      posts = fresh;

      // C: at most one fall-back a turn — a hurt unit, not on its own fifteen-second cooldown, sent somewhere
      // the last-seen point cannot see it; while it holds that spot it keeps no post, so plan() leaves it be
      for (const u of sentries) {
        if (fallHold.get(u.id) > 0) continue;
        const spot = fallBack({ unit: u, now: clock, previous: fallPrev, walkable, sight: sightOf, path: pathOf });
        if (!spot) continue;
        fallPrev.set(u.id, { at: clock });
        fallHold.set(u.id, rnd(...SQUAD.fallBackHold));
        fallSpot.set(u.id, spot);
        posts.delete(u.id);
        break;
      }
      // a way round belongs to a post: a machine with none (dead, fallen back, out of the fight) keeps none
      for (const id of rounds.keys()) if (!posts.has(id)) rounds.delete(id);
      for (const id of insideT.keys()) if (!posts.has(id)) insideT.delete(id);

      // D: engaged drones' orbit phases spread apart, a turn at a time, same as the post ring's cadence
      const drones = [];
      for (const u of enemies.list)
        if (u.type === 'drone' && !u.dead && u.brain.state === COMBAT && !u.turned && !u.piloted && !u.carried)
          drones.push(u);
      for (const [id, out] of orbits(drones)) {
        const d = drones.find((u) => u.id === id);
        d.orbit = out.orbit;
        d.orbitDir = out.orbitDir;
      }
    },

    /** A machine in a fight (enemies/index.js COMBAT): true if this has moved it to its place. */
    squad(unit, dt, inner) {
      if (engagedCount < SQUAD.minEngaged) return false;
      if (unit.type === 'drone') return false; // D already spaced it in step(); the game flies it from here

      const holding = fallHold.get(unit.id) ?? 0;
      if (holding > 0) {
        fallHold.set(unit.id, holding - dt);
        const spot = fallSpot.get(unit.id);
        inner.goTo(unit, spot.x, spot.z, unit.spec.hurry, dt);
        return true;
      }

      const post = posts.get(unit.id);
      // given back to the game a moment ago (below): it is the game's until the time is up. The plan goes on
      // counting it — the others are still posted round it, and it is given a post on its own side to walk to
      // when its time is up — but it is not walked meanwhile.
      if (!post || barred.get(unit.id) > clock) return false;
      // From here on the squad steers this machine, and no other rule does. Until 18 November 2026 one that saw
      // him from under 4.5 m or over 17 m was handed back, for that step, to the game's own rule of distance
      // (back off; close in). Two rules taking turns with one machine: sent to a post across him it stepped
      // over the 4.5 m line, the game backed it out, the squad sent it in again, and it stood shaking on the
      // line in front of him — the very thing fence B forbids ("not left standing still to be shot"), three
      // staged fights in sixteen. Now the squad keeps the distance itself — `wayFor` stands no machine inside
      // `SQUAD.keepOff` and walks it round that line, not across (past 17 m a post is its own way of closing
      // in) — and where that fails, below, the machine is given back for SECONDS, not for a step.
      post.unseenAtPost = unit.sees ? 0 : post.unseenAtPost + dt;

      // B: a post is not stood on — every couple of seconds it shifts a metre or two inside it
      let left = (shiftT.get(unit.id) ?? 0) - dt;
      let off = shiftAt.get(unit.id);
      if (left <= 0 || !off) {
        left = rnd(...SQUAD.shiftEvery);
        const ang = Math.random() * Math.PI * 2;
        const r = rnd(...SQUAD.shiftBy);
        off = { dx: Math.cos(ang) * r, dz: Math.sin(ang) * r };
        shiftAt.set(unit.id, off);
      }
      shiftT.set(unit.id, left);
      const goal = wayFor(unit, post, { x: post.x + off.dx, z: post.z + off.dz }, lastSeen ?? player);
      const way = rounds.get(unit.id);

      // The net (squad.js): inside the game's line in his sight — going by its route because there was no way
      // round, or not out of it by its own way in a second and a half — it is the game's, which backs it off,
      // and the squad does not walk it again for `barFor` seconds; its post is given up, and the next it is
      // planned is on its own side. Loop contract: entry as said; each turn is `barFor` seconds under the
      // game's rules alone; exit when they are up; there is no limit to how often — where even its own side
      // has no post for it, it will try again every time — but two hand-overs of one machine are never nearer
      // than `barFor` seconds, which is what keeps it from standing shaking between two rules.
      const inside = lingered(insideT.get(unit.id) ?? 0, unit.sees, unit.dist, dt);
      insideT.set(unit.id, inside);
      if (givenBack({ sees: unit.sees, dist: unit.dist, through: !!way?.through, inside })) {
        barred.set(unit.id, clock + SQUAD.barFor);
        posts.delete(unit.id);
        rounds.delete(unit.id);
        insideT.delete(unit.id);
        // handed back with no errand of the game's left over from before the squad took it (a side-step chosen
        // then, for where he stood then, would be walked now)
        unit.side = null;
        unit.moveT = 0;
        return false;
      }

      // purposeful travel — to a mark on the way round, or to a place still a few strides off — uses the game's
      // own closing-speed (spec.run, the same it uses to close on the player or return to a last-known point);
      // once there, the small in-post shift is the cautious shuffle (spec.hurry) the game uses for its side-step
      const marked = way?.mark === goal;
      const pace = marked || Math.hypot(unit.x - goal.x, unit.z - goal.z) > 2 ? unit.spec.run : unit.spec.hurry;
      // A machine that sees him keeps its front to him as it goes, as the game's own side-step and its closing
      // in do (they hand `goTo` the way to face). Left to turn to the way it is walking, the game turns it back
      // to him each step, it never faces its path, and it goes at a fifth of its pace — "a walker turns before
      // it strides off" — which made a flank a crawl across his sights (seen at the merge, 18 November 2026).
      const face = unit.sees ? Math.atan2(-(player.x - unit.x), -(player.z - unit.z)) : null;
      const there = inner.goTo(unit, goal.x, goal.z, pace, dt, face);
      // "there" at a mark it is not at: the route could get no nearer. No more marks this walk — by its route.
      if (there && marked) {
        way.mark = null;
        way.through = true;
      }
      return true;
    },
  };
}
