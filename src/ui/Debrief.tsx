import type { CaseDefinition } from '../data/cases/types';
import { formatKql } from '../kql/format';
import { ACHIEVEMENTS, rankFor, scoreRun, useStore } from '../state/store';

export function Debrief({
  caseDef,
  onMenu,
  onReplay,
}: {
  caseDef: CaseDefinition;
  onMenu: () => void;
  onReplay: () => void;
}) {
  const run = useStore((s) => s.run);
  const profile = useStore((s) => s.profile);
  const score = scoreRun(run);
  const rank = rankFor(profile.lifetimeScore);
  const minutes = Math.max(0, ((run.finishedAt ?? Date.now()) - run.startedAt) / 60_000);

  const lines: { label: string; value: number; max: number }[] = [
    { label: 'Case completion', value: score.completion, max: 500 },
    { label: 'KQL accuracy', value: score.accuracy, max: 300 },
    { label: 'Clues found', value: score.clues, max: 100 },
    { label: 'Time bonus', value: score.time, max: 100 },
  ];

  return (
    <div className="screen debrief">
      <div className="panel debrief-main">
        <span className="tag tag-cyan">CASE {caseDef.id} — CLOSED</span>
        {run.devUsed && (
          <p className="dev-warn">
            Dev shortcuts were used on this run. The score below is not a real result and nothing
            was written to your profile.
          </p>
        )}
        <h1>{caseDef.debrief.title}</h1>
        {caseDef.placeholderNotice && <p className="case-notice">{caseDef.placeholderNotice}</p>}
        <p className="lede">{caseDef.debrief.body}</p>
        <p className="muted">{caseDef.debrief.followUp}</p>

        <ol className="chain-list big">
          {caseDef.causalChain.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>

        <section>
          <h3>Your queries</h3>
          <ul className="own-queries">
            {caseDef.challenges.map((c) => {
              const p = run.challenges[c.id];
              return (
                <li key={c.id} className={p?.solved ? 'got' : ''}>
                  <span className="oq-head">
                    {c.concept.title}
                    {p?.hintsUsed ? <em>{p.hintsUsed} hint{p.hintsUsed > 1 ? 's' : ''}</em> : null}
                  </span>
                  <code>{p?.winningQuery ? formatKql(p.winningQuery) : 'not solved'}</code>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h3>Score</h3>
          {lines.map((l) => (
            <div key={l.label} className="score-line">
              <span>{l.label}</span>
              <div className="score-bar">
                <i style={{ width: `${(l.value / l.max) * 100}%` }} />
              </div>
              <strong>
                {l.value}/{l.max}
              </strong>
            </div>
          ))}
          <div className="score-total">
            <span>Total</span>
            <strong>{score.total} / 1000</strong>
          </div>
          <p className="muted">
            {minutes.toFixed(1)} minutes · {run.queriesRun} queries · {run.deaths} respawns ·{' '}
            {run.fragments}/{run.totalFragments} fragments
          </p>
        </section>

        <footer className="brief-actions">
          <button className="ghost" onClick={onMenu}>
            Kingdom HQ
          </button>
          <button className="primary big" onClick={onReplay}>
            Replay case
          </button>
        </footer>
      </div>

      <aside className="panel debrief-side">
        <h3>Rank</h3>
        <p className="rank-name">{rank.name}</p>
        <p className="muted">{profile.lifetimeScore.toLocaleString()} lifetime points</p>

        <h3>What you actually learned</h3>
        <ul className="learned">
          {caseDef.challenges.map((c) => (
            <li key={c.id} className={run.challenges[c.id]?.solved ? 'got' : ''}>
              <code>{c.requiredOperators?.join(' · ') ?? 'kql'}</code>
              <span>{c.teaches}</span>
            </li>
          ))}
        </ul>

        <h3>Unlocked this run</h3>
        <ul className="achievements">
          {ACHIEVEMENTS.filter((a) => profile.achievements.includes(a.id)).map((a) => (
            <li key={a.id} className="got">
              <strong>{a.name}</strong>
              <span>{a.description}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
