---
name: kql-quest-dev
description: "Develop KQL Quest: Kingdom of Signals in playwithkql. Use when locating or changing level maps, platforms, collectibles, characters, KQL terminals, challenges, evidence, gates, progression, scoring, menus, audio, or game tests. Includes cross-file authoring workflows and known prototype limitations."
---

# KQL Quest development

Use this skill as a navigation and implementation guide, not as a substitute for reading the current code.
Paths below are relative to the repository root.

## Start here

1. Confirm the repository and branch with `git remote -v`, `git status --short`, and `git branch --show-current`. The shared project is `didiergbenou-ms/playwithkql`; the old `petarivanov-msft/kql-detective` repository is not the current team workspace.
2. Read [the local development guide](../../../docs/LOCAL_DEVELOPMENT.md) for setup, [the README](../../../README.md) for the charter, and [implementation notes](../../../docs/IMPLEMENTATION.md) for historical context. Prefer executable source over stale prose.
3. Work on a personal or feature branch based on current `develop`. Preserve uncommitted work. PRs normally target `develop`; do not merge into `main` or deploy without authorization. The team's intended promotion is `develop` to test, then approved `main` to production; inspect actual workflows before claiming deployment exists.
4. Use the task map below to read the relevant implementation and tests before editing. Search consumers of any identifier, event, or field being changed.

This map includes the contributor toolkit added after the multi-case scaffolds and performance changes. Refresh paths and assumptions when the code changes.

## What exists today

- React + TypeScript owns screens and overlays; Phaser 4.2.1 (pinned) owns the platformer; Zustand owns progression and the persisted profile.
- Three selectable cases each span four rooms and five terminals: Heartbeat Hills (001), Signal Harbor (002), and Relay Ruins (003). The two new maps deliberately reuse Case 001 lessons and synthetic data; their new incident content is still pending.
- The current lesson sequence is `take`, `distinct`, `where` with `ago()`, `summarize` with `max()`, then applying known syntax to a second table.
- The README's AI coach, mastery dashboard, and broader mission roadmap are goals, not evidence those features exist.
- No Azure account, credentials, backend, or database is needed to play locally. The optional API is not connected to the game.

## Task-to-file map

