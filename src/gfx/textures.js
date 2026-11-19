// Every surface in the game is a canvas painted here, never an image file.
//
// The approach throughout: a small set of tileable value-noise fields (`pool`) is generated once per call and
// reused — with a different pixel offset per texture, so two surfaces never look like they share a seed — for the
// fine grain and the broad tonal drift almost every texture wants. On top of that, each texture draws its own
// crisp features (joints, rivets, stains, cracks) with the 2D canvas API. Scattered round features near a tile's
// edge are drawn again at ±size so nothing is cut off at the seam; long features (cracks) are instead kept inset
// from the edge, which sidesteps the seam question entirely.
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { lerp, smooth, clamp01 } from '../core/math.js';

/** Every key `makeTextures()` returns, in the order they are described in the design notes. */
export const TEXTURE_NAMES = Object.freeze([
  'concrete',
  'wallPanel',
  'hallWall',
  'asphalt',
  'dirt',
  'floorConcrete',
  'floorTile',
  'floorEpoxy',
  'floorPlate',
  'ceiling',
  'roof',
  'rock',
  'wear',
  'fence',
  'door',
  'flare',
  'glint',
  'puff',
  'spark',
  'scorch',
  'hole',
  'ring',
  'blob',
]);

// ---------------------------------------------------------------------------------------------
// small numeric & pixel helpers
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** A short, stable hash of a name into a seed for makeRng — so every texture's own RNG is independent. */
function seedFor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

/** A per-texture pixel offset into the shared noise pool, so reused fields do not look identical. */
function poolOffset(name, size) {
  const rng = makeRng(seedFor(`${name}:offset`));
  return [Math.floor(rng.next() * size), Math.floor(rng.next() * size)];
}

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v) | 0;

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * A tileable value-noise field as a flat [0,1] Float32Array of size*size, built from a few octaves.
 * Each octave is a lattice of `cellsX`×`cellsY` random values sampled with wrap-around indices, which is what
 * makes the result repeat with no seam at any size — the lattice itself is the period, not the canvas.
 */
function tileableField(rng, size, octaves) {
  const out = new Float32Array(size * size);
  let totalWeight = 0;
  for (const oct of octaves) {
    const nx = oct.cellsX ?? oct.cells;
    const ny = oct.cellsY ?? oct.cells;
    totalWeight += oct.weight;
    const lattice = new Float32Array(nx * ny);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * ny;
      const y0 = Math.floor(fy) % ny;
      const y1 = (y0 + 1) % ny;
      const ty = smooth(fy - Math.floor(fy));
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * nx;
        const x0 = Math.floor(fx) % nx;
        const x1 = (x0 + 1) % nx;
        const tx = smooth(fx - Math.floor(fx));
        const v00 = lattice[y0 * nx + x0];
        const v10 = lattice[y0 * nx + x1];
        const v01 = lattice[y1 * nx + x0];
        const v11 = lattice[y1 * nx + x1];
        out[row + x] += lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty) * oct.weight;
      }
    }
  }
  const inv = 1 / totalWeight;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/** Reads a tileable field at an (x, y) that may be fractional or outside [0, size) — it just wraps. */
function at(field, size, x, y) {
  const xi = Math.floor(((x % size) + size) % size);
  const yi = Math.floor(((y % size) + size) % size);
  return field[yi * size + xi];
}

// Three shared fields, reused by almost every tiling texture (each with its own offset and colour mapping):
// fine grain, medium blotches, and a very coarse tonal drift. Octave cell counts are in world-noise "cells" —
// fixed regardless of canvas size, so the pattern covers the same ground whether size is 512 or 256.
const FINE_OCTAVES = [
  { cells: 40, weight: 0.45 },
  { cells: 90, weight: 0.3 },
  { cells: 170, weight: 0.25 },
];
const MED_OCTAVES = [
  { cells: 5, weight: 0.5 },
  { cells: 11, weight: 0.3 },
  { cells: 23, weight: 0.2 },
];
const COARSE_OCTAVES = [
  { cells: 2, weight: 0.6 },
  { cells: 4, weight: 0.4 },
];

function makePool(size) {
  return {
    fine: tileableField(makeRng(seedFor('pool:fine')), size, FINE_OCTAVES),
    med: tileableField(makeRng(seedFor('pool:med')), size, MED_OCTAVES),
    coarse: tileableField(makeRng(seedFor('pool:coarse')), size, COARSE_OCTAVES),
  };
}

/** Fills the whole canvas with `base` [r,g,b] (0..1) scaled per pixel by `k(x, y)`, which should hover near 1. */
function paintBase(ctx, size, base, k) {
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const [r, g, b] = base;
  let p = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++, p += 4) {
      const m = k(x, y);
      data[p] = clampByte(r * m * 255);
      data[p + 1] = clampByte(g * m * 255);
      data[p + 2] = clampByte(b * m * 255);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Offsets to redraw a round feature at, so one that overlaps a tile edge still tiles with no cut-off. */
function wrapOffsets(x, y, r, size) {
  const left = x - r < 0;
  const right = x + r > size;
  const top = y - r < 0;
  const bottom = y + r > size;
  const list = [[0, 0]];
  if (left) list.push([size, 0]);
  if (right) list.push([-size, 0]);
  if (top) list.push([0, size]);
  if (bottom) list.push([0, -size]);
  if (left && top) list.push([size, size]);
  if (left && bottom) list.push([size, -size]);
  if (right && top) list.push([-size, size]);
  if (right && bottom) list.push([-size, -size]);
  return list;
}

/** A thin recessed groove (e.g. a panel joint), drawn so the seam itself can be a joint line with no special case. */
function groove(ctx, horizontal, at_, size, width, darkA = 0.3, liteA = 0.1) {
  ctx.fillStyle = `rgba(0,0,0,${darkA})`;
  if (horizontal) ctx.fillRect(0, at_, size, width);
  else ctx.fillRect(at_, 0, width, size);
  ctx.fillStyle = `rgba(255,255,255,${liteA})`;
  if (horizontal) ctx.fillRect(0, at_ + width, size, 1);
  else ctx.fillRect(at_ + width, 0, 1, size);
}

/** A handful of soft round stains/dots, scattered and safely wrapped at the tile edge. */
function scatter(ctx, rng, size, count, { rMin, rMax, color, aMin = 0.15, aMax = 0.4, soft = true }) {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(rMin, rMax);
    const a = rng.range(aMin, aMax);
    for (const [ox, oy] of wrapOffsets(x, y, r, size)) {
      const cx = x + ox;
      const cy = y + oy;
      if (soft) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${a})`);
        grad.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${a})`;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
    }
  }
}

