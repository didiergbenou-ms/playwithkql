import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_CASE_ID, getCase } from '../data/cases';
import { parseLevel } from '../game/levels/heartbeatHills';
import { beginDraftRun } from './queryDrafts';

export type Screen = 'menu' | 'select' | 'briefing' | 'playing' | 'debrief';

export interface ChallengeProgress {
  attempts: number;
  hintsUsed: number;
  /**
   * Hints bought with a Kusto crystal. Tracked apart from `hintsUsed` because
   * a crystal buys the hint free of *score*, not free of consequence: the
   * player still saw a hint, so this must not leave them eligible for
   * "No Hints Needed" or a clean-solve streak. It also has to persist, or
   * closing the terminal spends the crystal and hides the hint again.
   */
  crystalHints: number;
  /**
   * Whether the reference answer was revealed for this challenge.
   *
   * Revealing the solution is more assistance than any hint, so it has to be
   * recorded: without this a player could reveal the answer, paste it, submit
   * once, and still collect the clean-solve tier, full score and the
   * "No Hints Needed" achievement.
   */
  solutionRevealed: boolean;
  solved: boolean;
  /** The query that finally worked — replayed in the debrief. */
  winningQuery?: string;
}

export interface RunState {
  caseId: string;
  runId: number;
  startedAt: number;
  finishedAt: number | null;
  fragments: number;
  crystals: number;
  /** Crystals spent on free hints. */
  crystalsSpent: number;
  totalFragments: number;
  totalCrystals: number;
  health: number;
  maxHealth: number;
  room: string;
  notesRead: string[];
  deaths: number;
  queriesRun: number;
  /** Consecutive clean solves — light, non-punitive streak. */
  cleanStreak: number;
  challenges: Record<string, ChallengeProgress>;
  evidence: string[];
  openGates: string[];
  verdictId: string | null;
  verdictCorrect: boolean;
  /** Set when a dev shortcut was used, so the score is never mistaken for real. */
  devUsed: boolean;
}

export interface Profile {
  lifetimeScore: number;
  bestScore: number;
  casesClosed: number;
  achievements: string[];
  totalQueries: number;
  /** Last chosen recruit, remembered between sessions. */
  character: string;
}

export interface Rank {
  name: string;
  min: number;
}

export const RANKS: Rank[] = [
  { name: 'Apprentice of Signals', min: 0 },
  { name: 'Signal Tracker', min: 1200 },
  { name: 'Query Adept', min: 3000 },
  { name: 'Signal Warden', min: 5500 },
  { name: 'Grandmaster of Signals', min: 8500 },
];

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-query', name: 'First Query', description: 'Run your first KQL query.' },
  { id: 'kusto-master', name: 'Kusto Master', description: 'Solve every terminal in a case.' },
  { id: 'no-hints', name: 'No Hints Needed', description: 'Close a case without opening a single hint.' },
  { id: 'first-try', name: 'Clean Shot', description: 'Solve a terminal on the first attempt.' },
  { id: 'archivist', name: 'Archivist', description: 'Collect every log fragment in a case.' },
  { id: 'crystallographer', name: 'Crystallographer', description: 'Collect every Kusto crystal.' },
  { id: 'librarian', name: 'Librarian', description: 'Read every lore board.' },
  { id: 'flawless', name: 'Flawless', description: 'Close a case without dying once.' },
  { id: 'quickdraw', name: 'Quickdraw', description: 'Close a case in under 8 minutes.' },
  { id: 'case-closed', name: 'Case Closed', description: 'Correctly identify a root cause.' },
];

export interface ScoreBreakdown {
  completion: number;
  accuracy: number;
  clues: number;
  time: number;
  total: number;
}

let nextRunId = 0;

