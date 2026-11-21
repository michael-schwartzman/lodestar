// The board, in the built game: the title's link, the scoreboard screen, and what a mission's ending sends — or
// does not — to a database anyone on the internet can also write to by hand (src/wild/board.js treats every row
// that comes back as hostile). The server here is a stand-in: a tiny GraphQL-shaped node:http server on loopback,
// never a real Fabric database (what the real service does is written down in docs/WILD-board.md).
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { WAIT } from '../../src/wild/board.js';
import { openWith, sleep, startWild } from './helpers.mjs';

let harness;
let open;

before(async () => {
  harness = await startWild();
  open = openWith(harness);
});

after(async () => {
  await harness?.stop();
});

const DESK = 'look=1&noaudio=1&dynres=0&touch=0';

/** a fake Fabric: answers the preflight, keeps rows posted to it, and can be told to fail, to refuse — or to hold
    every answer, as the real one does when its capacity is throttled */
function startFakeBoard() {
  const state = { rows: [], mode: 'ok', requests: [], creates: [], hold: 0, dropped: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-publishable-key, x-ms-workload-resource-moniker',
      });
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      state.requests.push(body);
      if (state.mode === 'down') {
        req.socket.destroy(); // the network itself is gone: no answer at all, not even an error status
        return;
      }
      if (state.mode === 'hang') return; // never answers; the game's own patience (board.js WAIT.answer) ends it
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('content-type', 'application/json');
      if (state.mode === 'wrong') {
        // what the real service says to a request at the wrong address: a refusal, with a body that is JSON
        res.writeHead(405);
        res.end(JSON.stringify({ message: 'Method Not Allowed' }));
        return;
      }
      if (state.mode === 'empty') {
        // …and something that answers, politely, and is not the board
        res.writeHead(200);
        res.end('{}');
        return;
      }
      if (state.mode === 'errors') {
        res.writeHead(200);
        res.end(
          JSON.stringify({ errors: [{ message: 'The value provided does not meet the required constraints.' }] }),
        );
        return;
      }
      let json = {};
      try {
        json = JSON.parse(body);
      } catch {
        // not JSON: answered as an empty list below, same as any other query this fake does not recognise
      }
      const q = json.query || '';
      const grab = (re) => (q.match(re) || [])[1];
      const answer = () => {
        if (q.includes('createScore')) {
          state.creates.push(body);
          const row = {
            id: String(state.rows.length + 1),
            name: grab(/name:\s*"([^"]*)"/),
            score: Number(grab(/score:\s*(-?\d+)/)),
            difficulty: grab(/difficulty:\s*"([^"]*)"/),
            result: grab(/result:\s*"([^"]*)"/),
            seconds: Number(grab(/seconds:\s*(-?\d+)/)),
            kills: Number(grab(/kills:\s*(-?\d+)/)),
            alarms: Number(grab(/alarms:\s*(-?\d+)/)),
            device: grab(/device:\s*"([^"]*)"/),
            mode: grab(/mode:\s*"([^"]*)"/),
            rules: Number(grab(/rules:\s*(-?\d+)/)),
            at: grab(/at:\s*"([^"]*)"/),
          };
          state.rows.unshift(row);
          const made = JSON.stringify({
            data: { createScore: { id: row.id, name: row.name, score: row.score, mode: row.mode, at: row.at } },
          });
          res.writeHead(200);
          // ('slow': the board is there, and takes its time about it)
          if (state.mode === 'slow') setTimeout(() => res.end(made), 1200);
          else res.end(made);
        } else if (state.mode === 'nolist') {
          // a row is taken, and what is asked for after it is not answered with a list
          res.writeHead(200);
          res.end('{}');
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ data: { scores: { items: state.rows } } }));
        }
      };
      if (state.mode === 'throttled') {
        // what the real service does when its capacity is throttled: every answer is held — twenty seconds
        // there; `hold` here, a figure or one for each question — and what was asked is done only when the hold
        // is over, and only for a client that is still waiting: a row sent by a game that gave up meanwhile is
        // never made
        const hold = typeof state.hold === 'function' ? state.hold(q) : state.hold;
        setTimeout(() => {
          if (req.socket.destroyed) state.dropped++;
          else answer();
        }, hold);
        return;
      }
      answer();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/graphql`,
        state,
        // (a question that was never answered is not waited for when the test is over)
        stop: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(r);
          }),
      });
    });
  });
}

const board = (fake) => `board=${encodeURIComponent(fake.url)}`;
const row = (over) => ({
  id: 'seed',
  name: 'GHOST',
  score: 1000,
  difficulty: 'operator',
  result: 'won',
  seconds: 120,
  kills: 5,
  alarms: 0,
  device: 'desk',
  mode: 'play',
  rules: 1,
  at: '2026-11-17T20:00:00.000Z',
  ...over,
});

async function openScoreboard(query) {
  const page = await open(query);
  await page.evaluate('__G.menus.show("scoreboard"); void 0');
  await page.until('document.querySelector(".m-panel")', 'the scoreboard panel');
  return page;
}

/** localStorage lives on the origin, not the tab — one Chromium profile for the whole suite means one store,
    so every test that cares what is already in it starts by wiping it, before the game's own script ever runs */
function wirePage(page) {
  page.problems = async () => [
    ...JSON.parse(await page.evaluate('JSON.stringify((window.__errors || []).concat(window.__rejections || []))')),
    ...page.exceptions,
    ...page.logErrors,
    ...page.console.filter((m) => m.type === 'error').map((m) => m.text),
  ];
  page.json = async (expression) => JSON.parse(await page.evaluate(`JSON.stringify(${expression})`));
  page.until = (expression, label, timeoutMs = 20000) => page.waitFor(expression, { timeoutMs, intervalMs: 80, label });
}

async function openWiped(query, source) {
  const page = await harness.browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear(); ${source}` });
  await page.navigate(`${harness.url}/?${query}`);
  await page.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 120000, label: 'the game to start' });
  assert.equal(await page.evaluate('window.__fatal || null'), null, `?${query}`);
  wirePage(page);
  return page;
}

