import assert from 'node:assert/strict';
import { placeCompletion, type CompletionRect } from '../src/ui/completionPlacement.ts';

const rect = (left: number, top: number, width: number, height: number): CompletionRect =>
  ({ left, top, right: left + width, bottom: top + height });
const desktop = rect(0, 0, 1440, 900);
const phone = rect(0, 0, 390, 740);
const base = {
  viewport: desktop,
  scrollport: rect(100, 100, 1200, 680),
  editor: rect(620, 260, 560, 240),
  caret: rect(680, 280, 0, 26),
  itemCount: 12,
  hasDocumentation: true,
};
let passed = 0;
function check(name: string, test: () => void) {
  test();
  console.log(`PASS ${name}`);
  passed++;
}
function placed(input: Parameters<typeof placeCompletion>[0]) {
  const result = placeCompletion(input);
  assert.ok(result, 'expected a usable popup');
  for (const value of [result.left, result.top, result.width, result.height]) {
    assert.ok(Number.isFinite(value));
  }
  assert.ok(result.width >= 44 && result.height >= 48);
  for (const bounds of [input.viewport, input.scrollport]) {
    assert.ok(result.left >= bounds.left && result.top >= bounds.top);
    assert.ok(result.left + result.width <= bounds.right);
    assert.ok(result.top + result.height <= bounds.bottom);
  }
  return result;
}

check('desktop remains a caret-anchored dropdown with bounded documentation', () => {
  const result = placed(base);
  assert.equal(result.side, 'below');
  assert.equal(result.left, base.caret.left);
  assert.equal(result.top, base.caret.bottom + 6);
  assert.equal(result.width, 340);
  assert.equal(result.height, 5 * 44 + 4 + 72);
  assert.equal(result.showDocumentation, true);
});

check('lower edge flips above, upper edge stays below', () => {
  assert.equal(placed({ ...base, caret: rect(680, 488, 0, 26),
    scrollport: rect(100, 100, 1200, 450) }).side, 'above');
  assert.equal(placed({ ...base, caret: rect(680, 260, 0, 26) }).side, 'below');
});

check('left and right edges clamp the entire dropdown', () => {
  assert.equal(placed({ ...base, caret: rect(-500, 280, 0, 26) }).left, 106);
  assert.equal(placed({ ...base, caret: rect(9000, 280, 0, 26) }).left, 954);
});

const mobile = {
  ...base,
  viewport: phone,
  scrollport: rect(12, 24, 366, 680),
  editor: rect(60, 220, 290, 200),
  caret: rect(120, 306, 0, 27),
};

check('phone hides the doc panel, not the options or their touch height', () => {
  const result = placed(mobile);
  assert.equal(result.side, 'below');
  assert.equal(result.showDocumentation, false);
  assert.ok(result.height >= 3 * 44 + 4);
});

check('keyboard height change flips without moving the editor or adding an offset', () => {
  const before = placed(mobile);
  const after = placed({ ...mobile, viewport: rect(0, 0, 390, 390) });
  assert.equal(before.side, 'below');
  assert.equal(after.side, 'above');
  assert.equal(after.top + after.height, mobile.caret.top - 6);
});

check('visible sticky footer is excluded even if it overlays the scrollport', () => {
  const footer = rect(12, 385, 366, 58);
  const result = placed({ ...mobile, footer });
  assert.equal(result.side, 'above');
  assert.ok(result.top + result.height <= footer.top - 6);
});

check('a footer below the viewport or outside the horizontal bounds is irrelevant', () => {
  const input = { ...mobile, viewport: rect(0, 0, 390, 390) };
  assert.deepEqual(placeCompletion({ ...input, footer: rect(12, 650, 366, 58) }), placeCompletion(input));
  assert.deepEqual(placeCompletion({ ...input, footer: rect(800, 200, 366, 58) }), placeCompletion(input));
});

check('scrollport clips placement more tightly than the visible screen', () => {
  const result = placed({ ...mobile, scrollport: rect(12, 200, 366, 220) });
  assert.equal(result.side, 'above');
  assert.ok(result.top >= 206 && result.top + result.height <= 414);
});