function emptyRun(
  totalFragments: number,
  totalCrystals: number,
  caseId = DEFAULT_CASE_ID,
): RunState {
  const caseDef = getCase(caseId);
  const runId = ++nextRunId;
  beginDraftRun(runId, caseId);
  return {
    caseId,
    runId,
    startedAt: Date.now(),
    finishedAt: null,
    fragments: 0,
    crystals: 0,
    crystalsSpent: 0,
    totalFragments,
    totalCrystals,
    health: 3,
    maxHealth: 3,
    room: caseDef.level.rooms[0].name,
    notesRead: [],
    deaths: 0,
    queriesRun: 0,
    cleanStreak: 0,
    challenges: Object.fromEntries(
      caseDef.challenges.map((c) => [
        c.id,
        { attempts: 0, hintsUsed: 0, crystalHints: 0, solutionRevealed: false, solved: false },
      ]),
    ),
    evidence: [],
    openGates: [],
    verdictId: null,
    verdictCorrect: false,
    devUsed: false,
  };
}

/**
 * How well a challenge was solved, used to size the celebration.
 *
 * This is mastery-contingent: the player can see exactly what earns the bigger
 * reward, so it teaches rather than manipulating. Deliberately not a random
 * (variable-ratio) bonus, which is the engagement-farming pattern.
 */
/**
 * Progressive hints the player has actually unlocked, for *display*.
 *
 * Deliberately not the same as `hintsSeen`. Seeding the terminal from the
 * assistance count meant revealing the solution made a reopened terminal show
 * two hints that were never purchased — the display count and the "did you get
 * help" count answer different questions and must not be conflated.
 */
export const hintsRevealed = (p: ChallengeProgress | undefined): number =>
  p ? p.hintsUsed + p.crystalHints : 0;

/**
 * Any assistance the player actually received, however it was paid for.
 *
 * Score penalises hints and a revealed answer separately, but "did you get
 * help at all" has to count crystal-funded hints and a revealed answer too —
 * otherwise the rewards for an unaided solve can be collected without doing
 * one. Use this for achievements and solve tiers, never for display.
 */
export const hintsSeen = (p: ChallengeProgress | undefined): number =>
  p ? p.hintsUsed + p.crystalHints + (p.solutionRevealed ? 1 : 0) : 0;

export function solveTier(p: ChallengeProgress | undefined): 1 | 2 | 3 {
  if (!p) return 1;
  const hinted = hintsSeen(p) > 0;
  if (p.attempts <= 1 && !hinted) return 3;
  if (p.attempts <= 1 || !hinted) return 2;
  return 1;
}

/**
 * The fraction of a challenge's points the player kept, after every penalty.
 *
 * Defined once because it was previously written out twice — in scoreRun and
 * in challengeXp — and the two drifted: adding the reveal penalty to the score
 * but not to the displayed XP meant a player could reveal the answer, see full
 * "+XP" on the celebration, and then find fewer points in the final total.
 */
export function challengeMultiplier(p: ChallengeProgress | undefined): number {
  if (!p) return 0;
  const hintPenalty = 0.2 * p.hintsUsed;
  const revealPenalty = p.solutionRevealed ? 0.2 : 0;
  const attemptPenalty = 0.05 * Math.max(0, p.attempts - 1);
  return Math.max(0.3, 1 - hintPenalty - revealPenalty - attemptPenalty);
}

/** Points this single challenge contributed, after hint/attempt penalties. */
export function challengeXp(points: number, p: ChallengeProgress | undefined): number {
  if (!p) return 0;
  return Math.round(points * challengeMultiplier(p));
}

export function scoreRun(run: RunState): ScoreBreakdown {
  const completion = run.verdictCorrect ? 500 : 0;
  const challenges = getCase(run.caseId).challenges;

  const totalWeight = challenges.reduce((t, c) => t + c.points, 0);
  const earned = challenges.reduce((t, c) => {
    const p = run.challenges[c.id];
    if (!p?.solved) return t;
    return t + c.points * challengeMultiplier(p);
  }, 0);
  const accuracy = totalWeight ? Math.round((earned / totalWeight) * 300) : 0;

  const clues = run.totalFragments
    ? Math.round((run.fragments / run.totalFragments) * 100)
    : 0;

  const minutes = ((run.finishedAt ?? Date.now()) - run.startedAt) / 60_000;
  const time = Math.round(100 * Math.min(1, Math.max(0, 1 - (minutes - 5) / 15)));

  return { completion, accuracy, clues, time, total: completion + accuracy + clues + time };
}

