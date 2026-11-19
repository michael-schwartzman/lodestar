// Turns chosen pictures into the tiles the game loads.
//
//   node tools/art/process.mjs [--set textures|matter] [--only rock,concrete] [--from art/candidates] [--preview .work/art/preview]
//
// For every entry of one list of tools/art/manifest.json — `textures`, the level's surfaces, or `matter`, the
// materials things are made of in the second look — it takes a picture: art/source/<name>.jpg, or with --from the
// candidate the manifest picks (<from>/<name>.<pick>.jpg) — and writes:
//   art/source/<name>.jpg                the picture as chosen, at working size (kept, so it can be worked again)
//   src/assets/art/<name>.<size>.webp    what the game loads: 1024, 512 and 256 pixels
//   (matter: src/assets/matter/<name>.<size>.webp, 512 and 256)
//   <preview>/<name>.jpg                 three by three of it, to look at for seams and repeats (with --preview)
// What is done to a picture depends on its kind:
//   tile     the light is flattened, all four edges are made to meet, it is graded to its target colour
//   tileX    a wall, floor at the bottom and ceiling at the top: flattened and made to meet from side to side only
//   overlay  a tile with the colour taken out (it is multiplied over paint)
//   image    one picture that does not repeat (a door): cropped and graded, nothing else
// The pixel work is done in a headless browser (tools/art/bench.html), which can decode, scale and encode
// pictures; the arithmetic is tools/art/pixels.mjs. No model is called from here: see tools/art/generate.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../lib/browser.mjs';
import { serveDir } from '../lib/static-server.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** the sizes the game asks for, by detail level (src/gfx/art.js) */
export const SIZES = [1024, 512, 256];
/** the sizes of a material's picture (the second look, src/look/matter.js): a desk's and a phone's */
export const MATTER_SIZES = [512, 256];
/**
 * Where each list of the manifest is written for the game to load, in which sizes, and how much of its own
 * colour a picture of it keeps (an entry may say otherwise). A surface's picture IS its colour. A material's
 * picture multiplies a part's own paint, and whatever colour it has of its own would tint that paint: it keeps
 * half.
 */
export const SETS = {
  textures: { out: 'src/assets/art', sizes: SIZES, chroma: 1 },
  matter: { out: 'src/assets/matter', sizes: MATTER_SIZES, chroma: 0.5 },
};

/** What is done to a picture of each kind: the size worked at, and the options for each step. */
export function jobFor(entry, set = SETS.textures) {
  const { sizes } = set;
  const common = {
    grade: entry.target ? { target: entry.target, tint: entry.tint ?? 0.35 } : null,
    grey: entry.kind === 'overlay',
    chroma: entry.chroma ?? set.chroma,
    quality: entry.quality,
  };
  if (entry.kind === 'image') {
    // a door leaf is twice as tall as it is wide
    const [aw, ah] = entry.shape || [1, 2];
    const k = Math.max(aw, ah);
    return {
      ...common,
      work: [(1024 * aw) / k, (1024 * ah) / k],
      flatten: null,
      seamless: null,
      sizes: sizes.map((s) => [String(s), (s * aw) / k, (s * ah) / k]),
    };
  }
  const sideways = entry.kind === 'tileX';
  return {
    ...common,
    work: [1024, 1024],
    flatten: { axes: sideways ? 'x' : 'xy', amount: entry.flatten ?? 1 },
    seamless: { x: true, y: !sideways, band: entry.band ?? 0.2 },
    sizes: sizes.map((s) => [String(s), s, s]),
  };
}

function options(argv) {
  const o = { only: null, set: 'textures', from: null, preview: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') o.only = argv[++i].split(',').filter(Boolean);
    else if (argv[i] === '--set') o.set = argv[++i];
    else if (argv[i] === '--from') o.from = argv[++i].replace(/\/$/, '');
    else if (argv[i] === '--preview') o.preview = argv[++i].replace(/\/$/, '');
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return o;
}

async function main() {
  const o = options(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(`${ROOT}tools/art/manifest.json`, 'utf8'));
  const set = SETS[o.set];
  if (!set || !Array.isArray(manifest[o.set])) throw new Error(`no set called ${o.set}`);
  const entries = manifest[o.set].filter((t) => !o.only || o.only.includes(t.name));
  mkdirSync(`${ROOT}art/source`, { recursive: true });
  mkdirSync(`${ROOT}${set.out}`, { recursive: true });
  if (o.preview) mkdirSync(`${ROOT}${o.preview}`, { recursive: true });

  const server = await serveDir(ROOT);
  const browser = await launchBrowser({ width: 800, height: 600 });
  let failed = 0;
  try {
    const page = await browser.newPage();
    await page.navigate(`${server.url}/tools/art/bench.html`);
    await page.waitFor('window.__ready === true', { timeoutMs: 30000, label: 'the bench' });
    for (const entry of entries) {
      const picked = o.from && entry.pick ? `${o.from}/${entry.name}.${entry.pick}.jpg` : null;
      const path = picked && existsSync(`${ROOT}${picked}`) ? picked : `art/source/${entry.name}.jpg`;
      if (!existsSync(`${ROOT}${path}`)) {
        console.error(`${entry.name}: no picture at ${path}`);
        failed++;
        continue;
      }
      const job = { ...jobFor(entry, set), url: `/${path}` };
      const made = JSON.parse(
        await page.evaluate(`window.makeTile(${JSON.stringify(job)}).then(JSON.stringify)`, { timeoutMs: 120000 }),
      );
      // the picture as chosen is only written when it came from somewhere else: working a source again must not wear it
      if (path !== `art/source/${entry.name}.jpg`)
        writeFileSync(`${ROOT}art/source/${entry.name}.jpg`, Buffer.from(made.source, 'base64'));
      let bytes = 0;
      for (const [size, data] of Object.entries(made.files)) {
        const buffer = Buffer.from(data, 'base64');
        bytes += buffer.length;
        writeFileSync(`${ROOT}${set.out}/${entry.name}.${size}.webp`, buffer);
      }
      if (o.preview) writeFileSync(`${ROOT}${o.preview}/${entry.name}.jpg`, Buffer.from(made.preview, 'base64'));
      console.log(
        `${entry.name.padEnd(14)} ${entry.kind.padEnd(8)} from ${path.padEnd(34)} seam ${made.before.seam.join(' / ')} → ${made.after.seam.join(' / ')}   mean ${made.before.mean.join(' ')} → ${made.after.mean.join(' ')}   spread ${made.before.std[1]} → ${made.after.std[1]}   ${(bytes / 1024).toFixed(0)} KB`,
      );
    }
    const problems = [...page.exceptions, ...page.logErrors];
    if (problems.length) {
      failed++;
      console.error(problems.join('\n'));
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
