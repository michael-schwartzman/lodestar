// Every menu screen, as plain DOM + CSS. This module only renders, reads/writes `settings`, and calls `on.*`:
// it never starts, stops, or otherwise reaches into the game (see docs/DESIGN.md §8.6).
import './menus.css';
import { SCHEMA } from '../settings.js';

// The briefing's difficulty choice gets its own one-line meaning per option (the settings screen uses
// SCHEMA's generic hint instead — these two are deliberately different texts for two different places).
const DIFFICULTY_BRIEF = {
  recruit: '9 machines, slow to notice, soft hits. One fires at a time.',
  operator: '13 machines. As WARDEN was built.',
  ghost: '20 machines, sharp eyes, hard hits — and no radar.',
};

// How a range setting's live value is printed. Anything not listed falls back to two decimal places.
const RANGE_FORMAT = {
  sensitivity: (v) => `${v.toFixed(2)}×`,
  fov: (v) => `${Math.round(v)}°`,
  brightness: (v) => v.toFixed(2),
  volume: (v) => `${Math.round(v * 100)}%`,
  music: (v) => `${Math.round(v * 100)}%`,
  ambience: (v) => `${Math.round(v * 100)}%`,
};

// This table is the content of docs/DESIGN.md §7; the menu owns the rendering, that document owns the wording.
// (Exported so that the wild branch's experiment can add its own rows when it is on: src/wild/index.js.)
export const CONTROLS_ROWS = [
  ['Move', 'W A S D', 'Left thumb: stick appears where you touch'],
  ['Look', 'Mouse', 'Right thumb: drag anywhere on the right'],
  ['Fire', 'Left button, or X', 'FIRE on either side, or double tap and hold in the aim area'],
  ['Aim down the sight', 'Right button: hold it, or click to keep the sight up. Or Z', 'AIM (toggle)'],
  ['Lean left / right', 'Q / E (hold)', '—'],
  ['Jump', 'Space', 'JUMP'],
  ['Reload', 'R', 'RELOAD'],
  [
    'Change gun: carbine, sidearm, shotgun',
    '1, 2 and 3 — or the mouse wheel',
    'the button that names the gun in hand: tap it for the next',
  ],
  ['The carbine: AUTO or SEMI', 'B', 'hold that same button'],
  ['EMP grenade: stops machines, harms none — and puts out the lamps of the room', 'T', 'EMP'],
  ['Crouch', 'C or Ctrl (toggle)', 'CROUCH (toggle)'],
  ['Run', 'Shift', 'push the stick to its edge'],
  [
    'Knife',
    'V. And FIRE, once no gun has a round left',
    'USE says KNIFE in reach of a machine. And FIRE, once no gun has a round left',
  ],
  [
    'Use: set a charge, fire them, take down',
    'F (hold it to set a charge, to fire the charges, to raise the lodestar)',
    'the USE button, which appears when there is something to use',
  ],
  [
    'Take a sentry as a shield',
    'G, from behind it. Then G lets go, F shuts it down',
    'SHIELD, beside USE. Then LET GO or SHUT DOWN',
  ],
  [
    'Drag a fallen machine out of sight',
    'G, beside it and facing it. G again lets go',
    'DRAG, where SHIELD is. Then LET GO',
  ],
  ['Night vision: see in the dark you have made', 'N', 'NV'],
  ['Put a lamp out', 'shoot its lens', 'shoot its lens'],
  ['Map', 'Tab or M', 'tap the minimap'],
  ['Pause', 'Esc or P', 'the pause button'],
];

const CHECK_SVG = '<svg viewBox="0 0 11 11" aria-hidden="true"><path d="M1.5 6 L4.5 9 L9.5 2"/></svg>';

