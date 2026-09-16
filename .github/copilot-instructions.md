# KQL Quest contributor entry point

Read `.github/skills/kql-quest-dev/SKILL.md` before changing this game. It is the
single detailed task-to-file map and authoring guide; follow its links rather
than duplicating those instructions here. Read the current implementation
before relying on a documented assumption.

- Work on a feature branch from current `develop`; PRs target `develop`.
  Do not merge, deploy, push or discard somebody else's changes without approval.
- Keep a contribution scoped to one case, map, or subsystem. Agree on the file
  boundary before parallel work; do not rewrite shared gameplay for a content task.
- Use synthetic data only. Do not copy customer telemetry, credentials, internal
  incident records or copyrighted assets into examples or generated content.
- Separate implemented features from the README roadmap. The game has authored
  hints and a local mini-interpreter, not a real Kusto connection or AI coach.
- Phaser is pinned to 4.2.1. Follow the skill's Phaser 4 compatibility section;
  do not introduce Phaser 3 renderer APIs or change the engine during content work.
- Use `src/authoring/caseStarter.ts` for an independent content example.
  Do not edit Case 001 to customize the placeholder copies in Cases 002/003.
- Use `npm run check:content` and the dev-only `?author=1` workbench for content
  iteration. Preview state is not gameplay state or proof of physical reachability.
- Preserve existing map IDs, game behavior and profile isolation unless the task
  explicitly changes them. Do not remove checks just to make new content pass.
- Run the existing relevant tests and a build before handing off code. Test
  commands must run sequentially because they share `.tmp/test.mjs`.

For another AI tool that does not load this file or repository skills
automatically, explicitly attach the linked skill and the task's acceptance
criteria. Tool discovery is not a substitute for a scoped assignment.
