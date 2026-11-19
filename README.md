# Lodestar

A first-person infiltration game that runs in a browser tab — on a desk or on a phone.

> **About this copy.** This is the game as one commit, published from the private repository it is made in. Its
> documents were written there, and speak of things that are not here: that repository's branches, tags and
> earlier commits, and scratch scripts in a folder (`.work/`) that is never kept. Everything that is here is
> under the MIT licence: see "Licence and credits".

You are **Wraith**, put alone at night into **Site Hollow Nine**: a uranium enrichment facility that is on no map,
cut into the root of a mountain and guarded entirely by machines. Come in under the rock by the drainage adit,
shut down every sentry and drone, hang a charge on each of the four cascades of centrifuges and blow them from
the control room, stand the homing beacon — the _lodestar_ — on the pad under the exhaust shaft, the one place
inside that can see the sky, and get out by the road tunnel to the pickup before the strike it calls in lands on
the mountain.

Nearly everything in it is made in code in this repository: the site, the machines, the guns, most of the
sounds, the menus, most of the surfaces. Ten surfaces — rock, concrete, asphalt and the like — are pictures made
once with an image model and kept here (`art/source`, `src/assets/art`; see "Pictures" below). The wild build's
music (eight pieces, one a scene), its two voices (41 short clips) and six of its sounds (thirteen short
recordings) were made once with a music model, a speech model and a model that makes video, and are kept here
too (`src/wild/music`, `src/wild/voice`, `src/wild/sfx`; made and checked by `tools/sound`, described in
`docs/WILD.md`). It is all fiction; nothing in it describes how a real facility or a real weapon works.

> **This is the wild build** — the game, since 17 November 2026, when its owner said of an experiment made
> beside it: _"i like the go wild example make it the main"_. On top of the classic game it has bent time, an uplink that turns machines and flies drones,
> a way of tearing the cascades apart from the control room, a magnet you can throw, tripwires, a site that
> speaks, music for each scene — and, since the 18th, a site that answers every wire, alarm and finished task
> with machines, machines that fight as a group, a scoreboard kept in the app's database, and machines that are
> plated: a round counts half against one, a head takes three and a body five to seven, and you carry twice the
> rounds. Nothing a player sees calls it an experiment, and there is no switch on the title any more;
> `?wild=0` in the address still gives the classic game (the tag `lodestar-v8`). `docs/WILD.md` is its design.

```
npm install
npm run dev        # http://127.0.0.1:5183
```

## How to play

|                           | Desk                                                 | Phone                                                     |
| ------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| Move                      | W A S D                                              | left thumb — a stick appears where you touch              |
| Look                      | mouse                                                | right thumb — drag anywhere on the right                  |
| Fire                      | left button, or X                                    | FIRE on either side, or double tap and hold where you aim |
| Aim down the sight        | right button: hold, or click to keep it up; or Z     | AIM                                                       |
| Lean left / right         | Q / E                                                | —                                                         |
| Jump                      | Space                                                | JUMP                                                      |
| Reload                    | R                                                    | RELOAD                                                    |
| Change gun                | 1 carbine · 2 sidearm · 3 shotgun, or the wheel      | the button that names the gun in hand: tap for the next   |
| The carbine: AUTO or SEMI | B                                                    | hold that same button                                     |
| EMP grenade               | T                                                    | EMP                                                       |
| Put a lamp out            | shoot its lens                                       | shoot its lens                                            |
| Crouch                    | C or Ctrl                                            | CROUCH                                                    |
| Run                       | Shift                                                | push the stick past its edge                              |
| Knife                     | V — and the trigger, once no gun has a round left    | USE says KNIFE in reach of a machine; FIRE, rounds gone   |
| Use                       | F: hold to set a charge, fire them, raise the beacon | the button that appears when there is something to use    |
| Take a sentry as a shield | G from behind it; then G lets go, F shuts it down    | SHIELD, beside USE; then LET GO or SHUT DOWN              |
| Drag a fallen machine     | G beside it, facing it; G again lets go              | DRAG, where SHIELD is; then LET GO                        |
| Night vision              | N                                                    | NV                                                        |
| Map                       | Tab or M                                             | tap the small map                                         |
| Pause                     | Esc or P                                             | the pause button                                          |

