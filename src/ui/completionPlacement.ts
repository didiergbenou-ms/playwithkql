export interface CompletionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CompletionPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  side: 'above' | 'below' | 'overlay';
  showDocumentation: boolean;
}

interface PlacementInput {
  viewport: CompletionRect;
  scrollport: CompletionRect;
  editor: CompletionRect;
  caret: CompletionRect;
  footer?: CompletionRect;
  itemCount: number;
  hasDocumentation: boolean;
}

const ROW_HEIGHT = 44;
const BORDER = 4;
const DOC_HEIGHT = 72;
const GAP = 6;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
const valid = (box: CompletionRect) =>
  Object.values(box).every(Number.isFinite) && box.right > box.left && box.bottom > box.top;

/** All rectangles and the returned fixed position use layout-viewport CSS pixels. */
export function placeCompletion(input: PlacementInput): CompletionPlacement | null {
  const { viewport, scrollport, editor, caret, footer, itemCount, hasDocumentation } = input;
  if (![viewport, scrollport, editor].every(valid) ||
      !Object.values(caret).every(Number.isFinite) || caret.bottom < caret.top ||
      !Number.isFinite(itemCount) || itemCount < 1) return null;

  const left = Math.max(viewport.left, scrollport.left) + GAP;
  const right = Math.min(viewport.right, scrollport.right) - GAP;
  const top = Math.max(viewport.top, scrollport.top) + GAP;
  let bottom = Math.min(viewport.bottom, scrollport.bottom) - GAP;
  if (footer && valid(footer) && footer.right > left && footer.left < right &&
      footer.bottom > top && footer.top < bottom) {
    bottom = footer.top - GAP;
  }
  // Do not leave an unrelated floating menu behind when its editor scrolls away.
  if (editor.right <= left || editor.left >= right || editor.bottom <= top || editor.top >= bottom ||
      right - left < ROW_HEIGHT || bottom - top < ROW_HEIGHT + BORDER) return null;

  const anchorTop = clamp(caret.top, Math.max(top, editor.top), Math.min(bottom, editor.bottom));
  const anchorBottom = clamp(caret.bottom, anchorTop, Math.min(bottom, editor.bottom));
  const below = Math.max(0, bottom - anchorBottom - GAP);
  const above = Math.max(0, anchorTop - GAP - top);
  const preferred = Math.min(3, Math.floor(itemCount)) * ROW_HEIGHT + BORDER;
  const minimum = ROW_HEIGHT + BORDER;
  let side: CompletionPlacement['side'];
  if (below >= preferred) side = 'below';
  else if (above >= minimum && above > below) side = 'above';
  else if (below >= minimum) side = 'below';
  else side = 'overlay';

  const available = side === 'below' ? below : side === 'above' ? above : bottom - top;
  const showDocumentation = hasDocumentation && viewport.right - viewport.left >= 600 &&
    available >= preferred + DOC_HEIGHT;
  const height = Math.min(available,
    Math.min(5, Math.floor(itemCount)) * ROW_HEIGHT + BORDER + (showDocumentation ? DOC_HEIGHT : 0));
  const width = Math.min(340, right - left);
  return {
    left: clamp(caret.left, left, right - width),
    top: side === 'below' ? anchorBottom + GAP
      : side === 'above' ? anchorTop - GAP - height
      : clamp(anchorTop, top, bottom - height),
    width,
    height,
    side,
    showDocumentation,
  };
}