| Change | Start here | Also inspect |
|---|---|---|
| Case registration, selection and shared contract | `src/data/cases/index.ts`, `types.ts` | `MainMenu.tsx`, `App.tsx`, `store.ts`: `selectCase`, `startRun` |
| Independent case starter and content checks | `src/authoring/caseStarter.ts`, `catalog.ts`, `validateCase.ts` | `scripts/checkContent.ts`, `testAuthoring.ts`, case-specific expected results |
| Direct content preview | `src/dev/ContentPreview.tsx`, `contentPreview.css`, `src/main.tsx` | `TerminalModal.tsx`, pure verdict view, `testContentPreview.tsx`; dev URL `?author=1` |
| Room layout, platforms, pits, spikes, pickups | `src/game/levels/heartbeatHills.ts`, `signalHarbor.ts`, `relayRuins.ts` | `parseLevel(caseDef.level)`, `GameScene.ts`, `reach.ts`, case tests |
| A terminal's lesson, query, hints, evidence or gate | `src/data/cases/case001.ts`, `case002.ts`, `case003.ts` | Original `src/data/case001.ts`, `placeholder.ts`, map digits, `ChallengeSpec`, terminal UI |
| Synthetic logs or table columns | `src/data/case001.ts`: `buildDatabase`, `TABLE_META`, `CASE_NOW` | Every affected reference query, example, hint, completion and evidence assertion |
| Query language behavior | `src/kql/lexer.ts`, `parser.ts`, `evaluator.ts`, `types.ts` | `index.ts`, `challenge.ts`, `complete.ts`, `highlight.ts`, `format.ts` |
| Editor, autocomplete, schema buttons | `src/ui/KqlEditor.tsx`, `TerminalModal.tsx` | KQL helpers, `ModalScrim.tsx`, `App.tsx` keyboard handling, styles |
| Gate opening or objective waypoint | `src/game/bus.ts`, `GameScene.ts` | `App.tsx`, `store.ts`: `solveChallenge`, `currentObjective`, `roomProgress` |
| Movement, collisions, respawn, interaction | `src/game/scenes/GameScene.ts` | `characters.ts`, `physics.ts`, `textures.ts`, map and reachability tests |
| Recruit appearance or stats | `src/game/characters.ts`: `CHARACTERS`, frames, hats | `textures.ts`, `CharacterSelect.tsx`, default character IDs in store and scene |
| Pixel art or props | `src/game/textures.ts`, `propSprites.ts`, `characters.ts` | Scene sprite origins, hitboxes and floor placement |
| Canvas size, camera or parallax | `src/game/config.ts`, `PhaserGame.tsx`, `GameScene.ts` | `src/styles.css` stage sizing |
| Startup loading, pause or teardown | `App.tsx`, `PhaserGame.tsx`, `GameScene.ts` | `GameplayLoadError.ts`, `ErrorBoundary.tsx`, lifecycle safeguards below |
| Menu map previews | `src/ui/CaseMapThumbnail.tsx`, `caseMapThumbnailData.ts` | Immutable case level definitions, `MainMenu.tsx`, `testPerfUi.tsx` |
| Progress, hints, XP, rank, achievements | `src/state/store.ts` | `App.tsx`, `Hud.tsx`, `MainMenu.tsx`, `Celebration.tsx`, `Debrief.tsx` |
| Root-cause choices and final result | `case001.ts`: `ROOT_CAUSES`, `CAUSAL_CHAIN` | `VerdictModal.tsx`, `Debrief.tsx`, map `V`, `submitVerdict` |
| Menu, briefing, notebook, options | Matching component in `src/ui/` | Screen/overlay state in `App.tsx`, `ModalScrim.tsx`, styles |
| Pocketed field notes and notebook theory | `src/ui/Notes.tsx`: `Notebook`, `NotebookView` | `App.tsx` `game:note`, `store.readNote`, `run.notesRead`, `testNotes.tsx` |
| Background music and effects | `src/game/music.ts`, `audio.ts` | `App.tsx` room/overlay events, `OptionsModal.tsx`, music tests |
| Developer shortcuts | `src/dev/secret.ts`, `src/ui/DevPanel.tsx` | Store dev actions and scene `ui:teleport` handling |
| Development server or CI | `package.json`, `vite.config.ts`, `.github/workflows/ci.yml` | `scripts/serve.mjs`, `scripts/run.mjs`, local development guide |
| Engine migration or renderer regression | `package.json`, `package-lock.json`, `src/game/PhaserGame.tsx`, `textures.ts` | `scripts/testPhaserBrowser.py`, scene lifecycle, upstream Phaser migration skill |

In this table, `GameScene.ts` means `src/game/scenes/GameScene.ts`; `store.ts` means `src/state/store.ts`; other game helpers live in `src/game/`.

## Contributor scope and AI entry

`.github/copilot-instructions.md` is a thin Copilot entry point, not a second
copy of this guide. For other AI tools, explicitly attach this skill if they
do not discover it. The repository issue forms define case-content, map,
UI/accessibility and audio scopes. Assign one owner and an observable acceptance
criterion; do not have parallel agents edit the same shared files.

For an independent case, use `src/authoring/caseStarter.ts` as a working example.
Its `CASE_STARTER` is authoring-only, not in the normal registry. It has its own
synthetic corpus rather than copying Case 001. Replace the selected case's
placeholder construction deliberately; preserve map/terminal/gate IDs and other
cases. Never mutate the starter or another case as a shortcut.

