# Lodestar — the board

Round eleven. The owner: "add a score board feature and save it to a shared database …". This is that
feature — `src/wild/score.js` (the arithmetic), `src/wild/board.js` (the rules of a row, pure), and
`src/wild/board-live.js` (the title's link, the scoreboard screen, what a mission's ending sends). It joins the
wild build the way every other feature does (`docs/WILD.md` §2–3): through `src/wild/index.js` alone, nothing
else of the game edited to bring it in.

## What the player sees

The title screen gains one line at its foot: **SCOREBOARD**. It opens a screen — heading SCOREBOARD, the
callsign in use and a way to change it, the top 20 (one row a callsign: its best), this player's own row marked
and, if it falls outside the top 20, shown again below the list with its place. A board not yet fetched says
LOADING…; one that has been asked five seconds and has not answered says THE BOARD IS SLOW TO ANSWER — STILL
ASKING, beside whatever rows it gave before ("A capacity over its allowance", below); one that could not be
reached says so and falls back to this device's own scores; a board that is only ever local (see "The address"
below) says SCORES ARE KEPT ON THIS DEVICE; an empty one says so plainly. BACK, or Escape, returns to the title.

When a mission ends (the debrief, or the failed screen), the game's own figures gain a breakdown — what each
thing was worth — and a total, under a line that works out what follows:

- **No callsign saved yet**: a field (`CALLSIGN`, 2–16 characters) and a POST button; nothing is sent until the
  player fills it in and presses POST (or Enter in the field). A bad callsign is refused in place, next to the
  field, with a plain reason. Under the field: a line saying the callsign and the score are shown to everyone.
  Where there is no board to post to (a copy run from a folder, an app that carries the game with it) the
  button says SAVE and the line says the callsign and the score are kept on this device: nothing leaves it.
  At a desk the field is in focus as the screen opens; on a phone it is not, and is typed into when it is
  tapped — a field in focus is what brings a phone's keyboard up, over half the debrief.
- **A callsign already saved**: posted at once. The line reads POSTING… (after five seconds without an answer,
  POSTING… THE BOARD IS SLOW TO ANSWER), then POSTED AS \<NAME\> — #\<place\> OF THE TOP 100 (or — NOT IN THE TOP
  100), or, if the board could not be reached, THE BOARD COULD NOT BE REACHED — KEPT ON THIS DEVICE (the row is
  queued; see below). The place is asked of the board once the row is up: while that is slow in coming the line
  reads POSTED AS \<NAME\> — STILL ASKING ITS PLACE, and if the board does not list, no place is said — where
  the row stands among this device's own scores is not its place on the board.
- A mission **not won** is posted only past this device's own best it has posted under that callsign — a string
  of deaths does not fill the table. A **won** mission always posts. A score of nought never posts.
- One posting a mission, however the screen is repainted, however many times a key is pressed: `board-live.js`
  marks the ending the moment a score is worked out, and never works one out, or sends one, twice for it.

## The scoring (`src/wild/score.js`, `RULES = 1`)

Every number lives in one frozen table, `POINTS`, each explained where it is used. In brief, what a figure is
worth (an operator run, before the difficulty and the win/not-won multipliers below):

- **Charges set** — 220 each (the first half of the job); **cascades blown** — 600 once (the job itself,
  whatever happens after); **clear of the mountain** — 1500 (the one thing that makes a mission `won` rather
  than merely survived, so it is worth more than either half of getting there).
- **Machines shut down**, counted apart by `on.kill` (`unit.rollId < 0` is a reinforcement, `unit.type` says
  sentry or drone): a roll sentry 300, a roll drone 220 (quicker to lose, so worth less), a reinforcement 100
  and **capped at 30 counted** — reinforcements are never going to be missed from the roll, and a later round
  this same night adds many more of them a mission, so farming waves must not be the way to the top.
- **Silent takedowns** — 150 each, on top of the kill itself, for going in quiet rather than loud.
- **Time bonus** — for a mission that was **won**: up to 1200, all of it at nought seconds, none of it from
  half an hour on (`timeMax` × (1 − seconds / `timeLimit`), `timeLimit` 1800). A mission that was not won has
  none, however short it was. (As first written the bonus was paid whatever the result and ran out at fifteen
  minutes — going down at the door was worth six hundred points. Changed at the merge, before any row was
  written: the rules are still version 1.)
- **Accuracy bonus** — up to 900, scaled by hit percentage, but **nothing below ten shots fired** — three shots
  at 100% proves nothing.
