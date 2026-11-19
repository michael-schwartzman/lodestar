// The player's settings: one list that says what there is, and a small store that remembers only what was chosen.
//
// Only values that differ from the defaults are saved. A default can therefore change in a later version and reach
// everybody who never touched that setting.
export const STORAGE_KEY = 'lodestar.settings.v1';

/**
 * Every setting the game has. The settings screen is drawn from this list.
 * type: 'range' (min, max, step) · 'toggle' · 'choice' (options: [value, label][])
 * touch: true — only shown on a touch screen.
 */
export const SCHEMA = [
  {
    key: 'difficulty',
    group: 'Operation',
    label: 'Difficulty',
    type: 'choice',
    def: 'operator',
    options: [
      ['recruit', 'Recruit'],
      ['operator', 'Operator'],
      ['ghost', 'Ghost'],
    ],
    hint: 'How many machines guard the site (9, 13 or 20), how sharp they are and how hard they hit. Takes effect on the next deployment or retry.',
  },
  { key: 'sensitivity', group: 'Controls', label: 'Look speed', type: 'range', def: 1, min: 0.2, max: 3, step: 0.05 },
  { key: 'invertY', group: 'Controls', label: 'Invert look up / down', type: 'toggle', def: false },
  {
    key: 'fireButton',
    group: 'Controls',
    label: 'Fire button',
    type: 'choice',
    def: 'both',
    touch: true,
    options: [
      ['left', 'Left'],
      ['right', 'Right'],
      ['both', 'Both'],
    ],
    hint: 'Slide off the left button to walk, off the right button to aim.',
  },
  {
    key: 'tapFire',
    group: 'Controls',
    label: 'Double tap to fire',
    type: 'toggle',
    def: true,
    touch: true,
    hint: 'Tap, then press and hold in the aiming area: fires while held, and still aims.',
  },
  { key: 'fov', group: 'Picture', label: 'Field of view', type: 'range', def: 74, min: 60, max: 100, step: 1 },
  { key: 'brightness', group: 'Picture', label: 'Brightness', type: 'range', def: 1, min: 0.6, max: 1.8, step: 0.05 },
  {
    key: 'quality',
    group: 'Picture',
    label: 'Detail',
    type: 'choice',
    def: 'auto',
    options: [
      ['auto', 'Auto'],
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ],
    hint: 'Takes effect the next time the game is opened.',
  },
  { key: 'headBob', group: 'Picture', label: 'Head bob', type: 'toggle', def: true },
  { key: 'volume', group: 'Sound', label: 'Volume', type: 'range', def: 0.8, min: 0, max: 1, step: 0.05 },
  { key: 'music', group: 'Sound', label: 'Music', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05 },
  {
    key: 'ambience',
    group: 'Sound',
    label: 'Ambience',
    type: 'range',
    def: 0.6,
    min: 0,
    max: 1,
    step: 0.05,
    hint: 'Wind, air and machinery in the background. Guards, drones and alarms are not turned down by this.',
  },
];

const BY_KEY = new Map(SCHEMA.map((item) => [item.key, item]));

/** The defaults, as a plain object. */
export function defaults() {
  return Object.fromEntries(SCHEMA.map((item) => [item.key, item.def]));
}

/** Makes a value fit its setting, or returns undefined if it cannot be one. */
export function coerce(key, value) {
  const item = BY_KEY.get(key);
  if (!item) return undefined;
  if (item.type === 'toggle') return typeof value === 'boolean' ? value : undefined;
  if (item.type === 'choice') return item.options.some(([v]) => v === value) ? value : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const stepped = Math.round((value - item.min) / item.step) * item.step + item.min;
  return Number(Math.min(item.max, Math.max(item.min, stepped)).toFixed(4));
}

/**
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void } | null} storage
 *   localStorage, or anything shaped like it; null keeps the settings in memory only.
 */
export function createSettings(storage) {
  const chosen = {};
  const listeners = new Set();

  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}');
    if (saved && typeof saved === 'object')
      for (const [key, value] of Object.entries(saved)) {
        const fit = coerce(key, value);
        if (fit !== undefined && fit !== BY_KEY.get(key).def) chosen[key] = fit;
      }
  } catch {
    // a broken or blocked store must never stop the game starting
  }

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(chosen));
    } catch {
      // private browsing, a full store — the choice still holds for this visit
    }
  }

  return {
    get(key) {
      if (!BY_KEY.has(key)) throw new Error(`unknown setting: ${key}`);
      return key in chosen ? chosen[key] : BY_KEY.get(key).def;
    },
    /** Sets a value; returns the value actually stored (it is fitted to the setting's range first). */
    set(key, value) {
      const fit = coerce(key, value);
      if (fit === undefined) throw new Error(`bad value for ${key}: ${value}`);
      if (fit === BY_KEY.get(key).def) delete chosen[key];
      else chosen[key] = fit;
      save();
      for (const fn of listeners) fn(key, fit);
      return fit;
    },
    /** Every setting with its current value. */
    all() {
      return { ...defaults(), ...chosen };
    },
    /** Only what the player changed. */
    chosen() {
      return { ...chosen };
    },
    reset() {
      const keys = Object.keys(chosen);
      for (const key of keys) delete chosen[key];
      save();
      for (const key of keys) for (const fn of listeners) fn(key, BY_KEY.get(key).def);
    },
    /** Calls fn(key, value) after every change; returns a function that stops it. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
