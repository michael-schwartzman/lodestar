// Small helpers for building models out of painted primitives.
// Every model in the game is geometry with five attributes — position, normal, color (its paint), surf (how
// rough it is, and how much like metal) and mat (what it is made of: a layer of the catalogue in gfx/matter.js,
// which only the second look draws) — and no texture coordinates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { layerOf, matterOf } from './matter.js';
import { chamferBox, surfaceOf } from './shade.js';

const _color = new THREE.Color();
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * How finely things are built. Set once, before any model is made (main.js does it from the detail level).
 * bevel: boxes have their edges taken off, so that an edge catches the light. round: how many more sides
 * cylinders and balls get than their builders asked for. matter: the second look is on (`look=2`) — every part
 * also carries what it is made of (`mat`); without it geometry is exactly what it was before there was one.
 */
export const geoDetail = { bevel: true, round: 1.5, matter: false };
export function setGeoDetail({ bevel = geoDetail.bevel, round = geoDetail.round, matter = geoDetail.matter } = {}) {
  geoDetail.bevel = bevel;
  geoDetail.round = round;
  geoDetail.matter = matter;
}

/** Above this angle between the normals at two corners of a triangle, the triangle is the worn edge of something. */
const EDGE_TURN = Math.cos((70 * Math.PI) / 180);

/**
 * What is added to the number of a material that was GUESSED — its part did not say what it is made of, and the
 * rule (matterOf) gave it one from its colour. The shader does not see it: it reads the whole number, and the half
 * that marks an edge. It is there to be counted (guessedShare), so that "everything has a material" cannot be
 * true of a model nobody named.
 */
export const GUESSED = 0.125;
const isGuess = (v) => {
  const f = v - Math.floor(v);
  return v >= 0 && Math.abs((f >= 0.5 ? f - 0.5 : f) - GUESSED) < 0.01;
};

/** How much of a model's material is a guess: the share of its corners whose material no builder named (0…1). */
export function guessedShare(geometry) {
  const mat = geometry.attributes.mat;
  if (!mat || !mat.count) return 0;
  let guessed = 0;
  for (let i = 0; i < mat.count; i++) if (isGuess(mat.array[i])) guessed++;
  return guessed / mat.count;
}

/**
 * Gives every vertex one colour. `bottom` and `top` scale its brightness by height, which fakes the way
 * things are darker near the ground.
 * `rough` (0 mirror … 1 chalk) and `metal` (0 paint, plastic, rubber … 1 bare metal) say what it is made of;
 * left out, they are guessed from the colour (shade.js surfaceOf): dark greys are steel, colours are paint.
 * `mat` names its material in the catalogue (gfx/matter.js: 'paint', 'steel', 'rubber', …); left out, that too
 * is guessed (matterOf). A name that is not in the catalogue throws. It is written on the vertices only in the
 * second look (`geoDetail.matter`).
 * @param {THREE.BufferGeometry} geometry
 * @param {number|string|THREE.Color} color
 */
export function paint(geometry, color, { bottom = 1, top = 1, rough, metal, mat } = {}) {
  const position = geometry.attributes.position;
  const out = new Float32Array(position.count * 3);
  const surf = new Float32Array(position.count * 2);
  _color.set(color);
  const guess = surfaceOf(_color.r, _color.g, _color.b);
  const r = rough ?? guess.rough;
  const m = metal ?? guess.metal;
  // a wrong name is a mistake in a model whichever look is on; a material nobody named is marked as the guess it is
  const layer =
    mat === undefined
      ? geoDetail.matter
        ? layerOf(matterOf(_color.r, _color.g, _color.b, r, m)) + GUESSED
        : 0
      : layerOf(mat);
  geometry.computeBoundingBox();
  const y0 = geometry.boundingBox.min.y;
  const span = Math.max(geometry.boundingBox.max.y - y0, 1e-6);
  for (let i = 0; i < position.count; i++) {
    const k = bottom + (top - bottom) * ((position.getY(i) - y0) / span);
    out[i * 3] = _color.r * k;
    out[i * 3 + 1] = _color.g * k;
    out[i * 3 + 2] = _color.b * k;
    surf[i * 2] = r;
    surf[i * 2 + 1] = m;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 3));
  geometry.setAttribute('surf', new THREE.BufferAttribute(surf, 2));
  if (geoDetail.matter)
    geometry.setAttribute('mat', new THREE.BufferAttribute(new Float32Array(position.count).fill(layer), 1));
  return geometry;
}

/** Moves, turns and scales a geometry in place. `rot` is XYZ Euler angles in radians. */
export function place(geometry, { at = [0, 0, 0], rot = [0, 0, 0], scale = 1 } = {}) {
  _pos.set(at[0], at[1], at[2]);
  _quat.setFromEuler(_euler.set(rot[0], rot[1], rot[2]));
  if (typeof scale === 'number') _scale.set(scale, scale, scale);
  else _scale.set(scale[0], scale[1], scale[2]);
  geometry.applyMatrix4(_matrix.compose(_pos, _quat, _scale));
  return geometry;
}

