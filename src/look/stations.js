// Where the second look is looked at from: the one view that is built all the way through first.
//
// Out of the drainage adit and into the main cavern — the first thing a player sees. Tests measure the picture
// from here (test/second/look.test.mjs), the phone test page times it from here (look/bench.js), and the pictures the
// owner is shown are taken from here. x and z in metres, yaw and pitch in radians, as `debug.teleport` takes them.
// No three.js and no browser in here.

/** Faces from (x, z) towards (tx, tz): the yaw that `player.yaw` means by it (0 looks north, towards −z). */
export const facing = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));

export const STATIONS = {
  /** where the game starts: in the adit, the grating ahead, the cavern beyond it */
  start: { x: 9.5, z: 67, yaw: -Math.PI / 2, pitch: 0 },
  /** at the adit's mouth: containers, barrels and two lamp posts ahead, the flood on the far wall over them */
  mouth: { x: 17, z: 66.5, yaw: facing(17, 66.5, 36, 61), pitch: 0.02 },
  /** close on the double row of containers, side on to the flood: their shadows run across the picture */
  yard: { x: 29.5, z: 66, yaw: facing(29.5, 66, 36.5, 60.5), pitch: 0.03 },
};
