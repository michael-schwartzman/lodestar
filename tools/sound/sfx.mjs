// Turns a few seconds of a video model's audio track into real-sounding firing, explosion, enemy-fire and
// centrifuge sounds. docs/WILD-sfx.md has the gate this holds every candidate to, and the processing described
// below; tools/sound/manifest.json's "sfx" section has what each sound was asked for, and is written back to
// with what was chosen.
//
// A development tool. The build never runs it and the game never calls a model.
//
//   node tools/sound/sfx.mjs --key-file <env file> [options]
//     --only shotSentry,whiz   which sounds (default: every one the manifest names, in its order)
//     --tries 3                generations to spend on a sound before giving up (default: the manifest's
//                               `takes`, capped at 3 — the brief's budget)
//     --listen-only            do not generate: judge and cut whatever is already in the candidates folder
//     --candidates <dir>       where raw generations and working files go (default sound/candidates/sfx —
//                               git-ignored)
//
// For each sound: generate (Google's Interactions API, a 3-4 s video whose audio track is the sound asked for;
// only the audio is kept), find the onset (the first sample over about -35 dB of the clip's own peak, less
// 5 ms of lead), cut to the length wanted, and for a blast raise what a small speaker can play (a few peaking
// boosts across 150-2500 Hz and a shelf down under 60 Hz — an EQ tilt, reprocessed and re-measured until the
// gate's band share clears, never assumed). The strict listener (tools/sound/listen.mjs, gemini-pro-latest)
// judges each candidate blind, and — against the sound it replaces, from .work/v10-before/ — for realism.
// tools/sound/cut.mjs sets the loudness, fades the ends and encodes the mp3 that is kept.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { options, readKey } from '../lib/gemini.mjs';
import { decodeWav } from '../lib/wav.mjs';
import { cut, loudnessOf } from './cut.mjs';
import { listen } from './listen.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_PATH = `${ROOT}tools/sound/manifest.json`;
const OLD_DIR = `${ROOT}.work/v10-before`;
const PACK_DIR = `${ROOT}src/wild/sfx`;
const INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/** the brief's budget: never more than this many generation requests in all of a night's work */
const BUDGET = 90;
/** sounds the owner said he cannot hear: these may run up to 4 dB louder than what they replace */
const MAY_BE_LOUDER = ['shotSentry', 'shotDrone', 'explosion', 'cascadeBlast'];