/** A short jagged crack, kept inset from the tile edge so it never needs to cross a seam. */
function crack(ctx, rng, size, { margin, segments = 6, step, width = 1.2, alpha = 0.5, color = [10, 8, 6] }) {
  const cx = rng.range(margin, size - margin);
  const cy = rng.range(margin, size - margin);
  let x = cx;
  let y = cy;
  const dir0 = rng.range(0, TAU);
  let dir = dir0;
  ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < segments; i++) {
    // a mild pull back toward the starting heading stops the per-step randomness from ever
    // compounding into a closed spiral (real fractures wander but do not curl into a loop), while
    // still giving each crack its own jagged, irregular path
    dir += rng.signed() * 0.85 - (dir - dir0) * 0.25;
    x += Math.cos(dir) * step;
    y += Math.sin(dir) * step;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------
// texture finishing — every exported CanvasTexture passes through one of these
// ---------------------------------------------------------------------------------------------

/** @param {HTMLCanvasElement} canvas @param {number} metres @param {number} anisotropy @param {boolean} clampV */
function finishTile(canvas, metres, anisotropy, clampV) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.userData.metres = metres;
  tex.needsUpdate = true;
  return tex;
}

function finishImage(canvas, anisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// tiling surfaces
// ---------------------------------------------------------------------------------------------

// Exterior walls: cast concrete in 2 m panels (metres=4 → a joint every half tile), form-tie holes, rain
// streaks running down from the horizontal joints, a slight tint per panel.
function drawConcrete(ctx, size, pool) {
  const rng = makeRng(seedFor('concrete'));
  const [ox, oy] = poolOffset('concrete', size);
  const base = [0.5, 0.5, 0.48];
  paintBase(ctx, size, base, (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const med = at(pool.med, size, x + ox, y + oy);
    // a per-panel tint: which 2x2m panel this pixel sits in decides a small, consistent shift
    const panelX = Math.floor((x / size) * 2);
    const panelY = Math.floor((y / size) * 2);
    const panel = at(pool.coarse, size, panelX * 90 + ox, panelY * 90 + oy);
    return 1 + (fine - 0.5) * 0.14 + (med - 0.5) * 0.16 + (panel - 0.5) * 0.14;
  });
  const half = size / 2;
  for (const gx of [0, half]) groove(ctx, false, gx, size, Math.max(2, size / 220));
  for (const gy of [0, half]) groove(ctx, true, gy, size, Math.max(2, size / 220));
  // form-tie holes: a loose grid, two per panel, nudged so they do not look machine-placed
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      for (let i = 0; i < 2; i++) {
        const x = (px + 0.3 + rng.range(-0.08, 0.08) + i * 0.4) * half;
        const y = (py + 0.5 + rng.range(-0.25, 0.25)) * half;
        const r = size * 0.012;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.6, 0, TAU);
        ctx.stroke();
      }
    }
  }
  // rain streaks hanging from each horizontal joint
  for (const gy of [0, half]) {
    const streaks = Math.max(4, Math.round(10 * (size / 512)));
    for (let i = 0; i < streaks; i++) {
      const x = rng.range(0, size);
      const len = rng.range(half * 0.25, half * 0.85);
      const w = rng.range(1.2, 3.2) * (size / 512);
      const a = rng.range(0.05, 0.16);
      const grad = ctx.createLinearGradient(x, gy, x, gy + len);
      grad.addColorStop(0, `rgba(10,12,10,${a})`);
      grad.addColorStop(1, 'rgba(10,12,10,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - w / 2, gy, w, len);
    }
  }
  scatter(ctx, rng, size, Math.round(3 * (size / 512) ** 2), {
    rMin: size * 0.04,
    rMax: size * 0.1,
    color: [40, 38, 34],
    aMin: 0.04,
    aMax: 0.1,
  });
}

