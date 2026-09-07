import { useState, type ReactNode } from 'react';

/**
 * A show/hide section. Terminals were showing everything at once — full schema
 * for every table, sample rows, hints — which buries the one thing the player
 * is supposed to do. Secondary material lives in here, closed by default.
 */
export function Collapsible({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`collapsible ${open ? 'open' : ''}`}>
      <button className="collapsible-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <i className="collapsible-caret">{open ? '\u25BC' : '\u25B6'}</i>
        <span className="collapsible-title">{title}</span>
        {badge && <span className="collapsible-badge">{badge}</span>}
        <span className="collapsible-toggle">{open ? 'HIDE' : 'SHOW'}</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
