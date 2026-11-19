// The mission as a small state machine: what has been done, what comes next, and how it ends.
//
// It knows nothing about the world; main.js tells it what happened (a charge went on, a machine went down, the
// player stands in the pickup) and reads back the phase. Every rule is pinned by test/unit/mission.test.mjs
// against the graph in docs/DESIGN.md §6.

export const PHASE = {
  INFIL: 'infil',
  MARK: 'mark',
  EXFIL: 'exfil',
  EXTRACTED: 'extracted',
  LOST: 'lost',
  DOWN: 'down',
};

const FINAL = new Set([PHASE.EXTRACTED, PHASE.LOST, PHASE.DOWN]);

/**
 * @param {object} o
 * @param {string[]} o.charges     the id of every charge site: one on each cascade of centrifuges
 * @param {number} o.hostiles      how many machines are on the site's roll (ids 0 … n-1)
 * @param {number} o.exfilSeconds  how long the clock runs once the beacon is up
 */
export function createMission({ charges, hostiles, exfilSeconds }) {
  return {
    phase: PHASE.INFIL,
    charges: Object.fromEntries(charges.map((id) => [id, false])),
    chargesTotal: charges.length,
    chargesPlanted: 0,
    /** the charges have been fired: the cascades are wreckage */
    blown: false,
    hostilesTotal: hostiles,
    hostilesDown: 0,
    down: new Set(),
    beacon: false,
    clock: exfilSeconds,
    /** seconds since the mission began */
    time: 0,
    reported: PHASE.INFIL,
  };
}

export const isFinal = (m) => FINAL.has(m.phase);

function advance(m) {
  if (m.phase === PHASE.INFIL && m.chargesPlanted === m.chargesTotal && m.blown && m.hostilesDown === m.hostilesTotal)
    m.phase = PHASE.MARK;
}

/** A charge goes on. Returns true if that changed anything. */
export function plantCharge(m, id) {
  if (isFinal(m) || m.charges[id] !== false) return false;
  m.charges[id] = true;
  m.chargesPlanted++;
  return true;
}

/** Every charge is set and none has been fired. The guards need not be down: blowing them early is the loud way. */
export const canDetonate = (m) => m.phase === PHASE.INFIL && m.chargesPlanted === m.chargesTotal && !m.blown;

/** The charges are fired, once. Returns true if that changed anything. */
export function detonate(m) {
  if (!canDetonate(m)) return false;
  m.blown = true;
  return true;
}

/** A machine on the roll goes down. Pursuers are not on the roll and change nothing. */
export function hostileDown(m, id) {
  if (isFinal(m) || !Number.isInteger(id) || id < 0 || id >= m.hostilesTotal || m.down.has(id)) return false;
  m.down.add(id);
  m.hostilesDown++;
  return true;
}

export const canPlaceBeacon = (m) => m.phase === PHASE.MARK;

/** The beacon goes up and the clock starts. Only possible in `mark`. */
export function placeBeacon(m) {
  if (!canPlaceBeacon(m)) return false;
  m.beacon = true;
  m.phase = PHASE.EXFIL;
  return true;
}

/**
 * One tick.
 * @param {{ dt: number, health: number, inPickup: boolean }} now
 * @returns {string[]} every phase entered since the last call (usually none)
 */
export function step(m, { dt, health, inPickup }) {
  if (!isFinal(m)) {
    m.time += dt;
    advance(m);
    // the order below is the rule for ties: down beats everything, out beats late
    if (health <= 0) m.phase = PHASE.DOWN;
    else if (m.phase === PHASE.EXFIL) {
      if (inPickup) m.phase = PHASE.EXTRACTED;
      else {
        m.clock = Math.max(0, m.clock - dt);
        if (m.clock === 0) m.phase = PHASE.LOST;
      }
    }
  }
  if (m.phase === m.reported) return [];
  m.reported = m.phase;
  return [m.phase];
}

/** The task list as the player should see it. */
export function objectives(m) {
  const cleared = m.hostilesDown === m.hostilesTotal;
  const rigged = m.chargesPlanted === m.chargesTotal;
  return [
    { id: 'clear', text: `Shut down the guard machines  ${m.hostilesDown} / ${m.hostilesTotal}`, done: cleared },
    { id: 'rig', text: `Rig the centrifuge cascades  ${m.chargesPlanted} / ${m.chargesTotal}`, done: rigged },
    { id: 'blow', text: 'Blow the cascades from the control room', done: m.blown, locked: !rigged },
    {
      id: 'mark',
      text: 'Raise the lodestar under the exhaust shaft',
      done: m.beacon,
      locked: m.phase === PHASE.INFIL,
    },
    {
      id: 'exfil',
      text: 'Get out by the road tunnel to the pickup',
      done: m.phase === PHASE.EXTRACTED,
      locked: !m.beacon,
    },
  ];
}
