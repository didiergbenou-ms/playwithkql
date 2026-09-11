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

This map was checked against `develop` at `f2cab1b` on 2026-09-11, following merged PR #11 (the local development guide). Refresh paths and assumptions when the code changes.

## What exists today

- React + TypeScript owns screens and overlays; Phaser 3 owns the platformer; Zustand owns progression and the persisted profile.
- One playable case, Heartbeat Hills, spans four rooms and five terminals. It uses synthetic Azure-support data and an in-browser KQL interpreter, not a live Kusto cluster.
- The current lesson sequence is `take`, `distinct`, `where` with `ago()`, `summarize` with `max()`, then applying known syntax to a second table.
- The README's AI coach, mastery dashboard, and broader mission roadmap are goals, not evidence those features exist.
- No Azure account, credentials, backend, or database is needed to play locally. The optional API is not connected to the game.

## Task-to-file map

| Change | Start here | Also inspect |
|---|---|---|
| Room layout, platforms, pits, spikes, pickups | `src/game/levels/heartbeatHills.ts`: `RoomDef`, `ROOMS`, `parseLevel` | `GameScene.ts` terrain/props, `reach.ts`, level tests |
| A terminal's lesson, query, hints, evidence or gate | `src/data/case001.ts`: `CHALLENGES`, `EVIDENCE` | Map digits, `ChallengeSpec`, `TerminalModal.tsx`, store and `App.tsx` |
| Synthetic logs or table columns | `src/data/case001.ts`: `buildDatabase`, `TABLE_META`, `CASE_NOW` | Every affected reference query, example, hint, completion and evidence assertion |
| Query language behavior | `src/kql/lexer.ts`, `parser.ts`, `evaluator.ts`, `types.ts` | `index.ts`, `challenge.ts`, `complete.ts`, `highlight.ts`, `format.ts` |
| Editor, autocomplete, schema buttons | `src/ui/KqlEditor.tsx`, `TerminalModal.tsx` | KQL helpers, `ModalScrim.tsx`, `App.tsx` keyboard handling, styles |
| Gate opening or objective waypoint | `src/game/bus.ts`, `GameScene.ts` | `App.tsx`, `store.ts`: `solveChallenge`, `currentObjective`, `roomProgress` |
| Movement, collisions, respawn, interaction | `src/game/scenes/GameScene.ts` | `characters.ts`, `physics.ts`, `textures.ts`, map and reachability tests |
| Recruit appearance or stats | `src/game/characters.ts`: `CHARACTERS`, frames, hats | `textures.ts`, `CharacterSelect.tsx`, default character IDs in store and scene |
| Pixel art or props | `src/game/textures.ts`, `propSprites.ts`, `characters.ts` | Scene sprite origins, hitboxes and floor placement |
| Canvas size, camera or parallax | `src/game/config.ts`, `PhaserGame.tsx`, `GameScene.ts` | `src/styles.css` stage sizing |
| Progress, hints, XP, rank, achievements | `src/state/store.ts` | `App.tsx`, `Hud.tsx`, `MainMenu.tsx`, `Celebration.tsx`, `Debrief.tsx` |
| Root-cause choices and final result | `case001.ts`: `ROOT_CAUSES`, `CAUSAL_CHAIN` | `VerdictModal.tsx`, `Debrief.tsx`, map `V`, `submitVerdict` |
| Menu, briefing, notebook, options | Matching component in `src/ui/` | Screen/overlay state in `App.tsx`, `ModalScrim.tsx`, styles |
| Background music and effects | `src/game/music.ts`, `audio.ts` | `App.tsx` room/overlay events, `OptionsModal.tsx`, music tests |
| Developer shortcuts | `src/dev/secret.ts`, `src/ui/DevPanel.tsx` | Store dev actions and scene `ui:teleport` handling |
| Development server or CI | `package.json`, `vite.config.ts`, `.github/workflows/ci.yml` | `scripts/serve.mjs`, `scripts/run.mjs`, local development guide |

In this table, `GameScene.ts` means `src/game/scenes/GameScene.ts`; `store.ts` means `src/state/store.ts`; other game helpers live in `src/game/`.

## Level maps: where and how

Edit the ASCII row strings in `src/game/levels/heartbeatHills.ts`, not generated textures or `dist`.

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

Current dimensions: `TILE = 16`, `ROOM_WIDTH = 46`, `ROWS = 13`. Each room is 736 world pixels wide. `ROOMS` orders Customer Office, Monitoring Forest, Server Caverns, Data Center.

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

