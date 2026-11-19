// What every file of the experiment's suite (test/wild) shares: the harness with the addresses left alone, a
// page with the handful of helpers the other suites have, and the address a test of play starts from.
import assert from 'node:assert/strict';
import { sleep } from '../../tools/lib/browser.mjs';
import { startHarness } from '../helpers/harness.mjs';

/** the harness as it is for this suite: each address says for itself whether the experiment is on */
export const startWild = () => startHarness({ wild: true });

/**
 * A mission already begun, on a desk, in the first look (the lighter of the two: what is asked here is what the
 * experiment DOES; that it also draws and compiles in the second look is asked once, in wild.test.mjs), without
 * sound and at a fixed size of picture.
 */
export const PLAY = 'look=1&autostart=1&noaudio=1&dynres=0&touch=0';

/** nothing on the picture but the game, and nobody shooting at the camera while it is read */
export const QUIET = 'document.getElementById("ui").style.display = "none"; __G.player.hidden = true; void 0';

/** @returns {(query: string) => Promise<object>} opens the game at an address and waits for it to start */
export function openWith(harness) {
  return async function open(query) {
    const page = await harness.browser.newPage();
    await page.navigate(`${harness.url}/?${query}`);
    await page.waitFor('window.__ready === true || !!window.__fatal', {
      timeoutMs: 120000,
      label: 'the game to start',
    });
    assert.equal(await page.evaluate('window.__fatal || null'), null, `?${query}`);
    page.problems = async () => [
      ...JSON.parse(await page.evaluate('JSON.stringify((window.__errors || []).concat(window.__rejections || []))')),
      ...page.exceptions,
      ...page.logErrors,
      ...page.console.filter((m) => m.type === 'error').map((m) => m.text),
    ];
    page.json = async (expression) => JSON.parse(await page.evaluate(`JSON.stringify(${expression})`));
    page.until = (expression, label, timeoutMs = 20000) =>
      page.waitFor(expression, { timeoutMs, intervalMs: 80, label });
    page.press = (code, ms = 80) => page.holdKey(code, code.replace(/^Key|^Digit/, '').toLowerCase(), 0, ms);
    page.stand = async (x, z, yaw = 0, pitch = 0) => {
      await page.evaluate(`__G.debug.teleport(${x}, ${z}, ${yaw}); __G.player.pitch = ${pitch}; void 0`);
      await sleep(120);
    };
    return page;
  };
}

export { sleep };