Things worth knowing:

- **The site is inside a mountain.** You start in a drainage adit, in the dark, with a cut grating dead ahead.
  Beyond it is the main cavern — a rock roof a dozen metres up, the facility built into its north side, the drone
  bay behind wire beyond that. The lodestar pad is at the east end, at the foot of the exhaust shaft: look up it
  and there is a square of sky. The road tunnel on the south side is the only way out, and the pickup is in the
  forecourt outside its portal. The screen names each place as you come into it.
- **Blow the cascades.** There are four in the cascade hall, each a double row of centrifuges — and they are
  turning. Hang a charge on the end casing of each (they are at different ends of the hall), then go to the
  control room next door: at its window on the hall there is a ring on the floor. Hold F there and watch. You
  can do it with guards still about — every one of them will come for you — or clear the site first. The beacon
  stays locked until it is done.
- **A charge is felt.** Each one you set trips the site's alarm and brings a wave of machines for it — a guard
  on Recruit; a guard and a drone on Operator; two guards and a drone on Ghost — on foot through the doors of
  the building, and up from the drone bay. Overwatch says which way they are coming from. That alarm is the
  site's own: it is not counted against your grade.
- **Hide what you shut down.** A machine that has a fallen one in sight for a second raises the alarm — and that
  one _is_ counted. How far off it sees a wreck goes by the light the wreck lies in: sixteen metres under a
  lamp, four in the dark (on Operator). So stand beside a wreck, face it and press **G**: you have it by the
  collar, it comes after you, and the line under the crosshair says how far off it would be seen where it is
  now. Take it into the dark, round a corner, into a room nobody walks — or put the lamp over it out — and press
  G again. You walk slowly with it and one hand is full, as with a shield. A machine that goes down while the
  alarm is already sounding is no news to anybody.
- **Darkness hides you.** The LIGHT bar shows how well lit you are; guards notice you sooner in light, close up,
  standing, and moving fast. Crouching behind a crate hides you completely from anything on the far side.
- **And you can make it dark.** Shoot a lamp's lens and it is out for the rest of the mission — the glass is
  heard seven metres off. An **EMP grenade** also drops the breaker of the room it goes off in: every lamp of
  that room is out for twenty seconds (in the open cavern, every lamp within fourteen metres), and then they
  come back by themselves. Put your goggles on (N) and you see in it; the machines do not. The moon cannot be
  put out. A retry from a charge brings back any lamp you shot after it.
- **A drone carries lights.** Its eye, in the colour of what it is thinking, and a white strobe on its back:
  far down the cavern they are what you see of it.
- **On a laptop you can aim and fire.** A trackpad cannot hold one button and press the other, so: _click_ the
  right button (or press Z) and the sight stays up; fire with the left button (or X); click right again to lower
  it. Holding the right button still works the way it always did.
- **Lean round a corner** with Q and E. Your head goes half a metre out and your body stays where it is; a guard
  that can see only your head is slower to be sure and half as likely to hit.
- **Three guns, a grenade and a knife**, and none of it without end. The **carbine** (1) keeps firing — B sets
  it to one round a pull, which is steadier. The **sidearm** (2) is the quiet one, and the one you can fire with
  a machine held on your other arm. The **shotgun** (3) is the loud one: nothing stands up to two shells of it
  at arm's length, and the whole room hears it. The **EMP grenade** (T, two of them) harms nothing and stops
  every machine within seven metres for four seconds — long enough to walk up to a sentry and shut it down from
  the front. The two big numbers at the bottom right are the gun in hand's: what is in it, and every round left
  for it; the line under them is everything else. Across the screen from them, bottom left, is your **health**:
  the number, the word, and a bar — amber at sixty, red under thirty-five. Each of the three caches (armoury,
  loading dock, generator shed) gives a little for every gun, once. When a gun runs dry the next pull of the
  trigger brings out the next one; when they all have, the trigger swings the **knife** — V does at any time:
  two blows put a sentry down from the front, one from behind an unaware one, and that one is silent.
