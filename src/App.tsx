import { useCallback, useEffect, useMemo, useState } from 'react';
import { PhaserGame } from './game/PhaserGame';
import { bus } from './game/bus';
import { parseLevel } from './game/levels/heartbeatHills';
import {
  challengeXp,
  solveTier,
  useStore,
  hintsSeen,
  hintsRevealed,
  currentObjective,
} from './state/store';
import { audio } from './game/audio';
import { Celebration, type CelebrationData } from './ui/Celebration';
import { MainMenu } from './ui/MainMenu';
import { CharacterSelect } from './ui/CharacterSelect';
import { Briefing } from './ui/Briefing';
import { Hud } from './ui/Hud';
import { TerminalModal } from './ui/TerminalModal';
import { NoteModal, Notebook } from './ui/Notes';
import { ReferenceCard } from './ui/ReferenceCard';
import { OptionsModal } from './ui/OptionsModal';
import { VerdictModal } from './ui/VerdictModal';
import { Debrief } from './ui/Debrief';
import { DevPanel } from './ui/DevPanel';
import { ModalScrim } from './ui/ModalScrim';
import { CASES, getCase } from './data/cases';
import { devActive, initDevMode, onDevChange } from './dev/secret';

type Overlay =
  | { kind: 'terminal'; challengeId: string }
  | { kind: 'note'; noteId: string }
  | { kind: 'verdict' }
  | { kind: 'notebook' }
  | { kind: 'reference' }
  | { kind: 'options' }
  | { kind: 'dev' }
  | null;

/** Accessible names for each overlay, announced when the dialog opens. */
const OVERLAY_LABELS: Record<NonNullable<Overlay>['kind'], string> = {
  terminal: 'KQL terminal',
  note: 'Field note',
  verdict: 'Verdict console',
  notebook: 'Notebook',
  reference: 'KQL reference card',
  options: 'Options',
  dev: 'Developer shortcuts',
};