export function rankFor(score: number): { name: string; next?: Rank } {
  let current = RANKS[0];
  for (const r of RANKS) if (score >= r.min) current = r;
  const next = RANKS.find((r) => r.min > score);
  return { name: current.name, next };
}

interface Store {
  screen: Screen;
  selectedCaseId: string;
  run: RunState;
  profile: Profile;
  /** Newly earned achievements queued for the toast strip. */
  toasts: { id: string; text: string }[];

  setScreen: (s: Screen) => void;
  selectCase: (caseId: string) => void;
  startRun: (totalFragments: number, totalCrystals: number, caseId?: string) => void;
  setHud: (p: Partial<RunState>) => void;
  readNote: (id: string) => void;
  registerAttempt: (challengeId: string) => void;
  useHint: (challengeId: string) => void;
  spendCrystal: (challengeId: string) => boolean;
  solveChallenge: (challengeId: string, query: string) => void;
  submitVerdict: (optionId: string, correct: boolean) => void;
  award: (id: string) => void;
  setCharacter: (id: string) => void;
  pushToast: (text: string) => void;
  dismissToast: (id: string) => void;
  resetProfile: () => void;
  /** Dev-only shortcuts. Every one of these marks the run as dev-tainted. */
  devSolve: (which: 'next' | 'all') => void;
  /** Marks the run dev-assisted without changing anything else. */
  devTaint: () => void;
  revealSolution: (challengeId: string) => void;
  devGrant: (patch: Partial<RunState>) => void;
}

const initialProfile: Profile = {
  lifetimeScore: 0,
  bestScore: 0,
  casesClosed: 0,
  achievements: [],
  totalQueries: 0,
  character: 'quill',
};

