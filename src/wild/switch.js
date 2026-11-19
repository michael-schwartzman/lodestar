// The switch of the wild branch. No drawing and no browser in here: it runs under `node --test`
// (test/unit/wild-switch.test.mjs), and it is the one piece of the experiment that every player downloads —
// because it is what decides whether the rest (src/wild/index.js) is fetched at all.
//
// Decision of 16 November 2026 — the owner: "… just go wild and make it maximum fun of a game and maximum
// creative … but allow me to rollback if i wouldn't like it". The experiment is on unless something says
// otherwise, and off it is the game as it was locked (the tag `lodestar-v8`): nothing of the experiment is
// fetched, drawn or bound to a key.
//
// Decision of 18 November 2026 — the owner, of the experiment: "… i like it". It is the game now. The switch
// that stood on the title (and the choice it kept in the browser, under `lodestar.wild.v1`) is gone: only the
// address can say otherwise.

/**
 * Whether the wild build is on. Only the address can turn it off (`wild=0`): that is the classic game, which
 * the suites written before it still hold. Never on the phone test page (`bench=1`): that measures the look.
 * @param {URLSearchParams} params the address
 */
export function wildWanted(params) {
  if (params.get('bench') === '1') return false;
  return params.get('wild') !== '0';
}

/**
 * Which look the game is shown in: 1 as it is, 2 the second look (src/look). Without the experiment, exactly as
 * it was: the second only when the address asks (`look=2`). With it, a desk gets the second unless the address
 * says `look=1` — the owner liked it, and an experiment is where to find out — and a phone keeps the first,
 * which is the one it can afford.
 * @param {URLSearchParams} params the address
 * @param {{ wild: boolean, touch: boolean }} o
 * @returns {1 | 2}
 */
export function lookWanted(params, { wild, touch }) {
  if (params.has('look') || !wild) return params.get('look') === '2' ? 2 : 1;
  return touch ? 1 : 2;
}
