// WAV files, written and read: 16-bit PCM, any number of channels. For the sound tools (tools/sound) — the game
// itself never touches a file of sound that was not built into it.

/**
 * @param {Float32Array[]} channels samples in −1 … 1, one array a channel, all of one length
 * @param {number} rate samples a second
 * @returns {Buffer} the bytes of a WAV file
 */
export function encodeWav(channels, rate) {
  const n = channels[0].length;
  const pcm = Buffer.alloc(n * channels.length * 2);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < channels.length; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      pcm.writeInt16LE(Math.round(v * 32767), (i * channels.length + c) * 2);
    }
  return Buffer.concat([wavHeader(pcm.length, rate, channels.length), pcm]);
}

/** The 44 bytes that go before `bytes` bytes of 16-bit PCM. */
export function wavHeader(bytes, rate, channels) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + bytes, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * 2, 28);
  head.writeUInt16LE(channels * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(bytes, 40);
  return head;
}

/**
 * @param {Buffer} file the bytes of a 16-bit PCM WAV file
 * @returns {{ rate: number, channels: Float32Array[] }}
 */
export function decodeWav(file) {
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a WAV file');
  let at = 12;
  let format = null;
  while (at + 8 <= file.length) {
    const id = file.toString('ascii', at, at + 4);
    const size = file.readUInt32LE(at + 4);
    if (id === 'fmt ')
      format = {
        tag: file.readUInt16LE(at + 8),
        channels: file.readUInt16LE(at + 10),
        rate: file.readUInt32LE(at + 12),
        bits: file.readUInt16LE(at + 22),
      };
    else if (id === 'data') {
      if (!format || format.tag !== 1 || format.bits !== 16) throw new Error('only 16-bit PCM is read');
      const n = Math.floor(Math.min(size, file.length - at - 8) / (2 * format.channels));
      const channels = Array.from({ length: format.channels }, () => new Float32Array(n));
      for (let i = 0; i < n; i++)
        for (let c = 0; c < format.channels; c++)
          channels[c][i] = file.readInt16LE(at + 8 + (i * format.channels + c) * 2) / 32768;
      return { rate: format.rate, channels };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('no samples in it');
}
