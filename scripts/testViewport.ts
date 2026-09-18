import assert from 'node:assert/strict';
import {
  CAMERA_LOOKAHEAD, CAMERA_ZOOM, GAME_HEIGHT, GAME_WIDTH, MAX_BACKING_HEIGHT,
  MAX_BACKING_WIDTH, OVERVIEW_LABEL_CSS_HEIGHT, OVERVIEW_MAX_CSS_HEIGHT,
  OVERVIEW_MIN_CSS_HEIGHT, OVERVIEW_MIN_WIDTH_RATIO, PORTRAIT_MAX_WORLD_HEIGHT,
  PORTRAIT_MIN_WORLD_WIDTH, VIEW_HEIGHT, VIEW_WIDTH,
} from '../src/game/config.ts';
import { chooseViews, type CameraView, type ViewportLayout } from '../src/game/viewport.ts';

let passed = 0;
const failures: string[] = [];
const epsilon = 1e-8;

function check(name: string, test: () => void) {
  try {
    test();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

function bounds(view: CameraView, layout: ViewportLayout, levelWidth: number, levelHeight: number) {
  for (const value of Object.values(view)) assert.ok(Number.isFinite(value));
  assert.ok(view.x >= 0 && view.y >= 0);
  assert.ok(view.width > 0 && view.height > 0 && view.zoom > 0);
  assert.ok(view.x + view.width <= layout.width + epsilon);
  assert.ok(view.y + view.height <= layout.height + epsilon);
  assert.ok(view.worldWidth <= levelWidth + epsilon);
  assert.ok(view.worldHeight <= levelHeight + epsilon);
  near(view.width / view.zoom, view.worldWidth);
  near(view.height / view.zoom, view.worldHeight);
}

function invariants(hostWidth: number, hostHeight: number, mobile: boolean, levelWidth = 2944, levelHeight = 208) {
  const layout = chooseViews(hostWidth, hostHeight, mobile, levelWidth, levelHeight);
  assert.deepEqual(layout, chooseViews(hostWidth, hostHeight, mobile, levelWidth, levelHeight));
  assert.equal(layout.mobile, mobile);
  assert.equal(layout.mode, !mobile ? 'desktop' : hostWidth < hostHeight ? 'portrait' : 'landscape');
  for (const value of [layout.width, layout.height, layout.cssWidth, layout.cssHeight, layout.baseZoom]) {
    assert.ok(Number.isFinite(value) && value > 0);
  }
  assert.ok(layout.cssWidth <= hostWidth + epsilon && layout.cssHeight <= hostHeight + epsilon);
  assert.ok(layout.unusedCssHeight >= 0);
  near(layout.cssHeight + layout.unusedCssHeight, hostHeight);
  const cssScale = Math.min(hostWidth / layout.width, hostHeight / layout.height);
  near(layout.cssWidth, layout.width * cssScale);
  near(layout.cssHeight, layout.height * cssScale);
  near(layout.cssWidth / layout.width, layout.cssHeight / layout.height);
  near(layout.main.y + layout.main.height, layout.height);
  near(layout.baseZoom, layout.main.zoom);
  near(layout.main.width, layout.width);
  bounds(layout.main, layout, levelWidth, levelHeight);
  if (mobile) {
    assert.ok(layout.width <= MAX_BACKING_WIDTH + epsilon);
    assert.ok(layout.height <= MAX_BACKING_HEIGHT + epsilon);
    if (layout.mode === 'portrait') {
      near(layout.main.worldWidth, PORTRAIT_MIN_WORLD_WIDTH);
      assert.ok(layout.main.worldHeight <= PORTRAIT_MAX_WORLD_HEIGHT + epsilon);
    } else {
      near(layout.main.worldHeight, VIEW_HEIGHT);
      near(layout.main.worldWidth, Math.min(levelWidth, hostWidth / hostHeight * VIEW_HEIGHT));
      near(layout.cssHeight, hostHeight);
    }
  }
  if (layout.overview) {
    assert.equal(layout.mode, 'portrait');
    bounds(layout.overview, layout, levelWidth, levelHeight);
    near(layout.overview.worldHeight, levelHeight);
    near(layout.overview.width, layout.width);
    near(layout.overview.y, layout.labelHeight);
    near(layout.main.y, layout.labelHeight + layout.overview.height);
    near(layout.labelHeight * cssScale, OVERVIEW_LABEL_CSS_HEIGHT);
    assert.ok(layout.overview.height * cssScale >= OVERVIEW_MIN_CSS_HEIGHT - epsilon);
    assert.ok(layout.overview.height * cssScale <= OVERVIEW_MAX_CSS_HEIGHT + epsilon);
    assert.ok(layout.overview.worldWidth >= layout.main.worldWidth * OVERVIEW_MIN_WIDTH_RATIO - epsilon);
  } else {
    assert.equal(layout.labelHeight, 0);
    assert.equal(layout.main.y, 0);
  }
  near(layout.height, layout.main.height + (layout.overview?.height ?? 0) + layout.labelHeight);
  return layout;
}

check('desktop exports remain invariant', () => {
  assert.deepEqual([GAME_WIDTH, GAME_HEIGHT, CAMERA_ZOOM, VIEW_WIDTH, VIEW_HEIGHT], [640, 360, 2, 320, 180]);
  assert.equal(CAMERA_LOOKAHEAD, 24);
});

check('desktop always uses exact 640x360 / 2x geometry and uniform FIT', () => {
  for (const [w, h] of [[320, 568], [1920, 1080], [844, 320], [100, 10000], [10000, 10]]) {
    const layout = invariants(w, h, false);
    assert.deepEqual(layout.main, { x: 0, y: 0, width: 640, height: 360, zoom: 2, worldWidth: 320, worldHeight: 180 });
    assert.equal(layout.overview, null);
  }
  const fitted = chooseViews(320, 568, false);
  assert.deepEqual([fitted.cssWidth, fitted.cssHeight, fitted.unusedCssHeight], [320, 180, 388]);
});

check('requested portrait samples cap the overview, exclude surplus and retain full main height', () => {
  for (const [w, h, expectedHeight, overviewWorldWidth] of [
    [320, 568, 473.14285714285717, 416],
    [393, 700, 540.9285714285714, 510.9],
    [430, 844, 575.2857142857142, 559],
  ]) {
    const layout = invariants(w, h, true);
    assert.ok(layout.overview);
    near(layout.cssHeight, expectedHeight);
    near(layout.cssWidth, w);
    near(layout.main.worldHeight, 208);
    near(layout.overview.worldWidth, overviewWorldWidth);
    near(layout.width, 640);
    near(layout.main.zoom, 640 / 224);
    near(layout.unusedCssHeight, h - expectedHeight);
  }
});

check('requested landscape samples use all available height and width', () => {
  for (const [w, h, expectedWorldWidth] of [[667, 300, 400.2], [844, 320, 474.75]]) {
    const layout = invariants(w, h, true);
    assert.equal(layout.overview, null);
    near(layout.cssWidth, w);
    near(layout.cssHeight, h);
    near(layout.main.worldWidth, expectedWorldWidth);
    near(layout.unusedCssHeight, 0);
  }
});

check('uncapped portrait overview spends all remaining height, including its label', () => {
  const layout = invariants(320, 400, true);
  assert.ok(layout.overview);
  near(layout.cssHeight, 400);
  near(layout.unusedCssHeight, 0);
  near(layout.overview.height * layout.cssHeight / layout.height, 400 - 320 * 208 / 224 - 16);
});

check('overview drawable minimum excludes the label and is inclusive', () => {
  const threshold = 320 * (208 / 224) + 16 + 64;
  assert.ok(invariants(320, threshold, true).overview);
  const below = invariants(320, threshold - 0.001, true);
  assert.equal(below.overview, null);
  near(below.cssHeight, 320 * 208 / 224);
  near(below.unusedCssHeight, 80 - 0.001);
});

check('portrait main-only keeps its FOV without stretching near square hosts', () => {
  const layout = invariants(393, 394, true);
  assert.equal(layout.overview, null);
  near(layout.cssHeight, 393 * 208 / 224);
  near(layout.main.worldHeight, 208);
  near(layout.main.worldWidth, 224);
});

check('overview width-ratio cap may leave unused height rather than a narrow redundant overview', () => {
  const layout = invariants(160, 600, true);
  assert.ok(layout.overview);
  near(layout.overview.worldWidth, 336);
  near(layout.overview.height * layout.cssHeight / layout.height, 160 * 208 / 336);
  assert.ok(layout.unusedCssHeight > 0);
  assert.equal(invariants(100, 600, true).overview, null);
});

check('overview respects actual level width and full actual level height', () => {
  assert.equal(invariants(320, 568, true, 300).overview, null);
  assert.equal(invariants(320, 568, true, 400).overview, null);
  assert.ok(invariants(320, 568, true, 416).overview);
  const custom = invariants(320, 568, true, 736, 300);
  assert.ok(custom.overview);
  near(custom.overview.worldHeight, 300);
  near(custom.overview.worldWidth, 600);
  near(custom.main.worldHeight, 208);
  assert.equal(invariants(320, 568, true, 736, 1000).overview, null);
});

check('ultra-tall hosts exclude empty sky from the backing aspect', () => {
  const tall = invariants(320, 1000000, true);
  const normal = chooseViews(320, 568, true);
  near(tall.width, normal.width);
  near(tall.height, normal.height);
  near(tall.cssHeight, normal.cssHeight);
  assert.deepEqual(tall.main, normal.main);
  assert.deepEqual(tall.overview, normal.overview);
});

check('height-limited backing keeps a single uniform scale with a tall actual level', () => {
  const layout = invariants(100, 1000, true, 2944, 1000);
  assert.ok(layout.overview);
  near(layout.height, 1400);
  assert.ok(layout.width < 640);
  near(layout.cssHeight, 100 * 208 / 224 + 16 + 160);
});

check('ultra-wide and ultra-short hosts cap width, not the 180-world-pixel height', () => {
  for (const [w, h] of [[100000, 100], [844, 1], [667, 10]]) {
    const layout = invariants(w, h, true);
    near(layout.main.worldWidth, 2944);
    near(layout.cssWidth, 2944 * h / 180);
    near(layout.cssHeight, h);
    assert.ok(layout.cssWidth < w);
  }
});

check('square and fractional mobile hosts are deterministic and bounded', () => {
  assert.equal(invariants(320, 320, true).mode, 'landscape');
  near(chooseViews(320, 320, true).main.worldWidth, 180);
  invariants(393.25, 700.75, true);
  invariants(844.75, 320.125, true);
});

check('all four dimension arguments reject nonpositive and nonfinite values', () => {
  for (const mobile of [false, true]) {
    for (const invalid of [NaN, Infinity, -Infinity, 0, -0, -1]) {
      for (let index = 0; index < 4; index++) {
        const dims = [320, 568, 2944, 208];
        dims[index] = invalid;
        assert.throws(() => chooseViews(dims[0], dims[1], mobile, dims[2], dims[3]), RangeError);
      }
    }
  }
});

check('levels too small for the selected FOV fail explicitly, with exact minimums accepted', () => {
  assert.throws(() => chooseViews(640, 360, false, 319, 208), RangeError);
  assert.throws(() => chooseViews(640, 360, false, 320, 179), RangeError);
  invariants(640, 360, false, 320, 180);
  assert.throws(() => chooseViews(320, 568, true, 223, 208), RangeError);
  assert.throws(() => chooseViews(320, 568, true, 2944, 207), RangeError);
  invariants(320, 568, true, 224, 208);
  assert.throws(() => chooseViews(667, 300, true, 179, 208), RangeError);
  assert.throws(() => chooseViews(667, 300, true, 2944, 179), RangeError);
  invariants(667, 300, true, 180, 180);
});

check('unrepresentable backing geometry fails rather than returning NaN or infinite zoom', () => {
  assert.throws(() => chooseViews(Number.MIN_VALUE, 568, false), RangeError);
  assert.throws(() => chooseViews(Number.MIN_VALUE, 568, true), RangeError);
});

check('deterministic grid covers bounds, FIT, occupancy and overview budgets', () => {
  for (const w of [32, 100, 160, 224, 320, 393, 430, 640, 844, 1400, 4096]) {
    for (const h of [1, 64, 180, 300, 320, 400, 568, 700, 844, 1400, 10000]) {
      invariants(w, h, true);
      invariants(w, h, false);
    }
  }
});

console.log(`${passed} viewport checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exitCode = 1;
}
