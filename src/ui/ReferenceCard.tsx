import { REFERENCE } from '../state/store';

const CURRICULUM_REFERENCE = [
  {
    group: 'Finding and shaping evidence',
    entries: [
      { syntax: 'search "term"', what: 'Search the local case tables; $table identifies each matching row\'s source.', example: 'search "MTU_MISMATCH"' },
      { syntax: 'project-away Column', what: 'Remove named columns; this is the opposite of project-keep.', example: 'Perf | project-away InstanceName' },
      { syntax: 'project-rename New = Old', what: 'Rename a column without discarding the others.', example: 'Perf | project-rename Value = CounterValue' },
      { syntax: 'where X between (low .. high)', what: 'Include both bounds of a numeric or datetime range.', example: 'Heartbeat | where TimeGenerated between (datetime(2026-03-11 09:00:00) .. datetime(2026-03-11 09:20:00))' },
    ],
  },
  {
    group: 'Timeline and calculated results',
    entries: [
      { syntax: 'render timechart / render columnchart', what: 'Draw actual result rows; keep render last. Aggregate before plotting.', example: 'Heartbeat | summarize Beats = count() by bin(TimeGenerated, 1h) | render timechart' },
      { syntax: 'case(condition, value, ..., otherwise)', what: 'Choose the first matching condition, otherwise the final value.', example: 'Perf | extend Load = case(CounterValue > 90, "High", "Normal")' },
      { syntax: 'datetime_diff("unit", later, earlier)', what: 'Compute the supported time-unit difference. The case clock stays fixed.', example: 'Heartbeat | extend AgeMinutes = datetime_diff("minute", now(), TimeGenerated)' },
    ],
  },
];

/** Always-available syntax card, so nobody has to burn a hint on "what was the syntax again?". */
export function ReferenceCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal reference-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-cyan">FIELD CARD</span>
          <h2>KQL quick reference</h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Close (Esc)
        </button>
      </header>

      <p className="muted pad-b">
        Free to open, any time. Looking something up costs you nothing — only hints do.
      </p>

      <div className="ref-grid">
        {[...REFERENCE, ...CURRICULUM_REFERENCE].map((g) => (
          <section key={g.group} className="ref-group">
            <h3>{g.group}</h3>
            <ul>
              {g.entries.map((e) => (
                <li key={e.syntax}>
                  <code className="ref-syntax">{e.syntax}</code>
                  <span className="ref-what">{e.what}</span>
                  <code className="ref-example">{e.example}</code>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
