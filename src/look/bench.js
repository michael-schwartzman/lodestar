// The phone test page (docs/DESIGN.md, "The second look"): how much of the second look a device can carry.
//
// It is run by a person. Open the game with `?bench=1` on the device, leave it alone for about two minutes,
// and read the table it ends on — or press COPY and paste the one line under it somewhere.
//
// The page first times the screen itself, with nothing else going on. It then loads the game once for each set-up
// of look/setups.js — the game as it is, the second look as this device is given it, and that again with one
// thing changed each time — and each time stands at the adit's mouth (look/stations.js) and counts the frames
// drawn while the world is drawn once, twice and three times a frame. A screen takes so many pictures a second
// and no more (the rate just timed): a set-up that still makes that with the world drawn twice has room to
// spare, and one that does not make it drawing it once cannot be carried as it is. It also writes down the
// answer to one question the second look's
// shadows depend on and no desk can answer for a phone (look/probe.js): whether the graphics card blends
// neighbouring answers of a depth comparison (soft shadow edges for nothing) or hands back the nearest.
//
// Graph: route → time the screen → [load set-up → wait for the game → stand → time ×1, ×2, ×3 → keep the row] ×
// set-ups → table.
// Loop contract: one load to a set-up, in the order of the list, none twice; where the run has got to is the
// `step` in the address, and so are the rows so far (`rows`), the screen's own rate (`hz`) and the level of the
// look this device is given (`level`) — a browser that loads the page afresh between two set-ups, as the owner's
// did on 16 November 2026, loses nothing. (They are kept in sessionStorage as well, for what the address has no
// room for.) A game that has not started 25 seconds after its load is written down as failed and the run goes
// on. It ends at the table and starts nothing by itself.
import { shadowFilter } from './probe.js';
import { KEPT, SETUPS, addressOf, lineOf, packRows, unpackRows } from './setups.js';
import { STATIONS } from './stations.js';

const STORE = 'lodestar-bench';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** What the person asked for in the address, to be passed on to every load (setups.js KEPT). */
function kept(params) {
  // the set-up being run may say the same thing itself, first ("at Detail: Medium"): that one is not the person's
  const own = new URLSearchParams(SETUPS[Number(params.get('step'))]?.query || '');
  const pairs = [];
  for (const key of KEPT) {
    const values = params.getAll(key);
    if (own.has(key)) values.shift();
    if (values.length) pairs.push([key, values.at(-1)]);
  }
  return pairs;
}

function rowsSoFar(params) {
  // the address is what a fresh load cannot lose; the page's own store has the same rows with more in them
  const carried = unpackRows(params.get('rows'));
  let stored = [];
  try {
    const rows = JSON.parse(window.sessionStorage.getItem(STORE) || '[]');
    if (Array.isArray(rows)) stored = rows;
  } catch {
    // a browser that keeps nothing: the address has them
  }
  return carried.map((row) => stored.find((s) => s.id === row.id && !s.failed === !row.failed) || row);
}

function keep(rows) {
  try {
    window.sessionStorage.setItem(STORE, JSON.stringify(rows));
  } catch {
    // a browser that keeps nothing: the rows travel in the address all the same
  }
}

/** The rates a screen can have; one measured within a twelfth of one of them is that one. */
const SCREENS = [30, 48, 60, 72, 90, 120, 144];

/** How many pictures a second this screen takes, timed with nothing else going on. 0: it could not be timed. */
async function screenRate(ms) {
  if (typeof requestAnimationFrame !== 'function') return 0;
  let frames = 0;
  let first = 0;
  let last = 0;
  await new Promise((done) => {
    const tick = (now) => {
      if (!first) first = now;
      else frames++;
      last = now;
      if (now - first < ms) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
    // a page in the background is given no frames at all: do not wait for ever
    setTimeout(done, ms * 4);
  });
  if (frames < 3 || last <= first) return 0;
  const rate = (frames * 1000) / (last - first);
  const known = SCREENS.find((hz) => Math.abs(rate - hz) <= hz / 12);
  return known || Math.round(rate);
}

/**
 * Called before anything is built. An address that says `bench=1` and no `step` is the start of a run: what was
 * kept of an earlier one is thrown away, the screen is timed while nothing else is going on, and the first set-up
 * is gone to.
 * @returns {boolean} true: the page is leaving, build nothing
 */
export function route(params) {
  if (params.has('step') && SETUPS[Number(params.get('step'))]) return false;
  keep([]);
  screenRate(params.get('fast') === '1' ? 200 : 900).then((hz) =>
    window.location.replace(addressOf(0, kept(params), { hz })),
  );
  return true;
}

/** What the device is, in a few words: enough to tell two phones apart in a pasted line. */
function deviceName() {
  const agent = navigator.userAgent;
  const what =
    /iPhone|iPad|Android [\d.]+|Macintosh|Windows NT [\d.]+|Linux/.exec(agent)?.[0] || agent.slice(0, 24) || 'unknown';
  const system = /OS (\d+[_\d]*) like Mac/.exec(agent)?.[1]?.replace(/_/g, '.') || '';
  const screenSize = `${window.screen.width}x${window.screen.height}@${+window.devicePixelRatio.toFixed(2)}`;
  return [what + (system ? ` ${system}` : ''), screenSize].join('; ');
}

function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || 'unknown');
    // the long form on a desk: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)"
    return (/ANGLE \(([^)]*)\)/.exec(name)?.[1] || name).replace(/\s*\|\s*/g, ' ').slice(0, 80);
  } catch {
    return 'unknown';
  }
}