`createCaseStarter({id, level})` clones an existing map but assigns new identity
links. Preserve the shipped IDs explicitly when replacing a case. Add unregistered
draft definitions to `AUTHORING_CASES` in `src/authoring/catalog.ts`: the preview
and CLI share that catalog, while the normal game registry remains unchanged.

Run `npm run check:content` for registered cases plus the starter. Shared
validation must not assume `Heartbeat`, the old root cause, or that 002/003
will always be placeholders. Keep placeholder behavior covered by explicit
factory fixtures. Add independently authored expected columns/values when
changing a case, not only a reference-query self-comparison.

Use the dev-only `?author=1` workbench for rapid lesson, terminal and verdict
iteration without traversing a map. Preview must keep all progress in local
state, never call persistent store actions, create Phaser or unlock gameplay
shortcuts. Reuse player-facing components; do not build a divergent grading
implementation. Production must exclude the preview entry, starter and validator.
Preserve the same reset, hint and successful-result behavior in both surfaces.
Direct preview is not a substitute for full gameplay and route checks.

## Level maps: where and how

Edit the ASCII rows in the relevant map module: `heartbeatHills.ts`, `signalHarbor.ts`, or `relayRuins.ts` under `src/game/levels/`. Do not edit generated textures or `dist`. The common parser takes a `LevelDefinition` containing `rooms`, `notes`, and `gateChars`; `parseLevel()` without an argument still selects Heartbeat Hills for legacy callers.

| Marker | Meaning |
|---|---|
| `#` | Solid terrain |
| `=` | One-way platform |
| `^` | Spikes |
| `P` | Player spawn |
| `@` | Checkpoint |
| `f` / `c` | Log fragment / Kusto crystal |
| `E` | Enemy |
| `1` through `5` | Terminal, indexed into `CHALLENGES` |
| `G H J K L` | Gate markers resolved through `GATE_CHARS` |
| `n` | Lore board, assigned a `NOTES` entry during parsing |
| `V` | Verdict console |

Current dimensions: `TILE = 16`, `ROOM_WIDTH = 46`, `ROWS = 13`. Each room is 736 world pixels wide. Room ordering comes from the selected case's `level.rooms`; the original `ROOMS` export describes only Heartbeat Hills.

- Coordinates are zero-based. `globalCol = roomIndex * ROOM_WIDTH + localCol`; cell centers are `x = globalCol * TILE + TILE / 2`, `y = row * TILE + TILE / 2`.
- Keep every room at the expected row count and every row within `ROOM_WIDTH`. Short rows are padded. Longer rows warn and the parser reads only the first `ROOM_WIDTH` columns: do not hide objects past that boundary.
- Rendered positions are not always cell centers. One-way platforms are created at `cell.row * TILE + 3`; terminal props use floor-aligned positions and bottom origins. Read the scene before moving an interactable or changing its art.
- `n` assignment follows the parser's row, room, column traversal, not the order a player encounters boards. Excess boards reuse the last note. Add `NOTES` entries deliberately.
- Place exactly one spawn and one verdict console. Repeated `P` or `V` markers overwrite the previously parsed location; they do not create independent spawns or finales.

### Move or add terrain and collectibles

1. Identify the room and local tile coordinates. Preserve gates, intended progression, and safe checkpoint standing space.
2. Edit only the relevant ASCII rows. Parsed collectible totals are derived from the map; do not invent separate counts in the store.
3. Check both vertical rise and horizontal travel, including available run-up, overhead solids and hazards. Preserve distinct character abilities; design a comfortable route for the weakest character.
4. Check access before and after each gate opens. Full-height gates plus the world ceiling prevent bypassing terminals; a platform must not create a new bypass.
5. Run the existing level checks, then exercise the affected route in Phaser with all recruits, especially Sparky and Vell. Confirm both landing on the platform and collecting/using the object.

