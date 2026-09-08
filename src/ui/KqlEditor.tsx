import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  applyCompletion,
  completionsFor,
  type Completion,
} from '../kql/complete';
import { buildHighlightSchema, highlightKql } from '../kql/highlight';
import { formatKql, pipeNeedsNewline } from '../kql/format';
import type { TableMeta } from '../data/case001';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  meta: TableMeta[];
  autoFocus?: boolean;
}

const KIND_GLYPH: Record<Completion['kind'], string> = {
  table: '\u25A6', // ▦
  operator: '\u25B8', // ▸
  column: '\u25C6', // ◆
  function: '\u0192', // ƒ
  aggregate: '\u03A3', // Σ
  keyword: '\u25AB', // ▫
};

/**
 * After a space, only pop up where an operand is actually expected —
 * following a pipe, an operator that takes arguments, a comparison, or a
 * comma. Opening on every space would be noise.
 */
/** Stable id so aria-controls and aria-activedescendant can point at it. */
const LISTBOX_ID = 'kql-suggestions';

const OPEN_AFTER_SPACE =
  /(\||\bwhere\b|\bsummarize\b|\bby\b|\bproject\b|\bextend\b|\bdistinct\b|\bsort\b|\border\b|\btop\b|\band\b|\bor\b|[=<>!+\-*/,(])\s*$/i;

/**
 * A small code editor: a transparent textarea sitting exactly on top of a
 * syntax-highlighted <pre>, plus a context-aware completion popup.
 *
 * Deliberately not Monaco — Monaco is several megabytes and brings VS Code
 * chrome that fights the 8-bit styling. This is ~200 lines and does the one
 * job the game needs.
 */
export function KqlEditor({ value, onChange, onRun, meta, autoFocus }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [popupPos, setPopupPos] = useState({ left: 0, top: 0 });
  /**
   * Caret to restore after a programmatic edit. Applied in useLayoutEffect,
   * NOT requestAnimationFrame: rAF fires after the browser may already have
   * processed further keystrokes, which corrupted the text (typing a space
   * right after accepting a completion used to be swallowed).
   */
  const pendingCaret = useRef<number | null>(null);

  const schema = useMemo(() => buildHighlightSchema(meta), [meta]);
  const html = useMemo(() => highlightKql(value, schema), [value, schema]);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  const suggestions = useMemo(
    () => (open ? completionsFor(value, caret, meta) : null),
    [open, value, caret, meta],
  );
  const items = suggestions?.items ?? [];

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    setActive(0);
  }, [items.length, suggestions?.prefix]);

  /** Places the popup under the caret using a mirror measurement. */
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || !open) return;
    const upto = value.slice(0, caret);
    const lines = upto.split('\n');
    const row = lines.length - 1;
    const col = lines[lines.length - 1].length;
    const style = getComputedStyle(ta);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const charWidth = measureChar(style.font);
    setPopupPos({
      left: Math.min(col * charWidth, ta.clientWidth - 220),
      top: (row + 1) * lineHeight + 6 - ta.scrollTop,
    });
  }, [open, caret, value]);

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  const update = (text: string, nextCaret: number) => {
    pendingCaret.current = nextCaret;
    onChange(text);
  };

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || pendingCaret.current === null) return;
    const c = pendingCaret.current;
    pendingCaret.current = null;
    ta.selectionStart = ta.selectionEnd = c;
    setCaret(c);
  });

  const accept = (item: Completion) => {
    const { text, caret: c } = applyCompletion(value, caret, item);
    setOpen(false);
    update(text, c);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && items.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + items.length) % items.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        accept(items[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setOpen(false);
      onRun();
      return;
    }

    // House style: one operator per line. Typing a pipe after content starts a
    // new line automatically rather than leaving a long single-line query.
    if (e.key === '|' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const el = e.currentTarget;
      const start = el.selectionStart;
      if (start === el.selectionEnd && pipeNeedsNewline(value, start)) {
        e.preventDefault();
        const insert = '\n| ';
        update(value.slice(0, start) + insert + value.slice(start), start + insert.length);
        setOpen(true);
        return;
      }
    }

    // Shift+Alt+F, the editor convention for "tidy this up"
    if (e.key.toLowerCase() === 'f' && e.altKey && e.shiftKey) {
      e.preventDefault();
      const tidy = formatKql(value);
      update(tidy, tidy.length);
      return;
    }

    // Ctrl+Space, the usual "show me options" chord
    if (e.code === 'Space' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setCaret(e.currentTarget.selectionStart);
      setOpen(true);
      return;
    }

    // Tab is deliberately NOT captured for indentation. It is the only key a
    // keyboard user has to leave a textarea, and combined with the modal focus
    // trap, swallowing it meant they could reach the editor and then never get
    // to Run, Reset, hints or Close — trapped in a dialog with no way out.
    // Indentation is available on Ctrl+] for anyone who wants it.
    if (e.key === ']' && e.ctrlKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      update(`${value.slice(0, start)}  ${value.slice(el.selectionEnd)}`, start + 2);
    }
  };

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const c = e.target.selectionStart;
    onChange(next);
    setCaret(c);

    // open as soon as there is something worth completing
    const ch = next[c - 1];
    if (ch && /[A-Za-z_|]/.test(ch)) setOpen(true);
    else if (ch === ' ' && OPEN_AFTER_SPACE.test(next.slice(0, c))) setOpen(true);
    else setOpen(false);
  };

  const syncCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) =>
    setCaret(e.currentTarget.selectionStart);

  return (
    <div className="kql-editor">
      <div className="kql-gutter" ref={gutterRef}>
        {Array.from({ length: lineCount }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>

      <div className="kql-surface">
        <pre className="kql-highlight" ref={preRef} aria-hidden="true">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <textarea
          ref={taRef}
          className="kql-input"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          // Without a name a screen reader announces only "edit text", giving
          // no clue that this is where the query goes.
          aria-label="KQL query editor"
          value={value}
          onChange={onInput}
          onKeyDown={onKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onScroll={syncScroll}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          // ARIA combobox pattern. Without these the popup is visual only:
          // a screen reader never learns that suggestions appeared, how many
          // there are, or which one the arrow keys are on.
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            open && items.length > 0 ? `${LISTBOX_ID}-opt-${active}` : undefined
          }
        />

        {open && items.length > 0 && (
          <div className="kql-suggest" style={{ left: popupPos.left, top: popupPos.top }}>
            <ul id={LISTBOX_ID} role="listbox" aria-label="Query suggestions">
              {items.map((it, i) => (
                <li
                  id={`${LISTBOX_ID}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  key={`${it.kind}-${it.label}`}
                  className={i === active ? 'on' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(it);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <i className={`k k-${it.kind}`}>{KIND_GLYPH[it.kind]}</i>
                  <span className="lbl">{it.label}</span>
                  {it.detail && <span className="det">{it.detail}</span>}
                </li>
              ))}
            </ul>
            {items[active]?.doc && <p className="kql-suggest-doc">{items[active].doc}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Monospace advance width, measured once per font string. */
const charCache = new Map<string, number>();
function measureChar(font: string): number {
  const hit = charCache.get(font);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 8;
  ctx.font = font;
  const w = ctx.measureText('M').width || 8;
  charCache.set(font, w);
  return w;
}