function requireChallenge(run: RunState, challengeId: string) {
  const spec = getCase(run.caseId).challenges.find((c) => c.id === challengeId);
  if (!spec || !run.challenges[challengeId]) {
    throw new Error(`Challenge "${challengeId}" does not belong to active case "${run.caseId}".`);
  }
  return spec;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      screen: 'menu',
      selectedCaseId: DEFAULT_CASE_ID,
      run: emptyRun(0, 0),
      profile: initialProfile,
      toasts: [],

      setScreen: (screen) => set({ screen }),

      selectCase: (caseId) => {
        const caseDef = getCase(caseId);
        if (get().screen === 'playing') {
          throw new Error('Return to the case menu before changing cases.');
        }
        const level = parseLevel(caseDef.level);
        set({
          selectedCaseId: caseId,
          run: emptyRun(level.totalFragments, level.totalCrystals, caseId),
          toasts: [],
        });
      },

      startRun: (totalFragments, totalCrystals, caseId = get().selectedCaseId) =>
        set({
          selectedCaseId: caseId,
          run: emptyRun(totalFragments, totalCrystals, caseId),
          screen: 'playing',
          toasts: [],
        }),

      setHud: (p) => set((s) => ({ run: { ...s.run, ...p } })),

      readNote: (id) =>
        set((s) =>
          s.run.notesRead.includes(id)
            ? s
            : { run: { ...s.run, notesRead: [...s.run.notesRead, id] } },
        ),

      registerAttempt: (challengeId) =>
        set((s) => {
          requireChallenge(s.run, challengeId);
          const c = s.run.challenges[challengeId];
          return {
            run: {
              ...s.run,
              queriesRun: s.run.queriesRun + 1,
              challenges: { ...s.run.challenges, [challengeId]: { ...c, attempts: c.attempts + 1 } },
            },
            profile: s.run.devUsed
              ? s.profile
              : { ...s.profile, totalQueries: s.profile.totalQueries + 1 },
          };
        }),

      useHint: (challengeId) =>
        set((s) => {
          requireChallenge(s.run, challengeId);
          const c = s.run.challenges[challengeId];
          return {
            run: {
              ...s.run,
              challenges: {
                ...s.run.challenges,
                [challengeId]: { ...c, hintsUsed: c.hintsUsed + 1 },
              },
            },
          };
        }),

      /**
       * Spends a Kusto crystal to buy a hint for free. Returns false when the
       * player has none left, in which case the caller charges score instead.
       * This is what makes exploring the level worth doing.
       */
      spendCrystal: (challengeId) => {
        const s = get();
        requireChallenge(s.run, challengeId);
        if (s.run.crystalsSpent >= s.run.crystals) return false;
        set((st) => ({
          run: {
            ...st.run,
            crystalsSpent: st.run.crystalsSpent + 1,
            challenges: {
              ...st.run.challenges,
              [challengeId]: {
                ...st.run.challenges[challengeId],
                // Deliberately does NOT increment hintsUsed, so score is
                // untouched — but it is recorded, so the hint stays revealed
                // on reopen and the player is not still "hint-free".
                crystalHints: st.run.challenges[challengeId].crystalHints + 1,
              },
            },
          },
        }));
        return true;
      },

      solveChallenge: (challengeId, query) => {
        const spec = requireChallenge(get().run, challengeId);
        set((s) => {
          const c = s.run.challenges[challengeId];
          if (c.solved) return s;
          const evidence =
            spec?.evidenceId && !s.run.evidence.includes(spec.evidenceId)
              ? [...s.run.evidence, spec.evidenceId]
              : s.run.evidence;
          const openGates = spec?.unlocksGate
            ? [...new Set([...s.run.openGates, spec.unlocksGate])]
            : s.run.openGates;
          return {
            run: {
              ...s.run,
              challenges: {
                ...s.run.challenges,
                [challengeId]: { ...c, solved: true, winningQuery: query },
              },
              cleanStreak:
                hintsSeen(c) === 0 && c.attempts <= 1 ? s.run.cleanStreak + 1 : 0,
              evidence,
              openGates,
            },
          };
        });

        const { run, award } = get();
        const progress = run.challenges[challengeId];
        if (progress.attempts <= 1 && hintsSeen(progress) === 0) award('first-try');
        if (getCase(run.caseId).challenges.every((c) => run.challenges[c.id].solved)) {
          award('kusto-master');
        }
      },

      submitVerdict: (optionId, correct) => {
        const activeRun = get().run;
        const caseDef = getCase(activeRun.caseId);
        const option = caseDef.rootCauses.find((candidate) => candidate.id === optionId);
        if (!option || Boolean(option.correct) !== correct) {
          throw new Error(`Invalid verdict for active case "${activeRun.caseId}".`);
        }
        if (activeRun.finishedAt !== null) return;
        if (correct && !caseDef.challenges.every((c) => activeRun.challenges[c.id]?.solved)) {
          throw new Error('Solve the active case terminals before submitting its verdict.');
        }
        set((s) => ({
          run: { ...s.run, verdictId: optionId, verdictCorrect: correct, finishedAt: Date.now() },
        }));

        const { run, award } = get();
        if (!correct) return;

        // A run that used dev shortcuts must not touch the profile. Otherwise
        // testing the debrief inflates lifetime score and silently unlocks
        // achievements that were never earned.
        if (run.devUsed) return;

        const score = scoreRun(run);
        award('case-closed');
        if (run.fragments >= run.totalFragments) award('archivist');
        if (run.crystals >= run.totalCrystals) award('crystallographer');
        if (caseDef.level.notes.every((note) => run.notesRead.includes(note.id))) award('librarian');
        if (run.deaths === 0) award('flawless');
        if (Object.values(run.challenges).every((c) => hintsSeen(c) === 0)) award('no-hints');
        if ((run.finishedAt ?? Date.now()) - run.startedAt < 8 * 60_000) award('quickdraw');

        set((s) => ({
          profile: {
            ...s.profile,
            lifetimeScore: s.profile.lifetimeScore + score.total,
            bestScore: Math.max(s.profile.bestScore, score.total),
            casesClosed: s.profile.casesClosed + 1,
          },
        }));
      },

      award: (id) =>
        set((s) => {
          // Single choke point for every achievement write, which is why the
          // dev-run guard lives here rather than at each call site: solving a
          // challenge awards achievements too, so guarding only the verdict
          // path let dev shortcuts unlock "first-try" and "kusto-master".
          if (s.run.devUsed) return s;
          if (s.profile.achievements.includes(id)) return s;
          const def = ACHIEVEMENTS.find((a) => a.id === id);
          return {
            profile: { ...s.profile, achievements: [...s.profile.achievements, id] },
            toasts: [
              ...s.toasts,
              { id: `${id}-${Date.now()}`, text: `Achievement — ${def?.name ?? id}` },
            ],
          };
        }),

      setCharacter: (id) => set((s) => ({ profile: { ...s.profile, character: id } })),

      pushToast: (text) =>
        set((s) => ({ toasts: [...s.toasts, { id: `t-${Date.now()}-${Math.random()}`, text }] })),

      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      resetProfile: () => set({ profile: initialProfile }),

      devSolve: (which) => {
        // Flag first and unconditionally. Returning early when nothing was
        // pending left a fully-solved clean run unflagged, so "Finish case"
        // on it still wrote a dev-assisted completion to the profile.
        set((s) => ({ run: { ...s.run, devUsed: true } }));
        const activeRun = get().run;
        const pending = getCase(activeRun.caseId).challenges.filter(
          (c) => !activeRun.challenges[c.id].solved,
        );
        const target = which === 'all' ? pending : pending.slice(0, 1);
        for (const c of target) get().solveChallenge(c.id, c.solution);
      },

      /** Marks the run dev-assisted without changing anything else. */
      devTaint: () => set((s) => ({ run: { ...s.run, devUsed: true } })),

      /**
       * Records that the reference answer was shown. Idempotent, so toggling
       * the panel cannot stack penalties.
       */
      revealSolution: (challengeId) =>
        set((s) => {
          requireChallenge(s.run, challengeId);
          const c = s.run.challenges[challengeId];
          if (c.solved || c.solutionRevealed) return s;
          return {
            run: {
              ...s.run,
              challenges: { ...s.run.challenges, [challengeId]: { ...c, solutionRevealed: true } },
            },
          };
        }),

      devGrant: (patch) => set((s) => ({ run: { ...s.run, ...patch, devUsed: true } })),
    }),
    {
      name: 'kql-quest-profile',
      partialize: (s) => ({ profile: s.profile }),
    },
  ),
);

