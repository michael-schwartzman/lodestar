// Which key lights burn (the second look; docs/DESIGN.md, "The second look").
//
// The site has some two dozen key lights (look/keys.js) and the program that draws a surface can work out a
// handful at a time: each costs every pixel a few sums even where it does not shine, and each needs a depth
// picture of its own. So the lamps take turns at a few SLOTS. Which lamps hold them is decided from where the
// eye is, a frame at a time, by two things worked out once for each lamp (surveyKeys):
//
//   where it shines   the cells it reaches, the zones those are in, and the round patch of ground — its POOL —
//                     that most of them lie in;
//   where it can be seen from   those zones, and, from a neighbouring zone, the cells where one zone opens into
//                     the other — a doorway, the mouth of a tunnel: its PORTALS. Light does not go through rock.
//
// A lamp's GAIN is 1 for an eye standing in its light, fades with the distance of the eye from its pool, and from
// another zone is had only near a portal. The lamps with the most gain hold the slots; one that holds a slot is
// not put out of it by another that is only a little ahead. And nothing ever jumps: a lamp's LEVEL — how
// brightly it is drawn — creeps towards its gain, a lamp new to a slot starts dark, and one that must give its
// slot up is let go only when it has crept down to nothing.
//
// Loop contract (createSlots.update, once a frame): at most `count` lamps hold a slot; at most ONE slot is handed
// back to be drawn afresh in a call, unless the eye has jumped (`snap`) — then every slot that needs it at once,
// and levels are set, not crept. No three.js and no browser in here: test/unit/slots.test.mjs pins it.
import { KIND } from '../world/grid.js';
import { KEY_SEEN, keyLuma, keySheet } from './key.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** a cell with this much of a lamp at chest height (as the game weighs it) is lit by it */
export const LIT = 0.05;
/**
 * …and where this much of its own light arrives (look/key.js keyReach: 1 in the middle of the beam, close to),
 * the lamp SHINES: only such cells say where its pool is and where it is seen from. The far fringe of a flood,
 * forty metres off, is light on the ground but not a reason to burn the lamp.
 */
export const SHINES = 0.12;
/** from a neighbouring zone a lamp counts in full this near one of its portals, and not at all this far from it */
export const PORTAL_NEAR = 5;
export const PORTAL_FAR = 11;

/**
 * For every key light: where it shines and where it can be seen from.
 * @param {object} grid world/grid.js
 * @param {object[]} keys look/keys.js
 * @param {Float32Array[]} [sheets] look/key.js keySheet for each, if somebody has them already
 * @returns {{ lit: number, zones: Set<number>, pool: { x: number, z: number, r: number },
 *   portals: { x: number, z: number, zone: number }[], near: number, far: number }[]}
 */
