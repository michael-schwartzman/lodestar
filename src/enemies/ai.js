// The mind of a guard machine: a small state machine and one number, awareness.
//
// This file knows nothing about drawing, paths or guns. Each tick the game tells a brain what its unit senses
// (a "percept") and the brain answers with its state and a few events. That keeps every rule here testable with
// plain numbers — see test/unit/ai.test.mjs, which pins every edge of the graph in docs/DESIGN.md §5.

export const AI = {
  PATROL: 'patrol',
  SUSPICIOUS: 'suspicious',
  INVESTIGATE: 'investigate',
  COMBAT: 'combat',
  SEARCH: 'search',
  /** taken from behind and kept in front of the player as a shield: it senses nothing and can do nothing */
  HELD: 'held',
  DEAD: 'dead',
};

export const TUNING = {
  /** awareness at which a unit stops and stares */
  suspiciousAt: 0.35,
  /** a suspicious unit relaxes once awareness has stayed under this… */
  calmBelow: 0.15,
  /** …for this many seconds */
  calmAfter: 2,
  /** awareness lost per second while the target is out of view */
  drain: 0.22,
  /** how long a unit looks about at the place it came to investigate */
  lookTime: 4,
  /** an investigation ends after this long, arrived or not */
  investigateMax: 14,
  /** a fighting unit that has not seen its target for this long goes looking */
  loseSightAfter: 3,
  searchTime: 12,
  searchTimeAlarm: 30,
  /** seconds of fighting, in total, before a unit calls the alarm */
  callAlarmAfter: 4,
  /** how long the alarm lasts after the last sighting */
  alarmTime: 45,
  /** how long a machine can be held as a shield before it breaks free */
  holdMax: 30,
};

const NONE = Object.freeze([]);

export function createBrain() {
  return {
    state: AI.PATROL,
    awareness: 0,
    /** seconds in the present state */
    timer: 0,
    /** suspicious: seconds awareness has been low. investigate: seconds spent looking at the place */
    lull: 0,
    /** combat: seconds since the target was last seen */
    unseen: 0,
    /** seconds of combat in total since the unit last patrolled */
    fought: 0,
    calledAlarm: false,
    /** the point the unit cares about: where it saw, heard or was told the target is */
    targetX: 0,
    targetZ: 0,
  };
}

function enter(brain, state) {
  brain.state = state;
  brain.timer = 0;
  brain.lull = 0;
  brain.unseen = 0;
  if (state === AI.PATROL) {
    brain.fought = 0;
    brain.calledAlarm = false;
  }
}

function aimAt(brain, point) {
  brain.targetX = point.x;
  brain.targetZ = point.z;
}

/**
 * One tick of thought.
 * @param {ReturnType<typeof createBrain>} brain changed in place
 * @param {object} p what the unit senses this tick
 * @param {boolean} p.sees      the target is in its cone of view with a clear line
 * @param {number} p.gain       awareness per second while it sees (the game works this out from distance, light, …)
 * @param {number} p.x          where the target is — only read when `sees`
 * @param {number} p.z
 * @param {{x: number, z: number} | null} p.heard   a noise it heard this tick
 * @param {{x: number, z: number} | null} p.hit     it was hit this tick; the point the shot came from
 * @param {{x: number, z: number} | null} p.alarm   the alarm named (or re-named) a position this tick
 * @param {boolean} p.alarmActive
 * @param {boolean} p.arrived   it is at its target point, or as near as it can get
 * @returns {readonly string[]} events: 'suspicious' | 'spotted' | 'lost' | 'calm' | 'investigate' | 'alarm' |
 *   'broke-free'
 */