// Interior walls: painted panels on a 2 m module, a dark kick strip at the floor, a muted teal line at ~1.1 m,
// the odd vent or hatch, scuffs. v=0 is the floor (bottom of the canvas); the top rows stay plain so the texture
// can be clamped upward on taller walls with no seam.
function drawWallPanel(ctx, size, pool) {
  const rng = makeRng(seedFor('wallPanel'));
  const [ox, oy] = poolOffset('wallPanel', size);
  const base = [0.56, 0.58, 0.53];
  paintBase(ctx, size, base, (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const med = at(pool.med, size, x + ox, y + oy);
    // fade all variation out over the top ~14% of the canvas (v near 1) so a clamped stretch stays plain
    const topFade = clamp01((y - size * 0.0) / (size * 0.14));
    const amt = lerp(0.04, 1, topFade);
    return 1 + ((fine - 0.5) * 0.1 + (med - 0.5) * 0.12) * amt;
  });
  const half = size / 2;
  for (const gx of [0, half]) groove(ctx, false, gx, size, Math.max(2, size / 240), 0.22, 0.08);
  // kick strip: bottom 15 cm of a 4 m tile
  const kick = size * (0.15 / 4);
  const kg = ctx.createLinearGradient(0, size - kick - size * 0.01, 0, size);
  kg.addColorStop(0, 'rgba(0,0,0,0)');
  kg.addColorStop(1, 'rgba(22,24,23,0.78)');
  ctx.fillStyle = kg;
  ctx.fillRect(0, size - kick - size * 0.01, size, kick + size * 0.01);
  // a muted teal line at 1.1 m
  const lineY = size * (1 - 1.1 / 4);
  ctx.fillStyle = 'rgba(58,110,104,0.65)';
  ctx.fillRect(0, lineY, size, Math.max(2, size * 0.009));
  // one vent, one hatch, placed away from the very top band
  const ventX = rng.range(size * 0.1, size * 0.4);
  const ventY = rng.range(size * 0.3, size * 0.8);
  drawVent(ctx, ventX, ventY, size * 0.16, size * 0.1);
  const hatchX = rng.range(size * 0.55, size * 0.85);
  const hatchY = rng.range(size * 0.3, size * 0.75);
  drawHatch(ctx, hatchX, hatchY, size * 0.12, size * 0.16);
  // low scuffs
  scatter(ctx, rng, size, Math.round(4 * (size / 512) ** 2), {
    rMin: size * 0.015,
    rMax: size * 0.05,
    color: [30, 28, 26],
    aMin: 0.06,
    aMax: 0.16,
  });
}

function drawVent(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(20,20,20,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  const slats = 5;
  for (let i = 1; i < slats; i++) {
    const sy = y + (h / slats) * i;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.08, sy);
    ctx.lineTo(x + w * 0.92, sy);
    ctx.stroke();
  }
}

function drawHatch(ctx, x, y, w, h) {
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, w * 0.04);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + w * 0.08, y + h * 0.06, w * 0.84, h * 0.1);
  ctx.fillStyle = 'rgba(20,20,20,0.6)';
  ctx.beginPath();
  ctx.arc(x + w * 0.5, y + h * 0.55, w * 0.05, 0, TAU);
  ctx.fill();
}

