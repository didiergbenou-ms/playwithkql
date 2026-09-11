import type { CaseDefinition } from '../data/cases/types';

export function Briefing({
  caseDef,
  onBegin,
  onBack,
}: {
  caseDef: CaseDefinition;
  onBegin: () => void;
  onBack: () => void;
}) {
  const finalRoom = caseDef.level.rooms[caseDef.level.rooms.length - 1]?.name ?? 'the final room';

  return (
    <div className="screen briefing">
      <div className="panel case-file">
        <header>
          <span className="tag tag-amber">CASE {caseDef.id} — ACTIVE</span>
          <h1>{caseDef.title}</h1>
          <p className="muted">
            Customer: {caseDef.customer} · Fleet: {caseDef.fleetSize} machines · Severity A
          </p>
        </header>

        {caseDef.placeholderNotice && <p className="case-notice">{caseDef.placeholderNotice}</p>}

        <section className="email">
          <div className="email-head">
            <span>From</span>
            <strong>{caseDef.email.from}</strong>
          </div>
          <div className="email-head">
            <span>Subject</span>
            <strong>{caseDef.email.subject}</strong>
          </div>
          <pre>{caseDef.email.body}</pre>
        </section>

        <section className="objectives">
          <h3>Your assignment</h3>
          <ol>
            <li>Cross {caseDef.title} and reach {finalRoom}.</li>
            <li>
              {caseDef.challenges.length} KQL terminals bar the way. Each one you solve files a
              piece of evidence.
            </li>
            <li>Collect log fragments — they are worth points and they are worth context.</li>
            <li>At the verdict console, name the root cause. Guess wrong and the case stays open.</li>
          </ol>
        </section>

        <section className="skills">
          <h3>What this case teaches</h3>
          <div className="chips">
            {caseDef.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
          <p className="muted">
            {caseDef.challenges.length} terminals, one new idea each. No prior KQL needed — every
            terminal explains itself before it asks you anything.
          </p>
        </section>

        <footer className="brief-actions">
          <button className="ghost" onClick={onBack}>
            Back
          </button>
          <button className="primary big" onClick={onBegin}>
            Begin investigation
          </button>
        </footer>
      </div>
    </div>
  );
}
