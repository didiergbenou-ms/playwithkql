import type { CaseDefinition } from '../data/cases/types';
import { currentObjective, roomProgress, useStore } from '../state/store';
import { CaseDifficulty } from './CaseDifficulty';

interface Props {
  caseDef: CaseDefinition;
  onResume: () => void;
  onRespawn: () => void;
  onNotebook: () => void;
  onReference: () => void;
  onOptions: () => void;
  onQuit: () => void;
}

export function MobilePauseMenu({
  caseDef, onResume, onRespawn, onNotebook, onReference, onOptions, onQuit,
}: Props) {
  const run = useStore((s) => s.run);
  const solved = caseDef.challenges.filter((c) => run.challenges[c.id]?.solved).map((c) => c.id);
  const objective = currentObjective(solved, caseDef.id, run.difficulty);
  const notes = caseDef.level.notes.filter((note) => run.notesRead.includes(note.id)).length;
  return (
    <div className="modal mobile-pause-menu">
      <header className="mobile-pause-heading">
        <h2>Game paused</h2>
        <span>{caseDef.title}</span>
      </header>
      <p className="mobile-pause-objective">{objective.text}</p>
      <div className="mobile-pause-stats">
        <span>{run.fragments}/{run.totalFragments} fragments</span>
        <span>{run.crystals - run.crystalsSpent} free hints</span>
        <span>{objective.solved}/{objective.total} terminals</span>
      </div>
      <nav className="mobile-pause-actions" aria-label="Paused game actions">
        <button className="primary" onClick={onResume}>Resume game</button>
        <button className="ghost" onClick={onRespawn}>Return to checkpoint</button>
        <button className="ghost" onClick={onNotebook}>Notes ({notes})</button>
        <button className="ghost" onClick={onReference}>KQL card</button>
        <button className="ghost" onClick={onOptions} aria-label="Options (O)">Options</button>
        <button className="abandon-button" onClick={onQuit}>Abandon</button>
      </nav>
      <details className="mobile-mission-details">
        <summary>Mission progress</summary>
        <CaseDifficulty caseDef={caseDef} notice />
        <ol>
          {roomProgress(solved, caseDef.id, run.difficulty).map((room) => (
            <li key={room.name} aria-current={room.name === run.room ? 'step' : undefined}>
              {room.name} <span>{room.solved}/{room.total}</span>
            </li>
          ))}
        </ol>
        <p>The case timer is paused here. Reading notes or a terminal still counts toward case time.</p>
      </details>
    </div>
  );
}
