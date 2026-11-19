// Takes a picture of a page served by a running dev server and reports what the page logged.
//   node tools/shot.mjs <url> <out.png> [width] [height] [wait expression] [settle ms]
import { launchBrowser, sleep } from './lib/browser.mjs';

const [url, out, width = '1280', height = '720', ready = 'window.__ready === true', settle = '400'] =
  process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [width] [height] [wait expression] [settle ms]');
  process.exit(2);
}

const browser = await launchBrowser({ width: Number(width), height: Number(height) });
let failed = false;
try {
  const page = await browser.newPage();
  await page.navigate(url);
  try {
    await page.waitFor(ready, { timeoutMs: 45000, label: ready });
  } catch (error) {
    failed = true;
    console.error(`not ready: ${error.message}`);
  }
  await sleep(Number(settle));
  await page.screenshot(out);
  const problems = [
    ...page.exceptions,
    ...page.logErrors,
    ...page.console.filter((m) => m.type === 'error' || m.type === 'warning').map((m) => `${m.type}: ${m.text}`),
  ];
  for (const line of problems) console.error(line);
  console.log(`${out} ${problems.length ? `(${problems.length} problem(s) logged)` : '(clean)'}`);
  if (problems.length) failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
