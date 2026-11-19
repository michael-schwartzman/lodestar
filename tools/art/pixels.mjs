// The arithmetic that turns a generated picture into a tile. Pure: arrays in, new arrays out, nothing else.
// It runs twice: inside a browser page for tools/art/process.mjs (which has the pictures), and under node for
// test/unit/pixels.test.mjs (which has the rules).
//
// A picture here is a Float32Array of w × h × 3 values from 0 to 1 — red, green, blue — in rows from the top.

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The mean and the spread of each of the three channels. */
export function stats(rgb) {
  const n = rgb.length / 3;
  const mean = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let i = 0; i < rgb.length; i += 3)
    for (let c = 0; c < 3; c++) {
      mean[c] += rgb[i + c];
      sq[c] += rgb[i + c] * rgb[i + c];
    }
  for (let c = 0; c < 3; c++) mean[c] /= n;
  return { mean, std: sq.map((s, c) => Math.sqrt(Math.max(0, s / n - mean[c] * mean[c]))) };
}

/** One line of numbers, averaged over `radius` either side, going round the ends. */
function blurLine(line, n, radius, out) {
  const span = radius * 2 + 1;
  let sum = 0;
  for (let k = -radius; k <= radius; k++) sum += line[(((k % n) + n) % n) | 0];
  for (let i = 0; i < n; i++) {
    out[i] = sum / span;
    sum += line[(i + radius + 1) % n] - line[(((i - radius) % n) + n) % n];
  }
}

/** A heavy blur of the whole picture (three box blurs, which is nearly a Gaussian), going round every edge. */
function blur(rgb, w, h, radius) {
  let src = Float32Array.from(rgb);
  let dst = new Float32Array(rgb.length);
  const line = new Float32Array(Math.max(w, h));
  const done = new Float32Array(Math.max(w, h));
  for (let pass = 0; pass < 3; pass++) {
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) line[x] = src[(y * w + x) * 3 + c];
        blurLine(line, w, Math.min(radius, (w - 1) >> 1), done);
        for (let x = 0; x < w; x++) dst[(y * w + x) * 3 + c] = done[x];
      }
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) line[y] = dst[(y * w + x) * 3 + c];
        blurLine(line, h, Math.min(radius, (h - 1) >> 1), done);
        for (let y = 0; y < h; y++) src[(y * w + x) * 3 + c] = done[y];
      }
    }
  }
  dst = null;
  return src;
}

/**
 * Takes the slow drift of light out of a picture — a brighter corner, a darker side — and leaves everything
 * finer than that alone. What comes out has the same mean as what went in.
 * @param {object} [o]
 * @param {number} [o.radius]  how slow "slow" is, in pixels (default: a sixth of the picture)
 * @param {number} [o.amount=1] how much of the drift to take out
 * @param {'xy'|'x'} [o.axes='xy'] 'x' takes out drift from side to side only: a wall keeps its dark foot
 */
export function flatten(
  rgb,
  w,
  h,
  { radius = Math.max(1, Math.round(Math.max(w, h) / 6)), amount = 1, axes = 'xy' } = {},
) {
  const out = new Float32Array(rgb.length);
  const { mean } = stats(rgb);
  if (axes === 'x') {
    const column = new Float32Array(w);
    const slow = new Float32Array(w);
    const again = new Float32Array(w);
    for (let c = 0; c < 3; c++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = 0; y < h; y++) sum += rgb[(y * w + x) * 3 + c];
        column[x] = sum / h;
      }
      const r = Math.min(radius, (w - 1) >> 1);
      blurLine(column, w, r, slow);
      blurLine(slow, w, r, again);
      blurLine(again, w, r, slow);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 3 + c;
          out[i] = clamp01(rgb[i] - amount * (slow[x] - mean[c]));
        }
    }
    return out;
  }
  const low = blur(rgb, w, h, radius);
  for (let i = 0; i < rgb.length; i++) out[i] = clamp01(rgb[i] - amount * (low[i] - mean[i % 3]));
  return out;
}

/**
 * One direction of `seamless`. A strip is cut off the far end of every line and laid over the near end, fading
 * out across it: the line now ends where the strip began, and begins with what came next — so its two ends
 * meet — and no part of the picture is used twice. Where the two are mixed they are added so that the result is
 * as busy as either was, not washed out.
 * @returns {{ rgb: Float32Array, w: number, h: number }} shorter in this direction by the width of the strip
 */