// A schematic phone held sideways: left thumb (move), right thumb (look/aim), a FIRE bar on each edge, and the
// small buttons along the top. Positions are indicative, not pixel-accurate — "schematic is fine".
const PHONE_SCHEMATIC_SVG = `
<svg class="m-schematic" viewBox="0 0 300 150" aria-hidden="true">
  <rect class="line-strong" x="2" y="2" width="296" height="146" rx="12" fill="none" />
  <rect class="mint-dim" x="10" y="38" width="16" height="72" fill="none" />
  <text class="mute" x="18" y="30" text-anchor="middle">FIRE</text>
  <rect class="mint-dim" x="274" y="38" width="16" height="72" fill="none" />
  <text class="mute" x="282" y="30" text-anchor="middle">FIRE</text>
  <circle class="mint" cx="78" cy="108" r="27" fill="none" />
  <circle class="mint" cx="78" cy="108" r="5" fill="currentColor" />
  <text class="mute" x="78" y="142" text-anchor="middle">MOVE · LEFT THUMB</text>
  <circle class="mint" cx="206" cy="92" r="36" fill="none" stroke-dasharray="4 4" />
  <text class="mute" x="206" y="142" text-anchor="middle">LOOK / AIM · RIGHT THUMB</text>
  <g class="mute" fill="none">
    <rect x="30" y="14" width="34" height="15" />
    <rect x="67" y="14" width="34" height="15" />
    <rect x="104" y="14" width="26" height="15" />
    <rect x="133" y="14" width="32" height="15" />
    <rect x="168" y="14" width="22" height="15" />
    <rect x="193" y="14" width="18" height="15" />
    <rect x="214" y="14" width="24" height="15" />
    <rect x="241" y="14" width="30" height="15" />
  </g>
  <text class="mute" x="47" y="25" text-anchor="middle">CROUCH</text>
  <text class="mute" x="84" y="25" text-anchor="middle">RELOAD</text>
  <text class="mute" x="117" y="25" text-anchor="middle">JUMP</text>
  <text class="mute" x="149" y="25" text-anchor="middle">SHIELD</text>
  <text class="mute" x="179" y="25" text-anchor="middle">USE</text>
  <text class="mute" x="202" y="25" text-anchor="middle">NV</text>
  <text class="mute" x="226" y="25" text-anchor="middle">MAP</text>
  <text class="mute" x="256" y="25" text-anchor="middle">PAUSE</text>
</svg>`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fromHTML(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild;
}