**Reachability caveat:** `src/game/reach.ts` is an approximation. `itemsReachable` uses apex height and a horizontal radius rather than a collision-checked trajectory to each item. It can certify an item behind a wall. Runtime constants now come from `physics.ts`, but the solver is not a full reproduction of Phaser's drag, collision and input behavior. Test standing and running jumps in the browser; a green reachability test is not a complete playtest.

## Terminal authoring: connect the whole chain

Case 001 wiring (the two placeholder factories prefix these IDs with `case002-` or `case003-`):

| Map digit | Challenge ID | Room index | Gate marker / ID |
|---|---|---|---|
| `1` | `t1-look` | 0 | `G` / `gate-office` |
| `2` | `t2-fleet` | 1 | `H` / `gate-forest` |
| `3` | `t3-alive` | 2 | `J` / `gate-caverns` |
| `4` | `t4-lastseen` | 2 | `K` / `gate-datacenter` |
| `5` | `t5-why` | 3 | `L` / `gate-core` |

`parseLevel` accepts **only digits 1-5** and stores `Number(char) - 1`. The scene uses that as an index into the selected case's `challenges`. Adding a sixth array entry or typing `6` into the map does not register a terminal. Reordering a case's challenges changes what its map digits mean.

1. Read `src/kql/challenge.ts`: `ChallengeSpec` and `ChallengeConcept` define the contract.
2. Author the selected case's challenge definition: stable ID, zero-based `room`, `points`, objective `prompt`, optional `flavour`, `starter`, reference `solution`, progressive `hints`, and post-success `teaches`. For 002/003, the current `createPlaceholderCase` call copies the original lessons; replace it with an independent `CaseDefinition` when writing bespoke content. Do not edit the shared source expecting only one placeholder case to change.
3. Supply `concept.title`, `body`, `pattern`, and a working `example.query` with `example.explain`. Keep Level 1 to one new idea at a time.
4. Set `requiredOperators` only for deliberate learning requirements; equivalent valid queries should otherwise pass. Use `ordered` when the lesson actually requires ordered output.
5. Connect `evidenceId` to that case's `evidence`. Put observable expected result text in `evidenceTokens`; never claim the query proves something it does not return.
6. Match `unlocksGate` exactly to a value in that case's `level.gateChars`, place corresponding gate cells, and position the terminal on the accessible side. Keep `room` consistent with its map location.
7. If adding terminals beyond the current range, update parsing, scene lookup, progression/count assumptions, UI and tests together. A recognized terminal index with no challenge throws a map-content error; it is not auto-created.
8. Check the reference solution, worked example and final hint against `caseDef.database()` with `caseDef.now`. Check starters are not already the answer, alternative valid answers, missing required operators, wrong results, malformed input, and visible evidence.
9. Exercise open, type, run, hint, close/reopen, success and return-to-world. Results must remain readable after success, and the correct gate and waypoint must update.

Runtime flow:

`map digit -> GameScene interact -> game:terminal -> App overlay -> TerminalModal -> gradeChallenge -> runQuery -> parse/evaluate/collectFeatures -> result comparison -> App onSolved -> store.solveChallenge + ui:openGate -> scene gate/terminal update -> currentObjective -> ui:objective`

`gradeChallenge` compares actual result tables against the reference query plus optional operator constraints. Do not replace this with query-text matching. `evidenceTokens` is an authoring-test contract, not a substitute for checking actual rendered output.

Live operator ticks in `TerminalModal.getLiveQueryFeatures` only parse and collect syntax features. Do not execute the database on every keystroke. Actual Run, example execution and previews still use the interpreter.

## Adding a room or another case

**A new room:** update the selected map's rooms, markers and challenge room indices. Also update its `musicTracks` and inspect objectives, HUD, checkpoints, developer warp controls and tests. Placeholder authoring validation currently expects four rooms and the terminal sequence `0,1,2,2,3`; change that deliberately if expanding a scaffold.

**A new case uses the registry in `src/data/cases/index.ts`.** Add a `CaseDefinition` and a map, then register the case. The contract supplies:

