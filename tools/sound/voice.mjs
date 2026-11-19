// Has a speech model say the lines the wild build speaks aloud — WARDEN's (src/wild/warden.js) and the site's
// public address (src/wild/voice.js) — gives each speaker its colour, and has a model that takes sound in write
// down what it hears: a clip is kept only if the words that come back are the words that were asked for.
//
// A development tool; needs ffmpeg. The build never runs it and the game never calls a model.
//
//   node tools/sound/voice.mjs --key-file <env file> [options]
//     --who warden,pa      which speakers (default: all the manifest has)
//     --only alarm-0,…     which lines (default: every line that has no clip, or whose words have changed)
//     --again              every line, whether it has a clip or not
//     --tries 3            how many times a line is asked for before it is given up
//     --raw sound/candidates/voice   where what the model said is kept, uncoloured (ignored by git)
//
// What it leaves: src/wild/voice/<who>/<line>.mp3 and src/wild/voice/<who>/lines.json — for each clip the words
// it was made from, the words a model heard in it, and its length. test/unit/wild-voice.test.mjs holds the two
// together: a line that is reworded has no clip until this is run again.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, options, readKey } from '../lib/gemini.mjs';
import { wavHeader } from '../lib/wav.mjs';
import { cut } from './cut.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The words of a line as they are compared: its letters and figures, nothing else. */
export const wordsOf = (text) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Every line a speaker has: { id: words }, in the order they are written. */
export async function linesOf(who) {
  if (who === 'warden') {
    const { LINES } = await import('../../src/wild/warden.js');
    return Object.fromEntries(
      Object.entries(LINES).flatMap(([event, lines]) => lines.map((line, n) => [`${event}-${n}`, line])),
    );
  }
  const { SPOKEN } = await import('../../src/wild/voice.js');
  return { ...SPOKEN[who] };
}

const HEARD = {
  type: 'OBJECT',
  properties: { words: { type: 'STRING' }, voice: { type: 'STRING' } },
  required: ['words', 'voice'],
};

/** What a model hears in a clip: the words, and in a few of its own how the speaker sounds. */
export async function hear(mp3, key, model) {
  const answer = await generate(
    model,
    {
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/mp3', data: mp3.toString('base64') } },
            {
              text:
                'Listen to this recording of one voice. In `words`, write down exactly the words that are spoken — ' +
                'all of them, in order, and nothing that is not spoken. In `voice`, say in at most eight words how ' +
                'the speaker sounds (their manner, and what the recording is like).',
            },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: HEARD },
    },
    key,
    { timeoutMs: 60000 },
  );
  return JSON.parse(answer.text);
}

/** One line said by the speech model: the bytes of a WAV file (24 kHz, one channel). */
async function say(text, { model, voice }, key) {
  const said = await generate(
    model,
    {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    },
    key,
    { timeoutMs: 60000 },
  );
  const sound = said.audio[0];
  if (!sound) throw new Error('the speech model sent no sound');
  if (!/L16|pcm/i.test(sound.mime)) return sound.bytes;
  const rate = +(/rate=(\d+)/.exec(sound.mime)?.[1] || 24000);
  return Buffer.concat([wavHeader(sound.bytes.length, rate, 1), sound.bytes]);
}

