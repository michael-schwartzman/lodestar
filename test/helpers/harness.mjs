// Shared setup for the browser tests: serves dist/ on loopback and drives a headless Chromium.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../tools/lib/browser.mjs';
import { serveDir } from '../../tools/lib/static-server.mjs';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));

/** an address that says `name`, as it is; one that does not, with `name=value` added */
const unlessSaid = (url, name, value) =>
  new RegExp(`[?&]${name}=`).test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`;

/**
 * An address with the wild branch's experiment switched off — unless the address itself says which it wants.
 */
export const withoutWild = (url) => unlessSaid(url, 'wild', 0);

/**
 * The same address with the experiment ON, in the first look (with the experiment a desk would otherwise be shown
 * the second) — unless the address says. No gate uses this: it is for the report docs/WILD.md §6 keeps, of what
 * the experiment changes for a suite written before it. `WILD_COMPAT=1 node --test test/smoke.test.mjs`.
 */
export const withWild = (url) => unlessSaid(unlessSaid(url, 'wild', 1), 'look', 1);

/**
 * Decision of 16 November 2026 — the owner: "i like this version lock it in … just go wild … but allow me to
 * rollback if i wouldn't like it". On this branch the experiment (src/wild) is on unless the address says
 * `wild=0`, and off it is the game as it was locked. Every suite that was written before the experiment is a
 * lock on THAT game: so every page such a suite opens is opened with the switch off, here, in one place — its
 * assertions are what they were. The experiment's own suite (test/wild) asks for `{ wild: true }`, and gets the
 * addresses it writes.
 * @param {object} [o]
 * @param {boolean} [o.wild=false] leave the addresses alone: the suite says for itself whether the experiment is on
 */
export async function startHarness({ wild = false } = {}) {
  if (!existsSync(DIST + 'index.html'))
    throw new Error('dist/ is missing — run `npm run build` first (`npm test` does this for you)');
  const server = await serveDir(DIST);
  const browser = await launchBrowser();
  if (!wild) {
    const address = process.env.WILD_COMPAT === '1' ? withWild : withoutWild;
    const newPage = browser.newPage;
    browser.newPage = async () => {
      const page = await newPage();
      const navigate = page.navigate.bind(page);
      page.navigate = (url) => navigate(address(url));
      return page;
    };
  }
  return {
    url: server.url,
    browser,
    async stop() {
      await browser.close();
      await server.close();
    },
  };
}