const element = (tag, style, text) => {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text != null) node.textContent = text;
  return node;
};

/** The table a run ends on, over the game: the rows, what they mean, the line, and a button that copies it. */
function show(result) {
  document.getElementById('bench')?.remove();
  const font = 'font: 13px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace;';
  const panel = element(
    'div',
    `position: fixed; inset: 0; z-index: 9999; overflow: auto; padding: 18px; background: rgba(5, 8, 11, 0.96); color: #dfe8e4; ${font}`,
  );
  panel.id = 'bench';
  panel.append(
    element(
      'div',
      'font-size: 17px; letter-spacing: 0.08em; color: #8dffcf; margin-bottom: 4px',
      'LODESTAR — WHAT THIS DEVICE CAN CARRY',
    ),
    element(
      'div',
      'color: #7f948e; margin-bottom: 14px; max-width: 74ch',
      `Frames a second at the adit’s mouth with the world drawn once, twice and three times a frame. ${result.hz ? `This screen was timed at ${result.hz} pictures a second, and can show no more` : 'This screen could not be timed (most show 60, some 120)'}: a row that still makes that drawing twice has room to spare; a row that does not make it drawing once is too much for this device. Rows C to G are row B with one thing changed: what a row gains over B is what that thing costs.`,
    ),
  );
  const table = element('table', 'border-collapse: collapse; width: 100%; max-width: 780px');
  const head = element('thead');
  const top = element('tr');
  for (const title of ['', 'SET-UP', '×1', '×2', '×3', 'TRIANGLES'])
    top.append(element('th', 'text-align: left; padding: 4px 10px 4px 0; color: #7f948e; font-weight: 400', title));
  head.append(top);
  const body = element('tbody');
  const cap = Math.max(...result.rows.flatMap((row) => row.rates || [0]));
  for (const row of result.rows) {
    const line = element('tr', 'border-top: 1px solid rgba(141, 255, 207, 0.2)');
    line.append(
      element('td', 'padding: 6px 10px 6px 0; color: #8dffcf', row.id),
      element('td', 'padding: 6px 10px 6px 0', row.name),
    );
    if (row.failed)
      line.append(element('td', 'padding: 6px 10px 6px 0; color: #ff4a43', `did not start: ${row.failed}`));
    else {
      for (const rate of row.rates)
        // amber: this set-up has dropped below nine tenths of the best rate the device showed
        line.append(
          element('td', `padding: 6px 10px 6px 0; color: ${rate < cap * 0.9 ? '#ffb44a' : '#dfe8e4'}`, String(rate)),
        );
      line.append(
        element(
          'td',
          'padding: 6px 10px 6px 0; color: #7f948e',
          row.triangles ? row.triangles.toLocaleString('en-GB') : '—',
        ),
      );
    }
    body.append(line);
    if (row.broken) {
      const warning = element('tr');
      const cell = element(
        'td',
        'padding: 0 10px 8px 0; color: #ff4a43',
        `${row.broken} of this set-up’s shaders did not compile on this device: part of the picture was missing, so these rates are too good.`,
      );
      cell.colSpan = 6;
      warning.dataset.warning = '1';
      warning.append(cell);
      body.append(warning);
    }
  }
  table.append(head, body);
  const facts = element(
    'div',
    'margin: 14px 0; color: #7f948e',
    `${result.device} · canvas ${result.canvas} · detail ${result.quality} · ${result.gpu} · shadow sampler: ${result.shadowFilter} · screen: ${result.hz ? `${result.hz} Hz` : 'not timed'} · level: ${result.level === 'hand' ? 'held in the hand (four lamps at once, smaller pictures)' : result.level === 'desk' ? 'desk' : 'unknown'}`,
  );
  const line = element(
    'textarea',
    `display: block; width: 100%; max-width: 780px; height: 5.6em; margin: 0 0 10px; padding: 8px; background: #0a1116; color: #dfe8e4; border: 1px solid rgba(141, 255, 207, 0.5); ${font}`,
  );
  line.value = result.line;
  line.readOnly = true;
  const button = (label, primary) =>
    element(
      'button',
      `margin: 0 10px 10px 0; padding: 12px 18px; border: 1px solid #8dffcf; background: ${primary ? '#8dffcf' : 'transparent'}; color: ${primary ? '#05080b' : '#8dffcf'}; letter-spacing: 0.08em; ${font}`,
      label,
    );
  const copy = button('COPY THE LINE', true);
  copy.dataset.copy = '1';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.line);
      copy.textContent = 'COPIED';
    } catch {
      // no clipboard to be had (an old browser, a page that is not secure): the line is selected to be copied by hand
      line.focus();
      line.select();
      copy.textContent = 'SELECTED — COPY IT BY HAND';
    }
  });
  const again = button('RUN IT AGAIN', false);
  again.addEventListener('click', () => window.location.assign(`?bench=1${result.kept}`));
  const play = button('PLAY THE SECOND LOOK', false);
  play.addEventListener('click', () => window.location.assign('?look=2'));
  panel.append(table, facts, line, copy, again, play);
  document.body.append(panel);
}

