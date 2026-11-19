// Threads of light: WARDEN's beam sensors. Pure rules — no THREE, no DOM, no browser — so `node --test` alone
// proves them. docs/WILD.md, "Threads of light", is the design this file keeps to.
//
// A beam has one of four states, and nothing else:
//   live       senses a crossing that is not cleared
//   re-arming  just tripped: six seconds of quiet before it senses again (it still shows as live: it is armed)
//   put out    an EMP has it down for as many seconds as the EMP gave it, then it is live again by itself
//   dead       shot through its emitter: this lasts for the mission; only reset() (a fresh mission) brings it back
// `reset()` always returns every beam to live, with nothing re-arming and no EMP pending. `load()` is the one way
// a beam can come back dead without being shot again: it is layered on top of a reset() the game already did, and
// it only ever restores which beams were dead.
//
// This module cannot ask the real site what is at a beam's ends or in between — `world/map.js` and `world/grid.js`
// are for the unit test alone to import, so that a placement is proved against the grid the mission actually
// builds, not against a number copied here by hand. What follows is the proof's *subject*: seven placements WHERE
// says to look, turned into the eight beams below (one place, the lobby's front door, is a pair: a low beam and a
// high beam on the same line, so neither jumping nor crouching alone gets a player through it).

/** A beam 0.45 m up: passed by a jump (PLAYER.jump clears roughly 1.08 m — plenty). */
export const LOW = 0.45;
/** A beam 1.35 m up: passed only by crouching under it (a game fact, not a height check — see isCleared). */
export const HIGH = 1.35;
/** How long a tripped beam stays quiet before it can sense a crossing again. */
export const REARM_SECONDS = 6;
/** How far from a beam's own middle an EMP reaches. */
export const EMP_REACH = 9;
/** The emitter's hit sphere: a small box on the wall, shot to put a beam out for good. */
export const EMITTER_RADIUS = 0.14;
/**
 * A single step bigger than this is not a walk: it is a debug or test teleport (`G.debug.teleport`, which
 * `page.stand()` uses), and must never be read as a crossing. Real walking tops out at PLAYER.run = 6.6 m/s; even
 * a dropped frame of a tenth of a second is only 0.66 m. A teleport crosses the whole site in one call.
 */
export const TELEPORT_GUARD = 3;

/**
 * The seven placements, as seven lines with eight beams (the lobby's front door carries two). Both ends of every
 * line sit on a solid cell of the real grid — proved in the unit test, not here — and `place` is the zone name
 * the real site gives that spot, also proved there. The emitter is a box at one end of the thread, at the beam's
 * own height; a pair's two beams take opposite ends so the two boxes do not sit in the same place.
 */
const PLACEMENTS = [
  // the service corridor (z = 43..45, walls at z = 42 and z = 46): two threads across it, one low, one high
  { id: 'corridor-57', kind: 'low', x0: 57.5, z0: 42.5, x1: 57.5, z1: 46.5, place: 'Service corridor' },
  { id: 'corridor-73', kind: 'high', x0: 73.5, z0: 42.5, x1: 73.5, z1: 46.5, place: 'Service corridor' },
  // the short passage between the control room and the switchgear room (x = 86..88, walls at x = 85 and x = 89)
  { id: 'switchgear-pass', kind: 'low', x0: 85.5, z0: 38.5, x1: 89.5, z1: 38.5, place: 'Service corridor' },
  // the door from the service corridor into the cascade hall (x = 44–45, in the wall at z = 42)
  { id: 'hall-corridor', kind: 'high', x0: 43.5, z0: 42.5, x1: 46.5, z1: 42.5, place: 'Service corridor' },
  // the door between the cascade hall and the feed room (z = 21–22, in the wall at x = 72)
  { id: 'hall-feed', kind: 'low', x0: 72.5, z0: 20.5, x1: 72.5, z1: 23.5, place: 'Feed room' },
  // the north passage (z = 13..15, a fence at z = 12, the building's wall at z = 16)
  { id: 'north-passage', kind: 'high', x0: 38.5, z0: 12.5, x1: 38.5, z1: 16.5, place: 'Main cavern' },
  // the lobby's front door from the yard (x = 40–41, in the wall at z = 54): a pair — it cannot be passed at all
  { id: 'lobby-low', kind: 'low', x0: 39.5, z0: 54.5, x1: 42.5, z1: 54.5, place: 'Lobby' },
  { id: 'lobby-high', kind: 'high', x0: 39.5, z0: 54.5, x1: 42.5, z1: 54.5, place: 'Lobby' },
];

