// Publishes the built game to the public play repo.
//
// The source repo is private, but GitHub Pages on a private repo is both a
// paid feature and access-restricted to people with repo access - so it cannot
// serve a link that "anyone can open". Splitting them keeps the source private
// while the built output sits in a public repo that Pages will serve to the
// world. Only compiled assets are published; no source, tests or history.
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = resolve(root, ".deploy");

const REPO = process.env.PLAY_REPO ?? "petarivanov-msft/kql-detective-play";
const BASE = `/${REPO.split("/")[1]}/`;

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });

console.log(`\n[1/4] building with base ${BASE}`);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  env: { ...process.env, PAGES_BASE: BASE },
});

console.log("\n[2/4] staging");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(resolve(root, "dist"), staging, { recursive: true });

// The game is a single screen with no client-side routing, but a deep link or
// a refresh on an unknown path should still land in the game rather than on
// GitHub's 404 page.
copyFileSync(resolve(staging, "index.html"), resolve(staging, "404.html"));

// Without this, Pages runs the output through Jekyll, which silently drops any
// path segment beginning with an underscore.
writeFileSync(resolve(staging, ".nojekyll"), "");

writeFileSync(
  resolve(staging, "README.md"),
  [
    "# KQL Detective: Azure Monitoring Academy",
    "",
    `Play it: **https://${REPO.split("/")[0]}.github.io${BASE}**`,
    "",
    "A browser-based 2D platformer that teaches KQL and Azure troubleshooting",
    "by making you investigate a real-shaped incident: customer heartbeat data",
    "stopped arriving, and you have to work out why.",
    "",
    "Run, jump and explore four rooms, find terminals, and write real KQL to",
    "open the gates. Queries are executed by an actual interpreter, not matched",
    "against an expected answer - any correct query works.",
    "",
    "## Controls",
    "",
    "| Key | Action |",
    "|---|---|",
    "| Arrows / WASD | Move |",
    "| Space / W / Up | Jump |",
    "| E | Use terminal |",
    "| N | Notebook |",
    "| K | KQL reference |",
    "| O | Options (audio) |",
    "",
    "---",
    "",
    "This repository contains **build output only** - it exists so the game can",
    "be played without access to the private source repository. Do not commit",
    "here; it is overwritten on every deploy.",
    "",
  ].join("\n"),
);

console.log("\n[3/4] committing");
const git = (...args) => run("git", args, { cwd: staging });
git("init", "-q", "-b", "main");
git("config", "user.email", "petarivanov@microsoft.com");
git("config", "user.name", "Petar Ivanov");
git("add", "-A");
git("commit", "-q", "-m", `Deploy ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);

console.log(`\n[4/4] pushing to ${REPO}`);
git("remote", "add", "origin", `https://github.com/${REPO}.git`);
git("push", "-q", "--force", "origin", "main");

rmSync(staging, { recursive: true, force: true });

// Leave dist/ matching the local dev server's expectations rather than the
// Pages base, or the locally served build breaks after every deploy.
console.log("\nrestoring local build");
run(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);

console.log(`\ndone -> https://${REPO.split("/")[0]}.github.io${BASE}`);
