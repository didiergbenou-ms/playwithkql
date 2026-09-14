# KQL Quest: Kingdom of Signals

A browser-based 2D platformer that teaches KQL and Azure troubleshooting.
You play a support-engineer detective. Doors do not open for keys — they open
for **correct queries**.

Prototype status: **Case 001 "Heartbeat Hills" is complete and playable end to end.**

## Case files and map scaffolds

The menu now offers Heartbeat Hills (001), Signal Harbor (002), and Relay Ruins
(003). The latter two have new geometry but deliberately reuse the original
beginner KQL tasks, synthetic dataset and verdict. Their menus, briefings,
terminals and debriefs label this reuse; bespoke incident content is pending.

| Authoring task | File |
|---|---|
| Register/select a case | `src/data/cases/index.ts` |
| Shared case contract | `src/data/cases/types.ts` (`CaseDefinition`) |
| Original content adapter | `src/data/cases/case001.ts` |
| Signal Harbor content | `src/data/cases/case002.ts` |
| Relay Ruins content | `src/data/cases/case003.ts` |
| Temporary lesson-copy factory | `src/data/cases/placeholder.ts` |
| Harbor geometry, room names, notes | `src/game/levels/signalHarbor.ts` |
| Ruins geometry, room names, notes | `src/game/levels/relayRuins.ts` |
| Common parser and original map | `src/game/levels/heartbeatHills.ts` |

`createPlaceholderCase` currently copies the Case 001 lessons and prefixes
their IDs and links. To author a genuinely new investigation, replace that
factory call with a `CaseDefinition` supplying its own database, schema,
challenges, evidence, root causes and debrief; keep the map's terminal order
and gate links consistent. Do not edit the original dataset expecting a
case-specific change: the placeholder factory intentionally reuses it.

`getCase` returns a stable definition; treat it as configuration, not run state.
Databases returned by each case's factory are independent snapshots. The
selected case is passed to Phaser at scene creation and through the UI. Run
state includes `caseId` and a fresh `runId`, which prevents stale scenes on
rapid replay. Score, objectives, notes, dev shortcuts and verdicts use that
case's definition. The existing profile storage key and aggregate profile
fields are unchanged; active runs still do not survive a reload.

`npm run test:cases` checks the registry, content wiring, maps, case switching,
replay and scoring isolation. The existing reachability helper is heuristic;
its passing is not a substitute for traversing the actual Phaser map.

### Contributor authoring tools

