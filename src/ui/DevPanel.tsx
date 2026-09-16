import type { CaseDefinition } from '../data/cases/types';
import { bus } from '../game/bus';
import { useStore } from '../state/store';
import { disableDev } from '../dev/secret';
import { CaseDifficulty } from './CaseDifficulty';

interface Props {
  caseDef: CaseDefinition;
  onClose: () => void;
  onOpenVerdict: () => void;
}

/**
 * Dev-only shortcut panel. Reachable solely once the passphrase has unlocked
 * dev mode, so it never appears for a player on the public build.
 */
export function DevPanel({ caseDef, onClose, onOpenVerdict }: Props) {
  const run = useStore((s) => s.run);
  const devSolve = useStore((s) => s.devSolve);
  const devTaint = useStore((s) => s.devTaint);
  const devGrant = useStore((s) => s.devGrant);
  const submitVerdict = useStore((s) => s.submitVerdict);
  const setScreen = useStore((s) => s.setScreen);
  const pushToast = useStore((s) => s.pushToast);

  const solved = caseDef.challenges.filter((challenge) => run.challenges[challenge.id]?.solved).length;
  const correct = caseDef.rootCauses.find((option) => option.correct);

  /**
   * The store deliberately does not know about the game bus, so the gate
   * animation is driven from here — same as the real solve path in App.
   */
  const solveSome = (which: 'next' | 'all') => {
    const pending = caseDef.challenges.filter((challenge) => !run.challenges[challenge.id]?.solved);
    const target = which === 'all' ? pending : pending.slice(0, 1);
    devSolve(which);
    for (const challenge of target) {
      if (challenge.unlocksGate) {
        bus.emit('ui:openGate', { gateId: challenge.unlocksGate, challengeId: challenge.id });
      }
    }
  };

  const finishCase = () => {
    // Flag explicitly: on an already-complete run solveSome() has nothing to
    // solve, and this is still a dev-assisted completion.
    devTaint();
    solveSome('all');
    if (correct) submitVerdict(correct.id, true);
    setScreen('debrief');
    onClose();
  };

  const jump = (index: number) => {
    // Warping skips traversal and shortens the run, which flatters the time
    // score — so it is dev assistance like any other and has to flag the run.
    devTaint();
    bus.emit('ui:teleport', { roomIndex: index });
    pushToast(`Warped to ${caseDef.level.rooms[index]?.name ?? `room ${index}`}`);
    onClose();
  };

  return (
    <div className="modal dev-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-magenta">DEV</span>
          <h2>{caseDef.title} shortcuts</h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Esc
        </button>
      </header>

      <CaseDifficulty caseDef={caseDef} />
      {caseDef.placeholderNotice && <p className="case-notice compact">{caseDef.placeholderNotice}</p>}

      <p className="dev-warn">
        Anything you touch here flags the run, so it will not write to your profile, score or
        achievements. Use a clean run for real numbers.
      </p>

      <h3>Terminals ({solved}/{caseDef.challenges.length} solved)</h3>
      <div className="dev-row">
        <button
          className="ghost small"
          onClick={() => solveSome('next')}
          disabled={solved >= caseDef.challenges.length}
        >
          Solve next
        </button>
        <button
          className="ghost small"
          onClick={() => solveSome('all')}
          disabled={solved >= caseDef.challenges.length}
        >
          Solve all + open gates
        </button>
      </div>

      <h3>Warp</h3>
      <div className="dev-row">
        {caseDef.level.rooms.map((room, i) => (
          <button key={room.name} className="ghost small" onClick={() => jump(i)}>
            {i + 1}. {room.name}
          </button>
        ))}
      </div>

      <h3>Jump to the end</h3>
      <div className="dev-row">
        <button
          className="ghost small"
          onClick={() => {
            solveSome('all');
            onOpenVerdict();
          }}
        >
          Verdict console
        </button>
        <button className="primary small" onClick={finishCase}>
          Finish case → debrief
        </button>
      </div>

      <h3>Resources</h3>
      <div className="dev-row">
        <button
          className="ghost small"
          onClick={() => devGrant({ crystals: run.crystals + 5, health: run.maxHealth })}
        >
          +5 crystals, full health
        </button>
      </div>

      <footer className="modal-foot">
        <span className="muted">
          {run.devUsed ? 'This run is flagged as dev.' : 'Run is still clean.'}
        </span>
        <button
          className="ghost small"
          onClick={() => {
            disableDev();
            onClose();
          }}
        >
          Turn dev mode off
        </button>
      </footer>
    </div>
  );
}
