// Asks a music model for the wild build's music — a cue a scene (tools/sound/manifest.json says which, and with
// what words) — and has a model that takes sound in say what each candidate is. A person, or the lead of the work,
// then chooses; tools/sound/cut.mjs makes the chosen one into the file the game fetches.
//
// A development tool. The build never runs it and the game never calls a model.
//
//   node tools/sound/music.mjs --key-file <env file> [options]
//     --only combat,exfil     which cues (default: all)
//     --candidates 2          how many to ask for, for each
//     --out sound/candidates  where they go (ignored by git)
//     --model <id>            overrides the manifest's
//     --listen-only           do not ask for music: listen again to what is already there
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, options, readKey } from '../lib/gemini.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${ROOT}tools/sound/manifest.json`, 'utf8')).music;

const VERDICT = {
  type: 'OBJECT',
  properties: {
    heard: { type: 'STRING' },
    bpm: { type: 'INTEGER' },
    vocals: { type: 'BOOLEAN' },
    intensity: { type: 'INTEGER' },
    steadyFrom: { type: 'NUMBER' },
    steadyTo: { type: 'NUMBER' },
    breaks: { type: 'STRING' },
    quality: { type: 'INTEGER' },
    flaw: { type: 'STRING' },
  },
  required: ['heard', 'bpm', 'vocals', 'intensity', 'steadyFrom', 'steadyTo', 'breaks', 'quality', 'flaw'],
};

/** What a candidate is, as a model hears it. */
export async function hear(mp3, key, model = 'gemini-3.8-flash') {
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
                'You are the audio director of a stealth action video game. Listen to all of this piece. `heard`: ' +
                'one sentence — instruments, feel. `bpm`: its tempo. `vocals`: true if there is any singing, choir ' +
                'or speech anywhere. `intensity`: 1 (near silence) to 10 (as loud and fast as music gets), for its ' +
                'main body. `steadyFrom` and `steadyTo`: in seconds, the longest stretch that keeps one level and ' +
                'one feel and could be looped under gameplay — leave out an intro that builds, a breakdown, an ' +
                'ending that fades or stops. `breaks`: where it drops out, builds or changes feel, with seconds, or ' +
                '"none". `quality`: 1 to 10, as a produced piece. `flaw`: its biggest fault in a few words.',
            },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: VERDICT },
    },
    key,
  );
  return JSON.parse(answer.text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = options(process.argv.slice(2));
  const key = readKey(o['key-file']);
  const out = `${ROOT}${typeof o.out === 'string' ? o.out : 'sound/candidates'}`;
  mkdirSync(out, { recursive: true });
  const only = typeof o.only === 'string' ? o.only.split(',') : Object.keys(manifest.cues);
  const n = +(o.candidates || 2);
  for (const name of only) {
    const cue = manifest.cues[name];
    if (!cue) throw new Error(`the manifest has no cue called ${name}`);
    if (!o['listen-only']) {
      const taken = readdirSync(out).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.mp3')).length;
      for (let i = 0; i < n; i++) {
        const made = await generate(
          o.model || manifest.model,
          {
            contents: [{ role: 'user', parts: [{ text: `${manifest.preamble} ${cue.prompt}` }] }],
            generationConfig: { responseModalities: ['AUDIO'] },
          },
          key,
        );
        if (!made.audio.length) throw new Error(`${name}: the model sent no sound (${made.text.slice(0, 120)})`);
        writeFileSync(`${out}/${name}-${taken + i}.mp3`, made.audio[0].bytes);
        console.log(`${name}-${taken + i}.mp3  ${made.audio[0].bytes.length} bytes`);
      }
    }
    for (const file of readdirSync(out).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.mp3'))) {
      const verdict = `${out}/${file.replace('.mp3', '.json')}`;
      if (existsSync(verdict) && !o['listen-only']) continue;
      const heard = await hear(readFileSync(`${out}/${file}`), key);
      writeFileSync(verdict, JSON.stringify(heard, null, 2));
      const fits = heard.intensity >= cue.intensity[0] && heard.intensity <= cue.intensity[1] && !heard.vocals;
      console.log(
        `${file}  ${fits ? 'fits' : 'DOES NOT FIT'}  intensity ${heard.intensity} (wanted ${cue.intensity.join('–')})  ${heard.bpm} bpm  ` +
          `steady ${heard.steadyFrom}–${heard.steadyTo} s  quality ${heard.quality}  vocals ${heard.vocals}\n    ${heard.heard}\n    breaks: ${heard.breaks} · flaw: ${heard.flaw}`,
      );
    }
  }
}
