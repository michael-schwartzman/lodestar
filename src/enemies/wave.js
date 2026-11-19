// What a charge brings: where its wave comes in. No drawing and no browser: pinned by test/unit/wave.test.mjs.
//
// Decision of 16 November 2026 — the owner: "every time you rig a centrifuge fire an alarm with new guards and
// drones that are coming to you". How many come is the setting's (src/difficulty.js `wave`). The guards walk in
// by the doors of the building (world/map.js `site.entries`), the drones come up from the bay
// (`site.reinforcements`); this says which door and which part of the bay.

export const WAVE = {
  /** a wave comes in at least this far from where the player stands, in metres: it is met, not stumbled into */
  far: 14,
  /** what a machine of a wave already knows when it sets out: enough to come looking, not enough to open fire */
  awareness: 0.6,
};

/**
 * The doors a wave's guards walk in by: one for each of them, the best first.
 *   best    out of sight of the player, and at least `far` off — the nearest of those first
 *   then    in sight, but at least `far` off — the nearest first
 *   last    nearer than `far` — the farthest first
 * There is always a way in while there is a door at all: if there are more guards than doors, they share.
 * @param {number[][]} entries [x, z] of each door's cell
 * @param {{ x: number, z: number }} from where the player stands
 * @param {number} count how many guards
 * @param {(x: number, z: number) => boolean} sees can the player see the cell (x, z)?
 * @returns {number[][]} `count` doors (or none, if nobody is to come or there is no door)
 */
export function waveEntries(entries, from, count, sees, far = WAVE.far) {
  if (count <= 0 || !entries.length) return [];
  const doors = entries.map((cell) => {
    const off = Math.hypot(cell[0] + 0.5 - from.x, cell[1] + 0.5 - from.z);
    return { cell, off, rank: off < far ? 2 : sees(cell[0], cell[1]) ? 1 : 0 };
  });
  doors.sort((a, b) => a.rank - b.rank || (a.rank === 2 ? b.off - a.off : a.off - b.off));
  return Array.from({ length: count }, (_, k) => doors[k % doors.length].cell);
}

/**
 * The parts of the bay a wave's drones come up from: `count` of them, beginning at the `turn`-th — so that the
 * second charge's drones do not come from where the first's did.
 */
export function waveBays(bay, turn, count) {
  if (count <= 0 || !bay.length) return [];
  return Array.from({ length: count }, (_, k) => bay[(turn + k) % bay.length]);
}