export function surveyKeys(grid, keys, sheets = null) {
  // light goes through a doorway whether its door happens to be shut or not, as when the lamps are worked out
  const doors = grid.doors.map((door) => door.open);
  for (const door of grid.doors) door.open = 1;
  try {
    return keys.map((key, k) => {
      const sheet = sheets ? sheets[k] : keySheet(grid, key);
      const shines = SHINES * keyLuma(key) * KEY_SEEN;
      const cells = [];
      const perZone = new Map();
      for (let z = 0; z < grid.h; z++)
        for (let x = 0; x < grid.w; x++) {
          const i = z * grid.w + x;
          if (sheet[i] <= shines || !grid.walkable(x, z)) continue;
          cells.push(x, z);
          perZone.set(grid.zone[i], (perZone.get(grid.zone[i]) || 0) + 1);
        }
      const count = cells.length / 2;
      // a few cells of light through a doorway do not make a zone the lamp's own
      const zones = new Set([...perZone].filter(([, n]) => n >= Math.max(6, count * 0.04)).map(([zone]) => zone));
      let cx = 0;
      let cz = 0;
      for (let n = 0; n < cells.length; n += 2) {
        cx += cells[n] + 0.5;
        cz += cells[n + 1] + 0.5;
      }
      cx = count ? cx / count : key.tx;
      cz = count ? cz / count : key.tz;
      const far = [];
      for (let n = 0; n < cells.length; n += 2) far.push(Math.hypot(cells[n] + 0.5 - cx, cells[n + 1] + 0.5 - cz));
      far.sort((a, b) => a - b);
      const r = count ? far[Math.min(count - 1, Math.floor(count * 0.85))] : 4;
      // where a lit cell has, next to it, floor that belongs to another zone: from there the lamp's light is seen
      const portals = [];
      const seen = new Set();
      for (let n = 0; n < cells.length; n += 2) {
        const x = cells[n];
        const z = cells[n + 1];
        const zone = grid.zone[z * grid.w + x];
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= grid.w || nz >= grid.h) continue;
          const j = nz * grid.w + nx;
          const other = grid.zone[j];
          const kind = grid.kind[j];
          if (other === zone || kind === KIND.WALL || kind === KIND.ROCK) continue;
          const id = `${nx},${nz}`;
          if (seen.has(id)) continue;
          seen.add(id);
          portals.push({ x: nx + 0.5, z: nz + 0.5, zone: other });
        }
      }
      const big = key.range >= 30;
      // a scattering of the lit cells — one every few metres — to ask "can the eye see any of this lamp's light?"
      const step = count > 500 ? 5 : count > 150 ? 4 : 3;
      const samples = [];
      for (let n = 0; n < cells.length; n += 2)
        if (cells[n] % step === 0 && cells[n + 1] % step === 0) samples.push(cells[n] + 0.5, cells[n + 1] + 0.5);
      if (!samples.length && count) samples.push(cells[0] + 0.5, cells[1] + 0.5);
      return {
        lit: count,
        zones,
        pool: { x: cx, z: cz, r },
        portals,
        samples,
        near: key.near ?? (big ? 20 : 8),
        far: key.far ?? (big ? 38 : 16),
        portalNear: PORTAL_NEAR,
        portalFar: PORTAL_FAR,
      };
    });
  } finally {
    grid.doors.forEach((door, n) => (door.open = doors[n]));
  }
}

/**
 * The same survey for a device that burns fewer lamps: every distance at which a lamp begins to matter, and
 * ceases to, is that much shorter (`reach` below 1).
 */
export const shortSighted = (survey, reach) =>
  survey.map((s) => ({
    ...s,
    near: s.near * reach,
    far: s.far * reach,
    portalNear: s.portalNear * reach,
    portalFar: s.portalFar * reach,
  }));

/** how high the eye is, and the light it looks for, when asking whether one can be seen from the other */
const EYE = 1.6;
const CHEST = 1.3;

/**
 * How much a key light matters to an eye at (x, z), standing in `zone`: 0 not at all … 1 in full.
 *   - nothing, further from its pool than `far`;
 *   - in a zone the lamp shines in: in full if any of its light can be SEEN from there (a big cavern goes round
 *     corners: the far side of the building is the same zone and another place);
 *   - in a neighbouring zone: only near where the one opens into the other.
 * @param {object} survey one entry of surveyKeys
 * @param {object} grid world/grid.js
 */
export function keyGain(survey, grid, x, z, zone) {
  if (!survey.lit) return 0;
  const d = Math.hypot(x - survey.pool.x, z - survey.pool.z) - survey.pool.r;
  const fade = 1 - smooth(survey.near, survey.far, d);
  if (fade <= 0) return 0;
  if (survey.zones.has(zone)) {
    const s = survey.samples;
    for (let n = 0; n < s.length; n += 2) if (grid.sight(x, EYE, z, s[n], CHEST, s[n + 1])) return fade;
    return 0;
  }
  let access = 0;
  for (const p of survey.portals) {
    if (p.zone !== zone) continue;
    const a = 1 - smooth(survey.portalNear, survey.portalFar, Math.hypot(x - p.x, z - p.z));
    if (a > access) access = a;
    if (access >= 1) break;
  }
  return fade * access;
}

/** below this a lamp is as good as out: its slot may be given to another */
export const OUT = 0.01;

/**
 * The slots, and who holds them.
 * @param {number} count how many lamps can burn at once
 * @param {object} [o]
 * @param {number} [o.rate=2.5]    how fast a level creeps, in levels a second (full to nothing in 0.4 s)
 * @param {number} [o.margin=0.15] how far ahead in gain a lamp must be to put a holder out of its slot
 */