/**
 * Called once the game is ready, on a load that `route` let through: times this set-up, keeps its row, and goes
 * on to the next — or, after the last, shows the table.
 * @param {object} o
 * @param {object} o.G          the game (main.js): state, frames, extraDraws, debug.teleport, player, world, look
 * @param {object} o.renderer   three's
 * @param {string} o.quality    the detail level in use
 * @param {URLSearchParams} o.params
 */
export async function run({ G, renderer, quality, params }) {
  const step = Number(params.get('step'));
  const setup = SETUPS[step];
  const fast = params.get('fast') === '1';
  const seconds = fast ? 0.35 : 2;
  const row = { id: setup.id, name: setup.name };
  window.__bench = { done: false, step };

  // the game starts itself (`autostart=1`); give it time to
  const began = performance.now();
  while (G.state !== 'playing' && performance.now() - began < 25000) await sleep(100);
  if (G.state !== 'playing') row.failed = `the game was ${G.state} after 25 seconds`;
  else {
    // nobody is to shoot at the camera, or see it, while it stands and counts
    G.player.hidden = true;
    const at = STATIONS.mouth;
    G.debug.teleport(at.x, at.z, at.yaw);
    G.player.pitch = at.pitch;
    await sleep(fast ? 300 : 1500);
    row.rates = [];
    for (const draws of [1, 2, 3]) {
      G.extraDraws = draws - 1;
      await sleep(fast ? 100 : 500);
      if (draws === 1) row.triangles = renderer.info.render.triangles;
      const frames = G.frames;
      const from = performance.now();
      await sleep(seconds * 1000);
      row.rates.push(+((G.frames - frames) / ((performance.now() - from) / 1000)).toFixed(1));
    }
    G.extraDraws = 0;
    row.look = G.look;
    row.keys = (G.world.keys || []).length;
    row.mirror = !!G.world.env;
    // how many of the shaders this set-up needed did not compile or link on this device (three keeps a note on
    // each that failed): such a set-up draws less than it should, and its rates are not to be believed
    row.broken = (renderer.info.programs || []).filter((p) => p.diagnostics && p.diagnostics.runnable === false).length;
  }

  const rows = rowsSoFar(params).filter((r) => r.id !== setup.id);
  rows.push(row);
  rows.sort((a, b) => SETUPS.findIndex((s) => s.id === a.id) - SETUPS.findIndex((s) => s.id === b.id));
  keep(rows);
  const keeping = kept(params);
  // the level of the look this device is given, and the detail it is at: said by the set-up that is all of it,
  // and carried from there on (the last set-up is at another detail on purpose)
  const level =
    setup.query === 'look=2' && !row.failed
      ? `${G.touch || G.quality === 'low' ? 'hand' : 'desk'}.${G.quality}`
      : params.get('level') || '';
  const hz = Number(params.get('hz')) || 0;
  if (step + 1 < SETUPS.length) {
    window.location.replace(addressOf(step + 1, keeping, { rows: packRows(rows), hz, level }));
    return;
  }
  const result = {
    done: true,
    rows,
    device: deviceName(),
    canvas: `${renderer.domElement.width}x${renderer.domElement.height}`,
    quality: level.split('.')[1] || quality,
    gpu: gpuName(renderer),
    shadowFilter: shadowFilter(),
    hz,
    level: level.split('.')[0],
    kept: keeping.map(([key, value]) => `&${key}=${encodeURIComponent(value)}`).join(''),
  };
  result.line = lineOf(result);
  window.__bench = result;
  show(result);
}
