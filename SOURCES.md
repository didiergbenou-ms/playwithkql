# SOURCES.md — Attribution Ledger

Imported from the supplied curriculum pack. Its case numbering and campaign
layout describe the source material, not the current three-map game.
The adapted lessons reference `sourceIds` and optional `sourceTerminalId` under
`src/data/questions/`; player-facing links/notices are in
`src/data/curriculumSources.ts`. Adaptations are identified in lesson content
notes. No reference-only puzzle assets are imported.

Every `source` id referenced by a terminal (`content/cases/**/terminals/*.json`) **must** resolve to an
entry in this file. CI check #6 in the curriculum enforces this.

| Field | Meaning |
|-------|---------|
| **ID** | Stable token used in the `source` array of a terminal record. Never rename — only add. |
| **License** | Governs reuse. See §4 for the required notices. |
| **Use** | `derive` = rewrite in Bureau voice, `link` = reference only (lore board), `data` = seed data. |

---

## 1. Must Learn KQL — blog series & book

- **Project:** Must Learn KQL by Rod Trent
- **Repository:** https://github.com/rod-trent/MustLearnKQL
- **Book (PDF):** https://github.com/rod-trent/MustLearnKQL/tree/main/Book_Version
- **Shortlink:** https://aka.ms/MustLearnKQL
- **License:** MIT (see §4.1)
- **Use:** `derive` — attribution required on the lore board of any case that uses it.

| ID | Part | Title | URL | Tier |
|----|------|-------|-----|------|
| `MLKQL-Part01` | 1 | Tools and Resources | https://rodtrent.substack.com/p/must-learn-kql-part-1-tools-and-resources | Beginner (onboarding) |
| `MLKQL-Part02` | 2 | Just Above Sea Level | https://rodtrent.substack.com/p/must-learn-kql-part-2-just-above | Beginner |
| `MLKQL-Part03` | 3 | Workflow | https://rodtrent.substack.com/p/must-learn-kql-part-3-workflow | Beginner |
| `MLKQL-Part04` | 4 | Search for Fun and Profit | https://rodtrent.substack.com/p/must-learn-kql-part-4-search-for | Beginner |
| `MLKQL-Part05` | 5 | Turn Search into Workflow | https://rodtrent.substack.com/p/must-learn-kql-part-5-turn-search | Beginner |
| `MLKQL-Part06` | 6 | Interface Intimacy | https://rodtrent.substack.com/p/must-learn-kql-part-6-interface-intimacy | Beginner (onboarding) |
| `MLKQL-Part07` | 7 | Schema Talk | https://rodtrent.substack.com/p/must-learn-kql-part-7-schema-talk | Beginner |
| `MLKQL-Part08` | 8 | The Where Operator | https://rodtrent.substack.com/p/must-learn-kql-part-8-the-where-operator | Beginner |
| `MLKQL-Part09` | 9 | The Limit/Take Operators | https://rodtrent.substack.com/p/must-learn-kql-part-9-the-limit-and | Beginner |
| `MLKQL-Part10` | 10 | The Count Operator | https://rodtrent.substack.com/p/must-learn-kql-part-10-the-count | Beginner |
| `MLKQL-Part11` | 11 | The Summarize Operator | https://rodtrent.substack.com/p/must-learn-kql-part-11-the-summarize | Intermediate |
| `MLKQL-Part12` | 12 | The Render Operator (with Bin and Time) | https://rodtrent.substack.com/p/must-learn-kql-part-12-the-render | Intermediate |
| `MLKQL-Part13` | 13 | The Extend Operator | https://rodtrent.substack.com/p/must-learn-kql-part-13-the-extend | Intermediate |
| `MLKQL-Part14` | 14 | The Project Operator | https://rodtrent.substack.com/p/must-learn-kql-part-14-the-project | Beginner |
| `MLKQL-Part15` | 15 | The Distinct Operator | https://rodtrent.substack.com/p/must-learn-kql-part-15-the-distinct | Beginner |
| `MLKQL-Part16` | 16 | The Order/Sort and Top Operators | https://rodtrent.substack.com/p/must-learn-kql-part-16-the-ordersort | Beginner |
| `MLKQL-Part17` | 17 | The Let Statement | https://rodtrent.substack.com/p/must-learn-kql-part-17-the-let-statement | Intermediate |
| `MLKQL-Part18` | 18 | The Union Operator | https://rodtrent.substack.com/p/must-learn-kql-part-18-the-union | Intermediate |
| `MLKQL-Part19` | 19 | The Join Operator | https://rodtrent.substack.com/p/must-learn-kql-part-19-the-join-operator | Intermediate |
| `MLKQL-Part20` | 20 | Building your first Microsoft Sentinel Analytics Rule | https://rodtrent.substack.com/p/must-learn-kql-part-20-building-your | Advanced |
| `MLKQL-Part21` | 21 | Maximizing Your Use of KQL: Tips, Tricks, and Tools | https://rodtrent.substack.com/p/must-learn-kql-part-21-maximizing | Advanced |

### Advanced Must Learn KQL

| ID | Title | URL | Tier |
|----|-------|-----|------|
| `MLKQL-Adv-Ch1` | Advanced KQL — Chapter 1 | https://github.com/rod-trent/MustLearnKQL/blob/main/Advanced_KQL/Chapter1.md | Advanced |
| `MLKQL-Adv-Ch2` | Advanced KQL — Chapter 2 | https://github.com/rod-trent/MustLearnKQL/blob/main/Advanced_KQL/Chapter2.md | Advanced |
| `MLKQL-Adv-Ch3` | Advanced KQL — Chapter 3 | https://github.com/rod-trent/MustLearnKQL/blob/main/Advanced_KQL/Chapter3.md | Advanced |

