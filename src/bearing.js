// Which way is which. The map reads like a page: north is −Z (up), east is +X (right). Everything that names a
// direction — the compass, the readout under the small map, what Overwatch says on the radio — asks here, so that
// they can never disagree. No drawing and no browser: this file runs under `node --test`.
import { AI } from './enemies/ai.js';

export const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const POINT_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Where something is from where you stand, by `relativeOf()`: ahead, ahead and right, right, … */
export const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

const DEG = 180 / Math.PI;
const wrap = (degrees) => ((degrees % 360) + 360) % 360;

/** The compass bearing of the direction (dx, dz), in degrees: 0 is north, 90 is east. */
export function bearingOf(dx, dz) {
  return wrap(Math.atan2(dx, -dz) * DEG);
}

/** The compass bearing a yaw looks along. Yaw 0 looks north and grows as you turn left. */
export function headingOf(yaw) {
  return wrap(-yaw * DEG);
}

/** Which of the eight compass points a bearing is nearest to: 0 = N, 1 = NE … 7 = NW. */
export function pointOf(bearing) {
  return Math.round(wrap(bearing) / 45) % 8;
}

/** Where (dx, dz) lies from someone facing `yaw`: 0 = ahead, 2 = to the right, 4 = behind, 6 = to the left. */
export function relativeOf(yaw, dx, dz) {
  return pointOf(bearingOf(dx, dz) - headingOf(yaw));
}

/** A distance as it is said aloud: to the nearest five metres, and never "zero". */
export function metres(d) {
  return Math.max(5, Math.round(d / 5) * 5);
}

const AFTER_YOU = new Set([AI.COMBAT, AI.SEARCH, AI.INVESTIGATE, AI.SUSPICIOUS]);

/**
 * The machines that are after the player, nearest first: the ones fighting, searching, coming to look or staring —
 * and every pursuer, whatever it is thinking. Machines still on their rounds are not contacts.
 * @param {object[]} units   enemies.list
 * @param {{ x: number, z: number, yaw: number }} player
 * @param {number} max       how many to return; `.total` on the result is how many there are in all
 * @param {((unit: object) => boolean) | null} known  if given, only machines it says yes to are contacts — on a
 *   setting without the radar, a machine that is hunting you but that you have never seen is not on the list
 * @returns {Array<{ unit: object, d: number, bearing: number, point: number, relative: number, hot: boolean }>}
 */
export function contacts(units, player, max = Infinity, known = null) {
  const found = [];
  for (const unit of units) {
    if (unit.dead) continue;
    const state = unit.brain.state;
    if (!AFTER_YOU.has(state) && !(unit.rollId < 0)) continue;
    if (known && !known(unit)) continue;
    const dx = unit.x - player.x;
    const dz = unit.z - player.z;
    const bearing = bearingOf(dx, dz);
    found.push({
      unit,
      d: Math.hypot(dx, dz),
      bearing,
      point: pointOf(bearing),
      relative: pointOf(bearing - headingOf(player.yaw)),
      hot: state === AI.COMBAT,
    });
  }
  found.sort((a, b) => a.d - b.d);
  const total = found.length;
  if (found.length > max) found.length = max;
  found.total = total;
  return found;
}
