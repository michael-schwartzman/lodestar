// Reads the pixels of a PNG — the kind a browser's screenshot is — with nothing but node's own zlib.
// Tests count pixels of a picture of the game with it (test/second/look.test.mjs). 8 bits a channel, RGB or RGBA, not
// interlaced; anything else is refused rather than guessed at.
import { inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * @param {Uint8Array} bytes the file
 * @returns {{ width: number, height: number, data: Uint8Array }} data is RGBA, four bytes a pixel, top row first
 */
export function decodePng(bytes) {
  const file = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  for (let i = 0; i < 8; i++) if (file[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || body[12] !== 0)
        throw new Error(
          `a PNG this reader does not know: depth ${depth}, colour type ${colour}, interlace ${body[12]}`,
        );
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') parts.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!width || !height) throw new Error('a PNG with no header');
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('a PNG that is cut short');
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[to + x - channels] : 0;
      const b = y > 0 ? rows[to + x - stride] : 0;
      const c = x >= channels && y > 0 ? rows[to + x - stride - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`a PNG row with filter ${filter}`);
      rows[to + x] = (raw[from + x] + predicted) & 255;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < rows.length; i += 3, o += 4) {
    data[o] = rows[i];
    data[o + 1] = rows[i + 1];
    data[o + 2] = rows[i + 2];
    data[o + 3] = 255;
  }
  return { width, height, data };
}