/** a clean device: nothing saved at all */
const openClean = (query) => openWiped(query, '');

/** a page that already has a callsign saved before the game's own first script runs — createBoardLive(ctx)
    reads it once, at boot, so this has to be in place before navigation, not poked in after */
const openStored = (query, name) =>
  openWiped(query, `localStorage.setItem("lodestar.callsign.v1", ${JSON.stringify(name)});`);

const KEYS = {
  KeyM: ['KeyM', 'm', 77],
  KeyP: ['KeyP', 'p', 80],
  Digit1: ['Digit1', '1', 49],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39],
  Tab: ['Tab', 'Tab', 9],
  Enter: ['Enter', 'Enter', 13],
  Escape: ['Escape', 'Escape', 27],
};
const tap = async (page, name) => {
  const [code, key, vk] = KEYS[name];
  await page.holdKey(code, key, vk, 30);
};

/** ends the mission the fast way (a hurt death, 'failed' with reason 'down') — a win is proven separately by the
    pure arithmetic in test/unit/wild-score.test.mjs; what this suite needs is an ending, any ending, to post */
async function endMission(page) {
  // (the four charges count as set: a mission that ends with nothing done scores nothing, and nothing is not
  // posted — since 18 November 2026 going down in the first seconds is no longer worth a time bonus)
  await page.evaluate('__G.debug.start(); __G.debug.rig(); __G.debug.hurt(500); void 0');
  await page.until('__G.menus.current() === "failed"', 'the mission to end', 20000);
}

test('the title has the SCOREBOARD entry, and it opens the board', async () => {
  const page = await open(DESK);
  const link = await page.json(
    `(() => { const b = document.querySelector('.w-board-link'); const r = b.getBoundingClientRect(); return { text: b.textContent, inFoot: !!b.closest('.m-title-foot'), tag: b.tagName, notMBtn: !b.classList.contains('m-btn') }; })()`,
  );
  assert.deepEqual(link, { text: 'SCOREBOARD', inFoot: true, tag: 'BUTTON', notMBtn: true });
  await page.evaluate('document.querySelector(".w-board-link").click(); void 0');
  assert.equal(await page.evaluate('__G.menus.current()'), 'scoreboard');
  assert.deepEqual(await page.problems(), []);
});

test('at a phone’s shapes the board’s rows are whole: the callsign is there, and the score and the time are not cut short', async () => {
  // (18 November 2026, at the merge: the test the helper had to cut — and held upright, 390 wide, the row's
  // seven columns left the callsign no room at all: "1 12840 operat… won 21:… pho…")
  const fake = await startFakeBoard();
  fake.state.rows = [
    row({ id: '1', name: 'WRAITH OF HOLLOW', score: 16760, difficulty: 'operator', seconds: 1310, device: 'phone' }),
    row({ id: '2', name: 'MAKO', score: 9120, difficulty: 'ghost', result: 'down', seconds: 840 }),
  ];
  try {
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      const page = await harness.browser.newPage();
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'localStorage.clear();' });
      await page.navigate(`${harness.url}/?look=1&noaudio=1&dynres=0&touch=1&${board(fake)}`);
      await page.waitFor('window.__ready === true || !!window.__fatal', { timeoutMs: 120000, label: 'the game' });
      wirePage(page);
      await page.evaluate('__G.menus.show("scoreboard"); void 0');
      await page.until('document.querySelectorAll(".w-board-row").length === 2', 'the two rows');
      const rows = await page.json(`[...document.querySelectorAll('.w-board-row')].map((r) => {
        const cell = (c) => { const n = r.querySelector(c); const b = n.getBoundingClientRect();
          return { text: n.textContent, width: Math.round(b.width), cut: n.scrollWidth > n.clientWidth + 1, shown: b.width > 0 && getComputedStyle(n).display !== 'none' }; };
        const box = r.getBoundingClientRect(), panel = document.querySelector('.m-panel').getBoundingClientRect();
        return { name: cell('.w-board-name'), score: cell('.w-board-score'), time: cell('.w-board-time'), result: cell('.w-board-result'),
          inside: box.left >= panel.left - 1 && box.right <= panel.right + 1 };
      })`);
      for (const r of rows) {
        const at = `${width}×${height}: ${JSON.stringify(r)}`;
        assert.ok(r.name.shown && r.name.width >= 70, at);
        for (const cell of [r.score, r.time, r.result]) assert.ok(cell.shown && !cell.cut, at);
        assert.equal(r.inside, true, at);
      }
      // the longest callsign there can be, sixteen letters, is whole where there is room for it
      if (width > height) assert.equal(rows[0].name.cut, false, JSON.stringify(rows[0]));
      assert.deepEqual(
        rows.map((r) => r.time.text),
        ['21:50', '14:00'],
      );
      assert.deepEqual(await page.problems(), []);
      await page.close();
    }
  } finally {
    await fake.stop();
  }
});

