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
on-screen prompts. Use **A/D** to move, **Space** to jump, and **E** to interact.

Do not open `index.html` directly from your file manager; use the local URL.

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

## Optional developer checks

Run these from the project folder in a second terminal, or after stopping the
development server:

```sh
npm run typecheck
npm test
npm run test:ui
npm run test:cases
npm run fuzz
npm run build
```

To view the production build locally after `npm run build`:

```sh
npm run serve:dist
```

Open **http://127.0.0.1:4173**. This serves the built files without live updates;
use `npm run dev` for everyday development. Stop either server with **Ctrl+C**.

## Common setup problems

| Problem | What to do |
|---|---|
| Clone fails with "Repository not found" or an authentication error | Check the repository URL and sign in with a GitHub account that has access. Ask a repository maintainer for access if needed. |
| npm cannot find `package.json` | Run the command inside `playwithkql` and check that `git branch --show-current` prints `develop` or your development working branch. |
| `EBADENGINE` or an error about an unsupported Node version | Check `node --version` and install a supported version from step 1, then reopen the terminal and run `npm ci` again. |
| Dependency downloads fail | Check internet/proxy access. The current lockfile downloads packages from Microsoft's public npm mirror at `*.pkgs.visualstudio.com`; that host must be reachable. Do not disable TLS checks or delete the lockfile to work around a network error. |
| `vite` is not found | Run `npm ci` successfully in the project folder, then retry `npm run dev`. |
| The browser cannot connect | Keep `npm run dev` running and use the exact Local URL it prints. |
| Port 4173 is already in use for the production preview | Stop the server you previously started on that port, or use `npm run preview -- --port 4174` after building and open the URL it prints. |

For architecture, all game controls, and implementation details, see
[IMPLEMENTATION.md](IMPLEMENTATION.md). Its optional `npm run server` command
starts a separate local-only API; the game is not connected to that API and
does not need it.