export function createSlots(count, { rate = 2.5, margin = 0.15 } = {}) {
  /** the lamp in each slot, or −1 */
  const holder = new Int16Array(count).fill(-1);
  /** the depth picture of the slot is of its holder */
  const drawn = new Uint8Array(count);
  /** …but something has moved that should not have (dirty()): it is still used, and is drawn again in turn */
  const stale = new Uint8Array(count);
  let level = new Float32Array(0);
  let slotOf = new Int16Array(0);
  const order = [];
  const todo = [];

  return {
    count,
    holder,
    /** how brightly each lamp is drawn, 0..1, by its place in the list of lamps */
    get level() {
      return level;
    },
    /** the slot each lamp holds, or −1 */
    get slotOf() {
      return slotOf;
    },
    /**
     * @param {ArrayLike<number>} gains keyGain of every lamp, for where the eye is now
     * @param {number} dt seconds since the last call
     * @param {boolean} [snap=false] the eye has jumped (a start, a cut): set, do not creep
     * @returns {number[]} the slots whose depth pictures must be drawn now, of their holders — before anything
     *   is drawn with them. Never more than one, unless `snap`. (The array is reused: read it before the next call.)
     */
    update(gains, dt, snap = false) {
      const lamps = gains.length;
      if (level.length !== lamps) {
        level = new Float32Array(lamps);
        slotOf = new Int16Array(lamps).fill(-1);
      }
      // who should burn: the `count` with the most gain, a holder counted a little ahead of where it is
      order.length = 0;
      for (let i = 0; i < lamps; i++) if (gains[i] > 0) order.push(i);
      order.sort(
        (a, b) => gains[b] + (slotOf[b] >= 0 ? margin : 0) - (gains[a] + (slotOf[a] >= 0 ? margin : 0)) || a - b,
      );
      if (order.length > count) order.length = count;
      const wanted = (i) => order.includes(i);

      // a holder that should not burn any more creeps down, and lets go of its slot once it is out
      for (let s = 0; s < count; s++) {
        const h = holder[s];
        if (h < 0 || wanted(h)) continue;
        if (snap || level[h] <= OUT) {
          level[h] = 0;
          slotOf[h] = -1;
          holder[s] = -1;
          drawn[s] = 0;
          stale[s] = 0;
        }
      }
      // a lamp that should burn and has no slot takes a free one, dark until its depth picture is drawn
      for (const i of order) {
        if (slotOf[i] >= 0) continue;
        const s = holder.indexOf(-1);
        if (s < 0) break;
        holder[s] = i;
        slotOf[i] = s;
        drawn[s] = 0;
        stale[s] = 0;
        level[i] = 0;
      }
      // what is to be drawn afresh: first what has never been drawn, then what is stale; one a call, unless snapped
      todo.length = 0;
      for (let s = 0; s < count && (snap || !todo.length); s++)
        if (holder[s] >= 0 && !drawn[s]) {
          todo.push(s);
          drawn[s] = 1;
          stale[s] = 0;
        }
      for (let s = 0; s < count && (snap || !todo.length); s++)
        if (holder[s] >= 0 && stale[s]) {
          todo.push(s);
          stale[s] = 0;
        }
      // levels: towards the gain for a lamp whose slot is drawn, towards nothing otherwise
      const step = snap ? Infinity : rate * Math.max(0, dt);
      for (let i = 0; i < lamps; i++) {
        const s = slotOf[i];
        const target = s >= 0 && drawn[s] && wanted(i) ? Math.min(1, gains[i]) : 0;
        const d = target - level[i];
        level[i] = Math.abs(d) <= step ? target : level[i] + Math.sign(d) * step;
      }
      return todo;
    },
    /** Something that does not move has moved all the same (the cascades came down): every picture again, in turn. */
    dirty() {
      for (let s = 0; s < count; s++) if (holder[s] >= 0 && drawn[s]) stale[s] = 1;
    },
    /**
     * Lamp `i` has gone out — shot, or its breaker has dropped: at once, and not crept, for that is what a lamp
     * going out is. Its slot is free for another. Nothing else jumps.
     */
    cut(i) {
      if (!(i >= 0 && i < level.length)) return;
      level[i] = 0;
      const s = slotOf[i];
      if (s < 0) return;
      slotOf[i] = -1;
      holder[s] = -1;
      drawn[s] = 0;
      stale[s] = 0;
    },
  };
}
