// The built game in a real WebKit, with sound. The suites drive Chromium; what they cannot say is that Safari's
// engine also decodes and plays what the wild build fetches in the middle of a session — its music (src/wild/music)
// and its voices (src/wild/voice). This says it, at a desk's shape and at an emulated iPhone's.
//
// Not part of `npm test`: it needs Playwright's WebKit, which this repository does not depend on.
//
//   PLAYWRIGHT_CORE=<path to a playwright-core package> node tools/webkit-smoke.mjs
//     (its WebKit must be installed: `node <that path>/cli.js install webkit`)
//   BASE=https://… looks at a game that is already being served, instead of the build in dist/
//
// It is Playwright's build of WebKit on this machine — the engine Safari has, not Safari on a phone: no phone's
// memory, no phone's rules about when sound may start. A real iPhone is still a real iPhone.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serveDir } from './lib/static-server.mjs';

if (!process.env.PLAYWRIGHT_CORE) {
  console.error('set PLAYWRIGHT_CORE to the path of a playwright-core package whose WebKit is installed');
  process.exit(2);
}
const { webkit, devices } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE);

const linesOf = (who) =>
  Object.keys(JSON.parse(readFileSync(new URL(`../src/wild/voice/${who}/lines.json`, import.meta.url), 'utf8'))).map(
    (id) => `${who}/${id}`,
  );
const CLIPS = [...linesOf('warden'), ...linesOf('pa')];
const music = '__G.wild.feature("music")';
const voice = '__G.wild.feature("voice")';

const server = process.env.BASE ? null : await serveDir(fileURLToPath(new URL('../dist/', import.meta.url)));
const base = process.env.BASE ? process.env.BASE.replace(/\/$/, '') : server.url;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(!!ok);
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const browser = await webkit.launch({ headless: true });
console.log(`WebKit ${browser.version()}, ${base}`);

async function run(name, contextOptions, query, firstGesture) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  const until = (expression, label, timeout = 30000) =>
    page.waitForFunction(expression, null, { timeout, polling: 100 }).catch(() => {
      throw new Error(`timed out waiting for ${label}`);
    });
  try {
    await page.goto(`${base}/?${query}`);
    await until('window.__ready === true || !!window.__fatal', 'the game to start', 120000);
    check(`${name}: it starts, with the wild build`, await page.evaluate('!window.__fatal && !!__G.wild'));
    await firstGesture(page);
    await until('__G.audio.state === "running"', 'sound to run', 10000);
    check(`${name}: sound runs from the first gesture`, true);
    await until(`${music}.state.cue === "title"`, 'the title’s music', 30000);
    const title = await page.evaluate(`${music}.state`);
    check(
      `${name}: the title's music is fetched, decoded and playing in place of the game's own score`,
      title.installed && title.seconds > 60 && title.sounding >= 1,
      `${title.seconds.toFixed(1)} s`,
    );
    await until('__G.wild.feature("mix").state.built', 'the room', 10000);
    check(`${name}: the five spaces are built`, true);
    await page.evaluate('__G.debug.start(); __G.player.hidden = true; __G.enemies.clear(); void 0');
    await until(`${music}.state.cue === "infil"`, 'the mission’s music', 30000);
    await until(`${music}.state.loaded.includes("combat")`, 'the fight’s music to be ready', 30000);
    check(`${name}: on a mission the site's quiet comes in, and the fight's is fetched ahead of it`, true);
    await page.evaluate('__G.enemies.alert(__G.player.x, __G.player.z); __G.wild.emit("alarm", true); void 0');
    await until(`${music}.state.cue === "combat"`, 'the fight’s music', 10000);
    await until(`${voice}.state.spoken.includes("warden/alarm-0")`, 'WARDEN to speak', 10000);
    await page.evaluate('__G.debug.speed(4); void 0');
    await until(`${voice}.state.spoken.includes("pa/alarm-0")`, 'the address', 20000);
    await page.evaluate('__G.debug.speed(1); void 0');
    check(`${name}: the alarm — the fight's music, WARDEN aloud, then the public address`, true);
    const lengths = await page.evaluate(
      `(async () => { const out = []; for (const key of ${JSON.stringify(CLIPS)}) out.push([key, await ${voice}.seconds(key)]); return out; })()`,
    );
    const silent = lengths.filter(([, seconds]) => !(seconds > 0.5)).map(([key]) => key);
    check(`${name}: all ${lengths.length} voice clips decode`, silent.length === 0, silent.join(' '));
    for (const cue of ['hall', 'tense', 'overspeed', 'exfil', 'end']) {
      await page.evaluate(`${music}.debug({ force: '${cue}' }); void 0`);
      await until(`${music}.state.cue === "${cue}"`, `the cue ${cue}`, 30000);
    }
    const end = await page.evaluate(`${music}.state`);
    check(
      `${name}: all eight cues decode and play, and no more than three are kept decoded`,
      end.loaded.length <= 3 && Object.keys(end.failed).length === 0,
      `${end.loaded}`,
    );
    check(`${name}: nothing logged`, problems.length === 0, problems.join(' | ').slice(0, 400));
  } catch (error) {
    check(`${name}: ${error.message}`, false, problems.join(' | ').slice(0, 400));
  } finally {
    await context.close();
  }
}

try {
  await run('a desk', { viewport: { width: 1280, height: 720 } }, 'look=1&dynres=0&touch=0', async (page) => {
    // (M: on the title it does nothing but be the first key)
    await page.keyboard.press('KeyM');
  });
  await run('an emulated iPhone', { ...devices['iPhone 14 Pro landscape'] }, 'dynres=0', async (page) => {
    await page.touchscreen.tap(30, 30);
  });
} finally {
  await browser.close();
  await server?.close();
}
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
