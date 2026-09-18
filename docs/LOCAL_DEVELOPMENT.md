# Run KQL Quest on your machine

This guide runs the playable game from **`develop`**, the shared development
branch (not `main`). The steps work on Windows, macOS, and Linux.

**No Azure subscription, Kusto cluster, API keys, `.env` file, database, or
backend server is needed.** The game runs in your browser using synthetic data
and saves progress in that browser.

## 1. Install the tools

- Install [Git](https://git-scm.com/downloads).
- Install [Node.js](https://nodejs.org/en/download) **22.x LTS, version 22.12.0
  or newer**, including npm. This matches the Node major version used in CI.
  Node.js 24 LTS is also supported.
- Have a current browser such as Edge, Chrome, Firefox, or Safari.

Open a new terminal after installing: **PowerShell** on Windows or **Terminal**
on macOS/Linux. Run these commands one at a time:

```sh
git --version
node --version
npm --version
```

Each command should print a version. If a command is not found, finish its
installation and reopen the terminal before continuing.

> Windows: if PowerShell says `npm.ps1` cannot run because scripts are disabled,
> use `npm.cmd` instead of `npm` in every command below, for example
> `npm.cmd ci`. You do not need to change your execution policy.

## 2. Clone the development branch

In your terminal, go to the folder where you keep your projects, then run:

```sh
git clone --branch develop https://github.com/didiergbenou-ms/playwithkql.git
cd playwithkql
git branch --show-current
```

The last command should print **`develop`**. If GitHub asks you to sign in, use
an account with access to the repository.

**Run all remaining commands inside this `playwithkql` folder**, where
`package.json` lives.

## 3. Install the project dependencies

```sh
npm ci
```

Wait for the command to finish successfully. It installs the exact dependency
versions in `package-lock.json`; you do not need to install Vite or React
separately. Internet access is required for the downloads.

## 4. Start the game

```sh
npm run dev
```

Leave this terminal running. Open **http://localhost:5173** in your browser.
If that port is already in use, Vite selects another one: open the **Local**
URL printed in the terminal instead.

You should see the **KQL Quest** menu. Click **Open case file** and follow the
on-screen prompts: choose difficulty, then recruit, then begin the investigation.
Use **A/D** to move, **Space** to jump, and **E** to interact.

On touch devices, use the on-screen direction, Jump and Interact buttons.
Movement and jumping work together with separate fingers. Both portrait and
landscape are supported. Tap **Menu** to pause and find notes, KQL reference,
options, **Return to checkpoint** and Abandon. Selection screens keep the main
choices and Continue action visible; expand details when you want more context.

If a hybrid device selects an unsuitable layout, open **Options > Controls and
layout** and choose **Keyboard & mouse** or **Touch**. **Auto** uses the primary
pointer rather than the mere presence of a touchscreen. The override applies
for this visit and keeps the current investigation running.

Do not open `index.html` directly from your file manager; use the local URL.

For mobile emulation, enable touch in the browser's device toolbar before
loading the game. After building and starting the existing production preview,
run `python scripts/testMobileBrowser.py` with the same Playwright setup as the
other browser suites. `npm run test:mobile` runs the deterministic input checks.
`python scripts/testCompactBrowser.py` checks phone screen density and safe-area
layouts; add `--screenshots <directory>` to save each menu and gameplay view.
The single mobile camera adapts to orientation: portrait shows 18 tiles across
and landscape uses the full safe width. No duplicate Route View is shown.
Switching terminal panes resets the reading position without losing the query.
For focused local verification after a camera/terminal change, run
`python scripts/testWorldAndTerminalBrowser.py` against the production preview
(and again with `--canvas` for the fallback renderer).
GitHub Actions runs `python scripts/runBrowserChecks.py` against its own preview
and uploads a **browser-reports** artifact containing logs and phone screenshots,
including failed runs. This does not require launching a browser through Scout.
Emulation covers multi-touch and viewport changes, but a physical handset is
still needed to assess its native keyboard and browser chrome.

## 5. Make changes and restart when needed

Open the `playwithkql` folder in your editor, edit files under `src`, and save.
The development server normally updates the browser automatically; refresh
the page if needed. No production build is required while developing.

Before committing code, use your own `develop-<name>` working branch rather
than the shared `develop` branch. For example, to create a new personal branch:

```sh
git switch -c develop-yourname
```

Replace `yourname` with your name. If that branch already exists locally, use
`git switch develop-yourname` without `-c`.

To **stop** the server, press **Ctrl+C** in its terminal.
To **start again later**, open a terminal in the same project folder and run:

```sh
npm run dev
```

You do not need to clone or reinstall dependencies every time.

## Get the latest shared development version

Stop the server first. Commit any local work on your personal branch before
switching; do not discard changes just to update. With a clean working tree,
run these commands one at a time, stopping if any command fails:

```sh
git switch develop
git pull --ff-only origin develop
npm ci
npm run dev
```

This also works if you already cloned the repository on `main`. It updates
your local `develop` branch, not your personal working branch.

## Contribute one scoped change

Start from an up-to-date `develop` and create your own branch as described above.
Do not commit directly to `develop`. Open the matching repository issue form
(case content, map, UI/accessibility or audio) and agree on an owner, file boundary
and observable result before implementation. One case or subsystem per PR keeps
reviews and parallel work manageable.

| Contribution | Start here | Keep separate unless explicitly in scope |
|---|---|---|
| Case story, logs, KQL tasks and hints | `src/data/cases/` and `src/authoring/caseStarter.ts` | Map geometry, shared grading and player progression |
| Platforms, props and routes | The selected file under `src/game/levels/` | Lesson content and character physics |
| UI or accessibility | The relevant component under `src/ui/` | Data, scoring and unrelated screens |
| Tracks and sound effects | `src/game/music.ts`, `src/game/audio.ts` | Gameplay and unrelated compositions |

### Working with an AI assistant

Copilot has a short entry point in `.github/copilot-instructions.md`. The detailed
guide remains `.github/skills/kql-quest-dev/SKILL.md`; other tools may require you
to attach that file explicitly. Give the assistant the issue's file scope and
acceptance criteria, not just "improve the game".

For example:

> Read `.github/skills/kql-quest-dev/SKILL.md`. Author an independent investigation
> for Signal Harbor using synthetic data. Preserve its map, terminal/gate IDs,
> shared grading and other cases. Update the dataset, lesson examples, progressive
> hints, evidence, verdict and debrief consistently. Add explicit expected-result
> assertions; do not remove shared checks to make the content pass.

Do not assign multiple assistants the same files simultaneously. Content
authors can work on different case modules while a level designer edits one
map; changes to shared types, the interpreter, store or scene need coordination.

### Independent case content

`src/authoring/caseStarter.ts` is an executable, synthetic example with its own
data and complete lessons. It is not a fourth playable case and does not add an
item to the normal game menu. Use it as a copy-and-edit reference, not a shared
global object to mutate.

Its `createCaseStarter({ id, level })` helper can put the sample content on a
cloned existing map for experiments. The helper creates new lesson, gate,
evidence and note IDs; it is not a drop-in preservation of an existing case's
IDs. When replacing shipped content, keep that case's established links in the
final definition rather than blindly assigning the helper's result.

For an unregistered draft, copy the example to a separate module under
`src/authoring/`, give it a unique ID, and add its exported definition to
`AUTHORING_CASES` in `src/authoring/catalog.ts`. That one catalog drives both the
workbench and `check:content`; it does not change the normal game menu. Keep
each draft's expected-result assertions with its own tests. Register a finished
new case in `src/data/cases/index.ts` only when it is intended to be playable.

Playable cases use `createCurriculumCase` and their nine authored question sets.
To change a terminal, edit the selected case/difficulty file. To change a case's
investigation, coordinate its narrative, datasets and all three difficulty sets.
Keep its map and identity links. `createPlaceholderCase` and the original
`src/data/case001.ts` remain for legacy fixtures, not current playable questions.

Author the complete evidence chain together: synthetic rows and schema,
terminal objective, worked example, reference answer, progressive hints,
evidence, wrong-theory rebuttals and debrief. Use a fixed case clock and return
a fresh database snapshot per call. The local interpreter supports a subset of
KQL; a query valid in real Kusto is not automatically supported here.

Write explicit expected columns and representative values alongside the case's
tests. A reference query passing against itself does not prove its story is
correct. Keep placeholder-only expectations on placeholder fixtures, not on
every future version of Cases 002/003.

```sh
npm run check:content
npm run test:authoring
npm run test:cases
```

Run those commands sequentially. `check:content` validates the registered cases
and the starter, reporting case/terminal-specific authoring errors. Authoring
regressions exercise invalid content as well as working examples. General
validation is not proof of narrative quality or physically reachable routes.

### Preview without traversing a map

With `npm run dev` running, append **`?author=1`** to its printed Local URL,
for example **http://localhost:5173/?author=1**.

Direct links can omit the terminal ID to select the case's first terminal:
`?author=1&case=starter&view=terminal` or `?author=1&case=002&view=verdict`.
The controls update the address bar; Back/Forward and reload retain the selected
case/surface but reset local preview attempts.

For a particular difficulty, use
`?author=1&case=001&difficulty=expert&view=terminal`. The workbench defaults to
Beginner; its difficulty selector exposes the registered case's three sets.
Independent authoring drafts without difficulty variants keep their single set.

The **content workbench** lets you select a case (including the independent
starter), open a lesson/terminal directly, execute its queries and try its
verdict. It reuses player-facing components but keeps preview interactions
separate from game progress and achievements. Use the workbench's reset action
to repeat a clean attempt after checking hints or a successful query.

Save source edits and refresh the workbench when you need a clean view of new
content. Use **Open game**, or remove `?author=1`, for actual gameplay. The workbench
is available only in the Vite development server; a production build ignores
this switch and opens the normal game.

Before handing off, also play the affected case in the game. Direct terminal
preview cannot prove that a platform is reachable, a gate blocks the intended
route, or the final verdict is accessible.

### Filling the 45 question slots

Each file exports one `QUESTION_SET` with five numbered `slots`:

The current files use `authoredSet` to define five complete lesson drafts.
Edit the draft's `prompt`, `solution`, two progressive hints, example, evidence
and source information; the helper produces the third complete-query hint and
stable slots. Ready means executable: provisional adaptations remain labelled
in `contentNote` until editorial review.

| Case | Beginner | Intermediate | Expert |
|---|---|---|---|
| 001 | `src/data/questions/case001/beginner.ts` | `src/data/questions/case001/intermediate.ts` | `src/data/questions/case001/expert.ts` |
| 002 | `src/data/questions/case002/beginner.ts` | `src/data/questions/case002/intermediate.ts` | `src/data/questions/case002/expert.ts` |
| 003 | `src/data/questions/case003/beginner.ts` | `src/data/questions/case003/intermediate.ts` | `src/data/questions/case003/expert.ts` |

Slot identity is **case:difficulty:terminal**, for example `001:expert:3`.
For each incoming question, supply its objective, correct KQL answer, supporting
table/schema, and intended evidence. Replace the slot's `lesson.prompt` and
`lesson.solution`, then update `starter`, `hints`, `teaches`, `concept` (lesson,
pattern, worked example), `requiredOperators`, `evidenceTokens`, and its
`evidence` text as appropriate. The files initially reference independently
cloned seeds only to keep all slots playable; do not edit the shared seed to
customize one set.

Keep `slot`, set `id`, `caseId` and `difficulty` stable. Map positions, gate links,
evidence IDs and points are derived from the base case rather than entered again.
If new questions need different rows, supply `dataset` with **database factory,
tableMeta and fixed now together**; keep that case's root cause and map unchanged.

Mark a finished slot `source: 'authored'`. Only after all five slots have their
final content, set `questionSetStatus: 'ready'` and `questionSetNotice: null`.
Until then the UI must disclose the reused/pending questions. Run
`npm run check:content`, `npm run test:difficulties` and the workbench preview for
that tier. Add independent expected-result assertions for the final questions;
reference queries comparing against themselves are not proof of content quality.

The March adaptation has revision `march-2026-v1`. Completion records are keyed
by case, difficulty and revision, so old placeholder scores remain history rather
than automatically completing the replacement lessons. Retain the revision for
copy corrections; use a new one when materially replacing the exercises.

### Handoff

Open a PR targeting `develop`. State the changed case/subsystem, how the
acceptance criteria were exercised, and any assumptions intentionally changed.
Attach before/after visuals for map/UI changes. For content, include the lesson
sequence and independently asserted query results. CI complements, rather than
replaces, a browser playthrough.

## Developer checks

Run these from the project folder in a second terminal, or after stopping the
development server:

```sh
npm run typecheck
npm test
npm run test:ui
npm run test:cases
npm run check:content
npm run test:authoring
npm run test:performance
npm run test:reliability
npm run test:difficulties
npm run test:curriculum
npm run fuzz
npm run build
```

To view the production build locally after `npm run build`:

```sh
npm run serve:dist
```

Open **http://127.0.0.1:4173**. This serves the built files without live updates;
use `npm run dev` for everyday development. Stop either server with **Ctrl+C**.

Run checks **sequentially**: the TypeScript test scripts share `.tmp/test.mjs`.
Do not launch multiple suites at the same time.

For data changes, run `npm run seed:curriculum` before the tests. It regenerates
the three supplied datasets plus the small synthetic enrichment dataset. Commit
the generator and generated JSON together; CI checks for drift. The original
August prototype corpus remains under `src/data/case001.ts` for regression
fixtures, not as the source of current playable lessons.

### Engine and renderer checks

Phaser is pinned to **4.2.1**. Updating the engine needs real browser checks;
TypeScript/unit tests alone cannot detect missing textures, camera changes or
sleeping-game teardown failures.

With the production preview running at port 4173, use Python 3.12+ and Playwright:

```sh
python -m pip install playwright==1.62.0
python -m playwright install chromium
python scripts/testPhaserBrowser.py
python scripts/testPhaserBrowser.py --canvas
python scripts/testKqlBrowser.py
python scripts/testDifficultiesBrowser.py
```

The first two commands are one-time browser-test setup, not requirements to play
or build the game. If Edge is already installed, pass `--channel msedge` to the
test instead of downloading Chromium. For another preview port, pass
`--url http://127.0.0.1:4174/`. `--pixels-only` runs just the deterministic
texture-orientation/rendering fixtures.

These tests use temporary browser profiles, synthetic data and only the local
preview. They open gates by solving terminal queries; positioning at interactables
isolates the UI/engine wiring rather than proving the full platform route.
CI runs both WebGL and Canvas checks against its production build.

## Common setup problems

| Problem | What to do |
|---|---|
| Clone fails with "Repository not found" or an authentication error | Check the repository URL and sign in with a GitHub account that has access. Ask a repository maintainer for access if needed. |
| npm cannot find `package.json` | Run the command inside `playwithkql` and check that `git branch --show-current` prints `develop` or your development working branch. |
| `EBADENGINE` or an error about an unsupported Node version | Check `node --version` and install a supported version from step 1, then reopen the terminal and run `npm ci` again. |
| Dependency downloads fail | Check internet/proxy access. The current lockfile downloads packages from Microsoft's public npm mirror at `*.pkgs.visualstudio.com`; that host must be reachable. Do not disable TLS checks or delete the lockfile to work around a network error. |
| `vite` is not found | Run `npm ci` successfully in the project folder, then retry `npm run dev`. |
| The browser cannot connect | Keep `npm run dev` running and use the exact Local URL it prints. |
| `?author=1` shows the normal menu on a development server | Some AI desktop shells inherit `NODE_ENV=production`. Stop that server and set `NODE_ENV=development` for the new server process. In PowerShell: `$env:NODE_ENV='development'; node node_modules\vite\bin\vite.js`. Do not change the preview's production guard. Use a fresh/default shell for a subsequent production build. |
| Port 4173 is already in use for the production preview | Stop the server you previously started on that port, or use `npm run preview -- --port 4174` after building and open the URL it prints. |

For architecture, all game controls, and implementation details, see
[IMPLEMENTATION.md](IMPLEMENTATION.md). Its optional `npm run server` command
starts a separate local-only API; the game is not connected to that API and
does not need it.
