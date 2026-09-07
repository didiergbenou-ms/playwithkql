import { CHALLENGES } from '../data/case001';
import { currentObjective, roomProgress, useStore } from '../state/store';

interface Props {
  onNotebook: () => void;
  onReference: () => void;
  onOptions: () => void;
  onQuit: () => void;
}

export function Hud({ onNotebook, onReference, onOptions, onQuit }: Props) {
  const run = useStore((s) => s.run);
  const solvedIds = CHALLENGES.filter((c) => run.challenges[c.id]?.solved).map((c) => c.id);
  const objective = currentObjective(solvedIds);
  const rooms = roomProgress(solvedIds);
  const currentRoomIndex = rooms.findIndex((r) => r.name === run.room);
  const crystalsLeft = run.crystals - run.crystalsSpent;

  return (
    <div className="hud">
      {/* where you are: one chip per room, current one lit */}
      <div className="hud-rooms" aria-label="Progress through the level">
        {rooms.map((r, i) => (
          <div
            key={r.name}
            className={[
              'room-chip',
              i === currentRoomIndex ? 'here' : '',
              r.total > 0 && r.solved === r.total ? 'clear' : '',
              i === objective.room ? 'target' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={`${r.name} — ${r.solved}/${r.total} terminals`}
          >
            <span className="room-name">{r.name}</span>
            {r.total > 0 && (
              <span className="room-count">
                {r.solved}/{r.total}
              </span>
            )}
            {i === currentRoomIndex && <span className="room-you">YOU</span>}
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
            {Array.from({ length: run.maxHealth }, (_, i) => (
              <i key={i} className={i < run.health ? 'heart on' : 'heart'} />
            ))}
          </span>
        </div>

        <div className="hud-right">
          <button className="ghost small" onClick={onOptions}>
            Options (O)
          </button>
          <button className="ghost small" onClick={onReference}>
            KQL card (K)
          </button>
          <button className="ghost small" onClick={onNotebook}>
            Notes ({run.evidence.length}) (Tab)
          </button>
          <button className="ghost small" onClick={onQuit}>
            Abandon
          </button>
        </div>
      </div>
    </div>
  );
}
