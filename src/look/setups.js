// The set-ups the phone test page goes through (look/bench.js), in order: the game as it is; the second look as
// the device is given it; and then that again with one thing changed each time — a piece left out, or made
// plainer, or the detail turned down — so that what each costs on a device can be read off two rows.
//
// (The first version, of 15 November 2026, added the look a piece at a time instead. Run on the owner's iPhone it
// said what the whole cost and not what to drop; and it lost two of its rows, which were kept only in the page's
// own store and went when the browser loaded the page afresh. Rows now travel in the address: packRows.)
//
// id: the letter it has in the table and in the line to copy. query: what the address says for it.
// No three.js and no browser in here.
export const SETUPS = [
  { id: 'A', name: 'The game as it is', query: 'look=1' },
  { id: 'B', name: 'The second look, all this device is given of it', query: 'look=2' },
  { id: 'C', name: '… without the key lights and their shadows', query: 'look=2&key=0' },
  { id: 'D', name: '… without the materials', query: 'look=2&mats=0' },
  { id: 'E', name: '… without the captured places', query: 'look=2&env=0' },
  { id: 'F', name: '… with materials laid on from one side', query: 'look=2&mats=cheap' },
  { id: 'G', name: '… at Detail: Medium', query: 'look=2&q=medium' },
];

/**
 * The address of a set-up: the bench's own switches, the set-up's, and the game started without sound or a
 * resolution that changes under the measurement. `keep` is what the person asked for and every load must keep;
 * a set-up's own switches come before it, and win. `carry` is what the run has found out so far: its rows,
 * packed, the screen's own rate, and the level of the look the device is given ('hand' or 'desk').
 * @param {number} step
 * @param {string[][]} [keep] pairs, e.g. [['q', 'low']]
 * @param {{ rows?: string, hz?: number | string, level?: string }} [carry]
 */
export function addressOf(step, keep = [], carry = {}) {
  const kept = keep.map(([key, value]) => `&${key}=${encodeURIComponent(value)}`).join('');
  const rows = carry.rows ? `&rows=${carry.rows}` : '';
  const hz = carry.hz ? `&hz=${encodeURIComponent(carry.hz)}` : '';
  const level = carry.level ? `&level=${encodeURIComponent(carry.level)}` : '';
  return `?bench=1&step=${step}&${SETUPS[step].query}&autostart=1&noaudio=1&dynres=0${kept}${hz}${level}${rows}`;
}

/** What a person may put in the address that every set-up must then keep: the detail level, touch, a quick run. */
export const KEPT = ['q', 'touch', 'fast'];

/**
 * The rows of a run as one word that can stand in an address as it is: `A.60-60-41.5.0.310000~B.x~…` — a row's
 * letter, its three rates, how many of its shaders failed, how many triangles a frame; `x` for one that did not
 * start.
 */
export function packRows(rows) {
  return rows
    .map((row) =>
      row.failed
        ? `${row.id}.x`
        : `${row.id}.${row.rates.join('-')}.${row.broken | 0}.${Math.round(row.triangles) || 0}`,
    )
    .join('~');
}

/** …and back. What cannot be read is left out: a run goes on with the rows it can read. */
export function unpackRows(packed) {
  const rows = [];
  for (const word of String(packed || '').split('~')) {
    // a rate may have a point in it ("41.5"): the last two fields are whole numbers, the rates are what is between
    const read = /^([A-Z])\.(?:(x)|(.+)\.(\d+)\.(\d+))$/.exec(word);
    if (!read) continue;
    const [, id, failed, rates, broken, triangles] = read;
    const setup = SETUPS.find((s) => s.id === id);
    if (!setup || rows.some((row) => row.id === id)) continue;
    if (failed) {
      rows.push({ id, name: setup.name, failed: 'did not start' });
      continue;
    }
    const numbers = rates.split('-').map(Number);
    if (numbers.length !== 3 || numbers.some((n) => !Number.isFinite(n) || n < 0)) continue;
    rows.push({ id, name: setup.name, rates: numbers, broken: Number(broken), triangles: Number(triangles) });
  }
  return rows;
}

/**
 * One line for the whole run, to paste somewhere: what the device is, its screen's own rate, the level of the
 * look it was given, and each set-up's three rates.
 */
export function lineOf({ device, canvas, quality, gpu, shadowFilter, hz, level, rows }) {
  const rates = rows.map((row) => {
    if (row.failed) return `${row.id} failed`;
    // shaders that did not compile draw nothing, and nothing is quick to draw: such a rate is not to be believed
    const broken = row.broken ? ` (${row.broken} shader${row.broken === 1 ? '' : 's'} failed)` : '';
    return `${row.id} ${row.rates.join('/')}${broken}`;
  });
  return [
    'LODESTAR-BENCH 2',
    device,
    `canvas ${canvas}`,
    `q=${quality}`,
    gpu,
    `shadows ${shadowFilter}`,
    `screen ${hz ? `${hz} Hz` : '?'}`,
    `level ${level || '?'}`,
    ...rates,
  ].join(' | ');
}