### Supporting assets (seed data / query examples)

| ID | Path | URL | Use |
|----|------|-----|-----|
| `MLKQL-Datasets` | `Datasets/` | https://github.com/rod-trent/MustLearnKQL/tree/main/Datasets | `data` |
| `MLKQL-Examples` | `Examples/` | https://github.com/rod-trent/MustLearnKQL/tree/main/Examples | `data` |
| `MLKQL-Workshop` | `Workshop/` | https://github.com/rod-trent/MustLearnKQL/tree/main/Workshop | `derive` |

---

## 2. Microsoft Learn

- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0) for documentation content (see §4.2)
- **Index page:** https://learn.microsoft.com/en-us/azure/data-explorer/kql-learning-resources
- **Use:** `derive` for syntax/semantics, `link` on lore boards.

| ID | Title | URL | Used by |
|----|-------|-----|---------|
| `MSLearn-kql-overview` | KQL overview | https://learn.microsoft.com/en-us/kusto/query/ | Onboarding, Case 001 |
| `MSLearn-learning-resources` | KQL learning resources (index) | https://learn.microsoft.com/en-us/azure/data-explorer/kql-learning-resources | Lore boards (all tiers) |
| `MSLearn-common-operators` | Tutorial: Learn common operators | https://learn.microsoft.com/en-us/kusto/query/tutorials/learn-common-operators | Cases 001–003 |
| `MSLearn-aggregation-functions` | Tutorial: Use aggregation functions | https://learn.microsoft.com/en-us/kusto/query/tutorials/use-aggregation-functions | Case 004 |
| `MSLearn-join-tables` | Tutorial: Join data from multiple tables | https://learn.microsoft.com/en-us/kusto/query/tutorials/join-data-from-multiple-tables | Case 007 |
| `MSLearn-geospatial` | Tutorial: Create geospatial visualizations | https://learn.microsoft.com/en-us/kusto/query/tutorials/create-geospatial-visualizations | Case 011 |
| `MSLearn-anomalies` | Detect and analyze anomalies using KQL in Azure Monitor | https://learn.microsoft.com/en-us/azure/azure-monitor/logs/kql-machine-learning-azure-monitor | Case 009 |
| `MSLearn-path-monitoring` | Path: Analyze monitoring data with KQL | https://learn.microsoft.com/en-us/training/paths/analyze-monitoring-data-with-kql/ | Cases 005, 006 |
| `MSLearn-path-adx` | Path: Data analysis in Azure Data Explorer with KQL | https://learn.microsoft.com/en-us/training/paths/data-analysis-data-explorer-kusto-query-language/ | Cases 008, 010 |
| `MSLearn-path-sc200` | Path: SC-200 — Create queries for Microsoft Sentinel using KQL | https://learn.microsoft.com/en-us/training/paths/sc-200-utilize-kql-for-azure-sentinel/ | Case 011 |
| `MSLearn-fabric-rti` | Module: Get started with Real-Time Intelligence in Fabric | https://learn.microsoft.com/en-us/training/modules/get-started-kusto-fabric/ | Lore board (Advanced) |

---

## 3. Reference-only (do NOT copy content)

| ID | Title | URL | Rule |
|----|-------|-----|------|
| `REF-kusto-detective` | Kusto Detective Agency | https://detective.kusto.io/ | Tone/difficulty benchmark only. **No puzzle, dataset, story or asset reuse.** Case 012 must be an original scenario. |
| `REF-kql-mysteries` | The KQL Mysteries series | https://aka.ms/KQLMysteries | Inspiration only; link from lore board. |

Third-party paid courses listed on the MS Learn index page (Pluralsight, Udemy, QA, Koenig, Infosec Train)
are **out of scope** — do not derive content from them and do not link them in-game.

---

## 4. Required license notices

Ship this section verbatim in the game's in-app **Credits / Attribution** screen.

### 4.1 Must Learn KQL (MIT)

```
Must Learn KQL — Copyright (c) 2022 Rod Trent
Licensed under the MIT License.
Source: https://github.com/rod-trent/MustLearnKQL

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

> The copyright year and MIT notice were checked against
> https://github.com/rod-trent/MustLearnKQL/blob/main/LICENSE on 2026-09-16.
> Recheck applicable upstream notices before a public release.

### 4.2 Microsoft Learn documentation (CC BY 4.0)

```
Portions of this content are adapted from Microsoft Learn documentation,
© Microsoft Corporation, licensed under Creative Commons Attribution 4.0
International (CC BY 4.0) — https://creativecommons.org/licenses/by/4.0/
Source: https://learn.microsoft.com/
Changes were made: content was rewritten, condensed and adapted for game dialogue.
```

CC BY 4.0 requires stating that changes were made — the last line is **not optional**.

### 4.3 Trademarks

Microsoft, Azure, Microsoft Sentinel, Azure Monitor, Azure Data Explorer and Kusto are trademarks of
Microsoft Corporation. Their use here is descriptive. If this game ships publicly under a Microsoft-adjacent
name, route branding through the internal trademark/brand review before release.

---

## 5. Author rules

1. **Never paste source prose verbatim** into a Learn card. Rewrite in the Bureau's detective voice.
2. Query *syntax* and operator names are facts, not expression — reuse freely.
3. Worked examples adapted from a source must change the table, columns and scenario to the case's own dataset.
4. Every terminal lists **at least one** `source` id. `[]` fails CI.
5. `link`-only sources (§3) may appear on lore boards but must never appear in a terminal's `source` array.
6. Adding a new source = add a row here **first**, then reference the id.

---

## 6. Changelog

| Date | Change |
|------|--------|
| 2026-09-15 | Initial ledger created from the Must Learn KQL series/book and the MS Learn KQL learning resources index. |
