import { useCallback, useEffect, useMemo, useState } from 'react';
import { PhaserGame } from './game/PhaserGame';
import { bus } from './game/bus';
import { parseLevel } from './game/levels/heartbeatHills';
import { CHALLENGES, EVIDENCE } from './data/case001';
import {
  challengeXp,
  currentObjective,
  solveTier,
  useStore,
} from './state/store';
import { audio } from './game/audio';
import { trackForRoom } from './game/music';
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

const ROOM_NAMES = ['Customer Office', 'Monitoring Forest', 'Server Caverns', 'Data Center'];

export default function App() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const run = useStore((s) => s.run);
  const startRun = useStore((s) => s.startRun);
  const setHud = useStore((s) => s.setHud);
  const readNote = useStore((s) => s.readNote);
  const registerAttempt = useStore((s) => s.registerAttempt);
  const useHint = useStore((s) => s.useHint);
  const solveChallenge = useStore((s) => s.solveChallenge);
  const spendCrystal = useStore((s) => s.spendCrystal);
  const award = useStore((s) => s.award);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const character = useStore((s) => s.profile.character);

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
  const level = useMemo(() => parseLevel(), []);

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
          room: h.room || 'Customer Office',
        }),
      ),
      bus.on('game:terminal', ({ challengeId }) => setOverlay({ kind: 'terminal', challengeId })),
      // Music follows the room, so the score doubles as orientation.
      bus.on('game:room', ({ index }) => audio.playTrack(trackForRoom(index))),
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
  }, [setHud, readNote]);

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
    if (screen === 'playing') audio.playTrack('office');
    else if (screen === 'debrief') audio.playTrack('closed');
    else audio.playTrack('keep');
  }, [screen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  const solvedIds = CHALLENGES.filter((c) => run.challenges[c.id]?.solved).map((c) => c.id);
  const solvedKey = solvedIds.join(',');

  const pushObjective = useCallback((ids: string[]) => {
    const obj = currentObjective(ids);
    bus.emit('ui:objective', { challengeId: obj.challengeId, finale: obj.finale });
  }, []);

  useEffect(() => {
    if (screen !== 'playing') return;
    pushObjective(solvedKey ? solvedKey.split(',') : []);
  }, [solvedKey, screen, pushObjective]);

  // The scene registers its bus listener during create(), which can land after
  // the effect above has already fired — so re-send once it says it is ready.
  useEffect(() => {
    const off = bus.on('game:ready', () =>
      pushObjective(
        CHALLENGES.filter((c) => useStore.getState().run.challenges[c.id]?.solved).map((c) => c.id),
      ),
    );
    return off;
  }, [pushObjective]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dismissToast(toasts[0].id), 3200);
    return () => clearTimeout(t);
  }, [toasts, dismissToast]);

  const begin = useCallback(() => {
    startRun(level.totalFragments, level.totalCrystals);
    setOverlay(null);
  }, [startRun, level]);

  const activeSpec =
    overlay?.kind === 'terminal'
      ? CHALLENGES.find((c) => c.id === overlay.challengeId)
      : undefined;

  return (
    <div className="app">
      {screen === 'menu' && (
        <MainMenu
          onStart={() => setScreen('select')}
          onOptions={() => setOverlay({ kind: 'options' })}
        />
      )}

      {screen === 'select' && (
        <CharacterSelect onPick={() => setScreen('briefing')} onBack={() => setScreen('menu')} />
      )}

      {screen === 'briefing' && <Briefing onBegin={begin} onBack={() => setScreen('select')} />}

      {screen === 'playing' && (
        <div className="stage">
          <Hud
            onNotebook={() => setOverlay({ kind: 'notebook' })}
            onReference={() => setOverlay({ kind: 'reference' })}
            onOptions={() => setOverlay({ kind: 'options' })}
            onQuit={() => {
              setOverlay(null);
              setScreen('menu');
            }}
          />
          <PhaserGame
            key={`${run.startedAt}-${character}`}
            characterId={character}
            solvedChallenges={Object.entries(run.challenges)
              .filter(([, p]) => p.solved)
              .map(([id]) => id)}
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
        <Debrief onMenu={() => setScreen('menu')} onReplay={begin} />
      )}

      {overlay && (
        <div
          className="scrim"
          onClick={(e) => {
            if (celebration) return;
            if (e.target === e.currentTarget) setOverlay(null);
          }}
        >
          {activeSpec && overlay.kind === 'terminal' && (
            <TerminalModal
              spec={activeSpec}
              alreadySolved={run.challenges[activeSpec.id]?.solved ?? false}
              hintsUsed={run.challenges[activeSpec.id]?.hintsUsed ?? 0}
              crystalsLeft={run.crystals - run.crystalsSpent}
              onAttempt={() => {
                registerAttempt(activeSpec.id);
                award('first-query');
              }}
              onHint={() => useHint(activeSpec.id)}
              onSpendCrystal={() => spendCrystal(activeSpec.id)}
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
                const next = CHALLENGES.find(
                  (c) => c.id !== activeSpec.id && !st.challenges[c.id]?.solved,
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
                        ? prog.hintsUsed === 0
                          ? 'Solved without a single hint.'
                          : 'Got it first try.'
                        : activeSpec.teaches,
                  xp: challengeXp(activeSpec.points, prog),
                  streak:
                    st.cleanStreak >= 2 ? `${st.cleanStreak} clean in a row` : undefined,
                  evidence: activeSpec.evidenceId
                    ? EVIDENCE.find((e) => e.id === activeSpec.evidenceId)?.title
                    : undefined,
                  nextHint: next
                    ? `Gate open — head to ${ROOM_NAMES[next.room]}`
                    : 'All terminals solved — reach the verdict console',
                });
              }}
              onClose={() => setOverlay(null)}
            />
          )}

          {overlay.kind === 'reference' && <ReferenceCard onClose={() => setOverlay(null)} />}

          {overlay.kind === 'options' && <OptionsModal onClose={() => setOverlay(null)} />}

          {overlay.kind === 'note' && (
            <NoteModal noteId={overlay.noteId} onClose={() => setOverlay(null)} />
          )}

          {overlay.kind === 'notebook' && <Notebook onClose={() => setOverlay(null)} />}

          {overlay.kind === 'dev' && (
            <DevPanel
              onClose={() => setOverlay(null)}
              onOpenVerdict={() => setOverlay({ kind: 'verdict' })}
            />
          )}

          {overlay.kind === 'verdict' && (
            <VerdictModal
              onClose={() => setOverlay(null)}
              onResolved={() => {
                setOverlay(null);
                audio.play('caseClosed');
                setScreen('debrief');
              }}
            />
          )}
        </div>
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