test('the server’s rows are listed, best a callsign, in score order; a check row, a row of other rules and a row above the ceiling never appear; a planted name is nowhere in the DOM as an element', async () => {
  const fake = await startFakeBoard();
  fake.state.rows = [
    row({ id: '1', name: 'ALPHA', score: 500 }),
    row({ id: '2', name: 'ALPHA', score: 900 }), // the same caller, twice — only the better one shows
    row({ id: '3', name: 'BRAVO', score: 700 }),
    row({ id: '4', name: 'CHECK', score: 999, mode: 'check' }), // a deployment check row: never shown
    row({ id: '5', name: 'OLDRULES', score: 999, rules: 2 }),
    row({ id: '6', name: 'TOOHIGH', score: 999999, difficulty: 'recruit', result: 'lost' }), // above the ceiling
    row({ id: '7', name: '<IMG SRC=X ONERROR=ALERT(1)>'.slice(0, 16), score: 600 }), // not a legal callsign shape
  ];
  try {
    const page = await openScoreboard(`${DESK}&${board(fake)}`);
    await page.until('document.querySelectorAll(".w-board-row").length > 0', 'the list to be fetched and drawn');
    const names = await page.json(
      '[...document.querySelectorAll(".w-board-row")].map((r) => r.children[1].textContent)',
    );
    assert.deepEqual(names, ['ALPHA', 'BRAVO']); // 900 then 700; CHECK/OLDRULES/TOOHIGH/the hostile name all refused
    const scores = await page.json('[...document.querySelectorAll(".w-board-score")].map((s) => s.textContent)');
    assert.deepEqual(scores, ['900', '700']);
    assert.equal(
      await page.evaluate('document.querySelectorAll("img").length'),
      0,
      'a planted <img> is not an element anywhere',
    );
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('a mission that ends with a stored callsign posts exactly one row, whose fields are the figures on the screen, and the place is shown', async () => {
  const fake = await startFakeBoard();
  try {
    const page = await openStored(`${DESK}&autostart=1&${board(fake)}`, 'WRAITH');
    await endMission(page);
    await page.until('document.querySelector(".w-board-post")?.textContent.startsWith("POSTED")', 'the post to land');
    assert.equal(fake.state.creates.length, 1, 'exactly one row was created for this one ending');
    const total = await page.json('__G.wild.feature("board").state().worked.total');
    const sent = fake.state.rows[0];
    assert.deepEqual(
      {
        name: sent.name,
        score: sent.score,
        difficulty: sent.difficulty,
        result: sent.result,
        mode: sent.mode,
        rules: sent.rules,
      },
      { name: 'WRAITH', score: total, difficulty: 'operator', result: 'down', mode: 'play', rules: 1 },
    );
    assert.match(
      await page.evaluate('document.querySelector(".w-board-post").textContent'),
      /POSTED AS WRAITH — #1 OF THE TOP 100/,
    );
    // the screen is not rebuilt, but a second look at the same ending must not post again
    await sleep(300);
    assert.equal(fake.state.creates.length, 1, 'still exactly one — a repaint is not a second post');
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('with no callsign stored, nothing is sent until the field is filled and POST is pressed; a bad callsign is refused; keys typed into the field reach neither the game nor the menus', async () => {
  const fake = await startFakeBoard();
  try {
    const page = await openClean(`${DESK}&autostart=1&${board(fake)}`);
    await endMission(page);
    await page.until('document.querySelector(".w-board-field input")', 'the callsign field to be offered');
    assert.equal(fake.state.creates.length, 0, 'nothing sent while there is no callsign yet');
    // with a board to post to, the field says who will see it, and the button says what it does
    assert.deepEqual(
      await page.json(
        `({ who: document.querySelector('.w-board-public').textContent, button: document.querySelector('.w-board-field button').textContent })`,
      ),
      { who: 'The callsign and the score are shown to everyone.', button: 'POST' },
    );

    await page.evaluate('document.querySelector(".w-board-field input").focus(); void 0');
    for (const k of ['KeyM', 'KeyP', 'Digit1', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await tap(page, k);
    const held = await page.json(
      '({ focused: document.activeElement === document.querySelector(".w-board-field input"), screen: __G.menus.current(), value: document.querySelector(".w-board-field input").value })',
    );
    assert.deepEqual(held, { focused: true, screen: 'failed', value: '' });

    // Escape leaves the field, not the screen (menus.js itself does nothing with Esc on 'failed' either way —
    // this proves board-live.js's own handling does not leak the key up to it)
    await tap(page, 'Escape');
    assert.equal(await page.evaluate('__G.menus.current()'), 'failed');
    assert.notEqual(
      await page.evaluate('document.activeElement === document.querySelector(".w-board-field input")'),
      true,
    );

    // a bad callsign is refused, with a message next to the field
    await page.evaluate(
      '(() => { const i = document.querySelector(".w-board-field input"); i.value = "@@"; i.dispatchEvent(new Event("input")); })()',
    );
    await page.evaluate('document.querySelector(".w-board-field .m-btn").click(); void 0');
    assert.match(await page.evaluate('document.querySelector(".w-board-why").textContent'), /letters, numbers/);
    assert.equal(fake.state.creates.length, 0, 'a refused callsign sends nothing');

    // a good one, submitted with Enter at the field, is accepted — posting then follows on its own
    await page.evaluate(
      '(() => { const i = document.querySelector(".w-board-field input"); i.focus(); i.value = "WRAITH"; i.dispatchEvent(new Event("input")); })()',
    );
    await tap(page, 'Enter');
    await page.until('document.querySelector(".w-board-post")?.textContent.startsWith("POSTED")', 'the post to land');
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

// Decision of 20 November 2026. A screen that opens puts the focus on its first stop (menus.js
// focusFirstStop), and on the debrief that is this field. On a desk that is right: the keys are under the
// player's hands. On a phone a focused field is what brings the keyboard up — over half the debrief, unasked.
// A browser on a phone declines to do that for a focus nobody tapped; a page shown inside an app may not be so
// lucky (one in a simulator was not). So on a phone the field is not a stop: it is typed into when it is tapped.
test('on a desk the debrief opens with the callsign field in focus; on a phone the field waits to be tapped', async () => {
  const field = (page) =>
    page.json(
      `(() => { const f = document.querySelector('.w-board-field input'); const a = document.activeElement; return { focused: a === f, stop: 'stop' in f.dataset, tabIndex: f.tabIndex, onAStop: !!a && 'stop' in a.dataset }; })()`,
    );
  const desk = await openClean(`${DESK}&autostart=1`);
  await endMission(desk);
  await desk.until('document.querySelector(".w-board-field input")', 'the callsign field to be offered');
  assert.deepEqual(await field(desk), { focused: true, stop: true, tabIndex: 0, onAStop: true });
  // (this page has no board to post to — as a copy run from a folder has none, or a page carried inside an
  // app: what the field says of who will see the score is said as it is, and the button does not say POST)
  const said = (page) =>
    page.json(
      `({ who: document.querySelector('.w-board-public').textContent, button: document.querySelector('.w-board-field button').textContent })`,
    );
  assert.deepEqual(await said(desk), { who: 'The callsign and the score are kept on this device.', button: 'SAVE' });
  await desk.evaluate(
    '(() => { const i = document.querySelector(".w-board-field input"); i.value = "WRAITH"; i.dispatchEvent(new Event("input")); document.querySelector(".w-board-field button").click(); })()',
  );
  await desk.until(
    'document.querySelector(".w-board-post")?.textContent === "SCORES ARE KEPT ON THIS DEVICE"',
    'the row to be kept',
  );
  assert.deepEqual(await desk.problems(), []);
  await desk.close();

  const phone = await openClean(`${DESK.replace('touch=0', 'touch=1')}&autostart=1`);
  await endMission(phone);
  await phone.until('document.querySelector(".w-board-field input")', 'the callsign field to be offered');
  // the focus is on a stop, as on every screen — only not on this one; and the field can still be tapped
  assert.deepEqual(await field(phone), { focused: false, stop: false, tabIndex: 0, onAStop: true });
  await phone.evaluate('document.querySelector(".w-board-field input").focus(); void 0');
  assert.equal((await field(phone)).focused, true, 'a tap still puts the focus in it');
  assert.deepEqual(await phone.problems(), []);
  await phone.close();
});

test('the server down: the row is kept on the device and queued; the server back: opening the board sends it once, and only once', async () => {
  const fake = await startFakeBoard();
  fake.state.mode = 'down';
  try {
    const page = await openStored(`${DESK}&autostart=1&${board(fake)}`, 'WRAITH');
    await endMission(page);
    await page.until(
      'document.querySelector(".w-board-post")?.textContent === "THE BOARD COULD NOT BE REACHED — KEPT ON THIS DEVICE"',
      'the failed-post message',
    );
    await page.until(
      '__G.wild.feature("board").state().queued === 1',
      'the row to be queued (it may try once more, by itself, and still fail)',
    );
    assert.equal(fake.state.rows.length, 0, 'nothing landed on the server while it was down');

    fake.state.mode = 'ok'; // the server comes back
    await page.evaluate('__G.menus.show("scoreboard"); void 0'); // opening the board is what retries the queue
    await page.until('__G.wild.feature("board").state().queued === 0', 'the queue to drain');
    assert.equal(fake.state.rows.length, 1, 'exactly one row ultimately landed');
    await sleep(300);
    assert.equal(fake.state.rows.length, 1, 'still exactly one — nothing goes up twice once the queue is empty');
    // killing the socket on purpose to simulate "down" is itself logged by Chromium's network stack — that is
    // the expected shape of this test, not a bug in board-live.js (which does catch it, and shows the warning)
    const problems = (await page.problems()).filter((p) => !p.includes('ERR_EMPTY_RESPONSE'));
    assert.deepEqual(problems, []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('something that answers and is not the board is not taken for it: a refusal with a body, or an empty yes — the list is the device’s own and says so, and a score is kept, not "posted"', async () => {
  // (the first board asked the service at the wrong address — its root, where it answers 405 with a body that is
  // JSON — and showed an empty shared board and POSTED AS, with nothing written anywhere)
  for (const mode of ['wrong', 'empty']) {
    const fake = await startFakeBoard();
    fake.state.mode = mode;
    try {
      const page = await openStored(`${DESK}&autostart=1&${board(fake)}`, 'WRAITH');
      await endMission(page);
      await page.until(
        'document.querySelector(".w-board-post")?.textContent === "THE BOARD COULD NOT BE REACHED — KEPT ON THIS DEVICE"',
        `${mode}: the failed-post message`,
      );
      assert.equal(await page.json('__G.wild.feature("board").state().queued'), 1, mode);
      assert.equal(await page.json('__G.wild.feature("board").state().sent'), null, mode);
      await page.evaluate('__G.menus.show("scoreboard"); void 0');
      await page.until(
        '!!document.querySelector(".w-board-state--warn")',
        `${mode}: the board to say it was not reached`,
      );
      assert.equal(
        await page.evaluate('document.querySelector(".w-board-state--warn").textContent'),
        'THE BOARD COULD NOT BE REACHED — THIS DEVICE’S OWN SCORES',
        mode,
      );
      assert.equal(await page.json('__G.wild.feature("board").state().source'), 'local', mode);
      // (the browser itself logs a 405: that is the server's doing, as in the test above)
      const problems = (await page.problems()).filter((p) => !/Failed to load resource/.test(p));
      assert.deepEqual(problems, [], mode);
      await page.close();
    } finally {
      await fake.stop();
    }
  }
});

test('a row waiting to be sent is sent once, however many things ask for the queue to be tried at the same moment', async () => {
  // (18 November 2026, the review: a score's own retry and the board being opened could both be sending the
  // same waiting row — two rows on the shared board for one mission, if both got through)
  const fake = await startFakeBoard();
  fake.state.mode = 'down';
  try {
    const page = await openStored(`${DESK}&autostart=1&${board(fake)}`, 'WRAITH');
    await endMission(page);
    await page.until('__G.wild.feature("board").state().queued === 1', 'the row to be queued');
    await sleep(400);
    fake.state.mode = 'slow'; // it is back, and takes more than a second to answer
    await page.evaluate(
      '(async () => { const f = __G.wild.feature("board"); await Promise.all([f.retry(), f.retry(), f.retry()]); })()',
    );
    await page.until('__G.wild.feature("board").state().queued === 0', 'the queue to drain');
    await sleep(1500);
    assert.equal(fake.state.creates.length, 1, `${fake.state.creates.length} rows were sent for the one mission`);
    assert.equal(fake.state.rows.length, 1);
    const problems = (await page.problems()).filter((p) => !p.includes('ERR_EMPTY_RESPONSE'));
    assert.deepEqual(problems, []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

const SLOW = 'THE BOARD IS SLOW TO ANSWER — STILL ASKING';
const UNREACHED = 'THE BOARD COULD NOT BE REACHED — THIS DEVICE’S OWN SCORES';

/** keeps, in the page, what a line of the menus says each time it changes, when (by the page's own clock: how
    long this process took to ask is no part of the answer) and how many rows the board showed with it */
const watch = (page, selector) =>
  page.evaluate(`(() => {
    const seen = (window.__seen = []);
    const look = () => {
      const said = document.querySelector(${JSON.stringify(selector)})?.textContent || '';
      const rows = document.querySelectorAll('.w-board-row').length;
      const last = seen[seen.length - 1];
      if (!last || last.said !== said || last.rows !== rows) seen.push({ t: Math.round(performance.now()), said, rows });
    };
    new MutationObserver(look).observe(document.querySelector('#menus'), { childList: true, subtree: true, characterData: true });
    look();
  })()`);
const seen = (page) => page.json('window.__seen');
const names = (page) =>
  page.json('[...document.querySelectorAll(".w-board-row")].map((r) => r.children[1].textContent)');

// An app whose capacity is over its allowance is throttled, and the service then holds every answer for twenty
// seconds (the header x-ms-mwc-throttling-delay: 20000; to a question about nothing too). Until 18 November 2026
// the game gave up after six — and a request that is given up on is dropped by the service — so the board said
// THE BOARD COULD NOT BE REACHED over a board that was there, and no score went up. The tests below hold the
// game to the service as it is then: in real time, with the game's own patience (a link cannot shorten it, and
// nor can a test).
test('a board that holds every answer twenty seconds is slow, not gone: it is asked once and waited for, says so, and lists its rows — and asked again later, says so beside the rows it has', async () => {
  const fake = await startFakeBoard();
  fake.state.rows = [row({ id: '1', name: 'ALPHA', score: 900 }), row({ id: '2', name: 'BRAVO', score: 700 })];
  fake.state.mode = 'throttled';
  fake.state.hold = WAIT.throttle + 500;
  try {
    const page = await openClean(`${DESK}&${board(fake)}`);
    await watch(page, '.w-board-state');
    const openBoard = () => page.evaluate('__G.menus.show("scoreboard"); void 0');
    const toTitle = () => page.evaluate('__G.menus.show("title", { record: __G.record }); void 0');
    const stateLine = () => page.evaluate('document.querySelector(".w-board-state")?.textContent || ""');

    await openBoard();
    await page.until(
      `window.__seen.some((s) => s.said === ${JSON.stringify(SLOW)})`,
      'the board to say it is slow to answer',
      25000,
    );
    const asked = (await seen(page)).find((s) => s.said === 'LOADING…')?.t;
    const slow = (await seen(page)).find((s) => s.said === SLOW).t;
    assert.ok(Number.isFinite(asked), 'first it says LOADING…');
    assert.ok(
      slow - asked >= WAIT.slow - 60 && slow - asked < 12000,
      `slow was said ${slow - asked} ms after the board was asked`,
    );

    // left, and opened again past the time after which a board is asked afresh: the question that is out is
    // the question — a second one would only be held as long again
    await toTitle();
    await page.until(`performance.now() - ${asked} > ${WAIT.gap + 1500}`, 'the gap to pass', 25000);
    await openBoard();
    await sleep(400);
    assert.equal(fake.state.requests.length, 1, 'asked once: whoever opens the board meanwhile waits for the same');
    assert.equal(await stateLine(), SLOW, 'and is told at once that it is slow');

    await page.until('document.querySelectorAll(".w-board-row").length === 2', 'the rows, when they come', 45000);
    const listedAt = (await seen(page)).find((s) => s.rows === 2).t;
    assert.ok(listedAt - asked >= WAIT.throttle, `the rows came ${listedAt - asked} ms after they were asked for`);
    assert.deepEqual(await names(page), ['ALPHA', 'BRAVO']);
    assert.equal(await stateLine(), '', 'nothing is said over a board that has answered');
    assert.equal(await page.json('__G.wild.feature("board").state().source'), 'remote');
    assert.deepEqual([fake.state.requests.length, fake.state.dropped], [1, 0], 'asked once, and waited for');

    // --- with rows in hand
    fake.state.rows.push(row({ id: '3', name: 'CHARLIE', score: 800 }));
    fake.state.hold = WAIT.slow + 3000;
    // opened again at once: it has only just answered, and is not asked
    await toTitle();
    await openBoard();
    await sleep(600);
    assert.equal(fake.state.requests.length, 1, 'a board that has only just answered is not asked again');
    assert.deepEqual(await names(page), ['ALPHA', 'BRAVO']);
    // …and later it is: the rows it gave are shown meanwhile, and that it is slow is said beside them — rows that
    // are being asked for again must not pass for the board's answer
    await toTitle();
    await page.until(`performance.now() - ${listedAt} > ${WAIT.gap + 500}`, 'the gap to pass', 25000);
    await openBoard();
    await page.until(
      `window.__seen.some((s) => s.t > ${listedAt} && s.said === ${JSON.stringify(SLOW)})`,
      'slow to be said beside the rows',
      25000,
    );
    const beside = (await seen(page)).find((s) => s.t > listedAt && s.said === SLOW);
    assert.equal(beside.rows, 2, 'the rows it had are shown while it is asked again');
    await page.until('document.querySelectorAll(".w-board-row").length === 3', 'the new row', 25000);
    assert.equal(await stateLine(), '');
    assert.deepEqual(await names(page), ['ALPHA', 'CHARLIE', 'BRAVO']);
    assert.deepEqual([fake.state.requests.length, fake.state.dropped], [2, 0]);
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('a score is posted to a board that holds every answer twenty seconds: once, said to be slow while it is — and its place asked for after, and that said too', async () => {
  const fake = await startFakeBoard();
  fake.state.mode = 'throttled';
  // (the row is held the service's twenty seconds; the list asked for after it, to say the place, a shorter while)
  fake.state.hold = (q) => (q.includes('createScore') ? WAIT.throttle + 500 : WAIT.slow + 3000);
  try {
    const page = await openStored(`${DESK}&autostart=1&${board(fake)}`, 'WRAITH');
    await watch(page, '.w-board-post');
    await endMission(page);
    const says = (text) => `document.querySelector(".w-board-post")?.textContent === ${JSON.stringify(text)}`;
    await page.until(says('POSTING… THE BOARD IS SLOW TO ANSWER'), 'the post to say the board is slow', 25000);
    assert.equal(fake.state.creates.length, 0, 'the row is not made until the service has held it its time');
    await page.until(says('POSTED AS WRAITH'), 'the post to land', 45000);
    assert.equal(fake.state.creates.length, 1, 'exactly one row');
    await page.until(says('POSTED AS WRAITH — STILL ASKING ITS PLACE'), 'the place to be said to be slow', 25000);
    await page.until(says('POSTED AS WRAITH — #1 OF THE TOP 100'), 'the place', 25000);

    const said = (await seen(page)).filter((s) => s.said);
    assert.deepEqual(
      said.map((s) => s.said),
      [
        'POSTING…',
        'POSTING… THE BOARD IS SLOW TO ANSWER',
        'POSTED AS WRAITH',
        'POSTED AS WRAITH — STILL ASKING ITS PLACE',
        'POSTED AS WRAITH — #1 OF THE TOP 100',
      ],
    );
    assert.ok(said[1].t - said[0].t >= WAIT.slow - 60, `slow was said ${said[1].t - said[0].t} ms after POSTING…`);
    assert.ok(said[2].t - said[0].t >= WAIT.throttle, `it was posted ${said[2].t - said[0].t} ms after it was sent`);
    assert.ok(said[3].t - said[2].t >= WAIT.slow - 60, `${said[3].t - said[2].t} ms`);
    const total = await page.json('__G.wild.feature("board").state().worked.total');
    const sent = fake.state.rows[0];
    assert.deepEqual(
      { name: sent.name, score: sent.score, result: sent.result, mode: sent.mode, rules: sent.rules },
      { name: 'WRAITH', score: total, result: 'down', mode: 'play', rules: 1 },
    );
    // one row, two questions (the row, and the list for its place), neither given up on; nothing left waiting
    assert.deepEqual(
      [fake.state.creates.length, fake.state.rows.length, fake.state.requests.length, fake.state.dropped],
      [1, 1, 2, 0],
    );
    assert.equal(await page.json('__G.wild.feature("board").state().queued'), 0);
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('a score the game gave up on is neither lost nor doubled: the service drops what is given up on, and the row goes up once when it is tried again', async () => {
  // (what the review of 18 November asked of this suite: a request whose client has gone being dropped is the
  // very thing the six seconds ran into — and nothing here had made the stand-in do it)
  const fake = await startFakeBoard();
  fake.state.mode = 'throttled';
  // the first row is held longer than an answer is waited for; whatever is asked after it is answered at once
  let rowsSent = 0;
  fake.state.hold = (q) => (q.includes('createScore') && ++rowsSent === 1 ? WAIT.answer + 5000 : 0);
  try {
    const page = await openStored(`${DESK}&autostart=1&${board(fake)}`, 'WRAITH');
    await endMission(page);
    await page.until(
      'document.querySelector(".w-board-post")?.textContent === "THE BOARD COULD NOT BE REACHED — KEPT ON THIS DEVICE"',
      'the row to be given up on',
      WAIT.answer + 30000,
    );
    // it is tried again by itself, and this time the board answers
    await page.until('__G.wild.feature("board").state().queued === 0', 'the row to go up', 25000);
    // …and the hold on the first one runs out, with nobody there to answer
    for (let n = 0; n < 200 && fake.state.dropped < 1; n++) await sleep(100);
    await sleep(500);
    assert.deepEqual(
      [rowsSent, fake.state.dropped, fake.state.creates.length, fake.state.rows.length],
      [2, 1, 1, 1],
      'sent twice, dropped once, made once',
    );
    const total = await page.json('__G.wild.feature("board").state().worked.total');
    assert.deepEqual(
      { name: fake.state.rows[0].name, score: fake.state.rows[0].score, mode: fake.state.rows[0].mode },
      { name: 'WRAITH', score: total, mode: 'play' },
    );
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('a board that never answers is given up on — after the time an answer is waited for, and no sooner: the list is the device’s own, and says so', async () => {
  const fake = await startFakeBoard();
  fake.state.mode = 'hang';
  try {
    const page = await openClean(`${DESK}&${board(fake)}`);
    await watch(page, '.w-board-state');
    await page.evaluate('__G.menus.show("scoreboard"); void 0');
    await page.until(
      `window.__seen.some((s) => s.said === ${JSON.stringify(UNREACHED)})`,
      'the board to be given up on',
      WAIT.answer + 30000,
    );
    const said = (await seen(page)).filter((s) => s.said);
    assert.deepEqual(
      said.map((s) => s.said),
      ['LOADING…', SLOW, UNREACHED],
    );
    const waited = said[2].t - said[0].t;
    assert.ok(
      waited >= WAIT.answer - 100 && waited < WAIT.answer + 12000,
      `it was given up on after ${waited} ms (an answer is waited ${WAIT.answer} for)`,
    );
    assert.equal(await page.json('__G.wild.feature("board").state().source'), 'local');
    assert.equal(fake.state.requests.length, 1, 'asked once, and not again by itself');
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('a score that went up, and a place the board did not give: no place is said — where it stands among this device’s own scores is not its place on the board', async () => {
  // (until 18 November 2026 a list that did not come was taken for an empty one, and the row just sent — the
  // only one the device then knew of — was said to be #1 OF THE TOP 100)
  const fake = await startFakeBoard();
  fake.state.mode = 'nolist';
  try {
    const page = await openStored(`${DESK}&autostart=1&${board(fake)}`, 'WRAITH');
    await endMission(page);
    await page.until('document.querySelector(".w-board-post")?.textContent.startsWith("POSTED")', 'the post to land');
    for (let n = 0; n < 50 && fake.state.requests.length < 2; n++) await sleep(100);
    await sleep(500);
    assert.deepEqual([fake.state.creates.length, fake.state.requests.length], [1, 2], 'the row, then the list');
    assert.equal(await page.evaluate('document.querySelector(".w-board-post").textContent'), 'POSTED AS WRAITH');
    assert.deepEqual(await page.problems(), []);
    await page.close();
  } finally {
    await fake.stop();
  }
});

test('?board=0: nothing is ever fetched', async () => {
  const page = await openStored(`${DESK}&autostart=1&board=0`, 'WRAITH');
  await endMission(page);
  await page.until(
    'document.querySelector(".w-board-post")?.textContent === "SCORES ARE KEPT ON THIS DEVICE"',
    'the local-only message',
  );
  const state = await page.json(
    '({ queued: __G.wild.feature("board").state().queued, source: __G.wild.feature("board").state().source })',
  );
  assert.deepEqual(state, { queued: 0, source: 'local' });
  const foreign = await page.json(
    `performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(${JSON.stringify(harness.url)}))`,
  );
  assert.deepEqual(foreign, [], 'nothing was fetched from anywhere but the page’s own origin');
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

test('no board= at all, on loopback: the same — local only (the built-in address only ever applies on a deployed .fabricapps.net host)', async () => {
  const page = await openStored(`${DESK}&autostart=1`, 'WRAITH');
  await endMission(page);
  await page.until(
    'document.querySelector(".w-board-post")?.textContent === "SCORES ARE KEPT ON THIS DEVICE"',
    'the local-only message',
  );
  const state = await page.json(
    '({ queued: __G.wild.feature("board").state().queued, source: __G.wild.feature("board").state().source })',
  );
  assert.deepEqual(state, { queued: 0, source: 'local' });
  const foreign = await page.json(
    `performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(${JSON.stringify(harness.url)}))`,
  );
  assert.deepEqual(foreign, []);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});

test('an address in the link that is not this machine’s own is not used: a link cannot send a score somewhere else', async () => {
  // (18 November 2026, at the merge: `?board=<url>` is for tests. Taken from anywhere, a link could have sent a
  // player's callsign and score wherever its writer liked, and shown them a board of the writer's making.)
  const elsewhere = encodeURIComponent('https://example.invalid/graphql');
  const page = await openStored(`${DESK}&autostart=1&board=${elsewhere}`, 'WRAITH');
  await endMission(page);
  await page.until(
    'document.querySelector(".w-board-post")?.textContent === "SCORES ARE KEPT ON THIS DEVICE"',
    'the local-only message',
  );
  await page.evaluate('__G.menus.show("scoreboard"); void 0');
  await page.until('!!document.querySelector(".w-board-state")', 'the board to say where it reads from');
  assert.equal(
    await page.evaluate('document.querySelector(".w-board-state").textContent'),
    'SCORES ARE KEPT ON THIS DEVICE',
  );
  const foreign = await page.json(
    `performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(${JSON.stringify(harness.url)}))`,
  );
  assert.deepEqual(foreign, []);
  assert.deepEqual(await page.problems(), []);
  await page.close();
});
