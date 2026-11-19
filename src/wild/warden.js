// WARDEN speaks: what the site's own mind says of what the player does to it. Rules and lines only — no drawing
// and no browser in here; src/wild/warden-live.js joins them to the game — so it runs under `node --test`
// (test/unit/wild-warden.test.mjs).
//
// The wild branch's experiment (docs/WILD.md, "WARDEN speaks"). Until now WARDEN was a name in the briefing and a
// word in Overwatch's mouth. It has guarded this mountain for nine years with nobody in it; the experiment gives
// the player its machines to wear and its drives to break, and it is not a thing that would say nothing. It
// speaks on the radio line, in its own colour, with its own sound — seldom, shortly, and never the same thing
// twice in a mission.

export const WARDEN = {
  /** seconds of the mission between two things it says: it does not chatter */
  gap: 6,
  /** …except these, which are said whatever was said a moment before */
  always: ['overspeed-3', 'overspeed-done'],
};

/** What it says of each thing that happens: in this order, one each time the thing happens, none twice. */
export const LINES = {
  // the site's alarm goes up
  alarm: ['There you are.', 'Again. I have nothing but time, and you have none.'],
  // one of its machines has found a wreck
  found: ['One of mine is lying where you left it. I count them.'],
  // the third lamp shot out
  lamp: ['I do not need the light. You do.'],
  // a tripwire
  tripwire: ['A thread across a door, and you walked through it.', 'You do not look where you step.'],
  // a wave of machines sent for a wire, an alarm or a task done (src/wild/response.js) — said some seconds after
  // whatever it says of the cause itself
  response: [
    'You are heard. More of me is walking to you.',
    'Everything you finish, I answer.',
    'I have more doors than you have counted.',
  ],
  // the first round to a sentry's head has only cracked its visor (src/wild/visor.js)
  visor: ['You cracked its face. It is still looking at you.'],
  // the reflex
  reflex: ['You are quick. I am many.'],
  // a machine turned by the uplink; its forty seconds over
  turned: ['That one is mine. Give it back.', 'You are wearing my hands.', 'Take them, then. I will make more.'],
  burnout: ['It is quiet now. You did that to it.'],
  // one of its own saw a turned machine fire on another, and the alarm went up for it (src/wild/uplink.js WITNESS)
  witnessed: ['I watched you do that. So did they.'],
  // a drone flown; blown up; the link lost some other way
  pilot: ['I can feel you in the air.', 'That is my eye you are looking through.'],
  blown: ['That was my eye.'],
  unlinked: ['It has let go of you.'],
  // a lodestone
  lodestone: ['Magnets, in a hall of rotors. You are not careful people.'],
  // a sentry knocked out of its stride by the slide
  knocked: ['Get up. I was not speaking to you.'],
  // a charge set on a cascade
  charge: ['I felt that go on. I am sending more of me.', 'Another. You mean to bury me before you bury me.'],
  // few machines left on the roll
  few: ['There is not much of me left on this floor.'],
  // the player badly hurt
  hurt: ['You are leaking.'],
  // the lodestar raised
  beacon: ['I know what that calls. I cannot run. Can you?'],
  // the first aftershock, once the cascades are gone (src/wild/aftershock.js)
  aftershock: ['Do you feel that? The mountain is letting go.'],
  // the overspeed, from its beginning to either of its ends
  'overspeed-begin': ['Do not touch the drives.'],
  'overspeed-1': ['Eleven hundred turns a second. They were not built for it.'],
  'overspeed-2': ['Stop. The rotors are walking out of their bearings.'],
  'overspeed-dark': ['You have taken my lights with them.'],
  'overspeed-3': ['Please.'],
  'overspeed-done': ['Nine years.'],
  'overspeed-lost': ['You let go. Good.'],
};

/** @returns {{ told: Record<string, number>, at: number }} how many lines of each thing it has said, and when it last spoke */
export function createWarden() {
  return { told: {}, at: -Infinity };
}

/**
 * A thing has happened, `time` seconds into the mission: what WARDEN says of it, or null — it has said all it has
 * to say of that, or it spoke a moment ago (and then the line is kept for the next time the thing happens).
 */
export function speak(w, event, time) {
  const lines = LINES[event];
  const n = w.told[event] || 0;
  if (!lines || n >= lines.length) return null;
  if (time - w.at < WARDEN.gap && !WARDEN.always.includes(event)) return null;
  w.told[event] = n + 1;
  w.at = time;
  return lines[n];
}
