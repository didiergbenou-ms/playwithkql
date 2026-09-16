# KQL Quest: Kingdom of Signals

![KQL Quest prototype showing a pixel-art investigation and player progress](assets/kql-detective-prototype.png)

KQL Quest is a pixel-art platform adventure that helps anyone learn Kusto Query Language (KQL) through exploration, puzzles, and real query-writing challenges.

Players explore the Kingdom of Signals, collect evidence, and use KQL in terminal-based encounters to defeat anomalies. Instead of memorizing syntax in isolation, learners apply each operator to a practical investigation.

## Hackathon project

This project was created for the [Microsoft Global Hackathon 2026](https://innovation-studio.microsoft.com/events/hackathon2026/page/about) under the **Build Skills for the Hardest Problems CSS Faces** Executive Challenge.

The first mission pack focuses on support and observability scenarios relevant to Customer Service and Support (CSS). The platform itself is designed for anyone who wants to learn KQL.

## The problem

KQL learning is often passive and disconnected from real investigations. Beginners may recognize operators without knowing how to combine them to answer an unfamiliar question.

KQL Quest turns that learning process into an interactive adventure where progress depends on understanding the data.

## Learning experience

The playable beginner path introduces:

- `take` to inspect a few rows
- `distinct` to identify machines
- `where` with `ago()` to filter recent signals
- `summarize` with `max()` to find last-seen times
- Applying those operators to a second table to find the cause

Each mission combines:

1. A story-driven investigation
2. A synthetic dataset
3. A query objective
4. Immediate, explainable feedback
5. Authored progressive hints and worked examples
6. A result-based query check before progression

## Hackathon roadmap

These are project goals, not a list of shipped features. The current playable
scope is described under **Project status** below.

- Expand to five distinct KQL missions
- Add a final investigation battle beyond the current verdict console
- Extend the existing browser-based KQL editor and synthetic-data interpreter
- Add an AI coach alongside the current authored hints
- Add a mastery dashboard and before-and-after skill measurement
- Grow the reusable case format into future learning packs

## Design direction

The experience uses a polished retro fantasy style with pixel art, an emerald CRT interface, terminal glow, bloom, and subtle screen distortion. The visual identity is inspired by classic platform adventures without using third-party characters, names, artwork, or other protected assets.

## Success measures

- Mission completion rate
- Query accuracy
- Time to correct an unsuccessful query
- Reduction in hints across missions
- Improvement between the initial and final mastery checks

## Project status

A playable prototype now lives in this repository: a real KQL interpreter,
four characters, and three selectable case files.

| Case | Map | Content status |
|---|---|---|
| 001 | Heartbeat Hills | Fleet scope, aggregation and structured configuration evidence |
| 002 | Signal Harbor | Log discovery, timelines and administrator audit context |
| 003 | Relay Ruins | Performance reports, calculations and incident closeout |

The three maps investigate one synthetic March 11 network-path incident through
different evidence. Each has its own terminal, gate, evidence and note IDs.
Choose a case, difficulty and recruit; replay and switching start fresh runs.
Profiles remain shared across cases, and in-progress runs are not saved on reload.

Each case now has **Beginner, Intermediate and Expert** question sets. The flow
is **case -> difficulty -> recruit -> investigation**. There are **9 sets
of 5 terminals: 45 executable questions**, without adding maps or changing
movement. The supplied curriculum's 12 Beginner questions have three additions;
the higher tiers are adapted to supported local analysis. All adapted content
remains labelled for editorial review, with sources and license notices.
Completion and best scores are recorded separately for each case/difficulty.
Older aggregate profile history is retained but is not assigned to any tier.

**New to the project?** Follow the [local development guide](docs/LOCAL_DEVELOPMENT.md)
for the full steps to install the tools, clone `develop`, and run the game on
Windows, macOS, or Linux.

```bash
npm install
npm run dev
```

See **[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)** for how it is built and
why, and for what is deliberately not built yet.

## Contributing

AI coding assistants can use the repository's
[KQL Quest development skill](.github/skills/kql-quest-dev/SKILL.md) to locate
level maps, wire terminals and gates, and follow the development workflows.

Copilot also has a short [repository entry point](.github/copilot-instructions.md).
For another assistant, explicitly attach the skill instead of assuming it is
automatically discovered.

**Start with one case, map, or subsystem per PR.** The
[contributor workflow](docs/LOCAL_DEVELOPMENT.md#contribute-one-scoped-change)
explains file boundaries, the independent case starter, content checks and the
dev-only content workbench at **`?author=1`**. The workbench opens lessons and
verdicts directly without playing through the map or saving game progress.

Use the repository's issue forms for **case content**, **maps**, **UI/accessibility**
or **audio** to record an owner, scope and observable acceptance criteria.
Ideas and non-code contributions are welcome too; define the intended player
experience before asking an AI to implement it.

## Responsible development

The prototype uses synthetic data only. AI-generated guidance should be grounded in the active mission, should not expose solutions immediately, and should clearly distinguish hints from verified query results.

## License

Licensing information will be added before external distribution.