export default function App() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const run = useStore((s) => s.run);
  const startRun = useStore((s) => s.startRun);
  const setHud = useStore((s) => s.setHud);
  const readNote = useStore((s) => s.readNote);
  const registerAttempt = useStore((s) => s.registerAttempt);
  const useHint = useStore((s) => s.useHint);
  const revealSolution = useStore((s) => s.revealSolution);
  const solveChallenge = useStore((s) => s.solveChallenge);
  const spendCrystal = useStore((s) => s.spendCrystal);
  const award = useStore((s) => s.award);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const character = useStore((s) => s.profile.character);
  const selectedCaseId = useStore((s) => s.selectedCaseId);
  const selectCaseFromStore = useStore((s) => s.selectCase);

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [dev, setDev] = useState(devActive());

  useEffect(() => {
    const teardown = initDevMode();
    const off = onDevChange(setDev);
    setDev(devActive());
    return () => {
      teardown();
      off();
    };
  }, []);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);

  const selectedCaseDef = getCase(selectedCaseId);
  const runCaseDef = getCase(run.caseId);
  const selectedLevel = useMemo(() => parseLevel(selectedCaseDef.level), [selectedCaseDef]);

  // Unlock audio on the first real gesture — browsers keep the context
  // suspended until then.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // --- game -> ui ----------------------------------------------------------
  useEffect(() => {
    const offs = [
      bus.on('game:hud', (h) =>
        setHud({
          fragments: h.fragments,
          crystals: h.crystals,
          health: h.health,
          maxHealth: h.maxHealth,
          room: h.room || runCaseDef.level.rooms[0].name,
        }),
      ),
      bus.on('game:terminal', ({ challengeId }) => setOverlay({ kind: 'terminal', challengeId })),
      // Music follows the room, so the score doubles as orientation.
      bus.on('game:room', ({ index }) =>
        audio.playTrack(runCaseDef.musicTracks[index] ?? runCaseDef.musicTracks[0] ?? 'office'),
      ),
      bus.on('game:note', ({ noteId }) => {
        readNote(noteId);
        setOverlay({ kind: 'note', noteId });
      }),
      bus.on('game:verdict', () => setOverlay({ kind: 'verdict' })),
      bus.on('game:pickup', ({ kind }) => audio.play(kind === 'crystal' ? 'crystal' : 'pickup')),
      bus.on('game:damage', () => audio.play('hurt')),
      bus.on('game:death', () => setHud({ deaths: useStore.getState().run.deaths + 1 })),
    ];
    return () => offs.forEach((off) => off());
  }, [setHud, readNote, runCaseDef]);

  // --- ui -> game (pause while any overlay is up) --------------------------
  useEffect(() => {
    if (screen !== 'playing') return;
    bus.emit('ui:setPaused', { paused: overlay !== null });
  }, [overlay, screen]);

  // Duck the music while a modal has the player's attention, then fade it out
  // entirely if they are still there. Reading and typing for minutes is exactly
  // when a looping background track starts to grate.
  useEffect(() => {
    audio.setDucked(overlay !== null);
    if (!overlay) {
      audio.setFocusMode(false);
      return;
    }
    const t = setTimeout(() => audio.setFocusMode(true), 25_000);
    return () => clearTimeout(t);
  }, [overlay]);

  // One track per phase of the game. In-game the room drives it instead
  // (see the game:room listener), so this only seeds the starting room.
  useEffect(() => {
    if (screen === 'playing') audio.playTrack(runCaseDef.musicTracks[0] ?? 'office');
    else if (screen === 'debrief') audio.playTrack('closed');
    else audio.playTrack('keep');
  }, [screen, runCaseDef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A child control may legitimately consume a key — the completion popup
      // calls preventDefault() on Escape to close itself. Without this check
      // that same Escape also tore down the whole terminal, so dismissing the
      // suggestions threw away the query with them.
      if (e.defaultPrevented) return;

      // While a celebration is on screen, Escape only dismisses that — closing
      // the terminal too would whip the result away before it can be read.
      if (e.key === 'Escape' && overlay && !celebration) setOverlay(null);

      // Dev panel is reachable from anywhere, including with an overlay open,
      // so you can warp out of a terminal you opened by mistake.
      if (dev && e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setOverlay((o) => (o?.kind === 'dev' ? null : { kind: 'dev' }));
        return;
      }

      if (screen !== 'playing' || overlay) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        setOverlay({ kind: 'notebook' });
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setOverlay({ kind: 'reference' });
      }
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        setOverlay({ kind: 'options' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, screen, celebration, dev]);

  /** Keep the in-world waypoint pointed at whatever the player should do next. */
  const solvedIds = runCaseDef.challenges
    .filter((challenge) => run.challenges[challenge.id]?.solved)
    .map((challenge) => challenge.id);
  const solvedKey = solvedIds.join(',');

  const pushObjective = useCallback((ids: string[]) => {
    const obj = currentObjective(ids, runCaseDef.id);
    bus.emit('ui:objective', { challengeId: obj.challengeId, finale: obj.finale });
  }, [runCaseDef]);

  useEffect(() => {
    if (screen !== 'playing') return;
    pushObjective(solvedKey ? solvedKey.split(',') : []);
  }, [solvedKey, screen, pushObjective]);

  // The scene registers its bus listener during create(), which can land after
  // the effect above has already fired — so re-send once it says it is ready.
  useEffect(() => {
    const off = bus.on('game:ready', () =>
      pushObjective(
        runCaseDef.challenges
          .filter((challenge) => useStore.getState().run.challenges[challenge.id]?.solved)
          .map((challenge) => challenge.id),
      ),
    );
    return off;
  }, [pushObjective, runCaseDef]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dismissToast(toasts[0].id), 3200);
    return () => clearTimeout(t);
  }, [toasts, dismissToast]);

  const begin = useCallback(() => {
    startRun(selectedLevel.totalFragments, selectedLevel.totalCrystals, selectedCaseDef.id);
    setOverlay(null);
    setCelebration(null);
  }, [startRun, selectedCaseDef, selectedLevel]);

  const selectCase = useCallback(
    (caseId: string) => {
      selectCaseFromStore(caseId);
      setOverlay(null);
      setCelebration(null);
    },
    [selectCaseFromStore],
  );

  const activeSpec =
    overlay?.kind === 'terminal'
      ? runCaseDef.challenges.find((challenge) => challenge.id === overlay.challengeId)
      : undefined;

  return (
    <div className="app">
      {screen === 'menu' && (
        <MainMenu
          cases={CASES}
          selectedCaseId={selectedCaseId}
          onSelectCase={selectCase}
          onStart={() => setScreen('select')}
          onOptions={() => setOverlay({ kind: 'options' })}
        />
      )}

      {screen === 'select' && (
        <CharacterSelect
          caseTitle={selectedCaseDef.title}
          onPick={() => setScreen('briefing')}
          onBack={() => setScreen('menu')}
        />
      )}

      {screen === 'briefing' && (
        <Briefing caseDef={selectedCaseDef} onBegin={begin} onBack={() => setScreen('select')} />
      )}

      {screen === 'playing' && (
        <div className="stage">
          <Hud
            caseDef={runCaseDef}
            onNotebook={() => setOverlay({ kind: 'notebook' })}
            onReference={() => setOverlay({ kind: 'reference' })}
            onOptions={() => setOverlay({ kind: 'options' })}
            onQuit={() => {
              setOverlay(null);
              setCelebration(null);
              setScreen('menu');
            }}
          />
          <PhaserGame
            key={`${run.runId}-${runCaseDef.id}-${character}`}
            characterId={character}
            caseId={runCaseDef.id}
            solvedChallenges={solvedIds}
            openGates={run.openGates}
          />
          <p className="stage-hint">
            <kbd>A</kbd>/<kbd>D</kbd> move · <kbd>Space</kbd> jump · <kbd>E</kbd> interact ·{' '}
            <kbd>Tab</kbd> notes · <kbd>K</kbd> KQL card · <kbd>R</kbd> respawn
          </p>
        </div>
      )}

      {dev && (
        <button className="dev-chip" onClick={() => setOverlay({ kind: 'dev' })}>
          DEV · Ctrl+Shift+D
        </button>
      )}

      {screen === 'debrief' && (
        <Debrief caseDef={runCaseDef} onMenu={() => setScreen('menu')} onReplay={begin} />
      )}

      {overlay && (
        <ModalScrim
          label={OVERLAY_LABELS[overlay.kind]}
          // A celebration sits on top of the terminal; dismissing the terminal
          // underneath it would whip the result away before it can be read.
          onDismiss={celebration ? undefined : () => setOverlay(null)}
        >
          {activeSpec && overlay.kind === 'terminal' && (
            <TerminalModal
              key={`${runCaseDef.id}-${activeSpec.id}`}
              caseDef={runCaseDef}
              spec={activeSpec}
              alreadySolved={run.challenges[activeSpec.id]?.solved ?? false}
              hintsUsed={hintsRevealed(run.challenges[activeSpec.id])}
              crystalsLeft={run.crystals - run.crystalsSpent}
              onAttempt={() => {
                registerAttempt(activeSpec.id);
                award('first-query');
              }}
              onHint={() => useHint(activeSpec.id)}
              onSpendCrystal={() => spendCrystal(activeSpec.id)}
              solutionRevealed={run.challenges[activeSpec.id]?.solutionRevealed ?? false}
              onRevealSolution={() => {
                // Only records the reveal. It must NOT also call useHint():
                // that inflated the displayed hint count, so reopening the
                // terminal exposed hints the player never unlocked. The score
                // penalty is applied by scoreRun via solutionRevealed.
                revealSolution(activeSpec.id);
              }}
              onSolved={(q) => {
                solveChallenge(activeSpec.id, q);
                if (activeSpec.unlocksGate) {
                  bus.emit('ui:openGate', {
                    gateId: activeSpec.unlocksGate,
                    challengeId: activeSpec.id,
                  });
                }
                // read state back after the store has applied the solve
                const st = useStore.getState().run;
                const prog = st.challenges[activeSpec.id];
                const tier = solveTier(prog);
                const next = runCaseDef.challenges.find(
                  (challenge) => challenge.id !== activeSpec.id && !st.challenges[challenge.id]?.solved,
                );
                // Deliberately do NOT close the terminal here. The player needs
                // to see the table their correct query returned — that result
                // *is* the evidence. The celebration floats over the modal and
                // dismisses back to it.
                setCelebration({
                  tier,
                  skill: activeSpec.concept.title,
                  detail:
                    tier === 3
                      ? 'First attempt, no hints. You reached for the right operator straight away.'
                      : tier === 2
                        ? hintsSeen(prog) === 0
                          ? 'Solved without a single hint.'
                          : 'Got it first try.'
                        : activeSpec.teaches,
                  xp: challengeXp(activeSpec.points, prog),
                  streak:
                    st.cleanStreak >= 2 ? `${st.cleanStreak} clean in a row` : undefined,
                  evidence: activeSpec.evidenceId
                    ? runCaseDef.evidence.find((evidence) => evidence.id === activeSpec.evidenceId)?.title
                    : undefined,
                  nextHint: next
                    ? `Gate open — head to ${runCaseDef.level.rooms[next.room].name}`
                    : 'All terminals solved — reach the verdict console',
                });
              }}
              onClose={() => setOverlay(null)}
            />
          )}

          {overlay.kind === 'reference' && <ReferenceCard onClose={() => setOverlay(null)} />}

          {overlay.kind === 'options' && <OptionsModal onClose={() => setOverlay(null)} />}

          {overlay.kind === 'note' && (
            <NoteModal caseDef={runCaseDef} noteId={overlay.noteId} onClose={() => setOverlay(null)} />
          )}

          {overlay.kind === 'notebook' && <Notebook caseDef={runCaseDef} onClose={() => setOverlay(null)} />}

          {overlay.kind === 'dev' && (
            <DevPanel
              caseDef={screen === 'playing' ? runCaseDef : selectedCaseDef}
              onClose={() => setOverlay(null)}
              onOpenVerdict={() => setOverlay({ kind: 'verdict' })}
            />
          )}

          {overlay.kind === 'verdict' && (
            <VerdictModal
              caseDef={runCaseDef}
              onClose={() => setOverlay(null)}
              onResolved={() => {
                setOverlay(null);
                audio.play('caseClosed');
                setScreen('debrief');
              }}
            />
          )}
        </ModalScrim>
      )}

      {celebration && (
        <Celebration data={celebration} onDone={() => setCelebration(null)} />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
