import { CHALLENGES, ROOT_CAUSES } from '../data/case001';
import { ROOMS } from '../game/levels/heartbeatHills';
import { bus } from '../game/bus';
import { useStore } from '../state/store';
import { disableDev } from '../dev/secret';

interface Props {
  onClose: () => void;
  onOpenVerdict: () => void;
}

/**
 * Dev-only shortcut panel. Reachable solely once the passphrase has unlocked
 * dev mode, so it never appears for a player on the public build.
 */
export function DevPanel({ onClose, onOpenVerdict }: Props) {
  const run = useStore((s) => s.run);
  const devSolve = useStore((s) => s.devSolve);
  const devTaint = useStore((s) => s.devTaint);
  const devGrant = useStore((s) => s.devGrant);
  const submitVerdict = useStore((s) => s.submitVerdict);
  const setScreen = useStore((s) => s.setScreen);
  const pushToast = useStore((s) => s.pushToast);

  const solved = CHALLENGES.filter((c) => run.challenges[c.id]?.solved).length;
  const correct = ROOT_CAUSES.find((o) => o.correct);

  /**
   * The store deliberately does not know about the game bus, so the gate
   * animation is driven from here — same as the real solve path in App.
   */
  const solveSome = (which: 'next' | 'all') => {
    const pending = CHALLENGES.filter((c) => !run.challenges[c.id]?.solved);
    const target = which === 'all' ? pending : pending.slice(0, 1);
    devSolve(which);
    for (const c of target) {
      if (c.unlocksGate) bus.emit('ui:openGate', { gateId: c.unlocksGate, challengeId: c.id });
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
    pushToast(`Warped to ${ROOMS[index]?.name ?? `room ${index}`}`);
    onClose();
  };

  return (
    <div className="modal dev-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-magenta">DEV</span>
          <h2>Shortcuts</h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Esc
        </button>
      </header>

      <p className="dev-warn">
        Anything you touch here flags the run, so it will not write to your profile, score or
        achievements. Use a clean run for real numbers.
      </p>

      <h3>Terminals ({solved}/{CHALLENGES.length} solved)</h3>
      <div className="dev-row">
        <button
          className="ghost small"
          onClick={() => solveSome('next')}
          disabled={solved >= CHALLENGES.length}
        >
          Solve next
        </button>
        <button
          className="ghost small"
          onClick={() => solveSome('all')}
          disabled={solved >= CHALLENGES.length}
        >
          Solve all + open gates
        </button>
      </div>

      <h3>Warp</h3>
      <div className="dev-row">
        {ROOMS.map((r, i) => (
          <button key={r.name} className="ghost small" onClick={() => jump(i)}>
            {i + 1}. {r.name}
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