- Database/schema, deterministic time, challenges, evidence, root causes and causal chain.
- Scene/map loading, gate IDs, room objectives, notes and music.
- `MainMenu`, `Briefing`, `TerminalModal`, `VerdictModal`, `Debrief`, `DevPanel` and the store.
- Run initialization, challenge progress and scoring. The store records `run.caseId` plus a monotonic `runId`, and changing cases or replaying initializes a fresh run.

`getCase` returns stable configuration; never mutate it as gameplay state. Each case's `database()` returns a separate snapshot. Keep case-local challenge, gate, evidence, root-cause and note IDs distinct. Do not report a case complete until it can be selected, played through, solved and replayed without leaking another case's state. Mark unfinished lesson/narrative content explicitly with `placeholder` and `placeholderNotice`.

## Query engine, assistance and state invariants

- Language work may touch `lexer.ts`, `parser.ts`, `evaluator.ts`, `types.ts`, feature collection in `index.ts`, completion in `complete.ts`, highlighting in `highlight.ts`, and reference content in `store.ts`. Inspect how the nearest supported feature is wired; not every new function requires a new token.
- Preserve one pipe per line using `formatKql`, but never change quoted literal contents or comment meaning. Schema source changes use `withSourceTable`, not blind table-name prepending.
- Keep malformed calls, invalid dates, deep unary/binary expressions and missing aggregate arguments on diagnostic paths. Add regression cases for the specific failure, not just successful queries.
- `safeRegex` is currently a native-RegExp heuristic with caps, **not a demonstrated security or execution-time bound**. Do not extend it and claim safety from a few timing examples. For regex-safety work, evaluate a non-backtracking engine or terminable isolation; run adversarial cases only in killable child processes with hard deadlines.
- `hintsRevealed` answers how many progressive hints to display. `hintsSeen` answers whether assistance was used, including `solutionRevealed`. Do not interchange them.
- `hintsUsed` carries paid-hint penalties; `crystalHints` records crystal-funded hints without that score penalty. Crystals are accounted for through `crystalsSpent`. A revealed solution is tracked separately and must not fabricate hints.
- `challengeMultiplier` is shared by `challengeXp` and `scoreRun`. Change scoring there rather than maintaining two formulas. Check displayed rewards, final accuracy, streaks and achievements together.
- Only `profile` is persisted by the store. In-progress `run` state is not restored after reload. Preserve existing save keys or add a migration when changing persisted fields or character IDs.
- Pocketed field notes come from `run.notesRead` and the active case's `level.notes`, not `run.evidence`. The notebook displays these separately from query evidence, and the HUD Notes counter counts pocketed field notes. Theory steps unlock through each collected evidence item's `chainIndex`, never through the number of notes or evidence items. Test pocket, reopen, reread, respawn and replay.
- Dev shortcuts are for local testing, not authentication. Do not include the unlock phrase or hash in documentation, logs or PR text. Check `devTaint`, `devSolve`, `devGrant`, attempts, achievements and completion whenever adding shortcuts; run-earned profile updates must not escape the dev flag.

## UI, Phaser and audio safeguards