export const evidenceById = (id: string, caseId = DEFAULT_CASE_ID) =>
  getCase(caseId).evidence.find((e) => e.id === id);

export interface Objective {
  /** One line telling the player exactly what to do next. */
  text: string;
  /** Room the target sits in. */
  room: number;
  /** Challenge to head for, when the objective is a terminal. */
  challengeId?: string;
  /** True once every terminal is solved and the verdict is the target. */
  finale: boolean;
  /** Terminals solved so far. */
  solved: number;
  total: number;
}

/** Derives "what should I be doing right now" from run state. */
export function currentObjective(solvedIds: string[], caseId = DEFAULT_CASE_ID): Objective {
  const caseDef = getCase(caseId);
  const challenges = caseDef.challenges;
  const solvedSet = new Set(solvedIds);
  const next = challenges.find((c) => !solvedSet.has(c.id));
  const solved = challenges.filter((c) => solvedSet.has(c.id)).length;

  if (!next) {
    const finalRoom = caseDef.level.rooms.length - 1;
    return {
      text: `All terminals solved — reach the verdict console in the ${caseDef.level.rooms[finalRoom].name}`,
      room: finalRoom,
      finale: true,
      solved,
      total: challenges.length,
    };
  }
  return {
    text: `Find and solve the KQL terminal in ${caseDef.level.rooms[next.room].name}`,
    room: next.room,
    challengeId: next.id,
    finale: false,
    solved,
    total: challenges.length,
  };
}

/** Terminal counts per room, for the progress strip. */
export function roomProgress(
  solvedIds: string[],
  caseId = DEFAULT_CASE_ID,
): { name: string; solved: number; total: number }[] {
  const caseDef = getCase(caseId);
  const solvedSet = new Set(solvedIds);
  return caseDef.level.rooms.map(({ name }, i) => {
    const inRoom = caseDef.challenges.filter((c) => c.room === i);
    return {
      name,
      solved: inRoom.filter((c) => solvedSet.has(c.id)).length,
      total: inRoom.length,
    };
  });
}