function mmss(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatRange(key, value) {
  const fn = RANGE_FORMAT[key];
  return fn ? fn(value) : value.toFixed(2);
}

/**
 * Builds every menu screen inside `root` (the game passes `#ui`).
 * @param {object} o
 * @param {HTMLElement} o.root
 * @param {object} o.settings createSettings() from src/settings.js: get/set/all/reset/onChange
 * @param {boolean} o.touch true on a touch device
 * @param {object} o.on on.deploy() on.begin() on.resume() on.restart() on.quit() on.sound(name)
 * @returns {{ show(name: string, data?: object): void, hide(): void, current(): string|null, back(): void }}
 */
export function createMenus({ root, settings, touch, on }) {
  const layer = el('div');
  layer.id = 'menus';
  root.appendChild(layer);

  let screen = null;
  let lastShown = null; // { name, data } — the most recently rendered top-level screen (title or pause)
  let lastTitleData = { record: null };
  let cameFrom = null; // { name, data } to return to when settings/controls close
  let controlsDevice = touch ? 'phone' : 'desk'; // local view choice on the controls screen, not a setting
  let boundUpdaters = new Map(); // setting key -> (value) => void, for whatever is on screen right now
  let segHandlers = new Map(); // .m-seg element -> (dir) => void, for ArrowLeft/ArrowRight
  let suppressMoveSound = false; // true for exactly the next focus change caused by opening a screen

  settings.onChange((key, value) => boundUpdaters.get(key)?.(value));

  // ---------- focus: a flat, live list of every reachable control, in visual order ----------

  function stops() {
    return Array.from(layer.querySelectorAll('[data-stop]'));
  }

  function focusFirstStop() {
    const first = stops()[0];
    if (!first) return;
    suppressMoveSound = true;
    // a freshly-opened screen must start scrolled to its top, even if its first stop sits further down
    // (e.g. pause's objectives come before its first button) — a plain focus() would scroll to reveal it
    first.focus({ preventScroll: true });
  }

  function moveFocus(dir) {
    const list = stops();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const next = i === -1 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    list[next].focus();
  }

  layer.addEventListener('focusin', (e) => {
    for (const node of layer.querySelectorAll('.is-focus')) node.classList.remove('is-focus');
    const stopEl = e.target.closest?.('[data-stop]');
    if (stopEl) {
      stopEl.classList.add('is-focus');
      if (!suppressMoveSound) on.sound('uiMove');
    }
    suppressMoveSound = false;
  });

  // Up/Down and Tab move between controls; Left/Right change the one that has focus; Esc goes back.
  layer.addEventListener('keydown', (e) => {
    if (!screen) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      moveFocus(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      doBack();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const active = document.activeElement;
      if (!active || !layer.contains(active)) return;
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (active.matches('[role="switch"]')) {
        e.preventDefault();
        on.sound('uiSelect');
        settings.set(active.dataset.setting, dir > 0);
        return;
      }
      const seg = active.closest('.m-seg');
      if (seg) {
        e.preventDefault();
        segHandlers.get(seg)?.(dir);
      }
      // a focused <input type=range> is left to the browser: its own ArrowLeft/ArrowRight already match this rule
    }
  });

  // ---------- small builders shared by every screen ----------

  function button(label, { action, primary = false, block = false, stop = true, onClick } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = ['m-btn', primary && 'm-btn--primary', block && 'm-btn--block'].filter(Boolean).join(' ');
    if (action) b.dataset.action = action;
    b.tabIndex = stop ? 0 : -1;
    if (stop) b.dataset.stop = '';
    b.textContent = label;
    b.addEventListener('click', () => {
      on.sound('uiSelect');
      onClick?.();
    });
    return b;
  }

  function gameButton(label, verb, opts = {}) {
    return button(label, { action: verb, onClick: () => on[verb](), ...opts });
  }

  function backButton(label = 'Back') {
    return button(label, { action: 'back', onClick: doBack });
  }

  /** A button that, the first time it is pressed, is replaced by an inline "Sure? Yes / No". */
  function confirmButton(label, verb, onYes) {
    const host = el('span');
    function idle() {
      host.replaceChildren(button(label, { action: verb, block: true, onClick: ask }));
    }
    function ask() {
      const row = el('div', 'm-confirm');
      const yes = button('Yes', { action: verb, onClick: onYes });
      const no = button('No', { onClick: idle });
      row.append(el('span', 'm-confirm__q', 'Sure?'), yes, no);
      host.replaceChildren(row);
      yes.focus();
    }
    idle();
    return host;
  }

  /** The scrim + card every screen but `title` sits in: a fixed head and foot around a scrolling body. */
  function openPanel({ wide = false } = {}) {
    const scrim = el('div', 'm-scrim');
    const panel = el('div', `m-panel${wide ? ' m-panel--wide' : ''} m-enter`);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const head = el('div', 'm-panel__head');
    const body = el('div', 'm-panel__body');
    const foot = el('div', 'm-panel__foot');
    panel.append(head, body, foot);
    scrim.append(panel);
    layer.append(scrim);
    return { head, body, foot };
  }

  // ---------- settings controls: range (native input), toggle (drawn switch), choice (segmented buttons) ----------

  function buildRange(item) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(item.min);
    input.max = String(item.max);
    input.step = String(item.step);
    input.value = String(settings.get(item.key));
    input.dataset.setting = item.key;
    input.dataset.stop = '';
    input.setAttribute('aria-label', item.label);
    return input;
  }

  function buildToggle(item) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'm-switch';
    b.setAttribute('role', 'switch');
    b.dataset.setting = item.key;
    b.dataset.stop = '';
    const track = el('span', 'm-switch__track');
    track.append(el('span', 'm-switch__thumb'));
    const label = el('span', 'm-switch__label');
    b.append(track, label);
    function apply(value) {
      b.classList.toggle('is-on', value);
      b.setAttribute('aria-checked', String(value));
      label.textContent = value ? 'ON' : 'OFF';
    }
    apply(settings.get(item.key));
    b.addEventListener('click', () => {
      on.sound('uiSelect');
      settings.set(item.key, !settings.get(item.key));
    });
    boundUpdaters.set(item.key, apply);
    return b;
  }

  /** A row of segmented buttons bound to settings[item.key]; `onValue(value)` fires after every change. */
  function buildSeg(item, onValue) {
    const group = el('div', 'm-seg');
    group.dataset.setting = item.key;
    group.setAttribute('role', 'radiogroup');
    const buttons = item.options.map(([value, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-seg__btn';
      b.dataset.setting = item.key;
      b.dataset.value = value;
      b.setAttribute('role', 'radio');
      b.textContent = label;
      b.addEventListener('click', () => {
        on.sound('uiSelect');
        settings.set(item.key, value);
      });
      group.append(b);
      return b;
    });
    function apply(value, moveFocusTo) {
      let toFocus = null;
      for (const b of buttons) {
        const selected = b.dataset.value === String(value);
        b.classList.toggle('is-selected', selected);
        b.setAttribute('aria-checked', String(selected));
        b.tabIndex = selected ? 0 : -1;
        if (selected) b.dataset.stop = '';
        else delete b.dataset.stop;
        if (selected && moveFocusTo) toFocus = b;
      }
      // set the ring directly rather than wait for a focusin event: a mouse click already moved native focus
      // to this button before its attributes changed, so re-focusing it now fires no further event at all
      if (toFocus) {
        for (const node of layer.querySelectorAll('.is-focus')) node.classList.remove('is-focus');
        toFocus.classList.add('is-focus');
        toFocus.focus();
      }
    }
    apply(settings.get(item.key), false);
    boundUpdaters.set(item.key, (value) => {
      apply(value, group.contains(document.activeElement));
      onValue?.(value);
    });
    onValue?.(settings.get(item.key));
    segHandlers.set(group, (dir) => {
      const i = buttons.findIndex((b) => b.tabIndex === 0);
      const next = Math.min(buttons.length - 1, Math.max(0, i + dir));
      if (next === i) return;
      on.sound('uiSelect');
      settings.set(item.key, buttons[next].dataset.value);
    });
    return group;
  }

  function settingRow(item) {
    const row = el('div', 'm-row');
    const top = el('div', 'm-row__top');
    top.append(el('span', 'm-row__label', item.label));
    row.append(top);
    if (item.type === 'range') {
      const valueEl = el('span', 'm-row__value', formatRange(item.key, settings.get(item.key)));
      top.append(valueEl);
      const input = buildRange(item);
      input.addEventListener('input', () => settings.set(item.key, Number(input.value)));
      input.addEventListener('change', () => on.sound('uiSelect'));
      boundUpdaters.set(item.key, (value) => {
        input.value = String(value);
        valueEl.textContent = formatRange(item.key, value);
      });
      const wrap = el('div', 'm-range');
      wrap.append(input);
      row.append(wrap);
    } else if (item.type === 'toggle') {
      row.append(buildToggle(item));
    } else if (item.type === 'choice') {
      row.append(buildSeg(item));
    }
    if (item.hint) row.append(el('div', 'm-row__hint', item.hint));
    return row;
  }

  function groupedSchema() {
    const order = [];
    const byName = new Map();
    for (const item of SCHEMA) {
      if (item.touch && !touch) continue;
      let group = byName.get(item.group);
      if (!group) {
        group = { name: item.group, items: [] };
        byName.set(item.group, group);
        order.push(group);
      }
      group.items.push(item);
    }
    return order;
  }

  // ---------- screens ----------

  function renderTitle(data) {
    // on a desk the title stands in the middle of the screen; on a phone, down its left edge (menus.css)
    const col = el('div', `m-title-col m-enter${touch ? '' : ' m-title-col--desk'}`);
    const main = el('div');
    main.append(el('div', 'm-wordmark', 'LODESTAR'), el('div', 'm-tagline', 'OPERATION HAMMERFALL'));
    const list = el('div', 'm-menu-list');
    list.append(
      gameButton('Deploy', 'deploy', { primary: true, block: true }),
      button('Settings', { action: 'settings', block: true, onClick: () => openSub('settings') }),
      button('Controls', { action: 'controls', block: true, onClick: () => openSub('controls') }),
    );
    main.append(list);
    col.append(main, el('div', 'm-title-spacer'));

    const foot = el('div', 'm-title-foot');
    if (data.record)
      foot.append(el('div', 'm-record', `BEST  ${mmss(data.record.seconds)} · GRADE ${data.record.grade}`));
    foot.append(el('div', null, 'SITE HOLLOW NINE · UNDER THE MOUNTAIN'));
    col.append(foot);
    layer.append(col);
  }

  function renderBriefing() {
    const { head, body, foot } = openPanel();
    head.append(el('div', 'm-eyebrow', 'BRIEFING'), el('h1', 'm-heading', 'OPERATION HAMMERFALL'));
    body.append(
      el(
        'p',
        'm-brief-text',
        'Site Hollow Nine is not on any map. It is a uranium enrichment facility cut into the root of a mountain: ' +
          'one cavern, its cascade hall under at least fifty metres of rock, one road tunnel, one exhaust shaft, ' +
          'and not one person inside. WARDEN, the system that guards it, keeps sentries on the ground and drones ' +
          'in the air. Hammerfall will bury it; your charges see to it first that not one centrifuge in that hall ' +
          'can ever be dug out and run again. You go in alone, Wraith — by the drainage adit.',
      ),
    );
    const tasks = el('ol', 'm-tasks');
    for (const text of [
      'Shut down every guard machine in the mountain.',
      'Set a charge on each of the four centrifuge cascades, then blow them from the control room.',
      'Raise the lodestar on the pad under the exhaust shaft — the one place inside that can see the sky. It calls Hammerfall.',
      'Get out by the road tunnel to the pickup before Hammerfall lands.',
    ])
      tasks.append(el('li', null, text));
    body.append(tasks);
    body.append(
      el(
        'p',
        'm-closing',
        'Darkness hides you. Light, noise and haste do not. A lamp can be shot out, an EMP puts a whole room in ' +
          'the dark for twenty seconds — and your goggles see in it. Their eyes do not.',
      ),
    );

    const item = SCHEMA.find((s) => s.key === 'difficulty');
    const row = el('div', 'm-row');
    row.append(el('div', 'm-row__label', item.label));
    const hint = el('div', 'm-row__hint');
    row.append(
      buildSeg(item, (value) => (hint.textContent = DIFFICULTY_BRIEF[value] || '')),
      hint,
    );
    body.append(row);

    foot.append(backButton(), el('div', 'm-spacer'), gameButton('Begin', 'begin', { primary: true }));
  }

  function renderPause(data) {
    const { head, body, foot } = openPanel();
    head.append(el('div', 'm-eyebrow', 'MISSION HALTED'), el('h1', 'm-heading', 'PAUSED'));
    if (data.phase) head.append(el('div', 'm-phase', String(data.phase).toUpperCase()));

    const list = el('div', 'm-objectives');
    for (const obj of data.objectives || []) {
      const row = el('div', `m-obj${obj.done ? ' is-done' : ''}`);
      const box = el('div', 'm-obj__box');
      if (obj.done) box.append(fromHTML(CHECK_SVG));
      row.append(box, el('span', null, obj.text));
      list.append(row);
    }
    body.append(list, el('hr', 'm-rule'));
    const actions = el('div', 'm-menu-list');
    actions.append(
      button('Settings', { action: 'settings', block: true, onClick: () => openSub('settings') }),
      button('Controls', { action: 'controls', block: true, onClick: () => openSub('controls') }),
      confirmButton('Restart', 'restart', () => on.restart()),
      confirmButton('Abort to title', 'quit', () => on.quit()),
    );
    body.append(actions);

    foot.append(gameButton('Resume', 'resume', { primary: true, block: true }));
  }

  function renderSettings() {
    const { head, body, foot } = openPanel();
    head.append(el('div', 'm-eyebrow', 'CONFIGURE'), el('h1', 'm-heading', 'SETTINGS'));
    for (const group of groupedSchema()) {
      const g = el('div', 'm-group');
      g.append(el('div', 'm-group__title', group.name));
      for (const item of group.items) g.append(settingRow(item));
      body.append(g);
    }
    foot.append(
      confirmButton('Reset to defaults', 'reset', () => settings.reset()),
      el('div', 'm-spacer'),
      backButton(),
    );
  }

  function renderControls() {
    const { head, body, foot } = openPanel({ wide: true });
    head.append(el('div', 'm-eyebrow', 'FIELD MANUAL'), el('h1', 'm-heading', 'CONTROLS'));

    const seg = el('div', 'm-seg');
    const deskBtn = el('button', 'm-seg__btn', 'Desk');
    const phoneBtn = el('button', 'm-seg__btn', 'Phone');
    deskBtn.type = phoneBtn.type = 'button';
    deskBtn.dataset.view = 'desk';
    phoneBtn.dataset.view = 'phone';
    seg.append(deskBtn, phoneBtn);
    const switchRow = el('div', 'm-switchview');
    switchRow.append(seg);

    const tableHost = el('div');
    const schemHost = el('div');
    body.append(switchRow, tableHost, schemHost);

    function applySeg(moveFocusTo) {
      let toFocus = null;
      for (const b of [deskBtn, phoneBtn]) {
        const selected = b.dataset.view === controlsDevice;
        b.classList.toggle('is-selected', selected);
        b.tabIndex = selected ? 0 : -1;
        if (selected) b.dataset.stop = '';
        else delete b.dataset.stop;
        if (selected && moveFocusTo) toFocus = b;
      }
      // see buildSeg's apply(): a click already moved native focus before these attributes existed
      if (toFocus) {
        for (const node of layer.querySelectorAll('.is-focus')) node.classList.remove('is-focus');
        toFocus.classList.add('is-focus');
        toFocus.focus();
      }
    }
    function renderTable() {
      const table = document.createElement('table');
      table.className = 'm-table';
      const headRow = table.createTHead().insertRow();
      headRow.append(el('th', null, 'Action'), el('th', null, controlsDevice === 'desk' ? 'Desk' : 'Phone'));
      const tbody = table.createTBody();
      for (const [action, desk, phone] of CONTROLS_ROWS) {
        const r = tbody.insertRow();
        r.append(el('td', null, action), el('td', null, controlsDevice === 'desk' ? desk : phone));
      }
      tableHost.replaceChildren(table);
    }
    function renderSchem() {
      schemHost.replaceChildren(...(controlsDevice === 'phone' ? [fromHTML(PHONE_SCHEMATIC_SVG)] : []));
    }
    function setDevice(device) {
      controlsDevice = device;
      applySeg(true);
      renderTable();
      renderSchem();
    }
    deskBtn.addEventListener('click', () => {
      on.sound('uiSelect');
      setDevice('desk');
    });
    phoneBtn.addEventListener('click', () => {
      on.sound('uiSelect');
      setDevice('phone');
    });
    segHandlers.set(seg, (dir) => {
      const order = ['desk', 'phone'];
      const next = order[Math.min(order.length - 1, Math.max(0, order.indexOf(controlsDevice) + dir))];
      if (next !== controlsDevice) {
        on.sound('uiSelect');
        setDevice(next);
      }
    });
    applySeg(false);
    renderTable();
    renderSchem();

    foot.append(el('div', 'm-spacer'), backButton());
  }

  function statRow(label, value) {
    const row = el('div', 'm-stats__row');
    row.append(el('dt', null, label), el('dd', null, value));
    return row;
  }

  function renderFailed(data) {
    const { head, body, foot } = openPanel();
    const lost = data.reason === 'lost';
    head.append(
      el('h1', 'm-heading', lost ? 'HAMMERFALL LANDED' : 'WRAITH IS DOWN'),
      el('p', 'm-sub', lost ? 'You were still inside the mountain.' : 'Signal lost inside Site Hollow Nine.'),
    );
    const stats = data.stats || {};
    const dl = el('dl', 'm-stats');
    dl.append(
      statRow('Time in', mmss(stats.seconds)),
      statRow('Machines shut down', `${stats.kills ?? 0} / ${stats.total ?? 0}`),
      statRow('Charges set', `${stats.charges ?? 0} / ${stats.chargesTotal ?? 0}`),
      statRow('Cascades', stats.blown ? 'Blown' : 'Standing'),
    );
    body.append(dl);
    // a charge that was set, and the charges once fired, are a checkpoint: say so, because RETRY then means
    // something different
    if (data.checkpoint)
      body.append(
        el('p', 'm-note', `RETRY puts you back ${data.checkpoint}. What you had done by then is still done.`),
      );
    foot.append(gameButton('Title', 'quit'), el('div', 'm-spacer'), gameButton('Retry', 'restart', { primary: true }));
  }

  function renderDebrief(data) {
    const { head, body, foot } = openPanel();
    head.append(
      el('h1', 'm-heading', 'SITE HOLLOW NINE IS GONE'),
      el('p', 'm-sub', 'Hammerfall on target. Wraith is clear.'),
    );
    const stats = data.stats || {};
    const grade = el('div', 'm-grade', stats.grade || '—');
    grade.dataset.grade = stats.grade || '';
    body.append(grade);
    if (data.newRecord) body.append(el('div', 'm-newbest', 'New best'));
    const accuracy = stats.accuracy == null ? null : stats.accuracy <= 1 ? stats.accuracy * 100 : stats.accuracy;
    const dl = el('dl', 'm-stats');
    dl.append(
      statRow('Time', mmss(stats.seconds)),
      statRow('Shots fired', String(stats.shots ?? 0)),
      statRow('Accuracy', accuracy == null ? '—' : `${Math.round(accuracy)}%`),
      statRow('Machines shut down', String(stats.kills ?? 0)),
      statRow('Silent takedowns', String(stats.takedowns ?? 0)),
      statRow('Alarms raised', String(stats.alarms ?? 0)),
      statRow('Damage taken', String(stats.damage ?? 0)),
    );
    body.append(dl);
    foot.append(
      gameButton('Title', 'quit'),
      el('div', 'm-spacer'),
      gameButton('Play again', 'restart', { primary: true }),
    );
  }

  const RENDERERS = {
    title: renderTitle,
    briefing: renderBriefing,
    pause: renderPause,
    settings: renderSettings,
    controls: renderControls,
    failed: renderFailed,
    debrief: renderDebrief,
  };

  // ---------- navigation ----------

  function renderScreen(name, data) {
    layer.replaceChildren();
    boundUpdaters = new Map();
    segHandlers = new Map();
    screen = name;
    layer.dataset.screen = name;
    if (name === 'title') lastTitleData = data || { record: null };
    lastShown = { name, data };
    RENDERERS[name]?.(data || {});
    // whoever made the menus may have a word to add to a screen once it is built (main.js: the experiment)
    on.screen?.(name, layer, data || {});
    focusFirstStop();
  }

  /** Opens settings/controls from title or pause, remembering which one asked so BACK can return to it. */
  function openSub(name) {
    cameFrom = lastShown;
    renderScreen(name, undefined);
  }

  /** What Esc, and every screen's BACK button, does — see docs/DESIGN.md §8.6 for the rules this follows. */
  function doBack() {
    if (screen === 'briefing') {
      on.sound('uiBack');
      renderScreen('title', lastTitleData);
    } else if (screen === 'settings' || screen === 'controls') {
      on.sound('uiBack');
      // normally there is always a cameFrom (settings/controls are only ever opened from title or pause); this
      // falls back to title so a screen shown directly (e.g. the preview's ?screen=settings) is never a dead end
      const target = cameFrom || { name: 'title', data: lastTitleData };
      cameFrom = null;
      renderScreen(target.name, target.data);
    } else if (screen === 'pause') {
      on.sound('uiBack');
      on.resume();
    }
    // title, failed, debrief: Esc/back does nothing
  }

  return {
    /** Opens a screen (building it fresh) with the data its contract above asks for. */
    show(name, data) {
      renderScreen(name, data);
    },
    /** Closes whatever screen is open; the layer lets pointer events through again. */
    hide() {
      layer.replaceChildren();
      delete layer.dataset.screen;
      screen = null;
      cameFrom = null;
      boundUpdaters = new Map();
      segHandlers = new Map();
    },
    /** The name of the open screen, or null. */
    current() {
      return screen;
    },
    /** What Esc / the BACK button does on the open screen. */
    back() {
      doBack();
    },
  };
}
