// Minimal headless-Chromium driver over the Chrome DevTools Protocol. No dependencies (Node >= 22).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CHROME_BIN wins; otherwise the newest Playwright headless shell, then an installed Chrome/Chromium.
export function findChromium() {
  if (process.env.CHROME_BIN) return { bin: process.env.CHROME_BIN, headlessFlag: '--headless=new' };
  for (const cache of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
    if (!existsSync(cache)) continue;
    const shells = readdirSync(cache)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of shells) {
      for (const sub of readdirSync(join(cache, dir))) {
        const bin = join(cache, dir, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return { bin, headlessFlag: null };
      }
    }
  }
  const system = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const bin of system) if (existsSync(bin)) return { bin, headlessFlag: '--headless=new' };
  throw new Error('No Chromium found. Set CHROME_BIN or run `npx playwright install chromium-headless-shell`.');
}

export async function launchBrowser({ width = 1280, height = 720 } = {}) {
  const { bin, headlessFlag } = findChromium();
  const profile = mkdtempSync(join(tmpdir(), 'lodestar-chrome-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${width},${height}`,
    '--enable-gpu',
    '--enable-unsafe-swiftshader',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
    ...(headlessFlag ? [headlessFlag] : []),
    'about:blank',
  ];
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const cdp = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not report a DevTools endpoint within 20s')), 20000);
    child.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on ws:\/\/([^/\s]+)\//.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(`http://${m[1]}`);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited early (code ${code}): ${buf.slice(-400)}`));
    });
  });
  child.stderr.resume();
  const close = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    rmSync(profile, { recursive: true, force: true });
  };
  return { cdp, width, height, close, newPage: () => Page.open(cdp, { width, height }) };
}

export class Page {
  static async open(cdp, { width, height }) {
    const info = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
    });
    const page = new Page(cdp, info.id, ws);
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // The game's own error sink (window.__errors) does not see unhandled promise rejections; record them here.
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        'window.__rejections = []; window.addEventListener("unhandledrejection", (e) => { window.__rejections.push(String((e.reason && e.reason.stack) || e.reason)); });',
    });
    return page;
  }

  constructor(cdp, targetId, ws) {
    this.cdp = cdp;
    this.targetId = targetId;
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.console = []; // { type, text }
    this.exceptions = []; // uncaught errors
    this.logErrors = []; // browser-level errors (network, CSP, ...)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        this.console.push({ type: msg.params.type, text });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.exceptions.push(d.exception?.description || d.text || 'unknown exception');
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.logErrors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim());
      }
    });
  }

  send(method, params = {}, timeoutMs = 60000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} got no reply within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    this.console.length = 0;
    this.exceptions.length = 0;
    this.logErrors.length = 0;
    await this.send('Page.navigate', { url });
  }

  // `timeoutMs` bounds how long the page may take to answer (awaited promises included).
  async evaluate(expression, { timeoutMs = 60000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (r.exceptionDetails)
      throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  // Poll until `expression` is truthy. Bounded: rejects after timeoutMs with the last value seen.
  async waitFor(expression, { timeoutMs = 120000, intervalMs = 250, label = expression } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeoutMs) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (e) {
        last = String(e);
      }
      await sleep(intervalMs);
    }
    throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label} (last: ${JSON.stringify(last)})`);
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(data, 'base64');
    if (file) await writeFile(file, buf);
    return buf;
  }

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async keyDown(code, key, vk) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      code,
      key,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    });
  }

  async keyUp(code, key, vk) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code,
      key,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    });
  }

  async holdKey(code, key, vk, ms) {
    await this.keyDown(code, key, vk);
    await sleep(ms);
    await this.keyUp(code, key, vk);
  }

  consoleErrors() {
    return this.console.filter((m) => m.type === 'error' || m.type === 'assert').map((m) => m.text);
  }

  consoleWarnings() {
    return this.console.filter((m) => m.type === 'warning').map((m) => m.text);
  }

  async close() {
    this.ws.close();
    await fetch(`${this.cdp}/json/close/${this.targetId}`).catch(() => {});
  }
}
