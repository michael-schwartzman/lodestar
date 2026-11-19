// An outline pushed out into a solid — what THREE.ExtrudeGeometry does, without it.
//
// Why: three is in the script every player downloads, and what a model of the second look uses of it is added
// THERE, not to the look's own file. ExtrudeGeometry brings three's shapes, paths, curves and its triangulator
// with it: 28 kB, for the sake of a sentry's panels and a knife's blade that only `look=2` draws. (Found on 16
// November 2026 by the lock that holds that script under 870 kB — test/second/look.test.mjs — when the sentry's
// second pass came in: 886.7 kB.) What those models need is small: an outline of straight lines and quadratic
// curves, pushed out, with its edges taken off. That is this file; test/unit/extrude.test.mjs pins it, and that
// nothing in src/gfx/next or src/look reaches for the class again.
//
// Made to be dropped in where the class was: `new Outline()` for `new THREE.Shape()`, `extrude(outline, options)`
// for `new THREE.ExtrudeGeometry(shape, options)` — the same option names, the same solid: its caps are the
// outline itself, at z = −bevelThickness and depth + bevelThickness; its walls stand out from the outline by
// bevelSize, from z = 0 to depth; the bevel is a quarter turn between the two.
import * as THREE from 'three';

/** An outline: straight lines and quadratic curves from point to point, as three's Shape draws them. */
export class Outline {
  constructor() {
    /** each piece: its end, and — for a curve — the point it is pulled towards */
    this.pieces = [];
    this.start = null;
  }

  moveTo(x, y) {
    this.start = [x, y];
    return this;
  }

  lineTo(x, y) {
    this.pieces.push({ to: [x, y] });
    return this;
  }

  quadraticCurveTo(cx, cy, x, y) {
    this.pieces.push({ to: [x, y], pull: [cx, cy] });
    return this;
  }

  /** The outline as points, a curve as `curveSegments` straight pieces; anticlockwise, no point twice. */
  points(curveSegments = 12) {
    if (!this.start) return [];
    const out = [this.start];
    let from = this.start;
    for (const piece of this.pieces) {
      if (piece.pull) {
        for (let n = 1; n <= curveSegments; n++) {
          const t = n / curveSegments;
          const a = (1 - t) * (1 - t);
          const b = 2 * (1 - t) * t;
          const c = t * t;
          out.push([
            a * from[0] + b * piece.pull[0] + c * piece.to[0],
            a * from[1] + b * piece.pull[1] + c * piece.to[1],
          ]);
        }
      } else out.push(piece.to);
      from = piece.to;
    }
    return tidy(out);
  }
}

/** Takes out points that are where the one before is (and a last that is where the first is); turns it anticlockwise. */
function tidy(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= 1e-9) out.pop();
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area < 0 ? out.reverse() : out;
}

/** Triangles of an anticlockwise outline, as index triples: ears cut off one at a time. */
export function triangulate(points) {
  const left = points.map((_, i) => i);
  const out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = points.length * points.length + 8;
  while (left.length > 3 && guard-- > 0) {
    let cut = -1;
    for (let k = 0; k < left.length && cut < 0; k++) {
      const a = points[left[(k + left.length - 1) % left.length]];
      const b = points[left[k]];
      const c = points[left[(k + 1) % left.length]];
      // an ear: it turns the way the outline does, and no other corner lies in it
      if (cross(a, b, c) <= 1e-14) continue;
      let clear = true;
      for (const i of left) {
        const p = points[i];
        if (p === a || p === b || p === c) continue;
        if (inside(p, a, b, c)) {
          clear = false;
          break;
        }
      }
      if (clear) cut = k;
    }
    // an outline that crosses itself has no ear to offer: cut anywhere rather than go round for ever
    if (cut < 0) cut = 0;
    out.push([left[(cut + left.length - 1) % left.length], left[cut], left[(cut + 1) % left.length]]);
    left.splice(cut, 1);
  }
  if (left.length === 3) out.push([left[0], left[1], left[2]]);
  return out;
}

/**
 * The solid. Not indexed, with a flat normal to every triangle (as ExtrudeGeometry's are); no texture
 * coordinates — no model here has any.
 * @param {Outline | number[][]} outline
 * @param {object} [o]
 * @param {number} [o.depth=1]
 * @param {boolean} [o.bevelEnabled=true]
 * @param {number} [o.bevelThickness=0.2] how far the caps stand beyond the walls' ends
 * @param {number} [o.bevelSize]          how far the walls stand out from the outline (left out: bevelThickness − 0.1, as three has it)
 * @param {number} [o.bevelSegments=3]
 * @param {number} [o.curveSegments=12]
 * @returns {THREE.BufferGeometry}
 */
export function extrude(
  outline,
  { depth = 1, bevelEnabled = true, bevelThickness = 0.2, bevelSize, bevelSegments = 3, curveSegments = 12 } = {},
) {
  const points = Array.isArray(outline) ? tidy(outline) : outline.points(curveSegments);
  const geometry = new THREE.BufferGeometry();
  const count = points.length;
  if (count < 3) {
    // an outline of nothing is a solid of nothing — but still a solid: it has its (empty) lists
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
    return geometry;
  }
  const thick = bevelEnabled ? bevelThickness : 0;
  const size = bevelEnabled ? (bevelSize ?? bevelThickness - 0.1) : 0;
  const steps = bevelEnabled && (thick > 0 || size > 0) ? Math.max(1, bevelSegments | 0) : 0;

  // which way each corner moves as the outline is let out: along the mitre of its two edges
  const out = points.map((p, i) => {
    const a = points[(i + count - 1) % count];
    const b = points[(i + 1) % count];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const n1 = [(p[1] - a[1]) / la, -(p[0] - a[0]) / la];
    const n2 = [(b[1] - p[1]) / lb, -(b[0] - p[0]) / lb];
    const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    // a corner that doubles back on itself has no mitre: it is let out along its first edge's normal
    if (k < 0.2) return n1;
    return [(n1[0] + n2[0]) / k, (n1[1] + n2[1]) / k];
  });

  // the rings, from the front cap to the back one: [how far let out, z]
  const rings = [];
  for (let t = 0; t < steps; t++) {
    const turn = ((t / steps) * Math.PI) / 2;
    rings.push([size * Math.sin(turn), -thick * Math.cos(turn)]);
  }
  rings.push([size, 0], [size, depth]);
  for (let t = steps - 1; t >= 0; t--) {
    const turn = ((t / steps) * Math.PI) / 2;
    rings.push([size * Math.sin(turn), depth + thick * Math.cos(turn)]);
  }

  const at = (ring, i) => [points[i][0] + out[i][0] * ring[0], points[i][1] + out[i][1] * ring[0], ring[1]];
  const position = [];
  const tri = (a, b, c) => position.push(...a, ...b, ...c);
  const caps = triangulate(points);
  // the front cap faces −z, the back one +z
  for (const [a, b, c] of caps) tri(at(rings[0], a), at(rings[0], c), at(rings[0], b));
  for (let r = 0; r + 1 < rings.length; r++)
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const a = at(rings[r], i);
      const b = at(rings[r], j);
      const c = at(rings[r + 1], j);
      const d = at(rings[r + 1], i);
      tri(a, b, c);
      tri(a, c, d);
    }
  const back = rings[rings.length - 1];
  for (const [a, b, c] of caps) tri(at(back, a), at(back, b), at(back, c));

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
  geometry.computeVertexNormals();
  return geometry;
}
