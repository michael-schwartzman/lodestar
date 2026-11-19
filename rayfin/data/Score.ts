// The scoreboard's one table, as Rayfin wants a table said: a class and its decorators. `rayfin up` reads this
// and makes (or alters) the table in the app's Fabric SQL database; nothing in the game imports it — the game
// asks the database over HTTP (src/wild/board.js).
//
// Decision of 18 November 2026 — the owner: "add a score board feature and save it to a shared database …".
// Anybody may read it and anybody may add a row — the game is played without signing in — and nobody may change
// or remove one from outside (test/hosting.test.mjs holds exactly that). What a row may hold is narrow on
// purpose. Of that the service holds the LENGTHS of the text columns and not the ranges of the numbers (a name
// of one letter is refused; a score of −1 and one of 9,999,999 are taken) — so the ranges below say what a row
// should be, and the game checks every number itself when it reads a row (src/wild/board.js).
import { anonymous, date, entity, int, text, uuid } from '@microsoft/rayfin-core';

@entity()
@anonymous(['read', 'create'])
export class Score {
  @uuid() id!: string;
  /** the callsign the player typed */
  @text({ min: 2, max: 16 }) name!: string;
  @int({ min: 0, max: 999999 }) score!: number;
  /** recruit | operator | ghost */
  @text({ max: 12 }) difficulty!: string;
  /** won | lost | down */
  @text({ max: 8 }) result!: string;
  /** seconds the mission took */
  @int({ min: 0, max: 99999 }) seconds!: number;
  /** machines shut down */
  @int({ min: 0, max: 9999 }) kills!: number;
  /** times the site's alarm went up */
  @int({ min: 0, max: 999 }) alarms!: number;
  /** desk | phone */
  @text({ max: 8 }) device!: string;
  /** play — or check: a row written by a deployment's own checks, which the board never lists */
  @text({ max: 8 }) mode!: string;
  /** which version of the scoring rules reckoned it */
  @int({ min: 1, max: 999 }) rules!: number;
  /** when, by the player's own clock */
  @date() at!: Date;
}