function overlap(rgb, w, h, band, alongX) {
  const n = alongX ? w : h;
  const lines = alongX ? h : w;
  const strip = Math.max(1, Math.min(n - 1, Math.round(band * n)));
  const kept = n - strip;
  const ow = alongX ? kept : w;
  const oh = alongX ? h : kept;
  const out = new Float32Array(ow * oh * 3);
  const from = (line, k) => (alongX ? line * w + k : k * w + line) * 3;
  const to = (line, k) => (alongX ? line * ow + k : k * ow + line) * 3;
  for (let line = 0; line < lines; line++) {
    const mean = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const i = from(line, k);
      mean[0] += rgb[i];
      mean[1] += rgb[i + 1];
      mean[2] += rgb[i + 2];
    }
    mean[0] /= n;
    mean[1] /= n;
    mean[2] /= n;
    for (let k = 0; k < kept; k++) {
      const here = from(line, k);
      const there = to(line, k);
      if (k >= strip) {
        out[there] = rgb[here];
        out[there + 1] = rgb[here + 1];
        out[there + 2] = rgb[here + 2];
        continue;
      }
      // at the very start only the strip is left — the pixel that followed the line's new last one
      const a = smooth(k / strip);
      const b = 1 - a;
      const norm = 1 / Math.hypot(a, b);
      const cut = from(line, kept + k);
      for (let c = 0; c < 3; c++)
        out[there + c] = clamp01(mean[c] + (a * (rgb[here + c] - mean[c]) + b * (rgb[cut + c] - mean[c])) * norm);
    }
  }
  return { rgb: out, w: ow, h: oh };
}

/**
 * Makes a picture into a tile: its left edge meets its right, and its top its bottom. The tile is smaller than
 * the picture by the band that is remade (see `overlap`): ask for a picture that much larger than the tile wanted.
 * @param {object} [o]
 * @param {boolean} [o.x=true] meet from side to side
 * @param {boolean} [o.y=true] meet from top to bottom (false for a wall that only repeats along its length)
 * @param {number} [o.band=0.2] how much of the picture's size is cut off and faded over the other edge
 * @returns {{ rgb: Float32Array, w: number, h: number }}
 */
export function seamless(rgb, w, h, { x = true, y = true, band = 0.2 } = {}) {
  let tile = { rgb: Float32Array.from(rgb), w, h };
  if (x) tile = overlap(tile.rgb, tile.w, tile.h, band, true);
  if (y) tile = overlap(tile.rgb, tile.w, tile.h, band, false);
  return tile;
}

/**
 * Brings a picture to the brightness of `target`, and `tint` of the way (0 … 1) to its colour.
 * @param {object} o
 * @param {number[]} o.target  the mean colour wanted, three numbers from 0 to 1
 * @param {number} [o.tint=0.5]
 */
export function grade(rgb, { target, tint = 0.5 }) {
  const { mean } = stats(rgb);
  const luma = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const bright = luma(target) / Math.max(1e-6, luma(mean));
  const scale = [0, 1, 2].map((c) => bright + (target[c] / Math.max(1e-6, mean[c]) - bright) * tint);
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) out[i] = clamp01(rgb[i] * scale[i % 3]);
  return out;
}

/**
 * Takes out some of a picture's own colour, pixel by pixel, and none of its light and dark: `keep` 1 leaves it as
 * it is, 0 leaves a grey picture. For the picture of a material, which multiplies a part's own paint.
 */
export function mute(rgb, keep) {
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    const grey = rgb[i] * 0.3 + rgb[i + 1] * 0.59 + rgb[i + 2] * 0.11;
    for (let c = 0; c < 3; c++) out[i + c] = clamp01(grey + (rgb[i + c] - grey) * keep);
  }
  return out;
}

/**
 * How badly a picture's edges fail to meet: the step from its last column round to its first, as a multiple of
 * the step between two columns side by side in its middle (and the same for rows). A tile scores about 1.
 */
export function seamError(rgb, w, h) {
  let wrapX = 0;
  let insideX = 0;
  let wrapY = 0;
  let insideY = 0;
  for (let y = 0; y < h; y++)
    for (let c = 0; c < 3; c++) {
      wrapX += Math.abs(rgb[(y * w + w - 1) * 3 + c] - rgb[y * w * 3 + c]);
      for (let x = 0; x < w - 1; x++) insideX += Math.abs(rgb[(y * w + x) * 3 + c] - rgb[(y * w + x + 1) * 3 + c]);
    }
  for (let x = 0; x < w; x++)
    for (let c = 0; c < 3; c++) {
      wrapY += Math.abs(rgb[((h - 1) * w + x) * 3 + c] - rgb[x * 3 + c]);
      for (let y = 0; y < h - 1; y++) insideY += Math.abs(rgb[(y * w + x) * 3 + c] - rgb[((y + 1) * w + x) * 3 + c]);
    }
  return {
    x: wrapX / h / Math.max(1e-9, insideX / (h * (w - 1))),
    y: wrapY / w / Math.max(1e-9, insideY / (w * (h - 1))),
  };
}
