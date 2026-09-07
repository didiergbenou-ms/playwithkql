import { CASE, CUSTOMER_EMAIL, MACHINES } from '../data/case001';

export function Briefing({ onBegin, onBack }: { onBegin: () => void; onBack: () => void }) {
  return (
    <div className="screen briefing">
      <div className="panel case-file">
        <header>
          <span className="tag tag-amber">CASE {CASE.id} — ACTIVE</span>
          <h1>{CASE.title}</h1>
          <p className="muted">
            Customer: {CASE.customer} · Fleet: {MACHINES.length} machines · Severity A
          </p>
        </header>

        <section className="email">
          <div className="email-head">
            <span>From</span>
            <strong>{CUSTOMER_EMAIL.from}</strong>
          </div>
          <div className="email-head">
            <span>Subject</span>
            <strong>{CUSTOMER_EMAIL.subject}</strong>
          </div>
          <pre>{CUSTOMER_EMAIL.body}</pre>
        </section>

        <section className="objectives">
          <h3>Your assignment</h3>
          <ol>
            <li>Cross Heartbeat Hills and reach the Data Center.</li>
            <li>Five KQL terminals bar the way. Each one you solve files a piece of evidence.</li>
            <li>Collect log fragments — they are worth points and they are worth context.</li>
            <li>At the verdict console, name the root cause. Guess wrong and the case stays open.</li>
          </ol>
        </section>

        <section className="skills">
          <h3>What this case teaches</h3>
          <div className="chips">
            <span>take</span>
            <span>distinct</span>
            <span>where</span>
            <span>ago()</span>
            <span>summarize … by</span>
            <span>max()</span>
          </div>
          <p className="muted">
            Five terminals, one new idea each. No prior KQL needed — every terminal explains itself
            before it asks you anything.
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