Follow the [scoped contributor workflow](LOCAL_DEVELOPMENT.md#contribute-one-scoped-change)
for human or AI-assisted changes. Shared content types live in
`src/data/cases/types.ts`; the old Case 001 type exports remain compatible.

`src/authoring/caseStarter.ts` supplies independent fictional parcel data and
five complete lessons. It is not a fourth playable case. Drafts added to
`src/authoring/catalog.ts` appear in both the dev-only `?author=1` workbench and
`npm run check:content`, without entering the game registry. The starter helper
clones map geometry and assigns new IDs; preserving shipped IDs when replacing
a case is a separate, deliberate authoring step.

The workbench reuses `Briefing`, `TerminalModal` and the pure `VerdictView`;
`VerdictModal` remains the store-bound gameplay wrapper. The preview root never
initializes App, the persisted store or Phaser. It keeps attempts, hints and
verdict feedback in local React state. Production builds exclude the workbench,
its catalog and validator; the URL flag alone cannot enable them.

---

## Quick start

For first-time setup, follow the [local development guide](LOCAL_DEVELOPMENT.md)
to install the tools, clone `develop`, and start the game on your machine.

```bash
npm install
npm run dev            # http://localhost:5173
```

Other commands:

```bash
npm test               # engine, content, level, reachability and music checks
npm run test:ui        # render checks — what the player actually sees on open
npm run test:performance # audio scheduler, syntax-only features, compact maps, load recovery
npm run fuzz           # 268 adversarial probes — nothing may crash, hang or change meaning
npm run typecheck      # tsc --noEmit
npm run build          # production bundle into dist/
npm run serve:dist     # serve the built bundle on :4173 (plain node, no deps)
npm run server         # optional progress/leaderboard API on :3001
```

**Controls**

| Key | Action |
|---|---|
| `A`/`D` or `←`/`→` | Move |
| `Space` / `W` / `↑` | Jump |
| `E` | Use terminal |
| `Tab` | Notebook |
| `K` | KQL reference card |
| `O` | Options (music and SFX volume) |
| `R` | Respawn |

---

## The roster

Four original recruits, each an affectionate nod to an 8-bit archetype rather
than a copy of anyone. They share one body rig and differ by palette swap plus
a headgear overlay — exactly how the era squeezed a cast out of a small
cartridge, and it means a new character is about ten lines in
`src/game/characters.ts`.

| Recruit | Archetype nod | Trade-off |
|---|---|---|
| **Quill** — The Veteran | seen every outage twice | balanced, 3 hearts |
| **Sparky** — The Field Engineer | toolbelt platformer mascot | 4 hearts, slightly slower |
| **Vell** — The Pathfinder | hooded overworld adventurer | jumps ~15% higher |
| **Circuit** — The Specialist | sealed-suit sci-fi explorer | fastest, only 2 hearts |

The choice is cosmetic *and* mechanical, but it never changes the queries — the
KQL is the same for everyone.

---

## What was decided, and why

| Question from the brief | Decision | Reasoning |
|---|---|---|
| Phaser-only or React + Phaser? | **React + Phaser** | React owns menus, HUD, modals and progression; Phaser owns physics and world. They never touch each other's state — they talk over a typed event bus (`src/game/bus.ts`). This is what lets five developers work in parallel. |
| Phaser version | **3.90.0**, not 4.2.x | Phaser 4 is a renderer rewrite with breaking changes and a thinner plugin ecosystem. For a one-month prototype, 3.90 is the safe, well-documented API. |
| Art style | **True 8-bit pixel art**, generated at runtime | 16px tiles, a fixed 16-colour palette, hard edges only. Sprites are authored as string maps (`src/game/textures.ts`) so an artist edits pixels, not drawing code. |
| Resolution | **640x360 canvas, 2x camera zoom** (`src/game/config.ts`) | 320x180 world pixels visible — about 20 x 11 tiles, roughly an NES field of view, so the character reads clearly. Canvas scale and camera zoom are both integers, so pixels stay square. |
| UI style | **NES chrome** | Zero border-radius, chunky bevels via layered inset box-shadows, hard pixel drop shadows, CRT scanline overlay, Press Start 2P. |
| How are KQL answers checked? | **A real mini-interpreter**, not string matching | See below. This is the core of the project. |

### The KQL engine is real

`src/kql/` is a genuine lexer → parser → evaluator that runs queries against
static JSON tables. String-comparing the player's text against an expected
answer would not be a game — it would be a spelling test.

Because it really executes:

- players can explore freely (`| take 5`, `| count`, anything) and see real results
- **any** correct query passes, not just the one the author thought of
- errors are diagnostic, not binary

```
Heartbeat | where Compter == "x"
  -> Unknown column 'Compter'.  Did you mean 'Computer'?

Heartbeat | where count() > 1
  -> 'count()' can only be used inside 'summarize'.
```

Supported: `where` `project` `extend` `take`/`limit` `count` `distinct`
`summarize` `sort by`/`order by` `top`, aggregations `count dcount sum avg min
max arg_max arg_min make_set make_list`, operators `== != < <= > >= =~ !~
contains has startswith endswith in !in matches`, and ~40 scalar functions
including `ago() bin() parse_json() strcat() iff() extract()`.

Grading (`src/kql/challenge.ts`) runs the author's reference solution and the
player's query, then compares result tables — plus an optional
`requiredOperators` gate so a terminal that is teaching `arg_max` cannot be
brute-forced with `sort by ... | take 1`.

### Lightweight performance safeguards

- `App.tsx` lazy-loads `PhaserGame` and preloads it during recruit selection.
  The initial menu does not fetch Phaser. A sized loading panel preserves the
  stage layout; failed imports require Reload because React caches their error.
- Overlays pause input/physics and sleep the Phaser frame loop after a final
  render. Bus handlers still apply solved-terminal and gate changes while asleep.
  Resume resets the frame delta before waking. Cleanup must wake a sleeping
  game so Phaser can process its deferred destruction.
- Terminal operator ticks use `parse` and `collectFeatures`, not query execution.
  They indicate syntax present, not a correct answer. Run still executes and
  grades the real result table; lesson examples and previews are unchanged.
- After the existing modal focus fade completes, audio stops scheduling and
  releases owned music sources. Resume retains the track/step and rebases its
  clock. Music off or volume zero creates no music sources; SFX is independent.
- `CaseMapThumbnail` is memoized and caches horizontally merged SVG rectangles
  by stable level definition. Treat authored level definitions as immutable.

`test:performance` covers audio timing/cancellation, syntax-only features,
thumbnail cell parity/cache reuse and load-error recovery UI. Browser checks
are still needed for delayed downloads, overlays during loading, pause/resume,
gate updates, abandoning before boot or while asleep, and replay.

---

## Case 001 — Heartbeat Hills

**Incident:** five Contoso production machines stopped sending heartbeats at
09:15Z. The machines are up.

**Root cause:** an AMA proxy setting pushed at 09:02Z with a bypass list
covering `*.contoso.local` only — nothing for the Azure Monitor ingestion
endpoints — so TLS fails at the proxy.

The dataset (`src/data/case001.ts`) is generated from three fixed instants, so
every playthrough is identical and every clue is internally consistent. It
contains deliberate red herrings:

- `CONTOSO-WEB-02` runs the **oldest** agent in the fleet and is perfectly healthy
  (kills the "outdated agent" theory)
- the silent machines keep logging errors every 30 minutes
  (kills the "machines are switched off" theory)
- the workspace daily quota is unlimited (kills the "daily cap" theory)

Each wrong theory at the verdict console is rebutted with the specific evidence
that disproves it — that is where the actual teaching happens.

### The five terminals

Level 1 is a pilot on-ramp: **one new idea per terminal**, and nothing advanced.

| # | Room | New idea | Reference solution | What you see |
|---|---|---|---|---|
| 1 | Customer Office | `take` — a query is a table plus steps | `Heartbeat \| take 10` | the raw data |
| 2 | Monitoring Forest | `distinct` | `Heartbeat \| distinct Computer` | 8 machines |
| 3 | Server Caverns | `where` + `ago()` | `Heartbeat \| where TimeGenerated > ago(24h) \| distinct Computer` | only 3 alive |
| 4 | Server Caverns | `summarize … by` + `max()` | `Heartbeat \| summarize max(TimeGenerated) by Computer, Version` | all five stopped at 09:15Z |
| 5 | Data Center | *no new syntax* — a second table | `AmaDiagnostics \| where Level == "Error" \| distinct Message` | one row: the proxy TLS failure |

The last terminal deliberately introduces nothing new. It reuses `where` and
`distinct` against a different table, so the difficulty is the *reasoning*, not
the syntax — and the single row it returns is the answer to the case.

`arg_max`, `parse_json` and `join` are **not** in Level 1. They are in the
reference card under "beyond this case" for the curious, and they are what
Case 002 is for. A test enforces this: Level 1 solutions may not use them, and
no terminal may introduce more than one new idea.

**Every terminal must show its own evidence.** Each challenge declares
`evidenceTokens` — strings that have to appear in the result of its reference
solution — and a test enforces it. This exists because an early version
announced "TLS handshake failed through proxy…" in the evidence panel while the
query returned nothing but a list of machine names: the player was told the
conclusion instead of reading it.

---

## Level design
Levels are **ASCII**, so a designer can reshape the world without reading any
engine code (`src/game/levels/heartbeatHills.ts`):

```
#  solid          =  one-way platform   ^  spikes
P  spawn          @  checkpoint         f  log fragment
c  kusto crystal  E  enemy              n  lore board
1-5 KQL terminal  G H J K L  gates      V  verdict console
```

```
 @      E             f   f           2    H
##############    ############   #############
##############^^^^############^^^#############
```

Four rooms scroll seamlessly: Customer Office → Monitoring Forest → Server
Caverns → Data Center.

### Reachability is verified, not eyeballed

Characters have different jump multipliers, so a level that works as one recruit
can be impossible as another — and the author never notices, because they test
as whoever they picked. Sparky's apex is **47px** against Vell's **66px**, which
is the difference between clearing a three-tile rise and not.

`src/game/reach.ts` runs the real movement numbers (same gravity, jump velocity,
air acceleration and body size as `GameScene`) over the tile grid and answers
"what can this character actually stand on". Walking is a grid move rather than a
simulation — a physics step stops the instant the body is grounded, so
simulating a walk only ever advanced a few pixels — while jumps and falls use the
full simulation, since those are where the multiplier decides the outcome.

It found three genuinely unreachable pickups, including the Data Center's final
platform sitting a **64px climb** off the floor, which **only Vell could reach**.
The fix was structural: stepping platforms so no required climb exceeds 32px.

Two tests guard it, and they are deliberately a pair:

- every collectible, terminal, note and console is reachable **by every character**
- **with margin** — the level must still be clearable at 90% of the weakest
  shipped character

The margin test exists because "technically reachable" is not good enough. Before
the fix the level demanded a 0.97 jump multiplier and Sparky shipped at exactly
0.97, so every climb was frame-perfect. That is why it felt broken rather than
hard, and a pass/fail reachability check alone would have called it fine.

A third test pulls the other way: with gates **closed**, even the best jumper must
reach nothing beyond them. Making the world easier to traverse must not make the
locked doors optional, or the KQL challenge becomes skippable — which is the
whole game.

---

## The terminal

The editor is a transparent `<textarea>` layered over a syntax-highlighted
`<pre>`, plus a context-aware completion popup — about 200 lines, no editor
dependency.

**Completions are context-aware**, which is the part that matters:

| Where the caret is | What you get |
|---|---|
| start of query | table names |
| after `\|` | operators, most-used first |
| after `where` / `project` | columns of *that* table, then functions |
| after `summarize` | aggregations (`arg_max`, `dcount`, …) |
| after `by` | grouping columns |

`Ctrl`+`Space` forces the popup, `Tab`/`Enter` accepts, `↑``↓` navigate,
`Esc` dismisses. Functions insert their opening paren.

Other things the terminal does:

- **Checks panel** — the required operators are shown up front and tick live as
  you type, rather than being revealed only when you get it wrong
- **Schema panel** with column types and per-table descriptions
- **Data preview** — a sample of the source table before you write anything, so
  you can see what you are working with
- **Show solution** escape hatch, and hints with their score cost stated

Note the highlighter is a *separate, tolerant* tokenizer from the real lexer:
the lexer throws on malformed input, and a highlighter runs on every keystroke
over text that is nearly always half-finished.

### Query formatting

House style is one operator per line, matching real Kusto convention:

```
Heartbeat
| where TimeGenerated > ago(24h)
| summarize count() by Computer
```

Typing a `|` after content on a line starts a new line automatically, and every
query the game puts into the editor — starters, worked examples, reference
solutions, hints — is formatted on the way in. There is a **Format** button
(and `Shift`+`Alt`+`F`) to tidy up your own query.

`formatKql` only splits *top-level* pipes: a `|` inside a string literal or a
comment is left alone. The fuzz suite asserts formatting is idempotent and
never changes what a query returns.

---

## Designed for someone who has never written KQL

The prototype assumes no prior knowledge, so each terminal runs
**concept → worked example → practice**, not just "here is a task":

- **Learn tab** opens first on a new terminal. It explains the idea in plain
  English, shows the shape of the query, then shows a worked example **that
  actually executes** with its real output underneath. You can load that example
  straight into the editor and poke at it.
- **Solve it tab** holds the task, the live checks, the schema and the data
  preview.
- Terminals you have already solved skip straight to the task.
- **A correct query leaves the terminal open.** The result table your query
  produced is the whole point — it *is* the evidence — so the celebration is
  anchored to the top of the screen and auto-dismisses back to your result
  rather than closing over it. Alongside it you get *why it works* and *what it
  proves*.

**You always know where you are and what to do:**

- a **room strip** across the top: four rooms, terminals solved in each, a `YOU`
  marker on your current room and an amber ring on the one you are heading for
- a permanent **OBJECTIVE** line — "Find and solve the KQL terminal in
  Monitoring Forest" — plus an overall `2/5` counter
- an in-world **waypoint chevron** above your character pointing toward the
  next terminal, which hides once you are close enough to see it yourself
- a toast on solving that names the room to head for next

**Support that does not punish curiosity:**

- the **KQL field card** (`K`) is free to open, any time — looking up syntax
  should never cost you anything
- **Kusto crystals** you find in the level are spent as **free hints**, so
  exploring the platforming actually funds your learning
- hints only cost score once your crystals run out, and the button says which
  it is about to do
- the debrief replays **the queries you wrote yourself**

---

## The reward moment

Solving a terminal fires a celebration sized to *how well* you solved it. The
design follows published game-feel and learning-motivation research rather than
guesswork:

| Tier | Earned by | What you get |
|---|---|---|
| **SOLVED** | got there with hints or retries | two-note cue, small burst |
| **FIRST TRY** | correct on the first attempt | rising major triad, confetti |
| **CLEAN SOLVE** | first attempt, no hints | full C-E-G-C arpeggio with a bass voice, heavy confetti, biggest stamp |

Three deliberate choices:

- **It is mastery-contingent, not random.** You can see exactly what earns the
  bigger celebration, so it teaches. Variable-ratio "surprise" rewards are the
  slot-machine pattern and are engagement-farming, not learning.
- **The reward is informational.** It names the skill you just demonstrated
  ("Pipelines, and your first operator") rather than shouting generic praise.
  Self-Determination Theory finds competence-conveying feedback supports
  intrinsic motivation, where empty praise erodes it.
- **The streak is light.** It counts up and says so; it never threatens you with
  losing it. Streak-anxiety is a widely criticised dark pattern.

**Sound is synthesised, not sampled** (`src/game/audio.ts`) — square and
triangle oscillators with a 3ms attack and exponential decay, so there are still
no binary assets. Success cues ascend (a cross-cultural signal for "right");
the wrong-answer cue is a soft falling minor third that corrects without
scolding. The AudioContext is unlocked on the first real gesture, per browser
autoplay policy.

### Music

Six original chiptune loops (`src/game/music.ts`), written as tracker-style
patterns and sequenced at runtime. **The in-game track changes with the room**,
so the score doubles as orientation — you can hear that you have crossed into
somewhere new.

| Track | Where | Loop | Mode / feel |
|---|---|---|---|
| **Signal Keep** | menus | 9s | Dorian, shuffled, watchful rather than heroic |
| **Office Hours** | Customer Office | 36s | A minor, light swing |
| **Telemetry Pines** | Monitoring Forest | 29s | C major pentatonic, bright |
| **Cold Aisle** | Server Caverns | 34s | Natural minor, sparse |
| **Core Ingestion** | Data Center | 26s | Driving, flat-VI turn |
| **Case Closed** | debrief | 8s | Major, unambiguously a win |

The first version was repetitive for three structural reasons, and the melodies
were the least of them.

**There were no drums at all.** On the NES the noise channel carries most of a
track's energy, and we had none — which is why it read as a music box rather
than a game soundtrack. There is now a percussion channel with kick, snare and
open/closed hats built from filtered noise. The kick also gets a
pitch-dropping triangle underneath it, which is the trick that gives an 8-bit
kick its thump; noise alone is a click.

**The bass played one rhythm forever** — root-root-root-fifth, in every bar of
every track. There are now five bass styles (root-fifth, octave jump, driving
8ths, arpeggiated, pedal point) and sections switch between them.

**Every lead was a 50% square wave.** The narrow 12.5% and 25% duty pulses are
the recognisable NES lead colours, and having two distinct ones lets the lead
and the arpeggio occupy different space instead of blurring together. Sustained
lead notes also get delayed vibrato, which is how the era added expression
without spending a channel.

On top of that: swing on the two slower tracks, fills on the last bar of every
four-bar phrase, and arrangement dynamics — the Office drums sit out the first
phrase so their entry lifts the second, and the Caverns lead drops out entirely
for two bars so its return lands.

Hooks are built the way catchy chip melodies are built: a short motif, restated
at a different pitch (a sequence), answered by a contrasting phrase, with
pickup notes leading into downbeats.

### On not copying

These are compositions of my own. They are deliberately **not** transcriptions
of, or variations on, any existing game music — copying a melody and altering
it produces a derivative work, and "changed it enough" has no bright line in
law; it is decided case by case, from the perspective of an ordinary listener.

That restriction costs nothing, because the familiarity people actually respond
to does not live in any particular tune. It lives in the shared vocabulary of
the era, none of which is protectable: chord progressions, scales and modes,
rhythms and grooves, song forms, and the pulse/triangle/noise palette itself.
A track feels instantly like an NES track because of a driving triangle bass, a
noise backbeat and a bright pentatonic hook — not because it borrowed one.

Bass lines and arpeggios are **generated from a chord table**, not typed out. A
16-bar channel is 256 tokens, and hand-typing that is how you get a bar with 15
steps in it, which silently drifts that part out of phase with the rest of the
band. Hand-written leads go through a `bar()` helper that pads to exactly 16.
Tests then check that every channel in a track is the same whole number of
bars, that the two halves of a room track differ, that every track has
percussion, and that no noise channel contains a pitched note.

Notes are scheduled with a lookahead loop against the AudioContext clock, so
`setInterval` jitter never accumulates into audible drift. Music sits on its own
gain bus below the effects, and ducks to 35% while a modal is open.

**Options** (`O`, or from the main menu) has independent on/off and volume for
music and effects, and remembers your choice.

**Accessibility is built in, not bolted on:**

- `prefers-reduced-motion` removes screen shake, camera punch and flying
  confetti, cuts particles from ~46 to 6, and swaps the stamp slam for a fade —
  the *information* is never removed, only the motion
- screen flashes stay well inside the WCAG 2.3.1 three-per-second limit
- every celebration is skippable with any key or click
- sound has a HUD toggle and is remembered between sessions

---

## Feel

Movement is tuned rather than naive — this is the difference between a game and
a demo:

- **coyote time** (110 ms): you can still jump just after walking off a ledge
- **jump buffering** (140 ms): pressing jump just before landing still jumps
- **variable jump height**: releasing early cuts the rise
- separate ground/air acceleration, so air control feels deliberate
- stomping enemies, i-frames after damage, screen shake, particle bursts

## Performance

Three things keep the frame budget small:

- **640x360 internal resolution**, upscaled by CSS. A third of the pixels of a
  1080p canvas, and it is what gives the art its chunky look.
- **Merged collision bodies.** Contiguous floor tiles collapse into single wide
  static bodies — 552 bodies became 11 with no change in behaviour.
- **Blitter tile rendering.** Hundreds of ground tiles draw as Bobs in one
  batch instead of hundreds of individual Sprites. Parallax layers are
  viewport-sized and follow the camera rather than spanning the whole level.

---

## Scoring

```
Case completion   500   correct root cause
KQL accuracy      300   per terminal, −20% per hint, −5% per extra attempt (floor 30%)
Clues found       100   log fragments collected
Time bonus        100   full marks under 5 minutes, decaying to 0 at 20
                 ----
                 1000
```

Ranks: Intern Investigator → Support Engineer → Senior Investigator →
Technical Advisor → Principal Detective. Ten achievements. Profile persists to
localStorage.

---

## Layout

```
src/
  kql/         lexer, parser, evaluator, grading   <- engine, zero game deps
  data/        case001.ts: dataset, challenges, evidence, root causes
  game/        bus.ts, textures.ts, PhaserGame.tsx
    scenes/    GameScene.ts   player controller, enemies, gates, pickups
    levels/    heartbeatHills.ts   ASCII maps + parser
  ui/          MainMenu, Briefing, Hud, TerminalModal, Notes, Verdict, Debrief
  state/       store.ts   zustand + persistence + scoring
server/        optional Express progress/leaderboard API
scripts/       test harness + static file server
```

Maps cleanly onto the five-developer split in the brief: the KQL engine, the
Phaser scene, the React shell, the level file and the content file are five
separate surfaces with narrow interfaces between them.

---

## Testing

`npm test` covers engine semantics (`has` is token-based while
`contains` is substring; `sort by` defaults to descending; `bin()` keeps the
source column name; `arg_max(*)` does not duplicate the `by` column), error
quality, and **content validation** — every authored challenge is verified to be
solvable by its own reference solution, its final hint is verified to be a
working query, and its starter query is verified *not* to already be the answer.

That last group matters: it means a content designer cannot ship a broken
terminal.

Twice during development a test was *technically passing but conceptually
wrong*, and both times it hid a real bug:

- The gate-height test only modelled a jump from the **floor**, so it passed
  while three of five gates were still clearable from a platform.
- The challenge tests only checked that each reference solution *ran*, not that
  its output actually showed the evidence the terminal claimed to prove. Two
  terminals were asserting a conclusion the query never projected.

The rule that came out of it: when adding a regression test, first verify it
**fails** against the old broken state. A green test proves nothing until you
have seen it go red.

That rule earned its keep immediately. When checking that the sticky-footer
test worked, the first attempt to re-break the CSS silently did nothing — the
stylesheet has CRLF line endings and the patch string did not match. The test
"passed", which looked like the test was weak, when in fact it had never been
challenged at all. Re-broken properly, it failed exactly as intended.

`npm run test:ui` renders components to static HTML with `react-dom/server`
and asserts **what a player actually sees on open** — no result table before
you run anything, schema and hints collapsed, submit button pinned. A test that
only checked "does it mount" would have passed while the terminal was showing
sample data in the result slot, which is precisely the bug that shipped.

---

## Dev shortcuts

Replaying five terminals to test the debrief gets old fast, so there is a
shortcut panel behind a passphrase. Two ways in:

- type the phrase anywhere in the game, or
- append `?dev=<phrase>` to the URL, which survives reloads

Then `Ctrl`+`Shift`+`D`, or the **DEV** chip in the corner. It offers: solve
next / solve all, warp to any room, open the verdict console, finish the case
straight to the debrief, and top up crystals and health.

**Only the SHA-256 of the phrase ships**, so reading the bundle does not hand it
over — there is a test asserting the plaintext appears in no built asset. Be
clear about what that is worth though: this is obscurity, not security. The game
is entirely client-side, anyone can drive the store from the console, and the
only thing being "protected" is which answers are right. The goal is just that a
player on the public link cannot trip over it by accident.

Anything the panel touches sets `run.devUsed`, which **blocks the run from
writing to your profile** and prints a warning on the debrief. Without that,
testing the end screen would quietly inflate lifetime score and unlock
achievements that were never earned. Tests cover both halves: a dev run must not
reach the profile, and a clean run still must.

---

## Deployment

Branching, as agreed with the team:

| Branch | Purpose |
|---|---|
| `develop-<name>` | individual working branches |
| `develop` | integration → **test** environment |
| `main` | prod-approved only → **prod** environment |

Azure CI/CD is being set up separately to deploy `develop` to test and `main`
to prod, so **this repository intentionally contains no deploy workflow**.
`.github/workflows/ci.yml` only proves the code is sound — typecheck, tests, UI
tests, fuzz, and a production build — on pushes to the shared branches and on
every PR into them. It uploads the build as an artefact so a reviewer can open
the real thing without checking the branch out.

The one non-obvious build detail is `BASE_PATH`. Asset URLs are absolute from
the site root, which is what Azure Static Web Apps serves; if the app is ever
hosted under a sub-path instead, set `BASE_PATH` to that prefix or every asset
request 404s. `vite.config.ts` switches on it, defaulting to `/`.

Two things worth configuring on whichever static host is used:

- **SPA fallback** — serve `index.html` for unknown paths, so a refresh lands
  in the game rather than on a 404.
- Nothing needs a server process. The game is entirely client-side; `server/`
  exists but the client is not wired to it.

> Earlier history note: while this lived in a private repository of its own, the
> build was published to a *separate public repo* by a `scripts/deploy.mjs`
> script, because GitHub Pages on a private repo is a paid feature and the
> published site is access-restricted to people with repo access. That approach
> is not used here — the script was removed in favour of the team's Azure
> pipeline.

---

## Deliberately not built

No real Kusto connection, no Azure integration, no auth, no chatbot. The brief
called for a fun prototype, and every hour went into the game loop instead.

## Next

1. Cases 002–005 — the case format is data, so a new case is a new file plus a new ASCII level.
2. Wire the React client to `server/` for shared leaderboards.
3. Mobile touch controls.
4. Code-split Phaser (1.2 MB / 319 kB gzipped) — fine for a prototype, worth doing before this is used in anger.
