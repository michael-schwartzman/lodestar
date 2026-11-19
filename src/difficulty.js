// How hard each setting is, in one table. Nothing else in the game holds a number that depends on the setting.
//
// The figures are two decisions of 12 November 2026, pinned by test/unit/difficulty.test.mjs and explained in
// docs/DESIGN.md §5. First the garrison was cut (26 machines on every setting became 9 / 13 / 20) and one fewer
// machine may fire at a time, because the game was too hard to be played. Then, because that left it slightly
// too easy, a little was given back: 10 / 15 / 20 machines, Operator's and Ghost's a tenth quicker to see you and
// a tenth harder hitting, five seconds off Operator's clock, and drones from the bay when the cascades are blown.
// A third, of 16 November 2026, turned none of those numbers and added two: what each charge brings (`wave`,
// pinned by test/unit/wave.test.mjs) and how far off a fallen machine is seen (`bodies`, test/unit/bodies.test.mjs)
// — the owner asked for an alarm and new machines at every charge, and for machines that find their own.
export const DIFFICULTY = {
  recruit: {
    /** which machines are on the site: every guard in world/map.js whose tier is no higher than this */
    tier: 1,
    /** how fast a machine that can see you makes up its mind */
    gain: 0.65,
    damage: 0.6,
    health: 0.85,
    aim: 0.8,
    /** how many machines may be firing at you at the same moment */
    shooters: 1,
    /** how many drones come up from the bay when the cascades are blown */
    responders: 0,
    /** how many drones come after you once the beacon is up */
    pursuers: 2,
    /**
     * What comes for you each time a charge goes on a cascade, with the alarm: guards on foot from the doors of
     * the building, drones from the bay. They are not on the mission's roll (src/enemies/wave.js).
     */
    wave: { guards: 1, drones: 0 },
    /** how far off its machines see a fallen machine, of what Operator's do (src/enemies/bodies.js) */
    bodies: 0.7,
    /** how long you have to reach the pickup once the beacon is up */
    exfilSeconds: 80,
    /** Overwatch marks every machine near you on the small map, and every one that is after you, seen or not */
    radar: true,
  },
  operator: {
    tier: 2,
    gain: 1.1,
    damage: 1.1,
    health: 1,
    aim: 1,
    shooters: 2,
    responders: 2,
    pursuers: 3,
    wave: { guards: 1, drones: 1 },
    bodies: 1,
    exfilSeconds: 60,
    radar: true,
  },
  ghost: {
    tier: 3,
    gain: 1.55,
    damage: 1.6,
    health: 1.1,
    aim: 1.15,
    shooters: 3,
    responders: 3,
    pursuers: 4,
    wave: { guards: 2, drones: 1 },
    bodies: 1.3,
    exfilSeconds: 50,
    radar: false,
  },
};

/** The table for a setting by name; anything unknown plays as Operator. */
export const difficultyOf = (name) => DIFFICULTY[name] || DIFFICULTY.operator;