/**
 * A round's reach past a wall's near face is ARMS.lamp.proud (src/arms.js: 0.15 m) — a lamp gets no more, and an
 * emitter asks no more of the game than a lamp does. A beam's own end sits at its cell's centre, 0.5 m in, which
 * a round could never reach: the emitter box instead sits this far from that centre, toward the thread, so it
 * is just inside a round's reach from the thread's own side — on the wall, as asked, not buried in it.
 */
const EMITTER_SET = 0.42;

export const BEAM_DEFS = PLACEMENTS.map((p) => {
  const y = p.kind === 'low' ? LOW : HIGH;
  const end1 = p.id === 'lobby-high'; // the pair's second beam takes the far end for its emitter
  const ex0 = end1 ? p.x1 : p.x0;
  const ez0 = end1 ? p.z1 : p.z0;
  const otherX = end1 ? p.x0 : p.x1;
  const otherZ = end1 ? p.z0 : p.z1;
  const toward = Math.hypot(otherX - ex0, otherZ - ez0);
  const ex = ex0 + ((otherX - ex0) / toward) * EMITTER_SET;
  const ez = ez0 + ((otherZ - ez0) / toward) * EMITTER_SET;
  return { ...p, y, emitter: { x: ex, y, z: ez } };
});

/**
 * Does the player's step from (px0, pz0) to (px1, pz1) cross this beam's thread? True when the two positions are
 * on opposite sides of the beam's line AND where they meet it falls within the thread's own length — not beyond
 * an end, not alongside it, and not for a step of zero length.
 *
 * The step's own end is excluded (`alongStep < 1`, not `<= 1`): merely reaching the line is not yet the far
 * side, only going past it is. The start is included (`>= 0`), so a chain of steps that share an end point (last
 * frame's "now" is this frame's "a moment ago") attributes a touch exactly on the line to one frame, not to both
 * or to neither.
 */
export function crosses(beam, px0, pz0, px1, pz1) {
  const d1x = px1 - px0;
  const d1z = pz1 - pz0;
  const d2x = beam.x1 - beam.x0;
  const d2z = beam.z1 - beam.z0;
  const denom = d2z * d1x - d2x * d1z;
  if (denom === 0) return false; // the step and the beam are parallel (standing still counts as this too)
  const wx = px0 - beam.x0;
  const wz = pz0 - beam.z0;
  const alongStep = (d2x * wz - d2z * wx) / denom; // 0..1: where the beam's line is met, along the player's step
  const alongBeam = (d1x * wz - d1z * wx) / denom; // 0..1: where that is, along the beam's own thread
  return alongStep >= 0 && alongStep < 1 && alongBeam >= 0 && alongBeam <= 1;
}

/**
 * Is this beam cleared by the player's posture? A low beam, by feet at or above its height (a jump). A high one,
 * only by crouching — not by height, since a high beam is passed by ducking under it, not by rising over it. A
 * pair is never cleared by one posture at once: src/player.js stands the player up the instant a jump begins
 * (crouched is cleared the same frame vy is set), so a crouched jump does not exist, and nothing clears both a
 * low and a high beam on the same line at the same time. This module does not re-enforce that; it only follows
 * from the two checks below and the player's own kinematics, which are not this module's to own.
 */
export function isCleared(beam, player) {
  return beam.kind === 'low' ? player.y >= beam.y : player.crouched === true;
}

/**
 * A ray against the emitter's sphere (radius EMITTER_RADIUS), direction a unit vector, `max` the round's reach.
 * Returns the distance to the hit, or null if the ray misses, meets the sphere behind its own origin, or only
 * meets it beyond `max`.
 */
