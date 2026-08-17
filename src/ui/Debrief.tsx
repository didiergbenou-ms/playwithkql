import { CAUSAL_CHAIN, CHALLENGES, CULPRIT, PROXY_HOST } from '../data/case001';
import { formatKql } from '../kql/format';
import { ACHIEVEMENTS, rankFor, scoreRun, useStore } from '../state/store';

export function Debrief({ onMenu, onReplay }: { onMenu: () => void; onReplay: () => void }) {
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
        <span className="tag tag-cyan">CASE 001 — CLOSED</span>
        {run.devUsed && (
          <p className="dev-warn">
            Dev shortcuts were used on this run. The score below is not a real result and nothing
            was written to your profile.
          </p>
        )}
        <h1>Proxy misconfiguration</h1>
        <p className="lede">
          The five machines never stopped running. At 09:02Z an agent proxy setting was pushed to{' '}
          <code>rg-contoso-prod</code>, pointing every agent at{' '}
          <code>http://{PROXY_HOST}</code> — plain HTTP, with a bypass list covering{' '}
          <code>*.contoso.local</code> and nothing else. No Azure Monitor endpoint was exempt, so
          TLS died at the proxy and the agents went silent at 09:15Z while still logging the failure
          locally, which is exactly what you found.
        </p>

        <p className="muted">
          The change was made by <code>{CULPRIT}</code>. Proving that from the activity log needs{' '}
          <code>parse_json</code> to read the change payload — that is Case 002.
        </p>

        <ol className="chain-list big">
          {CAUSAL_CHAIN.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>

        <section>
          <h3>Your queries</h3>
          <ul className="own-queries">
            {CHALLENGES.map((c) => {
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
            Bureau HQ
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
          {CHALLENGES.map((c) => (
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
