import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  applyCompletion,
  completionsFor,
  type Completion,
} from '../kql/complete';
import { buildHighlightSchema, highlightKql } from '../kql/highlight';
import { formatKql, pipeNeedsNewline } from '../kql/format';
import type { TableMeta } from '../data/case001';
import { placeCompletion, type CompletionPlacement, type CompletionRect } from './completionPlacement';

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
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const initialAutoFocus = useRef(autoFocus === true);
  const composing = useRef(false);
  const suggestionGesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [popupPos, setPopupPos] = useState<CompletionPlacement | null>(null);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
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
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));
  const hasDocumentation = Boolean(items[activeIndex]?.doc);
  const popupVisible = open && items.length > 0 && popupPos !== null && portalRoot !== null;

  useEffect(() => {
    if (initialAutoFocus.current) taRef.current?.focus();
  }, []);

  useEffect(() => {
    setActive(0);
  }, [items.length, suggestions?.prefix]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || !open || !items.length) {
      setPopupPos(null);
      return;
    }
    // Escape the terminal's overflow box, but stay inside its dialog/focus trap.
    const root = ta.closest('.scrim-dialog') ?? ta.closest('.kql-editor');
    const terminal = ta.closest<HTMLElement>('.terminal-modal');
    const scroll = ta.closest<HTMLElement>('.terminal-scroll');
    const scrollport = scroll && getComputedStyle(scroll).display !== 'contents' ? scroll : terminal;
    const footer = terminal?.querySelector<HTMLElement>('.terminal-touch-actions');
    const viewport = window.visualViewport;
    setPortalRoot(root);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const visible: CompletionRect = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth),
        bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? document.documentElement.clientHeight),
      };
      const box = ta.getBoundingClientRect();
      const style = getComputedStyle(ta);
      const lineHeight = parseFloat(style.lineHeight) || 20;
      const lines = value.slice(0, caret).split('\n');
      const tabSize = parseFloat(style.tabSize) || 2;
      const col = [...lines[lines.length - 1]].reduce(
        (n, ch) => n + (ch === '\t' ? tabSize - n % tabSize : 1), 0);
      // DOMRects already use layout-viewport coordinates. Only the bounds get
      // visualViewport offsets; adding them to the caret again double-shifts iOS.
      const x = box.left + ta.clientLeft + parseFloat(style.paddingLeft) +
        col * measureChar(style.font) - ta.scrollLeft;
      const y = box.top + ta.clientTop + parseFloat(style.paddingTop) +
        (lines.length - 1) * lineHeight - ta.scrollTop;
      setPopupPos(placeCompletion({
        viewport: visible,
        scrollport: scrollport ? clientRect(scrollport) : visible,
        editor: box,
        caret: { left: x, right: x, top: y, bottom: y + lineHeight },
        footer: footer ? footer.getBoundingClientRect() : undefined,
        itemCount: items.length,
        hasDocumentation,
      }));
    };
    const schedule = (event?: Event) => {
      if (event?.target instanceof Node && popupRef.current?.contains(event.target)) return;
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    const observer = new ResizeObserver(() => schedule());
    for (const node of [ta, root, terminal, scrollport, footer]) {
      if (node) observer.observe(node);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [open, caret, value, items.length, hasDocumentation]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && target !== taRef.current && !popupRef.current?.contains(target)) {
        suggestionGesture.current = null;
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
      suggestionGesture.current = null;
    };
  }, [open]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const option = list?.children[activeIndex];
    if (!list || !(option instanceof HTMLElement)) return;
    // Scroll only the options, never scrollIntoView (which also moves the modal).
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [activeIndex, suggestions?.prefix, popupVisible, popupPos?.height]);

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
    if (composing.current || e.nativeEvent.isComposing) return;
    if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (popupVisible) {
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
        accept(items[activeIndex]);
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
    if (composing.current) {
      setOpen(false);
      return;
    }

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
          onSelect={syncCaret}
          onScroll={syncScroll}
          onCompositionStart={() => {
            composing.current = true;
            setOpen(false);
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            const c = e.currentTarget.selectionStart;
            const text = e.currentTarget.value;
            setCaret(c);
            setOpen(/[A-Za-z_|]$/.test(text.slice(0, c)) ||
              (text[c - 1] === ' ' && OPEN_AFTER_SPACE.test(text.slice(0, c))));
          }}
          onBlur={(e) => {
            if (!suggestionGesture.current && !popupRef.current?.contains(e.relatedTarget)) setOpen(false);
          }}
          // ARIA combobox pattern. Without these the popup is visual only:
          // a screen reader never learns that suggestions appeared, how many
          // there are, or which one the arrow keys are on.
          role="combobox"
          aria-expanded={popupVisible}
          aria-controls={popupVisible ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            popupVisible ? `${listboxId}-opt-${activeIndex}` : undefined
          }
        />

        {popupVisible && popupPos && portalRoot && createPortal(
          <div ref={popupRef} className="kql-completion-layer" data-placement={popupPos.side}
            style={{ left: popupPos.left, top: popupPos.top, width: popupPos.width, height: popupPos.height }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="kql-suggest">
              <ul ref={listRef} id={listboxId} role="listbox" aria-label="Query suggestions"
                onPointerDown={(e) => {
                  suggestionGesture.current = { x: e.clientX, y: e.clientY, moved: false };
                }}
                onPointerMove={(e) => {
                  const gesture = suggestionGesture.current;
                  if (gesture && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 10) gesture.moved = true;
                }}
                onPointerCancel={() => {
                  if (suggestionGesture.current) suggestionGesture.current.moved = true;
                }}
                onScroll={() => {
                  if (suggestionGesture.current) suggestionGesture.current.moved = true;
                }}
              >
                {items.map((it, i) => (
                  <li
                    id={`${listboxId}-opt-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    key={`${it.kind}-${it.label}`}
                    className={i === activeIndex ? 'on' : ''}
                    title={[it.label, it.detail, it.doc].filter(Boolean).join(' — ')}
                    onClick={() => {
                      const moved = suggestionGesture.current?.moved;
                      suggestionGesture.current = null;
                      if (moved) return;
                      taRef.current?.focus({ preventScroll: true });
                      accept(it);
                    }}
                    onMouseEnter={() => {
                      if (!suggestionGesture.current?.moved) setActive(i);
                    }}
                  >
                    <i className={`k k-${it.kind}`}>{KIND_GLYPH[it.kind]}</i>
                    <span className="lbl">{it.label}</span>
                    {it.detail && <span className="det">{it.detail}</span>}
                  </li>
                ))}
              </ul>
              {popupPos.showDocumentation && items[activeIndex]?.doc &&
                <p className="kql-suggest-doc">{items[activeIndex].doc}</p>}
            </div>
          </div>,
          portalRoot,
        )}
      </div>
    </div>
  );
}

function clientRect(node: HTMLElement): CompletionRect {
  const box = node.getBoundingClientRect();
  const left = box.left + node.clientLeft;
  const top = box.top + node.clientTop;
  return { left, top, right: left + node.clientWidth, bottom: top + node.clientHeight };
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