- Keep the retro presentation, readable text and a clear primary action. Secondary schema/help stays collapsible; sample data must not masquerade as a query result; submission must stay discoverable.
- Overlays use `ModalScrim`. Test focus entry, containment, return, visible controls and screen-reader naming; ARIA attributes alone do not prove keyboard accessibility.
- Global keyboard handling must respect `defaultPrevented`. Escape should dismiss completion before closing the terminal. Tab must provide a way out of the editor; currently an open completion popup accepts Tab, so check that case too. Preserve Ctrl+Enter run and Ctrl+Space completion behavior.
- Phaser key capture can prevent spaces and arrows even while its keyboard plugin is disabled. Preserve pause/resume and global-capture handling when opening editors.
- Verify scene/bus cleanup for both shutdown and whole-game destruction. Abandon, re-enter and replay must not leave duplicate listeners or a black screen.
- `App` lazy-loads gameplay, preloading at recruit selection rather than the initial menu. Preserve the sized Suspense fallback and re-send overlay state on `game:ready`. A `GameplayLoadError` requires Reload; resetting the boundary alone cannot clear React's cached rejected import.
- Overlays sleep the Phaser loop after `POST_RENDER`, keeping bus handlers live. Resume removes pending sleep, resets delta, then wakes. `destroy(true)` is deferred until a frame: wake an already-running sleeping game during cleanup, and remove the pending READY scene-start callback when abandoning before boot. Test both paths.
- Menu thumbnails cache merged geometry by level object identity. Treat case/map definitions as immutable; preserve every colored cell when changing the compaction.
- With camera zoom, parallax uses `camera.worldView.x`, not an assumption that `scrollX` is the visible left edge.
- Pixel sprites have fixed dimensions and collision offsets. Ragged sprite rows or trailing transparent rows under bottom-origin props can cause broken rendering or floating terminals.
- Music lives in `music.ts` (tracks, patterns, room mapping) and `audio.ts` (voices, scheduling, gains). Preserve user volume/on-off settings, modal ducking and focus fade. Keep channels aligned and use original compositions/assets.
- After focus fade, stop music scheduling and owned sources, not SFX. Resume preserves track/step but rebases stale audio time; music off/volume zero must not synthesize. Preserve cancellation tokens for rapid focus changes and the stalled-scheduler bound.
- Motion settings can change while playing. Check actual shake, camera zoom and particle behavior, not just the text in Options.
- The optional `server/index.js` binds to loopback and refuses production mode, but remains unauthenticated and trusts client data. Local-only/CORS restrictions are not identity or score validation. Do not expose it or describe its leaderboard as trusted production gameplay.

### Phaser 4 compatibility

