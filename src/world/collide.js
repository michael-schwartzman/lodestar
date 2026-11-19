// Moving a round body through the grid without ever leaving it inside something solid.

/**
 * Pushes a circle out of every cell that stops it.
 * @param {import('./grid.js').Grid} grid
 * @param {{ x: number, z: number }} pos changed in place
 * @param {number} feet how high the body's feet are (see Grid.blocked); guards and drones leave it at 0
 * @returns {boolean} true if it was touching anything
 */
export function pushOut(grid, pos, radius, flying = false, feet = 0) {
  let touched = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const x0 = Math.floor(pos.x - radius);
    const x1 = Math.floor(pos.x + radius);
    const z0 = Math.floor(pos.z - radius);
    const z1 = Math.floor(pos.z + radius);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        if (!grid.blocked(cx, cz, flying, feet)) continue;
        const nearX = Math.max(cx, Math.min(pos.x, cx + 1));
        const nearZ = Math.max(cz, Math.min(pos.z, cz + 1));
        let dx = pos.x - nearX;
        let dz = pos.z - nearZ;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // the centre is inside the cell: leave by the nearest side that leads somewhere open
          const exits = [
            [pos.x - cx, -1, 0],
            [cx + 1 - pos.x, 1, 0],
            [pos.z - cz, 0, -1],
            [cz + 1 - pos.z, 0, 1],
          ].sort((a, b) => a[0] - b[0]);
          const way = exits.find(([, sx, sz]) => !grid.blocked(cx + sx, cz + sz, flying, feet)) || exits[0];
          dx = way[1];
          dz = way[2];
          pos.x += dx * (way[0] + radius);
          pos.z += dz * (way[0] + radius);
        }
        moved = true;
        touched = true;
      }
    if (!moved) break;
  }
  return touched;
}

/**
 * Moves a body by (dx, dz), sliding along whatever it meets. Long moves are cut into short steps so that a fast
 * body cannot pass through a thin wall between two frames.
 * @returns {boolean} true if it touched anything on the way
 */
export function moveBody(grid, pos, dx, dz, radius, flying = false, feet = 0) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * 0.5)));
  let touched = false;
  for (let s = 0; s < steps; s++) {
    pos.x += dx / steps;
    pos.z += dz / steps;
    if (pushOut(grid, pos, radius, flying, feet)) touched = true;
  }
  return touched;
}
