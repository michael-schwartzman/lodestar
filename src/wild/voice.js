// The site speaks aloud: which recorded line is heard when. Rules and words only — no Web Audio and no browser
// in here; src/wild/voice-live.js fetches the clips and plays them — so it runs under `node --test`
// (test/unit/wild-voice.test.mjs).
//
// The wild build (docs/WILD.md, "Voices"). The owner, 17 November 2026: "make the sound wild and more elaborate
// and realistic". Until then nothing in this game had a voice: WARDEN's lines were read off the radio to the
// blare of a sentry. Now there are two voices in the mountain. WARDEN's — every line it has (src/wild/warden.js),
// said by a speech model, slowed and deepened. And the site's public address: a recording made long ago for
// people who are no longer there, which still reads out its alerts to empty halls.

export const VOICE = {
  /** seconds between a line being put on the radio and its being heard: the radio's own blip comes first */
  after: 0.3,
  /**
   * how loud each speaker is, as a part of the clip's own level. Measured in the built game, 17 November 2026
   * (the loudest 0.4 s of each, RMS): WARDEN −16 dBFS, the alarm's siren as the game plays it −22, the address
   * at 0.7 of itself −21 — over the siren it reads its alert to, and under WARDEN
   */
  level: { warden: 1, pa: 0.7 },
  /** how much of each is sent round the room it is heard in (src/wild/mix.js): the address IS the room */
  send: { warden: 0.3, pa: 1 },
  /** how much of the music is left under WARDEN while it speaks (the address is spoken over by everything) */
  duck: 0.5,
  /** seconds of quiet a speaker leaves between two of its own lines: it never talks over itself */
  breath: 0.35,
};

/** What is said aloud that is not WARDEN's: for each speaker, the words of each clip. */
export const SPOKEN = {
  pa: {
    'alarm-0': 'Attention. Security alert. Intruder on site. All units respond.',
    'alarm-1': 'Attention. Security alert. This is not a drill.',
    'clear-0': 'Alert cancelled. All units, return to patrol.',
    'overspeed-0': 'Warning. Drive overspeed in the cascade hall.',
    'blast-0': 'Emergency. Cascade failure. All personnel leave the hall at once.',
    'evacuate-0': 'Evacuate. Evacuate. All personnel to the surface.',
  },
};

/**
 * What the public address says of each thing that happens, and how long after it: the alarm's own blare, the
 * blast and whoever is on the radio come first. `drops`: what need no longer be said once this is.
 */
export const ADDRESS = {
  alarm: { lines: ['alarm-0', 'alarm-1'], after: 2.6, drops: ['clear'] },
  clear: { lines: ['clear-0'], after: 1.2, drops: ['alarm'] },
  overspeed: { lines: ['overspeed-0'], after: 3.5, drops: [] },
  blast: { lines: ['blast-0'], after: 3, drops: ['alarm', 'clear', 'overspeed'] },
  evacuate: { lines: ['evacuate-0'], after: 6, drops: ['alarm', 'clear', 'overspeed'] },
};

/** @returns {{ told: Record<string, number>, waiting: { event: string, id: string, at: number }[] }} */
export function createAddress() {
  return { told: {}, waiting: [] };
}

/**
 * A thing has happened, `time` seconds into the mission: the address will say its line of it when its wait is
 * over (see `due`) — its lines of one thing by turns. What that makes stale is not said after all.
 */
export function announce(a, event, time) {
  const rule = ADDRESS[event];
  if (!rule) return;
  a.waiting = a.waiting.filter((w) => w.event !== event && !rule.drops.includes(w.event));
  const n = a.told[event] || 0;
  a.told[event] = n + 1;
  a.waiting.push({ event, id: rule.lines[n % rule.lines.length], at: time + rule.after });
}

/** @returns {string[]} the lines whose wait is over at `time`, in the order they were asked for */
export function due(a, time) {
  const now = a.waiting.filter((w) => w.at <= time);
  a.waiting = a.waiting.filter((w) => w.at > time);
  return now.map((w) => w.id);
}