- **A sentry with its back to you** can be shut down by hand (F) — silently — or **taken as a shield** (G). Held
  in front of you it takes every round its own side fires at you from the front, and your rounds pass it; you
  walk slowly, with the sidearm or the carbine in one hand (not the shotgun), and cannot aim, run, jump or lean.
  Shut it down, let it go, or wait: after thirty seconds it breaks free. A head shot does a sentry in one round
  (two on Ghost).
- **You always know which way is which.** The small map has N, E, S and W on its rim, and under it, in words:
  the way you face, the nearest thing to do (`◆ NE 62 m`), and the nearest machines that are after you
  (`↗ E 18 m` — the arrow is where it is from you, the letters where it is on the map). Machines that are after
  you are also red marks on the compass strip and arrowheads on the rim of the small map, and Overwatch calls
  them out by compass point: "Contact — sentry to the east, 20 metres."
- **Jump** (Space, or JUMP on a phone) gets you on top of crates, barrels, barriers and desks, and from a crate up
  onto a tall crate or a container. Landing is heard.
- **The wedges round the crosshair** point at every machine that is noticing you, and fill as it makes up its
  mind. White is curious, amber is coming to look, red is shooting.
- **A guard that has been fighting for four seconds calls the alarm.** Put it down first, or break contact and
  wait: the alarm stands down 45 seconds after the last time anything saw you.
- **Sound.** Settings has three volumes: everything, the music, and _Ambience_ — the wind, the air of the place
  and the cascade, which are a hush of noise and nothing with a note in it. Inside the mountain there is next to
  no wind — a little at the foot of the shaft, all of it out in the forecourt — and where the rock is bare,
  water drips. The **music** is a slow tune in D minor that is always the same eight bars: a few notes of a
  piano while the site is quiet, a heartbeat and a clock when something stirs, drums and strings in a fight.
  Every note of it is struck and dies away; nothing in it is held. Nothing the game tells you, and nothing a
  machine says, is a bleep any more: a hit is a knock, a sentry growls.
- **A reload is something you watch.** The gun comes up and rolls over, your hand leaves it for the magazine,
  goes for a fresh one and seats it — and if the gun had run dry, lets its bolt go. The shotgun takes its shells
  one at a time, each one seen in your hand. It takes as long as it always did.
- On a phone, sliding your thumb off the **left** FIRE button walks and off the **right** one aims, without
  letting go of the trigger. Settings lets you keep FIRE on one side only.

| Setting  | Machines on the site | May fire at once | Each charge brings | Drones that answer the blast | Drones that chase you out | Sees a wreck from | Clock | Radar on the small map |
| -------- | -------------------- | ---------------- | ------------------ | ---------------------------- | ------------------------- | ----------------- | ----- | ---------------------- |
| Recruit  | 10                   | 1                | 1 guard            | 0                            | 2                         | 11 m … 3 m        | 80 s  | yes                    |
| Operator | 15                   | 2                | 1 guard, 1 drone   | 2                            | 3                         | 16 m … 4 m        | 60 s  | yes                    |
| Ghost    | 20                   | 3                | 2 guards, 1 drone  | 3                            | 4                         | 21 m … 5 m        | 50 s  | no                     |

## How it is put together

`docs/DESIGN.md` is the map: the loop of play, every module and what it is for, how the picture is made, the
guard and mission state machines as diagrams, the touch rules, and what each test suite locks.

The short version:

- **The world is a grid** of one-metre cells built by `src/world/map.js`. Sight, bullets, paths and collision are
  all questions asked of that grid (`src/world/grid.js`), so they are fast and easy to test.
- **The mountain is arithmetic** (`src/world/mountain.js`): the rock roof of the cavern, the ground outside, the
  shaft, and where the cameras that look at it from outside may stand. The map is solid rock with the site cut
  out of it; only the forecourt is under the sky.
- **Light is worked out once**, when the level is built (`src/world/build.js`): every corner of every surface adds
  up the lamps that can see it, and remembers which way most of that light came. **What it looks like is worked
  out per pixel** (`src/gfx/materials.js`): bump maps, highlights on steel and paint, bevelled edges that catch
  the light, wet ground that reflects the lamps you can see, haze under every lamp, and lamps that burn brighter
  than white. Then the picture is finished like a photograph (`src/gfx/post.js`): bloom, a grade, a tone curve,
  vignette, grain. No real-time lights or shadow maps anywhere — which is what lets a phone draw it; where a
  device cannot hold bright values, or cannot keep up, the finishing passes are left out and the game draws
  straight to the screen.