- **Alarms** — −220 each. **Retries from a checkpoint** — −150 each (`board-live.js` counts these itself: the
  hub calls a feature's `load(saved)` when a checkpoint is loaded, never when a mission begins fresh, so the
  count survives a retry and a fresh mission starts at nought).
- All of the above **× the difficulty** (recruit 0.7, operator 1, ghost 1.4) **× 0.5 if the mission was not
  won** (reaching the site and doing something is not nothing — but at half).
- The total is an integer, clamped to 0…999999. A flawless ghost run — every charge, the blast, getting out,
  every roll machine down, every takedown, no alarms, no retries, inside the time and the accuracy bonuses —
  lands in the tens of thousands: far short of the clamp, which no honest row can reach.

`score(input)` returns `{ total, lines }`, the exact breakdown shown to the player (each line already carries
the difficulty's and the result's multiplier, and the lines that earned nothing are left out, the game's own
convention for a mission's end). `ceiling(difficulty, result)` is the most those rules could ever pay out for
that difficulty and that result — every line at its best, no alarms, no retries — and is what `board.js` uses to
refuse a row no real mission could have earned. It is reckoned from what the site can give — its four charges,
and the sixteen sentries and four drones Ghost fields (the rules may not read the map, so the figures are
written in `score.js` and the test holds them to the map): 11,738 on Recruit, 16,766 on Operator, 23,470 on
Ghost for a mission won, and under half of that for one that was not. (As first written the bounds were ten
charges and forty of each machine, and the ceiling twice what any mission can score. Tightened at the merge.)
`test/unit/wild-score.test.mjs` (14) checks: a better figure
never scores less and a worse one never scores more, in each of the inputs that can vary; never negative, never
above the ceiling, over a seeded random sweep of input combinations; won beats not-won for the same figures;
ghost beats operator beats recruit for the same figures; reinforcement kills are capped; the lines sum to the
total; the time bonus is for a mission won; and the ceiling is a perfect mission's score, to within the
rounding.

## What is sent, and to where

A row: `name` (the callsign), `score`, `difficulty`, `result`, `seconds`, `kills` (every kill this mission, roll
and reinforcement alike — a simple count, unlike the scoring, which weighs them apart), `alarms`, `device`
(`desk` or `phone`, from `G.touch`), `mode` (always `play` — rows written by the deployment's own checks say
`check`, and those are the one thing this code must never show), `rules` (`score.js`'s `RULES`), `at` (an ISO
timestamp). `createText(row)` builds the inline GraphQL mutation by hand, every string value put through
`JSON.stringify` and every number sent as a plain integer — the callsign's own charset (`A`–`Z`, `0`–`9`, space,
`_`, `-`) means it is never going to need escaping, but it is stringified anyway, on the principle that a safe
value should still be written safely. `POST {endpoint}` with `content-type: application/json`,
`x-publishable-key`, `x-ms-workload-resource-moniker` — the same three headers for a create and for the list
query (`query { scores(first: 100, filter: { mode: { eq: "play" } }, orderBy: { score: DESC }) { … } }`). An
`errors` array in a 200 response is treated as a failure, the same as the network itself being gone.

**The address.** `?board=0` — nothing is ever fetched; everything stays on this device. `?board=<url>` — that
URL is the endpoint, **if it is this machine's own** (`127.0.0.1` or `localhost`): it is what the test suite
uses, a fake server on loopback. Any other address there is ignored and the board is local — otherwise a link
could send a player's callsign and score wherever its writer liked, and show them a board of the writer's
making (closed at the merge). Otherwise: the build's own values
(`VITE_RAYFIN_API_URL`, `VITE_RAYFIN_PUBLISHABLE_KEY`, `VITE_FABRIC_ITEM_ID`, inlined by Vite at build time) are
used **only** when `location.hostname` ends with `.fabricapps.net` **and** all three are non-empty — nowhere
else (not localhost, not a test page without `?board=`), because a local build made in a checkout that has
deployed carries the hosted app's values, and a developer's machine or a test run must never write to the real
board. A checkout that has never deployed has no `.env.local`, so the built-in values are empty there
regardless; the host guard is the second lock, for a build that does have them. The key is never logged, never
put in an error message, the DOM, or `state()`.

## "Shared" — what that means here

One table (`rayfin/data/Score.ts`), anonymous read and create, no update and no delete. Anyone on the internet
can read it, and anyone can add a row to it **by hand**, with any score, any name, any of the few fixed values —
nothing about a POST to a public, keyless-in-effect endpoint can stop that. So every row this code reads back is
treated as hostile, never as a result this code itself produced:

- Rendered with `textContent` only — never `innerHTML` — so a planted `<img src=x onerror=…>` callsign is text
  on the screen, never an element in the page.
- `board.js`'s `parse(json)` drops a row whose fields are missing, of the wrong type or out of range; whose
  `mode` is not exactly `play` (a deployment check's own rows, `mode: "check"`, are never listed — the one rule
  that must never be got wrong); whose `rules` is not `score.js`'s current `RULES` (an old or a future scoring
  table is not comparable to this one, so such a row is left out rather than shown beside ones it cannot be
  weighed against); whose callsign does not come through `callsign()` unchanged (so nothing stored was already
  bent to fit, and nothing that is NOT in the charset after all gets shown); or whose score is above
  `ceiling(difficulty, result)` for its own difficulty and result — no real mission could have earned it, so it
  is not shown, whoever or whatever wrote it in. At most 100 rows are kept from any one answer.
- `best(rows)` keeps one row a callsign — its best; a tie breaks to the earlier `at` — so the same name posted
  many times does not crowd the table.

A row added by hand, inside these rules (a legal callsign, `mode: "play"`, the current `rules`, a score at or
under the ceiling for its difficulty and result), is indistinguishable from an honest one and will be shown: the
table believes any row that is _shaped_ honestly. That is the nature of an anonymous, update-free, delete-free
shared table, and is said so on the board itself, next to the field: the callsign and the score are shown to
everyone.

## The local store and the queue