/**
 * The bare shape of a box: bevelled (see shade.js chamferBox) unless the detail level, or the caller, says not.
 * @param {number|false} [bevel] the size of the bevel in metres; false for sharp edges; left out, it is sized to
 *   the box — a few millimetres on a small part, three centimetres on a container
 */
export function boxGeometry(w, h, d, bevel) {
  if (!geoDetail.bevel || bevel === false || bevel === 0) return new THREE.BoxGeometry(w, h, d);
  const smallest = Math.min(w, h, d);
  const size = bevel ?? Math.min(0.03, Math.max(0.003, smallest * 0.07));
  const { position, normal, index } = chamferBox(w, h, d, size);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** How many sides something round gets at this detail level, when its builder asked for `segments`. */
export const sides = (segments) => Math.min(48, Math.max(3, Math.round(segments * geoDetail.round)));

/** A painted box, centred on `at`. `shade` may also carry `rough`, `metal` and `bevel`. */
export function box(w, h, d, color, at, rot, shade) {
  return place(paint(boxGeometry(w, h, d, shade?.bevel), color, shade), { at, rot });
}

/** A painted cylinder standing on its axis (Y), centred on `at`. */
export function cyl(radiusTop, radiusBottom, height, color, at, rot, segments = 12, shade) {
  return place(
    paint(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, sides(segments), 1, false), color, shade),
    { at, rot },
  );
}

/** A painted ball, centred on `at`. */
export function ball(radius, color, at, segments = 10, shade) {
  const around = sides(segments);
  return place(paint(new THREE.SphereGeometry(radius, around, Math.max(6, Math.round(around * 0.7))), color, shade), {
    at,
  });
}

/**
 * Adds a half to the material of every triangle whose corners face more than 70° apart — the strip where a box's
 * edge was taken off, or its corner. A round thing's neighbouring facets turn far less and are left alone.
 * The geometry must not be indexed. Doing it twice changes nothing.
 */
function markEdges(g) {
  const n = g.attributes.normal.array;
  const mat = g.attributes.mat.array;
  for (let i = 0; i + 2 < mat.length; i += 3) {
    // not what has no material, and not what is marked already (the half; a guess's eighth is not that mark)
    if (mat[i] < 0 || mat[i] - Math.floor(mat[i]) >= 0.5) continue;
    const a = i * 3;
    const ab = n[a] * n[a + 3] + n[a + 1] * n[a + 4] + n[a + 2] * n[a + 5];
    const bc = n[a + 3] * n[a + 6] + n[a + 4] * n[a + 7] + n[a + 5] * n[a + 8];
    const ca = n[a + 6] * n[a] + n[a + 7] * n[a + 1] + n[a + 8] * n[a + 2];
    if (Math.min(ab, bc, ca) < EDGE_TURN) {
      mat[i] += 0.5;
      mat[i + 1] += 0.5;
      mat[i + 2] += 0.5;
    }
  }
}

/**
 * Joins painted geometries into one with position, normal, color and surf — and, in the second look, mat: what
 * each triangle is made of, plus a half where the triangle is a bevel or a corner, the edge of something, which
 * is where a finish wears through first. Anything else is dropped.
 * @param {THREE.BufferGeometry[]} parts
 */
export function merge(parts) {
  const KEPT = geoDetail.matter
    ? ['position', 'normal', 'color', 'surf', 'mat']
    : ['position', 'normal', 'color', 'surf'];
  const list = parts.filter(Boolean).map((part) => {
    const g = part.index ? part.toNonIndexed() : part;
    for (const name of Object.keys(g.attributes)) if (!KEPT.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) paint(g, 0xffffff);
    if (!g.attributes.surf) {
      // painted by hand, vertex by vertex: guess what each vertex is made of from its own colour
      const color = g.attributes.color;
      const surf = new Float32Array(color.count * 2);
      for (let i = 0; i < color.count; i++) {
        const s = surfaceOf(color.getX(i), color.getY(i), color.getZ(i));
        surf[i * 2] = s.rough;
        surf[i * 2 + 1] = s.metal;
      }
      g.setAttribute('surf', new THREE.BufferAttribute(surf, 2));
    }
    if (geoDetail.matter) {
      if (!g.attributes.mat) {
        // …and its material likewise, a triangle at a time, from its first corner: the three must agree
        const color = g.attributes.color;
        const surf = g.attributes.surf;
        const mat = new Float32Array(color.count);
        for (let i = 0; i < color.count; i += 3) {
          const layer =
            layerOf(matterOf(color.getX(i), color.getY(i), color.getZ(i), surf.getX(i), surf.getY(i))) + GUESSED;
          mat[i] = layer;
          if (i + 1 < color.count) mat[i + 1] = layer;
          if (i + 2 < color.count) mat[i + 2] = layer;
        }
        g.setAttribute('mat', new THREE.BufferAttribute(mat, 1));
      }
      markEdges(g);
    }
    return g;
  });
  if (!list.length) return new THREE.BufferGeometry();
  const out = mergeGeometries(list, false);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
