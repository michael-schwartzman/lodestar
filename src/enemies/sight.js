// What a machine can see of the player. No drawing and no browser: pinned by test/unit/sight.test.mjs.

/** A head leaned out from behind something counts for this much of a whole body — to notice, and to hit. */
export const PEEK = 0.45;

/** How much of its attention a machine gives to somebody it can see who stands in the pitch dark. */
export const NOTICE_FLOOR = 0.1;
/**
 * How much of its attention a machine gives to somebody it can see, by how well lit they are (0..1): a tenth in
 * the dark, all of it under a lamp. The awareness it gains each second is multiplied by this.
 */
export const noticed = (vis) => NOTICE_FLOOR + (1 - NOTICE_FLOOR) * vis;

/**
 * How much of the player something at (ux, uy, uz) can see.
 *   1     the body: its middle, or its upper half above low cover
 *   PEEK  only the head, leaned out to one side of where the body stands
 *   0     nothing
 * @param {import('../world/grid.js').Grid} grid
 * @param {{ x: number, z: number, y?: number, eye: number, headX?: number, headZ?: number }} player
 *   `eye` is the height of the eye above the ground; `y` of the feet; `headX/headZ` where the head is (the body's
 *   own x and z unless the player is leaning)
 */
export function exposure(grid, ux, uy, uz, player) {
  const feet = player.y || 0;
  const top = player.eye - 0.1;
  const middle = feet + (player.eye - feet) * 0.5;
  if (grid.sight(ux, uy, uz, player.x, top, player.z) || grid.sight(ux, uy, uz, player.x, middle, player.z)) return 1;
  const hx = player.headX ?? player.x;
  const hz = player.headZ ?? player.z;
  if (Math.abs(hx - player.x) + Math.abs(hz - player.z) < 0.05) return 0;
  return grid.sight(ux, uy, uz, hx, top, hz) ? PEEK : 0;
}
