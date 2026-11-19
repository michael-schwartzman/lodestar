// Makes candidate pictures for the game's surfaces with Google's Gemini image models ("Nano Banana").
//
// A development tool. The build never runs it and the game never calls a model: what it makes is looked at by a
// person, the chosen picture is processed by tools/art/process.mjs, and the result is committed like any other
// source file (see docs/DESIGN.md, "Generated art").
//
//   GEMINI_API_KEY=… node tools/art/generate.mjs [options]
//     --set textures|matter    which list of the manifest: the surfaces of the level, or the materials things
//                              are made of in the second look (default: textures)
//     --only rock,concrete     which entries of that list (default: all)
//     --candidates 2           how many pictures to ask for per entry
//     --model <id>             overrides the manifest's model
//     --size 1K|2K|4K          overrides the manifest's picture size
//     --out art/candidates     where the pictures go (ignored by git)
//     --key-file <env file>    read GEMINI_API_KEY from an env file instead of the environment
//     --list-models            print the image models the key can call, and stop
//
// The key is only ever held in memory: it is sent in a request header, never put in an address, a file or a log.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** how many times one picture is asked for before it is given up: then the run goes on, and fails at the end */
const ATTEMPTS = 3;
const WAITS = [4000, 12000];

function options(argv) {
  const o = {
    only: null,
    set: 'textures',
    candidates: 2,
    model: null,
    size: null,
    out: 'art/candidates',
    keyFile: null,
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') o.only = argv[++i].split(',').filter(Boolean);
    else if (a === '--set') o.set = argv[++i];
    else if (a === '--candidates') o.candidates = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--size') o.size = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--key-file') o.keyFile = argv[++i];
    else if (a === '--list-models') o.list = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return o;
}

/** The key, from the environment or from one line of an env file. Nothing else in that file is read into anything. */
function readKey(keyFile) {
  if (keyFile) {
    const line = readFileSync(keyFile, 'utf8')
      .split('\n')
      .find((l) => /^\s*GEMINI_API_KEY\s*=/.test(l));
    if (line)
      return line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
  }
  return process.env.GEMINI_API_KEY || '';
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The whole instruction for one picture: what it shows, then how every picture of its kind is to be taken. */
export function promptFor(entry, manifest) {
  const style = manifest.styles?.[entry.kind] || '';
  return `${entry.prompt.trim()} ${style}`.trim();
}

async function main() {
  const o = options(process.argv.slice(2));
  const key = readKey(o.keyFile);
  if (!key) throw new Error('no key: set GEMINI_API_KEY, or pass --key-file <env file>');
  // whatever goes wrong, the key is never part of what is printed
  const safe = (text) => String(text).split(key).join('<key>');
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };

  if (o.list) {
    const r = await fetch(`${API}?pageSize=200`, { headers });
    const names = ((await r.json()).models || []).map((m) => `${m.name.replace('models/', '')}  (${m.displayName})`);
    console.log(names.filter((n) => /image|banana/i.test(n)).join('\n'));
    return;
  }

  const manifest = JSON.parse(readFileSync(`${ROOT}tools/art/manifest.json`, 'utf8'));
  const model = o.model || manifest.model;
  const size = o.size || manifest.imageSize;
  if (!Array.isArray(manifest[o.set])) throw new Error(`the manifest has no set called ${o.set}`);
  const entries = manifest[o.set].filter((t) => !o.only || o.only.includes(t.name));
  if (o.only)
    for (const name of o.only)
      if (!entries.some((t) => t.name === name)) throw new Error(`not in the manifest: ${name}`);
  const out = `${ROOT}${o.out}`;
  mkdirSync(out, { recursive: true });

  let failed = 0;
  let made = 0;
  // every question put to the service, answered with a picture or not: what a run cost is this
  let asked = 0;
  for (const entry of entries) {
    const text = promptFor(entry, manifest);
    for (let k = 1; k <= o.candidates; k++) {
      const imageConfig = { aspectRatio: entry.aspect || '1:1' };
      // the first Nano Banana makes one size only, and refuses to be told one
      if (size && !/2\.5/.test(model)) imageConfig.imageSize = size;
      const body = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig },
      });
      let saved = false;
      let why = '';
      for (let attempt = 1; attempt <= ATTEMPTS && !saved; attempt++) {
        const began = Date.now();
        asked++;
        try {
          const r = await fetch(`${API}/${model}:generateContent`, { method: 'POST', headers, body });
          if (!r.ok) {
            why = `HTTP ${r.status} ${safe(await r.text())
              .slice(0, 200)
              .replace(/\s+/g, ' ')}`;
            // only a busy or failing service is worth asking again
            if (r.status !== 429 && r.status < 500) break;
          } else {
            const parts = (await r.json())?.candidates?.[0]?.content?.parts || [];
            const picture = parts.map((p) => p.inlineData || p.inline_data).find((d) => d?.data);
            if (!picture) why = 'the answer had no picture in it';
            else {
              const type = picture.mimeType || picture.mime_type || 'image/png';
              const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
              const file = `${entry.name}.${k}.${ext}`;
              const bytes = Buffer.from(picture.data, 'base64');
              writeFileSync(`${out}/${file}`, bytes);
              const seconds = ((Date.now() - began) / 1000).toFixed(1);
              console.log(`${file}  ${(bytes.length / 1024).toFixed(0)} KB  ${seconds} s`);
              saved = true;
              made++;
            }
          }
        } catch (error) {
          why = safe(error.cause?.code || error.message);
        }
        if (!saved && attempt < ATTEMPTS) await sleep(WAITS[attempt - 1]);
      }
      if (!saved) {
        failed++;
        console.error(`${entry.name}.${k}: given up — ${why}`);
      }
    }
  }
  console.log(
    `${made} pictures made with ${model}${size ? ` at ${size}` : ''}; ${failed} given up; ${asked} requests sent`,
  );
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
