// Flying a drone the uplink has taken: the flight, as rules. No drawing and no browser in here —
// src/wild/pilot-live.js joins them to the game — so it runs under `node --test` (test/unit/wild-pilot.test.mjs).
//
// The wild branch's experiment (docs/WILD.md, "The uplink"). A sentry the uplink takes fights for the player; a
// drone it takes is FLOWN: the eye goes into it, the hands work it — and the body stands where it was left, to be
// found and shot at like any body. The link lasts as long as the drone's battery, or until the body is hit, or
// until the player ends it by blowing the drone up where it hangs.
import { clamp, damp, lerp } from '../core/math.js';

export const PILOT = {
  /** seconds the link lasts */
  seconds: 22,
  /** metres a second over the ground, and up or down; how quickly it takes up what the hand asks (a rate) */
  speed: 7.5,
  climb: 3.6,
  grip: 5,
  /**
   * How high it may be flown: never under `low` (what a drone flies over — a crate, a console — it must stay
   * over: the walls it is stopped by are the walls a flying thing is stopped by), `headroom` under a roof, and
   * in the open no higher than `high`.
   */
  low: 1.95,
  headroom: 0.35,
  high: 8.5,
  /** how far the eye can be tipped up or down, and how far it banks into a slide to the side (radians) */
  pitch: 1.25,
  roll: 0.2,
  /** the field of view through it, in degrees */
  fov: 96,
  /** its gun, in the player's hand: seconds between rounds, what one does to a machine, how far it carries */
  gun: { interval: 0.12, damage: 16, range: 60, spread: 0.01, noise: 12 },
  /** blown up where it hangs: metres, what it does at the middle and at the edge, how far it is heard */
  blast: { radius: 4.5, damage: 90, least: 25, noise: 22 },
};

/**
 * @param {number} yaw the way it faces when it is taken (the way the player was looking)
 * @returns {{ yaw: number, pitch: number, roll: number, vx: number, vy: number, vz: number, fireT: number, t: number }}
 *   t: seconds of the link left
 */
export function createFlight(yaw) {
  return { yaw, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, fireT: 0, t: PILOT.seconds };
}

/**
 * A step of the flight: the eye turned by the hand, the speed eased towards what is asked. Says how far it would
 * move in this step — whoever moves it sees to the walls (world/collide.js) and to the height (`heightWithin`).
 * @param {ReturnType<typeof createFlight>} f changed in place
 * @param {object} ask
 * @param {number} ask.dt
 * @param {number} ask.moveX  −1 … 1: right is +
 * @param {number} ask.moveY  −1 … 1: forward is +
 * @param {number} ask.lift   −1 … 1: up is +
 * @param {number} ask.lookX  how far the hand turned it this step, in radians (input.js): right is +
 * @param {number} ask.lookY  …and tipped it: down is +
 * @returns {{ x: number, y: number, z: number }}
 */
export function stepFlight(f, { dt, moveX, moveY, lift, lookX, lookY }) {
  f.yaw -= lookX;
  f.pitch = clamp(f.pitch - lookY, -PILOT.pitch, PILOT.pitch);
  let mx = moveX;
  let my = moveY;
  const push = Math.hypot(mx, my);
  if (push > 1) {
    mx /= push;
    my /= push;
  }
  // forward is (−sin yaw, −cos yaw), right of it (cos yaw, −sin yaw): as for everything that walks in the game
  const sin = Math.sin(f.yaw);
  const cos = Math.cos(f.yaw);
  f.vx = damp(f.vx, (-sin * my + cos * mx) * PILOT.speed, PILOT.grip, dt);
  f.vz = damp(f.vz, (-cos * my - sin * mx) * PILOT.speed, PILOT.grip, dt);
  f.vy = damp(f.vy, clamp(lift, -1, 1) * PILOT.climb, PILOT.grip, dt);
  f.roll = damp(f.roll, -mx * PILOT.roll, 6, dt);
  return { x: f.vx * dt, y: f.vy * dt, z: f.vz * dt };
}

/**
 * How high it is, held to where it may be: `ceiling` is the lowest roof over it (Infinity in the open).
 * Where a roof leaves no room at all it keeps to what it flies over.
 */
export function heightWithin(y, ceiling) {
  const top = Math.min(ceiling - PILOT.headroom, PILOT.high);
  return top < PILOT.low ? PILOT.low : clamp(y, PILOT.low, top);
}

/** What its end does to a machine `d` metres from it. */
export function blastAt(d) {
  return d > PILOT.blast.radius ? 0 : lerp(PILOT.blast.damage, PILOT.blast.least, d / PILOT.blast.radius);
}
