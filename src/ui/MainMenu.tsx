import { useId, useState, type ReactNode } from 'react';
import type { CaseDefinition } from '../data/cases/types';
import { ACHIEVEMENTS, RANKS, rankFor, useStore } from '../state/store';
import { CaseMapThumbnail } from './CaseMapThumbnail';

interface Props {
  cases: CaseDefinition[];
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  onStart: () => void;
  onOptions: () => void;
}

/**
 * Shared menu disclosure: collapsed on phones, ordinary expanded content on
 * desktop. compactMenus.css owns the breakpoint; no viewport-dependent render.
 * className optionally places the disclosure in a screen's compact grid.
 */
export function CompactMenuDetails({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`compact-menu-disclosure ${className}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="ghost compact-menu-disclosure-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(value => !value)}
      >
        <span>{label}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <div id={id} className="compact-menu-disclosure-body">{children}</div>
    </div>
  );
}

export function MainMenu({ cases, selectedCaseId, onSelectCase, onStart, onOptions }: Props) {
  const profile = useStore((s) => s.profile);
  const resetProfile = useStore((s) => s.resetProfile);
  const rank = rankFor(profile.lifetimeScore);
  const selectedCase = cases.find((caseDef) => caseDef.id === selectedCaseId) ?? cases[0];
  const progress = rank.next
    ? Math.min(100, ((profile.lifetimeScore - (RANKS.find((r) => r.name === rank.name)?.min ?? 0)) /
        (rank.next.min - (RANKS.find((r) => r.name === rank.name)?.min ?? 0))) * 100)
    : 100;

  return (
    <div className="screen menu compact-menu">
      <div className="menu-hero">
        <span className="tag tag-cyan">KINGDOM OF SIGNALS</span>
        <h1>
          KQL <span className="accent">Quest</span>
        </h1>
        <p className="tagline">
          Kingdom of Signals — a platformer where the only key that opens a door is a
          correct query.
        </p>

        <div className="menu-case">
          <CompactMenuDetails label="Case details" className="compact-menu-case-details">
          <div>
            <span className="case-no">CASE {selectedCase.id}</span>
            <h2>{selectedCase.title}</h2>
            <p className="compact-menu-phone">{selectedCase.customer}</p>
            <p>{selectedCase.summary}</p>
            {selectedCase.placeholder && (
              <p className="prototype-note">Prototype — reused training tasks</p>
            )}
          </div>
          </CompactMenuDetails>
          <button className="primary big" onClick={onStart}>
            Open case file
          </button>
        </div>

        <div className="case-dossiers" role="group" aria-label="Available case files">
          {cases.map((caseDef) => {
            const selected = caseDef.id === selectedCaseId;
            return (
              <button
                key={caseDef.id}
                type="button"
                className={`case-dossier ${selected ? 'selected' : ''}`}
                onClick={() => onSelectCase(caseDef.id)}
                aria-label={`Select case ${caseDef.id}: ${caseDef.title}`}
                aria-pressed={selected}
              >
                <div className="case-dossier-head">
                  <span className="case-no">CASE {caseDef.id}</span>
                  {caseDef.placeholder && <span className="case-mini-tag">Prototype</span>}
                </div>
                <strong>{caseDef.title}</strong>
                <span className="case-customer">{caseDef.customer}</span>
                <CaseMapThumbnail caseDef={caseDef} />
                <span className="case-summary">{caseDef.summary}</span>
                {caseDef.placeholder && (
                  <span className="prototype-note">Prototype — reused training tasks</span>
                )}
              </button>
            );
          })}
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

      <CompactMenuDetails label="Quest record" className="compact-menu-record">
      <aside className="menu-side">
        <section className="panel">
          <h3>Quest record</h3>
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
      </CompactMenuDetails>
    </div>
  );
}