Two keys, through `ctx.store` (`localStorage`, or nothing kept at all if it is null or throws on write — the
game is never allowed to break over this): `lodestar.callsign.v1`, the callsign once chosen; and
`lodestar.wild.scores.v1`, this device's own best 20 scores, and a queue of at most 5 rows the board has not
managed to take yet. A row leaves the queue once it is accepted, once the server answers with an `errors` array
(refused is not retried: it was never going to be accepted), or after 5 tries — each of them waited for as long
as any answer is (thirty-five seconds: "A capacity over its allowance", below). The queue is retried every time
the scoreboard screen is opened, and after every posting attempt — so a row made while the server (or the
player's own connection) is down is not lost, and goes up on its own the next time either happens, without the
player doing anything about it. One hand tries it at a time: whatever asks while it is being tried waits for the
same going-over, so a waiting row is sent once. And what the store holds is believed no more than what the
table sends: its rows, the waiting ones and the callsign are each checked as a row of the table's is
(`cleanLocal`), so that a store that was written by hand cannot put on the shared board what the field would
have refused.

## What the real service does

Three things no test in the repository could have found, because none had a server that answers as the real one
does; each now has a test.

- **The address.** The build is given the service's root; rows are asked for and added at its `/graphql`. The
  first board asked at the root. There the service answers 405 — with a body that is JSON — and the game took
  any JSON without an `errors` array for a yes: it showed an empty shared board ("NOBODY HAS SET A SCORE YET")
  and POSTED AS …, with nothing written anywhere. Now the address is made in one place (`board.js` `endpointOf`,
  unit-tested), an answer whose status is not a yes is no answer, a row is made only if the answer carries its
  id (`created`), and the board is only a list (`listed`); the stand-in server of the browser suite can answer
  405 with a body, and an empty yes.
- **The numbers' ranges are not held by the service.** The model says a score is 0 to 999999; a score of −1 and
  one of 9,999,999 are both taken (the lengths of the text columns are held: a callsign of one letter is
  refused). Nothing in the game relied on it — every number is checked on the way in, and a score above what
  the rules can give is refused — but the model's comment and the README said the service refused them, and
  were wrong.
- **A row waiting to be sent could be sent twice** (the code review): see the queue, above.

## A capacity over its allowance

- **What it is.** An app whose capacity is over its allowance is throttled. The service then answers every
  question — one about nothing (`{ __typename }`) as much as the list — with a yes, after twenty seconds and a
  little, and a header that says so: `x-ms-mwc-throttling-delay: 20000`.
- **What the game did with it.** It gave up on an answer after six seconds — and a request that is given up on
  is dropped by the service: a row sent and abandoned at six seconds is not in the table afterwards. So for as long as a capacity
  is throttled no game could read the board or add to it; a score waited in the queue, was tried five times at
  six seconds each, and was let go. The board everyone shares was there, and was nobody's.
- **What it does now** (`board.js` `WAIT`, `waiting`; `board-live.js`). An answer is waited thirty-five seconds
  for: the service's twenty, and room over it. One question for the list is out at a time, and a board opened
  again meanwhile waits for that one — a second would be held as long again, and the first one's answer used to
  be thrown away. The board is not asked again within ten seconds of being asked, nor of answering. And while a
  question has been out five seconds the screen says what is so: that the board is slow, not that it is gone —
  beside the rows it gave before, which used to stand there as if they were its answer. Nothing here is on a
  timer of its own: the hub's `frame` asks, once a drawn frame, whether a line would now say something else.
- **What it still cannot do.** If the capacity goes from holding answers to refusing them — the next step of
  the same throttling, whose shape is not guessed at here — the board is the
  device's own again and says so, and a score waits in the queue as before. A score whose answer comes after
  the player has left the ending for the title or a retry is on the board and not in this device's own record
  (as it always was; the wait is longer now).
- **What is not the game's.** How much a capacity can carry: that is set in Fabric. The game can
  wait for a board that is slow; it cannot make it quick.

## The tests

Pure: `test/unit/wild-score.test.mjs` (14), `test/unit/wild-board.test.mjs` (23) — hostile input by design:
`<img onerror>` names, strings where numbers belong, `mode: "check"`, 10,000 rows at once, a non-object, an
`errors` array, a score above the ceiling; and how long the board is waited for, held against the service's own
figure. Browser, against a fake GraphQL server on loopback (`node:http`, never the real Fabric database):
`test/wild/board.test.mjs` (16) — the title's entry and that it opens the board; the
server's rows listed, best a callsign, in score order, with a check row, a wrong-rules row, an above-ceiling row
and a planted name all refused; a mission ending with a stored callsign posting exactly one row matching the
figures shown, with its place; no callsign stored sending nothing until POST (or Enter) is pressed, a bad
callsign refused in place, and M, P, 1, the arrow keys reaching neither the game nor the menus while the field
has the focus (Escape leaves the field, not the screen); the server down, the row queued, the server back,
opened once more, and sent exactly once; `?board=0` and no `board=` at all on loopback both fetching nothing,
checked two ways (the fake server's own request count, and `performance.getEntriesByType('resource')`); an
address in the link that is not this machine's own, not used; at a phone's two shapes, the rows whole;
something that answers and is not the board (a 405 with a body, an empty yes) not taken for it; and a waiting
row sent once when three things ask for the queue at the same moment.

Five more hold the game to a throttled service, four of them in real time and with the game's own
patience (nothing in the address can shorten it, and so nothing in a test can): the stand-in holds every answer
twenty and a half seconds, and does what it was asked only when the hold is over and only for a client that is
still there, as the service does. A board that does so is asked once, says after five seconds that it is
slow, is not asked a second time by being opened again, and lists its rows — and asked again later says so
beside the rows it has. A score is posted to it once, the line saying it is slow, and its place asked for after
and that said too. A score held longer than an answer is waited for is given up on, dropped by the stand-in as
by the service, tried again by the game, and goes up once: neither lost nor doubled (the review of the change
asked for this one — nothing had made the stand-in drop anything). A board that never answers is given up on
after thirty-five seconds and no sooner. And a score that went up to a board that then did not list is given no
place. The first four of these — the fifth is of what was already so — were shown to fail against the build
before the change.

**Known, and left.** A score given up on and then taken at the second try is on the board, and the line on the
ending still says THE BOARD COULD NOT BE REACHED — KEPT ON THIS DEVICE: it speaks of the first try, and is not
told of the second.

**Not tested, and why.** A real phone: the shapes are a desktop browser made 390 × 844 and 844 × 390, not a
glass. The real Fabric database is not called by any test in the repository: whoever hosts a copy can prove it
once it is published, with a row marked `check` that is written and read back — the board never lists one.

**At the merge (the lead, the same night).** The time bonus and the ceiling, as told above. The link's address
held to this machine. The phone test the helper had to cut was written, and failed: held upright the row's
seven columns left the callsign no room at all — under 600 px the setting and the device are now left out, and
the row is who, how much, how it ended and how long it took. The lines of the score are headed SCORE, as the
wild build's own counts are headed FIELD NOTES, so that "Charges set 4 / 4" and "Charges set +440" are not
taken for one table.

## Left alone

`docs/WILD.md` read, in two places written before this round, "the board (section 4, 'The board')" before
section 4 had a subsection by that name; the helper's fence did not let it touch that file. The subsection was
written at the merge.

Nothing else was found wrong in the existing game while building this: `G.stats()`, `G.settings`, `G.record`,
the hub's `reset()`/`save()`/`load()`/`screen()` dispatch, and `menus.js`'s own focus handling all behaved
exactly as `docs/WILD.md` and a reading of the source said they would.
