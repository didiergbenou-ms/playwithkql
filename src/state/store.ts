import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CHALLENGES, EVIDENCE } from '../data/case001';

export type Screen = 'menu' | 'select' | 'briefing' | 'playing' | 'debrief';

export interface ChallengeProgress {
  attempts: number;
  hintsUsed: number;
  solved: boolean;
  /** The query that finally worked — replayed in the debrief. */
  winningQuery?: string;
}

export interface RunState {
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
  { name: 'Intern Investigator', min: 0 },
  { name: 'Support Engineer', min: 1200 },
  { name: 'Senior Investigator', min: 3000 },
  { name: 'Technical Advisor', min: 5500 },
  { name: 'Principal Detective', min: 8500 },
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

function emptyRun(totalFragments: number, totalCrystals: number): RunState {
  return {
    startedAt: Date.now(),
    finishedAt: null,
    fragments: 0,
    crystals: 0,
    crystalsSpent: 0,
    totalFragments,
    totalCrystals,
    health: 3,
    maxHealth: 3,
    room: 'Customer Office',
    notesRead: [],
    deaths: 0,
    queriesRun: 0,
    cleanStreak: 0,
    challenges: Object.fromEntries(
      CHALLENGES.map((c) => [c.id, { attempts: 0, hintsUsed: 0, solved: false }]),
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
export function solveTier(p: ChallengeProgress | undefined): 1 | 2 | 3 {
  if (!p) return 1;
  if (p.attempts <= 1 && p.hintsUsed === 0) return 3;
  if (p.attempts <= 1 || p.hintsUsed === 0) return 2;
  return 1;
}

/** Points this single challenge contributed, after hint/attempt penalties. */
export function challengeXp(points: number, p: ChallengeProgress | undefined): number {
  if (!p) return 0;
  const penalty = 0.2 * p.hintsUsed + 0.05 * Math.max(0, p.attempts - 1);
  return Math.round(points * Math.max(0.3, 1 - penalty));
}

export function scoreRun(run: RunState): ScoreBreakdown {  const completion = run.verdictCorrect ? 500 : 0;

  const totalWeight = CHALLENGES.reduce((t, c) => t + c.points, 0);
  const earned = CHALLENGES.reduce((t, c) => {
    const p = run.challenges[c.id];
    if (!p?.solved) return t;
    const hintPenalty = 0.2 * p.hintsUsed;
    const attemptPenalty = 0.05 * Math.max(0, p.attempts - 1);
    return t + c.points * Math.max(0.3, 1 - hintPenalty - attemptPenalty);
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
  run: RunState;
  profile: Profile;
  /** Newly earned achievements queued for the toast strip. */
  toasts: { id: string; text: string }[];

  setScreen: (s: Screen) => void;
  startRun: (totalFragments: number, totalCrystals: number) => void;
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
  devGrant: (patch: Partial<RunState>) => void;
}

const initialProfile: Profile = {
  lifetimeScore: 0,
  bestScore: 0,
  casesClosed: 0,
  achievements: [],
  totalQueries: 0,
  character: 'gumshoe',
};

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      screen: 'menu',
      run: emptyRun(0, 0),
      profile: initialProfile,
      toasts: [],

      setScreen: (screen) => set({ screen }),

      startRun: (totalFragments, totalCrystals) =>
        set({ run: emptyRun(totalFragments, totalCrystals), screen: 'playing' }),

      setHud: (p) => set((s) => ({ run: { ...s.run, ...p } })),

      readNote: (id) =>
        set((s) =>
          s.run.notesRead.includes(id)
            ? s
            : { run: { ...s.run, notesRead: [...s.run.notesRead, id] } },
        ),

      registerAttempt: (challengeId) =>
        set((s) => {
          const c = s.run.challenges[challengeId];
          return {
            run: {
              ...s.run,
              queriesRun: s.run.queriesRun + 1,
              challenges: { ...s.run.challenges, [challengeId]: { ...c, attempts: c.attempts + 1 } },
            },
            profile: { ...s.profile, totalQueries: s.profile.totalQueries + 1 },
          };
        }),

      useHint: (challengeId) =>
        set((s) => {
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
        if (s.run.crystalsSpent >= s.run.crystals) return false;
        set((st) => ({
          run: {
            ...st.run,
            crystalsSpent: st.run.crystalsSpent + 1,
            challenges: {
              ...st.run.challenges,
              [challengeId]: {
                ...st.run.challenges[challengeId],
                // deliberately does NOT increment hintsUsed, so score is untouched
              },
            },
          },
        }));
        return true;
      },

      solveChallenge: (challengeId, query) => {
        const spec = CHALLENGES.find((c) => c.id === challengeId);
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
                c.hintsUsed === 0 && c.attempts <= 1 ? s.run.cleanStreak + 1 : 0,
              evidence,
              openGates,
            },
          };
        });

        const { run, award } = get();
        const progress = run.challenges[challengeId];
        if (progress.attempts <= 1 && progress.hintsUsed === 0) award('first-try');
        if (CHALLENGES.every((c) => run.challenges[c.id].solved)) award('kusto-master');
      },

      submitVerdict: (optionId, correct) => {        set((s) => ({
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
        if (run.notesRead.length >= 3) award('librarian');
        if (run.deaths === 0) award('flawless');
        if (Object.values(run.challenges).every((c) => c.hintsUsed === 0)) award('no-hints');
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
        const pending = CHALLENGES.filter((c) => !get().run.challenges[c.id].solved);
        const target = which === 'all' ? pending : pending.slice(0, 1);
        if (!target.length) return;
        // Mark first: solveChallenge awards achievements, and devUsed is what
        // stops those from reaching the profile.
        set((s) => ({ run: { ...s.run, devUsed: true } }));
        for (const c of target) get().solveChallenge(c.id, c.solution);
      },

      devGrant: (patch) => set((s) => ({ run: { ...s.run, ...patch, devUsed: true } })),
    }),
    {
      name: 'kql-detective-profile',
      partialize: (s) => ({ profile: s.profile }),
    },
  ),
);

export const evidenceById = (id: string) => EVIDENCE.find((e) => e.id === id);

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

const ROOM_NAMES = ['Customer Office', 'Monitoring Forest', 'Server Caverns', 'Data Center'];

/** Derives "what should I be doing right now" from run state. */
export function currentObjective(solvedIds: string[]): Objective {
  const solvedSet = new Set(solvedIds);
  const next = CHALLENGES.find((c) => !solvedSet.has(c.id));
  const solved = CHALLENGES.filter((c) => solvedSet.has(c.id)).length;

  if (!next) {
    return {
      text: 'All terminals solved — reach the verdict console in the Data Center',
      room: 3,
      finale: true,
      solved,
      total: CHALLENGES.length,
    };
  }
  return {
    text: `Find and solve the KQL terminal in ${ROOM_NAMES[next.room]}`,
    room: next.room,
    challengeId: next.id,
    finale: false,
    solved,
    total: CHALLENGES.length,
  };
}

/** Terminal counts per room, for the progress strip. */
export function roomProgress(solvedIds: string[]): { name: string; solved: number; total: number }[] {
  const solvedSet = new Set(solvedIds);
  return ROOM_NAMES.map((name, i) => {
    const inRoom = CHALLENGES.filter((c) => c.room === i);
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
