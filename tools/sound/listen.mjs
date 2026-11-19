// Has a model LISTEN to sounds, and say what it hears. Every sound of this game was made by a program and, until
// 17 November 2026, checked only by what a program can measure; nobody had heard one. A model that takes sound in
// is not a person's ear — it is the nearest thing to one that can be asked two hundred times in a night.
//
// A development tool. The build never runs it and the game never calls a model.
//
//   node tools/sound/listen.mjs --key-file <env file> [options] file.wav [file.wav …]
//     --as "<what it is meant to be>"   also asked: how convincing is it as that, what gives it away, what to change
//     --model <id>                      default gemini-3.8-flash
//     --json                            print one line of JSON a file, and nothing else
//
// For each file it is asked, BLIND (it is not told what the sound is meant to be):
//   heard    one sentence: what this is the sound of
//   label    the nearest of LABELS below
// and then, with `--as`:
//   realism  1 … 10: how convincing it is as a recording of that
//   faults   what gives it away as synthetic, most important first (up to three)
//   fixes    what to change in how it is synthesised, one for each fault
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate, options, readKey } from '../lib/gemini.mjs';

/** what a sound can be said to be, blind — the game's sounds are all one of these */
export const LABELS = [
  'gunshot, suppressed',
  'gunshot, unsuppressed',
  'shotgun blast',
  'gun handling (magazine, bolt, pump)',
  'shell casing on a hard floor',
  'bullet impact on concrete',
  'bullet impact or ricochet on metal',
  'bullet passing close by',
  'footstep',
  'heavy machine footstep',
  'explosion',
  'electric zap or arc',
  'servo or electric motor',
  'drone or rotor',
  'alarm or siren',
  'door',
  'glass breaking',
  'knife or blade',
  'metal scraping or dragging',
  'body or heavy object falling',
  'machine hum or drone (steady)',
  'wind or air',
  'water drip',
  'radio or voice',
  'synthetic beep or video game bleep',
  'user interface click',
  'music',
  'noise burst (nothing recognisable)',
  'other',
];

const BLIND = {
  type: 'OBJECT',
  properties: { heard: { type: 'STRING' }, label: { type: 'STRING', enum: LABELS } },
  required: ['heard', 'label'],
};
const JUDGED = {
  type: 'OBJECT',
  properties: {
    realism: { type: 'INTEGER' },
    faults: { type: 'ARRAY', items: { type: 'STRING' } },
    fixes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['realism', 'faults', 'fixes'],
};

/**
 * @param {Buffer} wav the bytes of a WAV file
 * @param {object} o
 * @param {string} o.key
 * @param {string} [o.as] what it is meant to be
 * @param {string} [o.model]
 * @returns {Promise<{ heard: string, label: string, realism?: number, faults?: string[], fixes?: string[] }>}
 */
export async function listen(wav, { key, as = '', model = 'gemini-3.8-flash' }) {
  const sound = { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } };
  const ask = async (text, schema) => {
    const answer = await generate(
      model,
      {
        contents: [{ role: 'user', parts: [sound, { text }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
      },
      key,
    );
    return JSON.parse(answer.text);
  };
  const blind = await ask(
    'Listen to this short sound. It may be a recording or it may be synthesised. In `heard`, say in one plain ' +
      'sentence what it is the sound of — what you would think it was if you heard it with no picture. In `label`, ' +
      'give the nearest label from the list.',
    BLIND,
  );
  if (!as) return blind;
  const judged = await ask(
    `This sound was synthesised by a program for a video game. It is meant to be: ${as}. In \`realism\`, rate from ` +
      '1 to 10 how convincing it is as a real recording of exactly that (1: an obvious synthetic beep or burst of ' +
      'noise; 5: recognisable but plainly synthetic; 8: would pass in a game; 10: indistinguishable from a ' +
      'recording). In `faults`, list up to three things that give it away, the most important first, each in a ' +
      'few words. In `fixes`, give for each fault one concrete change to the synthesis (which layer to add, which ' +
      'band to raise or cut, how long an attack or a tail should be, in milliseconds or hertz).',
    JUDGED,
  );
  return { ...blind, ...judged };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = options(process.argv.slice(2));
  const key = readKey(o['key-file']);
  for (const file of o._) {
    const heard = await listen(readFileSync(file), { key, as: typeof o.as === 'string' ? o.as : '', model: o.model });
    if (o.json) console.log(JSON.stringify({ file, ...heard }));
    else {
      console.log(`${file}\n  heard:   ${heard.heard}\n  label:   ${heard.label}`);
      if (heard.realism !== undefined) {
        console.log(`  realism: ${heard.realism} / 10`);
        heard.faults.forEach((fault, i) => console.log(`  fault:   ${fault}\n    fix:   ${heard.fixes[i] || ''}`));
      }
    }
  }
}