- Keep the exact `4.2.1` dependency and matching lockfile unless the task explicitly upgrades the engine. Do not downgrade to match a Phaser 3 example or add a second engine copy. Verify APIs against the installed `node_modules/phaser/types/phaser.d.ts` and source; upstream `master` may describe a newer release.
- Read the [upstream migration skill](https://github.com/phaserjs/phaser/blob/master/skills/v3-to-v4-migration/SKILL.md) before renderer work. Phaser 4 uses render nodes and filters, not v3 custom pipelines/preFX/postFX. Do not introduce `BitmapMask`, `setTintFill`, `Geom.Point`, `Phaser.Struct.Set/Map`, Mesh/Plane or `TextureManager.generate` from old examples.
- The game's own `generateTextures` helper uses compatible `createCanvas`/`refresh` APIs. Preserve these procedural assets and the existing Arcade physics; migration did not require a runtime rewrite. Adding DynamicTexture/RenderTexture drawing is different: v4 buffers those commands until `render()`.
- Preserve `Phaser.AUTO`, explicit `pixelArt`/`roundPixels`, the 640x360 canvas, 2x camera and deferred engine loading. Canvas is a deprecated fallback, so any new WebGL-only feature needs an explicit fallback decision. Do not blanket-force `vertexRoundMode` on scaled objects.
- Native TileSprite sampling can differ from v3's power-of-two-resampled edges. Preserve source pixels, repeat dimensions and scrolling rather than reproducing the old blur. Canvas's rounded sprite quads retain a half-pixel expansion; do not offset game geometry to compensate for a renderer-specific test expectation.
- For engine, texture, camera or lifecycle changes, run the production browser suite in both WebGL and Canvas after the normal checks. Also exercise cold/delayed loading, an overlay during loading, early abandonment and sleeping teardown. Never replace these checks with store-only tests or skip the renderer check to obtain a green build.

## Development and verification

Use the Node version and installation steps in `docs/LOCAL_DEVELOPMENT.md` and current CI. For ordinary terminals: `npm ci`, then `npm run dev`; use the printed URL (normally port 5173). The built preview on port 4173 serves `dist` and needs a rebuild after changes.

For PowerShell agent sessions on Petar's machine, invoke existing tools with Node directly to avoid npm/npx wrapper-related permission prompts:

```powershell
node node_modules\vite\bin\vite.js
```

Run the following checks from the repository root, **sequentially**, stopping and investigating on failure:

```powershell
node node_modules\typescript\bin\tsc --noEmit
node scripts\run.mjs scripts\testKql.ts
node scripts\run.mjs scripts\testUi.tsx
node scripts\run.mjs scripts\testNotes.tsx
node scripts\run.mjs scripts\testCaseContent.ts
node scripts\run.mjs scripts\testCases.ts
node scripts\run.mjs scripts\checkContent.ts
node scripts\run.mjs scripts\testAuthoring.ts
node scripts\run.mjs scripts\testContentPreview.tsx
node scripts\run.mjs scripts\testAudioScheduling.ts
node scripts\run.mjs scripts\testPerfUi.tsx
node scripts\run.mjs scripts\fuzzKql.ts
node node_modules\vite\bin\vite.js build
```

The test commands share `.tmp/test.mjs` and delete `.tmp`; running them concurrently races. Read current scripts before assuming isolation. No dependencies or builds are needed for documentation-only changes unless documentation-specific checks exist.

- For code changes, establish the existing baseline, add focused regressions, run affected checks and the full existing suite before handoff.
- `testKql.ts` covers original engine/content/game helpers; `testUi.tsx` includes rendering/state assertions; `testCaseContent.ts` covers registry/maps/lessons; `testCases.ts` covers cross-case state, scoring and replay; `fuzzKql.ts` probes robustness and formatting equivalence. Their passing does not prove browser interaction, audio quality or full physical reachability.
- `testAudioScheduling.ts` uses a monotonic fake clock with coalesced overdue timers for fade cancellation, silent scheduling, SFX isolation and long stalls. `testPerfUi.tsx` checks syntax-only features, independent thumbnail cell parity/cache reuse and failed-import recovery. These run sequentially via `test:performance` and CI.
- `checkContent.ts` reports authoring errors for the registered cases and independent starter. `testAuthoring.ts` exercises valid and deliberately broken content; `testContentPreview.tsx` covers preview helpers/rendering. Also verify browser case/terminal switching, query/hint/reset/verdict actions, unchanged persisted profile, and exclusion from a production build.
- `testPhaserBrowser.py` uses Playwright against a running production preview and runs in CI for both WebGL and `--canvas` fallback. It checks real queries/gates/notes, effects, pause/teardown/replay, all recruits and source-pixel orientation at 1x/2x; see the local guide for Python/browser setup. It positions players at interactables, so still traverse affected routes manually for physics or map changes.
- Do not run known catastrophic regex or deliberately remove safety guards in the main process or working tree. Prefer isolated fixtures or child processes with enforced deadlines and reliable cleanup. A timing assertion after a blocking call cannot interrupt it.
- For gameplay changes, test the real route and interaction, not only store mutations or presence of strings in a bundle. State explicitly when browser testing is unavailable.
- Save text as UTF-8. Do not round-trip native `git show` output through an ambiguously decoded PowerShell text pipeline; this previously corrupted arrows and punctuation. Use byte-preserving reads/copies or explicit UTF-8, and inspect the diff.
- Keep generated output, dependencies and local data untracked. Never rewrite another contributor's work, reset their branch, or push directly to shared branches as a shortcut.
- Build-time `BASE_PATH` defaults to `/`. Inspect current hosting/workflows before changing it; a successful build does not mean Azure deployment is configured.
- Finish with the changed behavior, any real limitations, and the branch/PR when applicable. Keep this skill updated when files or wiring change.