// The cascade hall's walls: corrugated metal cladding (ribs every 25 cm) above a 1.2 m concrete upstand with a
// yellow-black hazard band on top of the upstand. Same clamp-to-top rule as wallPanel.
function drawHallWall(ctx, size, pool) {
  const rng = makeRng(seedFor('hallWall'));
  const [ox, oy] = poolOffset('hallWall', size);
  const upstandTop = size * (1 - 1.2 / 4); // canvas y where the concrete upstand begins (below this)
  const ribWidth = size / 16; // 25 cm of a 4 m tile
  const img = ctx.createImageData(size, size);
  const data = img.data;
  let p = 0;
  for (let y = 0; y < size; y++) {
    // weathering streaks fade to nothing by the top rows, keeping the clamped area plain
    const topFade = clamp01(y / (size * 0.12));
    for (let x = 0; x < size; x++, p += 4) {
      let r, g, b;
      if (y >= upstandTop) {
        const fine = at(pool.fine, size, x, y);
        const med = at(pool.med, size, x + ox, y + oy);
        const k = 1 + (fine - 0.5) * 0.14 + (med - 0.5) * 0.1;
        r = 0.46 * k;
        g = 0.46 * k;
        b = 0.44 * k;
      } else {
        const rib = 0.5 + 0.5 * Math.cos((x / ribWidth) * TAU);
        const shade = Math.pow(Math.max(0, rib), 2.2) * 0.38 + 0.48;
        const streak = at(pool.fine, size, x + ox * 2, y) * 0.1 * topFade;
        const k = shade - streak;
        r = 0.47 * k;
        g = 0.5 * k;
        b = 0.52 * k;
      }
      data[p] = clampByte(r * 255);
      data[p + 1] = clampByte(g * 255);
      data[p + 2] = clampByte(b * 255);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // hazard band on top of the upstand: diagonal yellow/black, period divides the tile width evenly
  const bandH = size * 0.045;
  const stripe = size / 32;
  for (let x = 0; x < size; x += 2) {
    const k = Math.floor((x + upstandTop) / stripe) % 2;
    ctx.fillStyle = k ? 'rgba(18,15,8,0.92)' : 'rgba(214,176,48,0.92)';
    ctx.fillRect(x, upstandTop - bandH, 2, bandH);
  }
  groove(ctx, true, upstandTop, size, Math.max(2, size / 200), 0.4, 0.05);
  scatter(ctx, rng, size, Math.round(3 * (size / 512) ** 2), {
    rMin: size * 0.02,
    rMax: size * 0.05,
    color: [20, 18, 16],
    aMin: 0.08,
    aMax: 0.2,
  });
}

// The yard's hardstanding and road: dark asphalt, aggregate speckle, tar-sealed cracks, oil stains, tyre arcs.
function drawAsphalt(ctx, size, pool) {
  const rng = makeRng(seedFor('asphalt'));
  const [ox, oy] = poolOffset('asphalt', size);
  paintBase(ctx, size, [0.33, 0.33, 0.34], (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const med = at(pool.med, size, x + ox, y + oy);
    return 1 + (fine - 0.5) * 0.3 + (med - 0.5) * 0.14;
  });
  // faint tyre arc: a seamless (period divides size) wandering band — a second harmonic breaks up the
  // perfect-sine look so it does not read as a mathematical wave when tiled.
  ctx.strokeStyle = 'rgba(8,8,9,0.07)';
  ctx.lineWidth = size * 0.018;
  for (const yc of [size * 0.37]) {
    ctx.beginPath();
    for (let x = 0; x <= size; x += size / 64) {
      const a = (x / size) * TAU;
      const y = yc + Math.sin(a) * size * 0.045 + Math.sin(a * 3 + 1.3) * size * 0.012;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const cracks = Math.max(2, Math.round(5 * (size / 512) ** 2));
  for (let i = 0; i < cracks; i++) {
    crack(ctx, rng, size, { margin: size * 0.1, segments: 7, step: size * 0.035, width: size * 0.004, alpha: 0.55 });
  }
  scatter(ctx, rng, size, Math.round(3 * (size / 512) ** 2), {
    rMin: size * 0.02,
    rMax: size * 0.06,
    color: [12, 10, 8],
    aMin: 0.15,
    aMax: 0.3,
  });
}

// Ground outside the fence: compacted sand and gravel, pebbles, darker patches, tiny dry scrub tufts.
function drawDirt(ctx, size, pool) {
  const rng = makeRng(seedFor('dirt'));
  const [ox, oy] = poolOffset('dirt', size);
  paintBase(ctx, size, [0.47, 0.41, 0.33], (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const med = at(pool.med, size, x + ox, y + oy);
    const coarse = at(pool.coarse, size, x + ox, y + oy);
    return 1 + (fine - 0.5) * 0.22 + (med - 0.5) * 0.26 + (coarse - 0.5) * 0.08;
  });
  scatter(ctx, rng, size, Math.round(60 * (size / 512) ** 2), {
    rMin: size * 0.004,
    rMax: size * 0.016,
    color: [70, 62, 50],
    aMin: 0.25,
    aMax: 0.55,
    soft: false,
  });
  scatter(ctx, rng, size, Math.round(10 * (size / 512) ** 2), {
    rMin: size * 0.03,
    rMax: size * 0.09,
    color: [60, 50, 38],
    aMin: 0.08,
    aMax: 0.18,
  });
  // tufts: a few short dark-green strokes
  const tufts = Math.max(3, Math.round(14 * (size / 512) ** 2));
  ctx.strokeStyle = 'rgba(58,60,30,0.4)';
  ctx.lineCap = 'round';
  for (let i = 0; i < tufts; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const s = size * rng.range(0.008, 0.02);
    ctx.lineWidth = Math.max(1, size * 0.0016);
    for (let b = 0; b < 3; b++) {
      const a = -Math.PI / 2 + rng.signed() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
      ctx.stroke();
    }
  }
}

// Indoor corridor floors: sealed concrete, saw-cut joints every 2 m, a faint sheen, scuffs along the middle.
function drawFloorConcrete(ctx, size, pool) {
  const rng = makeRng(seedFor('floorConcrete'));
  const [ox, oy] = poolOffset('floorConcrete', size);
  paintBase(ctx, size, [0.52, 0.52, 0.5], (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const med = at(pool.med, size, x + ox, y + oy);
    // a soft diagonal sheen, as if the seal reflects a little
    const sheen = 0.5 + 0.5 * Math.sin((x + y) * (TAU / size) + 0.6);
    return 1 + (fine - 0.5) * 0.16 + (med - 0.5) * 0.14 + (sheen - 0.5) * 0.07;
  });
  const half = size / 2;
  for (const gx of [0, half]) groove(ctx, false, gx, size, Math.max(2, size / 260), 0.22, 0.08);
  for (const gy of [0, half]) groove(ctx, true, gy, size, Math.max(2, size / 260), 0.22, 0.08);
  // scuffs clustered toward the centre, where feet actually pass
  const scuffs = Math.max(10, Math.round(26 * (size / 512) ** 2));
  for (let i = 0; i < scuffs; i++) {
    const x = rng.range(size * 0.2, size * 0.8);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.015, size * 0.05);
    const a = rng.range(0.1, 0.24);
    for (const [wx, wy] of wrapOffsets(x, y, r, size)) {
      const grad = ctx.createRadialGradient(x + wx, y + wy, 0, x + wx, y + wy, r);
      grad.addColorStop(0, `rgba(24,22,20,${a})`);
      grad.addColorStop(1, 'rgba(24,22,20,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + wx, y + wy, r, 0, TAU);
      ctx.fill();
    }
  }
}

// Control room and lobby: raised-access floor tiles, 0.5 m square (metres=2 → a 4x4 grid per repeat).
function drawFloorTile(ctx, size, pool) {
  const rng = makeRng(seedFor('floorTile'));
  const n = 4;
  const cell = size / n;
  // the odd tile a shade off
  const oddCount = rng.int(1, 2);
  const odd = new Set();
  while (odd.size < oddCount) odd.add(rng.int(0, n * n - 1));
  paintBase(ctx, size, [0.53, 0.52, 0.49], (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    // Subtle so a repeat of this (necessarily fixed) position across many 2 m tiles does not read as a
    // deliberate checkerboard pattern.
    const tint = odd.has(iy * n + ix) ? 0.95 : 1;
    return (1 + (fine - 0.5) * 0.08) * tint;
  });
  for (let i = 0; i <= n; i++) {
    groove(ctx, false, i * cell, size, Math.max(1, size / 340), 0.3, 0.05);
    groove(ctx, true, i * cell, size, Math.max(1, size / 340), 0.3, 0.05);
  }
  // tiny corner screws at every grid intersection
  ctx.fillStyle = 'rgba(20,20,18,0.5)';
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const r = size * 0.006;
      ctx.beginPath();
      ctx.arc(ix * cell + cell * 0.12, iy * cell + cell * 0.12, r, 0, TAU);
      ctx.fill();
    }
  }
}

// The cascade hall floor: grey-green epoxy, smooth, faint roller marks, an occasional subtle drain cover.
function drawFloorEpoxy(ctx, size, pool) {
  const rng = makeRng(seedFor('floorEpoxy'));
  const [ox, oy] = poolOffset('floorEpoxy', size);
  paintBase(ctx, size, [0.4, 0.46, 0.42], (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const med = at(pool.med, size, x + ox, y + oy);
    // two overlapping roller passes, as if laid in strips at a slight angle to each other
    const roller = 0.5 + 0.5 * Math.sin((x * 0.6 + y) * (TAU / size) * 1.0);
    const roller2 = 0.5 + 0.5 * Math.sin((x * 0.2 - y * 0.9) * (TAU / size) * 1.6 + 1.7);
    return 1 + (fine - 0.5) * 0.11 + (med - 0.5) * 0.05 + (roller - 0.5) * 0.05 + (roller2 - 0.5) * 0.045;
  });
  const dx = size * 0.68;
  const dy = size * 0.3;
  const r = size * 0.042;
  ctx.fillStyle = 'rgba(30,34,31,0.22)';
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,22,20,0.2)';
  ctx.lineWidth = Math.max(1, size * 0.003);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx + Math.cos(a) * r * 0.85, dy + Math.sin(a) * r * 0.85);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(15,17,15,0.3)';
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, TAU);
  ctx.stroke();
  scatter(ctx, rng, size, Math.round(2 * (size / 512) ** 2), {
    rMin: size * 0.05,
    rMax: size * 0.12,
    color: [25, 30, 26],
    aMin: 0.03,
    aMax: 0.06,
  });
}

