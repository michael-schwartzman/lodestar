// The board, joined to the game: the title's link, the scoreboard screen, and the figures added to the end of a
// mission. The rules it goes by are src/wild/score.js (what a mission is worth) and src/wild/board.js (what is
// safe to send and to believe); this file is the only one of the three that touches the network or the DOM.
//
// The owner, 18 November 2026: "add a score board feature and save it to a shared database …". Shared
// means one table anyone may read, and anyone may add a row to — there is no sign-in, so there is no way to stop
// a row being added by hand with any score at all. What comes back is treated as hostile (board.js does the
// checking); what goes out is built from sanitised values only (board.js does that too). This file's own job is
// three things: knowing when a mission has ended and what it was worth, keeping this device's own record of
// that in case the network cannot be reached, and drawing the screen.
import './board.css';
import { RULES, score } from './score.js';
import {
  LOCAL_LIMITS,
  STORE_KEYS,
  WAIT,
  callsign,
  cleanLocal,
  created,
  createText,
  emptyLocal,
  endpointOf,
  listed,
  listText,
  merge,
  parse,
  rank,
  refused,
  waiting,
} from './board.js';

const TOP = 20; // the list shows this many rows

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** a focusable, thumb-and-keyboard reachable control, the way every other menu control is (menus.js: [data-stop]) */
function stop(node) {
  node.tabIndex = 0;
  node.dataset.stop = '';
  return node;
}