**Reachability caveat:** `src/game/reach.ts` is an approximation. `itemsReachable` uses apex height and a horizontal radius rather than a collision-checked trajectory to each item. It can certify an item behind a wall. Also, runtime movement constants are duplicated in `GameScene.ts` and `physics.ts`; do not assume changing the helper changes the game. Compare both when tuning physics. A green reachability test is not a complete playtest.

## Terminal authoring: connect the whole chain

Current wiring:

| Map digit | Challenge ID | Room index | Gate marker / ID |
|---|---|---|---|
| `1` | `t1-look` | 0 | `G` / `gate-office` |
| `2` | `t2-fleet` | 1 | `H` / `gate-forest` |
| `3` | `t3-alive` | 2 | `J` / `gate-caverns` |
| `4` | `t4-lastseen` | 2 | `K` / `gate-datacenter` |
| `5` | `t5-why` | 3 | `L` / `gate-core` |

`parseLevel` accepts **only digits 1-5** and stores `Number(char) - 1`. The scene uses that as an array index into `CHALLENGES`. Adding a sixth array entry or typing `6` into the map does not register a terminal. Reordering `CHALLENGES` changes what the existing map digits mean.

1. Read `src/kql/challenge.ts`: `ChallengeSpec` and `ChallengeConcept` define the contract.
2. In `case001.ts`, author a stable ID, zero-based `room`, `points`, objective `prompt`, optional `flavour`, `starter`, reference `solution`, progressive `hints`, and post-success `teaches`.
3. Supply `concept.title`, `body`, `pattern`, and a working `example.query` with `example.explain`. Keep Level 1 to one new idea at a time.
4. Set `requiredOperators` only for deliberate learning requirements; equivalent valid queries should otherwise pass. Use `ordered` when the lesson actually requires ordered output.
5. Connect `evidenceId` to a real `EVIDENCE` entry. Put observable expected result text in `evidenceTokens`; never claim the query proves something it does not return.
6. Match `unlocksGate` exactly to a `GATE_CHARS` value, place the corresponding gate cells, and position the terminal on the accessible side. Keep `room` consistent with its map location.
7. If adding terminals beyond the current range, update parsing, scene lookup, progression/count assumptions, UI and tests together. Missing challenge entries are currently skipped by the scene rather than auto-created.
8. Check the reference solution, worked example and final hint against `buildDatabase()` with `CASE_NOW`. Check starters are not already the answer, alternative valid answers, missing required operators, wrong results, malformed input, and visible evidence.
9. Exercise open, type, run, hint, close/reopen, success and return-to-world. Results must remain readable after success, and the correct gate and waypoint must update.

Runtime flow:

`map digit -> GameScene interact -> game:terminal -> App overlay -> TerminalModal -> gradeChallenge -> runQuery -> parse/evaluate/collectFeatures -> result comparison -> App onSolved -> store.solveChallenge + ui:openGate -> scene gate/terminal update -> currentObjective -> ui:objective`

`gradeChallenge` compares actual result tables against the reference query plus optional operator constraints. Do not replace this with query-text matching. `evidenceTokens` is an authoring-test contract, not a substitute for checking actual rendered output.

## Adding a room or another case

**A new room:** update `ROOMS` and relevant map markers/challenges, then inspect the duplicated room-name arrays in `App.tsx` and `store.ts`, `roomProgress`, HUD markers, `ROOM_TRACKS`/`trackForRoom`, checkpoints and developer warp controls. Some consumers derive lengths; others clamp or assume four rooms. Verify every consumer instead of copying a room and assuming registration.

**A new case is currently a cross-file feature, not just a JSON file.** The app directly imports `case001` and `heartbeatHills` in several places. First search those imports and define how an active case is selected and passed to:

- Database/schema, deterministic time, challenges, evidence, root causes and causal chain.
- Scene/map loading, gate IDs, room objectives, notes and music.
- `MainMenu`, `Briefing`, `TerminalModal`, `VerdictModal`, `Debrief`, `DevPanel` and the store.
- Run initialization, challenge progress, scoring and any persisted profile migration.

Do not report Case 002 complete until it can be selected, played through, solved and replayed without leaking Case 001 state. Preserve the existing case's behavior.

## Query engine, assistance and state invariants