- **A round stops on what is drawn.** A crate, a rack or a casing is smaller than the cell it stands in:
  `build.js` keeps the triangles of everything that blocks, and a bullet meets those or flies on through the
  gap. (Sight and movement still go by the cell.)
- **Guards think with a small state machine** (`src/enemies/ai.js`) and the mission is another
  (`src/mission.js`). Both are pure functions with no browser in them; every edge of both graphs has a test.
  What you carry is rules of the same kind (`src/arms.js`).

### Pictures

Ten surfaces are pictures and not paint: `src/assets/art/<name>.<size>.webp`, made from `art/source/<name>.jpg`.

```
node tools/art/generate.mjs --key-file <a file with GEMINI_API_KEY=…> [--only rock,concrete] [--candidates 2]
node tools/art/process.mjs --from art/candidates --preview .work/art/preview
```

The first asks an image model for candidates (into `art/candidates/`, which is not kept); you look at them and
set `pick` in `tools/art/manifest.json`; the second makes each chosen picture tile, grades it to the colour of
the painted surface it replaces, and writes three sizes. The key is read from the file you name and is never
printed or stored. `?art=0` plays the game without the pictures — every one has a painted stand-in.

### The second look

`?look=2` shows a second look, over **the whole site** — behind the switch still: it has not been turned on for
everyone. Every object says what it is made of (seventeen materials; fourteen pictures in `src/assets/matter/`,
wrapped round whatever is made of them); every space has a strong lamp that throws real shadows, twenty-seven of
them, of which the six nearest the eye burn at once; every space is captured for metal to mirror; the picture is
exposed for the place; the floors are painted, stained and dark under what stands on them; the air under a lamp
is lit; and the gun, the hands, the side arms, the machines, the cascade and nearly all the furniture have been
built again (`src/gfx/next/`). Without the switch nothing of it is drawn or fetched. A phone is given a lean
level of it, which has **not been timed on a phone**. `docs/DESIGN.md` ("The second look") says how each part
works, what was cut and what has not been checked.

```
node tools/art/generate.mjs --set matter --key-file <file> [--only steel,polymer] [--candidates 2]
node tools/art/process.mjs  --set matter --from art/candidates --preview .work/art/preview
```

`?bench=1` is a test page for a phone: it times the screen, then loads the game seven times — as it is; the
second look as the device is given it; and that with one thing changed each time — times each, and ends on a
table and one line to copy (`LODESTAR-BENCH 2 | …`). It takes about two minutes, and loses nothing if the
browser loads the page afresh on the way.

### Changing how it looks and sounds

Start the dev server and open one of these. Each shows what one file makes, and reloads as you edit it.

| Page                                      | Shows                                        | Edit                                     |
| ----------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| `/tools/preview/world.html`               | the site without the game; `?top=1` its plan | `src/world/map.js`, `src/world/build.js` |
| `/tools/preview/models.html?show=all`     | sentry, drone, the guns, charge, beacon      | `src/gfx/models.js`, `sidearms.js`       |
| `/tools/preview/props.html?show=all`      | every piece of furniture                     | `src/gfx/propModels.js`                  |
| `/tools/preview/surfaces.html?show=sheet` | every texture; `?show=sky` for the sky       | `src/gfx/textures.js`, `src/gfx/sky.js`  |
| `/tools/preview/audio.html`               | a sound board with every waveform            | `src/audio/`                             |
| `/tools/preview/menus.html?screen=title`  | every menu screen                            | `src/ui/menus.js`, `src/ui/menus.css`    |
| `/tools/preview/materials.html`           | the three shader programs                    | `src/gfx/materials.js`                   |

Useful while working: `?autostart=1` skips the title, `?touch=1` shows the phone controls on a desk,
`?q=low|medium|high` picks the detail level, `?post=0` leaves out the finishing passes, `?art=0` the pictures,
`?noaudio=1` starts without sound. With `?look=2`: `mats=0`, `key=0`, `env=0`, `shapes=0`, `marks=0` and
`shafts=0` leave out the materials, the key lights, the captured places, the rebuilt models, what is on the
floors and the lit air, one at a time.

