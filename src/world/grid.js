// The site as a grid of one-metre cells, and the questions everything else asks of it:
// can a body stand here, is there a clear line between two points, where does a bullet stop, how do I walk there.
// No drawing and no browser here — this file runs under `node --test`.

export const KIND = { GROUND: 0, FLOOR: 1, WALL: 2, FENCE: 3, DOOR: 4, ROCK: 5 };

/** How tall the basin's rock rim is, as far as sight and bullets go. */
export const ROCK_HEIGHT = 10;

/** A prop lower than this can be flown over. */
export const FLY_CLEARANCE = 1.9;
/** How tall the wire is. */
export const FENCE_HEIGHT = 2.6;
/** Feet this close below the top of something count as on it: the height of a step nobody notices. */
export const STEP = 0.05;
/** A door lets bodies through once it is this far open, and sight once it is half open. */
export const DOOR_PASSABLE = 0.7;
export const DOOR_SEE_THROUGH = 0.5;

const SQRT2 = Math.SQRT2;
/** where a thing's own shape says a ray met it (Grid.shapes) */
const SHAPE_HIT = { t: 0, nx: 0, ny: 0, nz: 0, what: 'prop' };

export class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.kind = new Uint8Array(n);
    /** how high a prop on this cell stops movement, sight and bullets; 0 = nothing here */
    this.block = new Float32Array(n);
    /** 1: the prop here stops bodies only (a pole, a lattice) — never sight or bullets */
    this.thin = new Uint8Array(n);
    /** 1: the prop here has a flat top that a body can get onto and stand on (a crate, a container) */
    this.stand = new Uint8Array(n);
    /** height of a BUILT ceiling over the cell; 0 = none (whatever is over it then is the sky's business: `sky`) */
    this.ceil = new Float32Array(n);
    /**
     * What is over a cell that has no built ceiling: 0 = rock, a long way up (the roof of a cavern);
     * 1 = the open sky; 2 = the foot of a shaft that is open to the sky far above. Nothing that moves reads this:
     * it is for the light, the picture and the sound (world/build.js, main.js).
     */
    this.sky = new Uint8Array(n);
    /** for cells of a building: how tall its outside walls are */
    this.top = new Float32Array(n);
    this.floor = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    /** index into `doors` for door cells, else -1 */
    this.doorAt = new Int16Array(n).fill(-1);
    /**
     * The true shapes of the things that stand in cells, for bullets — or null, and then a round stops on the
     * cell's box. Whoever has the shapes sets this (world/build.js has every prop's triangles):
     *   at(cell)  → the id (≥ 0) of the thing whose shape fills that cell, or -1 if it has none to offer
     *   ray(id, ox, oy, oz, dx, dy, dz, out) → true if the ray meets that thing; fills out.t, out.nx, out.ny, out.nz,
     *     and may set out.what to say what was met ('prop' unless it does: wreckage says 'wreck' and a casing of the
     *     cascade 'casing', and neither keeps a mark)
     * Sight and movement never ask it: a guard sees, and a body is stopped, by the box.
     */
    this.shapes = null;
    /** { id, cells: number[], x, z, along: 'x' | 'z', open: 0..1 } — `open` is the only thing that changes in play */
    this.doors = [];

    // scratch space for path(), reused between calls
    this._g = new Float32Array(n);
    this._from = new Int32Array(n);
    this._stamp = new Uint32Array(n);
    this._closed = new Uint32Array(n);
    this._run = 0;
    this._heap = [];
    this._near = null;
  }

  inside(x, z) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }

  index(x, z) {
    return z * this.w + x;
  }

  /** Marks a rectangle of cells as one door. `along` is the axis the door's leaves slide along. */
  addDoor(x0, z0, x1, z1) {
    const id = this.doors.length;
    const cells = [];
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const i = this.index(x, z);
        this.kind[i] = KIND.DOOR;
        this.doorAt[i] = id;
        cells.push(i);
      }
    const door = {
      id,
      cells,
      x0,
      z0,
      x1,
      z1,
      x: (x0 + x1 + 1) / 2,
      z: (z0 + z1 + 1) / 2,
      along: x1 - x0 >= z1 - z0 ? 'x' : 'z',
      open: 0,
    };
    this.doors.push(door);
    return door;
  }

  /**
   * Can a route be PLANNED through this cell? Doors always count as open here: they open for whoever comes.
   * @param {boolean} flying drones cross fences and anything low enough to fly over, but need headroom
   */
  walkable(x, z, flying = false) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return false;
    const i = z * this.w + x;
    const kind = this.kind[i];
    if (kind === KIND.WALL || kind === KIND.ROCK) return false;
    if (flying) {
      if (this.block[i] >= FLY_CLEARANCE) return false;
      return true;
    }
    if (kind === KIND.FENCE) return false;
    return this.block[i] === 0;
  }

  /**
   * Does this cell stop a body RIGHT NOW? Unlike walkable(), a door counts only while it is shut.
   * @param {number} feet how high the body's feet are. Something with a flat top (`stand`) stops a body only from
   *   the side: once the feet are level with its top the body can move over it and stand on it. Walls, rock, the
   *   wire, shut doors and everything else stop a body however high it is. Guards never leave the ground (0).
   */
  blocked(x, z, flying = false, feet = 0) {
    if (!this.walkable(x, z, flying)) {
      if (flying || feet <= 0 || x < 0 || z < 0 || x >= this.w || z >= this.h) return true;
      const i = z * this.w + x;
      const kind = this.kind[i];
      if (kind !== KIND.GROUND && kind !== KIND.FLOOR) return true;
      return !(this.stand[i] === 1 && feet >= this.block[i] - STEP);
    }
    const i = z * this.w + x;
    return this.kind[i] === KIND.DOOR && this.doors[this.doorAt[i]].open < DOOR_PASSABLE;
  }

  /**
   * How high the ground is under a round body whose feet are at `feet`: the top of the tallest thing it has
   * any part of itself over and is high enough to be on, or 0 for the ground itself.
   */
  floorUnder(x, z, radius, feet) {
    let top = 0;
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(this.w - 1, Math.floor(x + radius));
    const z0 = Math.max(0, Math.floor(z - radius));
    const z1 = Math.min(this.h - 1, Math.floor(z + radius));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const i = cz * this.w + cx;
        const b = this.block[i];
        if (this.stand[i] !== 1 || b <= top || b > feet + STEP) continue;
        const dx = x - Math.max(cx, Math.min(x, cx + 1));
        const dz = z - Math.max(cz, Math.min(z, cz + 1));
        if (dx * dx + dz * dz < radius * radius) top = b;
      }
    return top;
  }

  /** How high the lowest ceiling over a round body is; Infinity under open sky. */
  ceilingOver(x, z, radius) {
    let low = Infinity;
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(this.w - 1, Math.floor(x + radius));
    const z0 = Math.max(0, Math.floor(z - radius));
    const z1 = Math.min(this.h - 1, Math.floor(z + radius));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.ceil[cz * this.w + cx];
        if (c <= 0 || c >= low) continue;
        const dx = x - Math.max(cx, Math.min(x, cx + 1));
        const dz = z - Math.max(cz, Math.min(z, cz + 1));
        if (dx * dx + dz * dz < radius * radius) low = c;
      }
    return low;
  }

  /**
   * How high this cell stops sight and bullets: a wall up to its building's roof, a shut door without limit,
   * a prop up to its top, open ground not at all.
   */
  occluder(x, z) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return Infinity;
    const i = z * this.w + x;
    const kind = this.kind[i];
    if (kind === KIND.WALL) return this.top[i] || Infinity;
    if (kind === KIND.ROCK) return ROCK_HEIGHT;
    if (kind === KIND.DOOR) return this.doors[this.doorAt[i]].open < DOOR_SEE_THROUGH ? Infinity : 0;
    return this.thin[i] ? 0 : this.block[i];
  }

  /**
   * Is there anything solid in this cell between the heights `lo` and `hi` — something a head, or a body held at
   * arm's length, cannot be put through? Walls, rock and shut doors at any height; the wire up to its top; a prop
   * up to its own; a ceiling from its height up.
   */
  solidAt(x, z, lo, hi = lo) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return true;
    const i = z * this.w + x;
    const kind = this.kind[i];
    if (kind === KIND.WALL || kind === KIND.ROCK) return true;
    if (kind === KIND.FENCE) return lo < FENCE_HEIGHT;
    if (kind === KIND.DOOR && this.doors[this.doorAt[i]].open < DOOR_PASSABLE) return true;
    const ceil = this.ceil[i];
    if (ceil > 0 && hi > ceil) return true;
    return this.block[i] > lo;
  }

  /**
   * How far a ball can be moved from (x, z) along the unit direction (dx, dz) before it touches something solid:
   * at most `want` metres. The ball is `radius` across at height `y` (it reaches from y − radius to y + radius).
   */
  reach(x, z, y, dx, dz, want, radius) {
    const STEP_LENGTH = 0.04;
    const lo = y - radius;
    const hi = y + radius;
    let got = 0;
    for (let s = STEP_LENGTH; s < want + STEP_LENGTH; s += STEP_LENGTH) {
      const at = Math.min(s, want);
      const px = x + dx * at;
      const pz = z + dz * at;
      const x0 = Math.floor(px - radius);
      const x1 = Math.floor(px + radius);
      const z0 = Math.floor(pz - radius);
      const z1 = Math.floor(pz + radius);
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          if (!this.solidAt(cx, cz, lo, hi)) continue;
          const nx = px - Math.max(cx, Math.min(px, cx + 1));
          const nz = pz - Math.max(cz, Math.min(pz, cz + 1));
          if (nx * nx + nz * nz < radius * radius) return got;
        }
      got = at;
      if (at >= want) break;
    }
    return got;
  }

  /** True if nothing stands between two points. Heights matter: low cover only hides what is below its top. */
  sight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    let cx = Math.floor(ax);
    let cz = Math.floor(az);
    const ex = Math.floor(bx);
    const ez = Math.floor(bz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - ax : ax - cx) * tDeltaX : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? cz + 1 - az : az - cz) * tDeltaZ : Infinity;
    let t = 0;
    // the two end cells never hide their own occupant
    for (let guard = 0; guard < 512; guard++) {
      if (cx === ex && cz === ez) return true;
      const tExit = Math.min(tMaxX, tMaxZ, 1);
      if (guard > 0) {
        const occ = this.occluder(cx, cz);
        if (occ > 0 && (occ === Infinity || Math.min(ay + dy * t, ay + dy * tExit) < occ)) return false;
      }
      if (tExit >= 1) return true;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    }
    return false;
  }

  /**
   * Where a ray stops. The direction must be a unit vector.
   *
   * A wall, rock and a shut door stop it on the face of their cell, which is where they are drawn. A thing that
   * stands in a cell is smaller than the cell: if its shape is known (`shapes`) the ray stops on the shape or
   * flies on through the cell; if it is not, the ray stops on the cell's box up to the thing's height.
   * @param {object} out receives { t, x, y, z, nx, ny, nz, what } — what: 'wall' | 'door' | 'prop' | 'casing' |
   *   'wreck' | 'floor' | 'ceiling'
   * @returns {boolean} false if nothing is hit within `max`
   */
  raycast(ox, oy, oz, dx, dy, dz, max, out) {
    let cx = Math.floor(ox);
    let cz = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - ox : ox - cx) * tDeltaX : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? cz + 1 - oz : oz - cz) * tDeltaZ : Infinity;
    let t = 0;
    let axis = -1; // which wall of the cell the ray came in through: 0 = an X face, 1 = a Z face
    // the thing this ray has already been found to miss: one that fills several cells is asked about once
    let missed = -1;
    const hit = (tt, nx, ny, nz, what) => {
      out.t = tt;
      out.x = ox + dx * tt;
      out.y = oy + dy * tt;
      out.z = oz + dz * tt;
      out.nx = nx;
      out.ny = ny;
      out.nz = nz;
      out.what = what;
      return true;
    };
    for (let guard = 0; guard < 1024; guard++) {
      if (t > max) return false;
      const tExit = Math.min(tMaxX, tMaxZ);
      const occ = this.occluder(cx, cz);
      if (occ > 0) {
        const kind = this.inside(cx, cz) ? this.kind[cz * this.w + cx] : KIND.ROCK;
        const what = kind === KIND.WALL || kind === KIND.ROCK ? 'wall' : kind === KIND.DOOR ? 'door' : 'prop';
        const shape = what === 'prop' && this.shapes ? this.shapes.at(cz * this.w + cx) : -1;
        if (shape >= 0) {
          // its own shape: asked wherever the ray is in the cell — standing on a crate, the cell is the ray's first
          if (shape !== missed) {
            SHAPE_HIT.what = 'prop';
            if (this.shapes.ray(shape, ox, oy, oz, dx, dy, dz, SHAPE_HIT) && SHAPE_HIT.t <= max)
              return hit(SHAPE_HIT.t, SHAPE_HIT.nx, SHAPE_HIT.ny, SHAPE_HIT.nz, SHAPE_HIT.what);
            missed = shape;
          }
        } else if (axis >= 0) {
          const yIn = oy + dy * t;
          const nx = axis === 0 ? -stepX : 0;
          const nz = axis === 1 ? -stepZ : 0;
          if (yIn < occ) {
            if (yIn > 0) return hit(t, nx, 0, nz, what);
          } else if (dy < 0) {
            const tTop = (occ - oy) / dy;
            if (tTop <= tExit && tTop <= max) return hit(tTop, 0, 1, 0, what);
          }
        }
      }
      // A low place — a doorway, the mouth of a tunnel — come to from a higher one, ABOVE its ceiling: the round
      // has met what is built over the opening, on the face it came in through. (Until 16 November 2026 it was
      // said to have met the ceiling where it had passed that HEIGHT, out in the open before the opening — or,
      // coming down, to have flown on through what is over the door.)
      if (axis >= 0 && this.inside(cx, cz)) {
        const low = this.ceil[cz * this.w + cx];
        if (low > 0 && oy + dy * t > low + 1e-6)
          return hit(t, axis === 0 ? -stepX : 0, 0, axis === 1 ? -stepZ : 0, 'wall');
      }
      // floor and ceiling of this cell
      if (dy < 0) {
        const tFloor = -oy / dy;
        if (tFloor <= tExit) return tFloor <= max ? hit(tFloor, 0, 1, 0, 'floor') : false;
      } else if (dy > 0 && this.inside(cx, cz)) {
        const ceil = this.ceil[cz * this.w + cx];
        if (ceil > 0) {
          const tCeil = (ceil - oy) / dy;
          if (tCeil <= tExit) return tCeil <= max ? hit(Math.max(tCeil, 0), 0, -1, 0, 'ceiling') : false;
        }
      }
      if (tExit === Infinity) return false;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        axis = 0;
      } else {
        cz += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        axis = 1;
      }
    }
    return false;
  }

  /** Can a round body go straight from a to b without touching anything? Used to shorten planned routes. */
  clearWalk(ax, az, bx, bz, radius, flying = false) {
    const dx = bx - ax;
    const dz = bz - az;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
    for (let s = 1; s <= steps; s++) {
      const x = ax + (dx * s) / steps;
      const z = az + (dz * s) / steps;
      const x0 = Math.floor(x - radius);
      const x1 = Math.floor(x + radius);
      const z0 = Math.floor(z - radius);
      const z1 = Math.floor(z + radius);
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) if (!this.walkable(cx, cz, flying)) return false;
    }
    return true;
  }

  /** The walkable cell nearest to (x, z), searching outwards up to `reach` cells; null if there is none. */
  nearestWalkable(x, z, flying = false, reach = 8) {
    if (this.walkable(x, z, flying)) return [x, z];
    for (let r = 1; r <= reach; r++) {
      let best = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.walkable(x + dx, z + dz, flying)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = [x + dx, z + dz];
          }
        }
      if (best) return best;
    }
    return null;
  }

  // cells that touch something solid cost a little more, which keeps routes off the walls
  _nearSolid() {
    if (this._near) return this._near;
    const near = new Uint8Array(this.w * this.h);
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++)
        if (
          !this.walkable(x - 1, z) ||
          !this.walkable(x + 1, z) ||
          !this.walkable(x, z - 1) ||
          !this.walkable(x, z + 1)
        )
          near[z * this.w + x] = 1;
    this._near = near;
    return near;
  }

  /** Call after changing what stands where (props added), so that routes are planned on fresh data. */
  changed() {
    this._near = null;
  }

  /**
   * A* from one cell to another, eight directions, never cutting a corner.
   * @returns {number[] | null} cell centres as a flat list [x0, z0, x1, z1, …] from the step after the start to the
   *   goal, or null if there is no way. If the goal cell cannot be stood on, the nearest cell that can is used.
   */
  path(sx, sz, gx, gz, flying = false) {
    if (!this.walkable(sx, sz, flying)) {
      const s = this.nearestWalkable(sx, sz, flying, 3);
      if (!s) return null;
      [sx, sz] = s;
    }
    const goal = this.nearestWalkable(gx, gz, flying);
    if (!goal) return null;
    [gx, gz] = goal;
    const w = this.w;
    const start = sz * w + sx;
    const target = gz * w + gx;
    if (start === target) return [gx + 0.5, gz + 0.5];

    const run = ++this._run;
    const g = this._g;
    const from = this._from;
    const stamp = this._stamp;
    const closed = this._closed;
    const near = this._nearSolid();
    const heap = this._heap;
    heap.length = 0;

    const push = (f, i) => {
      let k = heap.length;
      heap.push(f, i);
      while (k > 0) {
        const parent = ((k / 2 - 1) >> 1) * 2;
        if (heap[parent] <= f) break;
        heap[k] = heap[parent];
        heap[k + 1] = heap[parent + 1];
        k = parent;
      }
      heap[k] = f;
      heap[k + 1] = i;
    };
    const pop = () => {
      const top = heap[1];
      const f = heap[heap.length - 2];
      const i = heap[heap.length - 1];
      heap.length -= 2;
      const n = heap.length;
      if (n > 0) {
        let k = 0;
        for (;;) {
          let child = k * 2 + 2;
          if (child >= n) break;
          if (child + 2 < n && heap[child + 2] < heap[child]) child += 2;
          if (heap[child] >= f) break;
          heap[k] = heap[child];
          heap[k + 1] = heap[child + 1];
          k = child;
        }
        heap[k] = f;
        heap[k + 1] = i;
      }
      return top;
    };
    const estimate = (x, z) => {
      const ax = Math.abs(x - gx);
      const az = Math.abs(z - gz);
      return ax > az ? ax + (SQRT2 - 1) * az : az + (SQRT2 - 1) * ax;
    };

    g[start] = 0;
    from[start] = -1;
    stamp[start] = run;
    push(estimate(sx, sz), start);

    while (heap.length) {
      const cur = pop();
      if (closed[cur] === run) continue;
      closed[cur] = run;
      if (cur === target) break;
      const cx = cur % w;
      const cz = (cur - cx) / w;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.walkable(nx, nz, flying)) continue;
          if (dx && dz && (!this.walkable(cx + dx, cz, flying) || !this.walkable(cx, cz + dz, flying))) continue;
          const ni = nz * w + nx;
          if (closed[ni] === run) continue;
          const cost = g[cur] + (dx && dz ? SQRT2 : 1) + (!flying && near[ni] ? 0.7 : 0);
          if (stamp[ni] === run && cost >= g[ni]) continue;
          g[ni] = cost;
          from[ni] = cur;
          stamp[ni] = run;
          push(cost + estimate(nx, nz), ni);
        }
    }
    if (closed[target] !== run) return null;

    const out = [];
    for (let i = target; i !== start; i = from[i]) {
      const x = i % w;
      out.push((i - x) / w + 0.5, x + 0.5);
    }
    out.reverse();
    return out;
  }
}