export function think(brain, p, dt, tuning = TUNING) {
  if (brain.state === AI.DEAD) return NONE;
  // held: nothing it senses gets through, and it can do nothing — but the hold itself runs out
  if (brain.state === AI.HELD) {
    brain.timer += dt;
    if (brain.timer < tuning.holdMax) return NONE;
    aimAt(brain, p);
    brain.awareness = 1;
    enter(brain, AI.COMBAT);
    return ['broke-free'];
  }
  let events = NONE;
  const say = (event) => {
    if (events === NONE) events = [];
    events.push(event);
  };

  brain.timer += dt;
  if (p.sees) {
    brain.awareness = Math.min(1, brain.awareness + p.gain * dt);
    aimAt(brain, p);
  } else if (brain.state !== AI.COMBAT) {
    brain.awareness = Math.max(0, brain.awareness - tuning.drain * dt);
  }

  // being shot settles the matter in any state
  if (p.hit && brain.state !== AI.COMBAT) {
    aimAt(brain, p.hit);
    brain.awareness = 1;
    enter(brain, AI.COMBAT);
    say('spotted');
  }

  switch (brain.state) {
    case AI.PATROL:
      if (p.alarm) {
        aimAt(brain, p.alarm);
        enter(brain, AI.SEARCH);
      } else if (p.heard) {
        aimAt(brain, p.heard);
        brain.awareness = Math.max(brain.awareness, 0.5);
        enter(brain, AI.INVESTIGATE);
        say('investigate');
      } else if (brain.awareness >= 1) {
        enter(brain, AI.COMBAT);
        say('spotted');
      } else if (brain.awareness >= tuning.suspiciousAt) {
        enter(brain, AI.SUSPICIOUS);
        say('suspicious');
      }
      break;

    case AI.SUSPICIOUS:
      if (p.alarm) {
        aimAt(brain, p.alarm);
        enter(brain, AI.SEARCH);
      } else if (brain.awareness >= 1) {
        enter(brain, AI.COMBAT);
        say('spotted');
      } else if (p.heard) {
        aimAt(brain, p.heard);
        enter(brain, AI.INVESTIGATE);
        say('investigate');
      } else if (brain.awareness < tuning.calmBelow) {
        brain.lull += dt;
        if (brain.lull >= tuning.calmAfter) {
          enter(brain, AI.PATROL);
          say('calm');
        }
      } else {
        brain.lull = 0;
      }
      break;

    case AI.INVESTIGATE:
      if (p.alarm) {
        aimAt(brain, p.alarm);
        enter(brain, AI.SEARCH);
      } else if (brain.awareness >= 1) {
        enter(brain, AI.COMBAT);
        say('spotted');
      } else {
        // a fresh noise moves the place to look, but never buys more time
        if (p.heard) aimAt(brain, p.heard);
        if (p.arrived) brain.lull += dt;
        if (brain.lull >= tuning.lookTime || brain.timer >= tuning.investigateMax) {
          brain.awareness = Math.min(brain.awareness, tuning.suspiciousAt * 0.5);
          enter(brain, AI.PATROL);
          say('calm');
        }
      }
      break;

    case AI.COMBAT:
      brain.awareness = 1;
      brain.fought += dt;
      if (p.sees) brain.unseen = 0;
      else brain.unseen += dt;
      if (!brain.calledAlarm && brain.fought >= tuning.callAlarmAfter) {
        brain.calledAlarm = true;
        say('alarm');
      }
      if (brain.unseen >= tuning.loseSightAfter) {
        enter(brain, AI.SEARCH);
        say('lost');
      }
      break;

    case AI.SEARCH:
      if (p.sees) {
        brain.awareness = 1;
        enter(brain, AI.COMBAT);
        say('spotted');
      } else {
        if (p.alarm) aimAt(brain, p.alarm);
        else if (p.heard) aimAt(brain, p.heard);
        brain.awareness = Math.max(brain.awareness, 0.5);
        if (brain.timer >= (p.alarmActive ? tuning.searchTimeAlarm : tuning.searchTime)) {
          brain.awareness = tuning.suspiciousAt * 0.5;
          enter(brain, AI.PATROL);
          say('calm');
        }
      }
      break;
  }
  return events;
}

export function kill(brain) {
  brain.state = AI.DEAD;
  brain.awareness = 0;
}

/**
 * The machine is taken hold of. From then on it senses nothing and does nothing until it is let go, breaks free
 * (TUNING.holdMax) or is shut down. Returns false if it cannot be held (it is dead, or held already).
 */
export function hold(brain) {
  if (brain.state === AI.DEAD || brain.state === AI.HELD) return false;
  // not through enter(): what it had done before — fought, called the alarm — it has still done
  brain.state = AI.HELD;
  brain.timer = 0;
  brain.lull = 0;
  brain.unseen = 0;
  return true;
}

/** A held machine is let go: it turns on whoever held it, at (x, z). Returns false if it was not held. */
export function letGo(brain, x, z) {
  if (brain.state !== AI.HELD) return false;
  brain.targetX = x;
  brain.targetZ = z;
  brain.awareness = 1;
  brain.state = AI.COMBAT;
  brain.timer = 0;
  brain.lull = 0;
  brain.unseen = 0;
  return true;
}

// ---------- the site alarm ----------

export function createAlarm() {
  return { active: false, timeLeft: 0, x: 0, z: 0, /** how many times it has been raised */ count: 0 };
}

/** A unit calls the alarm. Returns true if it was not already sounding. */
export function raiseAlarm(alarm, x, z, tuning = TUNING) {
  const fresh = !alarm.active;
  alarm.active = true;
  alarm.timeLeft = tuning.alarmTime;
  alarm.x = x;
  alarm.z = z;
  if (fresh) alarm.count++;
  return fresh;
}

/** Somebody sees the target while the alarm sounds: it runs its full time again from now. */
export function sightAlarm(alarm, x, z, tuning = TUNING) {
  if (!alarm.active) return;
  alarm.timeLeft = tuning.alarmTime;
  alarm.x = x;
  alarm.z = z;
}

/** Returns true on the tick the alarm stands down. */
export function stepAlarm(alarm, dt) {
  if (!alarm.active) return false;
  alarm.timeLeft -= dt;
  if (alarm.timeLeft > 0) return false;
  alarm.timeLeft = 0;
  alarm.active = false;
  return true;
}