## Tests

```
npm test             # lint, build, then every suite — the second look's last, by itself
npm run test:unit    # the pure logic only, in a second
npm run test:second  # the second look only (needs a build: npx vite build)
```

| Suite                           | Locks                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `test/unit/map.test.mjs`        | the site can be finished: every objective and every guard can be reached        |
| `test/unit/mountain.test.mjs`   | the site is inside a mountain: rock over all of it but the forecourt            |
| `test/unit/air.test.mjs`        | wind is for the outside; water drips only from bare rock                        |
| `test/unit/grid.test.mjs`       | sight, bullets, paths and collision; a round stops on a thing's own shape       |
| `test/unit/player.test.mjs`     | the jump, what can be climbed, leaning, a machine in your arms                  |
| `test/unit/arms.test.mjs`       | three guns, a grenade and a knife: every number, and what each is for           |
| `test/unit/wording.test.mjs`    | it is a uranium enrichment facility: the word "plant" is nowhere in `src/`      |
| `test/unit/pixels.test.mjs`     | making a picture tile without using any of it twice                             |
| `test/unit/art.test.mjs`        | every picture is in the repository at each of its sizes, and no key is          |
| `test/unit/sight.test.mjs`      | what a guard sees of you: a body, a head leaned out, or nothing                 |
| `test/unit/tone.test.mjs`       | the measures: a hum from a hush, a bleep from a knock, a held note from a tune  |
| `test/unit/reload.test.mjs`     | what a reload looks like, moment by moment, and when each part of it is heard   |
| `test/unit/score.test.mjs`      | the score as written: D minor, eight bars, no note that is held                 |
| `test/unit/spin.test.mjs`       | the casings turn: what is skin, its marks, how the turning runs down            |
| `test/unit/wave.test.mjs`       | what a charge brings on each setting, and by which door it comes in             |
| `test/unit/bodies.test.mjs`     | the fallen: who sees a wreck and from how far; dragging one                     |
| `test/unit/bearing.test.mjs`    | compass points, the way you face, which machines count as after you             |
| `test/unit/difficulty.test.mjs` | how many machines each setting fields, who may fire, the clock, the radar       |
| `test/unit/ai.test.mjs`         | every edge of the guard graph; every state ends by the clock                    |
| `test/unit/mission.test.mjs`    | every edge of the mission graph: four charges, the blast, the beacon            |
| `test/unit/controls.test.mjs`   | the picture-size controller and the settings store                              |
| `test/unit/shade.test.mjs`      | the arithmetic behind the picture, and when the finishing passes are used       |
| `test/smoke.test.mjs`           | the built game, start to both endings, in a real browser, with no errors logged |
| `test/phone.test.mjs`           | the phone layout at seven screen shapes and every touch rule                    |
| `test/hosting.test.mjs`         | what is published and to whom                                                   |
| `test/hud.test.mjs`             | health on the screen: its number, its word, its bar, and what it says when lost |
| `test/unit/matter.test.mjs`     | the second look's arithmetic: materials, edges, how far a key light reaches     |
| `test/unit/png.test.mjs`        | the reader the tests count the pixels of a picture with                         |
| `test/unit/bench.test.mjs`      | the phone test page's set-ups, its rows in the address, and its line            |
| `test/unit/slots.test.mjs`      | the second look's lamps: where they hang, what stops their light, who burns     |
| `test/unit/exposure.test.mjs`   | how the picture is exposed for a place                                          |
| `test/unit/marks.test.mjs`      | what is painted and spilt on the site, and the dark under things                |
| `test/unit/extrude.test.mjs`    | an outline pushed out into a solid, without three's class for it                |
| `test/unit/glsl.test.mjs`       | the look's shader text is in the look's own file                                |
| `test/unit/suites.test.mjs`     | `npm test` runs every test file, the second look's after the rest               |
| `test/second/look.test.mjs`     | the second look in a real browser — and that without `?look=2` there is none    |

The browser suites drive a headless Chromium (set `CHROME_BIN`, or `npx playwright install chromium-headless-shell`).