const ffmpeg = (args) =>
  spawnSync('ffmpeg', ['-y', '-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

/** The audio track of a video file, as a mono 44.1 kHz WAV. */
function extractAudio(videoPath, wavPath) {
  const run = ffmpeg(['-i', videoPath, '-vn', '-ac', '1', '-ar', '44100', wavPath]);
  if (run.status !== 0)
    throw new Error(`ffmpeg could not get the sound out of ${videoPath}: ${run.stderr.slice(-400)}`);
}

/** Where a clip's onset is: the first sample over about -35 dB of its own peak, less 5 ms of lead. */
function findOnset(wavPath) {
  const { rate, channels } = decodeWav(readFileSync(wavPath));
  const x = channels[0];
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const threshold = peak * 10 ** (-35 / 20);
  let i = 0;
  while (i < x.length && Math.abs(x[i]) < threshold) i++;
  return { at: Math.max(0, i / rate - 0.005), seconds: x.length / rate, peak };
}

/** What share of a WAV's energy sits in 150-4000 Hz (tools/sound/bands.py: the same three bands the gate asks of). */
function midShare(wavPath) {
  const out = execFileSync('python3', [`${ROOT}tools/sound/bands.py`, wavPath], { encoding: 'utf8' });
  const m = /150-400:\s*([\d.]+)%\s*400-1000:\s*([\d.]+)%\s*1000-4000:\s*([\d.]+)%/.exec(out);
  if (!m) throw new Error(`tools/sound/bands.py did not say, for ${wavPath}: ${out}`);
  return (+m[1] + +m[2] + +m[3]) / 100;
}

/**
 * One ffmpeg pass: trimmed to the cut wanted from the onset, a high-pass, and — if asked — the blast tilt or a
 * speed change (a take "varied" from one good generation: see run() — the brief allows this instead of spending
 * another generation request).
 */
function shape(rawWav, outWav, { from, seconds, tiltDb, rateMult = 1 }) {
  const filters = [`atrim=${from}:${from + seconds}`, 'asetpts=PTS-STARTPTS'];
  if (rateMult !== 1) filters.push(`asetrate=44100*${rateMult}`, 'aresample=44100');
  filters.push('highpass=f=40');
  if (tiltDb)
    filters.push(
      `equalizer=f=220:t=q:w=1:g=${tiltDb}`,
      `equalizer=f=700:t=q:w=1:g=${(tiltDb * 0.8).toFixed(1)}`,
      `equalizer=f=2200:t=q:w=1:g=${(tiltDb * 0.55).toFixed(1)}`,
    );
  const fade = Math.min(0.03, seconds * 0.2);
  filters.push(`afade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`);
  const run = ffmpeg(['-i', rawWav, '-af', filters.join(','), '-ac', '1', '-ar', '44100', outWav]);
  if (run.status !== 0) throw new Error(`ffmpeg could not process ${rawWav}: ${run.stderr.slice(-400)}`);
}

/** One generation: a 3-4 s mp4 whose audio track is the sound asked for (walks the answer for any base64 `data`). */
async function generateClip(prompt, model, key) {
  const res = await fetch(INTERACTIONS, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ model, input: prompt, response_modalities: ['audio'] }),
    signal: AbortSignal.timeout(300000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} (not JSON): ${text.slice(0, 300)}`);
  }
  if (json.error)
    throw new Error(`${res.status} ${json.error.status || ''}: ${String(json.error.message).slice(0, 300)}`);
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.data === 'string' && node.data.length > 200) {
      found.push(node);
      return;
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'data') walk(v);
  };
  walk(json.steps || json.outputs || json);
  if (!found.length) throw new Error(`sent nothing with sound in it (keys: ${Object.keys(json).join(',')})`);
  return Buffer.from(found[0].data, 'base64');
}

/** How loud (LUFS) the sound this one replaces is — null for a sound that is new. */
function oldLevel(name, replaces) {
  if (replaces === 'new') return null;
  const file = `${OLD_DIR}/${replaces}-0.wav`;
  return existsSync(file)
    ? loudnessOf(file)
    : existsSync(`${OLD_DIR}/${replaces}.wav`)
      ? loudnessOf(`${OLD_DIR}/${replaces}.wav`)
      : null;
}

/** The old sound, read for the listener — null if there is none (a sound that is new). */
function oldWavBuffer(replaces) {
  if (replaces === 'new') return null;
  const file = existsSync(`${OLD_DIR}/${replaces}-0.wav`)
    ? `${OLD_DIR}/${replaces}-0.wav`
    : `${OLD_DIR}/${replaces}.wav`;
  return existsSync(file) ? readFileSync(file) : null;
}

async function run() {
  const o = options(process.argv.slice(2));
  const key = readKey(o['key-file']);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const SFX = manifest.sfx;
  const CANDIDATES = `${ROOT}${typeof o.candidates === 'string' ? o.candidates : 'sound/candidates/sfx'}`;
  mkdirSync(CANDIDATES, { recursive: true });
  mkdirSync(PACK_DIR, { recursive: true });
  const only = typeof o.only === 'string' ? o.only.split(',') : Object.keys(SFX.sounds);
  let spent = 0;
  const report = {};

  for (const name of only) {
    const sound = SFX.sounds[name];
    if (!sound) throw new Error(`the manifest's sfx section has no sound called ${name}`);
    // the brief's budget: up to 3 generations per sound, whatever the number of takes wanted, run together (the
    // budget's "at most 3 at a time" is also "at most 3 total" here, so plain Promise.allSettled keeps to it)
    const tries = Math.min(+(o.tries || 3), 3);
    console.log(`\n=== ${name} (up to ${tries} generations, wants ${sound.takes} take(s)) ===`);
    let usedHere = 0;
    const slots = [];

    if (!o['listen-only']) {
      const n = Math.max(0, Math.min(tries, BUDGET - spent));
      if (n < tries) console.log(`  (only ${n} generation request(s) left of the ${BUDGET}-budget)`);
      spent += n;
      usedHere += n;
      const made = await Promise.allSettled(
        Array.from({ length: n }, (_, i) =>
          generateClip(sound.prompt, SFX.model, key).then((bytes) => {
            writeFileSync(`${CANDIDATES}/${name}-${i}.mp4`, bytes);
            extractAudio(`${CANDIDATES}/${name}-${i}.mp4`, `${CANDIDATES}/${name}-${i}.raw.wav`);
          }),
        ),
      );
      made.forEach((r, i) => {
        if (r.status === 'fulfilled') slots.push(i);
        else console.log(`  ${name}-${i}: generation failed — ${r.reason.message}`);
      });
    } else {
      for (let i = 0; i < tries; i++) if (existsSync(`${CANDIDATES}/${name}-${i}.raw.wav`)) slots.push(i);
    }

    const accepted = []; // { wav, label, realism, heard, bandShare }
    for (const i of slots) {
      const rawWav = `${CANDIDATES}/${name}-${i}.raw.wav`;
      const onset = findOnset(rawWav);
      let tiltDb = 0;
      const outWav = `${CANDIDATES}/${name}-${i}.cut.wav`;
      let share = 0;
      // reprocess locally (no generation spent) until the gate's band share clears, or the tilt is maxed out
      for (const step of sound.tilt ? [0, 8, 14, 20] : [0]) {
        tiltDb = step;
        shape(rawWav, outWav, { from: onset.at, seconds: sound.cut, tiltDb });
        share = midShare(outWav);
        if (share >= (name === 'cascadeSpin' ? 0.5 : 0.35)) break;
      }
      const heard = await listen(readFileSync(outWav), { key, as: sound.describe, model: 'gemini-pro-latest' });
      const bandOk = share >= (name === 'cascadeSpin' ? 0.5 : 0.35);
      const labelOk = sound.gate.includes(heard.label);
      console.log(
        `  ${name}-${i}: label "${heard.label}" (${labelOk ? 'ok' : 'WRONG FAMILY'}), band 150-4000 Hz ${(share * 100).toFixed(0)}% (${bandOk ? 'ok' : 'TOO LOW'}), realism ${heard.realism}/10, tilt +${tiltDb} dB`,
      );
      if (bandOk && labelOk)
        accepted.push({ wav: outWav, raw: rawWav, onset: onset.at, tiltDb, ...heard, bandShare: share });
    }

    if (!accepted.length) {
      console.log(`  OUT: no take of ${name} cleared the gate in ${tries} generations — the game's own stays`);
      report[name] = { in: false, tries: usedHere, accepted: 0 };
      continue;
    }

    // the realism gate, against the sound this one replaces (gate rule 4) — only for a sound that replaces one
    const best = accepted.slice().sort((a, b) => b.realism - a.realism)[0];
    let oldHeard = null;
    let gateFour = true;
    if (sound.replaces !== 'new') {
      const oldBuf = oldWavBuffer(sound.replaces);
      if (oldBuf) {
        oldHeard = await listen(oldBuf, { key, as: sound.describe, model: 'gemini-pro-latest' });
        const oldLabelOk = sound.gate.includes(oldHeard.label);
        gateFour = best.realism >= oldHeard.realism || !oldLabelOk;
        console.log(
          `  old ${sound.replaces}: label "${oldHeard.label}" realism ${oldHeard.realism}/10 — new best realism ${best.realism}/10: ${gateFour ? 'passes' : 'DOES NOT CLEAR THE OLD ONE'}`,
        );
      }
    }
    if (!gateFour) {
      console.log(`  OUT: ${name} did not clear the sound it replaces — the game's own stays`);
      report[name] = { in: false, tries: usedHere, accepted: accepted.length, old: oldHeard, best };
      continue;
    }

    // fewer takes passed than wanted: vary the best one (±4-8% speed, a slightly different cut) rather than
    // spend more of the generation budget — the brief allows this ("three generations, or one good one varied")
    for (let k = 0; accepted.length < sound.takes; k++) {
      const rateMult = [1.04, 0.96, 1.07, 0.93][k % 4];
      const nudge = 0.004 * (k + 1);
      const outWav = `${CANDIDATES}/${name}-var${k}.wav`;
      shape(best.raw, outWav, { from: best.onset + nudge, seconds: sound.cut, tiltDb: best.tiltDb, rateMult });
      accepted.push({ ...best, wav: outWav, varied: true, rateMult });
      console.log(
        `  ${name}-var${k}: the ${(rateMult * 100 - 100).toFixed(0)}%-speed, re-cut take of ${best.wav.split('/').pop()}`,
      );
    }

    // cut the chosen takes into the files the game fetches, at the loudness the gate allows
    const old = oldLevel(name, sound.replaces);
    const target = old === null ? -18 : old + (MAY_BE_LOUDER.includes(name) ? 4 : 0);
    const files = [];
    accepted.slice(0, sound.takes).forEach((take, i) => {
      const out = `${PACK_DIR}/${name}-${i}.mp3`;
      cut(take.wav, out, { lufs: target, kbps: sound.kbps, mono: true });
      files.push({ file: `${name}-${i}.mp3`, label: take.label, realism: take.realism, bandShare: take.bandShare });
    });
    console.log(`  IN: ${name} — ${files.length} take(s) at ${target.toFixed(1)} LUFS (old ${old ?? 'n/a'})`);
    report[name] = { in: true, tries: usedHere, accepted: accepted.length, takes: files, old: oldHeard, target };
  }

  // what was asked, and what was chosen: written back into the manifest (never the audio itself — git-ignored)
  for (const [name, r] of Object.entries(report)) SFX.sounds[name].chosen = r;
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${spent} generation request(s) spent in all.`);
}

await run();
