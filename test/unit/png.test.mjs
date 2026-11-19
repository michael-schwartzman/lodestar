// Contract lock: the little PNG reader the picture tests count pixels with (tools/lib/png.mjs). If it misreads a
// row filter, every count made with it is wrong — so each of the five filters is tried on a picture whose pixels
// are known, written here by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { decodePng } from '../../tools/lib/png.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Writes a PNG of `pixels` (rows of [r, g, b, a]) using one row filter throughout. */
function encode(pixels, filter, channels = 4) {
  const height = pixels.length;
  const width = pixels[0].length;
  const stride = width * channels;
  const plain = pixels.map((row) => row.flatMap((p) => p.slice(0, channels)));
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? plain[y][x - channels] : 0;
      const b = y > 0 ? plain[y - 1][x] : 0;
      const c = x >= channels && y > 0 ? plain[y - 1][x - channels] : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const predicted = [0, a, b, (a + b) >> 1, paeth][filter];
      raw[y * (stride + 1) + 1 + x] = (plain[y][x] - predicted) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PIXELS = [
  [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 128],
    [12, 34, 56, 255],
  ],
  [
    [255, 0, 255, 255],
    [7, 7, 7, 255],
    [250, 251, 252, 0],
    [1, 2, 3, 255],
  ],
  [
    [90, 180, 45, 255],
    [91, 181, 46, 255],
    [200, 100, 50, 255],
    [0, 0, 0, 255],
  ],
];

test('every row filter a PNG can use is undone exactly', () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    const { width, height, data } = decodePng(encode(PIXELS, filter));
    assert.deepEqual([width, height], [4, 3]);
    assert.deepEqual(Array.from(data), PIXELS.flat(2), `filter ${filter}`);
  }
});

test('a picture without transparency comes back with every pixel solid', () => {
  const { data } = decodePng(encode(PIXELS, 4, 3));
  assert.deepEqual(
    Array.from(data),
    PIXELS.flat().flatMap(([r, g, b]) => [r, g, b, 255]),
  );
});

test('what it cannot read it refuses: not a PNG, or a kind it does not know', () => {
  assert.throws(() => decodePng(Buffer.from('GIF89a, in fact')), /not a PNG/);
  const sixteen = encode(PIXELS, 0);
  sixteen[24] = 16; // the header's bit depth
  assert.throws(() => decodePng(sixteen), /does not know/);
});