// Steel chequer plate (raised lozenges) for the loading dock and switchgear room, worn where walked.
function drawFloorPlate(ctx, size, pool) {
  const n = 10; // lozenges per 2 m tile, each way (~20 cm pitch)
  const cell = size / n;
  const [ox, oy] = poolOffset('floorPlate', size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  let p = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++, p += 4) {
      const ly = (((y % cell) + cell) % cell) / cell - 0.5;
      // an elongated diamond bump, offset every other row like real chequer plate
      const row = Math.floor(y / cell);
      const rowOx = row % 2 === 0 ? 0 : 0.5;
      const lx = ((((x / cell - rowOx) % 1) + 1) % 1) - 0.5;
      const d = Math.abs(lx) * 1.15 + Math.abs(ly) * 2.0;
      const bump = clamp01(1 - d);
      // a fixed upper-left light so each lozenge reads as a 3D bump, not a flat dot
      const facing = clamp01(0.5 - lx * 0.9 - ly * 0.5);
      // patchy foot-traffic wear from noise rather than one hard band, which would repeat as an
      // obvious lane every 2 m once tiled
      const wear = at(pool.med, size, x + ox, y + oy);
      const contrast = lerp(1, 0.6, wear * 0.6);
      const shade = 0.4 + bump * (0.08 + facing * 0.38) * contrast;
      const polish = wear * 0.05;
      const k = shade + polish;
      data[p] = clampByte(0.93 * k * 255);
      data[p + 1] = clampByte(0.95 * k * 255);
      data[p + 2] = clampByte(1.0 * k * 255);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Suspended ceiling tiles, 1 m square (metres=2 → a 2x2 grid per repeat), in a grid of thin metal tees.
function drawCeiling(ctx, size, pool) {
  const rng = makeRng(seedFor('ceiling'));
  paintBase(ctx, size, [0.52, 0.52, 0.49], (x, y) => {
    const fine = at(pool.fine, size, x, y);
    return 1 + (fine - 0.5) * 0.06;
  });
  const half = size / 2;
  for (const g of [0, half]) {
    groove(ctx, false, g, size, Math.max(2, size / 160), 0.1, 0.35);
    groove(ctx, true, g, size, Math.max(2, size / 160), 0.1, 0.35);
  }
  // One stained tile, kept faint: at only one quadrant per 2 m repeat, a strong stain would read as an
  // obvious checkerboard once tiled, so this stays subtle.
  const sx = rng.int(0, 1) * half;
  const sy = rng.int(0, 1) * half;
  const jx = rng.range(-0.08, 0.08) * half;
  const jy = rng.range(-0.08, 0.08) * half;
  const grad = ctx.createRadialGradient(
    sx + half * 0.5 + jx,
    sy + half * 0.65 + jy,
    0,
    sx + half * 0.5 + jx,
    sy + half * 0.65 + jy,
    half * 0.5,
  );
  grad.addColorStop(0, 'rgba(90,76,46,0.16)');
  grad.addColorStop(1, 'rgba(90,76,46,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(sx, sy, half, half);
}

// The building's flat roof: bitumen felt in 1 m lapped strips (metres=4 → four strips per repeat) with gravel
// speckle.
function drawRoof(ctx, size, pool) {
  const rng = makeRng(seedFor('roof'));
  const [ox, oy] = poolOffset('roof', size);
  const strips = 4;
  const stripH = size / strips;
  paintBase(ctx, size, [0.38, 0.35, 0.32], (x, y) => {
    const fine = at(pool.fine, size, x, y);
    const strip = Math.floor(y / stripH);
    const stripTint = at(pool.coarse, size, strip * 70 + ox, oy);
    return 1 + (fine - 0.5) * 0.26 + (stripTint - 0.5) * 0.12;
  });
  for (let i = 1; i < strips; i++) groove(ctx, true, i * stripH, size, Math.max(1, size / 260), 0.28, 0.06);
  // gravel speckle: dense small flecks of a few tones
  const flecks = Math.round(900 * (size / 512) ** 2);
  const tones = [
    [150, 140, 120],
    [90, 82, 70],
    [180, 160, 130],
  ];
  for (let i = 0; i < flecks; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.0015, size * 0.005);
    const c = tones[rng.int(0, tones.length - 1)];
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${rng.range(0.3, 0.6)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

// The cliff of the basin around the site: layered sandstone strata, fractured, cool brown-grey.
function drawRock(ctx, size, pool) {
  const rng = makeRng(seedFor('rock'));
  const strata = tileableField(makeRng(seedFor('rock:strata')), size, [
    { cellsX: 3, cellsY: 9, weight: 0.6 },
    { cellsX: 5, cellsY: 16, weight: 0.4 },
  ]);
  // Two octaves of warp (rather than one low-cell field) so the strata bends with several independent
  // wiggles per tile instead of one single coherent S-curve that would read as a repeating "landmark".
  const wobble = tileableField(makeRng(seedFor('rock:wobble')), size, [
    { cellsX: 7, cellsY: 4, weight: 0.6 },
    { cellsX: 13, cellsY: 7, weight: 0.4 },
  ]);
  paintBase(ctx, size, [0.41, 0.37, 0.33], (x, y) => {
    const warp = (at(wobble, size, x, y) - 0.5) * size * 0.035;
    const s = at(strata, size, x, y + warp);
    const fine = at(pool.fine, size, x, y);
    return 1 + (s - 0.5) * 0.4 + (fine - 0.5) * 0.14;
  });
  const cracks = Math.max(2, Math.round(4 * (size / 512) ** 2));
  for (let i = 0; i < cracks; i++) {
    crack(ctx, rng, size, {
      margin: size * 0.08,
      segments: 5,
      step: size * 0.045,
      width: size * 0.005,
      alpha: 0.4,
      color: [8, 7, 7],
    });
  }
}

// What paint and bare metal pick up with use, as light grey with darker marks: a mottle of grime, and scratches
// in every direction. The painted stand-in for the `wear` picture (src/gfx/art.js) when there is none.
function drawWear(ctx, size, pool) {
  const rng = makeRng(seedFor('wear'));
  paintBase(ctx, size, [0.8, 0.8, 0.8], (x, y) => {
    const broad = at(pool.med, size, x, y);
    const fine = at(pool.fine, size, x, y);
    return 1 + (broad - 0.5) * 0.16 + (fine - 0.5) * 0.1;
  });
  ctx.lineCap = 'round';
  const scratches = Math.round(90 * (size / 512));
  for (let i = 0; i < scratches; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const a = rng.next() * TAU;
    const len = size * rng.range(0.02, 0.11);
    ctx.strokeStyle = `rgba(40,40,42,${rng.range(0.12, 0.37)})`;
    ctx.lineWidth = Math.max(0.6, size * 0.0014 * rng.range(0.6, 1.6));
    // drawn again at each wrapped place, so that a scratch crossing the edge of the tile comes in at the other
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      ctx.stroke();
    }
  }
}

// Chain-link fence mesh as RGBA: galvanised wire diamonds with real transparency between the wires, plus a
// tension wire top and bottom. Always drawn at a fixed resolution (not the weak-phone `size`) so the wire keeps
// enough pixels to survive mipmapping and the game's alpha test even when every other texture is shrunk.
const FENCE_RES = 512;

function drawFence() {
  const size = FENCE_RES;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const cell = size / 13; // ~6 cm diamonds across a 1 m tile
  // Real chain-link wire would only cover ~10-20% of a cell, which box-filtered mipmaps average
  // below the game's 0.5 alpha-test threshold at any distance (the mesh would vanish, leaving only
  // the tension wires). Thickened a good deal past realism so it keeps enough coverage to survive
  // a couple of mip levels; it still reads as thin wire up close where it matters most.
  const thickness = 5.2;
  const aa = 1.1;
  const tension = size * 0.03;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  let p = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++, p += 4) {
      const u = x + y;
      const v = x - y;
      const mu = ((u % cell) + cell) % cell;
      const mv = ((v % cell) + cell) % cell;
      const du = Math.min(mu, cell - mu) / Math.SQRT2;
      const dv = Math.min(mv, cell - mv) / Math.SQRT2;
      let d = Math.min(du, dv);
      let edgeDist = thickness / 2 - d; // >0 inside the wire
      let onTension = false;
      if (y < tension) {
        edgeDist = Math.max(edgeDist, tension * 0.35 - y);
        onTension = true;
      } else if (y > size - 1 - tension) {
        edgeDist = Math.max(edgeDist, tension * 0.35 - (size - 1 - y));
        onTension = true;
      }
      const alpha = clamp01(0.5 + edgeDist / aa);
      const roundness = onTension ? 1 : clamp01(1 - Math.abs(d) / Math.max(1, thickness * 0.7));
      const shade = 0.42 + 0.3 * roundness;
      data[p] = clampByte(shade * 0.82 * 255);
      data[p + 1] = clampByte(shade * 0.86 * 255);
      data[p + 2] = clampByte(shade * 0.9 * 255);
      data[p + 3] = clampByte(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------------------------
// single images
// ---------------------------------------------------------------------------------------------

// One leaf of a sliding blast door, 1 m wide x 2.4 m tall: brushed steel, a recessed panel, a hazard chevron band
// at waist height, a dark vision slot at eye height, rivets along the edges.
function drawDoor() {
  const w = 256;
  const h = 512;
  const canvas = newCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const brushField = tileableField(makeRng(seedFor('door:brush')), 256, [
    { cellsX: 90, cellsY: 6, weight: 0.7 },
    { cellsX: 180, cellsY: 10, weight: 0.3 },
  ]);
  const img = ctx.createImageData(w, h);
  const data = img.data;
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p += 4) {
      const brush = at(brushField, 256, x, Math.floor(y * (256 / h)));
      const k = 0.56 + brush * 0.22;
      data[p] = clampByte(k * 0.56 * 255);
      data[p + 1] = clampByte(k * 0.58 * 255);
      data[p + 2] = clampByte(k * 0.61 * 255);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // recessed panel
  const pad = w * 0.1;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(pad, h * 0.08, w - pad * 2, h * 0.68);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, h * 0.08, w - pad * 2, h * 0.68);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(pad + 2, h * 0.08 + 2, w - pad * 2 - 4, h * 0.68 - 4);
  // waist-height hazard chevron band (~1 m up from the floor on a 2.4 m door)
  const bandY = h * (1 - 1.0 / 2.4);
  const bandH = h * 0.07;
  const stripe = w / 10;
  for (let x = 0; x < w; x += 2) {
    const k = Math.floor((x + bandY) / stripe) % 2;
    ctx.fillStyle = k ? 'rgba(16,14,8,0.9)' : 'rgba(210,172,44,0.9)';
    ctx.fillRect(x, bandY, 2, bandH);
  }
  // dark vision slot at eye height (~1.6 m)
  const slotY = h * (1 - 1.6 / 2.4);
  ctx.fillStyle = 'rgba(4,5,6,0.88)';
  ctx.fillRect(w * 0.3, slotY, w * 0.4, h * 0.035);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(w * 0.3, slotY, w * 0.4, h * 0.035);
  // rivets along the outer edges
  const rivetR = w * 0.012;
  const edgeX = w * 0.045;
  const count = 10;
  for (let i = 0; i < count; i++) {
    const y = h * (0.04 + (0.92 * i) / (count - 1));
    for (const x of [edgeX, w - edgeX]) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(x, y, rivetR, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(x - rivetR * 0.3, y - rivetR * 0.3, rivetR * 0.4, 0, TAU);
      ctx.fill();
    }
  }
  return canvas;
}

/** Generic builder for small radial sprites: `fn(dx, dy, r, a)` returns [r,g,b,a] in 0..255. */
function buildRadial(w, h, fn) {
  const canvas = newCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxR = Math.min(w, h) / 2;
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p += 4) {
      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const [cr, cg, cb, ca] = fn(dx, dy, r, a);
      data[p] = clampByte(cr);
      data[p + 1] = clampByte(cg);
      data[p + 2] = clampByte(cb);
      data[p + 3] = clampByte(ca);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// a 1D-noise-of-angle helper shared by puff/scorch, reusing the same tileable-field machinery
function angleField(seed, cells) {
  return tileableField(makeRng(seedFor(seed)), 256, [
    { cells, weight: 0.6 },
    { cells: cells * 2, weight: 0.4 },
  ]);
}

function sampleAngle(field, a) {
  const u = Math.floor(((a / TAU + 0.5) * 256) % 256);
  return at(field, 256, u, 64);
}

// A soft round glow for lamp coronas, additive: brightest in the middle, a faint wider halo.
function drawFlare() {
  return buildRadial(128, 128, (dx, dy, r) => {
    const core = Math.exp(-r * r * 9);
    const halo = Math.exp(-r * r * 1.6) * 0.35;
    const v = clamp01(core + halo) * 255;
    return [v, v, v, 255];
  });
}

// What a lens makes of a point of light at night: a thin bright line across it, and a shorter one up and down.
function drawGlint() {
  return buildRadial(256, 256, (dx, dy) => {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const across = Math.exp(-ay * ay * 2600) * Math.pow(Math.max(0, 1 - ax), 2.2);
    const upright = Math.exp(-ax * ax * 3400) * Math.pow(Math.max(0, 1 - ay / 0.42), 2.4) * 0.55;
    const v = clamp01(across + upright) * 255;
    return [v, v, v, 255];
  });
}

// A lumpy irregular smoke/dust puff, white with alpha.
function drawPuff() {
  const field = angleField('puff:angle', 7);
  const lumps = tileableField(makeRng(seedFor('puff:lumps')), 256, [
    { cells: 5, weight: 0.5 },
    { cells: 10, weight: 0.5 },
  ]);
  return buildRadial(128, 128, (dx, dy, r, a) => {
    const edge = 0.55 + 0.3 * (sampleAngle(field, a) - 0.5) * 2;
    const nx = dx * 0.5 + 0.5;
    const ny = dy * 0.5 + 0.5;
    const lump = 0.6 + 0.4 * at(lumps, 256, nx * 256, ny * 256);
    const alpha = clamp01((edge - r) * 2.6) * lump;
    const v = 235;
    return [v, v, 240, alpha * 255];
  });
}

// A small hard-centred star/streak sprite, white on black, additive.
function drawSpark() {
  return buildRadial(64, 64, (dx, dy, r, a) => {
    const core = Math.exp(-r * r * 30);
    const rays = Math.pow(Math.max(0, Math.cos(a * 4)), 6) * Math.exp(-r * 2.2);
    const v = clamp01(core + rays * 0.8) * 255;
    return [v, v, v, 255];
  });
}

// A blast scorch mark: dark irregular soot, densest at the centre, with radial streaks, as RGBA.
function drawScorch() {
  const field = angleField('scorch:angle', 9);
  const rayPhase = makeRng(seedFor('scorch:rays'));
  const rayAngles = Array.from({ length: 7 }, () => rayPhase.range(0, TAU));
  const raySharp = Array.from({ length: 7 }, () => rayPhase.range(10, 26));
  return buildRadial(256, 256, (dx, dy, r, a) => {
    const edge = 0.68 + 0.22 * (sampleAngle(field, a) - 0.5) * 2;
    const core = clamp01(1 - r / (edge * 0.55));
    let rays = 0;
    for (let i = 0; i < rayAngles.length; i++) {
      let da = a - rayAngles[i];
      da = Math.atan2(Math.sin(da), Math.cos(da));
      rays += Math.exp(-da * da * raySharp[i]) * Math.exp(-r * 1.3);
    }
    const alpha = clamp01(Math.max(core * 0.95, rays * 0.6) * clamp01((edge - r) * 3));
    return [14, 12, 11, alpha * 235];
  });
}

// A bullet hole: a small dark pit with a paler chipped rim, as RGBA.
function drawHole() {
  const jitter = angleField('hole:jitter', 10);
  return buildRadial(64, 64, (dx, dy, r, a) => {
    const rr = r * (0.92 + 0.16 * (sampleAngle(jitter, a) - 0.5));
    const pit = clamp01(1 - rr / 0.32);
    const rim = clamp01(1 - Math.abs(rr - 0.42) / 0.18);
    const alpha = clamp01(Math.max(pit, rim * 0.6) * clamp01((0.62 - rr) * 6));
    const rC = lerp(90, 10, pit);
    const gC = lerp(82, 9, pit);
    const bC = lerp(74, 8, pit);
    return [rC, gC, bC, alpha * 255];
  });
}

// A thin soft ring, white on black, additive (shock waves, pings).
function drawRing() {
  return buildRadial(128, 128, (dx, dy, r) => {
    const v = clamp01(1 - Math.abs(r - 0.6) / 0.1) * 255;
    return [v, v, v, 255];
  });
}

// A soft dark round shadow blob, as RGBA, for under walking machines.
function drawBlob() {
  return buildRadial(64, 64, (dx, dy, r) => {
    const alpha = clamp01(1 - r / 0.85) ** 1.6;
    return [0, 0, 0, alpha * 220];
  });
}

// ---------------------------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------------------------

/**
 * Builds every surface texture the game draws on: tiling albedo maps (with `userData.metres` set) and a handful
 * of single-image sprites for doors, lamps and particle effects.
 *
 * Until 13 November 2026 every pixel was painted here. Now a surface that has a picture in `art` (src/gfx/art.js:
 * made by an image model, worked into a tile by tools/art) is that picture, drawn onto the same kind of canvas so
 * that everything after this — bump maps, tiling, metres to a repeat — is as it was; a surface with no picture is
 * painted exactly as before, seeded only from `makeRng`. Regular surfaces (tiles, plate, ceiling panels, a
 * corrugated roof) stay painted, because a picture's grid never quite meets itself; they get the `wear` picture
 * laid over them instead.
 * @param {object} [o]
 * @param {number} [o.size=512] edge of the painted tiling textures in pixels (the game passes 256 on weak phones)
 * @param {number} [o.anisotropy=4]
 * @param {Record<string, CanvasImageSource & { width: number, height: number }>} [o.art] pictures by name
 * @returns {Record<string, THREE.CanvasTexture>}
 */
export function makeTextures({ size = 512, anisotropy = 4, art = {} } = {}) {
  const pool = makePool(size);
  /** A canvas with a picture drawn to fill it, at the picture's own size. */
  const pictured = (picture) => {
    const canvas = newCanvas(picture.width, picture.height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(picture, 0, 0, picture.width, picture.height);
    return canvas;
  };
  /**
   * A surface that tiles: its picture if there is one — with `fit`, if given, drawn over it — or else painted.
   * `fit(ctx, size)` is for what a picture of a bare surface does not have and a room needs: a vent, a hatch.
   */
  const tile = (name, metres, clampV, draw, fit) => {
    if (art[name]) {
      const canvas = pictured(art[name]);
      fit?.(canvas.getContext('2d'), canvas.width);
      return finishTile(canvas, metres, anisotropy, clampV);
    }
    const canvas = newCanvas(size, size);
    draw(canvas.getContext('2d'));
    return finishTile(canvas, metres, anisotropy, clampV);
  };
  /** Painted, then worn: the wear picture multiplied over it, twice across so that it does not line up with its own grid. */
  const worn = (name, metres, clampV, draw) => {
    const canvas = newCanvas(size, size);
    const ctx = canvas.getContext('2d');
    draw(ctx);
    if (art.wear) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.6;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(art.wear, 0, 0, size, size);
      ctx.restore();
    }
    return finishTile(canvas, metres, anisotropy, clampV);
  };

  const out = {
    concrete: tile('concrete', 4, false, (ctx) => drawConcrete(ctx, size, pool)),
    // the picture is of a bare panelled wall: the vent and the hatch that the painted one has are put on it
    wallPanel: tile(
      'wallPanel',
      4,
      true,
      (ctx) => drawWallPanel(ctx, size, pool),
      (ctx, s) => {
        drawVent(ctx, s * 0.17, s * 0.44, s * 0.16, s * 0.1);
        drawHatch(ctx, s * 0.76, s * 0.4, s * 0.12, s * 0.16);
      },
    ),
    hallWall: tile('hallWall', 4, true, (ctx) => drawHallWall(ctx, size, pool)),
    asphalt: tile('asphalt', 4, false, (ctx) => drawAsphalt(ctx, size, pool)),
    dirt: tile('dirt', 4, false, (ctx) => drawDirt(ctx, size, pool)),
    floorConcrete: tile('floorConcrete', 4, false, (ctx) => drawFloorConcrete(ctx, size, pool)),
    floorTile: worn('floorTile', 2, false, (ctx) => drawFloorTile(ctx, size, pool)),
    floorEpoxy: tile('floorEpoxy', 4, false, (ctx) => drawFloorEpoxy(ctx, size, pool)),
    floorPlate: worn('floorPlate', 2, false, (ctx) => drawFloorPlate(ctx, size, pool)),
    ceiling: worn('ceiling', 2, false, (ctx) => drawCeiling(ctx, size, pool)),
    roof: worn('roof', 4, false, (ctx) => drawRoof(ctx, size, pool)),
    rock: tile('rock', 4, false, (ctx) => drawRock(ctx, size, pool)),
    // what paint and bare metal pick up with use: laid over props, machines and the weapon by the shader
    wear: tile('wear', 2, false, (ctx) => drawWear(ctx, size, pool)),
    fence: finishTile(drawFence(), 1, anisotropy, false),
    door: finishImage(art.door ? pictured(art.door) : drawDoor(), anisotropy),
    flare: finishImage(drawFlare(), anisotropy),
    glint: finishImage(drawGlint(), anisotropy),
    puff: finishImage(drawPuff(), anisotropy),
    spark: finishImage(drawSpark(), anisotropy),
    scorch: finishImage(drawScorch(), anisotropy),
    hole: finishImage(drawHole(), anisotropy),
    ring: finishImage(drawRing(), anisotropy),
    blob: finishImage(drawBlob(), anisotropy),
  };
  return out;
}