// ---- quick reference -------------------------------------------------------

export interface ReferenceEntry {
  syntax: string;
  what: string;
  example: string;
}

/** The field card, openable at any time with K. */
export const REFERENCE: { group: string; entries: ReferenceEntry[] }[] = [
  {
    group: 'Shape of a query',
    entries: [
      {
        syntax: 'TableName | operator | operator',
        what: 'Data flows left to right. Each pipe hands rows to the next stage.',
        example: 'Heartbeat | take 5',
      },
    ],
  },
  {
    group: 'Choosing rows',
    entries: [
      { syntax: 'where <condition>', what: 'Keep only matching rows.', example: 'where OSType == "Linux"' },
      { syntax: 'take N', what: 'Grab N rows, any N. Good for a peek.', example: 'take 10' },
      { syntax: 'distinct Col', what: 'Unique values of a column.', example: 'distinct Computer' },
      { syntax: 'top N by Col', what: 'Highest N by an expression.', example: 'top 5 by TimeGenerated' },
      { syntax: 'sort by Col asc', what: 'Order rows. Descending is the default.', example: 'sort by Computer asc' },
    ],
  },
  {
    group: 'Choosing columns',
    entries: [
      { syntax: 'project A, B', what: 'Keep only these columns.', example: 'project Computer, Version' },
      { syntax: 'project New = expr', what: 'Rename or compute while selecting.', example: 'project Machine = Computer' },
      { syntax: 'extend New = expr', what: 'Add a column, keep the rest.', example: 'extend Hour = bin(TimeGenerated, 1h)' },
    ],
  },
  {
    group: 'Grouping',
    entries: [
      { syntax: 'summarize count() by Col', what: 'One row per group, with a count.', example: 'summarize count() by Computer' },
      { syntax: 'summarize max(Col) by Col', what: 'Latest value per group — "when was this last seen?".', example: 'summarize max(TimeGenerated) by Computer' },
      { syntax: 'summarize dcount(Col)', what: 'How many distinct values.', example: 'summarize dcount(Computer)' },
      { syntax: 'min() sum() avg()', what: 'The other usual aggregations.', example: 'summarize avg(EventId)' },
    ],
  },
  {
    group: 'Matching text',
    entries: [
      { syntax: '==   !=', what: 'Exact match, case sensitive.', example: 'Level == "Error"' },
      { syntax: '=~', what: 'Exact match, ignoring case.', example: 'Level =~ "error"' },
      { syntax: 'contains', what: 'Substring, ignoring case.', example: 'Message contains "proxy"' },
      { syntax: 'has', what: 'Whole word — faster than contains.', example: 'Message has "handshake"' },
      { syntax: 'in ("a","b")', what: 'Matches any of a list.', example: 'Computer in ("A","B")' },
    ],
  },
  {
    group: 'Time',
    entries: [
      { syntax: 'ago(24h)', what: 'A moment in the past, relative to now.', example: 'where TimeGenerated > ago(24h)' },
      { syntax: 'bin(T, 1h)', what: 'Round timestamps into buckets.', example: 'summarize count() by bin(TimeGenerated, 1h)' },
      { syntax: '1m 1h 1d', what: 'Timespan literals.', example: 'ago(7d)' },
    ],
  },
  {
    group: 'Beyond this case — try if you are curious',
    entries: [
      { syntax: 'summarize arg_max(T, *) by Col', what: 'The whole row holding the max, not just the value.', example: 'summarize arg_max(TimeGenerated, *) by Computer' },
      { syntax: 'parse_json(col)', what: 'Turn a JSON text column into an object.', example: 'extend p = parse_json(Properties)' },
      { syntax: 'p.a.b.c', what: 'Walk into a parsed object.', example: 'p.settings.proxy.url' },
      { syntax: 'top N by Col', what: 'Highest N by an expression.', example: 'top 5 by TimeGenerated' },
    ],
  },
];