function mmss(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** where the board talks to (board.js `endpointOf` has the rule): what the page's address says, or what the
    build was given — and that only from one of the app's own pages */
function readEndpoint(params) {
  return endpointOf({
    board: params.get('board'),
    hostname: location.hostname,
    url: import.meta.env.VITE_RAYFIN_API_URL,
    key: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
    item: import.meta.env.VITE_FABRIC_ITEM_ID,
  });
}

/** one call to the one endpoint there is, mutation or query alike (GraphQL is always POST); null for anything
    that did not come back as JSON with a yes for a status inside the time given — a timeout, a refusal at the
    door (the service answers 405, with a body, to a request it has no place for), the network itself being gone.
    What the JSON then says is board.js's to judge (`created`, `listed`, `refused`). The time given is longer
    than a throttled service holds an answer (board.js `WAIT`): a question given up on is one the service drops. */
async function graphql(endpoint, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WAIT.answer);
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Publishable-Key': endpoint.key,
        'x-ms-workload-resource-moniker': endpoint.item,
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readText(store, key) {
  if (!store) return '';
  try {
    return store.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeText(store, key, value) {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // full, blocked, or private browsing: the game plays on without remembering it
  }
}

/** what this device kept — believed no more than what the table sends (board.js `cleanLocal`) */
function readLocal(store) {
  if (!store) return emptyLocal();
  try {
    const raw = store.getItem(STORE_KEYS.scores);
    return cleanLocal(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyLocal();
  }
}

function writeLocal(store, local) {
  writeText(store, STORE_KEYS.scores, JSON.stringify(local));
}

export function createBoardLive(ctx) {
  const { G, store, params } = ctx;
  const endpoint = readEndpoint(params);

  // (a callsign that was kept is asked the same as one that is typed: what the store holds may not be one)
  const kept = callsign(readText(store, STORE_KEYS.callsign));
  let name = kept.ok ? kept.value : '';
  let local = readLocal(store);

  // this mission's own tally — kept so a checkpoint retry does not lose credit for what was already done
  // (save()/load() below), and cleared fresh by reset()
  let rollSentries = 0;
  let rollDrones = 0;
  let reinforcements = 0;
  let retries = 0;

  // the current ending (debrief/failed), worked out once and never again for the same one — endingToken guards
  // an in-flight request from an ending that has since been replaced by a new one (a retry racing the first
  // request: the spec's own words for it)
  let result = null; // { input, breakdown, row }
  let postStatus = 'idle'; // idle | posting | posted | local | failed | skipped-zero | skipped-own-best
  let placeText = '';
  let endingToken = 0;
  let endingRefresh = null; // repaints the posting line of whichever ending screen is mounted right now
  // when this ending's row was sent, and when the list for its place was asked for — each null once answered
  // (the page's own clock, performance.now(): board.js `waiting` says when a question that is out is slow)
  let postAsked = null;
  let placeAsked = null;
  let saidPost = 'idle'; // what the posting line last said of the question that is out (board.js `waiting`)

  // the scoreboard screen's own fetched state
  let listState = 'local'; // 'remote' once a fetch has succeeded; 'local' otherwise (board.js's own two words)
  let listRows = [];
  let listAsked = null; // when the list was asked for, while it is out
  let listing = null; // …and the asking itself: whoever opens the board meanwhile is given the same answer
  let lastFetch = 0;
  let saidList = 'idle'; // what the scoreboard last said of it
  let boardRefresh = null; // repaints the scoreboard's list, if it is the screen mounted right now

  function setName(value) {
    name = value;
    writeText(store, STORE_KEYS.callsign, name);
  }

  /**
   * The rows that could not be sent are tried again: one at a time, and by one hand only. Whatever asks while
   * that hand is at it — a score's own retry, the board being opened — is given the same going-over to wait for
   * and starts no other: a row that is waiting is sent once. Each row is taken afresh from the queue as it
   * stands, so that one added meanwhile is neither lost nor passed over.
   */
  let retrying = null;
  function retryQueue() {
    if (!endpoint) return Promise.resolve();
    if (!retrying)
      retrying = drainQueue().finally(() => {
        retrying = null;
      });
    return retrying;
  }
  async function drainQueue() {
    const tried = new Set();
    for (;;) {
      const next = local.queue.find((queued) => !tried.has(queued));
      if (!next) break;
      tried.add(next);
      const json = await graphql(endpoint, createText(next.row));
      const rest = local.queue.filter((queued) => queued !== next);
      if (created(json)) {
        local = { scores: [next.row, ...local.scores].slice(0, LOCAL_LIMITS.scores), queue: rest };
      } else if (refused(json)) {
        // the board said no to it: it is not sent again
        local = { scores: local.scores, queue: rest };
      } else {
        const again = { row: next.row, tries: (next.tries || 0) + 1 };
        tried.add(again);
        local = { scores: local.scores, queue: again.tries < LOCAL_LIMITS.queueTries ? [...rest, again] : rest };
      }
      writeLocal(store, local);
    }
    boardRefresh?.();
  }

  /**
   * The list, asked for. One question is out at a time: with an answer that may be twenty seconds coming
   * (board.js `WAIT`), a board opened again meanwhile waits for the one that is out — a second would only be held
   * as long again, and until 18 November 2026 would have had the first one's answer thrown away. Not asked again
   * sooner than `WAIT.gap` after it was asked, nor after it answered.
   */
  function fetchList(force) {
    if (!endpoint) {
      listState = 'local';
      listRows = merge([], local);
      boardRefresh?.();
      return Promise.resolve();
    }
    if (listing) return listing;
    if (!force && Date.now() - lastFetch < WAIT.gap) return Promise.resolve();
    lastFetch = Date.now();
    listing = askList().finally(() => {
      listing = null;
    });
    return listing;
  }
  async function askList() {
    listAsked = performance.now();
    boardRefresh?.();
    const json = await graphql(endpoint, listText());
    listAsked = null;
    lastFetch = Date.now();
    // (only a list is the board: something that answers and is not it leaves the device's own scores, said so)
    const ok = listed(json);
    listState = ok ? 'remote' : 'local';
    listRows = merge(ok ? parse(json) : [], local);
    boardRefresh?.();
    retryQueue();
  }

  /** what the posting line is to say of the question this ending has out: its row, or the list for its place */
  const postWait = () => waiting(postAsked ?? placeAsked, performance.now());

  function paintPost(line) {
    if (!line) return;
    saidPost = postWait();
    line.classList.remove('w-board-post--ok', 'w-board-post--warn');
    if (postStatus === 'posting')
      line.textContent = saidPost === 'slow' ? 'POSTING… THE BOARD IS SLOW TO ANSWER' : 'POSTING…';
    else if (postStatus === 'posted') {
      // (the row is up; its place is said when the board gives it — and that it is slow to, if it is)
      const place = placeText || (saidPost === 'slow' ? 'STILL ASKING ITS PLACE' : '');
      line.textContent = place ? `POSTED AS ${result.row.name} — ${place}` : `POSTED AS ${result.row.name}`;
      line.classList.add('w-board-post--ok');
    } else if (postStatus === 'local') line.textContent = 'SCORES ARE KEPT ON THIS DEVICE';
    else if (postStatus === 'failed') {
      line.textContent = 'THE BOARD COULD NOT BE REACHED — KEPT ON THIS DEVICE';
      line.classList.add('w-board-post--warn');
    } else if (postStatus === 'refused') {
      line.textContent = 'THE BOARD DID NOT TAKE IT — KEPT ON THIS DEVICE';
      line.classList.add('w-board-post--warn');
    } else if (postStatus === 'skipped-own-best') line.textContent = `NOT POSTED — YOUR BEST AS ${name} ALREADY STANDS`;
    else line.textContent = '';
  }

  async function sendRow(row, token) {
    const keep = () => ({ scores: [row, ...local.scores].slice(0, LOCAL_LIMITS.scores), queue: local.queue });
    if (!endpoint) {
      postStatus = 'local';
      local = keep();
      writeLocal(store, local);
      endingRefresh?.();
      return;
    }
    postAsked = performance.now();
    const json = await graphql(endpoint, createText(row));
    if (token !== endingToken) return;
    postAsked = null;
    if (created(json)) {
      postStatus = 'posted';
      local = keep();
      writeLocal(store, local);
      placeAsked = performance.now();
      endingRefresh?.();
      const list = await graphql(endpoint, listText());
      if (token !== endingToken) return;
      placeAsked = null;
      // (only what the board lists is a place on it: where the row stands among this device's own scores is
      // not — a list that did not come leaves the place unsaid)
      if (listed(list)) {
        const place = rank(merge(parse(list), local), row.name);
        placeText = place && place <= 100 ? `#${place} OF THE TOP 100` : 'NOT IN THE TOP 100';
      }
      endingRefresh?.();
    } else if (refused(json)) {
      // the board said no to this row: it is this device's own record, and it is not sent again
      postStatus = 'refused';
      local = keep();
      writeLocal(store, local);
      endingRefresh?.();
    } else {
      postStatus = 'failed';
      local = { scores: local.scores, queue: [...local.queue, { row, tries: 1 }].slice(-LOCAL_LIMITS.queue) };
      writeLocal(store, local);
      endingRefresh?.();
    }
    retryQueue();
  }

  /** once an ending has a callsign to post under: refused at nought, and a loss posted only past this device's
      own best for that name (a string of deaths must not fill the table) — a win always goes up. */
  function attemptPost() {
    if (!result || !name || postStatus !== 'idle') return;
    result.row.name = name;
    if (result.breakdown.total <= 0) {
      postStatus = 'skipped-zero';
      endingRefresh?.();
      return;
    }
    if (result.input.result !== 'won') {
      const ownBest = local.scores.filter((r) => r.name === name).reduce((m, r) => Math.max(m, r.score), 0);
      if (result.breakdown.total <= ownBest) {
        postStatus = 'skipped-own-best';
        endingRefresh?.();
        return;
      }
    }
    postStatus = 'posting';
    endingRefresh?.();
    sendRow({ ...result.row }, endingToken);
  }

  /** the callsign field: the game's own rule is that nothing typed into it may ever reach the game or the
      menus — every key is stopped here, in the phase it arrives, before menus.js's own layer listener can see
      it (it listens in the bubble phase too, so stopping it here is enough; it never arrives). */
  function buildField({ submitLabel, onSubmit }) {
    const wrap = el('div', 'w-board-field');
    const fieldId = 'w-board-callsign';
    const label = el('label', null, 'CALLSIGN');
    label.htmlFor = fieldId;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = fieldId;
    input.maxLength = 16;
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.enterKeyHint = 'done';
    input.value = name;
    // A screen that opens puts the focus on its first stop (menus.js), and here that is this field: right at a
    // desk, where the keys are under the hands. On a phone a focused field is what brings the keyboard up,
    // over half the debrief and unasked — a browser declines to for a focus nobody tapped; a page shown inside
    // an app may not be so lucky. So on a phone it is not a stop: it is typed into when it is tapped.
    if (G.touch) input.tabIndex = 0;
    else stop(input);
    const why = el('p', 'w-board-why');
    const row = el('div');
    const submit = el('button', 'm-btn', submitLabel);
    submit.type = 'button';
    stop(submit);
    function tryIt() {
      const r = callsign(input.value);
      if (!r.ok) {
        why.textContent = r.why;
        return;
      }
      why.textContent = '';
      onSubmit(r.value);
    }
    submit.addEventListener('click', tryIt);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        tryIt();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.blur();
      }
    });
    row.append(input, submit);
    // (who will see it is said as it is: with nowhere to post to — a copy run from a folder, a page carried
    // inside an app — nothing leaves the device, and the line does not say that it does)
    const who = endpoint
      ? 'The callsign and the score are shown to everyone.'
      : 'The callsign and the score are kept on this device.';
    wrap.append(label, row, why, el('p', 'w-board-public', who));
    return wrap;
  }

  // ---------- the title screen's link ----------

  function screenTitle(layer) {
    const foot = layer.querySelector('.m-title-foot');
    if (!foot) return;
    const link = el('button', G.touch ? 'w-board-link w-board-link--touch' : 'w-board-link', 'SCOREBOARD');
    link.type = 'button';
    stop(link);
    link.addEventListener('click', () => G.menus.show('scoreboard'));
    foot.append(link);
  }

  // ---------- the scoreboard screen ----------

  function boardRow(row, place, isSelf) {
    const line = el('div', `w-board-row${isSelf ? ' w-board-row--self' : ''}`);
    const cells = [
      [String(place), 'w-board-place'],
      [row.name, 'w-board-name'],
      [String(row.score), 'w-board-score'],
      [row.difficulty, 'w-board-diff'],
      [row.result, 'w-board-result'],
      [mmss(row.seconds), 'w-board-time'],
    ];
    if (row.device) cells.push([row.device, 'w-board-device']);
    // textContent only: a row is hostile input, planted by anyone who can reach the table
    for (const [text, className] of cells) line.append(el('span', className, text));
    return line;
  }

  function screenBoard(layer) {
    const scrim = el('div', 'm-scrim');
    const panel = el('div', 'm-panel m-enter');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const head = el('div', 'm-panel__head');
    head.append(el('div', 'm-eyebrow', 'SHARED RECORD'), el('h1', 'm-heading', 'SCOREBOARD'));
    const body = el('div', 'm-panel__body');
    const foot = el('div', 'm-panel__foot');
    panel.append(head, body, foot);
    scrim.append(panel);
    layer.append(scrim);

    const who = el('div', 'w-board-head');
    const whoText = el('div', 'w-board-who');
    const change = el('button', 'w-board-change');
    change.type = 'button';
    stop(change);
    const fieldHost = el('div');
    function paintWho() {
      whoText.replaceChildren();
      if (name) {
        whoText.append(document.createTextNode('CALLSIGN '), el('b', null, name));
        change.textContent = 'CHANGE';
      } else {
        whoText.textContent = 'NO CALLSIGN SET';
        change.textContent = 'SET';
      }
    }
    function openField() {
      fieldHost.replaceChildren(
        buildField({
          submitLabel: 'SAVE',
          onSubmit(value) {
            setName(value);
            fieldHost.replaceChildren();
            paintWho();
            boardRefresh?.();
          },
        }),
      );
    }
    change.addEventListener('click', openField);
    paintWho();
    who.append(whoText, change);
    body.append(who, fieldHost);
    if (!name) openField();

    const listHost = el('div');
    body.append(listHost);

    function paint() {
      listHost.replaceChildren();
      saidList = waiting(listAsked, performance.now());
      if (saidList === 'slow') {
        // (said beside whatever rows there are: rows that are being asked for again are not the board's answer)
        listHost.append(el('div', 'w-board-state', 'THE BOARD IS SLOW TO ANSWER — STILL ASKING'));
      } else if (saidList === 'asking' && !listRows.length) {
        listHost.append(el('div', 'w-board-state', 'LOADING…'));
      } else if (listState === 'local') {
        listHost.append(
          el(
            'div',
            'w-board-state w-board-state--warn',
            endpoint ? 'THE BOARD COULD NOT BE REACHED — THIS DEVICE’S OWN SCORES' : 'SCORES ARE KEPT ON THIS DEVICE',
          ),
        );
      }
      const top = listRows.slice(0, TOP);
      if (saidList === 'idle' && !top.length && listState === 'remote') {
        listHost.append(el('div', 'w-board-state', 'NOBODY HAS SET A SCORE YET'));
      } else if (top.length) {
        const list = el('div', 'w-board-list');
        top.forEach((row, i) => list.append(boardRow(row, i + 1, !!name && row.name === name)));
        listHost.append(list);
      }
      const place = name ? rank(listRows, name) : null;
      if (name && place && place > TOP) {
        const row = listRows.find((r) => r.name === name);
        if (row) {
          const own = el('div', 'w-board-own');
          own.append(boardRow(row, place, true));
          listHost.append(own);
        }
      }
    }
    boardRefresh = paint;
    paint();

    const back = el('button', 'm-btn', 'Back');
    back.type = 'button';
    stop(back);
    const toTitle = () => G.menus.show('title', { record: G.record });
    back.addEventListener('click', toTitle);
    foot.append(back);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        toTitle();
      }
    });

    fetchList(false);
  }

  // ---------- the debrief / failed screens ----------

  function screenEnding(name_, layer, data) {
    if (!result) {
      const s = G.stats();
      const input = {
        difficulty: G.settings.get('difficulty'),
        result: name_ === 'debrief' ? 'won' : data.reason,
        seconds: s.seconds,
        shots: s.shots,
        accuracy: s.accuracy,
        charges: s.charges,
        blown: s.blown,
        takedowns: s.takedowns,
        alarms: s.alarms,
        rollSentries,
        rollDrones,
        reinforcements,
        retries,
      };
      result = {
        input,
        breakdown: score(input),
        row: {
          name: '',
          score: 0,
          difficulty: input.difficulty,
          result: input.result,
          seconds: Math.max(0, Math.round(s.seconds)),
          kills: Math.max(0, Math.round(s.kills)),
          alarms: Math.max(0, Math.round(s.alarms)),
          device: G.touch ? 'phone' : 'desk',
          mode: 'play',
          rules: RULES,
          at: new Date().toISOString(),
        },
      };
      result.row.score = result.breakdown.total;
    }

    const host = layer.querySelector('.w-tally') || layer.querySelector('.m-stats');
    if (!host) return; // the hub always builds one of these first; nothing to hang the breakdown off otherwise
    const dl = el('dl', 'm-stats w-board-lines');
    for (const [label, points] of result.breakdown.lines) {
      const row = el('div', 'm-stats__row');
      row.append(el('dt', null, label), el('dd', null, `${points > 0 ? '+' : ''}${points}`));
      dl.append(row);
    }
    const totalRow = el('div', 'm-stats__row');
    totalRow.append(el('dt', null, 'Total'), el('dd', null, String(result.breakdown.total)));
    dl.append(totalRow);
    host.after(dl);

    const postLine = el('p', 'w-board-post');
    if (!name) {
      const field = buildField({
        submitLabel: endpoint ? 'POST' : 'SAVE',
        onSubmit(value) {
          setName(value);
          field.replaceWith(postLine);
          attemptPost();
        },
      });
      dl.after(field, postLine);
    } else {
      dl.after(postLine);
    }
    endingRefresh = () => paintPost(postLine);
    paintPost(postLine);
    attemptPost();
  }

  return {
    name: 'board',

    state() {
      return {
        worked: result ? result.breakdown : null,
        sent: postStatus === 'posted' || postStatus === 'local' || postStatus === 'refused' ? { ...result.row } : null,
        queued: local.queue.length,
        source: listState,
        // what is out, of the list: 'idle', 'asking' or 'slow' (board.js `waiting`)
        list: waiting(listAsked, performance.now()),
      };
    },
    /** for tests: the rows that are waiting, tried again now (the same going-over, if one is under way) */
    retry: () => retryQueue(),

    /** once a drawn frame: the one thing here that changes by the clock alone — a question that has been out a
        while is slow, and the line that speaks of it is painted again when what it would say has changed */
    frame() {
      const now = performance.now();
      if (boardRefresh && waiting(listAsked, now) !== saidList) boardRefresh();
      if (endingRefresh && postWait() !== saidPost) endingRefresh();
    },

    reset() {
      rollSentries = 0;
      rollDrones = 0;
      reinforcements = 0;
      retries = 0;
      result = null;
      postStatus = 'idle';
      placeText = '';
      postAsked = null;
      placeAsked = null;
      endingToken++;
      endingRefresh = null;
    },

    save() {
      return { rollSentries, rollDrones, reinforcements, retries };
    },

    load(saved) {
      rollSentries = saved?.rollSentries || 0;
      rollDrones = saved?.rollDrones || 0;
      reinforcements = saved?.reinforcements || 0;
      retries = (saved?.retries || 0) + 1;
    },

    on: {
      kill(unit, info) {
        if (!unit) return;
        if (unit.rollId < 0) {
          reinforcements++;
          return;
        }
        if (!info?.counted) return;
        if (unit.type === 'drone') rollDrones++;
        else rollSentries++;
      },
    },

    screen(name_, layer, data) {
      // (a screen that has gone is not painted again: each of the two is told what comes in only while shown)
      if (name_ !== 'scoreboard') boardRefresh = null;
      if (name_ !== 'debrief' && name_ !== 'failed') endingRefresh = null;
      if (name_ === 'title') screenTitle(layer);
      else if (name_ === 'scoreboard') screenBoard(layer);
      else if (name_ === 'debrief' || name_ === 'failed') screenEnding(name_, layer, data);
    },
  };
}