/** the quiet before the first word and after the last is taken off: a line begins when it is said */
const TRIM =
  'silenceremove=start_periods=1:start_threshold=-48dB:detection=peak,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-48dB:detection=peak,areverse';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = options(process.argv.slice(2));
  const key = readKey(o['key-file']);
  const manifest = JSON.parse(readFileSync(`${ROOT}tools/sound/manifest.json`, 'utf8')).voice;
  const raw = `${ROOT}${typeof o.raw === 'string' ? o.raw : 'sound/candidates/voice'}`;
  const tries = +(o.tries || 3);
  const speakers = typeof o.who === 'string' ? o.who.split(',') : Object.keys(manifest.speakers);
  let bad = 0;
  for (const who of speakers) {
    const speaker = manifest.speakers[who];
    if (!speaker) throw new Error(`the manifest has no speaker called ${who}`);
    const lines = await linesOf(who);
    const dir = `${ROOT}src/wild/voice/${who}`;
    mkdirSync(dir, { recursive: true });
    mkdirSync(`${raw}/${who}`, { recursive: true });
    const index = `${dir}/lines.json`;
    const kept = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) : {};
    const only = typeof o.only === 'string' ? o.only.split(',') : null;
    const todo = Object.keys(lines).filter((id) =>
      only
        ? only.includes(id)
        : o.again || kept[id]?.text !== lines[id] || !kept[id]?.said || !existsSync(`${dir}/${id}.mp3`),
    );
    const record = () => {
      // in the order the lines are written, and only the lines there are
      const ordered = Object.fromEntries(
        Object.keys(lines)
          .filter((id) => kept[id])
          .map((id) => [id, kept[id]]),
      );
      writeFileSync(index, `${JSON.stringify(ordered, null, 2)}\n`);
    };
    const one = async (id) => {
      const text = lines[id];
      const direction = speaker.directions?.[id] || speaker.direction || '';
      const unwanted = speaker.unwanted ? new RegExp(speaker.unwanted, 'i') : null;
      let best = null;
      for (let attempt = 0; attempt < tries && !best?.said; attempt++) {
        const wav = `${raw}/${who}/${id}-${attempt}.wav`;
        const coloured = `${raw}/${who}/${id}-${attempt}-coloured.wav`;
        const mp3 = `${raw}/${who}/${id}-${attempt}.mp3`;
        // (the speech model reads a manner out as often as it takes it: the last try asks for the words alone)
        const asked = direction && attempt < tries - 1 ? `${direction} ${text}` : text;
        try {
          writeFileSync(wav, await say(asked, { model: manifest.model, voice: speaker.voice }, key));
          // its colour first, into a file of its own: the cut measures and fades what it is given, as long as it is
          const run = spawnSync(
            'ffmpeg',
            ['-hide_banner', '-nostdin', '-y', '-i', wav, '-af', `${TRIM},${speaker.colour}`, '-ar', '44100', coloured],
            { encoding: 'utf8' },
          );
          if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr.slice(-300)}`);
          const made = cut(coloured, mp3, { mono: true, lufs: speaker.lufs, kbps: speaker.kbps });
          // what is listened to is the clip itself, in its colour: what the player will hear
          const heard = await hear(readFileSync(mp3), key, manifest.listener);
          const right = wordsOf(heard.words) === wordsOf(text);
          const manner = !unwanted || !unwanted.test(heard.voice);
          const said = right && manner && made.seconds <= (speaker.longest || 60);
          if (!best || said || (right && !best.right)) best = { mp3, said, right, heard, seconds: made.seconds };
          if (!said)
            console.log(
              `  ${who}/${id} try ${attempt + 1}: ${right ? `${made.seconds.toFixed(1)} s, ${heard.voice}` : `asked "${text}", heard "${heard.words}"`}`,
            );
        } catch (error) {
          console.log(`  ${who}/${id} try ${attempt + 1}: ${error.message}`);
        }
      }
      if (!best) {
        bad++;
        return console.log(`✖ ${who}/${id}: no clip could be made`);
      }
      // (a clip whose words are right but whose manner or length is not is kept, and said to be so)
      if (!best.right) bad++;
      writeFileSync(`${dir}/${id}.mp3`, readFileSync(best.mp3));
      kept[id] = {
        text,
        heard: best.heard.words,
        said: best.right,
        voice: best.heard.voice,
        seconds: +best.seconds.toFixed(2),
        bytes: statSync(`${dir}/${id}.mp3`).size,
      };
      record();
      console.log(
        `${best.said ? '✔' : best.right ? '~' : '✖'} ${who}/${id}  ${best.seconds.toFixed(1)} s  ${kept[id].bytes} bytes  — ${best.heard.voice}`,
      );
    };
    // three at a time: the speech model takes a few seconds a line
    const queue = [...todo];
    await Promise.all(
      [0, 1, 2].map(async () => {
        for (let id = queue.shift(); id; id = queue.shift()) await one(id);
      }),
    );
    record();
    const all = Object.keys(lines);
    console.log(
      `${who}: ${all.filter((id) => kept[id]?.said).length} of ${all.length} lines have a clip that says them`,
    );
  }
  process.exitCode = bad ? 1 : 0;
}