- Language work may touch `lexer.ts`, `parser.ts`, `evaluator.ts`, `types.ts`, feature collection in `index.ts`, completion in `complete.ts`, highlighting in `highlight.ts`, and reference content in `store.ts`. Inspect how the nearest supported feature is wired; not every new function requires a new token.
- Preserve one pipe per line using `formatKql`, but never change quoted literal contents or comment meaning. Schema source changes use `withSourceTable`, not blind table-name prepending.
- Keep malformed calls, invalid dates, deep unary/binary expressions and missing aggregate arguments on diagnostic paths. Add regression cases for the specific failure, not just successful queries.
- `safeRegex` is currently a native-RegExp heuristic with caps, **not a demonstrated security or execution-time bound**. Do not extend it and claim safety from a few timing examples. For regex-safety work, evaluate a non-backtracking engine or terminable isolation; run adversarial cases only in killable child processes with hard deadlines.
- `hintsRevealed` answers how many progressive hints to display. `hintsSeen` answers whether assistance was used, including `solutionRevealed`. Do not interchange them.
- `hintsUsed` carries paid-hint penalties; `crystalHints` records crystal-funded hints without that score penalty. Crystals are accounted for through `crystalsSpent`. A revealed solution is tracked separately and must not fabricate hints.
- `challengeMultiplier` is shared by `challengeXp` and `scoreRun`. Change scoring there rather than maintaining two formulas. Check displayed rewards, final accuracy, streaks and achievements together.
- Only `profile` is persisted by the store. In-progress `run` state is not restored after reload. Preserve existing save keys or add a migration when changing persisted fields or character IDs.
- Dev shortcuts are for local testing, not authentication. Do not include the unlock phrase or hash in documentation, logs or PR text. Check `devTaint`, `devSolve`, `devGrant`, attempts, achievements and completion whenever adding shortcuts; run-earned profile updates must not escape the dev flag.

## UI, Phaser and audio safeguards

- Keep the retro presentation, readable text and a clear primary action. Secondary schema/help stays collapsible; sample data must not masquerade as a query result; submission must stay discoverable.
- Overlays use `ModalScrim`. Test focus entry, containment, return, visible controls and screen-reader naming; ARIA attributes alone do not prove keyboard accessibility.
- Global keyboard handling must respect `defaultPrevented`. Escape should dismiss completion before closing the terminal. Tab must provide a way out of the editor; currently an open completion popup accepts Tab, so check that case too. Preserve Ctrl+Enter run and Ctrl+Space completion behavior.
- Phaser key capture can prevent spaces and arrows even while its keyboard plugin is disabled. Preserve pause/resume and global-capture handling when opening editors.
- Verify scene/bus cleanup for both shutdown and whole-game destruction. Abandon, re-enter and replay must not leave duplicate listeners or a black screen.
- With camera zoom, parallax uses `camera.worldView.x`, not an assumption that `scrollX` is the visible left edge.
- Pixel sprites have fixed dimensions and collision offsets. Ragged sprite rows or trailing transparent rows under bottom-origin props can cause broken rendering or floating terminals.
- Music lives in `music.ts` (tracks, patterns, room mapping) and `audio.ts` (voices, scheduling, gains). Preserve user volume/on-off settings, modal ducking and focus fade. Keep channels aligned and use original compositions/assets.
- Motion settings can change while playing. Check actual shake, camera zoom and particle behavior, not just the text in Options.
- The optional `server/index.js` binds to loopback and refuses production mode, but remains unauthenticated and trusts client data. Local-only/CORS restrictions are not identity or score validation. Do not expose it or describe its leaderboard as trusted production gameplay.

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
node scripts\run.mjs scripts\fuzzKql.ts
node node_modules\vite\bin\vite.js build
```

The test commands share `.tmp/test.mjs` and delete `.tmp`; running them concurrently races. Read current scripts before assuming isolation. No dependencies or builds are needed for documentation-only changes unless documentation-specific checks exist.

- For code changes, establish the existing baseline, add focused regressions, run affected checks and the full existing suite before handoff.
- `testKql.ts` covers engine/content/game helpers; `testUi.tsx` includes static rendering and state assertions; `fuzzKql.ts` probes robustness and formatting equivalence. Their passing does not prove browser interaction, audio quality or full physical reachability.
- Do not run known catastrophic regex or deliberately remove safety guards in the main process or working tree. Prefer isolated fixtures or child processes with enforced deadlines and reliable cleanup. A timing assertion after a blocking call cannot interrupt it.
- For gameplay changes, test the real route and interaction, not only store mutations or presence of strings in a bundle. State explicitly when browser testing is unavailable.
- Save text as UTF-8. Do not round-trip native `git show` output through an ambiguously decoded PowerShell text pipeline; this previously corrupted arrows and punctuation. Use byte-preserving reads/copies or explicit UTF-8, and inspect the diff.
- Keep generated output, dependencies and local data untracked. Never rewrite another contributor's work, reset their branch, or push directly to shared branches as a shortcut.
- Build-time `BASE_PATH` defaults to `/`. Inspect current hosting/workflows before changing it; a successful build does not mean Azure deployment is configured.
- Finish with the changed behavior, any real limitations, and the branch/PR when applicable. Keep this skill updated when files or wiring change.