The wild build's suites are `test/wild/*.test.mjs` and `test/unit/wild-*.test.mjs` (`npm run test:wild` runs the
first; `docs/WILD.md` says what each holds). One thing they cannot say — that Safari's engine, too, decodes and
plays the music and the voices the wild build fetches in the middle of a session — is said by
`tools/webkit-smoke.mjs`, which needs Playwright's WebKit and so is not part of `npm test`:
`PLAYWRIGHT_CORE=<path to a playwright-core package> node tools/webkit-smoke.mjs`.

## Hosting on Microsoft Fabric

The game is a static site and one table. `npm run build` writes `dist/`; Rayfin publishes it as a Fabric App
and keeps the app's database to the model in `rayfin/data/`.

```
npm run fabric:deploy -- --yes     # apply the data model, build and publish
npm run fabric:status              # where it is
```

- `rayfin/rayfin.yml` is the whole configuration: static hosting of `dist/`, and a SQL database with one table,
  `Score` (`rayfin/data/Score.ts`, listed in `rayfin/data/schema.ts`) — the scoreboard (`docs/WILD.md`, "The
  board"). No functions, no storage. `rayfin up` compiles the model itself, which is what
  `rayfin/tsconfig.json` and the dev dependency `@microsoft/rayfin-core` are there for. It also rewrites
  `rayfin.yml` (it manages the list of allowed addresses); commit what it writes.
- **Access is public** (`assetAccess: public`), so the link opens on a phone without a sign-in. To put it behind
  Fabric sign-in, change that one word to `protected`, change the first case of `test/hosting.test.mjs` to match,
  and deploy again.
- **The table is open to whoever has the page**: `@anonymous(['read', 'create'])`. No sign-in; anyone may read
  the rows and add one, and nobody may change or remove one except the app's owner, in Fabric. Every column has
  limits written in the model. Of those the service holds the lengths of the text columns (a callsign of one
  letter is refused) and does **not** hold the ranges of the numbers (a score of −1 and one of 9,999,999 are
  taken) — so the game checks every number itself when it reads a row, and refuses a score above what the rules
  can give. That is what a public scoreboard without accounts is — and it means a row can be added by hand, by
  anyone, with any score.
  `test/hosting.test.mjs` holds the exposure to exactly that: one table, those two rights, nothing else on.
  (Until 18 November 2026 the same case held that there was no backend at all; the owner asked for "a score
  board feature … save[d] to a shared database …".)
- **Each app has its own database.** What is scored on one copy of the game is not on another's.
- **The table answers as fast as the app's capacity lets it.** When the capacity is over its allowance Fabric
  holds every answer of the data service for twenty seconds (the header `x-ms-mwc-throttling-delay: 20000`).
  The game waits thirty-five seconds for an answer and says meanwhile that the board is slow
  (`docs/WILD-board.md`, "A capacity over its allowance"); how much the capacity can carry is set in Fabric, not
  here.
- `rayfin up` writes the address and the public key of the app's data service to `.env.local` (not committed),
  and Vite builds them into the game. So a build made in a checkout that has deployed knows its database — and
  uses it only when it is served from a `fabricapps.net` address; anywhere else the board is the browser's own.
- The app only answers while its Fabric capacity is running. From a fresh clone, name the workspace the first
  time: `npm run fabric:deploy -- --yes --workspace-id <workspace id>`.

## Licence and credits

Everything in this repository — the code, the documents, the pictures and the sounds — is under the
[MIT licence](LICENSE): use it, copy it, change it, sell it, and keep the copyright line and the licence's
words with what you pass on. What it is built on keeps its own licence, and is fetched by npm rather than kept
here: [three.js](https://threejs.org) (MIT) and [Vite](https://vite.dev) (MIT).

The game's code and models were written for this repository, and so was most of its sound. Ten surface
pictures were made for it with Google's Gemini image models from the words in `tools/art/manifest.json`; the
wild build's music was made with Google's Lyria music model, its voices with Google's Gemini speech model, and
six of its sounds (thirteen short recordings: gunfire, blasts, the centrifuges) are the sound tracks of clips
made with a Google model that makes video — all from the words in `tools/sound/manifest.json`. Whether anyone
can own what a model made is not settled everywhere: whatever rights there are in these, if there are any, are
licensed with the rest.
