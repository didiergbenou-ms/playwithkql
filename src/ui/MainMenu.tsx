import { ACHIEVEMENTS, RANKS, rankFor, useStore } from '../state/store';
import { CASE } from '../data/case001';

export function MainMenu({ onStart, onOptions }: { onStart: () => void; onOptions: () => void }) {
  const profile = useStore((s) => s.profile);
  const resetProfile = useStore((s) => s.resetProfile);
  const rank = rankFor(profile.lifetimeScore);
  const progress = rank.next
    ? Math.min(100, ((profile.lifetimeScore - (RANKS.find((r) => r.name === rank.name)?.min ?? 0)) /
        (rank.next.min - (RANKS.find((r) => r.name === rank.name)?.min ?? 0))) * 100)
    : 100;

  return (
    <div className="screen menu">
      <div className="menu-hero">
        <span className="tag tag-cyan">AZURE INVESTIGATION BUREAU</span>
        <h1>
          KQL <span className="accent">Detective</span>
        </h1>
        <p className="tagline">
          Azure Monitoring Academy — a platformer where the only key that opens a door is a
          correct query.
        </p>

        <div className="menu-case">
          <div>
            <span className="case-no">CASE {CASE.id}</span>
            <h2>{CASE.title}</h2>
            <p>{CASE.summary}</p>
          </div>
          <button className="primary big" onClick={onStart}>
            Open case file
          </button>
        </div>

        <div className="menu-secondary">
          <button className="ghost" onClick={onOptions}>
            Options — music &amp; sound
          </button>
        </div>

        <div className="menu-controls">
          <span>
            <kbd>A</kbd>
            <kbd>D</kbd> move
          </span>
          <span>
            <kbd>Space</kbd> jump
          </span>
          <span>
            <kbd>E</kbd> interact
          </span>
          <span>
            <kbd>R</kbd> respawn
          </span>
        </div>
      </div>

      <aside className="menu-side">
        <section className="panel">
          <h3>Detective file</h3>
          <div className="rank-row">
            <strong>{rank.name}</strong>
            <span>{profile.lifetimeScore.toLocaleString()} pts</span>
          </div>
          <div className="rank-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          {rank.next && (
            <p className="muted">
              {(rank.next.min - profile.lifetimeScore).toLocaleString()} pts to {rank.next.name}
            </p>
          )}
          <dl className="stats">
            <div>
              <dt>Cases closed</dt>
              <dd>{profile.casesClosed}</dd>
            </div>
            <div>
              <dt>Best score</dt>
              <dd>{profile.bestScore}</dd>
            </div>
            <div>
              <dt>Queries run</dt>
              <dd>{profile.totalQueries}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h3>
            Achievements <span className="muted">{profile.achievements.length}/{ACHIEVEMENTS.length}</span>
          </h3>
          <ul className="achievements">
            {ACHIEVEMENTS.map((a) => {
              const got = profile.achievements.includes(a.id);
              return (
                <li key={a.id} className={got ? 'got' : ''}>
                  <strong>{a.name}</strong>
                  <span>{a.description}</span>
                </li>
              );
            })}
          </ul>
          <button className="ghost small" onClick={resetProfile}>
            Reset profile
          </button>
        </section>
      </aside>
    </div>
  );
}