export function rayEmitter(beam, ox, oy, oz, dx, dy, dz, max) {
  const { x: ex, y: ey, z: ez } = beam.emitter;
  const lx = ex - ox;
  const ly = ey - oy;
  const lz = ez - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = EMITTER_RADIUS * EMITTER_RADIUS;
  if (d2 > r2) return null;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc >= 0 ? tca - thc : tca + thc;
  if (t < 0 || t > max) return null;
  return t;
}

/** A fresh copy of every beam: live, not dead, nothing pending. */
function freshBeams() {
  return BEAM_DEFS.map((def) => ({ ...def, emitter: { ...def.emitter }, dead: false, empT: 0, rearmT: 0 }));
}

/**
 * The stateful half: eight beams, ticking clocks, and the one piece of memory a crossing needs — where the
 * player was a moment ago. `step()` returns the trips that happened this call (for the live side to act on:
 * the alarm, a note, a radio line, the tally); everything else here is read through the `beams` getter.
 */
export function createTripwires() {
  let beams = freshBeams();
  let prevX = 0;
  let prevZ = 0;

  return {
    reset(x = 0, z = 0) {
      beams = freshBeams();
      prevX = x;
      prevZ = z;
    },

    /** A read-only snapshot: { id, kind, live, dead, empT, rearmT, x0, z0, x1, z1, y, emitter: {x,y,z}, place }. */
    get beams() {
      return beams.map((b) => ({ ...b, emitter: { ...b.emitter }, live: !b.dead && b.empT <= 0 }));
    },

    step(dt, player) {
      for (const b of beams) {
        if (b.rearmT > 0) b.rearmT = Math.max(0, b.rearmT - dt);
        if (b.empT > 0) b.empT = Math.max(0, b.empT - dt);
      }
      const px = prevX;
      const pz = prevZ;
      prevX = player.x;
      prevZ = player.z;
      const tripped = [];
      const teleported = Math.hypot(player.x - px, player.z - pz) > TELEPORT_GUARD;
      if (teleported || player.hidden || !player.alive || !player.playing) return tripped;
      for (const b of beams) {
        if (b.dead || b.empT > 0 || b.rearmT > 0) continue;
        if (!crosses(b, px, pz, player.x, player.z)) continue;
        if (isCleared(b, player)) continue;
        b.rearmT = REARM_SECONDS;
        tripped.push({ beam: b });
      }
      return tripped;
    },

    /** A round in flight: the nearest live beam's emitter it meets, or null. `markDead` finishes the hit. */
    shot(ox, oy, oz, dx, dy, dz, max) {
      let best = null;
      for (const b of beams) {
        if (b.dead) continue;
        const t = rayEmitter(b, ox, oy, oz, dx, dy, dz, max);
        if (t !== null && (!best || t < best.t)) best = { t, beam: b };
      }
      return best;
    },

    /** Accepts either an internal beam (from `shot()`) or a snapshot from the `beams` getter — matched by id. */
    markDead(beam) {
      const real = beams.find((b) => b.id === beam.id);
      if (real) real.dead = true;
    },

    /** Every beam within EMP_REACH of (x, z), by its own middle, is put out for `seconds` (not shortened). */
    onEmp(x, z, seconds) {
      for (const b of beams) {
        if (b.dead) continue;
        const mx = (b.x0 + b.x1) / 2;
        const mz = (b.z0 + b.z1) / 2;
        if (Math.hypot(mx - x, mz - z) <= EMP_REACH) b.empT = Math.max(b.empT, seconds);
      }
    },

    /** Plain data: which emitters are dead. Nothing else lasts past a reset. */
    save() {
      return { dead: beams.filter((b) => b.dead).map((b) => b.id) };
    },

    /** Layered on a reset() the game already did: puts back only which emitters were dead. */
    load(state) {
      const ids = new Set(state?.dead ?? []);
      for (const b of beams) b.dead = ids.has(b.id);
    },
  };
}
