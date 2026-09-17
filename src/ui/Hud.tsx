import type { CaseDefinition } from '../data/cases/types';
import { currentObjective, roomProgress, useStore } from '../state/store';
import { CaseDifficulty } from './CaseDifficulty';

interface Props {
  caseDef: CaseDefinition;
  onNotebook: () => void;
  onReference: () => void;
  onOptions: () => void;
  onPause: () => void;
  pauseDisabled?: boolean;
  onQuit: () => void;
}

export function Hud({ caseDef, onNotebook, onReference, onOptions, onPause, pauseDisabled = false, onQuit }: Props) {
  const run = useStore((s) => s.run);
  const solvedIds = caseDef.challenges
    .filter((challenge) => run.challenges[challenge.id]?.solved)
    .map((challenge) => challenge.id);
  const objective = currentObjective(solvedIds, caseDef.id, run.difficulty);
  const rooms = roomProgress(solvedIds, caseDef.id, run.difficulty);
  const currentRoomIndex = rooms.findIndex((room) => room.name === run.room);
  const crystalsLeft = run.crystals - run.crystalsSpent;
  const notesPocketed = caseDef.level.notes.filter((note) => run.notesRead.includes(note.id)).length;

  return (
    <div className="hud">
      <div className="hud-case">
        <span className="hud-case-no">CASE {caseDef.id}</span>
        <strong>{caseDef.title}</strong>
        <CaseDifficulty caseDef={caseDef} />
        {caseDef.placeholder && <em>Prototype</em>}
      </div>

      {/* where you are: one chip per room, current one lit */}
      <div className="hud-rooms" aria-label="Progress through the level">
        {rooms.map((room, index) => (
          <div
            key={room.name}
            className={[
              'room-chip',
              index === currentRoomIndex ? 'here' : '',
              room.total > 0 && room.solved === room.total ? 'clear' : '',
              index === objective.room ? 'target' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={`${room.name} — ${room.solved}/${room.total} terminals`}
          >
            <span className="room-name">{room.name}</span>
            {room.total > 0 && (
              <span className="room-count">
                {room.solved}/{room.total}
              </span>
            )}
            {index === currentRoomIndex && <span className="room-you">YOU</span>}
          </div>
        ))}
      </div>

      {/* Row 2 spreads across the full width: objective on the left, status in
          the middle, controls hard right. */}
      <div className="hud-bottom">
        <div className="hud-objective">
          <span className="obj-label">OBJECTIVE</span>
          <span className="obj-text">{objective.text}</span>
          <span className="obj-count">
            {objective.solved}/{objective.total}
          </span>
        </div>

        <div className="hud-status">
          <span className="hud-stat" title="Log fragments — worth score">
            <i className="dot cyan" /> {run.fragments}/{run.totalFragments}
          </span>
          <span className="hud-stat" title="Kusto crystals — spend one for a free hint">
            <i className="dot magenta" /> {crystalsLeft} free hint{crystalsLeft === 1 ? '' : 's'}
          </span>
          <span className="hud-health" aria-label={`Health ${run.health} of ${run.maxHealth}`}>
            {Array.from({ length: run.maxHealth }, (_, index) => (
              <i key={index} className={index < run.health ? 'heart on' : 'heart'} />
            ))}
          </span>
        </div>

        <div className="hud-right">
          <button className="ghost small" onClick={onPause} disabled={pauseDisabled} aria-haspopup="dialog">
            Pause (P)
          </button>
          <button className="ghost small" onClick={onOptions}>
            Options (O)
          </button>
          <button className="ghost small" onClick={onReference}>
            KQL card (K)
          </button>
          <button
            className="ghost small"
            onClick={onNotebook}
            title={`${notesPocketed} field notes pocketed; ${run.evidence.length} pieces of query evidence filed`}
          >
            Notes ({notesPocketed}) (Tab)
          </button>
          <button className="abandon-button small" onClick={onQuit}>
            Abandon
          </button>
        </div>
      </div>
    </div>
  );
}