check('no space on either side overlays the visible editor instead of leaving the screen', () => {
  const input = { ...mobile, viewport: rect(0, 200, 390, 120),
    caret: rect(120, 248, 0, 27) };
  const result = placed(input);
  assert.equal(result.side, 'overlay');
  assert.ok(result.top < input.editor.bottom && result.top + result.height > input.editor.top);
});

check('a single option fits with its full 44px target and border', () => {
  const result = placed({ ...mobile, itemCount: 1, viewport: rect(0, 200, 390, 60),
    caret: rect(120, 220, 0, 27) });
  assert.equal(result.side, 'overlay');
  assert.equal(result.height, 48);
});

check('one available row is preferred to an offscreen three-row menu', () => {
  const result = placed({ ...mobile, viewport: rect(0, 240, 390, 148),
    caret: rect(120, 250, 0, 27) });
  assert.equal(result.side, 'below');
  assert.ok(result.height >= 48 && result.height < 3 * 44 + 4);
});

check('visual viewport pan translates coordinates once, including after pinch zoom', () => {
  const offset = (box: CompletionRect) =>
    ({ left: box.left + 75, right: box.right + 75, top: box.top + 140, bottom: box.bottom + 140 });
  const original = placed(mobile);
  const shifted = placed({
    ...mobile,
    viewport: offset(mobile.viewport),
    scrollport: offset(mobile.scrollport),
    editor: offset(mobile.editor),
    caret: offset(mobile.caret),
  });
  assert.deepEqual(shifted, { ...original, left: original.left + 75, top: original.top + 140 });
  placed({ ...mobile, viewport: rect(85, 180, 195, 220) });
});

check('partially visible editor anchors clamp to its visible portion', () => {
  placed({ ...mobile, viewport: rect(0, 280, 390, 180), caret: rect(120, 180, 0, 27) });
  placed({ ...mobile, viewport: rect(0, 160, 390, 180), caret: rect(120, 600, 0, 27) });
});

check('fully scrolled-away editor has no orphaned popup', () => {
  assert.equal(placeCompletion({ ...mobile, editor: rect(60, 800, 290, 200) }), null);
  assert.equal(placeCompletion({ ...mobile, editor: rect(60, -300, 290, 200) }), null);
  assert.equal(placeCompletion({ ...mobile, editor: rect(500, 220, 290, 200) }), null);
});

check('zero, inverted, nonfinite or unusably small surfaces return no popup', () => {
  for (const viewport of [rect(0, 0, 0, 0), rect(0, 0, -1, 400),
    rect(0, 0, Number.NaN, 400), rect(0, 0, Infinity, 400),
    rect(0, 200, 390, 59), rect(100, 200, 55, 400)]) {
    assert.equal(placeCompletion({ ...mobile, viewport }), null);
  }
  assert.equal(placeCompletion({ ...mobile, scrollport: rect(0, 0, 0, 0) }), null);
  assert.equal(placeCompletion({ ...mobile, caret: rect(0, Number.NaN, 0, 26) }), null);
  assert.equal(placeCompletion({ ...mobile, itemCount: 0 }), null);
});

check('narrow landscape and keyboard transitions stay bounded across a geometry sweep', () => {
  for (const width of [180, 320, 390, 844, 1440]) {
    for (const height of [0, 59, 100, 180, 320, 740]) {
      for (const offset of [0, 80, 200]) {
        for (const y of [-80, 20, 90, 160, 280, 700]) {
          const input = {
            ...base,
            viewport: rect(0, offset, width, height),
            scrollport: rect(12, 12, width - 24, 850),
            editor: rect(20, y, width - 40, 170),
            caret: rect(width - 10, y + 60, 0, 27),
            footer: rect(12, offset + height - 52, width - 24, 52),
          };
          const result = placeCompletion(input);
          if (result) {
            placed(input);
            assert.ok(result.top + result.height <= input.footer.top - 6);
          }
        }
      }
    }
  }
});

console.log(`${passed} completion placement tests passed (no browser or OS keyboard exercised).`);
