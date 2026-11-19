// Writes the game's sounds to WAV files — exactly the buffers the built game renders in a browser and plays — so
// that they can be listened to: by a person, or by a model (tools/sound/listen.mjs).
//
// A development tool. Needs dist/ (`npm run build`).
//
//   node tools/sound/render.mjs [options] [name …]
//     name …            which sounds (and loops): none named means all of them
//     --out <dir>       where the files go (default: .work/sound — ignored by git)
//     --wild 0|1        the game as it was locked, or with the wild build's sounds (default: 1)
//     --take <n>        only this take of each sound (default: every take)
//     --list            print the names and stop
//     --module <file>   NO BUILD: render the recipes a source file exports (say src/wild/focus-sounds.js) as the
//                       game would — for trying a recipe again and again while it is being written. An export
//                       is a map of recipes, or { sounds, loops }; a map whose export name has LOOP in it is
//                       taken for loops
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../lib/browser.mjs';
import { options } from '../lib/gemini.mjs';
import { serveDir } from '../lib/static-server.mjs';
import { wavHeader } from '../lib/wav.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** In the page: an AudioBuffer as 16-bit PCM, interleaved, in base64. (Source text: it is evaluated there.) */
const PCM = `(buffer) => {
  const n = buffer.length, c = buffer.numberOfChannels, bytes = new Uint8Array(n * c * 2), view = new DataView(bytes.buffer);
  for (let ch = 0; ch < c; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) view.setInt16((i * c + ch) * 2, Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), true);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return { rate: buffer.sampleRate, channels: c, seconds: buffer.duration, pcm: btoa(s) };
}`;

const withWav = (name, loop, takes) =>
  takes.map((take, i) => {
    const pcm = Buffer.from(take.pcm, 'base64');
    return {
      name,
      take: i,
      takes: takes.length,
      loop,
      rate: take.rate,
      channels: take.channels,
      seconds: take.seconds,
      wav: Buffer.concat([wavHeader(pcm.length, take.rate, take.channels), pcm]),
    };
  });

/**
 * Renders recipes straight from a source file — no build — as the game renders its own (src/audio/audio.js):
 * every take through an offline context at 44 100 Hz, then `fitPeak`; a loop is stitched end to beginning first.
 * @param {string} modulePath from the repository's root, e.g. 'src/wild/focus-sounds.js'
 * @param {string[]} [names] none: every recipe the file exports
 */
export async function renderRecipes(modulePath, names = []) {
  const server = await serveDir(ROOT);
  const browser = await launchBrowser({ width: 320, height: 200 });
  try {
    const page = await browser.newPage();
    await page.navigate(`${server.url}/tools/sound/render.html`);
    const rendered = JSON.parse(
      await page.evaluate(
        `(async () => {
          const pcm = ${PCM};
          const mod = await import('/${modulePath}?' + Date.now());
          const { fitPeak, stitchLoop } = await import('/src/audio/synth.js');
          const sounds = {}, loops = {};
          for (const [exported, value] of Object.entries(mod)) {
            if (!value || typeof value !== 'object') continue;
            if (value.sounds || value.loops) { Object.assign(sounds, value.sounds); Object.assign(loops, value.loops); continue; }
            for (const [key, recipe] of Object.entries(value))
              if (recipe && typeof recipe.build === 'function') (/loop/i.test(exported) ? loops : sounds)[key] = recipe;
          }
          const wanted = ${JSON.stringify(names)};
          const out = [];
          for (const [key, recipe] of Object.entries(sounds)) {
            if (wanted.length && !wanted.includes(key)) continue;
            const takes = [];
            for (let take = 0; take < (recipe.takes || 1); take++) {
              const offline = new OfflineAudioContext(recipe.channels || 1, Math.max(1, Math.round(recipe.seconds * 44100)), 44100);
              recipe.build(offline, offline.destination, take);
              const buffer = await offline.startRendering();
              fitPeak(buffer, { min: 0.06, max: 0.95 });
              takes.push(pcm(buffer));
            }
            out.push({ name: key, loop: false, takes });
          }
          for (const [key, recipe] of Object.entries(loops)) {
            if (wanted.length && !wanted.includes(key)) continue;
            const offline = new OfflineAudioContext(1, Math.round(recipe.seconds * 44100), 44100);
            recipe.build(offline, offline.destination);
            const buffer = stitchLoop(await offline.startRendering(), 0.3);
            fitPeak(buffer, { min: 0.06, max: 0.95 });
            out.push({ name: key, loop: true, takes: [pcm(buffer)] });
          }
          return JSON.stringify(out);
        })()`,
        { timeoutMs: 180000 },
      ),
    );
    const missing = names.filter((name) => !rendered.some((r) => r.name === name));
    if (missing.length) throw new Error(`${modulePath} exports no recipe called ${missing.join(', ')}`);
    return rendered.flatMap((r) => withWav(r.name, r.loop, r.takes));
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * @param {object} o
 * @param {string[]} [o.names] none: all
 * @param {boolean} [o.wild]
 * @returns {Promise<{ name: string, take: number, takes: number, loop: boolean, rate: number, channels: number, seconds: number, wav: Buffer }[]>}
 */
export async function renderSounds({ names = [], wild = true } = {}) {
  const server = await serveDir(`${ROOT}dist/`);
  const browser = await launchBrowser({ width: 640, height: 360 });
  try {
    const page = await browser.newPage();
    await page.navigate(`${server.url}/?look=1&dynres=0&touch=0&wild=${wild ? 1 : 0}`);
    await page.waitFor('window.__ready === true || !!window.__fatal', {
      timeoutMs: 180000,
      label: 'the game to start',
    });
    // the wild build's own sounds are rendered after the game's: wait for them
    await page.evaluate('Promise.resolve(window.__G.wild && window.__G.wild.ready).then(() => true)', {
      timeoutMs: 180000,
    });
    const all = JSON.parse(
      await page.evaluate(
        '(() => { const b = __G.audio.debugBuffers(); return JSON.stringify({ sounds: [...b.sounds.keys()], loops: [...b.loops.keys()] }); })()',
      ),
    );
    const wanted = names.length ? names : [...all.sounds, ...all.loops];
    const out = [];
    for (const name of wanted) {
      const loop = !all.sounds.includes(name);
      if (loop && !all.loops.includes(name)) throw new Error(`there is no sound called ${name}`);
      const takes = JSON.parse(
        await page.evaluate(`(() => {
          const b = __G.audio.debugBuffers();
          const buffers = ${loop} ? [b.loops.get(${JSON.stringify(name)})] : b.sounds.get(${JSON.stringify(name)});
          return JSON.stringify(buffers.map(${PCM}));
        })()`),
      );
      out.push(...withWav(name, loop, takes));
    }
    return out;
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = options(process.argv.slice(2));
  const dir = typeof o.out === 'string' ? o.out : `${ROOT}.work/sound`;
  mkdirSync(dir, { recursive: true });
  const rendered =
    typeof o.module === 'string'
      ? await renderRecipes(o.module, o.list ? [] : o._)
      : await renderSounds({ names: o.list ? [] : o._, wild: o.wild !== '0' });
  if (o.list) console.log([...new Set(rendered.map((r) => `${r.name}${r.loop ? ' (loop)' : ''}`))].join('\n'));
  else
    for (const r of rendered) {
      if (o.take !== undefined && r.take !== +o.take) continue;
      const file = `${dir}/${r.name}${r.takes > 1 ? `-${r.take}` : ''}.wav`;
      writeFileSync(file, r.wav);
      console.log(`${file}  ${r.seconds.toFixed(2)} s  ${r.channels} ch`);
    }
}
