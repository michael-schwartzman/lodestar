// Cuts a chosen candidate — music from tools/sound/music.mjs, or any sound file — into the file the game fetches:
// the stretch that is wanted, brought to a set loudness, its two ends faded over a few milliseconds so that it
// neither starts nor stops with a click, and packed small.
//
// A development tool; needs ffmpeg. The build never runs it.
//
//   node tools/sound/cut.mjs <in> <out.mp3> [options]
//     --from <s> --to <s>   the stretch (default: all of it)
//     --lufs <n>            how loud it is to be, in LUFS (default −18; no change with --lufs keep)
//     --kbps <n>            the mp3's bit rate (default 104)
//     --mono                one channel (voices)
//     --filter "<ffmpeg audio filters>"   put before the loudness is set (a voice's colour, say)
//     --measure             only say what is in <in>: its length and the first and last moments it is at its own level
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { options } from '../lib/gemini.mjs';

const ffmpeg = (args) =>
  spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

/** How long a sound file is, in seconds. */
export function secondsOf(file) {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  return +String(out).trim();
}

/** How loud a stretch of a file is, as ffmpeg's EBU R128 meter reads it (LUFS, integrated). */
export function loudnessOf(file, filters = 'anull') {
  const run = ffmpeg(['-i', file, '-af', `${filters},ebur128=framelog=quiet`, '-f', 'null', '-']);
  const found = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(run.stderr);
  if (!found) throw new Error(`ffmpeg could not measure ${file}: ${run.stderr.slice(-300)}`);
  return +found[1];
}

/**
 * Where a piece is at its own level: the first and the last moment its loudness (over half a second) is within
 * `within` dB of its middle's — what is before is an intro that builds, what is after an ending that fades.
 */
export function bodyOf(file, within = 9) {
  const raw = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-nostdin', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
    {
      maxBuffer: 1 << 28,
    },
  ).stdout;
  const samples = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const win = 4000;
  const db = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += (samples[i + j] / 32768) ** 2;
    db.push(10 * Math.log10(sum / win + 1e-12));
  }
  const middle = db.slice(Math.floor(db.length * 0.25), Math.ceil(db.length * 0.75)).sort((a, b) => a - b);
  const level = middle[middle.length >> 1];
  let first = 0;
  while (first < db.length && db[first] < level - within) first++;
  let last = db.length - 1;
  while (last > first && db[last] < level - within) last--;
  return { seconds: samples.length / 8000, from: first * 0.5, to: (last + 1) * 0.5, level };
}

/**
 * @param {string} from the file to cut
 * @param {string} to the mp3 to write
 * @param {object} o  from, to (seconds), lufs (number | 'keep'), kbps, mono, filter
 * @returns {{ seconds: number, bytes: number, lufs: number }}
 */
export function cut(from, to, o = {}) {
  const a = o.from !== undefined ? +o.from : 0;
  const b = o.to !== undefined ? +o.to : secondsOf(from);
  const length = b - a;
  const trim = `atrim=${a}:${b},asetpts=PTS-STARTPTS${o.filter ? `,${o.filter}` : ''}`;
  let gain = 0;
  if (o.lufs !== 'keep') gain = (o.lufs === undefined ? -18 : +o.lufs) - loudnessOf(from, trim);
  const fade = 0.012;
  const filters = `${trim},volume=${gain.toFixed(2)}dB,alimiter=limit=0.94:level=disabled,afade=t=in:d=${fade},afade=t=out:st=${(length - fade).toFixed(3)}:d=${fade}`;
  mkdirSync(dirname(to), { recursive: true });
  const run = ffmpeg([
    '-y',
    ...['-i', from, '-af', filters, '-ac', o.mono ? '1' : '2', '-ar', '44100'],
    ...['-codec:a', 'libmp3lame', '-b:a', `${o.kbps || 104}k`, '-map_metadata', '-1', '-id3v2_version', '0', to],
  ]);
  if (run.status !== 0) throw new Error(`ffmpeg failed on ${from}: ${run.stderr.slice(-400)}`);
  return { seconds: secondsOf(to), bytes: statSync(to).size, lufs: loudnessOf(to) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = options(process.argv.slice(2));
  const [from, to] = o._;
  if (o.measure) console.log(JSON.stringify(bodyOf(from)));
  else {
    const made = cut(from, to, o);
    console.log(`${to}  ${made.seconds.toFixed(1)} s  ${made.bytes} bytes  ${made.lufs} LUFS`);
  }
}
